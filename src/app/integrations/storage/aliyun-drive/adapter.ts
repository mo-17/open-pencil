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
import { aliyunDriveRemoteRevisionFor, type AliyunDriveClient } from './client'
import { AliyunDriveError } from './errors'
import type {
  AliyunDriveDocumentFile,
  AliyunDriveReplacementOptions,
  AliyunDriveReplacementResult,
  AliyunDriveUploadOptions,
  AliyunDriveUploadResult
} from './types'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAX_NAME_BYTES = 1_024

export interface AliyunDriveClientLike {
  getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority>
  testConnection(signal?: AbortSignal): Promise<void>
  listDocuments(signal?: AbortSignal): Promise<AliyunDriveDocumentFile[]>
  getDocumentFile(
    documentId: string,
    options?: Readonly<{
      signal?: AbortSignal
      expectedAuthority?: StorageDocumentAuthority
    }>
  ): Promise<AliyunDriveDocumentFile | null>
  downloadDocument(
    documentId: string,
    options?: StorageTransferOptions
  ): Promise<StorageGetDocumentResult>
  createDocument(options: AliyunDriveUploadOptions): Promise<AliyunDriveUploadResult>
  replaceDocument(options: AliyunDriveReplacementOptions): Promise<AliyunDriveReplacementResult>
  deleteDocumentFile(
    documentId: string,
    signal?: AbortSignal,
    expectedAuthority?: StorageDocumentAuthority
  ): Promise<void>
}

export type AliyunDriveStorageAdapterOptions = Readonly<{
  now?: () => Date
  createDocumentId?: () => string
}>

export type AliyunDriveStorageAdapter = StorageAdapter

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  let output = ''
  for (const character of value) {
    if (encoder.encode(output + character).byteLength > maxBytes) break
    output += character
  }
  return output
}

export function normalizeAliyunDriveFigName(input: string): string {
  const cleaned = Array.from(input.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || character === '/' ? '-' : character
  })
    .join('')
    .replace(/-+/g, '-')
    .replace(/[. ]+$/g, '')
  const withoutExtension = cleaned.toLocaleLowerCase().endsWith('.fig')
    ? cleaned.slice(0, -4)
    : cleaned
  const base = withoutExtension.trim().replace(/[. ]+$/g, '')
  if (!base) {
    throw new AliyunDriveError('invalid-input', 'Aliyun Drive document name is required')
  }
  const safeBase = truncateUtf8(base, MAX_NAME_BYTES - new TextEncoder().encode('.fig').byteLength)
  return `${safeBase}.fig`
}

function conflictName(name: string, now: Date): string {
  const base = normalizeAliyunDriveFigName(name).slice(0, -4)
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '-')
  return normalizeAliyunDriveFigName(
    `${truncateUtf8(base, 900)} (conflict ${timestamp}).fig`
  )
}

function validateGeneratedDocumentId(value: string): string {
  const normalized = value.toLocaleLowerCase()
  if (normalized !== value || !DOCUMENT_ID_PATTERN.test(value)) {
    throw new AliyunDriveError(
      'invalid-response',
      'Aliyun Drive document ID generator returned a non-canonical UUID v4'
    )
  }
  return value
}

function isRevision(
  value: StorageRemoteRevision | null | undefined
): value is StorageRemoteRevision {
  if (!value || Object.keys(value).length !== 4) return false
  return (
    typeof value.fileId === 'string' &&
    value.fileId.length > 0 &&
    typeof value.contentHash === 'string' &&
    value.contentHash.length > 0 &&
    typeof value.updatedAt === 'string' &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    typeof value.size === 'string' &&
    /^(?:0|[1-9]\d*)$/.test(value.size)
  )
}

export function aliyunDriveRevisionsMatch(
  expected: StorageRemoteRevision | null | undefined,
  actual: StorageRemoteRevision | null | undefined
): boolean {
  return (
    isRevision(expected) &&
    isRevision(actual) &&
    expected.fileId === actual.fileId &&
    expected.contentHash === actual.contentHash &&
    expected.updatedAt === actual.updatedAt &&
    expected.size === actual.size
  )
}

function revisionFor(document: AliyunDriveDocumentFile): StorageRemoteRevision {
  return aliyunDriveRemoteRevisionFor(document.file)
}

function isWriteRace(error: unknown): boolean {
  return (
    error instanceof AliyunDriveError &&
    (error.code === 'conflict' ||
      error.code === 'precondition' ||
      error.status === 409 ||
      error.status === 412)
  )
}

function connectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Aliyun Drive connection failed'
}

export function createAliyunDriveStorageAdapter(
  client: AliyunDriveClientLike | AliyunDriveClient,
  options: AliyunDriveStorageAdapterOptions = {}
): AliyunDriveStorageAdapter {
  const now = options.now ?? (() => new Date())
  const createDocumentId = options.createDocumentId ?? (() => crypto.randomUUID())

  const reserveId = (): string => validateGeneratedDocumentId(createDocumentId())

  const distinctConflictId = (originalId: string): string => {
    let conflictDocumentId = reserveId()
    for (let attempt = 0; conflictDocumentId === originalId && attempt < 3; attempt++) {
      conflictDocumentId = reserveId()
    }
    if (conflictDocumentId === originalId) {
      throw new AliyunDriveError(
        'invalid-response',
        'Aliyun Drive could not reserve a conflict copy ID'
      )
    }
    return conflictDocumentId
  }

  const createConflictCopy = async (
    originalId: string,
    originalRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions,
    reservedId?: string
  ): Promise<StoragePutDocumentResult> => {
    const conflictDocumentId = reservedId ?? distinctConflictId(originalId)
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
    transfer: StoragePutDocumentOptions,
    reservedId?: string
  ): Promise<StoragePutDocumentResult> => {
    const latest = await client.getDocumentFile(id, {
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority
    })
    return createConflictCopy(
      id,
      latest ? revisionFor(latest) : null,
      bytes,
      metadata,
      transfer,
      reservedId
    )
  }

  return {
    async testConnection(connectionOptions): Promise<StorageConnectionResult> {
      try {
        await client.testConnection(connectionOptions?.signal)
        return { ok: true, message: 'Connected to Aliyun Drive.' }
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
          updatedAt: document.file.updatedAt,
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

      if (current && !aliyunDriveRevisionsMatch(expectedRevision, currentRevision)) {
        return createConflictCopy(id, currentRevision, bytes, metadata, transferOptions)
      }
      if (!current && expectedRevision !== undefined && expectedRevision !== null) {
        return createConflictCopy(id, null, bytes, metadata, transferOptions)
      }

      const uploadOptions: AliyunDriveUploadOptions = {
        documentId: id,
        name: normalizeAliyunDriveFigName(metadata.name),
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

      const conflictDocumentId = distinctConflictId(id)
      try {
        const replaced = await client.replaceDocument({
          ...uploadOptions,
          current,
          expectedRemoteRevision: revisionFor(current),
          conflictDocumentId,
          conflictName: conflictName(metadata.name, now())
        })
        if (replaced.outcome === 'updated') {
          return { outcome: 'updated', remoteRevision: replaced.remoteRevision }
        }
        return {
          outcome: 'conflict-copy',
          remoteRevision: replaced.remoteRevision,
          conflictDocumentId: replaced.conflictDocumentId,
          conflictCopyRevision: replaced.conflictCopyRevision
        }
      } catch (error) {
        if (!isWriteRace(error)) throw error
        return preserveWriteRace(
          id,
          bytes,
          metadata,
          transferOptions,
          conflictDocumentId
        )
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
        updatedAt: document.file.updatedAt,
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
