import {
  createStorageConflictCopyResult,
  createStorageDocumentAdapterMethods,
  createStorageWriteRacePreserver,
  describeStorageDocument,
  type StorageDocumentClient,
  truncateUtf8,
  writeStorageDocumentOrPreserveRace
} from '../shared/adapter'
import type {
  StorageAdapter,
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

const isGoogleDriveWriteRace = (error: unknown): boolean =>
  error instanceof GoogleDriveError &&
  (error.code === 'precondition' || error.code === 'conflict' || error.status === 412)

export function createGoogleDriveStorageAdapter(
  client: GoogleDriveClient,
  options: GoogleDriveStorageAdapterOptions = {}
): GoogleDriveStorageAdapter {
  const now = options.now ?? (() => new Date())
  const documentClient: StorageDocumentClient<GoogleDriveFile> = {
    getAuthority: (signal) => client.getAuthority(signal),
    testConnection: async (signal) => {
      await client.getStartPageToken(signal)
    },
    listDocuments: (signal) => client.listFiles(signal),
    getDocumentFile: (id, lookup) =>
      client.getFileMetadata(id, lookup?.signal, lookup?.expectedAuthority),
    downloadDocument: (id, transfer) => client.downloadFile(id, transfer)
  }
  const common = createStorageDocumentAdapterMethods(documentClient, {
    providerName: 'Google Drive',
    reserveDocumentId: async (reserveOptions) => {
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
    describeDocument: (file) =>
      describeStorageDocument(file.id, file.name, file.modifiedTime, file.remoteRevision),
    documentSize: (file) => file.size ?? 0,
    acceptMetadataDocument: isOpenPencilFile
  })

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
    return createStorageConflictCopyResult(
      originalRemoteRevision,
      conflictDocumentId,
      uploaded.remoteRevision
    )
  }
  const preserveWriteRace = createStorageWriteRacePreserver(
    documentClient,
    (file) => file.remoteRevision,
    createConflictCopy
  )

  return {
    ...common,

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
      const uploadOptions = {
        id,
        bytes,
        metadata: { name: normalizedFigName(metadata.name) },
        signal: transferOptions.signal,
        onProgress: transferOptions.onProgress,
        ...(transferOptions.expectedAuthority
          ? { expectedAuthority: transferOptions.expectedAuthority }
          : {})
      }

      if (!current) {
        return writeStorageDocumentOrPreserveRace(
          'created',
          () => client.createFile(uploadOptions),
          isGoogleDriveWriteRace,
          () => preserveWriteRace(id, bytes, metadata, transferOptions)
        )
      }

      return writeStorageDocumentOrPreserveRace(
        'updated',
        () =>
          client.updateFile({
            ...uploadOptions,
            expectedEtag: current.remoteRevision?.etag
          }),
        isGoogleDriveWriteRace,
        () => preserveWriteRace(id, bytes, metadata, transferOptions)
      )
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

    getStartPageToken(changeOptions) {
      return client.getStartPageToken(changeOptions?.signal)
    },

    listChanges(pageToken, changeOptions) {
      return client.listChanges(pageToken, changeOptions?.signal)
    }
  }
}
