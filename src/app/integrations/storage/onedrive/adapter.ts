import {
  createConflictFigName,
  createDistinctDocumentIdReservation,
  createDocumentIdReservation,
  createStorageDocumentAdapterMethods,
  createStorageDocumentConflictCopyWriter,
  createStorageDocumentUploadOptions,
  createStorageDocumentWritePreparation,
  createStorageWriteRacePreserver,
  describeStorageDocument,
  isStorageWriteRace,
  normalizePortableFigBaseName,
  truncateCharacters,
  writeStorageDocumentOrPreserveRace
} from '../shared/adapter'
import type {
  StorageAdapter,
  StorageDocumentAuthority,
  StorageGetDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import type { OneDriveClient } from './client'
import { OneDriveError } from './errors'
import type { OneDriveDocumentFile, OneDriveUploadOptions, OneDriveUploadResult } from './types'

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

export function normalizeOneDriveFigName(input: string): string {
  const base = normalizePortableFigBaseName(input, {
    forbiddenCharacters: /["*/:<>?\\|#%]/,
    trimLeadingTildes: true,
    requiredError: () => new OneDriveError('invalid-input', 'OneDrive document name is required')
  })
  const safeBase = RESERVED_BASENAMES.test(base) ? `_${base}` : base
  return `${truncateCharacters(safeBase, 240)}.fig`
}

function conflictName(name: string, now: Date): string {
  return createConflictFigName(name, now, normalizeOneDriveFigName, (base) =>
    truncateCharacters(base, 190)
  )
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

const isOneDriveWriteRace = (error: unknown): boolean =>
  error instanceof OneDriveError && isStorageWriteRace(error)

export function createOneDriveStorageAdapter(
  client: OneDriveClientLike | OneDriveClient,
  options: OneDriveStorageAdapterOptions = {}
): OneDriveStorageAdapter {
  const now = options.now ?? (() => new Date())
  const reserveId = createDocumentIdReservation(
    options.createDocumentId ?? (() => crypto.randomUUID()),
    () =>
      new OneDriveError(
        'invalid-response',
        'OneDrive document ID generator returned a non-canonical UUID v4'
      )
  )
  const reserveConflictId = createDistinctDocumentIdReservation(
    reserveId,
    () => new OneDriveError('invalid-response', 'OneDrive could not reserve a conflict copy ID')
  )
  const createConflictCopy = createStorageDocumentConflictCopyWriter(
    (upload) => client.createDocument(upload),
    (originalId, reservedId) => reservedId ?? reserveConflictId(originalId),
    (name) => conflictName(name, now())
  )
  const prepareWrite = createStorageDocumentWritePreparation(
    client,
    revisionFor,
    oneDriveRevisionsMatch,
    createConflictCopy
  )
  const preserveWriteRace = createStorageWriteRacePreserver(client, revisionFor, createConflictCopy)
  const common = createStorageDocumentAdapterMethods(client, {
    providerName: 'OneDrive',
    reserveDocumentId: reserveId,
    describeDocument: (document) =>
      describeStorageDocument(
        document.documentId,
        document.file.name,
        document.file.lastModifiedDateTime,
        revisionFor(document)
      ),
    documentSize: (document) => document.file.size ?? 0
  })

  return {
    ...common,

    async putDocument(id, bytes, metadata, transferOptions = {}) {
      const prepared = await prepareWrite(id, bytes, metadata, transferOptions)
      if (prepared.conflictResult) return prepared.conflictResult
      const current = prepared.current
      const uploadOptions: OneDriveUploadOptions = createStorageDocumentUploadOptions(
        id,
        normalizeOneDriveFigName(metadata.name),
        bytes,
        transferOptions
      )

      if (!current) {
        return writeStorageDocumentOrPreserveRace(
          'created',
          () => client.createDocument(uploadOptions),
          isOneDriveWriteRace,
          () => preserveWriteRace(id, bytes, metadata, transferOptions)
        )
      }

      return writeStorageDocumentOrPreserveRace(
        'updated',
        () =>
          client.updateDocument({
            ...uploadOptions,
            itemId: current.file.id,
            expectedEtag: current.file.eTag ?? undefined
          }),
        isOneDriveWriteRace,
        () => preserveWriteRace(id, bytes, metadata, transferOptions)
      )
    },

    deleteDocument(id, deleteOptions) {
      return client.deleteDocumentFile(id, deleteOptions?.signal, deleteOptions?.expectedAuthority)
    }
  }
}
