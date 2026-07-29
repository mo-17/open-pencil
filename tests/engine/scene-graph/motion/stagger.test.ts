import { describe, expect, test } from 'bun:test'

import {
  MOTION_LIMITS,
  MOTION_STAGGER_DIRECTIONS,
  MOTION_STAGGER_RHYTHMS,
  MotionValidationError,
  assertMotionStaggerBatch,
  createMotionPreset,
  motionStaggerDelay,
  withMotionStagger,
  type MotionSpec
} from '@open-pencil/scene-graph'

function multiTrackMotion(firstDelay = 10, secondDelay?: number): MotionSpec {
  return {
    version: 1,
    tracks: [
      {
        id: 'opacity',
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing: { durationMs: 300, delayMs: firstDelay }
      },
      {
        id: 'translate',
        trigger: 'mount',
        keyframes: [
          { offset: 0, y: 20 },
          { offset: 1, y: 0 }
        ],
        timing:
          secondDelay === undefined
            ? { durationMs: 400 }
            : { durationMs: 400, delayMs: secondDelay }
      }
    ],
    reducedMotion: 'reduce',
    preset: { id: 'user-combo', version: 3, parameters: {} }
  }
}

describe('motion stagger timing', () => {
  test('exposes the supported directions and rhythms', () => {
    expect([...MOTION_STAGGER_DIRECTIONS]).toEqual(['forward', 'reverse'])
    expect([...MOTION_STAGGER_RHYTHMS]).toEqual(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
    expect(Object.isFrozen(MOTION_STAGGER_DIRECTIONS)).toBe(true)
    expect(Object.isFrozen(MOTION_STAGGER_RHYTHMS)).toBe(true)
  })

  test('calculates forward and reverse linear offsets', () => {
    const forward = Array.from({ length: 5 }, (_, index) =>
      motionStaggerDelay(index, 5, { stepMs: 100 })
    )
    const reverse = Array.from({ length: 5 }, (_, index) =>
      motionStaggerDelay(index, 5, {
        stepMs: 100,
        direction: 'reverse',
        rhythm: 'linear'
      })
    )

    expect(forward).toEqual([0, 100, 200, 300, 400])
    expect(reverse).toEqual([400, 300, 200, 100, 0])
  })

  test('maps nonlinear rhythms over the same exact total span', () => {
    const offsets = (rhythm: 'ease-in' | 'ease-out' | 'ease-in-out') =>
      Array.from({ length: 5 }, (_, index) => motionStaggerDelay(index, 5, { stepMs: 100, rhythm }))

    expect(offsets('ease-in')).toEqual([0, 25, 100, 225, 400])
    expect(offsets('ease-out')).toEqual([0, 175, 300, 375, 400])
    expect(offsets('ease-in-out')).toEqual([0, 50, 200, 350, 400])
  })

  test('returns zero for a single item and for a zero step', () => {
    for (const rhythm of MOTION_STAGGER_RHYTHMS) {
      expect(motionStaggerDelay(0, 1, { stepMs: 500, rhythm })).toBe(0)
      expect(motionStaggerDelay(3, 8, { stepMs: 0, rhythm })).toBe(0)
    }
  })

  test('adds one offset to every track, deep-copies, and detaches stale user provenance', () => {
    const source = multiTrackMotion()
    const staggered = withMotionStagger(source, 2, 4, { stepMs: 75 })

    expect(staggered.tracks.map((track) => track.timing.delayMs)).toEqual([160, 150])
    expect(staggered.reducedMotion).toBe('reduce')
    expect(staggered.preset).toBeUndefined()
    expect(staggered).not.toBe(source)
    expect(staggered.tracks).not.toBe(source.tracks)
    expect(staggered.tracks[0].timing).not.toBe(source.tracks[0].timing)
    expect(staggered.tracks[0].keyframes).not.toBe(source.tracks[0].keyframes)
    expect(source.tracks.map((track) => track.timing.delayMs)).toEqual([10, undefined])
  })

  test('preserves user provenance and absent delay fields when the item offset is zero', () => {
    const source = multiTrackMotion()
    const unchanged = withMotionStagger(source, 0, 4, { stepMs: 75 })

    expect(unchanged.preset).toEqual(source.preset)
    expect(unchanged.preset?.parameters).not.toBe(source.preset?.parameters)
    expect(unchanged.tracks.map((track) => track.timing.delayMs)).toEqual([10, undefined])
  })

  test('keeps built-in preset delay provenance synchronized with the staggered track', () => {
    const source = createMotionPreset('slide-up', { delayMs: 40 })
    const staggered = withMotionStagger(source, 2, 4, { stepMs: 75 })

    expect(staggered.tracks[0].timing.delayMs).toBe(190)
    expect(staggered.preset?.parameters.delayMs).toBe(190)
    expect(source.tracks[0].timing.delayMs).toBe(40)
    expect(source.preset?.parameters.delayMs).toBe(40)
  })

  test('supports batch preflight at the exact delay boundary', () => {
    const source = multiTrackMotion(59_700, 59_600)
    expect(() => assertMotionStaggerBatch(source, 4, { stepMs: 100 })).not.toThrow()
    expect(withMotionStagger(source, 3, 4, { stepMs: 100 }).tracks[0].timing.delayMs).toBe(
      MOTION_LIMITS.delayMs.max
    )
  })

  test('batch preflight rejects a future item before any node mutation starts', () => {
    const source = multiTrackMotion(100)

    expect(motionStaggerDelay(0, 4, { stepMs: 20_000 })).toBe(0)
    expect(() => assertMotionStaggerBatch(source, 4, { stepMs: 20_000 })).toThrow(
      MotionValidationError
    )
    expect(source.tracks[0].timing.delayMs).toBe(100)

    const nearLimit = multiTrackMotion(59_950)
    expect(() => assertMotionStaggerBatch(nearLimit, 2, { stepMs: 100 })).toThrow(
      MotionValidationError
    )
  })

  test('withMotionStagger fails atomically when any resulting track exceeds 60000', () => {
    const source = multiTrackMotion(59_900, 59_950)
    const before = structuredClone(source)

    expect(() => withMotionStagger(source, 1, 2, { stepMs: 100 })).toThrow(MotionValidationError)
    expect(source).toEqual(before)
  })

  test('rejects invalid indices, counts, options, and overflowing offsets', () => {
    const invalidCalls = [
      () => motionStaggerDelay(-1, 3, { stepMs: 10 }),
      () => motionStaggerDelay(3, 3, { stepMs: 10 }),
      () => motionStaggerDelay(0.5, 3, { stepMs: 10 }),
      () => motionStaggerDelay(0, 0, { stepMs: 10 }),
      () => motionStaggerDelay(0, 3.5, { stepMs: 10 }),
      () => motionStaggerDelay(0, 3, { stepMs: -1 }),
      () => motionStaggerDelay(0, 3, { stepMs: Number.NaN }),
      () => motionStaggerDelay(0, 3, { stepMs: 60_001 }),
      () => motionStaggerDelay(2, 3, { stepMs: 30_001 }),
      () =>
        motionStaggerDelay(0, 3, {
          stepMs: 10,
          direction: 'sideways' as 'forward'
        }),
      () =>
        motionStaggerDelay(0, 3, {
          stepMs: 10,
          rhythm: 'spring' as 'linear'
        }),
      () => motionStaggerDelay(0, 3, { stepMs: 10, extra: true } as never)
    ]
    for (const call of invalidCalls) expect(call).toThrow(MotionValidationError)
  })
})
