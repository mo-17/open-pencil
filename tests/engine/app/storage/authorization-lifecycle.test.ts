import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import type { StorageDocumentAuthority } from '@/app/integrations/storage'
import { createMemoryLocalCanvasStore, type LocalCanvasStore } from '@/app/storage/local-store'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'
import {
  adoptStorageAuthorizationWork,
  inspectStorageAuthorizationWork,
  listStorageProfileAuthorizationWork,
  listStaleStorageAuthorizationWork
} from '@/app/storage/sync/authorization-lifecycle'
import { createIdbOutbox, createMemoryOutbox, type Outbox } from '@/app/storage/sync/outbox'

const PREVIOUS: StorageDocumentAuthority = {
  accountId: 'same-google-subject',
  authorizationVersion: 'grant-previous'
}
const NEXT: StorageDocumentAuthority = {
  accountId: PREVIOUS.accountId,
  authorizationVersion: 'grant-next'
}

async function exerciseAdoption(
  store: LocalCanvasStore,
  prefix: string,
  outbox: Outbox = createMemoryOutbox()
): Promise<void> {
  const profileId = `work-${prefix}`
  const binding = (documentId: string, authority = PREVIOUS) => ({
    providerId: 'google-drive',
    profileId,
    documentId,
    authority
  })
  const synced = binding(`${prefix}-synced`)
  const pending = binding(`${prefix}-pending`)
  const deleted = binding(`${prefix}-deleted`)
  const conflict = binding(`${prefix}-conflict`)
  await store.writeCanvas({
    ...synced,
    id: synced.documentId,
    name: 'Synced',
    figBytes: new Uint8Array([1]),
    syncStatus: 'synced'
  })
  await store.writeCanvas({
    ...conflict,
    id: conflict.documentId,
    name: 'Conflict',
    figBytes: new Uint8Array([4]),
    syncStatus: 'conflict'
  })
  await store.writeCanvas({
    ...pending,
    id: pending.documentId,
    name: 'Pending',
    figBytes: new Uint8Array([2]),
    syncStatus: 'pending',
    remoteRevision: { version: '7', etag: 'etag-7' }
  })
  await store.writeCanvas({
    ...deleted,
    id: deleted.documentId,
    name: 'Deleted',
    figBytes: new Uint8Array([3]),
    syncStatus: 'synced'
  })
  await store.tombstone(deleted)
  await outbox.enqueue({
    binding: pending,
    type: 'putCanvas',
    revision: 1,
    expectedRemoteRevision: { version: '7', etag: 'etag-7' }
  })
  await outbox.enqueue({ binding: synced, type: 'putThumb', revision: 1 })
  await outbox.enqueue({ binding: deleted, type: 'deleteCanvas', revision: 0 })
  const oldJobs = await outbox.list()
  let recoverCalls = 0
  const dependencies = {
    store,
    outbox,
    recover: () => {
      recoverCalls++
      return Promise.resolve(2)
    }
  }
  const scope = { providerId: 'google-drive', profileId, authority: PREVIOUS }

  await expect(inspectStorageAuthorizationWork(scope, dependencies)).resolves.toMatchObject({
    documentCount: 4,
    unfinishedDocumentCount: 3,
    jobCount: 3,
    requiresConfirmation: true
  })
  await expect(
    listStaleStorageAuthorizationWork(
      { providerId: 'google-drive', profileId, authority: NEXT },
      dependencies
    )
  ).resolves.toEqual([expect.objectContaining({ scope, documentCount: 4, jobCount: 3 })])

  await expect(
    adoptStorageAuthorizationWork(
      {
        providerId: 'google-drive',
        profileId,
        previousAuthority: PREVIOUS,
        nextAuthority: NEXT
      },
      dependencies
    )
  ).resolves.toEqual({
    adoptedDocumentCount: 4,
    replacedJobCount: 3,
    recoveredJobCount: 2
  })
  expect(recoverCalls).toBe(1)
  for (const document of [synced, pending, deleted, conflict]) {
    expect((await store.getMeta(document))?.authority).toEqual(NEXT)
  }
  const jobs = await outbox.list()
  expect(jobs).toHaveLength(3)
  expect(jobs.every((job) => job.binding.authority?.authorizationVersion === 'grant-next')).toBe(
    true
  )
  expect(jobs.some((job) => oldJobs.some((old) => old.id === job.id))).toBe(false)
  const oldJob = oldJobs[0]
  if (!oldJob) throw new Error('Expected an old authorization job')
  await outbox.update({ ...oldJob, nextAttemptAt: 0 })
  expect((await outbox.list()).some((job) => job.id === oldJob.id)).toBe(false)
  expect(
    await store.updateMeta(
      pending,
      { syncStatus: 'synced' },
      { expectedRevision: 1, expectedAuthority: PREVIOUS }
    )
  ).toBeNull()
  expect(
    await listStaleStorageAuthorizationWork(
      { providerId: 'google-drive', profileId, authority: NEXT },
      dependencies
    )
  ).toEqual([])
}

