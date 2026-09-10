import type {
  StorageAdapter,
  StorageDocument,
  StorageDocumentAuthority,
  StorageDocumentMetadata,
  StorageGetDocumentResult,
  StoragePutDocumentOptions,
  StoragePutDocumentResult,
  StorageRemoteRevision,
  StorageTransferOptions
} from '../types'
import type { StorageProviderError } from './errors'

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function truncateCharacters(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join('')
}

export function truncateUtf8(value: string, maxBytes: number): string {
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

export function normalizePortableFigBaseName(
  input: string,
  options: Readonly<{
    forbiddenCharacters: RegExp
    trimLeadingTildes?: boolean
    requiredError: () => Error
  }>
): string {
  let cleaned = Array.from(input.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || options.forbiddenCharacters.test(character)
      ? '-'
      : character
  })
    .join('')
    .replace(/-+/g, '-')
    .replace(/[. ]+$/g, '')
  if (options.trimLeadingTildes) cleaned = cleaned.replace(/^~+/, '')
  const withoutExtension = cleaned.toLocaleLowerCase().endsWith('.fig')
    ? cleaned.slice(0, -4)
    : cleaned
  const base = withoutExtension.trim().replace(/[. ]+$/g, '')
  if (!base) throw options.requiredError()
  return base
}

export function createConflictFigName(
  name: string,
  now: Date,
  normalize: (value: string) => string,
  truncateBase: (base: string) => string
): string {
  const base = normalize(name).slice(0, -4)
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '-')
  return normalize(`${truncateBase(base)} (conflict ${timestamp}).fig`)
}

export function createDocumentIdReservation(
  createDocumentId: () => string,
  invalidIdError: () => Error
): () => string {
  return () => {
    const value = createDocumentId()
    if (!DOCUMENT_ID_PATTERN.test(value)) throw invalidIdError()
    return value
  }
}

export function createDistinctDocumentIdReservation(
  reserveDocumentId: () => string,
  exhaustedError: () => Error
): (originalId: string) => string {
  return (originalId) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = reserveDocumentId()
      if (candidate !== originalId) return candidate
    }
    throw exhaustedError()
  }
}

type DocumentLookupOptions = Pick<StorageTransferOptions, 'signal' | 'expectedAuthority'>

export interface StorageDocumentClient<RemoteDocument> {
  getAuthority(signal?: AbortSignal): Promise<StorageDocumentAuthority | null>
  testConnection(signal?: AbortSignal): Promise<void>
  listDocuments(signal?: AbortSignal): Promise<RemoteDocument[]>
  getDocumentFile(
    documentId: string,
    options?: DocumentLookupOptions
  ): Promise<RemoteDocument | null>
  downloadDocument(
    documentId: string,
    options?: StorageTransferOptions
  ): Promise<StorageGetDocumentResult>
}

type DocumentDescription = Readonly<{
  id: string
  name: string
  updatedAt: string
  remoteRevision: StorageRemoteRevision | null
}>

export function describeStorageDocument(
  id: string,
  name: string,
  updatedAt: string,
  remoteRevision: StorageRemoteRevision | null
): DocumentDescription {
  return { id, name, updatedAt, remoteRevision }
}

type CommonStorageAdapterMethods = Pick<
  StorageAdapter,
  | 'getAuthority'
  | 'getDocument'
  | 'getDocumentMetadata'
  | 'getUsage'
  | 'listDocuments'
  | 'reserveDocumentId'
  | 'testConnection'
>

