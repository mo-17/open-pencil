import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

import { nodeChangeToProps } from '../../../../packages/core/src/kiwi/fig/node-change/convert'

import { pageId, toKiwi } from './helpers'

/**
 * Read-side back-compat for old .fig files. Older OpenPencil exports zeroed the
 * transform of auto-layout children; apply.ts pins a child to its
 * figmaDerivedLayout.x/y when present, so reading a zeroed (0,0) derived
 * position snapped every nested auto-layout child to the origin — the layout
 * distortion seen when reopening pre-rebaseline files. convert.ts now only
 * carries derived x/y when the transform is genuinely non-zero (real Figma
 * files keep child offsets, upstream 1c655f34); a zeroed transform falls back
 * to the Yoga-computed placement.
 */
function hugAutoLayoutNc(graph: SceneGraph) {
  const frame = graph.createNode('FRAME', pageId(graph), {
    name: 'HugAL',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
  })
  return toKiwi(frame, graph)[0]
}

describe('figmaDerivedLayout offset (old .fig read back-compat)', () => {
  test('zeroed child transform → no derived x/y (falls back to Yoga)', () => {
    const nc = hugAutoLayoutNc(new SceneGraph())
    nc.transform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }

    const props = nodeChangeToProps(nc, [])
    const derived = expectDefined(props.figmaDerivedLayout, 'figmaDerivedLayout')
    expect(derived.x).toBeUndefined()
    expect(derived.y).toBeUndefined()
    // HUG size is still derived.
    expect(derived.height).toBeGreaterThan(0)
  })

  test('non-zero child transform → derived x/y preserved (Figma fidelity)', () => {
    const nc = hugAutoLayoutNc(new SceneGraph())
    nc.transform = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 120 }

    const props = nodeChangeToProps(nc, [])
    const derived = expectDefined(props.figmaDerivedLayout, 'figmaDerivedLayout')
    expect(derived.y).toBe(120)
  })
})
