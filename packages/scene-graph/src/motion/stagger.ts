import { isMotionPresetId } from './presets'
import { MOTION_LIMITS, type MotionSpec, type MotionValidationCode } from './types'
import { MotionValidationError, parseMotionSpec } from './validation'

export const MOTION_STAGGER_DIRECTIONS = Object.freeze(['forward', 'reverse'] as const)
export const MOTION_STAGGER_RHYTHMS = Object.freeze([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out'
] as const)

export type MotionStaggerDirection = (typeof MOTION_STAGGER_DIRECTIONS)[number]
export type MotionStaggerRhythm = (typeof MOTION_STAGGER_RHYTHMS)[number]

export interface MotionStaggerOptions {
  stepMs: number
  direction?: MotionStaggerDirection
  rhythm?: MotionStaggerRhythm
}

interface NormalizedStaggerOptions {
  stepMs: number
  direction: MotionStaggerDirection
  rhythm: MotionStaggerRhythm
}

interface MotionStaggerOptionsInput {
  stepMs?: unknown
  direction?: unknown
  rhythm?: unknown
}

function invalid(path: string, code: MotionValidationCode, message: string): never {
  throw new MotionValidationError([{ path, code, message }])
}

function isStaggerDirection(value: unknown): value is MotionStaggerDirection {
  return (
    typeof value === 'string' && (MOTION_STAGGER_DIRECTIONS as readonly string[]).includes(value)
  )
}

function isStaggerRhythm(value: unknown): value is MotionStaggerRhythm {
  return typeof value === 'string' && (MOTION_STAGGER_RHYTHMS as readonly string[]).includes(value)
}

