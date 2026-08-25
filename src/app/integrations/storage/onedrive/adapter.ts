import type {
  StorageAdapter,
  StorageConnectionResult,
  StorageDocument,
  StorageDocumentAuthority,
  StorageDocumentMetadata,
  StorageGetDocumentResult,
  StoragePutDocumentOptions,
  StoragePutDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import type { OneDriveClient } from './client'
import { OneDriveError } from './errors'
import type { OneDriveDocumentFile, OneDriveUploadOptions, OneDriveUploadResult } from './types'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RESERVED_BASENAMES = /^(?:\.lock|con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

export interface OneDriveClientLike {
  getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority>
  testConnection(signal?: AbortSignal): Promise<void>
  listDocuments(signal?: AbortSignal): Promise<OneDriveDocumentFile[]>
  getDocumentFile(
    documentId: string,
    options?: Readonly<{
      itemId?: string
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
    }>
  ): Promise<OneDriveDocumentFile | null>
  downloadDocument(
    documentId: string,
    options?: StorageTransferOptions
  ): Promise<StorageGetDocumentResult>
  createDocument(options: OneDriveUploadOptions): Promise<OneDriveUploadResult>
  updateDocument(options: OneDriveUploadOptions): Promise<OneDriveUploadResult>
  deleteDocumentFile(
    documentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<void>
}

export type OneDriveStorageAdapterOptions = Readonly<{
  now?: () => Date
  createDocumentId?: () => string
}>

export type OneDriveStorageAdapter = StorageAdapter

function truncateCharacters(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join('')
}

export function normalizeOneDriveFigName(input: string): string {
  const cleaned = Array.from(input.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || /["*/:<>?\\|#%]/.test(character) ? '-' : character
  })
    .join('')
    .replace(/-+/g, '-')
    .replace(/[. ]+$/g, '')
    .replace(/^~+/, '')
  const withoutExtension = cleaned.toLocaleLowerCase().endsWith('.fig')
    ? cleaned.slice(0, -4)
    : cleaned
  const base = withoutExtension.trim().replace(/[. ]+$/g, '')
  if (!base) {
    throw new OneDriveError('invalid-input', 'OneDrive document name is required')
  }
  const safeBase = RESERVED_BASENAMES.test(base) ? `_${base}` : base
  return `${truncateCharacters(safeBase, 240)}.fig`
}

function conflictName(name: string, now: Date): string {
  const base = normalizeOneDriveFigName(name).slice(0, -4)
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '-')
  return normalizeOneDriveFigName(`${truncateCharacters(base, 190)} (conflict ${timestamp}).fig`)
}

function validateGeneratedDocumentId(value: string): string {
  const normalized = value.toLocaleLowerCase()
  if (normalized !== value || !DOCUMENT_ID_PATTERN.test(value)) {
    throw new OneDriveError(
      'invalid-response',
      'OneDrive document ID generator returned a non-canonical UUID v4'
    )
  }
  return value
}

function isRevision(
  value: StorageRemoteRevision | null | undefined
): value is StorageRemoteRevision {
  if (!value || Object.keys(value).length !== 2) return false
  return (
    typeof value.itemId === 'string' &&
    value.itemId.length > 0 &&
    typeof value.etag === 'string' &&
    value.etag.length > 0
  )
}

export function oneDriveRevisionsMatch(
  expected: StorageRemoteRevision | null | undefined,
  actual: StorageRemoteRevision | null | undefined
): boolean {
  return (
    isRevision(expected) &&
    isRevision(actual) &&
    expected.itemId === actual.itemId &&
    expected.etag === actual.etag
  )
}

function revisionFor(document: OneDriveDocumentFile): StorageRemoteRevision {
  const { id: itemId, eTag: etag } = document.file
  if (!etag) throw new OneDriveError('invalid-response', 'OneDrive file is missing an ETag')
  return { itemId, etag }
}

function isWriteRace(error: unknown): boolean {
  return (
    error instanceof OneDriveError &&
    (error.code === 'conflict' ||
      error.code === 'precondition' ||
      error.status === 409 ||
      error.status === 412)
  )
}

function connectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'OneDrive connection failed'
}

export function createOneDriveStorageAdapter(
  client: OneDriveClientLike | OneDriveClient,
  options: OneDriveStorageAdapterOptions = {}
): OneDriveStorageAdapter {
  const now = options.now ?? (() => new Date())
  const createDocumentId = options.createDocumentId ?? (() => crypto.randomUUID())

  const reserveId = (): string => validateGeneratedDocumentId(createDocumentId())

  const createConflictCopy = async (
    originalId: string,
    originalRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult> => {
    let conflictDocumentId = reserveId()
    for (let attempt = 0; conflictDocumentId === originalId && attempt < 3; attempt++) {
      conflictDocumentId = reserveId()
    }
    if (conflictDocumentId === originalId) {
      throw new OneDriveError('invalid-response', 'OneDrive could not reserve a conflict copy ID')
    }
    const uploaded = await client.createDocument({
      documentId: conflictDocumentId,
      name: conflictName(metadata.name, now()),
      bytes,
      signal: transfer.signal,
      onProgress: transfer.onProgress,
      expectedAuthority: transfer.expectedAuthority
    })
    return {
      outcome: 'conflict-copy',
      remoteRevision: originalRevision,
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
    const latest = await client.getDocumentFile(id, {
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority
    })
    return createConflictCopy(id, latest ? revisionFor(latest) : null, bytes, metadata, transfer)
  }

  return {
    async testConnection(connectionOptions): Promise<StorageConnectionResult> {
      try {
        await client.testConnection(connectionOptions?.signal)
        return { ok: true, message: 'Connected to OneDrive.' }
      } catch (error) {
        return { ok: false, message: connectionMessage(error) }
      }
    },

    async getAuthority(authorityOptions) {
      return client.getAuthority(authorityOptions?.signal)
    },

    async listDocuments(listOptions) {
      const documents = await client.listDocuments(listOptions?.signal)
      return documents.map(
        (document): StorageDocument => ({
          id: document.documentId,
          name: document.file.name,
          updatedAt: document.file.lastModifiedDateTime,
          remoteRevision: revisionFor(document),
          metadataAuthoritative: true
        })
      )
    },

    async reserveDocumentId() {
      return reserveId()
    },

    getDocument(id, transferOptions) {
      return client.downloadDocument(id, transferOptions)
    },

    async putDocument(id, bytes, metadata, transferOptions = {}) {
      const current = await client.getDocumentFile(id, {
        signal: transferOptions.signal,
        expectedAuthority: transferOptions.expectedAuthority
      })
      const currentRevision = current ? revisionFor(current) : null
      const expectedRevision = transferOptions.expectedRemoteRevision

      if (current && !oneDriveRevisionsMatch(expectedRevision, currentRevision)) {
        return createConflictCopy(id, currentRevision, bytes, metadata, transferOptions)
      }
      if (!current && expectedRevision !== undefined && expectedRevision !== null) {
        return createConflictCopy(id, null, bytes, metadata, transferOptions)
      }

      const uploadOptions: OneDriveUploadOptions = {
        documentId: id,
        name: normalizeOneDriveFigName(metadata.name),
        bytes,
        signal: transferOptions.signal,
        onProgress: transferOptions.onProgress,
        expectedAuthority: transferOptions.expectedAuthority
      }

      if (!current) {
        try {
          const created = await client.createDocument(uploadOptions)
          return { outcome: 'created', remoteRevision: created.remoteRevision }
        } catch (error) {
          if (!isWriteRace(error)) throw error
          return preserveWriteRace(id, bytes, metadata, transferOptions)
        }
      }

      try {
        const updated = await client.updateDocument({
          ...uploadOptions,
          itemId: current.file.id,
          expectedEtag: current.file.eTag ?? undefined
        })
        return { outcome: 'updated', remoteRevision: updated.remoteRevision }
      } catch (error) {
        if (!isWriteRace(error)) throw error
        return preserveWriteRace(id, bytes, metadata, transferOptions)
      }
    },

    deleteDocument(id, deleteOptions) {
      return client.deleteDocumentFile(id, deleteOptions?.signal, deleteOptions?.expectedAuthority)
    },

    async getDocumentMetadata(id, metadataOptions) {
      const document = await client.getDocumentFile(id, {
        signal: metadataOptions?.signal,
        expectedAuthority: metadataOptions?.expectedAuthority
      })
      if (!document) return null
      return {
        name: document.file.name,
        updatedAt: document.file.lastModifiedDateTime,
        remoteRevision: revisionFor(document)
      }
    },

    async getUsage(usageOptions) {
      const documents = await client.listDocuments(usageOptions?.signal)
      return {
        bytesUsed: documents.reduce((total, document) => total + (document.file.size ?? 0), 0),
        objectCount: documents.length,
        documentCount: documents.length
      }
    }
  }
}
