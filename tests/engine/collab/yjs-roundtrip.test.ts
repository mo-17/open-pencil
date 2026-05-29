import { describe, expect, test } from 'bun:test'
import * as Y from 'yjs'

import type { SceneNode } from '@open-pencil/core/scene-graph'

import { syncNodePropsToYMap, yNodeToProps } from '@/app/collab/yjs-sync'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 3 §4.1 — collab Yjs sync must round-trip every object-valued node
 * field, including the lowcode fields.
 *
 * The write side (`syncNodePropsToYMap`) JSON.stringifies every object field;
 * the read side (`yNodeToProps`) only JSON.parses fields listed in
 * `YJS_JSON_FIELDS`. Before §4.1 the lowcode fields were missing from that
 * set, so a remote peer received `node.bindings` etc. as a raw JSON string —
 * silent corruption that no unit test (which checked the call string, not the
 * round-trip) caught.
 *
 * Scope note (§4.1): the guard covers the LOWCODE fields. A real node also
 * carries ~11 base/core object fields (fillGeometry, overrides,
 * componentProperty*, symbolLinks, pluginData, …) that likewise round-trip as
 * strings because they aren't whitelisted either — that is pre-existing base
 * OpenPencil behavior (those fields are mostly derived / empty and the base
 * collab tolerates it), out of §4.1's scope. This guard deliberately asserts
 * only the lowcode fields so a NEW lowcode field added without whitelisting
 * fails loudly (decision §4.1.2 d) without coupling to base-field decisions.
 */
function roundTrip(node: SceneNode): Record<string, unknown> {
  const ymap = new Y.Map()
  // A Y.Map must be attached to a doc before it accepts nested writes.
  new Y.Doc().getMap('nodes').set(node.id, ymap)
  syncNodePropsToYMap(node, ymap)
  return yNodeToProps(ymap)
}

function lowcodeNode(): SceneNode {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const node = graph.createNode('INPUT', pageId, {
    state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }],
    bindings: { value: { kind: 'docState', docStateName: 'emailInput' } },
    events: {
      onClick: [
        {
          id: 'a1',
          kind: 'supabaseAuth',
          operation: 'signIn',
          emailExpr: 'emailInput',
          passwordExpr: 'passwordInput'
        }
      ]
    },
    interactiveProps: { placeholder: 'Email', value: '' },
    renderCondition: { expr: '$currentUser.signedIn' },
    lowcodeDocumentState: [{ id: 'd1', name: 'rows', type: 'array', defaultValue: [] }],
    lowcodeSupabaseConfig: { url: 'https://abc.supabase.co', anonKey: 'anon-jwt' }
  })
  return node
}

describe('collab Yjs round-trip (Phase 3 §4.1)', () => {
  const LOWCODE_FIELDS = [
    'state',
    'bindings',
    'events',
    'interactiveProps',
    'renderCondition',
    'lowcodeDocumentState',
    'lowcodeSupabaseConfig'
  ] as const

  test('every lowcode field survives as a deep-equal object (not a JSON string)', () => {
    const node = lowcodeNode()
    const props = roundTrip(node)
    for (const field of LOWCODE_FIELDS) {
      expect(typeof props[field]).toBe('object')
      expect(props[field]).toEqual((node as Record<string, unknown>)[field])
    }
  })

  test('guard: no lowcode field round-trips as a string (drift detector)', () => {
    const node = lowcodeNode()
    const raw = node as Record<string, unknown>
    const props = roundTrip(node)
    for (const field of LOWCODE_FIELDS) {
      // The test node populates each lowcode field with an object. If this
      // fails for a newly-added lowcode field, add it to YJS_JSON_FIELDS.
      expect(raw[field]).toBeDefined()
      expect(typeof props[field]).not.toBe('string')
    }
  })

  test('primitive fields pass through unchanged', () => {
    const node = lowcodeNode()
    const props = roundTrip(node)
    expect(props.id).toBe(node.id)
    expect(props.type).toBe('INPUT')
  })
})
