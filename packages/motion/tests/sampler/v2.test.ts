import { describe, expect, test } from 'bun:test'

import { sampleMotionEasing, sampleMotionSpec } from '@open-pencil/motion'
import type { MotionSpec } from '@open-pencil/scene-graph'

function spec(): MotionSpec {
  return {
    version: 2,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'advanced',
        trigger: 'mount',
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 100 }
          ],
          autoRotate: true
        },
        keyframes: [
          {
            offset: 0,
            originX: 0,
            originY: 0,
            width: 100,
            height: 40,
            cornerRadius: 4,
            fillColor: { r: 1, g: 0, b: 0, a: 1 },
            strokeColor: { r: 0, g: 0, b: 0, a: 1 },
            strokeWidth: 1,
            blur: 0,
            shadowX: 0,
            shadowY: 2,
            shadowBlur: 4,
            shadowSpread: 0,
            shadowColor: { r: 0, g: 0, b: 0, a: 0.2 },
            pathProgress: 0,
            trimStart: 0,
            trimEnd: 0.25,
            trimOffset: 0,
            gap: 4,
            rowGap: 6,
            columnGap: 8,
            paddingTop: 2,
            paddingRight: 4,
            paddingBottom: 6,
            paddingLeft: 8
          },
          {
            offset: 1,
            originX: 1,
            originY: 1,
            width: 200,
            height: 80,
            cornerRadius: 20,
            fillColor: { r: 0, g: 0, b: 1, a: 0.5 },
            strokeColor: { r: 1, g: 1, b: 1, a: 0.5 },
            strokeWidth: 5,
            blur: 10,
            shadowX: 10,
            shadowY: 12,
            shadowBlur: 20,
            shadowSpread: 4,
            shadowColor: { r: 0.4, g: 0.6, b: 0.8, a: 0.6 },
            pathProgress: 1,
            trimStart: 0.25,
            trimEnd: 1,
            trimOffset: 0.5,
            gap: 12,
            rowGap: 14,
            columnGap: 16,
            paddingTop: 10,
            paddingRight: 12,
            paddingBottom: 14,
            paddingLeft: 16
          }
        ],
        timing: { durationMs: 1_000, easing: 'linear' }
      }
    ]
  }
}

describe('MotionSpec v2 reference sampling', () => {
  test('interpolates every advanced channel and follows arc-length path progress', () => {
    const visual = sampleMotionSpec(spec(), 500).visual
    expect(visual).toMatchObject({
      x: 100,
      y: 0,
      rotate: 0,
      originX: 0.5,
      originY: 0.5,
      width: 150,
      height: 60,
      cornerRadius: 12,
      strokeWidth: 3,
      blur: 5,
      shadowX: 5,
      shadowY: 7,
      shadowBlur: 12,
      shadowSpread: 2,
      pathProgress: 0.5,
      trimStart: 0.125,
      trimEnd: 0.625,
      trimOffset: 0.25,
      gap: 8,
      rowGap: 10,
      columnGap: 12,
      paddingTop: 6,
      paddingRight: 8,
      paddingBottom: 10,
      paddingLeft: 12
    })
    expect(visual.fillColor).toEqual({ r: 0.5, g: 0, b: 0.5, a: 0.75 })
    expect(visual.strokeColor).toEqual({ r: 0.5, g: 0.5, b: 0.5, a: 0.75 })
    expect(visual.shadowColor).toEqual({ r: 0.2, g: 0.3, b: 0.4, a: 0.4 })
  })

  test('auto-rotates along later path segments', () => {
    const visual = sampleMotionSpec(spec(), 750).visual
    expect(visual.x).toBe(100)
    expect(visual.y).toBe(50)
    expect(visual.rotate).toBe(90)
  })

  test('samples hold, steps, spring, and inertia deterministically', () => {
    expect(sampleMotionEasing({ type: 'hold' }, 0.75)).toBe(0)
    expect(sampleMotionEasing({ type: 'steps', steps: 4, position: 'end' }, 0.49)).toBe(0.25)
    expect(sampleMotionEasing({ type: 'steps', steps: 4, position: 'start' }, 0.49)).toBe(0.5)
    const spring = { type: 'spring', mass: 1, stiffness: 170, damping: 26, velocity: 0 } as const
    expect(sampleMotionEasing(spring, 0)).toBe(0)
    expect(sampleMotionEasing(spring, 1)).toBe(1)
    expect(Number.isFinite(sampleMotionEasing(spring, 0.5))).toBe(true)
    const inertia = { type: 'inertia', velocity: 20, deceleration: 0.2 } as const
    expect(sampleMotionEasing(inertia, 0.5)).toBeGreaterThan(0)
    expect(sampleMotionEasing(inertia, 0.5)).toBeLessThan(1)
  })
})
