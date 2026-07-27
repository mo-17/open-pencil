import { describe, expect, test } from 'bun:test'

import { createMotionPreset, type MotionSpec, type MotionTrack } from '@open-pencil/scene-graph'

import { sampleMotionEasing, sampleMotionSpec } from '#core/motion'

function spec(tracks: MotionTrack[], reducedMotion?: MotionSpec['reducedMotion']): MotionSpec {
  return { version: 1, tracks, ...(reducedMotion ? { reducedMotion } : {}) }
}

function track(overrides: Partial<MotionTrack> = {}): MotionTrack {
  return {
    id: 'move',
    trigger: 'mount',
    keyframes: [
      { offset: 0, x: 0 },
      { offset: 1, x: 100 }
    ],
    timing: { durationMs: 100, easing: 'linear' },
    ...overrides
  }
}

describe('MotionSpec sampling', () => {
  test('samples all visual channels without mutating authored values', () => {
    const motion = spec([
      track({
        keyframes: [
          { offset: 0, x: 0, y: 20, scaleX: 0.5, scaleY: 0.75, rotate: -10, opacity: 0 },
          { offset: 1, x: 100, y: 40, scaleX: 1.5, scaleY: 1.25, rotate: 30, opacity: 1 }
        ]
      })
    ])

    expect(sampleMotionSpec(motion, 50).visual).toEqual({
      x: 50,
      y: 30,
      scaleX: 1,
      scaleY: 1,
      rotate: 10,
      opacity: 0.5
    })
  })

  test('uses identity values for missing fields in a used channel', () => {
    const motion = spec([
      track({
        keyframes: [
          { offset: 0, x: 20, scaleX: 2 },
          { offset: 1, y: 40, scaleY: 3 }
        ]
      })
    ])

    expect(sampleMotionSpec(motion, 50).visual).toEqual({
      x: 10,
      y: 20,
      scaleX: 1.5,
      scaleY: 2,
      rotate: 0,
      opacity: 1
    })
  })

  test('lets later contributing tracks win duplicate channels in source order', () => {
    const motion = spec([
      track({ id: 'first' }),
      track({
        id: 'second',
        keyframes: [
          { offset: 0, x: 10, opacity: 0.25 },
          { offset: 1, x: 30, opacity: 0.75 }
        ]
      })
    ])

    expect(sampleMotionSpec(motion, 50).visual.x).toBe(20)
    expect(sampleMotionSpec(motion, 50).visual.opacity).toBe(0.5)
  })

  test('honors delay, fill, direction, and finite iterations', () => {
    const noFill = spec([
      track({ timing: { durationMs: 100, delayMs: 50, easing: 'linear', fill: 'none' } })
    ])
    expect(sampleMotionSpec(noFill, 25)).toMatchObject({ contributes: false, finished: false })
    expect(sampleMotionSpec(noFill, 25).visual.x).toBe(0)
    expect(sampleMotionSpec(noFill, 150)).toMatchObject({ contributes: false, finished: true })

    const alternate = spec([
      track({
        timing: {
          durationMs: 100,
          easing: 'linear',
          iterations: 2,
          direction: 'alternate',
          fill: 'forwards'
        }
      })
    ])
    expect(sampleMotionSpec(alternate, 125).visual.x).toBe(75)
    expect(sampleMotionSpec(alternate, 200)).toMatchObject({
      visual: { x: 0 },
      finished: true
    })

    const reverseBackwards = spec([
      track({
        timing: {
          durationMs: 100,
          delayMs: 50,
          easing: 'linear',
          direction: 'reverse',
          fill: 'backwards'
        }
      })
    ])
    expect(sampleMotionSpec(reverseBackwards, 0).visual.x).toBe(100)
  })

  test('samples fractional and infinite iterations deterministically', () => {
    const fractional = spec([
      track({
        timing: { durationMs: 100, easing: 'linear', iterations: 1.5, fill: 'forwards' }
      })
    ])
    expect(sampleMotionSpec(fractional, 150)).toMatchObject({
      visual: { x: 50 },
      finished: true
    })

    const looping = spec([
      track({ trigger: 'loop', timing: { durationMs: 100, easing: 'linear' } })
    ])
    expect(sampleMotionSpec(looping, 250, { trigger: 'loop' })).toMatchObject({
      visual: { x: 50 },
      finished: false,
      hasTracks: true
    })
  })

  test('filters by trigger and samples expanded presets', () => {
    const motion = createMotionPreset('slide-up', { durationMs: 100, distance: 20 })
    expect(sampleMotionSpec(motion, 50, { trigger: 'hover' }).hasTracks).toBe(false)
    const sample = sampleMotionSpec(motion, 50)
    expect(sample.hasTracks).toBe(true)
    expect(sample.visual.y).toBeGreaterThan(0)
    expect(sample.visual.y).toBeLessThan(20)
  })

  test('matches compiler reduced-motion policy and timing', () => {
    const mixed = spec(
      [
        track({
          keyframes: [
            { offset: 0, opacity: 0, y: 100 },
            { offset: 1, opacity: 1, y: 0 }
          ],
          timing: { durationMs: 1_000, delayMs: 500, easing: 'linear' }
        })
      ],
      'reduce'
    )
    const reduced = sampleMotionSpec(mixed, 60, { prefersReducedMotion: true })
    expect(reduced.visual.opacity).toBe(0.5)
    expect(reduced.visual.y).toBe(0)

    const transformOnly = spec([track()], 'reduce')
    expect(sampleMotionSpec(transformOnly, 50, { prefersReducedMotion: true })).toMatchObject({
      hasTracks: false,
      finished: true
    })

    const disabled = spec([track()], 'disable')
    expect(sampleMotionSpec(disabled, 50, { prefersReducedMotion: true }).hasTracks).toBe(false)

    const allowed = spec([track()], 'allow')
    expect(sampleMotionSpec(allowed, 50, { prefersReducedMotion: true }).visual.x).toBe(50)
  })

  test('supports CSS named and cubic-bezier easing', () => {
    expect(
      sampleMotionEasing({ type: 'cubicBezier', x1: 0, y1: 0, x2: 1, y2: 1 }, 0.25)
    ).toBeCloseTo(0.25, 5)
    expect(sampleMotionEasing('ease-out', 0.5)).toBeGreaterThan(0.5)
    expect(sampleMotionEasing('ease-in', 0.5)).toBeLessThan(0.5)
  })
})
