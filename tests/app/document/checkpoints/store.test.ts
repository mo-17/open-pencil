import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { IDBFactory } from 'fake-indexeddb'

import { createCheckpointStore } from '@/app/document/checkpoints/store'
import {
  assertCheckpointCapacity,
  CHECKPOINT_LIMITS,
  type CheckpointInput
} from '@/app/document/checkpoints/types'
import { createIdbRecoveryStore } from '@/app/document/recovery/idb'

const input: CheckpointInput = {
  scope: 'file:/test/design.fig',
  name: 'Before redesign',
  documentName: 'Design',
  kind: 'named',
  figBytes: new Uint8Array([1, 2, 3])
}

describe('local document checkpoint storage', () => {
  const original = indexedDB
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })
  afterAll(() => {
    globalThis.indexedDB = original
  })

  test('persists named owned bytes independently of automatic recovery', async () => {
    const store = createCheckpointStore()
    const source = new Uint8Array(input.figBytes)
    const meta = await store.write({ ...input, figBytes: source, name: '  Version one  ' })
    source[0] = 9
    expect(meta.name).toBe('Version one')
    expect(await createCheckpointStore().read(meta.id)).toEqual({
      ...meta,
      figBytes: input.figBytes
    })
    const read = await store.read(meta.id)
    if (read) read.figBytes[0] = 8
    expect((await store.read(meta.id))?.figBytes[0]).toBe(1)
    expect(await createIdbRecoveryStore().list()).toEqual([])
    await store.remove(meta.id)
    expect(await store.read(meta.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })

  test('rejects invalid names and empty snapshots before persisting metadata', async () => {
    const store = createCheckpointStore()
    await expect(store.write({ ...input, name: ' ' })).rejects.toThrow('invalid')
    await expect(store.write({ ...input, name: 'x'.repeat(81) })).rejects.toThrow('invalid')
    await expect(store.write({ ...input, figBytes: new Uint8Array() })).rejects.toThrow('invalid')
    expect(await store.list()).toEqual([])
  })

  test('capacity checks include every document and never evict earlier checkpoints', async () => {
    const store = createCheckpointStore()
    const metadata = await store.write(input)
    const sameDocument = Array.from({ length: CHECKPOINT_LIMITS.maxPerDocument }, (_, index) => ({
      ...metadata,
      id: `${index}`
    }))
    expect(() => assertCheckpointCapacity(sameDocument, metadata)).toThrow('limit')
    const allDocuments = Array.from({ length: CHECKPOINT_LIMITS.maxCount }, (_, index) => ({
      ...metadata,
      id: `${index}`,
      scope: `scope-${index}`
    }))
    expect(() => assertCheckpointCapacity(allDocuments, metadata)).toThrow('limit')
    const large = Array.from({ length: 4 }, (_, index) => ({
      ...metadata,
      id: `${index}`,
      byteLength: CHECKPOINT_LIMITS.maxSnapshotBytes
    }))
    expect(() => assertCheckpointCapacity(large, metadata)).toThrow('limit')
    expect(await store.list()).toEqual([metadata])
  })

  test('serialized transactions enforce capacity across independent store connections', async () => {
    const first = createCheckpointStore()
    const second = createCheckpointStore()
    for (let i = 0; i < CHECKPOINT_LIMITS.maxPerDocument - 1; i++) await first.write(input)
    const results = await Promise.allSettled([first.write(input), second.write(input)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(await first.list()).toHaveLength(CHECKPOINT_LIMITS.maxPerDocument)
  })
})
