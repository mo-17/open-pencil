import { describe, expect, test } from 'bun:test'

import {
  aliyunDriveRevisionsMatch,
  createAliyunDriveStorageAdapter,
  normalizeAliyunDriveFigName,
  type AliyunDriveClientLike
} from '@/app/integrations/storage/aliyun-drive/adapter'
import { AliyunDriveError } from '@/app/integrations/storage/aliyun-drive/errors'
import type {
  AliyunDriveDocumentFile,
  AliyunDriveItem,
  AliyunDriveReplacementOptions,
  AliyunDriveUploadOptions,
  AliyunDriveUploadResult
} from '@/app/integrations/storage/aliyun-drive/types'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const CONFLICT_ID = '22222222-2222-4222-8222-222222222222'
const AUTHORITY = { accountId: 'aliyun-user', authorizationVersion: 'grant-1' }

function item(
  fileId: string,
  name: string,
  overrides: Partial<AliyunDriveItem> = {}
): AliyunDriveItem {
  return {
    driveId: 'drive-1',
    fileId,
    parentFileId: 'parent',
    name,
    type: 'file',
    size: 3,
    contentHash: `sha1-${fileId}`,
    createdAt: '2026-08-26T01:02:03.000Z',
    updatedAt: '2026-08-26T01:02:03.000Z',
    ...overrides
  }
}

function document(
  fileId = 'file-1',
  contentHash = 'sha1-v1',
  documentId = DOCUMENT_ID,
  updatedAt = '2026-08-26T01:02:03.000Z'
): AliyunDriveDocumentFile {
  const folder = item('folder-1', documentId, {
    type: 'folder',
    size: null,
    contentHash: null,
    parentFileId: 'documents-folder'
  })
  const file = item(fileId, '惊悚.fig', {
    contentHash,
    updatedAt,
    parentFileId: folder.fileId
  })
  return { documentId, folder, file }
}

function revision(value: AliyunDriveDocumentFile) {
  return {
    fileId: value.file.fileId,
    contentHash: value.file.contentHash ?? '',
    updatedAt: value.file.updatedAt,
    size: String(value.file.size)
  }
}

function uploaded(fileId: string, contentHash: string): AliyunDriveUploadResult {
  const value = document(fileId, contentHash)
  return { item: value.file, remoteRevision: revision(value) }
}

function fakeClient(overrides: Partial<AliyunDriveClientLike> = {}): AliyunDriveClientLike {
  return {
    getAuthority: () => Promise.resolve(AUTHORITY),
    testConnection: () => Promise.resolve(),
    listDocuments: () => Promise.resolve([]),
    getDocumentFile: () => Promise.resolve(null),
    downloadDocument: () => Promise.reject(new Error('not implemented')),
    createDocument: () => Promise.reject(new Error('not implemented')),
    replaceDocument: () => Promise.reject(new Error('not implemented')),
    deleteDocumentFile: () => Promise.resolve(),
    ...overrides
  }
}

