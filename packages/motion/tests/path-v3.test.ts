import { describe, expect, test } from 'bun:test'

import {
  motionPathBoundaryProgresses,
  prepareMotionPath,
  sampleMotionPath,
  sampleMotionSpec
} from '@open-pencil/motion'
import {
  MOTION_LIMITS,
  cloneMotionPath,
  parseMotionSpec,
  validateMotionSpec,
  type MotionCubicPath,
  type MotionPath,
  type MotionSpec
} from '@open-pencil/scene-graph'

const legacyPath: MotionPath = {
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 }
  ],
  autoRotate: true
}

const cubicPath: MotionCubicPath = {
  version: 2,
  start: { x: 0, y: 0 },
  segments: [
    {
      control1: { x: 0, y: 100 },
      control2: { x: 100, y: 100 },
      end: { x: 100, y: 0 }
    }
  ],
  autoRotate: true
}

function pathSpec(version: MotionSpec['version'], path: MotionPath): MotionSpec {
  return {
    version,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'path',
        trigger: 'mount',
        path,
        keyframes: [
          { offset: 0, pathProgress: 0 },
          { offset: 1, pathProgress: 1 }
        ],
        timing: { durationMs: 1_000, easing: 'linear' }
      }
    ]
  }
}

describe('MotionSpec v3 cubic paths', () => {
  test('preserves legacy v2/v3 point paths and their exact segment-boundary behavior', () => {
    const parsedV2 = parseMotionSpec(pathSpec(2, legacyPath))
    const parsedV3 = parseMotionSpec(pathSpec(3, legacyPath))
    const v2Path = parsedV2.tracks[0].path
    const v3Path = parsedV3.tracks[0].path

    expect(v2Path && 'version' in v2Path).toBe(false)
    expect(v3Path && 'version' in v3Path).toBe(false)
    expect(sampleMotionPath(legacyPath, 0.25)).toEqual({ x: 50, y: 0, angle: 0 })
    expect(sampleMotionPath(legacyPath, 0.5)).toEqual({ x: 100, y: 0, angle: 0 })
    expect(sampleMotionPath(legacyPath, 0.75)).toEqual({ x: 100, y: 50, angle: 90 })
    expect(motionPathBoundaryProgresses(legacyPath)).toEqual([0.5])
  })

  test('accepts explicit polyline v1 and cubic v2 discriminators only in MotionSpec v3', () => {
    const explicitPolyline: MotionPath = {
      version: 1,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 }
      ]
    }
    expect(parseMotionSpec(pathSpec(3, explicitPolyline)).tracks[0].path).toEqual(explicitPolyline)
    expect(parseMotionSpec(pathSpec(3, cubicPath)).tracks[0].path).toEqual(cubicPath)
    expect(validateMotionSpec(pathSpec(2, cubicPath)).success).toBe(false)
    expect(
      validateMotionSpec({
        ...pathSpec(3, cubicPath),
        tracks: [
          {
            ...pathSpec(3, cubicPath).tracks[0],
            path: { ...cubicPath, version: 3 }
          }
        ]
      }).success
    ).toBe(false)
  })

  test('deep clones all path shapes without changing the legacy wire discriminator', () => {
    const legacyCopy = cloneMotionPath(legacyPath)
    const explicitCopy = cloneMotionPath({ ...legacyPath, version: 1 })
    const cubicCopy = cloneMotionPath(cubicPath)

    expect(legacyCopy).toEqual(legacyPath)
    expect('version' in legacyCopy).toBe(false)
    expect(legacyCopy).not.toBe(legacyPath)
    if (!('points' in legacyCopy) || !('points' in legacyPath)) {
      throw new Error('Expected polyline fixtures')
    }
    expect(legacyCopy.points[0]).not.toBe(legacyPath.points[0])
    expect(explicitCopy).toMatchObject({ version: 1 })
    expect(cubicCopy).toEqual(cubicPath)
    expect(cubicCopy.version === 2 && cubicCopy.start).not.toBe(cubicPath.start)
    expect(cubicCopy.version === 2 && cubicCopy.segments[0]?.control1).not.toBe(
      cubicPath.segments[0]?.control1
    )
  })

  test('samples cubic Beziers by arc length with stable tangents and autoRotate', () => {
    const half = sampleMotionPath(cubicPath, 0.5)
    const visual = sampleMotionSpec(pathSpec(3, cubicPath), 500).visual

    expect(half.x).toBeCloseTo(50, 6)
    expect(half.y).toBeCloseTo(75, 6)
    expect(half.angle).toBeCloseTo(0, 6)
    expect(visual.x).toBeCloseTo(50, 6)
    expect(visual.y).toBeCloseTo(75, 6)
    expect(visual.rotate).toBeCloseTo(0, 6)

    const samples = [0, 0.25, 0.5, 0.75, 1].map((progress) => sampleMotionPath(cubicPath, progress))
    const chordLengths = samples
      .slice(1)
      .map((point, index) => Math.hypot(point.x - samples[index].x, point.y - samples[index].y))
    expect(Math.max(...chordLengths) / Math.min(...chordLengths)).toBeLessThan(1.08)
  })

  test('uses arc-length boundaries across cubic segments and handles zero-length paths', () => {
    const corner: MotionCubicPath = {
      version: 2,
      start: { x: 0, y: 0 },
      segments: [
        {
          control1: { x: 100 / 3, y: 0 },
          control2: { x: 200 / 3, y: 0 },
          end: { x: 100, y: 0 }
        },
        {
          control1: { x: 100, y: 100 / 3 },
          control2: { x: 100, y: 200 / 3 },
          end: { x: 100, y: 100 }
        }
      ],
      autoRotate: true
    }
    expect(motionPathBoundaryProgresses(corner)[0]).toBeCloseTo(0.5, 12)
    expect(sampleMotionPath(corner, 0.5)).toEqual({ x: 100, y: 0, angle: 0 })
    expect(sampleMotionPath(corner, 0.5001).angle).toBeCloseTo(90, 8)

    const degenerate: MotionCubicPath = {
      version: 2,
      start: { x: 7, y: 9 },
      segments: [
        {
          control1: { x: 7, y: 9 },
          control2: { x: 7, y: 9 },
          end: { x: 7, y: 9 }
        }
      ]
    }
    const prepared = prepareMotionPath(degenerate)
    expect(prepared.totalLength).toBe(0)
    expect(sampleMotionPath(degenerate, 0.75)).toEqual({ x: 7, y: 9, angle: 0 })
    expect(motionPathBoundaryProgresses(degenerate)).toEqual([])
  })

  test('rejects empty, oversized, malformed, and unknown cubic path payloads', () => {
    const overLimit = Array.from(
      { length: MOTION_LIMITS.maxPathSegments + 1 },
      () => cubicPath.segments[0]
    )
    const base = pathSpec(3, cubicPath)
    for (const path of [
      { ...cubicPath, segments: [] },
      { ...cubicPath, segments: overLimit },
      { ...cubicPath, start: { x: Number.NaN, y: 0 } },
      { ...cubicPath, unsupported: true }
    ]) {
      expect(validateMotionSpec(pathSpec(3, path)).success).toBe(false)
    }
    expect(validateMotionSpec(base).success).toBe(true)
  })
})
