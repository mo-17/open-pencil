import {
  createConflictFigName,
  createDistinctDocumentIdReservation,
  createDocumentIdReservation,
  createStorageConflictCopyResult,
  createStorageDocumentAdapterMethods,
  createStorageDocumentWriteInspector,
  describeStorageDocument,
  normalizePortableFigBaseName,
  truncateCharacters
} from '../shared/adapter'
import type {
  StorageAdapter,
  StorageDocumentMetadata,
  StoragePutDocumentOptions,
  StoragePutDocumentResult,
  StorageRemoteRevision
} from '../types'
import {
  baiduNetdiskRemoteRevision,
  baiduNetdiskRevisionsMatch,
  type BaiduNetdiskClient
} from './client'
import { BaiduNetdiskError } from './errors'
import type { BaiduNetdiskClientContract, BaiduNetdiskDocumentFile } from './types'

export type BaiduNetdiskClientLike = BaiduNetdiskClientContract

export type BaiduNetdiskStorageAdapterOptions = Readonly<{
  now?: () => Date
  createDocumentId?: () => string
}>

export type BaiduNetdiskStorageAdapter = StorageAdapter

export function normalizeBaiduNetdiskFigName(input: string): string {
  const base = normalizePortableFigBaseName(input, {
    forbiddenCharacters: /[\\/]/,
    requiredError: () =>
      new BaiduNetdiskError('invalid-input', 'Baidu Netdisk document name is required')
  })
  return `${truncateCharacters(base, 220)}.fig`
}

function conflictName(name: string, now: Date): string {
  return createConflictFigName(name, now, normalizeBaiduNetdiskFigName, (base) =>
    truncateCharacters(base, 170)
  )
}

function isTerminalAuthorizationError(error: unknown): boolean {
  return (
    error instanceof BaiduNetdiskError &&
    ['aborted', 'auth', 'authorization-changed'].includes(error.code)
  )
}

export function createBaiduNetdiskStorageAdapter(
  client: BaiduNetdiskClientLike | BaiduNetdiskClient,
  options: BaiduNetdiskStorageAdapterOptions = {}
): BaiduNetdiskStorageAdapter {
  const now = options.now ?? (() => new Date())
  const reserveId = createDocumentIdReservation(
    options.createDocumentId ?? (() => crypto.randomUUID()),
    () =>
      new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk document ID generator returned a non-canonical UUID v4'
      )
  )
  const reserveDistinctId = createDistinctDocumentIdReservation(
    reserveId,
    () =>
      new BaiduNetdiskError(
        'invalid-response',
        'Baidu Netdisk could not reserve a distinct staging document ID'
      )
  )
  const common = createStorageDocumentAdapterMethods(client, {
    providerName: 'Baidu Netdisk',
    reserveDocumentId: reserveId,
    describeDocument: (document) =>
      describeStorageDocument(
        document.documentId,
        document.name,
        new Date(document.item.serverMtime * 1_000).toISOString(),
        baiduNetdiskRemoteRevision(document)
      ),
    documentSize: (document) => document.item.size
  })
  const inspectWrite = createStorageDocumentWriteInspector(
    client,
    baiduNetdiskRemoteRevision,
    baiduNetdiskRevisionsMatch
  )

  const uploadConflict = async (
    originalId: string,
    originalRevision: StorageRemoteRevision | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult> => {
    const conflictDocumentId = reserveDistinctId(originalId)
    const uploaded = await client.uploadDocument({
      documentId: conflictDocumentId,
      name: conflictName(metadata.name, now()),
      bytes,
      updatedAt: metadata.updatedAt,
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority,
      onProgress: transfer.onProgress
    })
    return createStorageConflictCopyResult(
      originalRevision,
      conflictDocumentId,
      uploaded.remoteRevision
    )
  }

  const stagedWrite = async (
    documentId: string,
    current: BaiduNetdiskDocumentFile | null,
    bytes: Uint8Array,
    metadata: StorageDocumentMetadata,
    transfer: StoragePutDocumentOptions
  ): Promise<StoragePutDocumentResult> => {
    const stagingId = reserveDistinctId(documentId)
    const staged = await client.uploadDocument({
      documentId: stagingId,
      name: conflictName(metadata.name, now()),
      bytes,
      updatedAt: metadata.updatedAt,
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority,
      onProgress: transfer.onProgress
    })
    const conflictResult = (
      remoteRevision: StorageRemoteRevision | null
    ): StoragePutDocumentResult =>
      createStorageConflictCopyResult(remoteRevision, stagingId, staged.remoteRevision)

    const latest = await client.getDocumentFile(documentId, {
      signal: transfer.signal,
      expectedAuthority: transfer.expectedAuthority
    })
    if (current) {
      const expected = baiduNetdiskRemoteRevision(current)
      const actual = latest ? baiduNetdiskRemoteRevision(latest) : null
      if (!baiduNetdiskRevisionsMatch(expected, actual)) return conflictResult(actual)
      try {
        await client.trashDocumentFile(current, expected, {
          signal: transfer.signal,
          expectedAuthority: transfer.expectedAuthority
        })
      } catch (error) {
        if (isTerminalAuthorizationError(error)) throw error
        const afterFailure = await client.getDocumentFile(documentId, {
          signal: transfer.signal,
          expectedAuthority: transfer.expectedAuthority
        })
        return conflictResult(afterFailure ? baiduNetdiskRemoteRevision(afterFailure) : null)
      }
    } else if (latest) {
      return conflictResult(baiduNetdiskRemoteRevision(latest))
    }

    const promoted = await client.promoteDocumentFile(
      staged.document,
      documentId,
      normalizeBaiduNetdiskFigName(metadata.name),
      {
        signal: transfer.signal,
        expectedAuthority: transfer.expectedAuthority
      }
    )
    if (promoted.outcome === 'preserved') {
      const raced = await client.getDocumentFile(documentId, {
        signal: transfer.signal,
        expectedAuthority: transfer.expectedAuthority
      })
      return conflictResult(raced ? baiduNetdiskRemoteRevision(raced) : null)
    }
    return {
      outcome: current ? 'updated' : 'created',
      remoteRevision: baiduNetdiskRemoteRevision(promoted.document)
    }
  }

  return {
    ...common,

    async putDocument(id, bytes, metadata, transferOptions = {}) {
      const { current, conflict } = await inspectWrite(id, transferOptions)
      if (conflict) {
        return uploadConflict(id, conflict.remoteRevision, bytes, metadata, transferOptions)
      }
      return stagedWrite(id, current, bytes, metadata, transferOptions)
    },

    async deleteDocument(id, deleteOptions) {
      const current = await client.getDocumentFile(id, {
        signal: deleteOptions?.signal,
        expectedAuthority: deleteOptions?.expectedAuthority
      })
      if (!current) return
      await client.trashDocumentFile(current, baiduNetdiskRemoteRevision(current), {
        signal: deleteOptions?.signal,
        expectedAuthority: deleteOptions?.expectedAuthority
      })
    }
  }
}
