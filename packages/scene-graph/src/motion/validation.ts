import {
  MOTION_LIMITS,
  type MotionDirection,
  type MotionEasing,
  type MotionEasingName,
  type MotionFill,
  type MotionKeyframe,
  type MotionPresetProvenance,
  type MotionSpec,
  type MotionTiming,
  type MotionTrack,
  type MotionTrigger,
  type MotionValidationCode,
  type MotionValidationIssue,
  type MotionValidationResult
} from './types'

export class MotionValidationError extends Error {
  readonly issues: MotionValidationIssue[]

  constructor(issues: MotionValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'))
    this.name = 'MotionValidationError'
    this.issues = issues
  }
}

type UnknownRecord = Record<string, unknown>

const TRIGGERS: readonly MotionTrigger[] = [
  'mount',
  'hover',
  'press',
  'focus',
  'click',
  'inView',
  'loop'
]
const EASING_NAMES: readonly MotionEasingName[] = [
  'linear',
  'ease',
  'ease-in',
  'ease-out',
  'ease-in-out'
]
const DIRECTIONS: readonly MotionDirection[] = [
  'normal',
  'reverse',
  'alternate',
  'alternate-reverse'
]
const FILLS: readonly MotionFill[] = ['none', 'forwards', 'backwards', 'both']
const EXITS = ['none', 'reverse', 'reset'] as const
const REDUCED_MOTION = ['reduce', 'disable', 'allow'] as const
const SAFE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const SAFE_PARAMETER_STRING = /^[\p{L}\p{N} _.-]{0,128}$/u
const DANGEROUS_IDS = new Set(['constructor', 'prototype', '__proto__', 'javascript'])

function invalid(path: string, code: MotionValidationCode, message: string): never {
  throw new MotionValidationError([{ path, code, message }])
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function plainRecord(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(path, 'invalid_type', 'Expected a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, 'invalid_type', 'Expected a plain object without a custom prototype')
  }
  return value as UnknownRecord
}

function strictRecord(value: unknown, path: string, allowedKeys: readonly string[]): UnknownRecord {
  const record = plainRecord(value, path)
  for (const key of Object.keys(record)) {
    if (!allowedKeys.includes(key)) invalid(`${path}.${key}`, 'unknown_key', 'Unknown field')
  }
  return record
}

function required(record: UnknownRecord, key: string, path: string): unknown {
  if (!Object.hasOwn(record, key) || record[key] === undefined) {
    return invalid(`${path}.${key}`, 'invalid_value', 'Required field is missing')
  }
  return record[key]
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number') return invalid(path, 'invalid_type', 'Expected a number')
  if (!Number.isFinite(value)) return invalid(path, 'invalid_value', 'Expected a finite number')
  return Object.is(value, -0) ? 0 : value
}

function boundedNumber(value: unknown, path: string, min: number, max: number): number {
  const number = finiteNumber(value, path)
  if (number < min || number > max) {
    return invalid(path, 'out_of_range', `Expected a value from ${min} to ${max}`)
  }
  return number
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const number = boundedNumber(value, path, min, max)
  if (!Number.isInteger(number)) return invalid(path, 'invalid_value', 'Expected an integer')
  return number
}

function safeId(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'invalid_type', 'Expected an identifier')
  if (!SAFE_ID.test(value) || DANGEROUS_IDS.has(value.toLowerCase())) {
    return invalid(
      path,
      'invalid_value',
      `Expected a safe identifier of at most ${MOTION_LIMITS.maxIdLength} characters`
    )
  }
  return value
}

function parseEasing(value: unknown, path: string): MotionEasing {
  if (typeof value === 'string') {
    if (!isOneOf(value, EASING_NAMES)) return invalid(path, 'invalid_value', 'Unknown easing')
    return value
  }
  const record = strictRecord(value, path, ['type', 'x1', 'y1', 'x2', 'y2'])
  if (required(record, 'type', path) !== 'cubicBezier') {
    return invalid(`${path}.type`, 'invalid_value', 'Expected cubicBezier')
  }
  return {
    type: 'cubicBezier',
    x1: boundedNumber(required(record, 'x1', path), `${path}.x1`, 0, 1),
    y1: boundedNumber(
      required(record, 'y1', path),
      `${path}.y1`,
      MOTION_LIMITS.cubicBezierY.min,
      MOTION_LIMITS.cubicBezierY.max
    ),
    x2: boundedNumber(required(record, 'x2', path), `${path}.x2`, 0, 1),
    y2: boundedNumber(
      required(record, 'y2', path),
      `${path}.y2`,
      MOTION_LIMITS.cubicBezierY.min,
      MOTION_LIMITS.cubicBezierY.max
    )
  }
}

