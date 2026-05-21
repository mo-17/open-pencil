import { describe, expect, mock, spyOn, test } from 'bun:test'

import type { PluginData } from '#core/kiwi/binary/codec'
import type { PluginDataEntry, SceneNode } from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from '#core/kiwi/node-change/plugin-data'
import {
  extractLowcodeAndPluginData,
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
  LOWCODE_NODE_TYPE_KEY,
  LOWCODE_RENDER_CONDITION_KEY,
  LOWCODE_STATE_KEY,
  serializeLowcodeFields
} from '#core/kiwi/node-change/lowcode-plugin-data'

/**
 * `serializeLowcodeFields` only reads a handful of fields, so test inputs
 * are built as the minimal SceneNode subset rather than going through
 * `SceneGraph.createNode`. Pruning to the relevant fields keeps the test
 * intent obvious.
 */
function makeNode(fields: Partial<SceneNode> = {}): SceneNode {
  return {
    type: 'RECTANGLE',
    pluginData: [] as PluginDataEntry[],
    state: undefined,
    bindings: undefined,
    events: undefined,
    interactiveProps: undefined,
    renderCondition: undefined,
    ...fields
  } as SceneNode
}

describe('serializeLowcodeFields (Phase 1 §12 step 1)', () => {
  test('returns [] when no lowcode field is set', () => {
    expect(serializeLowcodeFields(makeNode())).toEqual([])
  })

  test('skips empty arrays and empty objects so .fig stays byte-identical', () => {
    expect(
      serializeLowcodeFields(
        makeNode({
          state: [],
          bindings: {},
          events: {},
          interactiveProps: {},
          renderCondition: ''
        })
      )
    ).toEqual([])
  })

  test('emits a single lowcode/state entry for a page-scoped state declaration', () => {
    const node = makeNode({
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    const entries = serializeLowcodeFields(node)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_STATE_KEY,
      value: JSON.stringify([{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }])
    })
  })

  test('round-trips all five fields when populated, in stable emit order', () => {
    const node = makeNode({
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }],
      bindings: { text: { kind: 'ref', stateId: 's1' } },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }
        ]
      },
      interactiveProps: { text: 'Go' },
      renderCondition: 'count > 0'
    })
    const entries = serializeLowcodeFields(node)
    expect(entries.map((e) => e.key)).toEqual([
      LOWCODE_STATE_KEY,
      LOWCODE_BINDINGS_KEY,
      LOWCODE_EVENTS_KEY,
      LOWCODE_INTERACTIVE_PROPS_KEY,
      LOWCODE_RENDER_CONDITION_KEY
    ])
    for (const entry of entries) expect(entry.pluginId).toBe(OPEN_PENCIL_PLUGIN_ID)

    // Round-trip each value through JSON.parse to confirm we wrote real JSON.
    const byKey = new Map(entries.map((e) => [e.key, e.value]))
    expect(JSON.parse(byKey.get(LOWCODE_STATE_KEY) as string)).toEqual(node.state)
    expect(JSON.parse(byKey.get(LOWCODE_BINDINGS_KEY) as string)).toEqual(node.bindings)
    expect(JSON.parse(byKey.get(LOWCODE_EVENTS_KEY) as string)).toEqual(node.events)
    expect(JSON.parse(byKey.get(LOWCODE_INTERACTIVE_PROPS_KEY) as string)).toEqual(
      node.interactiveProps
    )
    expect(JSON.parse(byKey.get(LOWCODE_RENDER_CONDITION_KEY) as string)).toBe(
      node.renderCondition
    )
  })

  test('emits a lowcode/renderCondition entry only for a non-empty expression string', () => {
    expect(serializeLowcodeFields(makeNode({ renderCondition: '' }))).toEqual([])
    const entries = serializeLowcodeFields(makeNode({ renderCondition: 'flag' }))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({
      pluginId: OPEN_PENCIL_PLUGIN_ID,
      key: LOWCODE_RENDER_CONDITION_KEY,
      value: JSON.stringify('flag')
    })
  })

  test('round-trips a bindings.expr entry (Phase 2 §9 BindingExpr widening)', () => {
    const node = makeNode({
      bindings: { text: { kind: 'expr', expr: 'item.name' } }
    })
    const entries = serializeLowcodeFields(node)
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe(LOWCODE_BINDINGS_KEY)
    expect(JSON.parse(entries[0].value)).toEqual({
      text: { kind: 'expr', expr: 'item.name' }
    })
  })

  test('does not mutate node.pluginData; existing pluginData entries are untouched', () => {
    const existing: PluginDataEntry[] = [
      { pluginId: 'someone-else', key: 'foo', value: 'bar' }
    ]
    const node = makeNode({
      pluginData: [...existing],
      state: [{ id: 's1', name: 'flag', type: 'boolean', defaultValue: true }]
    })
    const before = JSON.stringify(node.pluginData)
    serializeLowcodeFields(node)
    expect(JSON.stringify(node.pluginData)).toBe(before)
  })

  test('a single non-empty field produces exactly one entry (others stay null)', () => {
    const entries = serializeLowcodeFields(
      makeNode({ interactiveProps: { placeholder: 'name@example.com' } })
    )
    expect(entries).toHaveLength(1)
    expect(entries[0].key).toBe(LOWCODE_INTERACTIVE_PROPS_KEY)
  })

  test('emits lowcode/nodeType for each of the 6 lowcode NodeTypes', () => {
    for (const type of ['BUTTON', 'INPUT', 'CHECKBOX', 'FORM', 'LIST', 'SELECT'] as const) {
      const entries = serializeLowcodeFields(makeNode({ type }))
      const nodeTypeEntry = entries.find((e) => e.key === LOWCODE_NODE_TYPE_KEY)
      expect(nodeTypeEntry).toBeDefined()
      expect(nodeTypeEntry?.value).toBe(JSON.stringify(type))
    }
  })

  test('omits lowcode/nodeType for non-lowcode NodeTypes (RECTANGLE, FRAME, TEXT, ...)', () => {
    for (const type of ['RECTANGLE', 'FRAME', 'TEXT', 'ELLIPSE', 'GROUP'] as const) {
      const entries = serializeLowcodeFields(makeNode({ type }))
      expect(entries.find((e) => e.key === LOWCODE_NODE_TYPE_KEY)).toBeUndefined()
    }
  })
})

