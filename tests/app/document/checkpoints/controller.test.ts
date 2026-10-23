import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import { IDBFactory } from 'fake-indexeddb'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createCheckpointController } from '@/app/document/checkpoints/controller'
import { createCheckpointStore } from '@/app/document/checkpoints/store'
import { CHECKPOINT_LIMITS } from '@/app/document/checkpoints/types'
import { createDeferred } from '@/app/runtime/deferred'

describe('document checkpoint lifecycle', () => {
  const original = indexedDB
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory()
  })
  afterAll(() => {
    globalThis.indexedDB = original
  })

  function fixture() {
    const store = createCheckpointStore()
    const opened: { bytes: Uint8Array; name: string }[] = []
    let scope = 'session:original'
    let current = true
    let revision = 0
    let capture: () => Promise<Uint8Array> = async () => new Uint8Array([4, 5, 6])
    let readGraph = async () => new SceneGraph()
    const released: SceneGraph[] = []
    const controller = createCheckpointController(
      {
        scope: () => scope,
        name: () => 'Design',
        current: () => current,
        revision: () => revision,
        capture: () => capture()
      },
      {
        store,
        readGraph: () => readGraph(),
        releaseGraph: (graph) => {
          released.push(graph)
        },
        openDocument: async (bytes, name) => {
          opened.push({ bytes, name })
        }
      }
    )
    return {
      store,
      controller,
      opened,
      released,
      switchSource: () => {
        scope = 'session:other'
      },
      close: () => {
        current = false
      },
      edit: () => {
        revision++
      },
      readGraph: (next: typeof readGraph) => {
        readGraph = next
      },
      capture: (next: typeof capture) => {
        capture = next
      }
    }
  }

  test('restore persists a safety copy before opening unchanged checkpoint bytes', async () => {
    const f = fixture()
    const old = await f.controller.create('Original')
    f.capture(async () => new Uint8Array([7, 8, 9]))
    await f.controller.restore(old.id, 'Before restore')
    const rows = await f.store.list()
    expect(rows).toHaveLength(2)
    const backup = rows.find((row) => row.kind === 'before-restore')
    expect(backup).toBeDefined()
    expect(backup && (await f.store.read(backup.id))?.figBytes).toEqual(new Uint8Array([7, 8, 9]))
    expect(f.opened).toEqual([{ bytes: new Uint8Array([4, 5, 6]), name: 'Design' }])
    expect(await f.store.read(old.id)).not.toBeNull()
  })

  test('failed backup capacity prevents restore and preserves every existing version', async () => {
    const f = fixture()
    const old = await f.controller.create('Original')
    for (let i = 1; i < CHECKPOINT_LIMITS.maxPerDocument; i++)
      await f.controller.create(`Version ${i}`)
    await expect(f.controller.restore(old.id, 'Before restore')).rejects.toThrow('limit')
    expect(f.opened).toEqual([])
    expect(await f.store.list()).toHaveLength(CHECKPOINT_LIMITS.maxPerDocument)
  })

  test('document replacement or closing during capture cannot write into the new target', async () => {
    for (const invalidate of ['switchSource', 'close'] as const) {
      const f = fixture()
      const deferred = createDeferred<Uint8Array>()
      f.capture(() => deferred.promise)
      const pending = f.controller.create('In flight')
      f[invalidate]()
      deferred.resolve(new Uint8Array([1]))
      await expect(pending).rejects.toThrow('changed')
      expect(await f.store.list()).toEqual([])
      expect(f.opened).toEqual([])
    }
  })

  test('parallel operations are refused and a missing checkpoint cannot open a tab', async () => {
    const f = fixture()
    const deferred = createDeferred<Uint8Array>()
    f.capture(() => deferred.promise)
    const pending = f.controller.create('In flight')
    await expect(f.controller.create('Concurrent')).rejects.toThrow('changed')
    deferred.resolve(new Uint8Array([1]))
    await pending
    await expect(f.controller.restore('missing', 'Backup')).rejects.toThrow('missing')
    expect(f.opened).toEqual([])
  })

  test('comparison releases both decoded graphs without mutating or opening documents', async () => {
    const f = fixture()
    const checkpoint = await f.controller.create('Original')
    await f.controller.compare(checkpoint.id)
    expect(f.released).toHaveLength(2)
    expect(f.opened).toEqual([])
    expect(await f.store.list()).toHaveLength(1)
  })

  test('edits while a FIG is decoding invalidate comparison and release its graph', async () => {
    const f = fixture()
    const checkpoint = await f.controller.create('Original')
    const decoding = createDeferred<SceneGraph>()
    const entered = createDeferred<undefined>()
    f.readGraph(() => {
      entered.resolve(undefined)
      return decoding.promise
    })
    const pending = f.controller.compare(checkpoint.id)
    await entered.promise
    f.edit()
    const graph = new SceneGraph()
    decoding.resolve(graph)
    await expect(pending).rejects.toThrow('changed')
    expect(f.released).toEqual([graph])
    expect(f.opened).toEqual([])
  })
})
