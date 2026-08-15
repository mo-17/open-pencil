import type { MotionPath, MotionPathPoint } from '@open-pencil/scene-graph'

/** Fixed deterministic integration budget per cubic segment. */
export const MOTION_CUBIC_PATH_LOOKUP_STEPS = 32

export interface MotionPathSample extends MotionPathPoint {
  readonly angle: number
}

interface PreparedLineSegment {
  readonly kind: 'line'
  readonly start: Readonly<MotionPathPoint>
  readonly end: Readonly<MotionPathPoint>
  readonly length: number
}

interface PreparedCubicSegment {
  readonly kind: 'cubic'
  readonly start: Readonly<MotionPathPoint>
  readonly control1: Readonly<MotionPathPoint>
  readonly control2: Readonly<MotionPathPoint>
  readonly end: Readonly<MotionPathPoint>
  readonly length: number
  /** Arc length from t=0 through every fixed lookup sample. */
  readonly cumulativeLengths: readonly number[]
}

type PreparedPathSegment = PreparedLineSegment | PreparedCubicSegment

export interface PreparedMotionPath {
  readonly autoRotate: boolean
  readonly start: Readonly<MotionPathPoint>
  readonly segments: readonly PreparedPathSegment[]
  readonly totalLength: number
}

function point(x: number, y: number): MotionPathPoint {
  return { x, y }
}

