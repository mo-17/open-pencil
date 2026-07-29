import { describe, expect, test } from 'bun:test'

import { createMotionPreset, type MotionSpec, type MotionTrack } from '@open-pencil/scene-graph'

import {
  prepareMotionSamplingPlan,
  sampleMotionEasing,
  sampleMotionSpec,
  samplePreparedMotionPlan,
  samplePreparedMotionPlanWithDiagnostics
} from '#core/motion'

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

  test('prepared trigger plans remain byte-for-byte compatible with sampleMotionSpec', () => {
    const motion = spec(
      [
        track({
          id: 'enter',
          timing: {
            durationMs: 240,
            delayMs: 40,
            easing: 'ease-in-out',
            iterations: 2,
            direction: 'alternate',
            fill: 'forwards'
          }
        }),
        track({
          id: 'hover',
          trigger: 'hover',
          keyframes: [
            { offset: 0, opacity: 0.2 },
            { offset: 1, opacity: 1 }
          ]
        })
      ],
      'allow'
    )
    const plan = prepareMotionSamplingPlan(motion, {
      selection: { mode: 'trigger', trigger: 'mount' }
    })

    for (const elapsedMs of [0, 39, 40, 100, 280, 520, Number.NaN]) {
      expect(samplePreparedMotionPlan(plan, elapsedMs)).toEqual(sampleMotionSpec(motion, elapsedMs))
    }
  })

  test('preparation snapshots channels, reduced-motion timing, and keyframes', () => {
    const authoredTrack = track({
      keyframes: [
        { offset: 0, x: 0, opacity: 0 },
        { offset: 1, x: 100, opacity: 1 }
      ],
      timing: { durationMs: 1_000, delayMs: 500, easing: 'linear' }
    })
    const motion = spec([authoredTrack], 'reduce')
    const plan = prepareMotionSamplingPlan(motion, {
      selection: { mode: 'all' },
      prefersReducedMotion: true
    })

    authoredTrack.keyframes[1].opacity = 0
    authoredTrack.keyframes[1].rotate = 90
    authoredTrack.timing.durationMs = 10_000
    authoredTrack.timing.delayMs = 5_000

    expect(plan.tracks[0]).toMatchObject({
      channels: { opacity: true, translate: false, scale: false, rotate: false },
      durationMs: 120,
      delayMs: 0
    })
    expect(samplePreparedMotionPlan(plan, 60).visual).toEqual({
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotate: 0,
      opacity: 0.5
    })
  })

  test('supports trackIds and all selection while preserving source-order wins', () => {
    const motion = spec([
      track({ id: 'mount-x' }),
      track({
        id: 'hover-x',
        trigger: 'hover',
        keyframes: [
          { offset: 0, x: 200 },
          { offset: 1, x: 300 }
        ]
      }),
      track({
        id: 'click-opacity',
        trigger: 'click',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ]
      })
    ])

    const selected = prepareMotionSamplingPlan(motion, {
      selection: { mode: 'trackIds', trackIds: ['click-opacity', 'mount-x'] }
    })
    expect(selected.tracks.map((item) => item.id)).toEqual(['mount-x', 'click-opacity'])
    expect(samplePreparedMotionPlan(selected, 50).visual).toMatchObject({ x: 50, opacity: 0.5 })

    const all = prepareMotionSamplingPlan(motion, { selection: { mode: 'all' } })
    expect(all.tracks.map((item) => item.id)).toEqual(['mount-x', 'hover-x', 'click-opacity'])
    expect(samplePreparedMotionPlan(all, 50).visual).toMatchObject({ x: 250, opacity: 0.5 })
  })

  test('reports isolated per-track progress, contribution, completion, and visual state', () => {
    const motion = spec([
      track({
        id: 'delayed-x',
        timing: { durationMs: 100, delayMs: 50, easing: 'linear', fill: 'none' }
      }),
      track({
        id: 'fade',
        trigger: 'hover',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear', fill: 'forwards' }
      })
    ])
    const plan = prepareMotionSamplingPlan(motion, { selection: { mode: 'all' } })

    expect(samplePreparedMotionPlanWithDiagnostics(plan, 25)).toEqual({
      visual: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 0.25 },
      hasTracks: true,
      contributes: true,
      finished: false,
      tracks: [
        {
          trackId: 'delayed-x',
          trigger: 'mount',
          exit: 'reset',
          progress: 0,
          contributes: false,
          finished: false,
          visual: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 }
        },
        {
          trackId: 'fade',
          trigger: 'hover',
          exit: 'reset',
          progress: 0.25,
          contributes: true,
          finished: false,
          visual: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0, opacity: 0.25 }
        }
      ]
    })

    expect(samplePreparedMotionPlanWithDiagnostics(plan, 150)).toMatchObject({
      visual: { x: 0, opacity: 1 },
      contributes: true,
      finished: true,
      tracks: [
        { trackId: 'delayed-x', progress: 1, contributes: false, finished: true },
        { trackId: 'fade', progress: 1, contributes: true, finished: true }
      ]
    })
  })
})