export function createStorageDocumentAdapterMethods<RemoteDocument>(
  client: StorageDocumentClient<RemoteDocument>,
  options: Readonly<{
    providerName: string
    reserveDocumentId: (
      options?: Pick<StorageTransferOptions, 'signal' | 'expectedAuthority'>
    ) => string | Promise<string>
    describeDocument: (document: RemoteDocument) => DocumentDescription
    documentSize: (document: RemoteDocument) => number
    acceptMetadataDocument?: (document: RemoteDocument) => boolean
  }>
): CommonStorageAdapterMethods {
  return {
    async testConnection(connectionOptions) {
      try {
        await client.testConnection(connectionOptions?.signal)
        return { ok: true, message: `Connected to ${options.providerName}.` }
      } catch (error) {
        const fallback = `${options.providerName} connection failed`
        return { ok: false, message: error instanceof Error ? error.message : fallback }
      }
    },

    getAuthority(authorityOptions) {
      return client.getAuthority(authorityOptions?.signal)
    },

    async listDocuments(listOptions) {
      const documents = await client.listDocuments(listOptions?.signal)
      return documents.map((document): StorageDocument => {
        const description = options.describeDocument(document)
        return { ...description, metadataAuthoritative: true }
      })
    },

    async reserveDocumentId(reserveOptions) {
      return options.reserveDocumentId(reserveOptions)
    },

    getDocument(id, transferOptions) {
      return client.downloadDocument(id, transferOptions)
    },

    async getDocumentMetadata(id, metadataOptions) {
      const document = await client.getDocumentFile(id, metadataOptions)
      if (!document || options.acceptMetadataDocument?.(document) === false) return null
      const { name, updatedAt, remoteRevision } = options.describeDocument(document)
      return { name, updatedAt, remoteRevision }
    },

    async getUsage(usageOptions) {
      const documents = await client.listDocuments(usageOptions?.signal)
      return {
        bytesUsed: documents.reduce((total, document) => total + options.documentSize(document), 0),
        objectCount: documents.length,
        documentCount: documents.length
      }
    }
  }
}

export function storageRevisionConflict<RemoteDocument>(
  current: RemoteDocument | null,
  expected: StorageRemoteRevision | null | undefined,
  revisionFor: (document: RemoteDocument) => StorageRemoteRevision | null,
  revisionsMatch: (
    expected: StorageRemoteRevision | null | undefined,
    actual: StorageRemoteRevision | null | undefined
  ) => boolean
): Readonly<{ remoteRevision: StorageRemoteRevision | null }> | null {
  if (current) {
    const remoteRevision = revisionFor(current)
    return revisionsMatch(expected, remoteRevision) ? null : { remoteRevision }
  }
  return expected === undefined || expected === null ? null : { remoteRevision: null }
}

export function createStorageDocumentWriteInspector<RemoteDocument>(
  client: Pick<StorageDocumentClient<RemoteDocument>, 'getDocumentFile'>,
  revisionFor: (document: RemoteDocument) => StorageRemoteRevision | null,
  revisionsMatch: (
    expected: StorageRemoteRevision | null | undefined,
    actual: StorageRemoteRevision | null | undefined
  ) => boolean
): (
  id: string,
  transfer: StoragePutDocumentOptions
) => Promise<
  Readonly<{
    current: RemoteDocument | null
    conflict: Readonly<{ remoteRevision: StorageRemoteRevision | null }> | null
  }>
> {
  return async (id, transfer) => {
    const current = await client.getDocumentFile(id, {
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority
    })
    return {
      current,
      conflict: storageRevisionConflict(
        current,
        transfer.expectedRemoteRevision,
        revisionFor,
        revisionsMatch
      )
    }
  }
}

export function createStorageDocumentWritePreparation<RemoteDocument>(
  client: Pick<StorageDocumentClient<RemoteDocument>, 'getDocumentFile'>,
  revisionFor: (document: RemoteDocument) => StorageRemoteRevision | null,
  revisionsMatch: (
    expected: StorageRemoteRevision | null | undefined,
    actual: StorageRemoteRevision | null | undefined
  ) => boolean,
  createConflictCopy: (
    id: string,
    remoteRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ) => Promise<StoragePutDocumentResult>
): (
  id: string,
  bytes: Uint8Array,
  metadata: StorageDocumentMetadata,
  transfer: StoragePutDocumentOptions
) => Promise<
  Readonly<{
    current: RemoteDocument | null
    conflictResult: StoragePutDocumentResult | null
  }>