function parseKeyframe(value: unknown, path: string): MotionKeyframe {
  const record = strictRecord(value, path, [
    'offset',
    'opacity',
    'x',
    'y',
    'scaleX',
    'scaleY',
    'rotate',
    'easing'
  ])
  const keyframe: MotionKeyframe = {
    offset: boundedNumber(required(record, 'offset', path), `${path}.offset`, 0, 1)
  }
  const boundedFields = {
    opacity: MOTION_LIMITS.opacity,
    x: MOTION_LIMITS.translate,
    y: MOTION_LIMITS.translate,
    scaleX: MOTION_LIMITS.scale,
    scaleY: MOTION_LIMITS.scale,
    rotate: MOTION_LIMITS.rotate
  } as const
  for (const field of Object.keys(boundedFields) as Array<keyof typeof boundedFields>) {
    if (!Object.hasOwn(record, field)) continue
    const limit = boundedFields[field]
    keyframe[field] = boundedNumber(record[field], `${path}.${field}`, limit.min, limit.max)
  }
  if (Object.hasOwn(record, 'easing')) {
    keyframe.easing = parseEasing(record.easing, `${path}.easing`)
  }
  return keyframe
}

function parseTiming(value: unknown, path: string): MotionTiming {
  const record = strictRecord(value, path, [
    'durationMs',
    'delayMs',
    'easing',
    'iterations',
    'direction',
    'fill'
  ])
  const timing: MotionTiming = {
    durationMs: boundedNumber(
      required(record, 'durationMs', path),
      `${path}.durationMs`,
      MOTION_LIMITS.durationMs.min,
      MOTION_LIMITS.durationMs.max
    )
  }
  if (Object.hasOwn(record, 'delayMs')) {
    timing.delayMs = boundedNumber(
      record.delayMs,
      `${path}.delayMs`,
      MOTION_LIMITS.delayMs.min,
      MOTION_LIMITS.delayMs.max
    )
  }
  if (Object.hasOwn(record, 'easing')) timing.easing = parseEasing(record.easing, `${path}.easing`)
  if (Object.hasOwn(record, 'iterations')) {
    timing.iterations =
      record.iterations === 'infinite'
        ? 'infinite'
        : boundedNumber(
            record.iterations,
            `${path}.iterations`,
            MOTION_LIMITS.iterations.min,
            MOTION_LIMITS.iterations.max
          )
  }
  if (Object.hasOwn(record, 'direction')) {
    if (!isOneOf(record.direction, DIRECTIONS)) {
      return invalid(`${path}.direction`, 'invalid_value', 'Unknown direction')
    }
    timing.direction = record.direction
  }
  if (Object.hasOwn(record, 'fill')) {
    if (!isOneOf(record.fill, FILLS))
      return invalid(`${path}.fill`, 'invalid_value', 'Unknown fill')
    timing.fill = record.fill
  }
  return timing
}

function parseTrack(value: unknown, path: string): MotionTrack {
  const record = strictRecord(value, path, ['id', 'trigger', 'keyframes', 'timing', 'exit'])
  const rawKeyframes = required(record, 'keyframes', path)
  if (!Array.isArray(rawKeyframes)) {
    return invalid(`${path}.keyframes`, 'invalid_type', 'Expected an array')
  }
  if (rawKeyframes.length < 2 || rawKeyframes.length > MOTION_LIMITS.maxKeyframes) {
    return invalid(
      `${path}.keyframes`,
      'limit_exceeded',
      `Expected between 2 and ${MOTION_LIMITS.maxKeyframes} keyframes`
    )
  }
  const keyframes = rawKeyframes.map((keyframe, index) =>
    parseKeyframe(keyframe, `${path}.keyframes[${index}]`)
  )
  if (keyframes[0].offset !== 0 || keyframes.at(-1)?.offset !== 1) {
    return invalid(`${path}.keyframes`, 'invalid_value', 'First offset must be 0 and last offset 1')
  }
  for (let index = 1; index < keyframes.length; index++) {
    if (keyframes[index].offset < keyframes[index - 1].offset) {
      return invalid(
        `${path}.keyframes[${index}].offset`,
        'invalid_value',
        'Offsets must be non-decreasing'
      )
    }
  }
  const trigger = required(record, 'trigger', path)
  if (!isOneOf(trigger, TRIGGERS)) {
    return invalid(`${path}.trigger`, 'invalid_value', 'Unknown trigger')
  }
  const track: MotionTrack = {
    id: safeId(required(record, 'id', path), `${path}.id`),
    trigger,
    keyframes,
    timing: parseTiming(required(record, 'timing', path), `${path}.timing`)
  }
  if (Object.hasOwn(record, 'exit')) {
    if (!isOneOf(record.exit, EXITS))
      return invalid(`${path}.exit`, 'invalid_value', 'Unknown exit')
    track.exit = record.exit
  }
  return track
}