function isStaggerOptionsInput(value: unknown): value is MotionStaggerOptionsInput {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeOptions(value: unknown): NormalizedStaggerOptions {
  if (!isStaggerOptionsInput(value)) {
    return invalid('stagger', 'invalid_type', 'Expected a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid('stagger', 'invalid_type', 'Expected a plain object without a custom prototype')
  }
  for (const key of Object.keys(value)) {
    if (!['stepMs', 'direction', 'rhythm'].includes(key)) {
      invalid(`stagger.${key}`, 'unknown_key', 'Unknown field')
    }
  }
  const stepMs = value.stepMs
  if (typeof stepMs !== 'number' || !Number.isFinite(stepMs)) {
    return invalid('stagger.stepMs', 'invalid_type', 'Expected a finite number')
  }
  if (stepMs < 0 || stepMs > MOTION_LIMITS.delayMs.max) {
    return invalid(
      'stagger.stepMs',
      'out_of_range',
      `Expected a value from 0 to ${MOTION_LIMITS.delayMs.max}`
    )
  }
  const direction = value.direction ?? 'forward'
  if (!isStaggerDirection(direction)) {
    return invalid('stagger.direction', 'invalid_value', 'Unknown stagger direction')
  }
  const rhythm = value.rhythm ?? 'linear'
  if (!isStaggerRhythm(rhythm)) {
    return invalid('stagger.rhythm', 'invalid_value', 'Unknown stagger rhythm')
  }
  return {
    stepMs: Object.is(stepMs, -0) ? 0 : stepMs,
    direction,
    rhythm
  }
}

function validCount(count: number): number {
  if (!Number.isInteger(count) || count < 1) {
    return invalid('stagger.count', 'invalid_value', 'Expected a positive integer')
  }
  return count
}

function validIndex(index: number, count: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return invalid('stagger.index', 'out_of_range', `Expected an integer from 0 to ${count - 1}`)
  }
  return index
}

function rhythmProgress(progress: number, rhythm: MotionStaggerRhythm): number {
  switch (rhythm) {
    case 'linear':
      return progress
    case 'ease-in':
      return progress * progress
    case 'ease-out':
      return 1 - (1 - progress) * (1 - progress)
    case 'ease-in-out':
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - ((-2 * progress + 2) * (-2 * progress + 2)) / 2
  }
  return invalid('stagger.rhythm', 'invalid_value', 'Unknown stagger rhythm')
}

function totalSpan(count: number, stepMs: number): number {
  const span = (count - 1) * stepMs
  if (!Number.isFinite(span)) {
    return invalid('stagger', 'limit_exceeded', 'Stagger span must be finite')
  }
  return span
}

function builtInPresetDelay(spec: MotionSpec): number | undefined {
  const delay = spec.preset?.parameters.delayMs
  return spec.preset && isMotionPresetId(spec.preset.id) && typeof delay === 'number'
    ? delay
    : undefined
}

/** Return the delay offset for one item in a bounded stagger sequence. */
export function motionStaggerDelay(
  index: number,
  count: number,
  options: MotionStaggerOptions
): number {
  const normalizedCount = validCount(count)
  const normalizedIndex = validIndex(index, normalizedCount)
  const normalized = normalizeOptions(options)
  if (normalizedCount === 1 || normalized.stepMs === 0) return 0
  const orderedIndex =
    normalized.direction === 'forward' ? normalizedIndex : normalizedCount - 1 - normalizedIndex
  const progress = orderedIndex / (normalizedCount - 1)
  const offset =
    rhythmProgress(progress, normalized.rhythm) * totalSpan(normalizedCount, normalized.stepMs)
  if (!Number.isFinite(offset) || offset > MOTION_LIMITS.delayMs.max) {
    return invalid(
      'stagger.delayMs',
      'limit_exceeded',
      `Stagger delay may not exceed ${MOTION_LIMITS.delayMs.max}`
    )
  }
  return Object.is(offset, -0) ? 0 : offset
}

/** Preflight a complete sequence before applying any staggered node updates. */
export function assertMotionStaggerBatch(
  spec: MotionSpec,
  count: number,
  options: MotionStaggerOptions
): void {
  const parsed = parseMotionSpec(spec)
  const normalizedCount = validCount(count)
  const normalized = normalizeOptions(options)
  const maximumOffset = totalSpan(normalizedCount, normalized.stepMs)
  if (maximumOffset > MOTION_LIMITS.delayMs.max) {
    invalid(
      'stagger.delayMs',
      'limit_exceeded',
      `Stagger delay may not exceed ${MOTION_LIMITS.delayMs.max}`
    )
  }
  parsed.tracks.forEach((track, trackIndex) => {
    const delay = track.timing.delayMs ?? 0
    if (delay + maximumOffset > MOTION_LIMITS.delayMs.max) {
      invalid(
        `motion.tracks[${trackIndex}].timing.delayMs`,
        'limit_exceeded',
        `Staggered delay may not exceed ${MOTION_LIMITS.delayMs.max}`
      )
    }
  })
  const presetDelay = builtInPresetDelay(parsed)
  if (presetDelay !== undefined && presetDelay + maximumOffset > MOTION_LIMITS.delayMs.max) {
    invalid(
      'motion.preset.parameters.delayMs',
      'limit_exceeded',
      `Staggered delay may not exceed ${MOTION_LIMITS.delayMs.max}`
    )
  }
}

/** Return a fresh MotionSpec with the item's offset added to every track delay. */
export function withMotionStagger(
  spec: MotionSpec,
  index: number,
  count: number,
  options: MotionStaggerOptions
): MotionSpec {
  const parsed = parseMotionSpec(spec)
  const offset = motionStaggerDelay(index, count, options)
  const delays = parsed.tracks.map((track, trackIndex) => {
    const delay = (track.timing.delayMs ?? 0) + offset
    if (delay > MOTION_LIMITS.delayMs.max) {
      invalid(
        `motion.tracks[${trackIndex}].timing.delayMs`,
        'limit_exceeded',
        `Staggered delay may not exceed ${MOTION_LIMITS.delayMs.max}`
      )
    }
    return delay
  })
  const presetDelay = builtInPresetDelay(parsed)
  if (presetDelay !== undefined && presetDelay + offset > MOTION_LIMITS.delayMs.max) {
    invalid(
      'motion.preset.parameters.delayMs',
      'limit_exceeded',
      `Staggered delay may not exceed ${MOTION_LIMITS.delayMs.max}`
    )
  }
  if (offset !== 0) {
    parsed.tracks.forEach((track, trackIndex) => {
      track.timing.delayMs = delays[trackIndex]
    })
  }
  if (presetDelay !== undefined && parsed.preset) {
    parsed.preset.parameters.delayMs = presetDelay + offset
  } else if (offset !== 0 && parsed.preset) {
    // Unknown/user provenance cannot reconstruct a staggered derivative. Keep the
    // full authored snapshot, but stop presenting it as the unchanged library item.
    delete parsed.preset
  }
  return parsed
}