describe('AliyunDriveStorageAdapter', () => {
  test('normalizes names within Aliyun UTF-8 limits', () => {
    expect(normalizeAliyunDriveFigName(' 惊/悚 ')).toBe('惊-悚.fig')
    const long = normalizeAliyunDriveFigName('界'.repeat(1_000))
    expect(new TextEncoder().encode(long).byteLength).toBeLessThanOrEqual(1_024)
    expect(long.endsWith('.fig')).toBe(true)
  })

  test('requires all four revision fields to match exactly', () => {
    const current = revision(document())
    expect(aliyunDriveRevisionsMatch(current, { ...current })).toBe(true)
    expect(aliyunDriveRevisionsMatch(current, { ...current, contentHash: 'changed' })).toBe(false)
    expect(aliyunDriveRevisionsMatch(current, { ...current, extra: 'untrusted' })).toBe(false)
  })

  test('creates a new UUID-folder document', async () => {
    let captured: AliyunDriveUploadOptions | null = null
    const client = fakeClient({
      createDocument(options) {
        captured = options
        return Promise.resolve(uploaded('created-file', 'sha1-created'))
      }
    })
    const adapter = createAliyunDriveStorageAdapter(client)
    const bytes = new Uint8Array([1, 2, 3])

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      bytes,
      { name: '惊悚', updatedAt: '2026-08-26T01:02:03.000Z' },
      { expectedRemoteRevision: null, expectedAuthority: AUTHORITY }
    )

    expect(result).toEqual({
      outcome: 'created',
      remoteRevision: {
        fileId: 'created-file',
        contentHash: 'sha1-created',
        updatedAt: '2026-08-26T01:02:03.000Z',
        size: '3'
      }
    })
    expect(captured).toMatchObject({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes,
      expectedAuthority: AUTHORITY
    })
  })

  test('passes an exact revision and pre-reserved conflict folder to conservative replacement', async () => {
    const current = document()
    let captured: AliyunDriveReplacementOptions | null = null
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      replaceDocument(options) {
        captured = options
        return Promise.resolve({
          outcome: 'updated',
          item: document('file-2', 'sha1-v2').file,
          remoteRevision: revision(document('file-2', 'sha1-v2'))
        })
      }
    })
    const adapter = createAliyunDriveStorageAdapter(client, {
      createDocumentId: () => CONFLICT_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([4, 5, 6]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T02:00:00.000Z' },
      { expectedRemoteRevision: revision(current) }
    )

    expect(result.outcome).toBe('updated')
    expect(captured).toMatchObject({
      current,
      expectedRemoteRevision: revision(current),
      conflictDocumentId: CONFLICT_ID
    })
  })

  test('never invokes replacement when the remote revision differs', async () => {
    const creates: AliyunDriveUploadOptions[] = []
    let replacementCalls = 0
    const current = document()
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      replaceDocument() {
        replacementCalls += 1
        return Promise.reject(new Error('must not run'))
      },
      createDocument(options) {
        creates.push(options)
        return Promise.resolve(uploaded('conflict-file', 'sha1-conflict'))
      }
    })
    const adapter = createAliyunDriveStorageAdapter(client, {
      now: () => new Date('2026-08-26T03:04:05.000Z'),
      createDocumentId: () => CONFLICT_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([7, 8, 9]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T03:04:05.000Z' },
      { expectedRemoteRevision: { ...revision(current), contentHash: 'stale' } }
    )

    expect(replacementCalls).toBe(0)
    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      remoteRevision: revision(current),
      conflictDocumentId: CONFLICT_ID
    })
    expect(creates[0]?.documentId).toBe(CONFLICT_ID)
    expect(creates[0]?.name).toContain('conflict 2026-08-26 03-04-05')
  })

  test('turns a pre-upload replacement race into a separate conflict copy', async () => {
    let lookup = 0
    const creates: AliyunDriveUploadOptions[] = []
    const client = fakeClient({
      getDocumentFile() {
        lookup += 1
        return Promise.resolve(
          lookup === 1
            ? document()
            : document('file-2', 'sha1-v2', DOCUMENT_ID, '2026-08-26T02:00:00.000Z')
        )
      },
      replaceDocument: () =>
        Promise.reject(new AliyunDriveError('precondition', 'changed', { status: 412 })),
      createDocument(options) {
        creates.push(options)
        return Promise.resolve(uploaded('conflict-file', 'sha1-conflict'))
      }
    })
    const adapter = createAliyunDriveStorageAdapter(client, {
      createDocumentId: () => CONFLICT_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([1, 2, 3]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T03:04:05.000Z' },
      { expectedRemoteRevision: revision(document()) }
    )

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      remoteRevision: revision(
        document('file-2', 'sha1-v2', DOCUMENT_ID, '2026-08-26T02:00:00.000Z')
      ),
      conflictDocumentId: CONFLICT_ID
    })
    expect(creates).toHaveLength(1)
  })

  test('forwards delete as trash-scoped client operation under the exact authority', async () => {
    const calls: unknown[][] = []
    const client = fakeClient({
      deleteDocumentFile(...args) {
        calls.push(args)
        return Promise.resolve()
      }
    })
    const adapter = createAliyunDriveStorageAdapter(client)

    await adapter.deleteDocument(DOCUMENT_ID, { expectedAuthority: AUTHORITY })

    expect(calls).toEqual([[DOCUMENT_ID, undefined, AUTHORITY]])
  })
})
