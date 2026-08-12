import { extractFigThumbnailFromReader } from '@open-pencil/fig'

import { isTauri } from '@/app/tauri/env'

import {
  NAMESPACE_MARKER_BODY,
  STORAGE_DOCUMENTS_PREFIX,
  STORAGE_NAMESPACE,
  STORAGE_NAMESPACE_MARKER,
  documentFigKey,
  documentIdFromFigKey,
  documentMetaKey,
  documentThumbnailKey
} from '../namespace'
import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentAuthority,
  StorageDocumentMetadata,
  StorageProviderRuntime,
  StorageTransferOptions
} from '../types'
import { assertS3StorageAuthority, ensureS3StorageAuthority } from './authority'
import {
  S3HttpError,
  deleteObject,
  getObject,
  getObjectRange,
  headObject,
  headObjectSize,
  listObjects,
  putObject,
  type DownloadProgress,
  type UploadProgress
} from './client'
import { CloudCORSError, formatBrowserCORSHelpMessage, isLikelyCORSOrNetworkError } from './cors'
import { assertS3LegacyMigrationComplete } from './legacy-migration-state'
import type { S3CompatibleConfig, S3ConnectionResult } from './types'

const ENDPOINT_FIELD = 'endpoint'
const BUCKET_FIELD = 'bucket'
const REGION_FIELD = 'region'
const ACCESS_KEY_FIELD = 'access-key-id'
const SECRET_KEY_FIELD = 'secret-access-key'

function requiredPreference(runtime: StorageProviderRuntime, field: string): string {
  const value = runtime.preferences[field]?.trim()
  if (!value) throw new Error(`S3 ${field} is required`)
  return value
}

async function resolveConfig(
  runtime: StorageProviderRuntime,
  expectedAuthority?: StorageDocumentAuthority,
  authorityRequired = false
): Promise<S3CompatibleConfig> {
  assertS3StorageAuthority(runtime.profileId, expectedAuthority, authorityRequired)
  const [accessKeyId, secretAccessKey] = await Promise.all([
    runtime.resolveCredential(ACCESS_KEY_FIELD),
    runtime.resolveCredential(SECRET_KEY_FIELD)
  ])
  // Credential replacement rotates before the secret write. Recheck after resolution so
  // a job cannot combine a stale profile snapshot with a replacement credential.
  assertS3StorageAuthority(runtime.profileId, expectedAuthority, authorityRequired)
  if (!accessKeyId || !secretAccessKey) throw new Error('S3 credentials are required')

  const region = runtime.preferences[REGION_FIELD]?.trim()
  return {
    endpoint: requiredPreference(runtime, ENDPOINT_FIELD),
    bucket: requiredPreference(runtime, BUCKET_FIELD),
    accessKeyId,
    secretAccessKey,
    ...(region ? { region } : {})
  }
}

function parseMetadata(
  bytes: Uint8Array | null,
  fallback: StorageDocumentMetadata
): { metadata: StorageDocumentMetadata; authoritative: boolean } {
  if (!bytes) return { metadata: fallback, authoritative: false }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<StorageDocumentMetadata>
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : null
    const updatedAt =
      typeof parsed.updatedAt === 'string' && parsed.updatedAt ? parsed.updatedAt : null
    return {
      metadata: {
        name: name ?? fallback.name,
        updatedAt: updatedAt ?? fallback.updatedAt
      },
      authoritative: name !== null && updatedAt !== null
    }
  } catch {
    return { metadata: fallback, authoritative: false }
  }
}

function connectionErrorMessage(error: unknown, isCORS: boolean): string {
  if (isCORS) return formatBrowserCORSHelpMessage()
  return error instanceof Error ? error.message : String(error)
}

function forwardProgress<T extends { totalBytes: number | null }>(
  options: StorageTransferOptions | undefined,
  transferredBytes: (progress: T) => number
): ((progress: T) => void) | undefined {
  const onProgress = options?.onProgress
  return onProgress
    ? (progress) =>
        onProgress({
          transferredBytes: transferredBytes(progress),
          totalBytes: progress.totalBytes
        })
    : undefined
}

async function getMetadataBytes(
  config: S3CompatibleConfig,
  id: string,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  return getObject(config, documentMetaKey(id), undefined, signal).catch((error: unknown) => {
    if (signal?.aborted) throw error
    console.warn('[Storage] Document metadata fetch failed:', id, error)
    return null
  })
}

async function ensureNamespace(config: S3CompatibleConfig, signal?: AbortSignal): Promise<void> {
  if (await headObject(config, STORAGE_NAMESPACE_MARKER, signal)) return
  try {
    await putObject(
      config,
      STORAGE_NAMESPACE_MARKER,
      NAMESPACE_MARKER_BODY,
      'application/json',
      undefined,
      signal
    )
  } catch (error) {
    if (error instanceof S3HttpError && (error.status === 403 || error.status === 401)) {
      throw new Error('Cannot write to this bucket. Check access permissions and bucket name.')
    }
    throw error
  }
}

export interface S3StorageAdapter extends StorageAdapter {
  testConnection(options?: Pick<StorageTransferOptions, 'signal'>): Promise<S3ConnectionResult>
}

