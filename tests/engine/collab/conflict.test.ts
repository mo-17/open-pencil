import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { docStateApplyLosesLocal } from '@/app/collab/conflict'
import { createYjsGraphSync, registerYjsObservers } from '@/app/collab/yjs-sync'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §4.5 — docState collaboration conflict detection.
 *
 * Lowcode collection fields (page `state`, `lowcodeDocumentState`) round-trip
 * through Yjs as one opaque JSON blob → whole-field last-write-wins, so applying
 * a remote value can silently drop a concurrent local entry (probe-confirmed).
 * `docStateApplyLosesLocal(local, remote)` is the passive detector: true exactly
 * when applying `remote` would lose local information (local ⊄ remote).
 *
 * Single-process scope (experience K boundary): this asserts the detection
 * contract. Real two-peer propagation is deferred to two-machine verification.
 */

const count = { id: 'c', name: 'count', type: 'number', defaultValue: 0 }
const name = { id: 'n', name: 'name', type: 'string', defaultValue: '' }

describe('docStateApplyLosesLocal (Phase 3 §4.5)', () => {
  test('local has an entry the remote lacks → loses local (the §4.5 bug)', () => {
    // Concurrent: local added `name`, the winning remote added `count`.
    expect(docStateApplyLosesLocal([name], [count])).toBe(true)
  })

  test('same id with a different value → overwrites the local edit', () => {
    const localEdited = [{ ...count, defaultValue: 42 }]
    expect(docStateApplyLosesLocal(localEdited, [count])).toBe(true)
  })

  test('local ⊆ remote (pure sequential append) → no loss', () => {
    expect(docStateApplyLosesLocal([count], [count, name])).toBe(false)
  })

  test('identical → no loss', () => {
    expect(docStateApplyLosesLocal([count, name], [count, name])).toBe(false)
  })

  test('empty local → no loss', () => {
    expect(docStateApplyLosesLocal([], [count])).toBe(false)
  })

  test('non-array inputs (e.g. supabaseConfig object) → not flagged passively', () => {
    expect(docStateApplyLosesLocal({ url: 'a' }, { url: 'b' })).toBe(false)
    expect(docStateApplyLosesLocal(undefined, [count])).toBe(false)
  })

  test('entries without ids fall back to name matching', () => {
    const a = { name: 'a', type: 'string' }
    const b = { name: 'b', type: 'string' }
    expect(docStateApplyLosesLocal([a], [b])).toBe(true)
    expect(docStateApplyLosesLocal([a], [a, b])).toBe(false)
  })
})

const noop = (): void => undefined

/**
 * Integration: the apply path (createYjsGraphSync → applyYnodeToGraph) must
 * invoke the registered conflict handler when an incoming remote `state` update
 * would overwrite a concurrent local edit. B holds a local `name` entry the
 * incoming remote `count` lacks, so applying it drops `name` → handler fires.
 * (Deterministic — we don't rely on which side wins the CRDT register tie.)
 */
describe('conflict reporting through the apply path (Phase 3 §4.5)', () => {
  test('incoming remote state that would drop a local entry fires the handler', () => {
    const docA = new Y.Doc()
    const ynodesA = docA.getMap<Y.Map<unknown>>('nodes')
    const docB = new Y.Doc()
    const ynodesB = docB.getMap<Y.Map<unknown>>('nodes')

    const graphA = makeSceneGraph()
    const nodeA = graphA.createNode('FRAME', firstPageId(graphA))
    const graphB = makeSceneGraph()
    const nodeB = graphB.createNode('FRAME', firstPageId(graphB))
    graphB.nodes.delete(nodeB.id)
    nodeB.id = nodeA.id
    graphB.nodes.set(nodeA.id, nodeB)

    const conflictsB: string[] = []
    const syncA = createYjsGraphSync({
      getStore: () => ({ graph: graphA, requestRender: noop }),
      getYdoc: () => docA,
      getYnodes: () => ynodesA,
      getYimages: () => null,
      setSuppressYjsEvents: noop
    })
    const syncB = createYjsGraphSync({
      getStore: () => ({ graph: graphB, requestRender: noop }),
      getYdoc: () => docB,
      getYnodes: () => ynodesB,
      getYimages: () => null,
      setSuppressYjsEvents: noop,
      getConflictHandler: () => (kind: string) => conflictsB.push(kind)
    })
    registerYjsObservers({
      store: { graph: graphB, requestRender: noop },
      ynodes: ynodesB,
      yimages: docB.getMap('images'),
      getSuppressYjsEvents: () => false,
      setSuppressGraphSync: noop,
      applyYjsToGraph: syncB.applyYjsToGraph
    })

    // B has a local `name` entry (not yet synced to its doc).
    graphB.updateNode(nodeA.id, {
      state: [{ id: 'n', name: 'name', type: 'string', defaultValue: '' }]
    } as never)
    // A authors `count` and syncs; A's update arrives at B → B's observer applies
    // it (whole-field replace) → B's local `name` would be dropped → handler fires.
    graphA.updateNode(nodeA.id, {
      state: [{ id: 'c', name: 'count', type: 'number', defaultValue: 0 }]
    } as never)
    syncA.syncNodeToYjs(nodeA.id)
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA))

    expect(conflictsB).toContain('state')
  })
})
