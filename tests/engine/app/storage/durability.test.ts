import { afterEach, describe, expect, test, vi } from 'bun:test'

import {
  assertCloudStorageDurability,
  StorageDurabilityUnavailableError,
  withDurableStorageProfileMutationDrain
} from '@/app/storage/durability'
import {
  createMemoryLocalCanvasStore,
  getLocalCanvasStore,
  isLocalCanvasStoreMemoryFallback,
  resetLocalCanvasStoreForTests
} from '@/app/storage/local-store'
import {
  createMemoryOutbox,
  getOutbox,
  isOutboxDurable,
  resetOutboxForTests
} from '@/app/storage/sync/outbox'
import {
  persistStorageCanvasLocally,
  seedStorageCanvasFromRemote
} from '@/app/storage/sync/persist'
import { queueStorageDocumentDeletion } from '@/app/storage/workspace/delete'

afterEach(() => {
  resetLocalCanvasStoreForTests()
  resetOutboxForTests()
})

describe('cloud storage durability gate', () => {
  test('rejects production open/save/delete prerequisites when IndexedDB is unavailable', async () => {
    resetLocalCanvasStoreForTests()
    resetOutboxForTests()
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Reflect.deleteProperty(globalThis, 'indexedDB')
    try {
      await expect(assertCloudStorageDurability()).rejects.toBeInstanceOf(
        StorageDurabilityUnavailableError
      )
      expect(isLocalCanvasStoreMemoryFallback()).toBe(true)
      expect(isOutboxDurable()).toBe(false)

      await expect(
        persistStorageCanvasLocally({
          providerId: 's3-compatible',
          canvasId: 'must-not-save',
          name: 'Must not save',
          figBytes: new Uint8Array([1])
        })
      ).rejects.toBeInstanceOf(StorageDurabilityUnavailableError)
      await expect(
        seedStorageCanvasFromRemote({
          providerId: 's3-compatible',
          canvasId: 'must-not-seed',
          name: 'Must not seed',
          updatedAt: '2026-08-10T00:00:00.000Z',
          figBytes: new Uint8Array([2])
        })
      ).rejects.toBeInstanceOf(StorageDurabilityUnavailableError)
      await expect(
        queueStorageDocumentDeletion({
          providerId: 's3-compatible',
          profileId: 'default',
          documentId: 'must-not-delete'
        })
      ).rejects.toBeInstanceOf(StorageDurabilityUnavailableError)

      const clearCredential = vi.fn()
      const rotateAuthority = vi.fn()
      const markMigrationComplete = vi.fn()
      await expect(
        withDurableStorageProfileMutationDrain(
          { providerId: 's3-compatible', profileId: 'default' },
          () => {
            clearCredential()
            rotateAuthority()
            markMigrationComplete()
          }
        )
      ).rejects.toBeInstanceOf(StorageDurabilityUnavailableError)
      expect(clearCredential).not.toHaveBeenCalled()
      expect(rotateAuthority).not.toHaveBeenCalled()
      expect(markMigrationComplete).not.toHaveBeenCalled()

      expect(await getLocalCanvasStore().listMetas(true)).toEqual([])
      expect(await getOutbox().list()).toEqual([])
    } finally {
      resetLocalCanvasStoreForTests()
      resetOutboxForTests()
      if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor)
    }
  })

  test('treats explicitly injected memory stores as durable test backends', async () => {
    resetLocalCanvasStoreForTests(createMemoryLocalCanvasStore())
    resetOutboxForTests(createMemoryOutbox())

    await expect(assertCloudStorageDurability()).resolves.toBeUndefined()
    expect(isLocalCanvasStoreMemoryFallback()).toBe(false)
    expect(isOutboxDurable()).toBe(true)
  })

  test('normalizes an asynchronous IndexedDB probe failure and performs no follow-up probe', async () => {
    const outbox = createMemoryOutbox()
    const outboxList = vi.spyOn(outbox, 'list')
    const localStore = {
      ...createMemoryLocalCanvasStore(),
      listMetas: async () => {
        throw new Error('IndexedDB transaction aborted')
      }
    }

    await expect(
      assertCloudStorageDurability({
        localStore,
        outbox,
        localStoreDurable: true,
        outboxDurable: true
      })
    ).rejects.toMatchObject({
      name: 'StorageDurabilityUnavailableError',
      code: 'durability-unavailable'
    })
    expect(outboxList).toHaveBeenCalledTimes(1)
  })
})
