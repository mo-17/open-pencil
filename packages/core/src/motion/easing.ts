import type { MotionEasing } from '@open-pencil/scene-graph'

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

/** Sample a CSS-compatible named or cubic-bezier easing. */
export function sampleMotionEasing(easing: MotionEasing, progress: number): number {
  const normalized = Math.min(1, Math.max(0, progress))
  if (normalized === 0 || normalized === 1) return normalized
  if (easing === 'linear') return normalized
  const [x1, y1, x2, y2] =
    typeof easing === 'string'
      ? NAMED_EASINGS[easing]
      : [easing.x1, easing.y1, easing.x2, easing.y2]
  const parameter = solveCurveX(normalized, x1, x2)
  return cubicCoordinate(parameter, y1, y2)
}
