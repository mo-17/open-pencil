import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { createInstanceOverrideState } from '@open-pencil/scene-graph'

import { decodeNodeFromYjs, encodeNodeForYjs } from '@/app/collab/node-codec'

import { expectDefined } from '#tests/helpers/assert'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function roundTripEncodedFields(fields: Record<string, unknown>) {
  const host = new Y.Doc()
  const peer = new Y.Doc()
  try {
    const node = new Y.Map<unknown>()
    host.getMap<Y.Map<unknown>>('nodes').set('instance', node)
    for (const [key, value] of Object.entries(fields)) node.set(key, value)
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(host))
    return decodeNodeFromYjs(
      expectDefined(peer.getMap<Y.Map<unknown>>('nodes').get('instance'), 'remote instance')
    )
  } finally {
    host.destroy()
    peer.destroy()
  }
}

describe('collab node codec binary transport', () => {
  test('restores root and descendant override Maps, including explicit undefined values', () => {
    const graph = makeSceneGraph()
    const node = graph.createNode('INSTANCE', firstPageId(graph))
    const rootMotion = { version: 2, tracks: [] }
    const childEffect = { type: 'noise', seed: 17 }
    node.instanceOverrides.self.set('motion', rootMotion)
    node.instanceOverrides.self.set('prototype', undefined)
    node.instanceOverrides.descendants.set(
      'child',
      new Map<string, unknown>([
        ['generatedEffect', childEffect],
        ['transitionKey', undefined]
      ])
    )

    const props = roundTripEncodedFields(encodeNodeForYjs(node))
    const restored = expectDefined(props.instanceOverrides, 'instance override state')
    expect(restored.self).toBeInstanceOf(Map)
    expect(restored.descendants).toBeInstanceOf(Map)
    expect(restored).toEqual(node.instanceOverrides)
    expect(restored.self.has('prototype')).toBe(true)
    expect(restored.self.get('prototype')).toBeUndefined()
    expect(restored.self.get('motion')).not.toBe(rootMotion)
    const child = expectDefined(restored.descendants.get('child'), 'child overrides')
    expect(child).toBeInstanceOf(Map)
    expect(child.has('transitionKey')).toBe(true)
    expect(child.get('transitionKey')).toBeUndefined()
    expect(child.get('generatedEffect')).not.toBe(childEffect)
    child.clear()
    expect(node.instanceOverrides.descendants.get('child')?.size).toBe(2)
  })

  test('validates serialized entries while preserving valid fields and explicit clears', () => {
    const props = roundTripEncodedFields({
      instanceOverrides: {
        self: [
          ['name', { defined: true, value: 'Remote instance' }],
          ['motion', { defined: false }],
          ['invalidFlag', { defined: 'yes', value: 1 }],
          ['missingValue', { defined: true }],
          [17, { defined: true, value: 2 }],
          ['extra', { defined: true, value: 3 }, 'invalid']
        ],
        descendants: [
          [
            'child',
            [
              ['opacity', { defined: true, value: 0.5 }],
              ['invalid', null]
            ]
          ],
          [17, [['name', { defined: true, value: 'invalid child' }]]]
        ],
        unknown: 'ignored'
      }
    })
    expect(props.instanceOverrides).toEqual({
      self: new Map<string, unknown>([
        ['name', 'Remote instance'],
        ['motion', undefined]
      ]),
      descendants: new Map([['child', new Map([['opacity', 0.5]])]])
    })
  })

  test.each([undefined, null, {}, { self: {}, descendants: {} }])(
    'normalizes missing or legacy malformed override state to empty Maps: %j',
    (instanceOverrides) => {
      const props = roundTripEncodedFields({ instanceOverrides })
      expect(props.instanceOverrides).toEqual(createInstanceOverrideState())
    }
  )
})
