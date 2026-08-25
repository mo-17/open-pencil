import { describe, expect, test } from 'bun:test'

import { ONEDRIVE_STORAGE_PROVIDER_ID } from '@/app/integrations/storage/onedrive/config'
import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { createMemoryLocalCanvasStore } from '@/app/storage/local-store'
import {
  adoptStorageAuthorizationWork,
  listStorageProfileAuthorizationWork
} from '@/app/storage/sync/authorization-lifecycle'
import { createMemoryOutbox } from '@/app/storage/sync/outbox'

const PREVIOUS: StorageDocumentAuthority = {
  accountId: 'microsoft-subject-a',
  authorizationVersion: 'a'.repeat(32)
}
const NEXT: StorageDocumentAuthority = {
  accountId: PREVIOUS.accountId,
  authorizationVersion: 'b'.repeat(32)
}

describe('OneDrive authorization work lifecycle', () => {
  test('adopts same-account crash-gap rows and jobs into the replacement grant', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const profileId = 'work'
    const binding = {
      providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
      profileId,
      documentId: 'document-a',
      authority: PREVIOUS
    }
    await store.writeCanvas({
      ...binding,
      id: binding.documentId,
      name: 'Pending.fig',
      figBytes: new Uint8Array([1, 2, 3]),
      syncStatus: 'pending'
    })
    await outbox.enqueue({
      binding,
      type: 'putCanvas',
      revision: 1,
      expectedRemoteRevision: null
    })
    const dependencies = { store, outbox, recover: () => Promise.resolve(1) }

    await expect(
      listStorageProfileAuthorizationWork(
        { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId },
        dependencies
      )
    ).resolves.toEqual([
      expect.objectContaining({
        scope: { providerId: ONEDRIVE_STORAGE_PROVIDER_ID, profileId, authority: PREVIOUS },
        unfinishedDocumentCount: 1,
        jobCount: 1,
        requiresConfirmation: true
      })
    ])

    await expect(
      adoptStorageAuthorizationWork(
        {
          providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
          profileId,
          previousAuthority: PREVIOUS,
          nextAuthority: NEXT
        },
        dependencies
      )
    ).resolves.toEqual({
      adoptedDocumentCount: 1,
      replacedJobCount: 1,
      recoveredJobCount: 1
    })
    expect((await store.getMeta(binding))?.authority).toEqual(NEXT)
    expect((await outbox.list()).map((job) => job.binding.authority)).toEqual([NEXT])
  })

  test('rejects different-account adoption before mutating local state', async () => {
    const store = createMemoryLocalCanvasStore()
    const outbox = createMemoryOutbox()
    const profileId = 'work'
    const binding = {
      providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
      profileId,
      documentId: 'document-a',
      authority: PREVIOUS
    }
    await store.writeCanvas({
      ...binding,
      id: binding.documentId,
      name: 'Synced.fig',
      figBytes: new Uint8Array([1]),
      syncStatus: 'synced'
    })

    await expect(
      adoptStorageAuthorizationWork(
        {
          providerId: ONEDRIVE_STORAGE_PROVIDER_ID,
          profileId,
          previousAuthority: PREVIOUS,
          nextAuthority: {
            accountId: 'microsoft-subject-b',
            authorizationVersion: NEXT.authorizationVersion
          }
        },
        { store, outbox, recover: () => Promise.resolve(0) }
      )
    ).rejects.toThrow('same account')
    expect((await store.getMeta(binding))?.authority).toEqual(PREVIOUS)
  })
})
