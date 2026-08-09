import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import {
  storageDocumentAuthorityMatches,
  type StorageDocumentBinding
} from '@/app/integrations/storage'
import {
  createMemoryLocalCanvasStore,
  resetLocalCanvasStoreForTests,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import { nextSyncWakeDelay, recoverStorageSyncJobs } from '@/app/storage/sync/engine'
import { readStorageSyncPutSnapshot } from '@/app/storage/sync/job-guard'
import { createIdbOutbox, createMemoryOutbox, resetOutboxForTests } from '@/app/storage/sync/outbox'
import { supersedePutCanvasJobs, type OutboxJob } from '@/app/storage/sync/types'

import { expectDefined } from '#tests/helpers/assert'

function binding(
  documentId: string,
  profileId = 'default',
  accountId?: string,
  authorizationVersion = 'grant-1'
): StorageDocumentBinding {
  return {
    providerId: accountId ? 'google-drive' : 's3-compatible',
    profileId,
    documentId,
    ...(accountId ? { authority: { accountId, authorizationVersion } } : {})
  }
}

function job(
  id: string,
  documentBinding: StorageDocumentBinding,
  type: OutboxJob['type'],
  revision: number,
  createdAt: number
): OutboxJob {
  return {
    id,
    binding: documentBinding,
    type,
    revision,
    createdAt,
    attempts: 0,
    nextAttemptAt: createdAt,
    expectedRemoteRevision: null
  }
}

describe('supersedePutCanvasJobs', () => {
  test('drops older putCanvas jobs for same canvas', () => {
    const jobs: OutboxJob[] = [
      job('a', binding('c1'), 'putCanvas', 1, 1),
      job('b', binding('c1'), 'putThumb', 1, 2),
      job('c', binding('c2'), 'putCanvas', 3, 3)
    ]
    const next = supersedePutCanvasJobs(jobs, binding('c1'), 5)
    expect(next.map((j) => j.id).sort()).toEqual(['b', 'c'])
  })

  test('scopes supersession by profile and account while retaining the exact grant', () => {
    const accountAOld = binding('shared', 'primary', 'account-a', 'grant-old')
    const accountANew = binding('shared', 'primary', 'account-a', 'grant-new')
    const jobs = [
      job('same-account', accountAOld, 'putCanvas', 1, 1),
      job('other-profile', binding('shared', 'secondary', 'account-a'), 'putCanvas', 1, 2),
      job('other-account', binding('shared', 'primary', 'account-b'), 'putCanvas', 1, 3)
    ]

    expect(
      supersedePutCanvasJobs(jobs, accountANew, 2)
        .map((item) => item.id)
        .sort()
    ).toEqual(['other-account', 'other-profile'])
    expect(jobs[0]?.binding.authority?.authorizationVersion).toBe('grant-old')
  })
})

describe('storage document authority', () => {
  test('requires the exact account and authorization grant for account-bound work', () => {
    const expected = { accountId: 'subject-1', authorizationVersion: 'grant-1' }
    expect(storageDocumentAuthorityMatches(expected, expected)).toBe(true)
    expect(
      storageDocumentAuthorityMatches(expected, {
        accountId: 'subject-1',
        authorizationVersion: 'grant-2'
      })
    ).toBe(false)
    expect(
      storageDocumentAuthorityMatches(expected, {
        accountId: 'subject-2',
        authorizationVersion: 'grant-1'
      })
    ).toBe(false)
    expect(storageDocumentAuthorityMatches(expected, null)).toBe(false)
    expect(storageDocumentAuthorityMatches(undefined, null)).toBe(true)
  })

  test('drops a byte snapshot if the local row changes grant while it is being read', async () => {
    const store = createMemoryLocalCanvasStore()
    const grantOne = binding('racing-document', 'work', 'subject-1', 'grant-1')
    const grantTwo = binding('racing-document', 'work', 'subject-1', 'grant-2')
    await store.writeCanvas({
      id: grantOne.documentId,
      providerId: grantOne.providerId,
      profileId: grantOne.profileId,
      authority: grantOne.authority,
      name: 'Grant one',
      figBytes: new Uint8Array([1]),
      syncStatus: 'pending'
    })
    const racingStore: LocalCanvasStore = {
      ...store,
      async readFig(locator) {
        await store.writeCanvas({
          id: grantTwo.documentId,
          providerId: grantTwo.providerId,
          profileId: grantTwo.profileId,
          authority: grantTwo.authority,
          name: 'Grant two',
          figBytes: new Uint8Array([2]),
          syncStatus: 'pending'
        })
        return store.readFig(locator)
      }
    }

    await expect(
      readStorageSyncPutSnapshot(racingStore, job('in-flight', grantOne, 'putCanvas', 1, 1))
    ).resolves.toBeNull()
  })
})

describe('sync wake scheduling', () => {
  test('does not poll jobs parked for repaired configuration', () => {
    const parked: OutboxJob = {
      ...job('parked', binding('c1'), 'putCanvas', 1, 1),
      nextAttemptAt: Number.MAX_SAFE_INTEGER
    }
    expect(nextSyncWakeDelay([parked], 100)).toBeNull()
    expect(nextSyncWakeDelay([{ ...parked, nextAttemptAt: 500 }], 100)).toBe(400)
  })
})

describe('memory outbox', () => {
  test('enqueues and supersedes putCanvas', async () => {
    const outbox = createMemoryOutbox()
    await outbox.enqueue({ binding: binding('c1'), type: 'putCanvas', revision: 1 })
    await outbox.enqueue({ binding: binding('c1'), type: 'putCanvas', revision: 2 })
    const list = await outbox.list()
    expect(list.filter((j) => j.type === 'putCanvas')).toHaveLength(1)
    expect(list[0]?.revision).toBe(2)
  })

  test('keeps durable authority in the queued job', async () => {
    const outbox = createMemoryOutbox()
    const exactBinding = binding('drive-file', 'work', 'subject-1', 'grant-random')
    await outbox.enqueue({ binding: exactBinding, type: 'putCanvas', revision: 1 })

    expect((await outbox.list())[0]?.binding).toEqual(exactBinding)
  })

  test('delete supersedes pending uploads only for the same provider profile account and document', async () => {
    const outbox = createMemoryOutbox()
    const current = binding('shared', 'work', 'subject-1', 'grant-current')
    const otherAccount = binding('shared', 'work', 'subject-2', 'grant-other')
    await outbox.enqueue({ binding: current, type: 'putCanvas', revision: 2 })
    await outbox.enqueue({ binding: current, type: 'putThumb', revision: 2 })
    await outbox.enqueue({ binding: otherAccount, type: 'putCanvas', revision: 1 })
    await outbox.enqueue({ binding: current, type: 'deleteCanvas', revision: 0 })

    const jobs = await outbox.list()
    expect(jobs.filter((item) => item.binding.authority?.accountId === 'subject-1')).toEqual([
      expect.objectContaining({ type: 'deleteCanvas', binding: current })
    ])
    expect(jobs).toContainEqual(
      expect.objectContaining({ type: 'putCanvas', binding: otherAccount })
    )
  })
})

describe('outbox recovery', () => {
  test('repairs missing pending and tombstone jobs with full binding authority', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    resetLocalCanvasStoreForTests(store)
    resetOutboxForTests(outbox)
    const driveBinding = binding('pending-drive', 'work', 'subject-1', 'grant-1')
    const remoteRevision = { version: '7', headRevisionId: 'head-7' }

    try {
      await store.writeCanvas({
        id: driveBinding.documentId,
        providerId: driveBinding.providerId,
        profileId: driveBinding.profileId,
        authority: driveBinding.authority,
        name: 'Pending Drive',
        figBytes: new Uint8Array([7]),
        syncStatus: 'pending',
        remoteRevision
      })
      await store.writeCanvas({
        id: 'deleted-s3',
        providerId: 's3-compatible',
        name: 'Deleted S3',
        figBytes: new Uint8Array([8]),
        syncStatus: 'synced'
      })
      await store.tombstone('deleted-s3')

      expect(await recoverStorageSyncJobs()).toBe(2)
      expect(await recoverStorageSyncJobs()).toBe(0)
      const jobs = await outbox.list()
      expect(jobs).toHaveLength(2)
      expect(jobs.find((item) => item.type === 'putCanvas')).toMatchObject({
        binding: driveBinding,
        expectedRemoteRevision: remoteRevision
      })
      expect(jobs.find((item) => item.type === 'deleteCanvas')).toMatchObject({
        binding: binding('deleted-s3'),
        expectedRemoteRevision: null
      })

      await store.writeCanvas({
        id: 'later-delete',
        providerId: 's3-compatible',
        name: 'Later delete',
        figBytes: new Uint8Array([9]),
        syncStatus: 'synced'
      })
      await store.tombstone('later-delete')
      expect(await recoverStorageSyncJobs()).toBe(1)
      expect((await outbox.list()).some((item) => item.binding.documentId === 'later-delete')).toBe(
        true
      )
    } finally {
      resetLocalCanvasStoreForTests()
      resetOutboxForTests()
    }
  })

  test('replaces a parked old grant with recovered work for the current grant', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    resetLocalCanvasStoreForTests(store)
    resetOutboxForTests(outbox)
    const oldGrant = binding('same-document', 'work', 'subject-1', 'grant-1')
    const currentGrant = binding('same-document', 'work', 'subject-1', 'grant-2')

    try {
      await outbox.enqueue({
        binding: oldGrant,
        type: 'putCanvas',
        revision: 0,
        nextAttemptAt: Number.MAX_SAFE_INTEGER
      })
      await store.writeCanvas({
        id: currentGrant.documentId,
        providerId: currentGrant.providerId,
        profileId: currentGrant.profileId,
        authority: currentGrant.authority,
        name: 'Recovered current grant',
        figBytes: new Uint8Array([9]),
        syncStatus: 'pending'
      })

      expect(await recoverStorageSyncJobs()).toBe(1)
      expect(await outbox.list()).toEqual([
        expect.objectContaining({
          binding: currentGrant,
          type: 'putCanvas',
          revision: 1
        })
      ])
      expect(await recoverStorageSyncJobs()).toBe(0)
    } finally {
      resetLocalCanvasStoreForTests()
      resetOutboxForTests()
    }
  })
})

describe('IndexedDB outbox migration', () => {
  test('migrates v1 canvasId jobs to the legacy S3/default authority', async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('open-pencil-cloud-outbox')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-cloud-outbox', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('jobs', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('jobs', 'readwrite')
      transaction.objectStore('jobs').put({
        id: 'legacy-job',
        canvasId: 'legacy-canvas',
        type: 'putCanvas',
        revision: 3,
        createdAt: 1,
        attempts: 0,
        nextAttemptAt: 1
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()

    const outbox = createIdbOutbox()
    const jobs = await outbox.list()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      binding: {
        providerId: 's3-compatible',
        profileId: 'default',
        documentId: 'legacy-canvas'
      },
      expectedRemoteRevision: null
    })

    const removed = expectDefined(jobs[0])
    await outbox.remove('legacy-job')
    await outbox.update(removed)
    expect(await outbox.list()).toEqual([])
  })
})
