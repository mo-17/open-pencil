import type {
  StorageAdapter,
  StorageConnectionResult,
  StorageDocument,
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

const DOCUMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export type BaiduNetdiskClientLike = BaiduNetdiskClientContract

export type BaiduNetdiskStorageAdapterOptions = Readonly<{
  now?: () => Date
  createDocumentId?: () => string
}>

export type BaiduNetdiskStorageAdapter = StorageAdapter

function truncateCharacters(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join('')
}

export function normalizeBaiduNetdiskFigName(input: string): string {
  const cleaned = Array.from(input.trim(), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || /[\\/]/.test(character) ? '-' : character
  })
    .join('')
    .replace(/-+/g, '-')
    .replace(/[. ]+$/g, '')
  const withoutExtension = cleaned.toLocaleLowerCase().endsWith('.fig')
    ? cleaned.slice(0, -4)
    : cleaned
  const base = withoutExtension.trim().replace(/[. ]+$/g, '')
  if (!base) {
    throw new BaiduNetdiskError('invalid-input', 'Baidu Netdisk document name is required')
  }
  return `${truncateCharacters(base, 220)}.fig`
}

function conflictName(name: string, now: Date): string {
  const base = normalizeBaiduNetdiskFigName(name).slice(0, -4)
  const timestamp = now.toISOString().replace('T', ' ').slice(0, 19).replace(/:/g, '-')
  return normalizeBaiduNetdiskFigName(
    `${truncateCharacters(base, 170)} (conflict ${timestamp}).fig`
  )
}

function validateGeneratedDocumentId(value: string): string {
  if (!DOCUMENT_ID_PATTERN.test(value)) {
    throw new BaiduNetdiskError(
      'invalid-response',
      'Baidu Netdisk document ID generator returned a non-canonical UUID v4'
    )
  }
  return value
}

function connectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Baidu Netdisk connection failed'
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
  const createDocumentId = options.createDocumentId ?? (() => crypto.randomUUID())

  const reserveId = (): string => validateGeneratedDocumentId(createDocumentId())

  const reserveDistinctId = (documentId: string): string => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const candidate = reserveId()
      if (candidate !== documentId) return candidate
    }
    throw new BaiduNetdiskError(
      'invalid-response',
      'Baidu Netdisk could not reserve a distinct staging document ID'
    )
  }

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
    return {
      outcome: 'conflict-copy',
      remoteRevision: originalRevision,
      conflictDocumentId,
      conflictCopyRevision: uploaded.remoteRevision
    }
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
    ): StoragePutDocumentResult => ({
      outcome: 'conflict-copy',
      remoteRevision,
      conflictDocumentId: stagingId,
      conflictCopyRevision: staged.remoteRevision
    })

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
    async testConnection(connectionOptions): Promise<StorageConnectionResult> {
      try {
        await client.testConnection(connectionOptions?.signal)
        return { ok: true, message: 'Connected to Baidu Netdisk.' }
      } catch (error) {
        return { ok: false, message: connectionMessage(error) }
      }
    },

    getAuthority(authorityOptions) {
      return client.getAuthority(authorityOptions?.signal)
    },

    async listDocuments(listOptions) {
      const documents = await client.listDocuments(listOptions?.signal)
      return documents.map(
        (document): StorageDocument => ({
          id: document.documentId,
          name: document.name,
          updatedAt: new Date(document.item.serverMtime * 1_000).toISOString(),
          remoteRevision: baiduNetdiskRemoteRevision(document),
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
      const actualRevision = current ? baiduNetdiskRemoteRevision(current) : null
      const expectedRevision = transferOptions.expectedRemoteRevision

      if (current && !baiduNetdiskRevisionsMatch(expectedRevision, actualRevision)) {
        return uploadConflict(id, actualRevision, bytes, metadata, transferOptions)
      }
      if (!current && expectedRevision !== undefined && expectedRevision !== null) {
        return uploadConflict(id, null, bytes, metadata, transferOptions)
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
    },

    async getDocumentMetadata(id, metadataOptions) {
      const document = await client.getDocumentFile(id, {
        signal: metadataOptions?.signal,
        expectedAuthority: metadataOptions?.expectedAuthority
      })
      if (!document) return null
      return {
        name: document.name,
        updatedAt: new Date(document.item.serverMtime * 1_000).toISOString(),
        remoteRevision: baiduNetdiskRemoteRevision(document)
      }
    },

    async getUsage(usageOptions) {
      const documents = await client.listDocuments(usageOptions?.signal)
      return {
        bytesUsed: documents.reduce((total, document) => total + document.item.size, 0),
        objectCount: documents.length,
        documentCount: documents.length
      }
    }
  }
}
