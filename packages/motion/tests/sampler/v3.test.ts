import { describe, expect, test } from 'bun:test'

import {
  prepareMotionSamplingPlan,
  sampleMotionSpec,
  samplePreparedMotionPlanWithDiagnostics
} from '@open-pencil/motion'
import type { MotionSpec, MotionTrack, MotionTrackComposition } from '@open-pencil/scene-graph'

function track(id: string, x: [number, number], composition?: MotionTrackComposition): MotionTrack {
  return {
    id,
    trigger: 'mount',
    keyframes: [
      { offset: 0, x: x[0] },
      { offset: 1, x: x[1] }
    ],
    timing: { durationMs: 100, easing: 'linear' },
    ...(composition ? { composition } : {})
  }
}

function v3(tracks: MotionTrack[]): MotionSpec {
  return { version: 3, reducedMotion: 'allow', tracks }
}

describe('MotionSpec v3 reference composition', () => {
  test('sorts priority ascending and preserves authored order for ties', () => {
    const motion = v3([
      track('high', [100, 100], { mode: 'replace', priority: 10 }),
      track('low-first', [10, 10], { mode: 'replace', priority: -5 }),
      track('low-second', [20, 20], { mode: 'replace', priority: -5 })
    ])
    const plan = prepareMotionSamplingPlan(motion, { selection: { mode: 'all' } })

    expect(plan.tracks.map((item) => item.id)).toEqual(['low-first', 'low-second', 'high'])
    expect(plan.tracks.map((item) => item.composition.sourceIndex)).toEqual([1, 2, 0])
    expect(sampleMotionSpec(motion, 50).visual.x).toBe(100)
  })

  test('weights replace against the current composed value', () => {
    const motion = v3([
      track('base', [20, 20], { mode: 'replace' }),
      track('weighted', [100, 100], { mode: 'replace', weight: 0.25 })
    ])

    expect(sampleMotionSpec(motion, 50).visual.x).toBe(40)
  })

  test('adds transform and opacity deltas from their channel identities', () => {
    const motion = v3([
      {
        id: 'add-all',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 20, y: -10, rotate: 90, scaleX: 2, scaleY: 3, opacity: 0.5 },
          { offset: 1, x: 20, y: -10, rotate: 90, scaleX: 2, scaleY: 3, opacity: 0.5 }
        ],
        timing: { durationMs: 100, easing: 'linear' },
        composition: { mode: 'add', weight: 0.5 }
      }
    ])

    expect(sampleMotionSpec(motion, 50).visual).toEqual({
      x: 10,
      y: -5,
      scaleX: 1.5,
      scaleY: 2,
      rotate: 45,
      opacity: 0.75
    })
  })

  test('accumulates only completed iterations and keeps the current iteration contribution', () => {
    const motion = v3([
      {
        ...track('repeat', [0, 10], { mode: 'accumulate' }),
        timing: { durationMs: 100, easing: 'linear', iterations: 3, fill: 'forwards' }
      }
    ])

    expect(sampleMotionSpec(motion, 250).visual.x).toBe(25)
    expect(sampleMotionSpec(motion, 300).visual.x).toBe(30)
  })

  test('keeps fractional accumulate continuous at the finite endpoint', () => {
    const motion = v3([
      {
        ...track('fractional', [0, 10], { mode: 'accumulate' }),
        timing: { durationMs: 100, easing: 'linear', iterations: 1.5, fill: 'forwards' }
      }
    ])

    expect(sampleMotionSpec(motion, 149.999).visual.x).toBeCloseTo(14.9999, 4)
    expect(sampleMotionSpec(motion, 150).visual.x).toBe(15)
  })

  test('exposes normalized composition in prepared tracks and v3 diagnostics', () => {
    const motion = v3([track('diagnostic', [0, 10], { mode: 'add', priority: 2 })])
    const plan = prepareMotionSamplingPlan(motion, { selection: { mode: 'all' } })
    const sample = samplePreparedMotionPlanWithDiagnostics(plan, 50)

    expect(plan.tracks[0].composition).toEqual({
      mode: 'add',
      weight: 1,
      priority: 2,
      sourceIndex: 0
    })
    expect(sample.tracks[0].composition).toEqual({ mode: 'add', weight: 1, priority: 2 })
    expect(sample.tracks[0].visual.x).toBe(5)
  })
})
