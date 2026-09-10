import {
  createConflictFigName,
  createDistinctDocumentIdReservation,
  createDocumentIdReservation,
  createStorageConflictCopyResult,
  createStorageDocumentAdapterMethods,
  createStorageDocumentConflictCopyWriter,
  createStorageDocumentUploadOptions,
  createStorageDocumentWritePreparation,
  createStorageWriteRacePreserver,
  describeStorageDocument,
  isStorageWriteRace,
  normalizePortableFigBaseName,
  truncateUtf8,
  writeStorageDocumentOrPreserveRace
} from '../shared/adapter'
import type {
  StorageAdapter,
  StorageDocumentAuthority,
  StorageGetDocumentResult,
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

export function normalizeAliyunDriveFigName(input: string): string {
  const base = normalizePortableFigBaseName(input, {
    forbiddenCharacters: /\//,
    requiredError: () =>
      new AliyunDriveError('invalid-input', 'Aliyun Drive document name is required')
  })
  const safeBase = truncateUtf8(base, MAX_NAME_BYTES - new TextEncoder().encode('.fig').byteLength)
  return `${safeBase}.fig`
}

function conflictName(name: string, now: Date): string {
  return createConflictFigName(name, now, normalizeAliyunDriveFigName, (base) =>
    truncateUtf8(base, 900)
  )
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

const isAliyunDriveWriteRace = (error: unknown): boolean =>
  error instanceof AliyunDriveError && isStorageWriteRace(error)

export function createAliyunDriveStorageAdapter(
  client: AliyunDriveClientLike | AliyunDriveClient,
  options: AliyunDriveStorageAdapterOptions = {}
): AliyunDriveStorageAdapter {
  const now = options.now ?? (() => new Date())
  const reserveId = createDocumentIdReservation(
    options.createDocumentId ?? (() => crypto.randomUUID()),
    () =>
      new AliyunDriveError(
        'invalid-response',
        'Aliyun Drive document ID generator returned a non-canonical UUID v4'
      )
  )
  const distinctConflictId = createDistinctDocumentIdReservation(
    reserveId,
    () =>
      new AliyunDriveError('invalid-response', 'Aliyun Drive could not reserve a conflict copy ID')
  )
  const common = createStorageDocumentAdapterMethods(client, {
    providerName: 'Aliyun Drive',
    reserveDocumentId: reserveId,
    describeDocument: (document) =>
      describeStorageDocument(
        document.documentId,
        document.file.name,
        document.file.updatedAt,
        revisionFor(document)
      ),
    documentSize: (document) => document.file.size ?? 0
  })
  const createConflictCopy = createStorageDocumentConflictCopyWriter(
    (upload) => client.createDocument(upload),
    (originalId, reservedId) => reservedId ?? distinctConflictId(originalId),
    (name) => conflictName(name, now())
  )
  const prepareWrite = createStorageDocumentWritePreparation(
    client,
    revisionFor,
    aliyunDriveRevisionsMatch,
    createConflictCopy
  )
  const preserveWriteRace = createStorageWriteRacePreserver(client, revisionFor, createConflictCopy)

  return {
    ...common,

    async putDocument(id, bytes, metadata, transferOptions = {}) {
      const prepared = await prepareWrite(id, bytes, metadata, transferOptions)
      if (prepared.conflictResult) return prepared.conflictResult
      const current = prepared.current
      const uploadOptions: AliyunDriveUploadOptions = createStorageDocumentUploadOptions(
        id,
        normalizeAliyunDriveFigName(metadata.name),
        bytes,
        transferOptions
      )

      if (!current) {
        return writeStorageDocumentOrPreserveRace(
          'created',
          () => client.createDocument(uploadOptions),
          isAliyunDriveWriteRace,
          () => preserveWriteRace(id, bytes, metadata, transferOptions)
        )
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
        return createStorageConflictCopyResult(
          replaced.remoteRevision,
          replaced.conflictDocumentId,
          replaced.conflictCopyRevision
        )
      } catch (error) {
        if (!isAliyunDriveWriteRace(error)) throw error
        return preserveWriteRace(id, bytes, metadata, transferOptions, conflictDocumentId)
      }
    },

    deleteDocument(id, deleteOptions) {
      return client.deleteDocumentFile(id, deleteOptions?.signal, deleteOptions?.expectedAuthority)
    }
  }
}
