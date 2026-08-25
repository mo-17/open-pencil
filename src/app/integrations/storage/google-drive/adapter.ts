import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentMetadata,
  StoragePutDocumentOptions,
  StoragePutDocumentResult,
  StorageRemoteRevision
} from '../types'
import { isOpenPencilFile } from './client'
import type { GoogleDriveClient } from './client'
import { GoogleDriveError } from './errors'
import {
  GOOGLE_DRIVE_CONFLICT_PROPERTY,
  type GoogleDriveChangesResult,
  type GoogleDriveFile
} from './types'

export type GoogleDriveStorageAdapterOptions = {
  now?: () => Date
}

export interface GoogleDriveStorageAdapter extends StorageAdapter {
  getStartPageToken(options?: { signal?: AbortSignal }): Promise<string>
  listChanges(
    pageToken: string,
    options?: { signal?: AbortSignal }
  ): Promise<GoogleDriveChangesResult>
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  let output = ''
  let usedBytes = 0
  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength
    if (usedBytes + characterBytes > maxBytes) break
    output += character
    usedBytes += characterBytes
  }
  return output
}

function normalizedFigName(input: string): string {
  const cleaned = Array.from(input.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 ? '' : character
  })
    .join('')
    .replace(/[\\/]+/g, '-')
  if (!cleaned) {
    throw new GoogleDriveError('invalid-input', 'Google Drive document name is required')
  }
  const withExtension = cleaned.toLocaleLowerCase().endsWith('.fig') ? cleaned : `${cleaned}.fig`
  const base = withExtension.slice(0, -4)
  if (!base.trim()) {
    throw new GoogleDriveError('invalid-input', 'Google Drive document name is required')
  }
  return `${truncateUtf8(base.slice(0, 236), 508)}.fig`
}

function conflictName(name: string, now: Date): string {
  const base = normalizedFigName(name).slice(0, -4)
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '-')
  const suffix = ` (conflict ${timestamp}).fig`
  return `${truncateUtf8(base.slice(0, Math.max(1, 240 - suffix.length)), 512 - suffix.length)}${suffix}`
}

function hasExpectedRevision(expected: StorageRemoteRevision): boolean {
  // A checksum/head revision alone does not cover metadata-only changes. Only
  // tokens that identify the whole current representation may authorize using
  // the freshly-read ETag as the upload precondition.
  return ['etag', 'version'].some((key) => {
    const value = expected[key]
    return typeof value === 'string' && value.length > 0
  })
}

export function revisionsMatch(
  expected: StorageRemoteRevision,
  actual: StorageRemoteRevision | null
): boolean {
  if (!hasExpectedRevision(expected) || !actual) return false
  return Object.entries(expected).every(
    ([key, value]) => typeof value === 'string' && value.length > 0 && actual[key] === value
  )
}

function shouldCreateConflictCopy(
  current: GoogleDriveFile | null,
  expected: StoragePutDocumentOptions['expectedRemoteRevision']
): boolean {
  if (current && !isOpenPencilFile(current)) return true
  if (!current) return expected !== undefined && expected !== null
  // Drive v3 exposes no version query precondition. Never claim atomic CAS or
  // overwrite an existing file unless the exact metadata read supplied an ETag.
  if (expected === undefined || expected === null || !current.remoteRevision?.etag) return true
  return !revisionsMatch(expected, current.remoteRevision)
}

function isWriteRace(error: unknown): boolean {
  return (
    error instanceof GoogleDriveError &&
    (error.code === 'precondition' || error.code === 'conflict' || error.status === 412)
  )
}

function connectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Google Drive connection failed'
}

