import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec, SceneGraph, sceneNodeToKiwi } from '@open-pencil/core'
import type { StateDef } from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from '#core/kiwi/fig/node-change/plugin-data'
import {
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_STATE_KEY
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

beforeAll(async () => {
  await initCodec()
})

const ROOT_GUID = { sessionID: 1, localID: 0 }

function exportFirst(graph: SceneGraph, nodeId: string) {
  const node = graph.getNode(nodeId)
  if (!node) throw new Error(`No node ${nodeId}`)
  return sceneNodeToKiwi(node, ROOT_GUID, 0, { value: 100 }, graph, [])[0]
}

describe('export-node lowcode pluginData hook (Phase 1 §12 step 1)', () => {
  test('page with state emits lowcode/state into NodeChange.pluginData', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const state: StateDef[] = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 }
    ]
    graph.updateNode(page.id, { state })

    const nc = exportFirst(graph, page.id)
    const lowcodeEntry = nc.pluginData?.find(
      (entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_STATE_KEY
    )
    expect(lowcodeEntry).toBeDefined()
    expect(JSON.parse(lowcodeEntry?.value ?? '')).toEqual(state)
  })

  test('BUTTON with interactiveProps + onClick events emits NodeType + 2 lowcode entries', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    const btn = graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Go' },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }
        ]
      }
    })

    const nc = exportFirst(graph, btn.id)
    const keys = (nc.pluginData ?? [])
      .filter((entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID)
      .map((entry) => entry.key)
    expect(keys).toContain(LOWCODE_INTERACTIVE_PROPS_KEY)
    expect(keys).toContain(LOWCODE_EVENTS_KEY)
    // NodeType override entry — without it the reimported node demotes to RECTANGLE.
    expect(keys).toContain('lowcode/nodeType')
    expect(keys).not.toContain(LOWCODE_STATE_KEY)
    expect(keys).not.toContain(LOWCODE_BINDINGS_KEY)
  })

  test('node without lowcode fields emits no lowcode entries (byte-identity for legacy .fig)', () => {
    const graph = new SceneGraph()
    const rect = graph.createNode('RECTANGLE', graph.getPages()[0].id, {
      name: 'Plain',
      width: 50,
      height: 50
    })

    const nc = exportFirst(graph, rect.id)
    const lowcode = (nc.pluginData ?? []).filter(
      (entry) =>
        entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key.startsWith('lowcode/')
    )
    expect(lowcode).toEqual([])
  })

  test('pre-existing pluginData entries from other plugins are preserved alongside lowcode ones', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      pluginData: [{ pluginId: 'other-plugin', key: 'foo', value: 'bar' }],
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })

    const nc = exportFirst(graph, page.id)
    const fromOther = nc.pluginData?.find(
      (entry) => entry.pluginID === 'other-plugin' && entry.key === 'foo'
    )
    const fromLowcode = nc.pluginData?.find(
      (entry) => entry.pluginID === OPEN_PENCIL_PLUGIN_ID && entry.key === LOWCODE_STATE_KEY
    )
    expect(fromOther?.value).toBe('bar')
    expect(fromLowcode).toBeDefined()
  })
})
