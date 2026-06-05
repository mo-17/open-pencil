import { describe, expect, test } from 'bun:test'

import type { PluginData } from '#core/kiwi/fig/codec'
import type { ApiCallAction, PluginDataEntry, SceneNode } from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from '#core/kiwi/fig/node-change/plugin-data'
import {
  extractLowcodeAndPluginData,
  LOWCODE_EVENTS_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

/**
 * Phase 2 §3 step 1 — `ApiCallAction` persistence.
 *
 * §3.2 #b: the new action kind rides the existing `lowcode/events`
 * pluginData channel (the events payload is schema-free JSON, so a new
 * `ActionDef` member serialises without a schema change). These tests pin
 * that a GET and a POST `apiCall` survive serialize → extract unchanged,
 * and that a legacy node with no events still emits zero entries.
 */
// `type: 'RECTANGLE'` keeps `serializeLowcodeFields` from also emitting a
// `lowcode/nodeType` entry — these tests only care about the events payload,
// so the node type is irrelevant and a non-lowcode type isolates the entry.
function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'RECTANGLE',
    pluginData: [] as PluginDataEntry[],
    state: undefined,
    bindings: undefined,
    events: undefined,
    interactiveProps: undefined,
    renderCondition: undefined,
    lowcodeDocumentState: undefined,
    ...fields
  } as SceneNode
}

function makeNc(pluginData: PluginData[]): { pluginData: PluginData[] } {
  return { pluginData }
}

const GET_ACTION: ApiCallAction = {
  id: 'a1',
  kind: 'apiCall',
  method: 'GET',
  url: 'https://example.com/users',
  targetName: 'users'
}

const POST_ACTION: ApiCallAction = {
  id: 'a2',
  kind: 'apiCall',
  method: 'POST',
  url: 'https://example.com/users',
  bodyJson: '{"name":"Alice"}',
  targetName: 'result'
}

describe('ApiCallAction persistence (Phase 2 §3)', () => {
  test('a GET apiCall serialises into a single lowcode/events entry', () => {
    const node = makeNode({ events: { onClick: [GET_ACTION] } })
    const entries = serializeLowcodeFields(node)
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe(LOWCODE_EVENTS_KEY)
    expect(entries[0].pluginId).toBe(OPEN_PENCIL_PLUGIN_ID)
    expect(JSON.parse(entries[0].value)).toEqual({ onClick: [GET_ACTION] })
  })

  test('a POST apiCall keeps method + bodyJson through serialize → extract', () => {
    const events = { onClick: [POST_ACTION] }
    const node = makeNode({ events })
    const [entry] = serializeLowcodeFields(node)

    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    expect(result.events).toEqual(events)
    expect(result.pluginData).toEqual([])
  })

  test('apiCall mixed with other action kinds round-trips in order', () => {
    const events = {
      onClick: [
        { id: 'a0', kind: 'setState' as const, targetStateId: 's1', valueExpr: 'count + 1' },
        GET_ACTION
      ]
    }
    const [entry] = serializeLowcodeFields(makeNode({ events }))
    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    expect(result.events).toEqual(events)
  })

  test('Phase 3 §10 v9: apiCall onSuccess/onError + errorTarget round-trip', () => {
    const action: ApiCallAction = {
      id: 'a3',
      kind: 'apiCall',
      method: 'POST',
      url: 'https://example.com/save',
      bodyJson: '{"x":1}',
      targetName: 'result',
      errorTarget: 'lastError',
      onSuccess: [{ id: 't1', kind: 'toast', messageExpr: "'Saved'", variant: 'success' }],
      onError: [{ id: 't2', kind: 'toast', messageExpr: "'Failed'", variant: 'error' }]
    }
    const events = { onClick: [action] }
    const [entry] = serializeLowcodeFields(makeNode({ events }))
    const result = extractLowcodeAndPluginData(
      makeNc([{ pluginID: OPEN_PENCIL_PLUGIN_ID, key: entry.key, value: entry.value }])
    )
    // The nested result-branches ride the same JSON events blob — no codec change.
    expect(result.events).toEqual(events)
  })

  test('legacy node without events emits zero entries (byte-identity)', () => {
    expect(serializeLowcodeFields(makeNode())).toEqual([])
  })
})
