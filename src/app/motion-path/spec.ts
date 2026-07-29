import {
  cloneMotionSpec,
  MOTION_LIMITS,
  parseMotionSpec,
  upgradeMotionSpecV3,
  type MotionCubicPath,
  type MotionCubicPathSegment,
  type MotionPath,
  type MotionPathPoint,
  type MotionPolylinePath,
  type MotionSpec
} from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { MotionPathHandle, MotionPathHandlePoint } from './types'

function clampTranslate(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('Motion path coordinates must be finite')
  return Math.min(MOTION_LIMITS.translate.max, Math.max(MOTION_LIMITS.translate.min, value))
}

function clampedPoint(point: Readonly<MotionPathPoint>): MotionPathPoint {
  return { x: clampTranslate(point.x), y: clampTranslate(point.y) }
}

function editMotionPathSpec(spec: MotionSpec, edit: (draft: MotionSpec) => void): MotionSpec {
  const draft = cloneMotionSpec(spec)
  edit(draft)
  delete draft.preset
  return parseMotionSpec(draft)
}

function requireTrack(spec: MotionSpec, trackId: string) {
  const track = spec.tracks.find((candidate) => candidate.id === trackId)
  if (!track) throw new Error(`Unknown motion track: ${trackId}`)
  return track
}

export function isMotionCubicPath(path: MotionPath | undefined): path is MotionCubicPath {
  return path?.version === 2
}

export function isMotionPolylinePath(path: MotionPath | undefined): path is MotionPolylinePath {
  return path !== undefined && path.version !== 2
}

function straightCubicSegment(
  start: Readonly<MotionPathPoint>,
  end: Readonly<MotionPathPoint>
): MotionCubicPathSegment {
  return {
    control1: {
      x: start.x + (end.x - start.x) / 3,
      y: start.y + (end.y - start.y) / 3
    },
    control2: {
      x: start.x + ((end.x - start.x) * 2) / 3,
      y: start.y + ((end.y - start.y) * 2) / 3
    },
    end: { ...end }
  }
}

/** Convert every legacy line into its mathematically identical cubic form. */
export function cubicPathFromPolyline(path: Readonly<MotionPolylinePath>): MotionCubicPath {
  const start = path.points[0] ?? { x: 0, y: 0 }
  const segments: MotionCubicPathSegment[] = []
  for (let index = 1; index < path.points.length; index++) {
    const previous = path.points.at(index - 1)
    const point = path.points.at(index)
    if (previous && point) segments.push(straightCubicSegment(previous, point))
  }
  return {
    version: 2,
    start: { ...start },
    segments,
    ...(path.autoRotate === undefined ? {} : { autoRotate: path.autoRotate })
  }
}

/** Explicitly migrate one selected legacy path and its envelope to MotionSpec v3. */
export function upgradeMotionPathToCubic(spec: MotionSpec, trackId: string): MotionSpec {
  const upgraded = upgradeMotionSpecV3(spec)
  return editMotionPathSpec(upgraded, (draft) => {
    const track = requireTrack(draft, trackId)
    if (!track.path) throw new RangeError('Enable a motion path before upgrading it')
    if (!isMotionCubicPath(track.path)) track.path = cubicPathFromPolyline(track.path)
  })
}

export function setMotionCubicPathEnabled(
  spec: MotionSpec,
  trackId: string,
  enabled: boolean,
  endpoint: Readonly<Vector> = { x: 100, y: 0 }
): MotionSpec {
  if (spec.version !== 3) throw new RangeError('Cubic paths require MotionSpec v3')
  return editMotionPathSpec(spec, (draft) => {
    const track = requireTrack(draft, trackId)
    if (!enabled) {
      delete track.path
      for (const keyframe of track.keyframes) delete keyframe.pathProgress
      return
    }
    track.path ??= {
      version: 2,
      start: { x: 0, y: 0 },
      segments: [straightCubicSegment({ x: 0, y: 0 }, clampedPoint(endpoint))],
      autoRotate: false
    }
    for (const keyframe of track.keyframes) keyframe.pathProgress = keyframe.offset
  })
}