> {
  const inspectWrite = createStorageDocumentWriteInspector(client, revisionFor, revisionsMatch)
  return async (id, bytes, metadata, transfer) => {
    const { current, conflict } = await inspectWrite(id, transfer)
    return {
      current,
      conflictResult: conflict
        ? await createConflictCopy(id, conflict.remoteRevision, bytes, metadata, transfer)
        : null
    }
  }
}

export function createStorageConflictCopyResult(
  remoteRevision: StorageRemoteRevision | null,
  conflictDocumentId: string,
  conflictCopyRevision: StorageRemoteRevision | null
): StoragePutDocumentResult {
  return {
    outcome: 'conflict-copy',
    remoteRevision,
    conflictDocumentId,
    conflictCopyRevision
  }
}

type StorageConflictDocumentUpload = Readonly<{
  documentId: string
  name: string
  bytes: Uint8Array
  signal?: AbortSignal
  expectedAuthority?: StorageDocumentAuthority
  onProgress?: StorageTransferOptions['onProgress']
}>

export function createStorageDocumentUploadOptions(
  documentId: string,
  name: string,
  bytes: Uint8Array,
  transfer: StoragePutDocumentOptions
): StorageConflictDocumentUpload {
  return {
    documentId,
    name,
    bytes,
    signal: transfer.signal,
    onProgress: transfer.onProgress,
    expectedAuthority: transfer.expectedAuthority
  }
}

type StorageConflictCopyWriter = (
  originalId: string,
  originalRevision: StorageRemoteRevision | null,
  bytes: Uint8Array,
  metadata: StorageDocumentMetadata,
  transfer: StoragePutDocumentOptions,
  reservedId?: string
) => Promise<StoragePutDocumentResult>

export function createStorageDocumentConflictCopyWriter(
  createDocument: (
    options: StorageConflictDocumentUpload
  ) => Promise<Readonly<{ remoteRevision: StorageRemoteRevision | null }>>,
  reserveDocumentId: (originalId: string, reservedId?: string) => string | Promise<string>,
  conflictName: (name: string) => string
): StorageConflictCopyWriter {
  return async (originalId, originalRevision, bytes, metadata, transfer, reservedId) => {
    const conflictDocumentId = await reserveDocumentId(originalId, reservedId)
    const uploaded = await createDocument({
      documentId: conflictDocumentId,
      name: conflictName(metadata.name),
      bytes,
      signal: transfer.signal,
      onProgress: transfer.onProgress,
      expectedAuthority: transfer.expectedAuthority
    })
    return createStorageConflictCopyResult(
      originalRevision,
      conflictDocumentId,
      uploaded.remoteRevision
    )
  }
}

export function isStorageWriteRace(error: StorageProviderError<string>): boolean {
  return (
    error.code === 'conflict' ||
    error.code === 'precondition' ||
    error.status === 409 ||
    error.status === 412
  )
}

export async function writeStorageDocumentOrPreserveRace(
  outcome: 'created' | 'updated',
  write: () => Promise<Readonly<{ remoteRevision: StorageRemoteRevision | null }>>,
  isWriteRace: (error: unknown) => boolean,
  preserveRace: () => Promise<StoragePutDocumentResult>
): Promise<StoragePutDocumentResult> {
  try {
    const result = await write()
    return { outcome, remoteRevision: result.remoteRevision }
  } catch (error) {
    if (!isWriteRace(error)) throw error
    return preserveRace()
  }
}

export function createStorageWriteRacePreserver<RemoteDocument, Extra extends readonly unknown[]>(
  client: Pick<StorageDocumentClient<RemoteDocument>, 'getDocumentFile'>,
  revisionFor: (document: RemoteDocument) => StorageRemoteRevision | null,
  createConflictCopy: (
    id: string,
    remoteRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions,
    ...extra: Extra
  ) => Promise<StoragePutDocumentResult>
): (
  id: string,
  bytes: Uint8Array,
  metadata: StorageDocumentMetadata,
  transfer: StoragePutDocumentOptions,
  ...extra: Extra
) => Promise<StoragePutDocumentResult> {
  return async (id, bytes, metadata, transfer, ...extra) => {
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
      ...extra
    )
  }
}
