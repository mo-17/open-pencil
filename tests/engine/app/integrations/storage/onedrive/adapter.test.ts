import { describe, expect, test } from 'bun:test'

import {
  createOneDriveStorageAdapter,
  type OneDriveClientLike
} from '@/app/integrations/storage/onedrive/adapter'
import { OneDriveError } from '@/app/integrations/storage/onedrive/errors'
import type {
  OneDriveDocumentFile,
  OneDriveItem,
  OneDriveUploadOptions,
  OneDriveUploadResult
} from '@/app/integrations/storage/onedrive/types'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const CONFLICT_ID = '22222222-2222-4222-8222-222222222222'
const AUTHORITY = { accountId: 'microsoft-subject', authorizationVersion: 'grant-1' }

function driveItem(id: string, name: string, overrides: Partial<OneDriveItem> = {}): OneDriveItem {
  return {
    id,
    name,
    size: 3,
    lastModifiedDateTime: '2026-08-26T01:02:03.000Z',
    eTag: `"${id}-etag"`,
    cTag: null,
    parentReference: { driveId: 'drive-1', id: 'parent' },
    file: false,
    folder: false,
    deleted: false,
    remoteItem: false,
    downloadUrl: null,
    ...overrides
  }
}

function document(
  itemId = 'item-1',
  etag = '"etag-1"',
  documentId = DOCUMENT_ID
): OneDriveDocumentFile {
  const folder = driveItem('folder-1', documentId, {
    folder: true,
    parentReference: { driveId: 'drive-1', id: 'documents-folder' }
  })
  const file = driveItem(itemId, '惊悚.fig', {
    eTag: etag,
    file: true,
    parentReference: { driveId: 'drive-1', id: folder.id }
  })
  return { documentId, folder, file }
}

function uploaded(itemId: string, etag: string): OneDriveUploadResult {
  return {
    item: document(itemId, etag).file,
    remoteRevision: { itemId, etag }
  }
}

function fakeClient(overrides: Partial<OneDriveClientLike> = {}): OneDriveClientLike {
  return {
    getAuthority: () => Promise.resolve(AUTHORITY),
    testConnection: () => Promise.resolve(),
    listDocuments: () => Promise.resolve([]),
    getDocumentFile: () => Promise.resolve(null),
    downloadDocument: () => Promise.reject(new Error('not implemented')),
    createDocument: () => Promise.reject(new Error('not implemented')),
    updateDocument: () => Promise.reject(new Error('not implemented')),
    deleteDocumentFile: () => Promise.resolve(),
    ...overrides
  }
}

