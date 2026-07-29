import type { MotionDriverMapping } from '@open-pencil/scene-graph'

/** Scalar values accepted by page/document state inputs and the generic controller entry point. */
export type MotionInputValue = number | boolean

function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`)
  return Object.is(value, -0) ? 0 : value
}

function validateMapping(mapping: MotionDriverMapping): void {
  const inputMin = finiteNumber(mapping.inputMin, 'Motion driver inputMin')
  const inputMax = finiteNumber(mapping.inputMax, 'Motion driver inputMax')
  if (inputMax <= inputMin) {
    throw new RangeError('Motion driver inputMax must be greater than inputMin')
  }
  const deadZone = mapping.deadZone ?? 0
  if (!Number.isFinite(deadZone) || deadZone < 0 || deadZone >= 0.5) {
    throw new RangeError('Motion driver deadZone must be in the range 0..<0.5')
  }
}

/** Canonical state bridge shared by page and document state adapters. */
export function normalizeMotionStateInput(value: MotionInputValue): number {
  if (typeof value === 'boolean') return value ? 1 : 0
  return finiteNumber(value, 'Motion input')
}

function applyEndpointDeadZone(progress: number, deadZone: number): number {
  if (deadZone === 0) return progress
  if (progress <= deadZone) return 0
  if (progress >= 1 - deadZone) return 1
  return (progress - deadZone) / (1 - deadZone * 2)
}

/**
 * Map one finite input into sampler progress. The result is always in 0..1. When `clamp` is false,
 * an out-of-range value is deliberately inert instead of being extrapolated beyond the bounded
 * reference sampler.
 */
export function mapMotionDriverInput(
  value: MotionInputValue,
  mapping: MotionDriverMapping
): number | undefined {
  validateMapping(mapping)
  const input = normalizeMotionStateInput(value)
  const outside = input < mapping.inputMin || input > mapping.inputMax
  if (mapping.clamp === false && outside) return undefined

  const span = mapping.inputMax - mapping.inputMin
  let progress = Math.min(1, Math.max(0, (input - mapping.inputMin) / span))
  if (mapping.reverse === true) progress = 1 - progress
  progress = applyEndpointDeadZone(progress, mapping.deadZone ?? 0)
  const bounded = Math.min(1, Math.max(0, progress))
  return Object.is(bounded, -0) ? 0 : bounded
}
