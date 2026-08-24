import type { MotionEaseMode, MotionEasing } from '@open-pencil/scene-graph'

const NAMED_EASINGS = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1]
} as const

function cubicCoordinate(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t
}

function cubicDerivative(t: number, first: number, second: number): number {
  const inverse = 1 - t
  return (
    3 * inverse * inverse * first + 6 * inverse * t * (second - first) + 3 * t * t * (1 - second)
  )
}

function solveCurveX(progress: number, x1: number, x2: number): number {
  let estimate = progress
  for (let iteration = 0; iteration < 8; iteration++) {
    const error = cubicCoordinate(estimate, x1, x2) - progress
    if (Math.abs(error) < 1e-7) return estimate
    const derivative = cubicDerivative(estimate, x1, x2)
    if (Math.abs(derivative) < 1e-7) break
    const next = estimate - error / derivative
    if (next < 0 || next > 1) break
    estimate = next
  }

  let lower = 0
  let upper = 1
  for (let iteration = 0; iteration < 20; iteration++) {
    estimate = (lower + upper) / 2
    if (cubicCoordinate(estimate, x1, x2) < progress) lower = estimate
    else upper = estimate
  }
  return estimate
}

interface CubicPoint {
  x: number
  y: number
}

export interface SplitMotionEasing {
  /** Eased output at the split point. */
  value: number
  /** Easing for the segment before the inserted keyframe. */
  before: MotionEasing
  /** Easing for the segment after the inserted keyframe. */
  after: MotionEasing
  /** False only when a degenerate/unsafe curve cannot be represented exactly. */
  exact: boolean
}

function lerpPoint(from: CubicPoint, to: CubicPoint, progress: number): CubicPoint {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress
  }
}

function cubicControlPoints(easing: MotionEasing): [CubicPoint, CubicPoint] {
  if (typeof easing === 'object' && easing.type !== 'cubicBezier') {
    throw new Error(`Motion easing ${easing.type} is not a cubic curve`)
  }
  const [x1, y1, x2, y2] =
    typeof easing === 'string'
      ? NAMED_EASINGS[easing]
      : [easing.x1, easing.y1, easing.x2, easing.y2]
  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 }
  ]
}

function normalizedControlPoint(
  point: CubicPoint,
  origin: CubicPoint,
  extent: CubicPoint
): CubicPoint {
  return {
    x: (point.x - origin.x) / extent.x,
    y: (point.y - origin.y) / extent.y
  }
}

function safeCubicEasing(first: CubicPoint, second: CubicPoint): MotionEasing | null {
  const values = [first.x, first.y, second.x, second.y]
  if (values.some((value) => !Number.isFinite(value))) return null
  if (first.x < 0 || first.x > 1 || second.x < 0 || second.x > 1) return null
  // MotionSpec intentionally bounds cubic Y controls. Keep insertion valid for
  // extreme authored curves even when their exact subdivision exceeds the bound.
  if (first.y < -100 || first.y > 100 || second.y < -100 || second.y > 100) return null
  return {
    type: 'cubicBezier',
    x1: first.x,
    y1: first.y,
    x2: second.x,
    y2: second.y
  }
}

/**
 * Split a CSS-compatible easing at an input progress. The returned sub-curves
 * are normalized so inserting a keyframe can preserve the complete visual
 * curve, rather than only matching the value at the insertion point.
 */
export function splitMotionEasing(easing: MotionEasing, progress: number): SplitMotionEasing {
  const normalized = Math.min(1, Math.max(0, progress))
  if (typeof easing === 'object' && easing.type !== 'cubicBezier') {
    return {
      value: sampleMotionEasing(easing, normalized),
      before: easing,
      after: easing,
      exact: false
    }
  }
  if (normalized === 0 || normalized === 1 || easing === 'linear') {
    return { value: normalized, before: easing, after: easing, exact: true }
  }

  const [first, second] = cubicControlPoints(easing)
  const parameter = solveCurveX(normalized, first.x, second.x)
  const start = { x: 0, y: 0 }
  const end = { x: 1, y: 1 }
  const firstSplit = lerpPoint(start, first, parameter)
  const middleSplit = lerpPoint(first, second, parameter)
  const lastSplit = lerpPoint(second, end, parameter)
  const beforeSecond = lerpPoint(firstSplit, middleSplit, parameter)
  const afterFirst = lerpPoint(middleSplit, lastSplit, parameter)
  const split = lerpPoint(beforeSecond, afterFirst, parameter)

  const epsilon = 1e-9
  if (
    split.x <= epsilon ||
    1 - split.x <= epsilon ||
    Math.abs(split.y) <= epsilon ||
    Math.abs(1 - split.y) <= epsilon
  ) {
    return { value: split.y, before: easing, after: easing, exact: false }
  }

  const before = safeCubicEasing(
    normalizedControlPoint(firstSplit, start, split),
    normalizedControlPoint(beforeSecond, start, split)
  )
  const afterExtent = { x: 1 - split.x, y: 1 - split.y }
  const after = safeCubicEasing(
    normalizedControlPoint(afterFirst, split, afterExtent),
    normalizedControlPoint(lastSplit, split, afterExtent)
  )
  if (!before || !after) {
    return { value: split.y, before: easing, after: easing, exact: false }
  }
  return { value: split.y, before, after, exact: true }
}