describe('OneDriveStorageAdapter', () => {
  test('reserves a logical UUID locally without calling OneDrive', async () => {
    let calls = 0
    const client = fakeClient({
      getAuthority: () => {
        calls += 1
        return Promise.resolve(AUTHORITY)
      }
    })
    const adapter = createOneDriveStorageAdapter(client, {
      createDocumentId: () => DOCUMENT_ID
    })

    await expect(adapter.reserveDocumentId?.({ expectedAuthority: AUTHORITY })).resolves.toBe(
      DOCUMENT_ID
    )
    expect(calls).toBe(0)
  })

  test('creates a new UUID-folder document and returns itemId plus ETag', async () => {
    let captured: OneDriveUploadOptions | null = null
    const client = fakeClient({
      createDocument(options) {
        captured = options
        return Promise.resolve(uploaded('item-created', '"etag-created"'))
      }
    })
    const adapter = createOneDriveStorageAdapter(client)
    const bytes = new Uint8Array([1, 2, 3])

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      bytes,
      { name: '惊悚', updatedAt: '2026-08-26T01:02:03.000Z' },
      { expectedRemoteRevision: null, expectedAuthority: AUTHORITY }
    )

    expect(result).toEqual({
      outcome: 'created',
      remoteRevision: { itemId: 'item-created', etag: '"etag-created"' }
    })
    expect(captured).toMatchObject({
      documentId: DOCUMENT_ID,
      name: '惊悚.fig',
      bytes,
      expectedAuthority: AUTHORITY
    })
  })

  test('updates only after exact itemId and ETag matching', async () => {
    let captured: OneDriveUploadOptions | null = null
    const current = document()
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      updateDocument(options) {
        captured = options
        return Promise.resolve(uploaded('item-1', '"etag-2"'))
      }
    })
    const adapter = createOneDriveStorageAdapter(client)

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([4, 5, 6]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T02:00:00.000Z' },
      { expectedRemoteRevision: { itemId: 'item-1', etag: '"etag-1"' } }
    )

    expect(result).toEqual({
      outcome: 'updated',
      remoteRevision: { itemId: 'item-1', etag: '"etag-2"' }
    })
    expect(captured).toMatchObject({ itemId: 'item-1', expectedEtag: '"etag-1"' })
  })

  test('preserves revision mismatch in a separate UUID folder without rebinding the original', async () => {
    const creates: OneDriveUploadOptions[] = []
    const current = document()
    const client = fakeClient({
      getDocumentFile: () => Promise.resolve(current),
      createDocument(options) {
        creates.push(options)
        return Promise.resolve(uploaded('conflict-item', '"conflict-etag"'))
      }
    })
    const adapter = createOneDriveStorageAdapter(client, {
      now: () => new Date('2026-08-26T03:04:05.000Z'),
      createDocumentId: () => CONFLICT_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([7, 8, 9]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T03:04:05.000Z' },
      { expectedRemoteRevision: { itemId: 'item-1', etag: '"stale"' } }
    )

    expect(result).toEqual({
      outcome: 'conflict-copy',
      remoteRevision: { itemId: 'item-1', etag: '"etag-1"' },
      conflictDocumentId: CONFLICT_ID,
      conflictCopyRevision: { itemId: 'conflict-item', etag: '"conflict-etag"' }
    })
    expect(creates).toHaveLength(1)
    expect(creates[0]?.documentId).toBe(CONFLICT_ID)
    expect(creates[0]?.name).toContain('conflict 2026-08-26 03-04-05')
  })

  test('turns an If-Match race into a conflict copy after refreshing the original', async () => {
    let lookup = 0
    const creates: OneDriveUploadOptions[] = []
    const client = fakeClient({
      getDocumentFile() {
        lookup += 1
        return Promise.resolve(lookup === 1 ? document() : document('item-1', '"etag-2"'))
      },
      updateDocument: () =>
        Promise.reject(new OneDriveError('precondition', 'changed', { status: 412 })),
      createDocument(options) {
        creates.push(options)
        return Promise.resolve(uploaded('conflict-item', '"conflict-etag"'))
      }
    })
    const adapter = createOneDriveStorageAdapter(client, {
      createDocumentId: () => CONFLICT_ID
    })

    const result = await adapter.putDocument(
      DOCUMENT_ID,
      new Uint8Array([1, 2, 3]),
      { name: '惊悚.fig', updatedAt: '2026-08-26T03:04:05.000Z' },
      { expectedRemoteRevision: { itemId: 'item-1', etag: '"etag-1"' } }
    )

    expect(result).toMatchObject({
      outcome: 'conflict-copy',
      remoteRevision: { itemId: 'item-1', etag: '"etag-2"' },
      conflictDocumentId: CONFLICT_ID
    })
    expect(creates).toHaveLength(1)
  })

  test('deletes only the logical document file under the expected authority', async () => {
    const calls: unknown[][] = []
    const client = fakeClient({
      deleteDocumentFile(...args) {
        calls.push(args)
        return Promise.resolve()
      }
    })
    const adapter = createOneDriveStorageAdapter(client)

    await adapter.deleteDocument(DOCUMENT_ID, { expectedAuthority: AUTHORITY })

    expect(calls).toEqual([[DOCUMENT_ID, undefined, AUTHORITY]])
  })
})