export function createGoogleDriveStorageAdapter(
  client: GoogleDriveClient,
  options: GoogleDriveStorageAdapterOptions = {}
): GoogleDriveStorageAdapter {
  const now = options.now ?? (() => new Date())

  const createConflictCopy = async (
    originalId: string,
    originalRemoteRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult> => {
    const [conflictDocumentId] = await client.generateIds(
      1,
      transfer.signal,
      transfer.expectedAuthority
    )
    if (!conflictDocumentId) {
      throw new GoogleDriveError(
        'invalid-response',
        'Google Drive did not reserve a conflict document ID'
      )
    }
    const uploaded = await client.createFile({
      id: conflictDocumentId,
      bytes,
      metadata: {
        name: conflictName(metadata.name, now()),
        appProperties: { [GOOGLE_DRIVE_CONFLICT_PROPERTY]: originalId }
      },
      signal: transfer.signal,
      onProgress: transfer.onProgress,
      ...(transfer.expectedAuthority ? { expectedAuthority: transfer.expectedAuthority } : {})
    })
    return {
      outcome: 'conflict-copy',
      remoteRevision: originalRemoteRevision,
      conflictDocumentId,
      conflictCopyRevision: uploaded.remoteRevision
    }
  }

  const preserveWriteRace = async (
    id: string,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult> => {
    const latest = await client.getFileMetadata(id, transfer.signal, transfer.expectedAuthority)
    return createConflictCopy(id, latest?.remoteRevision ?? null, bytes, metadata, transfer)
  }

  return {
    async testConnection(connectionOptions) {
      try {
        await client.getStartPageToken(connectionOptions?.signal)
        return { ok: true, message: 'Connected to Google Drive.' }
      } catch (error) {
        return { ok: false, message: connectionMessage(error) }
      }
    },

    async getAuthority(authorityOptions) {
      return client.getAuthority(authorityOptions?.signal)
    },

    async listDocuments(listOptions) {
      const files = await client.listFiles(listOptions?.signal)
      return files.map(
        (file): StorageDocument => ({
          id: file.id,
          name: file.name,
          updatedAt: file.modifiedTime,
          remoteRevision: file.remoteRevision,
          metadataAuthoritative: true
        })
      )
    },

    async reserveDocumentId(reserveOptions) {
      const [id] = await client.generateIds(
        1,
        reserveOptions?.signal,
        reserveOptions?.expectedAuthority
      )
      if (!id) {
        throw new GoogleDriveError('invalid-response', 'Google Drive did not reserve a document ID')
      }
      return id
    },

    async getDocument(id, transferOptions) {
      return client.downloadFile(id, transferOptions)
    },

    async putDocument(id, bytes, metadata, transferOptions = {}) {
      const current = await client.getFileMetadata(
        id,
        transferOptions.signal,
        transferOptions.expectedAuthority
      )
      if (shouldCreateConflictCopy(current, transferOptions.expectedRemoteRevision)) {
        return createConflictCopy(
          id,
          current?.remoteRevision ?? null,
          bytes,
          metadata,
          transferOptions
        )
      }

      if (!current) {
        try {
          const uploaded = await client.createFile({
            id,
            bytes,
            metadata: { name: normalizedFigName(metadata.name) },
            signal: transferOptions.signal,
            onProgress: transferOptions.onProgress,
            ...(transferOptions.expectedAuthority
              ? { expectedAuthority: transferOptions.expectedAuthority }
              : {})
          })
          return { outcome: 'created', remoteRevision: uploaded.remoteRevision }
        } catch (error) {
          if (!isWriteRace(error)) throw error
          return preserveWriteRace(id, bytes, metadata, transferOptions)
        }
      }

      try {
        const uploaded = await client.updateFile({
          id,
          bytes,
          metadata: { name: normalizedFigName(metadata.name) },
          expectedEtag: current.remoteRevision?.etag,
          signal: transferOptions.signal,
          onProgress: transferOptions.onProgress,
          ...(transferOptions.expectedAuthority
            ? { expectedAuthority: transferOptions.expectedAuthority }
            : {})
        })
        return { outcome: 'updated', remoteRevision: uploaded.remoteRevision }
      } catch (error) {
        if (!isWriteRace(error)) throw error
        return preserveWriteRace(id, bytes, metadata, transferOptions)
      }
    },

    async deleteDocument(id, deleteOptions) {
      const current = await client.getFileMetadata(
        id,
        deleteOptions?.signal,
        deleteOptions?.expectedAuthority
      )
      if (!current) return
      if (!isOpenPencilFile(current)) {
        throw new GoogleDriveError(
          'foreign-file',
          'Google Drive refused to trash a file not owned by OpenPencil'
        )
      }
      await client.trashFile(id, deleteOptions?.signal, deleteOptions?.expectedAuthority)
    },

    async getDocumentMetadata(id, metadataOptions) {
      const file = await client.getFileMetadata(
        id,
        metadataOptions?.signal,
        metadataOptions?.expectedAuthority
      )
      if (!file || !isOpenPencilFile(file)) return null
      return {
        name: file.name,
        updatedAt: file.modifiedTime,
        remoteRevision: file.remoteRevision
      }
    },

    async getUsage(usageOptions) {
      const files = await client.listFiles(usageOptions?.signal)
      return {
        bytesUsed: files.reduce((total, file) => total + (file.size ?? 0), 0),
        objectCount: files.length,
        documentCount: files.length
      }
    },

    getStartPageToken(changeOptions) {
      return client.getStartPageToken(changeOptions?.signal)
    },

    listChanges(pageToken, changeOptions) {
      return client.listChanges(pageToken, changeOptions?.signal)
    }
  }
}