function sampleSpring(easing: Extract<MotionEasing, { type: 'spring' }>, progress: number): number {
  const angular = Math.sqrt(easing.stiffness / easing.mass)
  const dampingRatio = easing.damping / (2 * Math.sqrt(easing.stiffness * easing.mass))
  if (dampingRatio < 1) {
    const damped = angular * Math.sqrt(1 - dampingRatio * dampingRatio)
    const coefficient = (dampingRatio * angular - easing.velocity) / damped
    return (
      1 -
      Math.exp(-dampingRatio * angular * progress) *
        (Math.cos(damped * progress) + coefficient * Math.sin(damped * progress))
    )
  }
  if (Math.abs(dampingRatio - 1) < 1e-6) {
    return 1 - Math.exp(-angular * progress) * (1 + (angular - easing.velocity) * progress)
  }
  const root = Math.sqrt(dampingRatio * dampingRatio - 1)
  const first = -angular * (dampingRatio - root)
  const second = -angular * (dampingRatio + root)
  const secondWeight = (easing.velocity - first) / (first - second)
  const firstWeight = 1 - secondWeight
  return 1 - firstWeight * Math.exp(first * progress) - secondWeight * Math.exp(second * progress)
}

function sampleInertia(
  easing: Extract<MotionEasing, { type: 'inertia' }>,
  progress: number
): number {
  const rate = Math.max(0.0001, easing.deceleration * 12 + Math.abs(easing.velocity) * 0.002)
  const denominator = 1 - Math.exp(-rate)
  const decay = denominator === 0 ? progress : (1 - Math.exp(-rate * progress)) / denominator
  const velocityBias = easing.velocity * 0.0005 * progress * (1 - progress)
  return Math.min(1, Math.max(0, decay + velocityBias))
}

type EaseIn = (progress: number) => number

function applyEaseMode(mode: MotionEaseMode, progress: number, easeIn: EaseIn): number {
  if (mode === 'in') return easeIn(progress)
  if (mode === 'out') return 1 - easeIn(1 - progress)
  return progress < 0.5 ? easeIn(progress * 2) / 2 : 1 - easeIn((1 - progress) * 2) / 2
}

function bounceOut(progress: number): number {
  const factor = 7.5625
  const divisor = 2.75
  if (progress < 1 / divisor) return factor * progress * progress
  if (progress < 2 / divisor) {
    const shifted = progress - 1.5 / divisor
    return factor * shifted * shifted + 0.75
  }
  if (progress < 2.5 / divisor) {
    const shifted = progress - 2.25 / divisor
    return factor * shifted * shifted + 0.9375
  }
  const shifted = progress - 2.625 / divisor
  return factor * shifted * shifted + 0.984375
}

function bounceIn(progress: number): number {
  return 1 - bounceOut(1 - progress)
}

function elasticIn(progress: number, amplitude: number, period: number): number {
  const phase = (period / (Math.PI * 2)) * Math.asin(1 / amplitude)
  return (
    -amplitude *
    2 ** (10 * (progress - 1)) *
    Math.sin(((progress - 1 - phase) * Math.PI * 2) / period)
  )
}

type RichEasing = Extract<
  MotionEasing,
  { type: 'power' | 'sine' | 'expo' | 'circ' | 'back' | 'bounce' | 'elastic' }
>

function sampleRichEasing(easing: RichEasing, progress: number): number {
  switch (easing.type) {
    case 'power':
      return applyEaseMode(easing.mode, progress, (value) => value ** (easing.power + 1))
    case 'sine':
      return applyEaseMode(easing.mode, progress, (value) => 1 - Math.cos((value * Math.PI) / 2))
    case 'expo':
      return applyEaseMode(easing.mode, progress, (value) => 2 ** (10 * (value - 1)))
    case 'circ':
      return applyEaseMode(easing.mode, progress, (value) => 1 - Math.sqrt(1 - value * value))
    case 'back':
      return applyEaseMode(easing.mode, progress, (value) => {
        return (easing.overshoot + 1) * value ** 3 - easing.overshoot * value ** 2
      })
    case 'bounce':
      return applyEaseMode(easing.mode, progress, bounceIn)
    case 'elastic':
      return applyEaseMode(easing.mode, progress, (value) => {
        return elasticIn(value, easing.amplitude, easing.period)
      })
  }
  throw new TypeError('Unsupported rich Motion easing')
}

/** Sample every bounded MotionSpec easing deterministically. */
export function sampleMotionEasing(easing: MotionEasing, progress: number): number {
  const normalized = Math.min(1, Math.max(0, progress))
  if (normalized === 0 || normalized === 1) return normalized
  if (easing === 'linear') return normalized
  if (typeof easing === 'object') {
    if (easing.type === 'hold') return 0
    if (easing.type === 'steps') {
      const stepped =
        easing.position === 'start'
          ? Math.ceil(normalized * easing.steps)
          : Math.floor(normalized * easing.steps)
      return Math.min(1, Math.max(0, stepped / easing.steps))
    }
    if (easing.type === 'spring') return sampleSpring(easing, normalized)
    if (easing.type === 'inertia') return sampleInertia(easing, normalized)
    if (easing.type !== 'cubicBezier') return sampleRichEasing(easing, normalized)
  }
  const [x1, y1, x2, y2] =
    typeof easing === 'string'
      ? NAMED_EASINGS[easing]
      : [easing.x1, easing.y1, easing.x2, easing.y2]
  const parameter = solveCurveX(normalized, x1, x2)
  return cubicCoordinate(parameter, y1, y2)
}