function distance(left: Readonly<MotionPathPoint>, right: Readonly<MotionPathPoint>): number {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function cubicPoint(
  start: Readonly<MotionPathPoint>,
  control1: Readonly<MotionPathPoint>,
  control2: Readonly<MotionPathPoint>,
  end: Readonly<MotionPathPoint>,
  t: number
): MotionPathPoint {
  const inverse = 1 - t
  const startWeight = inverse * inverse * inverse
  const firstWeight = 3 * inverse * inverse * t
  const secondWeight = 3 * inverse * t * t
  const endWeight = t * t * t
  return point(
    startWeight * start.x +
      firstWeight * control1.x +
      secondWeight * control2.x +
      endWeight * end.x,
    startWeight * start.y + firstWeight * control1.y + secondWeight * control2.y + endWeight * end.y
  )
}

function prepareCubicSegment(
  start: Readonly<MotionPathPoint>,
  control1: Readonly<MotionPathPoint>,
  control2: Readonly<MotionPathPoint>,
  end: Readonly<MotionPathPoint>
): PreparedCubicSegment {
  const cumulativeLengths = [0]
  let previous = start
  let length = 0
  for (let step = 1; step <= MOTION_CUBIC_PATH_LOOKUP_STEPS; step++) {
    const current = cubicPoint(
      start,
      control1,
      control2,
      end,
      step / MOTION_CUBIC_PATH_LOOKUP_STEPS
    )
    length += distance(previous, current)
    cumulativeLengths.push(length)
    previous = current
  }
  return {
    kind: 'cubic',
    start: { ...start },
    control1: { ...control1 },
    control2: { ...control2 },
    end: { ...end },
    length,
    cumulativeLengths
  }
}

/** Prepare one bounded path once for repeated constant-speed sampling. */
export function prepareMotionPath(path: Readonly<MotionPath>): PreparedMotionPath {
  if (path.version === 2) {
    const segments: PreparedCubicSegment[] = []
    let start: Readonly<MotionPathPoint> = path.start
    let totalLength = 0
    for (const segment of path.segments) {
      const prepared = prepareCubicSegment(start, segment.control1, segment.control2, segment.end)
      segments.push(prepared)
      totalLength += prepared.length
      start = segment.end
    }
    return {
      autoRotate: path.autoRotate === true,
      start: { ...path.start },
      segments,
      totalLength
    }
  }

  const segments: PreparedLineSegment[] = []
  let totalLength = 0
  for (let index = 1; index < path.points.length; index++) {
    const start = path.points[index - 1]
    const end = path.points[index]
    const length = distance(start, end)
    segments.push({ kind: 'line', start: { ...start }, end: { ...end }, length })
    totalLength += length
  }
  return {
    autoRotate: path.autoRotate === true,
    start: { ...(path.points[0] ?? { x: 0, y: 0 }) },
    segments,
    totalLength
  }
}

/** Return normalized arc-length positions at every non-terminal segment boundary. */
export function motionPathBoundaryProgresses(path: Readonly<MotionPath>): number[] {
  const prepared = prepareMotionPath(path)
  if (prepared.totalLength <= 0) return []
  let consumed = 0
  return prepared.segments.slice(0, -1).flatMap((segment) => {
    consumed += segment.length
    return segment.length > 0 ? [consumed / prepared.totalLength] : []
  })
}

function cubicParameterAtLength(segment: PreparedCubicSegment, targetLength: number): number {
  const lengths = segment.cumulativeLengths
  let upper = 1
  while (upper < lengths.length - 1 && lengths[upper] < targetLength) upper++
  const lower = upper - 1
  const startLength = lengths[lower]
  const span = lengths[upper] - startLength
  const local = span <= 0 ? 0 : (targetLength - startLength) / span
  return (lower + Math.min(1, Math.max(0, local))) / MOTION_CUBIC_PATH_LOOKUP_STEPS
}

function cubicTangent(segment: PreparedCubicSegment, t: number): MotionPathPoint {
  const inverse = 1 - t
  let x =
    3 * inverse * inverse * (segment.control1.x - segment.start.x) +
    6 * inverse * t * (segment.control2.x - segment.control1.x) +
    3 * t * t * (segment.end.x - segment.control2.x)
  let y =
    3 * inverse * inverse * (segment.control1.y - segment.start.y) +
    6 * inverse * t * (segment.control2.y - segment.control1.y) +
    3 * t * t * (segment.end.y - segment.control2.y)
  if (Math.hypot(x, y) <= 1e-9) {
    const before = cubicPoint(
      segment.start,
      segment.control1,
      segment.control2,
      segment.end,
      Math.max(0, t - 1e-4)
    )
    const after = cubicPoint(
      segment.start,
      segment.control1,
      segment.control2,
      segment.end,
      Math.min(1, t + 1e-4)
    )
    x = after.x - before.x
    y = after.y - before.y
  }
  return point(x, y)
}

function sampleSegment(segment: PreparedPathSegment, distanceOnSegment: number): MotionPathSample {
  if (segment.kind === 'line') {
    const local = segment.length <= 0 ? 0 : distanceOnSegment / segment.length
    return {
      x: segment.start.x + (segment.end.x - segment.start.x) * local,
      y: segment.start.y + (segment.end.y - segment.start.y) * local,
      angle:
        (Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x) * 180) /
        Math.PI
    }
  }
  const t = cubicParameterAtLength(segment, distanceOnSegment)
  const sampled = cubicPoint(segment.start, segment.control1, segment.control2, segment.end, t)
  const tangent = cubicTangent(segment, t)
  return {
    ...sampled,
    angle:
      Math.hypot(tangent.x, tangent.y) <= 1e-9
        ? 0
        : (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
  }
}

/** Sample normalized progress by arc length, returning the geometric tangent in degrees. */
export function samplePreparedMotionPath(
  path: PreparedMotionPath,
  progress: number
): MotionPathSample {
  if (path.totalLength <= 0 || path.segments.length === 0) {
    return { ...path.start, angle: 0 }
  }
  let remaining = Math.min(1, Math.max(0, progress)) * path.totalLength
  for (let index = 0; index < path.segments.length; index++) {
    const segment = path.segments[index]
    if (remaining <= segment.length || index === path.segments.length - 1) {
      return sampleSegment(segment, Math.min(segment.length, Math.max(0, remaining)))
    }
    remaining -= segment.length
  }
  const last = path.segments.at(-1)
  return last ? sampleSegment(last, last.length) : { ...path.start, angle: 0 }
}

export function sampleMotionPath(path: Readonly<MotionPath>, progress: number): MotionPathSample {
  return samplePreparedMotionPath(prepareMotionPath(path), progress)
}
