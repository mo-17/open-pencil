import { describe, expect, test, vi } from 'bun:test'
import { readFileSync } from 'node:fs'

import { createMemoryLocalCanvasStore } from '@/app/storage/local-store'
import type { LocalCanvasLocator, LocalCanvasStore } from '@/app/storage/local-store'
import {
  StorageProfileMutationFrozenError,
  withStorageProfileMutationDrain
} from '@/app/storage/mutation-drain'
import { persistStorageCanvasLocally } from '@/app/storage/sync/persist'

describe('local-first storage persistence', () => {
  test('writes document bytes before enqueueing remote synchronization', async () => {
    const store = createMemoryLocalCanvasStore()
    const observations: string[] = []
    const enqueueCanvas = vi.fn(async (locator: LocalCanvasLocator, revision: number) => {
      const bytes = await store.readFig(locator)
      observations.push(`${revision}:${bytes?.join(',')}`)
    })

    const result = await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-1',
        name: 'Stored design',
        figBytes: new Uint8Array([1, 2, 3])
      },
      { store, enqueueCanvas }
    )

    expect(result.revision).toBe(1)
    expect(observations).toEqual(['1:1,2,3'])
    expect(await store.getMeta('canvas-1')).toMatchObject({
      name: 'Stored design',
      syncStatus: 'pending',
      providerId: 's3-compatible',
      profileId: 'default'
    })
  })

  test('stores the embedded preview with the document', async () => {
    const store = createMemoryLocalCanvasStore()
    const enqueueCanvas = vi.fn(() => Promise.resolve())
    const figBytes = new Uint8Array(readFileSync('tests/fixtures/gold-preview.fig'))

    await persistStorageCanvasLocally(
      {
        providerId: 's3-compatible',
        canvasId: 'canvas-preview',
        name: 'Preview design',
        figBytes
      },
      { store, enqueueCanvas }
    )

    const thumbnail = await store.readThumb({
      providerId: 's3-compatible',
      profileId: 'default',
      documentId: 'canvas-preview'
    })
    expect(thumbnail?.byteLength).toBeGreaterThan(0)
    expect(thumbnail?.subarray(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  })

  test('fails closed before an old-grant tab can overwrite the current account mirror', async () => {
    const store = createMemoryLocalCanvasStore()
    const enqueueCanvas = vi.fn(async () => undefined)
    const oldAuthority = { accountId: 'subject-1', authorizationVersion: 'grant-old' }
    const currentAuthority = { accountId: 'subject-1', authorizationVersion: 'grant-current' }

    await store.writeCanvas({
      id: 'shared-document',
      providerId: 'google-drive',
      profileId: 'work',
      authority: currentAuthority,
      name: 'Current grant',
      figBytes: new Uint8Array([2]),
      syncStatus: 'pending'
    })

    await expect(
      persistStorageCanvasLocally(
        {
          providerId: 'google-drive',
          profileId: 'work',
          authority: oldAuthority,
          canvasId: 'shared-document',
          name: 'Stale tab',
          figBytes: new Uint8Array([1])
        },
        {
          store,
          enqueueCanvas,
          readCurrentAuthority: async () => currentAuthority
        }
      )
    ).rejects.toThrow('Storage authorization changed')

    expect(enqueueCanvas).not.toHaveBeenCalled()
    expect(
      (
        await store.getMeta({
          providerId: 'google-drive',
          profileId: 'work',
          authority: currentAuthority,
          documentId: 'shared-document'
        })
      )?.authority
    ).toEqual(currentAuthority)
    const currentBytes = await store.readFig({
      providerId: 'google-drive',
      profileId: 'work',
      authority: currentAuthority,
      documentId: 'shared-document'
    })
    expect(currentBytes ? [...currentBytes] : null).toEqual([2])
  })

  test('drains an active save and blocks new persistence through disconnect preflight', async () => {
    const backingStore = createMemoryLocalCanvasStore()
    const writeStarted = Promise.withResolvers<undefined>()
    const releaseWrite = Promise.withResolvers<undefined>()
    const queued: string[] = []
    const authority = { accountId: 'subject-drain', authorizationVersion: 'grant-drain' }
    const scope = { providerId: 'google-drive', profileId: 'drain-work' } as const
    const store: LocalCanvasStore = {
      ...backingStore,
      async writeCanvas(input) {
        writeStarted.resolve(undefined)
        await releaseWrite.promise
        return backingStore.writeCanvas(input)
      }
    }
    const dependencies = {
      store,
      readCurrentAuthority: async () => authority,
      enqueueCanvas: async (locator: LocalCanvasLocator) => {
        queued.push(locator.documentId)
      }
    }
    const firstSave = persistStorageCanvasLocally(
      {
        ...scope,
        authority,
        canvasId: 'before-disconnect',
        name: 'Before disconnect',
        figBytes: new Uint8Array([1])
      },
      dependencies
    )
    await writeStarted.promise

    let inspectedAfterDrain = false
    const disconnect = withStorageProfileMutationDrain(scope, async () => {
      inspectedAfterDrain = true
      expect(queued).toEqual(['before-disconnect'])
      await expect(
        persistStorageCanvasLocally(
          {
            ...scope,
            authority,
            canvasId: 'during-disconnect',
            name: 'During disconnect',
            figBytes: new Uint8Array([2])
          },
          dependencies
        )
      ).rejects.toBeInstanceOf(StorageProfileMutationFrozenError)
    })
    await Promise.resolve()
    expect(inspectedAfterDrain).toBe(false)
    releaseWrite.resolve(undefined)
    await firstSave
    await disconnect

    await expect(
      persistStorageCanvasLocally(
        {
          ...scope,
          authority,
          canvasId: 'after-failed-or-finished-disconnect',
          name: 'After disconnect',
          figBytes: new Uint8Array([3])
        },
        dependencies
      )
    ).resolves.toEqual({ revision: 1 })
  })
})
