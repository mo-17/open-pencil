import { describe, expect, test } from 'bun:test'

import {
  StorageProfileOpenDocumentsError,
  storageProfileHasOpenTabs,
  withStorageProfileMutationDrain,
  withStorageProfileMutationLease,
  type StorageProfileMutationLease
} from '@/app/storage/mutation-drain'

const SCOPE = { providerId: 'google-drive', profileId: 'mutation-drain' } as const

describe('storage profile mutation drain', () => {
  test('waits for a deferred cloud create to finish reserving, binding, and saving', async () => {
    const scope = { providerId: 'google-drive', profileId: 'create-race' } as const
    const reserveStarted = Promise.withResolvers<undefined>()
    const continueToSave = Promise.withResolvers<undefined>()
    const events: string[] = []
    const creating = withStorageProfileMutationLease(scope, async (lease) => {
      events.push('reserve')
      reserveStarted.resolve(undefined)
      await continueToSave.promise
      await withStorageProfileMutationLease(
        scope,
        async () => {
          events.push('persisted')
        },
        lease
      )
      events.push('saved')
    })
    await reserveStarted.promise

    const draining = withStorageProfileMutationDrain(scope, async () => {
      events.push('drained')
    })
    await Promise.resolve()
    expect(events).toEqual(['reserve'])

    continueToSave.resolve(undefined)
    await creating
    await draining
    expect(events).toEqual(['reserve', 'persisted', 'saved', 'drained'])
  })

  test('unfreezes the profile when the exclusive operation fails', async () => {
    await expect(
      withStorageProfileMutationDrain(SCOPE, () => Promise.reject(new Error('revoke failed')))
    ).rejects.toThrow('revoke failed')
    await expect(withStorageProfileMutationLease(SCOPE, () => Promise.resolve('ok'))).resolves.toBe(
      'ok'
    )
  })

  test('rejects forged mutation lease tokens', async () => {
    await expect(
      withStorageProfileMutationLease(
        SCOPE,
        () => Promise.resolve('unexpected'),
        {} as StorageProfileMutationLease
      )
    ).rejects.toBeInstanceOf(TypeError)
  })

  test('rejects an active mutation lease token for a different profile', async () => {
    await withStorageProfileMutationLease(SCOPE, async (lease) => {
      await expect(
        withStorageProfileMutationLease(
          { providerId: 'google-drive', profileId: 'different-profile' },
          () => Promise.resolve('unexpected'),
          lease
        )
      ).rejects.toBeInstanceOf(TypeError)
    })
  })

  test('rejects mutation lease token reuse after the outer lease settles', async () => {
    let expiredLease: StorageProfileMutationLease | undefined
    await withStorageProfileMutationLease(SCOPE, async (lease) => {
      expiredLease = lease
    })
    if (!expiredLease) throw new Error('Expected the outer lease token to be captured')

    await expect(
      withStorageProfileMutationLease(SCOPE, () => Promise.resolve('unexpected'), expiredLease)
    ).rejects.toBeInstanceOf(TypeError)
  })

  test('matches open tabs by stable provider/profile and optional account identity', () => {
    const readers = [
      {
        getStorageBinding: () => ({
          ...SCOPE,
          documentId: 'document-1',
          authority: { accountId: 'subject-1', authorizationVersion: 'grant-1' }
        })
      }
    ]
    expect(storageProfileHasOpenTabs(SCOPE, readers)).toBe(true)
    expect(storageProfileHasOpenTabs({ ...SCOPE, accountId: 'subject-1' }, readers)).toBe(true)
    expect(storageProfileHasOpenTabs({ ...SCOPE, accountId: 'subject-2' }, readers)).toBe(false)
    expect(
      storageProfileHasOpenTabs({ providerId: 'google-drive', profileId: 'other' }, readers)
    ).toBe(false)
    expect(new StorageProfileOpenDocumentsError().name).toBe('StorageProfileOpenDocumentsError')
  })
})