export function motionPathHandleKey(handle: MotionPathHandle): string {
  return handle.kind === 'start' ? 'start' : `segment-${handle.segmentIndex}-${handle.kind}`
}

export function motionPathHandlePoints(path: Readonly<MotionCubicPath>): MotionPathHandlePoint[] {
  return [
    { handle: { kind: 'start' }, point: { ...path.start } },
    ...path.segments.flatMap((segment, segmentIndex) => [
      { handle: { kind: 'control1' as const, segmentIndex }, point: { ...segment.control1 } },
      { handle: { kind: 'control2' as const, segmentIndex }, point: { ...segment.control2 } },
      { handle: { kind: 'end' as const, segmentIndex }, point: { ...segment.end } }
    ])
  ]
}

export function motionPathPointForHandle(
  path: Readonly<MotionCubicPath>,
  handle: MotionPathHandle
): MotionPathPoint | undefined {
  if (handle.kind === 'start') return { ...path.start }
  const segment = path.segments.at(handle.segmentIndex)
  return segment ? { ...segment[handle.kind] } : undefined
}

function editMotionCubicPathSpec(
  spec: MotionSpec,
  trackId: string,
  edit: (path: MotionCubicPath) => void
): MotionSpec {
  if (spec.version !== 3) throw new RangeError('Cubic paths require MotionSpec v3')
  return editMotionPathSpec(spec, (draft) => {
    const path = requireTrack(draft, trackId).path
    if (!isMotionCubicPath(path)) throw new RangeError('Upgrade the motion path before editing')
    edit(path)
  })
}

export function setMotionCubicPathHandle(
  spec: MotionSpec,
  trackId: string,
  handle: MotionPathHandle,
  point: Readonly<MotionPathPoint>
): MotionSpec {
  return editMotionCubicPathSpec(spec, trackId, (path) => {
    if (handle.kind === 'start') {
      path.start = clampedPoint(point)
      return
    }
    const segment = path.segments.at(handle.segmentIndex)
    if (!segment) throw new Error(`Unknown motion path segment: ${handle.segmentIndex}`)
    segment[handle.kind] = clampedPoint(point)
  })
}

function continuationVector(path: Readonly<MotionCubicPath>): MotionPathPoint {
  const last = path.segments.at(-1)
  if (!last) return { x: 100, y: 0 }
  const previous = path.segments.at(-2)?.end ?? path.start
  const x = last.end.x - previous.x
  const y = last.end.y - previous.y
  return x === 0 && y === 0 ? { x: 100, y: 0 } : { x, y }
}

export function addMotionCubicPathSegment(spec: MotionSpec, trackId: string): MotionSpec {
  return editMotionCubicPathSpec(spec, trackId, (path) => {
    if (path.segments.length >= MOTION_LIMITS.maxPathSegments) {
      throw new RangeError(
        `Motion paths support at most ${MOTION_LIMITS.maxPathSegments} cubic segments`
      )
    }
    const start = path.segments.at(-1)?.end ?? path.start
    const vector = continuationVector(path)
    const end = clampedPoint({ x: start.x + vector.x, y: start.y + vector.y })
    path.segments.push(straightCubicSegment(start, end))
  })
}

export function removeMotionCubicPathSegment(
  spec: MotionSpec,
  trackId: string,
  segmentIndex: number
): MotionSpec {
  return editMotionCubicPathSpec(spec, trackId, (path) => {
    if (path.segments.length <= 1) throw new RangeError('Motion paths require at least one segment')
    if (!path.segments.at(segmentIndex)) {
      throw new Error(`Unknown motion path segment: ${segmentIndex}`)
    }
    path.segments.splice(segmentIndex, 1)
  })
}
