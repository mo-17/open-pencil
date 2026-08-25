import { describe, expect, test } from 'bun:test'

import type { StorageDocumentBinding } from '@/app/integrations/storage'
import { createMemoryLocalCanvasStore } from '@/app/storage/local-store'
import {
  StorageProfileMutationFrozenError,
  withStorageProfileMutationDrain
} from '@/app/storage/mutation-drain'
import {
  queueStorageDocumentDeletion,
  type StorageDocumentDeletionDependencies,
  type StorageDocumentDeletionError
} from '@/app/storage/workspace/delete'

const BINDING: StorageDocumentBinding = {
  providerId: 'google-drive',
  profileId: 'work',
  documentId: 'design-1',
  authority: { accountId: 'subject-1', authorizationVersion: 'grant-1' }
}

async function seededDependencies(
  enqueue: StorageDocumentDeletionDependencies['enqueue'] = async () => undefined
): Promise<StorageDocumentDeletionDependencies> {
  const store = createMemoryLocalCanvasStore()
  await store.writeCanvas({
    ...BINDING,
    id: BINDING.documentId,
    name: 'Campaign.fig',
    figBytes: new Uint8Array([1, 2, 3]),
    syncStatus: 'synced'
  })
  return {
    store,
    enqueue,
    now: () => new Date('2026-08-10T08:09:10.000Z'),
    warn: () => undefined
  }
}

describe('storage workspace document deletion', () => {
  test('hides the document locally before queuing exact remote work without discarding bytes', async () => {
    const queued: StorageDocumentBinding[] = []
    const dependencies = await seededDependencies(async (binding) => {
      queued.push(binding)
    })

    const result = await queueStorageDocumentDeletion(BINDING, dependencies)

    expect(result.queueState).toBe('queued')
    expect(queued).toEqual([BINDING])
    expect(await dependencies.store.listMetas()).toEqual([])
    expect(await dependencies.store.getMeta(BINDING)).toMatchObject({
      tombstoned: true,
      syncStatus: 'pending',
      updatedAt: '2026-08-10T08:09:10.000Z'
    })
    expect(await dependencies.store.readFig(BINDING)).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('keeps a durable tombstone for restart recovery when outbox enqueue fails', async () => {
    const dependencies = await seededDependencies(async () => {
      throw new Error('outbox unavailable')
    })

    const result = await queueStorageDocumentDeletion(BINDING, dependencies)

    expect(result.queueState).toBe('recovery-pending')
    expect((await dependencies.store.getMeta(BINDING))?.tombstoned).toBe(true)
  })

  test('fails closed when the local row belongs to a different authorization grant', async () => {
    const dependencies = await seededDependencies()
    const rebound = {
      ...BINDING,
      authority: { accountId: 'subject-1', authorizationVersion: 'grant-2' }
    }

    await expect(queueStorageDocumentDeletion(rebound, dependencies)).rejects.toMatchObject({
      name: 'StorageDocumentDeletionError',
      code: 'changed'
    } satisfies Partial<StorageDocumentDeletionError>)
    expect((await dependencies.store.getMeta(BINDING))?.tombstoned).toBe(false)
  })

  test('fails closed when reconciliation removed the local index first', async () => {
    const store = createMemoryLocalCanvasStore()
    await expect(
      queueStorageDocumentDeletion(BINDING, {
        store,
        enqueue: async () => undefined,
        now: () => new Date(0),
        warn: () => undefined
      })
    ).rejects.toMatchObject({ code: 'missing' })
  })

  test('does not create a tombstone while the profile lifecycle is frozen', async () => {
    const dependencies = await seededDependencies()

    await withStorageProfileMutationDrain(BINDING, async () => {
      await expect(queueStorageDocumentDeletion(BINDING, dependencies)).rejects.toBeInstanceOf(
        StorageProfileMutationFrozenError
      )
    })
    expect((await dependencies.store.getMeta(BINDING))?.tombstoned).toBe(false)
  })
})
