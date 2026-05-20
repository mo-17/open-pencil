import { describe, expect, test } from 'bun:test'

import type { PluginDataEntry, SceneNode } from '#core/scene-graph'

import { OPEN_PENCIL_PLUGIN_ID } from '#core/kiwi/node-change/plugin-data'
import {
  LOWCODE_BINDINGS_KEY,
  LOWCODE_EVENTS_KEY,
  LOWCODE_INTERACTIVE_PROPS_KEY,
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
    pluginData: [] as PluginDataEntry[],
    state: undefined,
    bindings: undefined,
    events: undefined,
    interactiveProps: undefined,
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
        makeNode({ state: [], bindings: {}, events: {}, interactiveProps: {} })
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

  test('round-trips all four fields when populated, in stable emit order', () => {
    const node = makeNode({
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }],
      bindings: { text: { kind: 'ref', stateId: 's1' } },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }
        ]
      },
      interactiveProps: { text: 'Go' }
    })
    const entries = serializeLowcodeFields(node)
    expect(entries.map((e) => e.key)).toEqual([
      LOWCODE_STATE_KEY,
      LOWCODE_BINDINGS_KEY,
      LOWCODE_EVENTS_KEY,
      LOWCODE_INTERACTIVE_PROPS_KEY
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
})
