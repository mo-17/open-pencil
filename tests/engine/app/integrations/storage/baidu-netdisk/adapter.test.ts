import { describe, expect, test } from 'bun:test'

import {
  createBaiduNetdiskStorageAdapter,
  normalizeBaiduNetdiskFigName
} from '@/app/integrations/storage/baidu-netdisk/adapter'
import { baiduNetdiskRemoteRevision } from '@/app/integrations/storage/baidu-netdisk/client'
import { BAIDU_NETDISK_APP_ROOT } from '@/app/integrations/storage/baidu-netdisk/config'
import type {
  BaiduNetdiskClientContract,
  BaiduNetdiskDocumentFile,
  BaiduNetdiskUploadOptions
} from '@/app/integrations/storage/baidu-netdisk/types'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const STAGING_ID = '22222222-2222-4222-8222-222222222222'
const AUTHORITY = { accountId: '208281036', authorizationVersion: 'grant-1' }

function document(
  documentId = DOCUMENT_ID,
  fsId = '10000000000000001',
  md5 = '0123456789abcdef0123456789abcdef',
  name = '惊悚.fig'
): BaiduNetdiskDocumentFile {
  const serverFilename = `${documentId}--${name}`
  return {
    documentId,
    name,
    item: {
      fsId,
      path: `${BAIDU_NETDISK_APP_ROOT}/${serverFilename}`,
      serverFilename,
      size: 3,
      isDirectory: false,
      serverMtime: 1_777_000_000,
      md5
    }
  }
}

function fakeClient(
  overrides: Partial<BaiduNetdiskClientContract> = {}
): BaiduNetdiskClientContract {
  return {
    getAuthority: () => Promise.resolve(AUTHORITY),
    testConnection: () => Promise.resolve(),
    listDocuments: () => Promise.resolve([]),
    getDocumentFile: () => Promise.resolve(null),
    downloadDocument: () => Promise.reject(new Error('not implemented')),
    uploadDocument: () => Promise.reject(new Error('not implemented')),
    promoteDocumentFile: () => Promise.reject(new Error('not implemented')),
    trashDocumentFile: () => Promise.resolve(),
    ...overrides
  }
}

describe('BaiduNetdiskStorageAdapter', () => {
  test('normalizes a user-visible fig name without allowing path separators', () => {
    expect(normalizeBaiduNetdiskFigName(' 惊/悚\\设计 ')).toBe('惊-悚-设计.fig')
  })

  test('preserves an initial revision mismatch as a separate conflict document', async () => {
    const current = document()
    const uploads: BaiduNetdiskUploadOptions[] = []
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      uploadDocument(options) {
        uploads.push(options)
        const saved = document(options.documentId, '20000000000000002', undefined, options.name)
        return Promise.resolve({
          document: saved,
          remoteRevision: baiduNetdiskRemoteRevision(saved)
        })
      }
    })
    const adapter = createBaiduNetdiskStorageAdapter(client, {
      now: () => new Date('2026-08-26T03:04:05.000Z'),
      createDocumentId: () => STAGING_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([1, 2, 3]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T03:04:05.000Z' },
      { expectedRemoteRevision: { ...baiduNetdiskRemoteRevision(current), md5: 'stale' } }
    )

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      conflictDocumentId: STAGING_ID,
      remoteRevision: baiduNetdiskRemoteRevision(current)
    })
    expect(uploads[0]?.documentId).toBe(STAGING_ID)
    expect(uploads[0]?.name).toContain('conflict 2026-08-26 03-04-05')
  })

  test('updates by staging first, rechecking, trashing exact old revision, then promoting', async () => {
    const current = document()
    const staged = document(STAGING_ID, '20000000000000002', undefined, 'staged.fig')
    const promoted = document(DOCUMENT_ID, staged.item.fsId, 'abcdefabcdefabcdefabcdefabcdefab')
    const events: string[] = []
    let lookups = 0
    const client = fakeClient({
      getDocumentFile: () => {
        lookups += 1
        events.push(`lookup-${lookups}`)
        return Promise.resolve(current)
      },
      uploadDocument() {
        events.push('upload-staging')
        return Promise.resolve({
          document: staged,
          remoteRevision: baiduNetdiskRemoteRevision(staged)
        })
      },
      trashDocumentFile(_document, revision) {
        events.push('trash-old')
        expect(revision).toEqual(baiduNetdiskRemoteRevision(current))
        return Promise.resolve()
      },
      promoteDocumentFile() {
        events.push('promote-staging')
        return Promise.resolve({ outcome: 'promoted', document: promoted })
      }
    })
    const adapter = createBaiduNetdiskStorageAdapter(client, {
      createDocumentId: () => STAGING_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([4, 5, 6]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T04:00:00.000Z' },
      { expectedRemoteRevision: baiduNetdiskRemoteRevision(current), expectedAuthority: AUTHORITY }
    )

    expect(result).toEqual({
      outcome: 'updated',
      remoteRevision: baiduNetdiskRemoteRevision(promoted)
    })
    expect(events).toEqual([
      'lookup-1',
      'upload-staging',
      'lookup-2',
      'trash-old',
      'promote-staging'
    ])
  })

  test('keeps the staged bytes as a conflict copy when promotion races', async () => {
    const current = document()
    const staged = document(STAGING_ID, '20000000000000002', undefined, 'staged.fig')
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      uploadDocument: () =>
        Promise.resolve({ document: staged, remoteRevision: baiduNetdiskRemoteRevision(staged) }),
      promoteDocumentFile: () => Promise.resolve({ outcome: 'preserved', document: staged })
    })
    const adapter = createBaiduNetdiskStorageAdapter(client, {
      createDocumentId: () => STAGING_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([7, 8, 9]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T04:00:00.000Z' },
      { expectedRemoteRevision: baiduNetdiskRemoteRevision(current) }
    )

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      conflictDocumentId: STAGING_ID,
      conflictCopyRevision: baiduNetdiskRemoteRevision(staged)
    })
  })

  test('trash deletion carries the freshly listed path, fs_id, and full revision', async () => {
    const current = document()
    const calls: unknown[][] = []
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      trashDocumentFile(...args) {
        calls.push(args)
        return Promise.resolve()
      }
    })
    const adapter = createBaiduNetdiskStorageAdapter(client)

    await adapter.deleteDocument(DOCUMENT_ID, { expectedAuthority: AUTHORITY })

    expect(calls).toEqual([
      [
        current,
        baiduNetdiskRemoteRevision(current),
        { signal: undefined, expectedAuthority: AUTHORITY }
      ]
    ])
  })
})