describe('storage authorization work lifecycle', () => {
  test('enumerates every unique authority across local rows and durable jobs for one profile', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const profileId = 'profile-wide'
    const firstGrant = {
      accountId: 'account-a',
      authorizationVersion: 'grant-1'
    }
    const outboxOnlyGrant = {
      accountId: 'account-a',
      authorizationVersion: 'grant-2'
    }
    const syncedGrant = {
      accountId: 'account-b',
      authorizationVersion: 'grant-1'
    }
    const binding = (
      documentId: string,
      authority: StorageDocumentAuthority,
      providerId = 'google-drive',
      targetProfileId = profileId
    ) => ({ providerId, profileId: targetProfileId, documentId, authority })

    for (const [documentId, authority, syncStatus] of [
      ['pending-a', firstGrant, 'pending'],
      ['synced-a', firstGrant, 'synced'],
      ['synced-b', syncedGrant, 'synced']
    ] as const) {
      await store.writeCanvas({
        ...binding(documentId, authority),
        id: documentId,
        name: documentId,
        figBytes: new Uint8Array([1]),
        syncStatus
      })
    }
    await store.writeCanvas({
      ...binding('other-profile', firstGrant, 'google-drive', 'profile-other'),
      id: 'other-profile',
      name: 'Other profile',
      figBytes: new Uint8Array([2]),
      syncStatus: 'pending'
    })
    await store.writeCanvas({
      ...binding('other-provider', firstGrant, 's3-compatible'),
      id: 'other-provider',
      name: 'Other provider',
      figBytes: new Uint8Array([3]),
      syncStatus: 'pending'
    })
    await outbox.enqueue({
      binding: binding('pending-a', firstGrant),
      type: 'putThumb',
      revision: 1
    })
    await outbox.enqueue({
      binding: binding('outbox-only', outboxOnlyGrant),
      type: 'putThumb',
      revision: 1
    })
    await outbox.enqueue({
      binding: binding('ignored-job', firstGrant, 'google-drive', 'profile-other'),
      type: 'putThumb',
      revision: 1
    })

    await expect(
      listStorageProfileAuthorizationWork(
        { providerId: 'google-drive', profileId },
        { store, outbox }
      )
    ).resolves.toEqual([
      {
        scope: { providerId: 'google-drive', profileId, authority: firstGrant },
        documentCount: 2,
        unfinishedDocumentCount: 1,
        jobCount: 1,
        requiresConfirmation: true
      },
      {
        scope: { providerId: 'google-drive', profileId, authority: outboxOnlyGrant },
        documentCount: 0,
        unfinishedDocumentCount: 0,
        jobCount: 1,
        requiresConfirmation: true
      },
      {
        scope: { providerId: 'google-drive', profileId, authority: syncedGrant },
        documentCount: 1,
        unfinishedDocumentCount: 0,
        jobCount: 0,
        requiresConfirmation: false
      }
    ])
  })

  test('adopts every same-account local row and replaces durable jobs with new IDs', async () => {
    await exerciseAdoption(createMemoryLocalCanvasStore(), 'memory')
    const idbOutbox = createIdbOutbox()
    await idbOutbox.clear()
    await exerciseAdoption(createIdbLocalCanvasStore(), `idb-${crypto.randomUUID()}`, idbOutbox)
  })

  test('synced rows do not require confirmation but still migrate after explicit reconnect', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const profileId = 'synced-only'
    const binding = {
      providerId: 'google-drive',
      profileId,
      documentId: 'synced-document',
      authority: PREVIOUS
    }
    await store.writeCanvas({
      id: binding.documentId,
      providerId: binding.providerId,
      profileId: binding.profileId,
      authority: binding.authority,
      name: 'Synced',
      figBytes: new Uint8Array([1]),
      syncStatus: 'synced'
    })
    const dependencies = { store, outbox, recover: () => Promise.resolve(0) }
    const scope = { providerId: 'google-drive', profileId, authority: PREVIOUS }

    await expect(inspectStorageAuthorizationWork(scope, dependencies)).resolves.toMatchObject({
      documentCount: 1,
      unfinishedDocumentCount: 0,
      jobCount: 0,
      requiresConfirmation: false
    })
    await adoptStorageAuthorizationWork(
      {
        providerId: 'google-drive',
        profileId,
        previousAuthority: PREVIOUS,
        nextAuthority: NEXT
      },
      dependencies
    )
    expect((await store.getMeta(binding))?.authority).toEqual(NEXT)
  })

  test('allows reviewed Aliyun Drive and Baidu Netdisk grants to adopt same-account work', async () => {
    for (const providerId of ['aliyun-drive', 'baidu-netdisk'] as const) {
      const dependencies = {
        store: createMemoryLocalCanvasStore(),
        outbox: createMemoryOutbox(),
        recover: () => Promise.resolve(0)
      }
      await expect(
        adoptStorageAuthorizationWork(
          {
            providerId,
            profileId: `profile-${providerId}`,
            previousAuthority: PREVIOUS,
            nextAuthority: NEXT
          },
          dependencies
        )
      ).resolves.toEqual({
        adoptedDocumentCount: 0,
        replacedJobCount: 0,
        recoveredJobCount: 0
      })
    }
  })

  test('rejects cross-account or same-grant adoption before mutating state', async () => {
    const dependencies = {
      store: createMemoryLocalCanvasStore(),
      outbox: createMemoryOutbox(),
      recover: () => Promise.resolve(0)
    }
    const base = { providerId: 'google-drive', profileId: 'work', previousAuthority: PREVIOUS }
    await expect(
      adoptStorageAuthorizationWork(
        {
          ...base,
          nextAuthority: { accountId: 'different-subject', authorizationVersion: 'grant-next' }
        },
        dependencies
      )
    ).rejects.toThrow('same account')
    await expect(
      adoptStorageAuthorizationWork({ ...base, nextAuthority: PREVIOUS }, dependencies)
    ).rejects.toThrow('new grant')
    await expect(
      adoptStorageAuthorizationWork(
        { ...base, providerId: 's3-compatible', nextAuthority: NEXT },
        dependencies
      )
    ).rejects.toThrow('reviewed OAuth storage grants')
  })
})
