import {
  MOTION_LIMITS,
  type MotionEasing,
  type MotionSpec,
  type MotionTiming,
  type MotionTrack,
  type MotionValidationCode
} from './types'
import { MotionValidationError, parseMotionPresetProvenance, parseMotionSpec } from './validation'

export const MOTION_PRESET_IDS = Object.freeze([
  'fade-in',
  'slide-up',
  'scale-in',
  'bounce-in',
  'hover-lift',
  'press',
  'pulse',
  'float'
] as const)

export type MotionPresetId = (typeof MOTION_PRESET_IDS)[number]
export const MOTION_PRESET_CATEGORIES = Object.freeze([
  'entrance',
  'interaction',
  'emphasis',
  'loop'
] as const)
export type MotionPresetCategory = (typeof MOTION_PRESET_CATEGORIES)[number]
export type MotionPresetParameterName = 'durationMs' | 'delayMs' | 'distance' | 'intensity'
export type MotionPresetParameters = Partial<Record<MotionPresetParameterName, number>>

export interface MotionPresetParameterDefinition {
  readonly defaultValue: number
  readonly min: number
  readonly max: number
}

export interface MotionPresetDefinition {
  readonly id: MotionPresetId
  readonly version: 1
  readonly category: MotionPresetCategory
  readonly keywords: readonly string[]
  readonly parameters: Readonly<
    Partial<Record<MotionPresetParameterName, MotionPresetParameterDefinition>>
  >
}

interface PresetParameterRecord {
  [key: string]: unknown
}

function parameter(
  defaultValue: number,
  min: number,
  max: number
): MotionPresetParameterDefinition {
  return Object.freeze({ defaultValue, min, max })
}

function presetDefinition(
  id: MotionPresetId,
  category: MotionPresetCategory,
  keywords: readonly string[],
  parameters: MotionPresetDefinition['parameters']
): MotionPresetDefinition {
  return Object.freeze({
    id,
    version: 1,
    category,
    keywords: Object.freeze([...keywords]),
    parameters: Object.freeze(parameters)
  })
}

const duration = (defaultValue: number) =>
  parameter(defaultValue, MOTION_LIMITS.durationMs.min, MOTION_LIMITS.durationMs.max)
const delay = () => parameter(0, MOTION_LIMITS.delayMs.min, MOTION_LIMITS.delayMs.max)
const distance = (defaultValue: number) => parameter(defaultValue, 0, MOTION_LIMITS.translate.max)
const intensity = (max: number) => parameter(1, 0, max)

export const MOTION_PRESET_REGISTRY: Readonly<Record<MotionPresetId, MotionPresetDefinition>> =
  Object.freeze({
    'fade-in': presetDefinition('fade-in', 'entrance', ['fade', 'opacity', 'entrance'], {
      durationMs: duration(400),
      delayMs: delay()
    }),
    'slide-up': presetDefinition('slide-up', 'entrance', ['slide', 'up', 'entrance'], {
      durationMs: duration(500),
      delayMs: delay(),
      distance: distance(24)
    }),
    'scale-in': presetDefinition('scale-in', 'entrance', ['scale', 'zoom', 'entrance'], {
      durationMs: duration(400),
      delayMs: delay(),
      intensity: intensity(10)
    }),
    'bounce-in': presetDefinition('bounce-in', 'entrance', ['bounce', 'scale', 'entrance'], {
      durationMs: duration(650),
      delayMs: delay(),
      intensity: intensity(10)
    }),
    'hover-lift': presetDefinition('hover-lift', 'interaction', ['hover', 'lift', 'interaction'], {
      durationMs: duration(180),
      delayMs: delay(),
      distance: distance(8)
    }),
    press: presetDefinition('press', 'interaction', ['press', 'tap', 'interaction'], {
      durationMs: duration(120),
      delayMs: delay(),
      intensity: intensity(10)
    }),
    pulse: presetDefinition('pulse', 'emphasis', ['pulse', 'emphasis', 'attention'], {
      durationMs: duration(1_600),
      delayMs: delay(),
      intensity: intensity(10)
    }),
    float: presetDefinition('float', 'loop', ['float', 'loop', 'ambient'], {
      durationMs: duration(2_500),
      delayMs: delay(),
      distance: distance(12)
    })
  })

export function isMotionPresetId(value: unknown): value is MotionPresetId {
  return typeof value === 'string' && (MOTION_PRESET_IDS as readonly string[]).includes(value)
}

function presetInvalid(path: string, code: MotionValidationCode, message: string): never {
  throw new MotionValidationError([{ path, code, message }])
}

function presetRecord(value: unknown): PresetParameterRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return presetInvalid('preset.parameters', 'invalid_type', 'Expected a plain object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return presetInvalid(
      'preset.parameters',
      'invalid_type',
      'Expected a plain object without a custom prototype'
    )
  }
  return value as PresetParameterRecord
}

function normalizePresetParameters(id: MotionPresetId, value: unknown): Record<string, number> {
  const record = presetRecord(value)
  const definition = MOTION_PRESET_REGISTRY[id]
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(definition.parameters, key)) {
      presetInvalid(`preset.parameters.${key}`, 'unknown_key', `Unsupported parameter for ${id}`)
    }
  }
  const normalized: Record<string, number> = {}
  for (const [name, rule] of Object.entries(definition.parameters)) {
    const raw = Object.hasOwn(record, name) ? record[name] : rule.defaultValue
    if (typeof raw !== 'number') {
      presetInvalid(`preset.parameters.${name}`, 'invalid_type', 'Expected a number')
    }
    if (!Number.isFinite(raw)) {
      presetInvalid(`preset.parameters.${name}`, 'invalid_value', 'Expected a finite number')
    }
    const number = Object.is(raw, -0) ? 0 : raw
    normalized[name] = Math.min(rule.max, Math.max(rule.min, number))
  }
  return normalized
}

