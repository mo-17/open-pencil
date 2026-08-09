import { describe, expect, test } from 'bun:test'

import type { StorageDocumentBinding } from '@/app/integrations/storage'
import type { LocalCanvasMeta } from '@/app/storage/local-store'
import { hasBlockingStorageProfileWork } from '@/app/storage/profile-removal'
import type { OutboxJob } from '@/app/storage/sync'

const TARGET = { providerId: 'google-drive', profileId: 'profile-target' } as const

function binding(overrides: Partial<StorageDocumentBinding> = {}): StorageDocumentBinding {
  return { ...TARGET, documentId: 'document-1', ...overrides }
}

function meta(overrides: Partial<LocalCanvasMeta> = {}): LocalCanvasMeta {
  return {
    key: 'key',
    ...binding(),
    authority: null,
    name: 'Canvas',
    updatedAt: '2026-08-10T00:00:00.000Z',
    revision: 1,
    syncStatus: 'synced',
    lastSyncedAt: '2026-08-10T00:00:00.000Z',
    lastSyncError: null,
    remoteRevision: null,
    tombstoned: false,
    hasFig: true,
    hasThumb: false,
    ...overrides
  }
}

function job(overrides: Partial<OutboxJob> = {}): OutboxJob {
  return {
    id: 'job-1',
    binding: binding(),
    type: 'putCanvas',
    revision: 1,
    createdAt: 1,
    attempts: 0,
    nextAttemptAt: 1,
    expectedRemoteRevision: null,
    ...overrides
  }
}

describe('storage profile removal preflight', () => {
  test('allows a profile whose local mirrors are fully synchronized', () => {
    expect(hasBlockingStorageProfileWork(TARGET.providerId, TARGET.profileId, [meta()], [])).toBe(
      false
    )
  })

  test('blocks every durable unsynchronized local state', () => {
    for (const syncStatus of ['pending', 'error', 'conflict'] as const) {
      expect(
        hasBlockingStorageProfileWork(
          TARGET.providerId,
          TARGET.profileId,
          [meta({ syncStatus })],
          []
        )
      ).toBe(true)
    }
    expect(
      hasBlockingStorageProfileWork(
        TARGET.providerId,
        TARGET.profileId,
        [meta({ tombstoned: true })],
        []
      )
    ).toBe(true)
    expect(hasBlockingStorageProfileWork(TARGET.providerId, TARGET.profileId, [], [job()])).toBe(
      true
    )
  })

  test('does not let work owned by another exact profile block deletion', () => {
    expect(
      hasBlockingStorageProfileWork(
        TARGET.providerId,
        TARGET.profileId,
        [meta({ profileId: 'profile-other', syncStatus: 'error' })],
        [job({ binding: binding({ profileId: 'profile-other' }) })]
      )
    ).toBe(false)
  })
})
