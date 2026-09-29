import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { lowcodeSwitchGeometry } from '../src/switch-appearance'

describe('switch visual geometry', () => {
  test.each([
    [44, 24],
    [84, 44],
    [320, 44],
    [18, 40],
    [1, 1]
  ])('keeps an observable on/off movement inside %s × %s authored bounds', (width, height) => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, { width, height })
    const before = structuredClone(node)
    const off = lowcodeSwitchGeometry(node, false)
    const on = lowcodeSwitchGeometry(node, true)
    expect(off).not.toBeNull()
    expect(on).not.toBeNull()
    if (!off || !on) throw new Error('valid switch has no geometry')
    expect(on.thumb.x).toBeGreaterThan(off.thumb.x)
    expect(off.thumb.x).toBeCloseTo(width - on.thumb.x - on.thumb.width)
    expect(on.thumb.y).toBeCloseTo((height - on.thumb.height) / 2)
    expect(on.thumb.width).toBe(on.thumb.height)
    expect(on.thumb.x + on.thumb.width).toBeLessThan(width)
    expect(on.trackRadius).toBe(Math.min(width, height) / 2)
    expect(node).toEqual(before)
  })

  test('keeps asymmetric padding and the emitted border outside thumb travel', () => {
    const graph = new SceneGraph()
    const node = graph.createNode('SWITCH', graph.getPages()[0].id, {
      width: 84,
      height: 44,
      paddingLeft: 10,
      paddingRight: 6,
      paddingTop: 4,
      paddingBottom: 2,
      strokes: [{ color: { r: 0, g: 0, b: 0, a: 1 }, weight: 2, opacity: 1, visible: true }]
    })
    const off = lowcodeSwitchGeometry(node, false)
    const on = lowcodeSwitchGeometry(node, true)
    expect(off?.thumb.x).toBeCloseTo(15.4)
    expect(on?.thumb.x).toBeCloseTo(45.4)
    expect(on?.thumb.y).toBeCloseTo(9.4)
    expect(on?.thumb.width).toBeCloseTo(27.2)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not produce drawable geometry for an invalid width %s',
    (width) => {
      const graph = new SceneGraph()
      const node = graph.createNode('SWITCH', graph.getPages()[0].id, { width })
      expect(lowcodeSwitchGeometry(node, true)).toBeNull()
    }
  )
})