function presetTiming(parameters: Record<string, number>, easing: MotionEasing): MotionTiming {
  return {
    durationMs: parameters.durationMs,
    delayMs: parameters.delayMs,
    easing,
    fill: 'both'
  }
}

function buildPreset(id: MotionPresetId, parameters: Record<string, number>): MotionSpec {
  const timing = presetTiming(parameters, 'ease-out')
  let track: MotionTrack
  switch (id) {
    case 'fade-in':
      track = {
        id,
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0 },
          { offset: 1, opacity: 1 }
        ],
        timing,
        exit: 'none'
      }
      break
    case 'slide-up':
      track = {
        id,
        trigger: 'mount',
        keyframes: [
          { offset: 0, opacity: 0, y: parameters.distance },
          { offset: 1, opacity: 1, y: 0 }
        ],
        timing,
        exit: 'none'
      }
      break
    case 'scale-in':
      track = {
        id,
        trigger: 'mount',
        keyframes: [
          {
            offset: 0,
            opacity: 0,
            scaleX: Math.max(0, 1 - parameters.intensity * 0.05),
            scaleY: Math.max(0, 1 - parameters.intensity * 0.05)
          },
          { offset: 1, opacity: 1, scaleX: 1, scaleY: 1 }
        ],
        timing,
        exit: 'none'
      }
      break
    case 'bounce-in':
      track = {
        id,
        trigger: 'mount',
        keyframes: [
          {
            offset: 0,
            opacity: 0,
            scaleX: Math.max(0, 1 - parameters.intensity * 0.2),
            scaleY: Math.max(0, 1 - parameters.intensity * 0.2)
          },
          {
            offset: 0.65,
            opacity: 1,
            scaleX: 1 + parameters.intensity * 0.05,
            scaleY: 1 + parameters.intensity * 0.05
          },
          {
            offset: 0.82,
            opacity: 1,
            scaleX: Math.max(0, 1 - parameters.intensity * 0.015),
            scaleY: Math.max(0, 1 - parameters.intensity * 0.015)
          },
          { offset: 1, opacity: 1, scaleX: 1, scaleY: 1 }
        ],
        timing: presetTiming(parameters, {
          type: 'cubicBezier',
          x1: 0.2,
          y1: 0.8,
          x2: 0.2,
          y2: 1
        }),
        exit: 'none'
      }
      break
    case 'hover-lift':
      track = {
        id,
        trigger: 'hover',
        keyframes: [
          { offset: 0, y: 0 },
          { offset: 1, y: -parameters.distance }
        ],
        timing,
        exit: 'reverse'
      }
      break
    case 'press':
      track = {
        id,
        trigger: 'press',
        keyframes: [
          { offset: 0, scaleX: 1, scaleY: 1 },
          {
            offset: 1,
            scaleX: Math.max(0, 1 - parameters.intensity * 0.04),
            scaleY: Math.max(0, 1 - parameters.intensity * 0.04)
          }
        ],
        timing,
        exit: 'reverse'
      }
      break
    case 'pulse':
      track = {
        id,
        trigger: 'loop',
        keyframes: [
          { offset: 0, scaleX: 1, scaleY: 1 },
          {
            offset: 0.5,
            scaleX: 1 + parameters.intensity * 0.05,
            scaleY: 1 + parameters.intensity * 0.05
          },
          { offset: 1, scaleX: 1, scaleY: 1 }
        ],
        timing: { ...presetTiming(parameters, 'ease-in-out'), iterations: 'infinite' },
        exit: 'none'
      }
      break
    case 'float':
      track = {
        id,
        trigger: 'loop',
        keyframes: [
          { offset: 0, y: 0 },
          { offset: 0.5, y: -parameters.distance },
          { offset: 1, y: 0 }
        ],
        timing: { ...presetTiming(parameters, 'ease-in-out'), iterations: 'infinite' },
        exit: 'none'
      }
      break
  }
  return {
    version: 1,
    tracks: [track],
    reducedMotion: 'reduce',
    preset: { id, version: 1, parameters: { ...parameters } }
  }
}

function createMotionPresetFromUnknown(id: MotionPresetId, parameters: unknown): MotionSpec {
  return parseMotionSpec(buildPreset(id, normalizePresetParameters(id, parameters)))
}

/** Create a fresh, validated MotionSpec from one built-in preset. */
export function createMotionPreset(
  id: MotionPresetId,
  parameters: MotionPresetParameters = {}
): MotionSpec {
  if (!isMotionPresetId(id)) presetInvalid('preset.id', 'invalid_value', 'Unknown motion preset')
  return createMotionPresetFromUnknown(id, parameters)
}

/** Rebuild a preset from stored provenance instead of trusting duplicated keyframes. */
export function expandMotionPreset(value: unknown): MotionSpec {
  const preset = parseMotionPresetProvenance(value)
  if (!isMotionPresetId(preset.id)) {
    return presetInvalid('preset.id', 'invalid_value', 'Unknown motion preset')
  }
  if (preset.version !== MOTION_PRESET_REGISTRY[preset.id].version) {
    presetInvalid('preset.version', 'invalid_value', 'Unsupported motion preset version')
  }
  return createMotionPresetFromUnknown(preset.id, preset.parameters)
}