function parsePresetParameters(value: unknown, path: string): MotionPresetProvenance['parameters'] {
  const record = plainRecord(value, path)
  const keys = Object.keys(record)
  if (keys.length > MOTION_LIMITS.maxPresetParameters) {
    return invalid(path, 'limit_exceeded', 'Too many preset parameters')
  }
  const parameters: MotionPresetProvenance['parameters'] = {}
  for (const key of keys) {
    safeId(key, `${path}.${key}`)
    const parameter = record[key]
    if (typeof parameter === 'number') parameters[key] = finiteNumber(parameter, `${path}.${key}`)
    else if (typeof parameter === 'boolean') parameters[key] = parameter
    else if (typeof parameter === 'string' && SAFE_PARAMETER_STRING.test(parameter)) {
      parameters[key] = parameter
    } else {
      invalid(
        `${path}.${key}`,
        'invalid_value',
        `Expected a safe scalar of at most ${MOTION_LIMITS.maxParameterStringLength} characters`
      )
    }
  }
  return parameters
}

export function parseMotionPresetProvenance(
  value: unknown,
  path = 'preset'
): MotionPresetProvenance {
  const record = strictRecord(value, path, ['id', 'version', 'parameters'])
  return {
    id: safeId(required(record, 'id', path), `${path}.id`),
    version: integer(required(record, 'version', path), `${path}.version`, 1, 1_000),
    parameters: parsePresetParameters(required(record, 'parameters', path), `${path}.parameters`)
  }
}

export function parseMotionSpec(value: unknown): MotionSpec {
  const record = strictRecord(value, 'motion', ['version', 'tracks', 'reducedMotion', 'preset'])
  if (required(record, 'version', 'motion') !== 1) {
    return invalid('motion.version', 'invalid_value', 'Only MotionSpec version 1 is supported')
  }
  const rawTracks = required(record, 'tracks', 'motion')
  if (!Array.isArray(rawTracks))
    return invalid('motion.tracks', 'invalid_type', 'Expected an array')
  if (rawTracks.length < 1 || rawTracks.length > MOTION_LIMITS.maxTracks) {
    return invalid(
      'motion.tracks',
      'limit_exceeded',
      `Expected between 1 and ${MOTION_LIMITS.maxTracks} tracks`
    )
  }
  const tracks = rawTracks.map((track, index) => parseTrack(track, `motion.tracks[${index}]`))
  const ids = new Set<string>()
  let keyframeCount = 0
  for (const track of tracks) {
    if (ids.has(track.id))
      return invalid('motion.tracks', 'invalid_value', 'Track ids must be unique')
    ids.add(track.id)
    keyframeCount += track.keyframes.length
  }
  if (keyframeCount > MOTION_LIMITS.maxKeyframes) {
    return invalid(
      'motion.tracks',
      'limit_exceeded',
      `A spec may contain at most ${MOTION_LIMITS.maxKeyframes} keyframes`
    )
  }
  const spec: MotionSpec = { version: 1, tracks }
  if (Object.hasOwn(record, 'reducedMotion')) {
    if (!isOneOf(record.reducedMotion, REDUCED_MOTION)) {
      return invalid('motion.reducedMotion', 'invalid_value', 'Unknown reduced-motion policy')
    }
    spec.reducedMotion = record.reducedMotion
  }
  if (Object.hasOwn(record, 'preset')) {
    spec.preset = parseMotionPresetProvenance(record.preset, 'motion.preset')
  }
  return spec
}

export function validateMotionSpec(value: unknown): MotionValidationResult {
  try {
    return { success: true, value: parseMotionSpec(value) }
  } catch (error) {
    if (error instanceof MotionValidationError) return { success: false, issues: error.issues }
    throw error
  }
}

export function isMotionSpec(value: unknown): value is MotionSpec {
  return validateMotionSpec(value).success
}

function cloneEasing(easing: MotionEasing | undefined): MotionEasing | undefined {
  return typeof easing === 'object' ? { ...easing } : easing
}

/** Return a fresh copy without sharing any mutable nested MotionSpec values. */
export function cloneMotionSpec(spec: MotionSpec): MotionSpec {
  const copy: MotionSpec = {
    version: 1,
    tracks: spec.tracks.map((track) => {
      const keyframes = track.keyframes.map((keyframe) => {
        const copy = { ...keyframe }
        if (keyframe.easing === undefined) delete copy.easing
        else copy.easing = cloneEasing(keyframe.easing)
        return copy
      })
      const timing = { ...track.timing }
      if (track.timing.easing === undefined) delete timing.easing
      else timing.easing = cloneEasing(track.timing.easing)
      return { ...track, keyframes, timing }
    })
  }
  if (spec.reducedMotion !== undefined) copy.reducedMotion = spec.reducedMotion
  if (spec.preset) {
    copy.preset = { ...spec.preset, parameters: { ...spec.preset.parameters } }
  }
  return copy
}
