import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'

import type { SceneGraph } from '@open-pencil/core/scene-graph'

import { createYjsGraphSync, registerYjsObservers } from '@/app/collab/yjs-sync'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §4.1 — in-process simulation of two collaborating peers, since a
 * live two-client Tauri test isn't runnable here. Two SceneGraphs share one
 * Yjs doc (Trystero just relays the same CRDT updates over WebRTC, so a shared
 * doc faithfully exercises the serialize → observe → apply path). Peer A sets a
 * lowcode binding on a node and syncs it; peer B's observer must apply it back
 * as an OBJECT, not the JSON string that leaked before §4.1.
 */
type StoreStub = { graph: SceneGraph; requestRender: () => void }

const noop = (): void => undefined

function stub(graph: SceneGraph): StoreStub {
  return { graph, requestRender: noop }
}

describe('collab two-peer lowcode sync (Phase 3 §4.1)', () => {
  test('peer A binding/event/docState edits arrive at peer B as objects', () => {
    const ydoc = new Y.Doc()
    const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
    const yimages = ydoc.getMap<Uint8Array>('images')

    // Peer A — writes into the shared doc.
    const graphA = makeSceneGraph()
    const nodeA = graphA.createNode('INPUT', firstPageId(graphA))
    let suppressA = false
    const syncA = createYjsGraphSync({
      getStore: () => stub(graphA),
      getYdoc: () => ydoc,
      getYnodes: () => ynodes,
      getYimages: () => yimages,
      setSuppressYjsEvents: (v) => {
        suppressA = v
      }
    })

    // Peer B — already has the same node (both peers loaded the same doc);
    // observes the shared doc and applies remote changes to its own graph.
    const graphB = makeSceneGraph()
    const nodeB = graphB.createNode('INPUT', firstPageId(graphB))
    // Both peers share the node id (they synced the same initial document).
    graphB.nodes.delete(nodeB.id)
    nodeB.id = nodeA.id
    graphB.nodes.set(nodeA.id, nodeB)

    let suppressB = false
    const syncB = createYjsGraphSync({
      getStore: () => stub(graphB),
      getYdoc: () => ydoc,
      getYnodes: () => ynodes,
      getYimages: () => yimages,
      setSuppressYjsEvents: (v) => {
        suppressB = v
      }
    })
    registerYjsObservers({
      store: stub(graphB),
      ynodes,
      yimages,
      getSuppressYjsEvents: () => suppressB,
      setSuppressGraphSync: noop,
      applyYjsToGraph: syncB.applyYjsToGraph
    })

    // Peer A edits lowcode fields, then syncs the node into the shared doc →
    // B's observeDeep fires → applyYjsToGraph → graphB.updateNode.
    const bindings = { value: { kind: 'docState', docStateName: 'emailInput' } }
    const events = { onClick: [{ id: 'a1', kind: 'navigate', to: '/done' }] }
    const lowcodeDocumentState = [{ id: 'd1', name: 'rows', type: 'array', defaultValue: [] }]
    graphA.updateNode(nodeA.id, { bindings, events, lowcodeDocumentState })
    syncA.syncNodeToYjs(nodeA.id)

    void suppressA
    const received = graphB.getNode(nodeA.id)
    expect(received).toBeDefined()
    expect(typeof received?.bindings).toBe('object')
    expect(received?.bindings).toEqual(bindings)
    expect(received?.events).toEqual(events)
    expect(received?.lowcodeDocumentState).toEqual(lowcodeDocumentState)
  })
})