export function createS3StorageAdapter(runtime: StorageProviderRuntime): S3StorageAdapter {
  return {
    async getAuthority(options) {
      options?.signal?.throwIfAborted()
      return ensureS3StorageAuthority(runtime.profileId)
    },

    async testConnection(options) {
      const authority = ensureS3StorageAuthority(runtime.profileId)
      assertS3LegacyMigrationComplete(runtime.profileId, authority)
      const config = await resolveConfig(runtime)
      try {
        await ensureNamespace(config, options?.signal)
        await listObjects(config, STORAGE_DOCUMENTS_PREFIX, options?.signal)
      } catch (error) {
        if (options?.signal?.aborted) throw error
        const isCORS =
          error instanceof CloudCORSError || (!isTauri() && isLikelyCORSOrNetworkError(error))
        return {
          ok: false,
          message: connectionErrorMessage(error, isCORS),
          corsApplied: false,
          isCORSFailure: isCORS,
          corsError: null
        }
      }

      return {
        ok: true,
        message: 'Connected. Storage namespace is ready.',
        corsApplied: false,
        isCORSFailure: false,
        corsError: null
      }
    },

    async listDocuments(options) {
      const config = await resolveConfig(runtime)
      const objects = await listObjects(config, STORAGE_DOCUMENTS_PREFIX, options?.signal)
      const entries = objects
        .map((object) => {
          const id = documentIdFromFigKey(object.key)
          return id ? { id, lastModified: object.lastModified } : null
        })
        .filter((entry): entry is { id: string; lastModified: string | null } => entry !== null)

      const documents: StorageDocument[] = []
      // Bound sidecar reads so large buckets do not open hundreds of requests at once.
      for (let offset = 0; offset < entries.length; offset += 12) {
        const batch = entries.slice(offset, offset + 12)
        documents.push(
          ...(await Promise.all(
            batch.map(async ({ id, lastModified }) => {
              const fallback = {
                name: id,
                updatedAt: lastModified ?? new Date(0).toISOString()
              }
              const metadataBytes = await getMetadataBytes(config, id, options?.signal)
              const { metadata, authoritative } = parseMetadata(metadataBytes, fallback)
              return {
                id,
                ...metadata,
                metadataAuthoritative: authoritative
              } satisfies StorageDocument
            })
          ))
        )
      }
      return documents.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
    },

    async getDocument(id, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority)
      const bytes = await getObject(
        config,
        documentFigKey(id),
        forwardProgress<DownloadProgress>(options, (progress) => progress.receivedBytes),
        options?.signal
      )
      if (!bytes) throw new Error(`Document not found: ${id}`)
      const metadataBytes = await getMetadataBytes(config, id, options?.signal)
      const { metadata } = parseMetadata(metadataBytes, {
        name: id,
        updatedAt: new Date(0).toISOString()
      })
      return { bytes, metadata, remoteRevision: null }
    },

    async putDocument(id, bytes, metadata, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority, true)
      if (options?.expectedRemoteRevision) {
        throw new Error('S3-compatible storage does not support remote revision preconditions')
      }
      const existed = await headObject(config, documentFigKey(id), options?.signal)
      assertS3StorageAuthority(runtime.profileId, options?.expectedAuthority, true)
      await putObject(
        config,
        documentFigKey(id),
        bytes,
        'application/octet-stream',
        forwardProgress<UploadProgress>(options, (progress) => progress.sentBytes),
        options?.signal
      )
      assertS3StorageAuthority(runtime.profileId, options?.expectedAuthority, true)
      await putObject(
        config,
        documentMetaKey(id),
        JSON.stringify({
          name: metadata.name,
          updatedAt: metadata.updatedAt || new Date().toISOString()
        }),
        'application/json',
        undefined,
        options?.signal
      )
      return { outcome: existed ? 'updated' : 'created', remoteRevision: null }
    },

    async getDocumentMetadata(id, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority)
      const bytes = await getObject(config, documentMetaKey(id), undefined, options?.signal)
      if (!bytes) return null
      const parsed = parseMetadata(bytes, {
        name: id,
        updatedAt: new Date(0).toISOString()
      })
      return parsed.authoritative ? { ...parsed.metadata, remoteRevision: null } : null
    },

    async deleteDocument(id, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority, true)
      const results = await Promise.allSettled([
        deleteObject(config, documentFigKey(id), options?.signal),
        deleteObject(config, documentMetaKey(id), options?.signal),
        deleteObject(config, documentThumbnailKey(id), options?.signal)
      ])
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      if (failure) throw failure.reason
    },

    async getUsage(options) {
      const config = await resolveConfig(runtime)
      const objects = await listObjects(config, `${STORAGE_NAMESPACE}/`, options?.signal)
      return {
        bytesUsed: objects.reduce((total, object) => total + (object.size ?? 0), 0),
        objectCount: objects.length,
        documentCount: objects.filter((object) => documentIdFromFigKey(object.key)).length
      }
    },

    async putThumbnail(id, bytes, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority, true)
      await putObject(
        config,
        documentThumbnailKey(id),
        bytes,
        'image/jpeg',
        options?.onProgress
          ? (progress) =>
              options.onProgress?.({
                transferredBytes: progress.sentBytes,
                totalBytes: progress.totalBytes
              })
          : undefined,
        options?.signal
      )
    },

    async getThumbnail(id, options) {
      const config = await resolveConfig(runtime, options?.expectedAuthority)
      const figKey = documentFigKey(id)
      const size = await headObjectSize(config, figKey, options?.signal)
      if (size == null) return null
      return extractFigThumbnailFromReader({
        size,
        async read(start: number, endExclusive: number) {
          return (
            (await getObjectRange(config, figKey, start, endExclusive, options?.signal)) ??
            new Uint8Array()
          )
        }
      })
    }
  }
}
