import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import {
  createMemoryLocalCanvasStore,
  localCanvasKey,
  resetLocalCanvasStoreForTests
} from '@/app/storage/local-store'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'

import { expectDefined } from '#tests/helpers/assert'

describe('local canvas store (memory)', () => {
  test('writes and reads fig bytes outside localStorage', async () => {
    const store = createMemoryLocalCanvasStore()
    resetLocalCanvasStoreForTests(store)
    const fig = new Uint8Array([1, 2, 3, 4, 5])
    const meta = await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'Demo',
      figBytes: fig
    })
    expect(meta.revision).toBe(1)
    expect(meta.syncStatus).toBe('pending')
    expect(meta.hasFig).toBe(true)

    const read = expectDefined(await store.readFig('c1'))
    expect([...read]).toEqual([1, 2, 3, 4, 5])

    const list = await store.listMetas()
    expect(list.map((m) => m.id)).toEqual(['c1'])
  })

  test('increments revision and hides tombstones from list', async () => {
    const store = createMemoryLocalCanvasStore()
    await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'A',
      figBytes: new Uint8Array([9])
    })
    const second = await store.writeCanvas({
      id: 'c1',
      providerId: 's3-compatible',
      name: 'A2',
      figBytes: new Uint8Array([9, 9])
    })
    expect(second.revision).toBe(2)
    await store.tombstone('c1')
    expect((await store.listMetas(false)).length).toBe(0)
    expect((await store.listMetas(true)).length).toBe(1)
  })

  test('rejects stale revision-conditional metadata updates', async () => {
    const store = createMemoryLocalCanvasStore()
    await store.writeCanvas({
      id: 'conditional',
      providerId: 's3-compatible',
      name: 'Draft',
      figBytes: new Uint8Array([1])
    })

    expect(
      await store.updateMeta('conditional', { syncStatus: 'synced' }, { expectedRevision: 0 })
    ).toBeNull()
    expect((await store.getMeta('conditional'))?.syncStatus).toBe('pending')
  })

  test('rejects metadata updates owned by a replaced authorization grant', async () => {
    const store = createMemoryLocalCanvasStore()
    const currentAuthority = { accountId: 'subject-1', authorizationVersion: 'grant-current' }
    const binding = {
      providerId: 'google-drive',
      profileId: 'work',
      documentId: 'authority-conditional',
      authority: currentAuthority
    }
    await store.writeCanvas({
      id: binding.documentId,
      providerId: binding.providerId,
      profileId: binding.profileId,
      authority: currentAuthority,
      name: 'Current grant',
      figBytes: new Uint8Array([1])
    })

    expect(
      await store.updateMeta(
        binding,
        { syncStatus: 'synced' },
        {
          expectedRevision: 1,
          expectedAuthority: { accountId: 'subject-1', authorizationVersion: 'grant-old' }
        }
      )
    ).toBeNull()
    expect((await store.getMeta(binding))?.syncStatus).toBe('pending')
  })

  test('upsertIndexMeta does not require fig body', async () => {
    const store = createMemoryLocalCanvasStore()
    const meta = await store.upsertIndexMeta({
      id: 'remote-1',
      providerId: 's3-compatible',
      name: 'From bucket',
      updatedAt: '2026-01-01T00:00:00.000Z',
      syncStatus: 'synced',
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
      lastSyncError: null,
      hasFig: false
    })
    expect(meta.hasFig).toBe(false)
    expect(await store.readFig('remote-1')).toBeNull()
  })

  test('isolates equal document IDs by provider, profile, and account', async () => {
    const store = createMemoryLocalCanvasStore()
    const accountA = {
      providerId: 'google-drive',
      profileId: 'work',
      documentId: 'shared-id',
      authority: { accountId: 'account-a', authorizationVersion: 'grant-a' }
    }
    const accountB = {
      ...accountA,
      authority: { accountId: 'account-b', authorizationVersion: 'grant-b' }
    }
    const otherProfile = { ...accountA, profileId: 'personal' }

    await store.writeCanvas({
      id: accountA.documentId,
      providerId: accountA.providerId,
      profileId: accountA.profileId,
      authority: accountA.authority,
      name: 'Account A',
      figBytes: new Uint8Array([1])
    })
    await store.writeCanvas({
      id: accountB.documentId,
      providerId: accountB.providerId,
      profileId: accountB.profileId,
      authority: accountB.authority,
      name: 'Account B',
      figBytes: new Uint8Array([2])
    })
    await store.writeCanvas({
      id: otherProfile.documentId,
      providerId: otherProfile.providerId,
      profileId: otherProfile.profileId,
      authority: otherProfile.authority,
      name: 'Personal',
      figBytes: new Uint8Array([3])
    })

    expect([...expectDefined(await store.readFig(accountA))]).toEqual([1])
    expect([...expectDefined(await store.readFig(accountB))]).toEqual([2])
    expect([...expectDefined(await store.readFig(otherProfile))]).toEqual([3])
    expect(await store.listMetas()).toHaveLength(3)
    expect(
      localCanvasKey({
        ...accountA,
        authority: { ...accountA.authority, authorizationVersion: 'replacement-grant' }
      })
    ).toBe(localCanvasKey(accountA))
  })
})

describe('local canvas store (IndexedDB)', () => {
  test('migrates v1 S3 metadata and blobs to the default profile key', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('open-pencil-cloud-local')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-cloud-local', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta', { keyPath: 'id' })
        request.result.createObjectStore('fig')
        request.result.createObjectStore('thumb')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['meta', 'fig'], 'readwrite')
      transaction.objectStore('meta').put({
        id: 'legacy-canvas',
        providerId: 's3-compatible',
        name: 'Legacy canvas',
        updatedAt: '2026-01-01T00:00:00.000Z',
        revision: 4,
        syncStatus: 'pending',
        lastSyncedAt: null,
        lastSyncError: null,
        tombstoned: false,
        hasFig: true,
        hasThumb: false,
        figSize: 3
      })
      transaction.objectStore('fig').put(new Uint8Array([4, 5, 6]), 'legacy-canvas')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    const store = createIdbLocalCanvasStore()
    expect(await store.getMeta('legacy-canvas')).toMatchObject({
      providerId: 's3-compatible',
      profileId: 'default',
      authority: null,
      remoteRevision: null,
      revision: 4
    })
    expect([...expectDefined(await store.readFig('legacy-canvas'))]).toEqual([4, 5, 6])
  })

  test('serializes concurrent writes into distinct revisions', async () => {
    const store = createIdbLocalCanvasStore()
    const id = `concurrent-${crypto.randomUUID()}`
    const writes = await Promise.all([
      store.writeCanvas({
        id,
        providerId: 's3-compatible',
        name: 'First',
        figBytes: new Uint8Array([1])
      }),
      store.writeCanvas({
        id,
        providerId: 's3-compatible',
        name: 'Second',
        figBytes: new Uint8Array([2])
      })
    ])

    expect(writes.map((meta) => meta.revision).sort()).toEqual([1, 2])
    expect((await store.getMeta(id))?.revision).toBe(2)
  })
})
