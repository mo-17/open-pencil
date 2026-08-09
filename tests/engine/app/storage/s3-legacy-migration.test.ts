import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import type { StorageDocumentAuthority } from '@/app/integrations/storage'
import {
  assertS3LegacyMigrationComplete,
  createMemoryS3LegacyMigrationStateStore,
  type S3LegacyMigrationStateStore
} from '@/app/integrations/storage/s3/legacy-migration-state'
import {
  createMemoryLocalCanvasStore,
  resetLocalCanvasStoreForTests,
  type LocalCanvasStore
} from '@/app/storage/local-store'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'
import {
  confirmS3LegacyMigration,
  prepareS3LegacyMigration
} from '@/app/storage/s3-legacy-migration'
import { recoverStorageSyncJobs } from '@/app/storage/sync/engine'
import {
  createIdbOutbox,
  createMemoryOutbox,
  resetOutboxForTests,
  type Outbox
} from '@/app/storage/sync/outbox'

import { expectDefined } from '#tests/helpers/assert'

const AUTHORITY: StorageDocumentAuthority = {
  accountId: `s3-profile-${'a'.repeat(32)}`,
  authorizationVersion: 'b'.repeat(32)
}
const PREFERENCES = {
  endpoint: 'https://s3.example.com',
  bucket: 'documents',
  region: 'auto'
}

function scope(profileId: string) {
  return { profileId, authority: AUTHORITY, preferences: PREFERENCES }
}

async function seedLegacyCanvas(
  store: LocalCanvasStore,
  profileId: string,
  documentId: string,
  syncStatus: 'synced' | 'pending' = 'synced'
): Promise<void> {
  await store.writeCanvas({
    id: documentId,
    providerId: 's3-compatible',
    profileId,
    name: 'Legacy canvas',
    figBytes: new Uint8Array([1, 2, 3]),
    thumbBytes: new Uint8Array([4, 5]),
    syncStatus
  })
}

