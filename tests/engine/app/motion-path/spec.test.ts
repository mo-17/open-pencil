import { describe, expect, test } from 'bun:test'

import { sampleMotionPath, sampleMotionSpec } from '@open-pencil/core/motion'
import { parseMotionSpec, type MotionSpec } from '@open-pencil/scene-graph'

import {
  addMotionCubicPathSegment,
  isMotionCubicPath,
  removeMotionCubicPathSegment,
  setMotionCubicPathHandle,
  upgradeMotionPathToCubic
} from '@/app/motion-path/spec'

function legacyPathSpec(version: 2 | 3 = 2): MotionSpec {
  return parseMotionSpec({
    version,
    reducedMotion: 'disable',
    tracks: [
      {
        id: 'move',
        trigger: 'mount',
        keyframes: [
          { offset: 0, pathProgress: 0 },
          { offset: 1, pathProgress: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear' },
        path: {
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 80 }
          ],
          autoRotate: true
        }
      }
    ]
  })
}

function cubicPathSpec(): MotionSpec {
  return parseMotionSpec({
    version: 3,
    tracks: [
      {
        id: 'move',
        trigger: 'mount',
        keyframes: [
          { offset: 0, pathProgress: 0 },
          { offset: 1, pathProgress: 1 }
        ],
        timing: { durationMs: 100, easing: 'linear' },
        path: {
          version: 2,
          start: { x: 0, y: 0 },
          segments: [
            {
              control1: { x: 0, y: 0 },
              control2: { x: 0, y: 0 },
              end: { x: 0, y: 0 }
            }
          ]
        }
      }
    ]
  })
}

describe('Motion cubic path authoring model', () => {
  test('explicitly upgrades v2 polyline segments without changing sampled motion', () => {
    const legacy = legacyPathSpec()
    const path = legacy.tracks[0]?.path
    if (!path) throw new Error('Expected legacy path')

    const upgraded = upgradeMotionPathToCubic(legacy, 'move')
    const cubic = upgraded.tracks[0]?.path
    expect(upgraded.version).toBe(3)
    expect(isMotionCubicPath(cubic)).toBe(true)
    if (!isMotionCubicPath(cubic)) return
    expect(cubic.autoRotate).toBe(true)
    expect(cubic.segments).toHaveLength(2)

    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const before = sampleMotionPath(path, progress)
      const after = sampleMotionPath(cubic, progress)
      expect(after.x).toBeCloseTo(before.x, 8)
      expect(after.y).toBeCloseTo(before.y, 8)
      expect(after.angle).toBeCloseTo(before.angle, 8)
    }
    expect(legacy.version).toBe(2)
    expect(legacy.tracks[0]?.path).toBe(path)
  })

  test('adds and removes multi-segments while keeping degenerate paths finite', () => {
    const authored = cubicPathSpec()
    const extended = addMotionCubicPathSegment(authored, 'move')
    const path = extended.tracks[0]?.path
    if (!isMotionCubicPath(path)) throw new Error('Expected cubic path')
    expect(path.segments).toHaveLength(2)
    expect(path.segments[1]?.end).toEqual({ x: 100, y: 0 })
    expect(sampleMotionPath(path, 0.25)).toMatchObject({ x: expect.any(Number), y: 0 })

    const edited = setMotionCubicPathHandle(
      extended,
      'move',
      { kind: 'control1', segmentIndex: 1 },
      { x: Number.MAX_VALUE, y: -Number.MAX_VALUE }
    )
    const editedPath = edited.tracks[0]?.path
    if (!isMotionCubicPath(editedPath)) throw new Error('Expected cubic path')
    expect(editedPath.segments[1]?.control1).toEqual({ x: 100_000, y: -100_000 })
    const sample = sampleMotionPath(editedPath, 0.75)
    expect(Number.isFinite(sample.x)).toBe(true)
    expect(Number.isFinite(sample.y)).toBe(true)
    expect(Number.isFinite(sample.angle)).toBe(true)

    const reduced = removeMotionCubicPathSegment(edited, 'move', 0)
    expect(isMotionCubicPath(reduced.tracks[0]?.path)).toBe(true)
    expect(() => removeMotionCubicPathSegment(reduced, 'move', 0)).toThrow('at least one segment')
  })

  test('preserves reduced-motion policy through the explicit upgrade', () => {
    const upgraded = upgradeMotionPathToCubic(legacyPathSpec(), 'move')
    const normal = sampleMotionSpec(upgraded, 100).visual
    const reduced = sampleMotionSpec(upgraded, 100, { prefersReducedMotion: true })
    expect(normal.x).toBe(60)
    expect(normal.y).toBe(80)
    expect(reduced.hasTracks).toBe(false)
    expect(reduced.visual.x).toBe(0)
    expect(reduced.visual.y).toBe(0)
  })
})
