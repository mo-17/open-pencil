import { describe, expect, test } from 'bun:test'

import { collectTailwindClasses } from '@open-pencil/core/io/formats/jsx'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import type { Fill } from '@open-pencil/core/scene-graph'

/**
 * Phase 4 §24.2/§24 follow-up — a gradient fill (GRADIENT_LINEAR /
 * GRADIENT_RADIAL / GRADIENT_ANGULAR / GRADIENT_DIAMOND) emits a
 * `bg-[linear-gradient(...)]` / `bg-[radial-gradient(...)]` /
 * `bg-[conic-gradient(...)]` arbitrary-value class (twirl can't express it;
 * mirrors the clip-path bypass). Spaces become `_`; colors are hex;
 * linear/conic orientation comes from gradientTransform.
 */
describe('jsx — gradient fills (Phase 4 §24.2)', () => {
  function gradientClass(
    fill: Fill,
    width = 200,
    height = 100,
    type: 'RECTANGLE' | 'TEXT' = 'RECTANGLE'
  ): string | undefined {
    const graph = new SceneGraph()
    const node = graph.createNode(type, graph.getPages()[0].id, {
      name: 'N',
      width,
      height,
      fills: [fill]
    })
    return collectTailwindClasses(node, graph).find((c) => c.includes('gradient'))
  }

  const RED = { r: 1, g: 0, b: 0, a: 1 }
  const BLUE = { r: 0, g: 0, b: 1, a: 1 }

  function linearFill(transform: Fill['gradientTransform']): Fill {
    return {
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: RED, position: 0 },
        { color: BLUE, position: 1 }
      ],
      gradientTransform: transform
    }
  }

  test('vertical linear gradient → bg-[linear-gradient(180deg,...)] with hex stops + %', () => {
    // a 90° rotation transform → top→bottom direction → 180deg
    const cls = gradientClass(linearFill({ m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }))
    expect(cls).toBe('bg-[linear-gradient(180deg,_#FF0000_0%,_#0000FF_100%)]')
  })

  test('linear gradient angle is derived from the transform (horizontal → 90deg)', () => {
    // identity transform → start (1,0)·w, end (0,0) → direction (-w,0) → 270deg
    const cls = gradientClass(linearFill({ m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }))
    expect(cls).toContain('linear-gradient(270deg,')
  })

  test('radial gradient → bg-[radial-gradient(circle,...)]', () => {
    const cls = gradientClass({
      type: 'GRADIENT_RADIAL',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: { r: 1, g: 1, b: 1, a: 1 }, position: 0 },
        { color: { r: 0, g: 0, b: 0, a: 1 }, position: 1 }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    })
    expect(cls).toBe('bg-[radial-gradient(circle,_#FFFFFF_0%,_#000000_100%)]')
  })

  test('diamond gradient → radial-gradient fallback centered from gradientTransform', () => {
    const cls = gradientClass({
      type: 'GRADIENT_DIAMOND',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: RED, position: 0 },
        { color: BLUE, position: 1 }
      ],
      gradientTransform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 }
    })
    expect(cls).toBe('bg-[radial-gradient(circle_at_50%_50%,_#FF0000_0%,_#0000FF_100%)]')
  })

  test('angular gradient → bg-[conic-gradient(from angle at center,...)]', () => {
    const cls = gradientClass({
      type: 'GRADIENT_ANGULAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: RED, position: 0 },
        { color: BLUE, position: 1 }
      ],
      gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
    })
    expect(cls).toBe('bg-[conic-gradient(from_90deg_at_50%_50%,_#FF0000_0%,_#0000FF_100%)]')
  })

  test('angular gradient center is derived from gradientTransform', () => {
    const cls = gradientClass({
      type: 'GRADIENT_ANGULAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: RED, position: 0 },
        { color: BLUE, position: 1 }
      ],
      gradientTransform: { m00: 0.5, m01: 0, m02: 0.25, m10: 0, m11: 0.5, m12: 0.25 }
    })
    expect(cls).toContain('conic-gradient(from_90deg_at_50%_50%,')
  })

  test('no spaces survive in the arbitrary value (all → _)', () => {
    const cls = gradientClass(linearFill({ m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 })) ?? ''
    expect(cls.includes(' ')).toBe(false)
  })

  test('partial-alpha stop emits hex8', () => {
    const cls = gradientClass(linearFill({ m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 })) ?? ''
    // full-alpha trims to 6-digit; now flip one stop to half-alpha
    const half = gradientClass({
      type: 'GRADIENT_LINEAR',
      color: { r: 0, g: 0, b: 0, a: 1 },
      opacity: 1,
      visible: true,
      gradientStops: [
        { color: { r: 1, g: 0, b: 0, a: 0.5 }, position: 0 },
        { color: BLUE, position: 1 }
      ],
      gradientTransform: { m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }
    })
    expect(half).toContain('#FF000080')
    void cls
  })

  test('TEXT node with a gradient fill → no bg-gradient class (gradient there is text color)', () => {
    const cls = gradientClass(
      linearFill({ m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }),
      200,
      100,
      'TEXT'
    )
    expect(cls).toBeUndefined()
  })

  test('solid fill → no gradient class', () => {
    const cls = gradientClass({ type: 'SOLID', color: RED, opacity: 1, visible: true })
    expect(cls).toBeUndefined()
  })

  test('invisible gradient fill → no class', () => {
    const cls = gradientClass({
      ...linearFill({ m00: 0, m01: 1, m02: 0, m10: -1, m11: 0, m12: 1 }),
      visible: false
    })
    expect(cls).toBeUndefined()
  })
})