async function exerciseBlobMigration(
  localStore: LocalCanvasStore,
  outbox: Outbox,
  profileId: string
): Promise<void> {
  await localStore.clearAll()
  await outbox.clear()
  const stateStore = createMemoryS3LegacyMigrationStateStore()
  await seedLegacyCanvas(localStore, profileId, 'legacy-synced')
  await outbox.enqueue({
    binding: { providerId: 's3-compatible', profileId, documentId: 'legacy-synced' },
    type: 'putThumb',
    revision: 1
  })

  const pending = await prepareS3LegacyMigration(scope(profileId), {
    localStore,
    outbox,
    stateStore
  })
  expect(pending).toMatchObject({
    status: 'pending',
    legacyDocumentCount: 1,
    jobCount: 1,
    requiresConfirmation: true
  })
  expect(() => assertS3LegacyMigrationComplete(profileId, AUTHORITY, stateStore)).toThrow(
    'must be reviewed and migrated'
  )

  const migrated = await confirmS3LegacyMigration(
    { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
    { localStore, outbox, stateStore }
  )
  expect(migrated.status).toBe('complete')
  expect(
    await localStore.getMeta({
      providerId: 's3-compatible',
      profileId,
      documentId: 'legacy-synced'
    })
  ).toBeNull()
  const target = {
    providerId: 's3-compatible' as const,
    profileId,
    documentId: 'legacy-synced',
    authority: AUTHORITY
  }
  expect(await localStore.getMeta(target)).toMatchObject({ authority: AUTHORITY, revision: 1 })
  expect([...expectDefined(await localStore.readFig(target))]).toEqual([1, 2, 3])
  expect([...expectDefined(await localStore.readThumb(target))]).toEqual([4, 5])
  expect(await outbox.list()).toEqual([
    expect.objectContaining({ binding: target, type: 'putThumb', revision: 1 })
  ])
  expect(() => assertS3LegacyMigrationComplete(profileId, AUTHORITY, stateStore)).not.toThrow()

  await expect(
    confirmS3LegacyMigration(
      { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
      { localStore, outbox, stateStore }
    )
  ).resolves.toMatchObject({ status: 'complete', legacyDocumentCount: 0, jobCount: 0 })
}

describe('S3 legacy authority migration', () => {
  test('atomically rekeys metadata, fig, thumb and outbox in memory', async () => {
    await exerciseBlobMigration(
      createMemoryLocalCanvasStore(),
      createMemoryOutbox(),
      `memory-${crypto.randomUUID()}`
    )
  })

  test('atomically rekeys metadata, fig, thumb and outbox in IndexedDB', async () => {
    const suffix = crypto.randomUUID()
    await exerciseBlobMigration(
      createIdbLocalCanvasStore(`open-pencil-test-s3-legacy-local-${suffix}`),
      createIdbOutbox(`open-pencil-test-s3-legacy-outbox-${suffix}`),
      `idb-${suffix}`
    )
  })

  test('requires explicit confirmation for tombstones and preserves delete jobs', async () => {
    const localStore = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const stateStore = createMemoryS3LegacyMigrationStateStore()
    const profileId = `delete-${crypto.randomUUID()}`
    await seedLegacyCanvas(localStore, profileId, 'legacy-delete')
    await localStore.tombstone({
      providerId: 's3-compatible',
      profileId,
      documentId: 'legacy-delete'
    })
    await outbox.enqueue({
      binding: { providerId: 's3-compatible', profileId, documentId: 'legacy-delete' },
      type: 'deleteCanvas',
      revision: 1
    })

    const pending = await prepareS3LegacyMigration(scope(profileId), {
      localStore,
      outbox,
      stateStore
    })
    expect(pending).toMatchObject({
      requiresConfirmation: true,
      unfinishedDocumentCount: 1,
      deleteDocumentCount: 1,
      jobCount: 1
    })
    await confirmS3LegacyMigration(
      { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
      { localStore, outbox, stateStore }
    )

    expect(
      await localStore.getMeta({
        providerId: 's3-compatible',
        profileId,
        documentId: 'legacy-delete',
        authority: AUTHORITY
      })
    ).toMatchObject({ tombstoned: true, syncStatus: 'pending', authority: AUTHORITY })
    expect(await outbox.list()).toEqual([
      expect.objectContaining({
        type: 'deleteCanvas',
        binding: expect.objectContaining({ authority: AUTHORITY })
      })
    ])
  })

  test('fails closed on a target generation collision without moving the source', async () => {
    const localStore = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const stateStore = createMemoryS3LegacyMigrationStateStore()
    const profileId = `collision-${crypto.randomUUID()}`
    await seedLegacyCanvas(localStore, profileId, 'same-document', 'pending')
    await localStore.writeCanvas({
      id: 'same-document',
      providerId: 's3-compatible',
      profileId,
      authority: AUTHORITY,
      name: 'Current generation',
      figBytes: new Uint8Array([9]),
      syncStatus: 'pending'
    })
    const pending = await prepareS3LegacyMigration(scope(profileId), {
      localStore,
      outbox,
      stateStore
    })

    await expect(
      confirmS3LegacyMigration(
        { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
        { localStore, outbox, stateStore }
      )
    ).rejects.toThrow('target already exists')
    expect(
      await localStore.readFig({
        providerId: 's3-compatible',
        profileId,
        documentId: 'same-document'
      })
    ).toEqual(new Uint8Array([1, 2, 3]))
    expect(
      await localStore.readFig({
        providerId: 's3-compatible',
        profileId,
        documentId: 'same-document',
        authority: AUTHORITY
      })
    ).toEqual(new Uint8Array([9]))
  })

  test('resumes after local rekey succeeds but outbox replacement is interrupted', async () => {
    const localStore = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const stateStore = createMemoryS3LegacyMigrationStateStore()
    const profileId = `restart-local-${crypto.randomUUID()}`
    await seedLegacyCanvas(localStore, profileId, 'restart', 'pending')
    await outbox.enqueue({
      binding: { providerId: 's3-compatible', profileId, documentId: 'restart' },
      type: 'putCanvas',
      revision: 1
    })
    const pending = await prepareS3LegacyMigration(scope(profileId), {
      localStore,
      outbox,
      stateStore
    })
    const interruptedOutbox: Outbox = {
      ...outbox,
      replaceLegacyAuthority: () => Promise.reject(new Error('simulated restart'))
    }

    await expect(
      confirmS3LegacyMigration(
        { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
        { localStore, outbox: interruptedOutbox, stateStore }
      )
    ).rejects.toThrow('simulated restart')
    expect((await outbox.list())[0]?.binding.authority).toBeUndefined()
    resetLocalCanvasStoreForTests(localStore)
    resetOutboxForTests(outbox)
    try {
      expect(await recoverStorageSyncJobs()).toBe(1)
      expect(await outbox.list()).toHaveLength(2)
      const resumed = await prepareS3LegacyMigration(scope(profileId), {
        localStore,
        outbox,
        stateStore
      })
      await expect(
        confirmS3LegacyMigration(
          { ...scope(profileId), confirmedConfigurationIdentity: resumed.configurationIdentity },
          { localStore, outbox, stateStore }
        )
      ).resolves.toMatchObject({ status: 'complete' })
      expect(await outbox.list()).toEqual([
        expect.objectContaining({
          binding: expect.objectContaining({ authority: AUTHORITY }),
          type: 'putCanvas',
          revision: 1
        })
      ])
    } finally {
      resetLocalCanvasStoreForTests()
      resetOutboxForTests()
    }
  })

  test('rejects incompatible or older recovery jobs and another S3 generation', async () => {
    const profileId = `outbox-collision-${crypto.randomUUID()}`
    const legacyBinding = {
      providerId: 's3-compatible',
      profileId,
      documentId: 'collision'
    }
    const replacement = {
      providerId: 's3-compatible',
      profileId,
      nextAuthority: AUTHORITY
    }

    const older = createMemoryOutbox()
    await older.enqueue({ binding: legacyBinding, type: 'putCanvas', revision: 2 })
    await older.enqueue({
      binding: { ...legacyBinding, authority: AUTHORITY },
      type: 'putCanvas',
      revision: 1
    })
    await expect(older.replaceLegacyAuthority(replacement)).rejects.toThrow('older revision')

    const anotherGeneration = createMemoryOutbox()
    await anotherGeneration.enqueue({ binding: legacyBinding, type: 'putCanvas', revision: 1 })
    await anotherGeneration.enqueue({
      binding: {
        ...legacyBinding,
        authority: { ...AUTHORITY, authorizationVersion: 'c'.repeat(32) }
      },
      type: 'putCanvas',
      revision: 1
    })
    await expect(anotherGeneration.replaceLegacyAuthority(replacement)).rejects.toThrow(
      'another authorization generation'
    )

    const incompatibleDelete = createMemoryOutbox()
    await incompatibleDelete.enqueue({ binding: legacyBinding, type: 'deleteCanvas', revision: 0 })
    await incompatibleDelete.enqueue({
      binding: { ...legacyBinding, authority: AUTHORITY },
      type: 'putCanvas',
      revision: 1
    })
    await expect(incompatibleDelete.replaceLegacyAuthority(replacement)).rejects.toThrow(
      'delete conflicts with recovered upload'
    )
  })

  test('completes idempotently after outbox replacement wins but state commit is interrupted', async () => {
    const localStore = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const durableState = createMemoryS3LegacyMigrationStateStore()
    const profileId = `restart-state-${crypto.randomUUID()}`
    await outbox.enqueue({
      binding: { providerId: 's3-compatible', profileId, documentId: 'restart-state' },
      type: 'deleteCanvas',
      revision: 0
    })
    const pending = await prepareS3LegacyMigration(scope(profileId), {
      localStore,
      outbox,
      stateStore: durableState
    })
    let interruptComplete = true
    const interruptedState: S3LegacyMigrationStateStore = {
      read: (id) => durableState.read(id),
      remove: (id) => durableState.remove(id),
      write(id, state) {
        if (state.status === 'complete' && interruptComplete) {
          interruptComplete = false
          throw new Error('simulated state commit restart')
        }
        durableState.write(id, state)
      }
    }

    await expect(
      confirmS3LegacyMigration(
        { ...scope(profileId), confirmedConfigurationIdentity: pending.configurationIdentity },
        { localStore, outbox, stateStore: interruptedState }
      )
    ).rejects.toThrow('simulated state commit restart')
    expect((await outbox.list())[0]?.binding.authority).toEqual(AUTHORITY)

    await expect(
      prepareS3LegacyMigration(scope(profileId), {
        localStore,
        outbox,
        stateStore: durableState
      })
    ).resolves.toMatchObject({ status: 'complete', requiresConfirmation: false })
  })

  test('keeps IndexedDB delete, collision, and restart recovery fail-closed', async () => {
    const suffix = crypto.randomUUID()
    const localStore = createIdbLocalCanvasStore(`open-pencil-test-s3-safety-local-${suffix}`)
    const outbox = createIdbOutbox(`open-pencil-test-s3-safety-outbox-${suffix}`)

    const deleteProfile = `idb-delete-${suffix}`
    const deleteState = createMemoryS3LegacyMigrationStateStore()
    await seedLegacyCanvas(localStore, deleteProfile, 'deleted')
    await localStore.tombstone({
      providerId: 's3-compatible',
      profileId: deleteProfile,
      documentId: 'deleted'
    })
    await outbox.enqueue({
      binding: {
        providerId: 's3-compatible',
        profileId: deleteProfile,
        documentId: 'deleted'
      },
      type: 'deleteCanvas',
      revision: 0
    })
    const deletePending = await prepareS3LegacyMigration(scope(deleteProfile), {
      localStore,
      outbox,
      stateStore: deleteState
    })
    await confirmS3LegacyMigration(
      {
        ...scope(deleteProfile),
        confirmedConfigurationIdentity: deletePending.configurationIdentity
      },
      { localStore, outbox, stateStore: deleteState }
    )
    expect(
      await localStore.getMeta({
        providerId: 's3-compatible',
        profileId: deleteProfile,
        documentId: 'deleted',
        authority: AUTHORITY
      })
    ).toMatchObject({ tombstoned: true, authority: AUTHORITY })

    const collisionProfile = `idb-collision-${suffix}`
    const collisionState = createMemoryS3LegacyMigrationStateStore()
    await seedLegacyCanvas(localStore, collisionProfile, 'collision')
    await localStore.writeCanvas({
      id: 'collision',
      providerId: 's3-compatible',
      profileId: collisionProfile,
      authority: AUTHORITY,
      name: 'Generation target',
      figBytes: new Uint8Array([9]),
      syncStatus: 'pending'
    })
    const collisionPending = await prepareS3LegacyMigration(scope(collisionProfile), {
      localStore,
      outbox,
      stateStore: collisionState
    })
    await expect(
      confirmS3LegacyMigration(
        {
          ...scope(collisionProfile),
          confirmedConfigurationIdentity: collisionPending.configurationIdentity
        },
        { localStore, outbox, stateStore: collisionState }
      )
    ).rejects.toThrow('target already exists')
    expect(
      await localStore.readFig({
        providerId: 's3-compatible',
        profileId: collisionProfile,
        documentId: 'collision'
      })
    ).toEqual(new Uint8Array([1, 2, 3]))

    const restartProfile = `idb-restart-${suffix}`
    const restartState = createMemoryS3LegacyMigrationStateStore()
    await seedLegacyCanvas(localStore, restartProfile, 'restart', 'pending')
    await outbox.enqueue({
      binding: {
        providerId: 's3-compatible',
        profileId: restartProfile,
        documentId: 'restart'
      },
      type: 'putCanvas',
      revision: 1
    })
    const restartPending = await prepareS3LegacyMigration(scope(restartProfile), {
      localStore,
      outbox,
      stateStore: restartState
    })
    const interruptedOutbox: Outbox = {
      ...outbox,
      replaceLegacyAuthority: () => Promise.reject(new Error('simulated IDB restart'))
    }
    await expect(
      confirmS3LegacyMigration(
        {
          ...scope(restartProfile),
          confirmedConfigurationIdentity: restartPending.configurationIdentity
        },
        { localStore, outbox: interruptedOutbox, stateStore: restartState }
      )
    ).rejects.toThrow('simulated IDB restart')
    const resumed = await prepareS3LegacyMigration(scope(restartProfile), {
      localStore,
      outbox,
      stateStore: restartState
    })
    await expect(
      confirmS3LegacyMigration(
        { ...scope(restartProfile), confirmedConfigurationIdentity: resumed.configurationIdentity },
        { localStore, outbox, stateStore: restartState }
      )
    ).resolves.toMatchObject({ status: 'complete' })
  })
})