/** Build a minimal NodeChange-shaped object for `extractLowcodeAndPluginData`.
 *  The helper takes `Pick<NodeChange, 'pluginData'>`, so this typed literal
 *  satisfies the contract without a double-cast. Casing matches the codec:
 *  `pluginID` (uppercase D). */
function makeNc(pluginData: PluginData[]): { pluginData: PluginData[] } {
  return { pluginData }
}

describe('extractLowcodeAndPluginData (Phase 1 §12 step 2)', () => {
  test('empty pluginData → pluginData=[] and no lowcode fields', () => {
    const result = extractLowcodeAndPluginData(makeNc([]))
    expect(result).toEqual({ pluginData: [] })
  })

  test('hydrates a single lowcode/state entry into the structured field', () => {
    const state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const result = extractLowcodeAndPluginData(
      makeNc([
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_STATE_KEY, value: JSON.stringify(state) }
      ])
    )
    expect(result.state).toEqual(state)
    // Owned entries are stripped from the returned pluginData.
    expect(result.pluginData).toEqual([])
  })

  test('hydrates all four lowcode fields when all four entries are present', () => {
    const state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const bindings = { text: { kind: 'ref' as const, stateId: 's1' } }
    const events = {
      onClick: [
        { id: 'a1', kind: 'setState' as const, targetStateId: 's1', valueExpr: 'count + 1' }
      ]
    }
    const interactiveProps = { text: 'Go' }
    const result = extractLowcodeAndPluginData(
      makeNc([
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_STATE_KEY, value: JSON.stringify(state) },
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_BINDINGS_KEY,
          value: JSON.stringify(bindings)
        },
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_EVENTS_KEY, value: JSON.stringify(events) },
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_INTERACTIVE_PROPS_KEY,
          value: JSON.stringify(interactiveProps)
        }
      ])
    )
    expect(result.state).toEqual(state)
    expect(result.bindings).toEqual(bindings)
    expect(result.events).toEqual(events)
    expect(result.interactiveProps).toEqual(interactiveProps)
    expect(result.pluginData).toEqual([])
  })

  test('malformed JSON drops the entry, leaves the field undefined, and warns', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const result = extractLowcodeAndPluginData(
        makeNc([
          { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_STATE_KEY, value: '{not-json' }
        ])
      )
      expect(result.state).toBeUndefined()
      expect(result.pluginData).toEqual([])
      expect(warn).toHaveBeenCalledTimes(1)
      const [msg] = warn.mock.calls[0]
      expect(String(msg)).toContain(LOWCODE_STATE_KEY)
    } finally {
      warn.mockRestore()
    }
  })

  test('one malformed lowcode entry does not block the others on the same node', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const interactiveProps = { text: 'Go' }
      const result = extractLowcodeAndPluginData(
        makeNc([
          { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_STATE_KEY, value: '{broken' },
          {
            pluginID: OPEN_PENCIL_PLUGIN_ID,
            key: LOWCODE_INTERACTIVE_PROPS_KEY,
            value: JSON.stringify(interactiveProps)
          }
        ])
      )
      expect(result.state).toBeUndefined()
      expect(result.interactiveProps).toEqual(interactiveProps)
    } finally {
      warn.mockRestore()
    }
  })

  test('unknown lowcode/* key (forward-compat) passes through pluginData unchanged', () => {
    const result = extractLowcodeAndPluginData(
      makeNc([
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: 'lowcode/futureField', value: '"unknown"' }
      ])
    )
    expect(result.pluginData).toEqual([
      { pluginId: OPEN_PENCIL_PLUGIN_ID, key: 'lowcode/futureField', value: '"unknown"' }
    ])
    expect(result.state).toBeUndefined()
  })

  test('non-lowcode OPEN_PENCIL entries (e.g. textDirection) pass through', () => {
    const result = extractLowcodeAndPluginData(
      makeNc([
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: 'textDirection', value: 'rtl' }
      ])
    )
    expect(result.pluginData).toEqual([
      { pluginId: OPEN_PENCIL_PLUGIN_ID, key: 'textDirection', value: 'rtl' }
    ])
  })

  test('foreign plugin entries are preserved alongside hydrated lowcode entries', () => {
    const state = [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    const result = extractLowcodeAndPluginData(
      makeNc([
        { pluginID: 'other-plugin', key: 'foo', value: 'bar' },
        { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_STATE_KEY, value: JSON.stringify(state) },
        { pluginID: 'other-plugin', key: 'baz', value: 'qux' }
      ])
    )
    expect(result.state).toEqual(state)
    expect(result.pluginData).toEqual([
      { pluginId: 'other-plugin', key: 'foo', value: 'bar' },
      { pluginId: 'other-plugin', key: 'baz', value: 'qux' }
    ])
  })

  test('hydrates lowcode/nodeType into nodeTypeOverride for each of the 6 lowcode NodeTypes', () => {
    for (const type of ['BUTTON', 'INPUT', 'CHECKBOX', 'FORM', 'LIST', 'SELECT']) {
      const result = extractLowcodeAndPluginData(
        makeNc([
          { pluginID: OPEN_PENCIL_PLUGIN_ID, key: LOWCODE_NODE_TYPE_KEY, value: JSON.stringify(type) }
        ])
      )
      expect(result.nodeTypeOverride).toBe(type)
      expect(result.pluginData).toEqual([])
    }
  })

  test('hydrates lowcode/renderCondition into renderCondition string (Phase 2 §9)', () => {
    const result = extractLowcodeAndPluginData(
      makeNc([
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_RENDER_CONDITION_KEY,
          value: JSON.stringify('count > 0')
        }
      ])
    )
    expect(result.renderCondition).toBe('count > 0')
    expect(result.pluginData).toEqual([])
  })

  test('drops a non-string lowcode/renderCondition payload (forward-compat)', () => {
    const result = extractLowcodeAndPluginData(
      makeNc([
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_RENDER_CONDITION_KEY,
          value: JSON.stringify({ unexpected: 'object' })
        }
      ])
    )
    expect(result.renderCondition).toBeUndefined()
    expect(result.pluginData).toEqual([])
  })

  test('hydrates bindings.expr alongside other bindings kinds (Phase 2 §9)', () => {
    const bindings = {
      text: { kind: 'expr' as const, expr: 'item.name' },
      placeholder: { kind: 'ref' as const, stateId: 's1' }
    }
    const result = extractLowcodeAndPluginData(
      makeNc([
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_BINDINGS_KEY,
          value: JSON.stringify(bindings)
        }
      ])
    )
    expect(result.bindings).toEqual(bindings)
  })

  test('rejects an unknown nodeType override (decision #5 forward-compat applies — drop value)', () => {
    const result = extractLowcodeAndPluginData(
      makeNc([
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_NODE_TYPE_KEY,
          value: JSON.stringify('UNKNOWN_FUTURE_TYPE')
        }
      ])
    )
    expect(result.nodeTypeOverride).toBeUndefined()
    expect(result.pluginData).toEqual([])
  })
})

// Use the mock import so oxlint doesn't strip it as unused.
void mock
