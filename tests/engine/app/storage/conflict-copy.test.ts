import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'

import type { StorageDocumentBinding } from '@/app/integrations/storage'
import { createMemoryLocalCanvasStore, type LocalCanvasStore } from '@/app/storage/local-store'
import { createIdbLocalCanvasStore } from '@/app/storage/local-store/idb'
import { conflictCopyIndexName, recordStorageConflictCopy } from '@/app/storage/sync/engine'

import { expectDefined } from '#tests/helpers/assert'
import { repoPath } from '#tests/helpers/paths'

const AUTHORITY = { accountId: 'subject-work', authorizationVersion: 'grant-random' }

function binding(id: string): StorageDocumentBinding {
  return {
    providerId: 'google-drive',
    profileId: 'work',
    documentId: id,
    authority: AUTHORITY
  }
}

async function exerciseConflictCopy(store: LocalCanvasStore, prefix: string): Promise<void> {
  const originalBinding = binding(`${prefix}-original`)
  const copyId = `${prefix}-copy`
  const originalBytes = new Uint8Array([1, 3, 5, 7])
  await store.writeCanvas({
    id: originalBinding.documentId,
    providerId: originalBinding.providerId,
    profileId: originalBinding.profileId,
    authority: originalBinding.authority,
    name: 'Campaign.fig',
    updatedAt: '2026-08-09T01:00:00.000Z',
    figBytes: originalBytes,
    syncStatus: 'pending',
    remoteRevision: { version: '4', etag: 'etag-old' }
  })

  await recordStorageConflictCopy(
    store,
    originalBinding,
    { name: 'Campaign.fig' },
    {
      outcome: 'conflict-copy',
      remoteRevision: { version: '5', etag: 'etag-remote' },
      conflictDocumentId: copyId,
      conflictCopyRevision: { version: '1', etag: 'etag-copy' }
    },
    new Date('2026-08-09T02:03:04.000Z')
  )

  expect(await store.getMeta(originalBinding)).toMatchObject({
    id: originalBinding.documentId,
    syncStatus: 'conflict',
    conflictCopyDocumentId: copyId,
    remoteRevision: { version: '5', etag: 'etag-remote' }
  })
  expect(await store.getMeta(binding(copyId))).toMatchObject({
    id: copyId,
    authority: AUTHORITY,
    name: 'Campaign (preserved conflict copy).fig',
    updatedAt: '2026-08-09T02:03:04.000Z',
    syncStatus: 'synced',
    conflictOfDocumentId: originalBinding.documentId,
    remoteRevision: { version: '1', etag: 'etag-copy' },
    hasFig: false
  })
  expect(await store.readFig(binding(copyId))).toBeNull()
  expect([...expectDefined(await store.readFig(originalBinding))]).toEqual([...originalBytes])
  expect((await store.listMetas()).map(({ id }) => id)).toContain(copyId)

  await store.writeCanvas({
    id: copyId,
    providerId: originalBinding.providerId,
    profileId: originalBinding.profileId,
    authority: originalBinding.authority,
    name: 'Downloaded conflict copy.fig',
    figBytes: new Uint8Array([9, 9]),
    syncStatus: 'synced'
  })
  await recordStorageConflictCopy(
    store,
    originalBinding,
    { name: 'Campaign.fig' },
    {
      outcome: 'conflict-copy',
      remoteRevision: { version: '5', etag: 'etag-remote' },
      conflictDocumentId: copyId,
      conflictCopyRevision: { version: '1', etag: 'etag-copy' }
    },
    new Date('2026-08-09T02:03:04.000Z')
  )
  expect((await store.getMeta(binding(copyId)))?.hasFig).toBe(true)
  expect([...expectDefined(await store.readFig(binding(copyId)))]).toEqual([9, 9])
}

async function exerciseStaleConflictResult(store: LocalCanvasStore, prefix: string): Promise<void> {
  const staleBinding = binding(`${prefix}-original`)
  const currentBinding: StorageDocumentBinding = {
    ...staleBinding,
    authority: { accountId: AUTHORITY.accountId, authorizationVersion: 'grant-replaced' }
  }
  await store.writeCanvas({
    id: staleBinding.documentId,
    providerId: staleBinding.providerId,
    profileId: staleBinding.profileId,
    authority: staleBinding.authority,
    name: 'Old grant.fig',
    figBytes: new Uint8Array([1]),
    syncStatus: 'pending'
  })
  await store.writeCanvas({
    id: currentBinding.documentId,
    providerId: currentBinding.providerId,
    profileId: currentBinding.profileId,
    authority: currentBinding.authority,
    name: 'Current grant.fig',
    figBytes: new Uint8Array([2]),
    syncStatus: 'pending'
  })

  const recorded = await recordStorageConflictCopy(
    store,
    staleBinding,
    { name: 'Old grant.fig' },
    {
      outcome: 'conflict-copy',
      remoteRevision: { version: '8', etag: 'etag-remote' },
      conflictDocumentId: `${prefix}-stale-copy`,
      conflictCopyRevision: { version: '1', etag: 'etag-copy' }
    },
    new Date('2026-08-09T02:03:04.000Z'),
    1
  )

  expect(recorded).toBe(false)
  expect(await store.getMeta(currentBinding)).toMatchObject({
    authority: currentBinding.authority,
    name: 'Current grant.fig',
    revision: 2,
    syncStatus: 'pending'
  })
  expect(await store.getMeta(binding(`${prefix}-stale-copy`))).toBeNull()
}

describe('Google Drive conflict-copy local visibility', () => {
  test('atomically indexes the copy in memory without fabricating .fig bytes', async () => {
    await exerciseConflictCopy(createMemoryLocalCanvasStore(), 'memory')
  })

  test('indexes the copy with the same semantics in IndexedDB', async () => {
    await exerciseConflictCopy(createIdbLocalCanvasStore(), `idb-${crypto.randomUUID()}`)
  })

  test('does not record a late conflict result after the local grant is replaced', async () => {
    await exerciseStaleConflictResult(createMemoryLocalCanvasStore(), 'memory-stale')
    await exerciseStaleConflictResult(
      createIdbLocalCanvasStore(),
      `idb-stale-${crypto.randomUUID()}`
    )
  })

  test('keeps the temporary local name valid and bounded for card/a11y output', () => {
    const name = conflictCopyIndexName(`${'画'.repeat(400)}\u0000/unsafe.fig`)
    expect(new TextEncoder().encode(name).byteLength).toBeLessThanOrEqual(512)
    expect(name).toEndWith(' (preserved conflict copy).fig')
    expect(
      [...name].some((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 || character === '/' || character === '\\'
      })
    ).toBe(false)
  })

  test('card exposes a full accessible label and clamps progress to its visual range', async () => {
    const source = await Bun.file(
      repoPath('src/components/storage/StorageWorkspaceDocumentCard.vue')
    ).text()
    expect(source).toContain(':aria-label="accessibleLabel"')
    expect(source).toContain(':data-preserved-copy="preservedCopy || undefined"')
    expect(source).toContain('Math.min(1, Math.max(0, progress))')
  })
})
