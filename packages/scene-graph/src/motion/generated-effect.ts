import type { MotionColor, MotionValidationIssue } from './types'
import {
  assertMotionPortableValue,
  createMotionValidationHelpers,
  MotionIssueValidationError,
  type MotionValidationRecord
} from './validation-helpers'

export const GENERATED_EFFECT_SPEC_VERSION = 1 as const

export const GENERATED_EFFECT_PRESETS = ['noise', 'shimmer', 'scanlines', 'particles'] as const

export type GeneratedEffectPreset = (typeof GENERATED_EFFECT_PRESETS)[number]
export type GeneratedEffectBlendMode = 'normal' | 'screen' | 'multiply' | 'overlay'

export const GENERATED_EFFECT_LIMITS = Object.freeze({
  maxPrimitives: 128,
  maxRasterPixels: 262_144,
  maxFrequencyHz: 12,
  maxTimeScale: 8,
  maxTimeOffsetMs: 120_000,
  maxStaticTimeMs: 120_000,
  maxSeed: 0xffff_ffff,
  maxParticleCount: 64,
  maxNoiseCells: 96
})

export interface GeneratedEffectUniforms {
  /** The only supported time source. Runtimes inject preview/export time explicitly. */
  time: {
    source: 'timeline'
    scale: number
    offsetMs: number
    /** Upper-bounds temporal change and visible flicker. */
    frequencyHz: number
  }
  /** Unsigned deterministic seed. No runtime entropy is consulted. */
  seed: number
}

export interface GeneratedEffectBudget {
  /** Maximum number of abstract drawing primitives sampled for one node/frame. */
  maxPrimitives: number
  /** Maximum backing-store area used by the compiled Canvas2D fallback. */
  maxRasterPixels: number
}

export type GeneratedEffectReducedMotion = { mode: 'disable' } | { mode: 'static'; timeMs: number }

export type GeneratedEffectFallback = { kind: 'none' } | { kind: 'static'; timeMs: number }

export interface GeneratedNoiseParams {
  preset: 'noise'
  cells: number
  intensity: number
  tint: MotionColor
}

export interface GeneratedShimmerParams {
  preset: 'shimmer'
  bands: number
  width: number
  angle: number
  color: MotionColor
}

export interface GeneratedScanlineParams {
  preset: 'scanlines'
  lines: number
  thickness: number
  color: MotionColor
}

export interface GeneratedParticleParams {
  preset: 'particles'
  count: number
  size: number
  drift: number
  color: MotionColor
}

export type GeneratedEffectParams =
  | GeneratedNoiseParams
  | GeneratedShimmerParams
  | GeneratedScanlineParams
  | GeneratedParticleParams

/**
 * Strict generated visual layer. It contains no shader/program source, URLs,
 * expressions, or user-defined uniforms: only allowlisted presets and bounded data.
 */
export interface GeneratedEffectSpecV1 {
  version: typeof GENERATED_EFFECT_SPEC_VERSION
  params: GeneratedEffectParams
  uniforms: GeneratedEffectUniforms
  budget: GeneratedEffectBudget
  opacity: number
  blendMode: GeneratedEffectBlendMode
  reducedMotion: GeneratedEffectReducedMotion
  fallback: GeneratedEffectFallback
}

export type GeneratedEffectValidationResult =
  | { success: true; value: GeneratedEffectSpecV1 }
  | { success: false; issues: MotionValidationIssue[] }

export class GeneratedEffectValidationError extends MotionIssueValidationError {
  constructor(issues: MotionValidationIssue[]) {
    super(issues)
    this.name = 'GeneratedEffectValidationError'
  }
}

const { invalid, required, strictRecord } = createMotionValidationHelpers(
  (issues) => new GeneratedEffectValidationError(issues),
  { rejectSymbolFields: true }
)

function unreachableGeneratedEffectVariant(value: never): never {
  return invalid(
    'generatedEffect.params.preset',
    'invalid_value',
    `Unsupported generated-effect variant: ${String(value)}`
  )
}

function finiteNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalid(path, 'invalid_type', 'Expected a finite number')
  }
  if (value < min || value > max) {
    return invalid(path, 'out_of_range', `Expected a value between ${min} and ${max}`)
  }
  return Object.is(value, -0) ? 0 : value
}

function integer(value: unknown, path: string, min: number, max: number): number {
  const parsed = finiteNumber(value, path, min, max)
  return Number.isInteger(parsed) ? parsed : invalid(path, 'invalid_value', 'Expected an integer')
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
  label: string
): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return invalid(path, 'invalid_value', `Unknown ${label}`)
  }
  return value as T
}

function color(value: unknown, path: string): MotionColor {
  const record = strictRecord(value, path, ['r', 'g', 'b', 'a'])
  return {
    r: finiteNumber(required(record, 'r', path), `${path}.r`, 0, 1),
    g: finiteNumber(required(record, 'g', path), `${path}.g`, 0, 1),
    b: finiteNumber(required(record, 'b', path), `${path}.b`, 0, 1),
    a: finiteNumber(required(record, 'a', path), `${path}.a`, 0, 1)
  }
}

function parseParams(value: unknown): GeneratedEffectParams {
  const base = strictRecord(value, 'generatedEffect.params', [
    'preset',
    'cells',
    'intensity',
    'tint',
    'bands',
    'width',
    'angle',
    'color',
    'lines',
    'thickness',
    'count',
    'size',
    'drift'
  ])
  const preset = enumValue(
    required(base, 'preset', 'generatedEffect.params'),
    'generatedEffect.params.preset',
    GENERATED_EFFECT_PRESETS,
    'generated-effect preset'
  )
  return parsePresetParams(base, preset)
}

function onlyPresetKeys(record: MotionValidationRecord, allowed: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      invalid(`generatedEffect.params.${key}`, 'unknown_key', 'Unknown field for preset')
    }
  }
}

function parsePresetParams(
  record: MotionValidationRecord,
  preset: GeneratedEffectPreset
): GeneratedEffectParams {
  const path = 'generatedEffect.params'
  switch (preset) {
    case 'noise':
      onlyPresetKeys(record, ['preset', 'cells', 'intensity', 'tint'])
      return {
        preset,
        cells: integer(
          required(record, 'cells', path),
          `${path}.cells`,
          1,
          GENERATED_EFFECT_LIMITS.maxNoiseCells
        ),
        intensity: finiteNumber(required(record, 'intensity', path), `${path}.intensity`, 0, 1),
        tint: color(required(record, 'tint', path), `${path}.tint`)
      }
    case 'shimmer':
      onlyPresetKeys(record, ['preset', 'bands', 'width', 'angle', 'color'])
      return {
        preset,
        bands: integer(required(record, 'bands', path), `${path}.bands`, 1, 32),
        width: finiteNumber(required(record, 'width', path), `${path}.width`, 0.01, 1),
        angle: finiteNumber(required(record, 'angle', path), `${path}.angle`, -180, 180),
        color: color(required(record, 'color', path), `${path}.color`)
      }
    case 'scanlines':
      onlyPresetKeys(record, ['preset', 'lines', 'thickness', 'color'])
      return {
        preset,
        lines: integer(required(record, 'lines', path), `${path}.lines`, 1, 64),
        thickness: finiteNumber(required(record, 'thickness', path), `${path}.thickness`, 0.01, 1),
        color: color(required(record, 'color', path), `${path}.color`)
      }
    case 'particles':
      onlyPresetKeys(record, ['preset', 'count', 'size', 'drift', 'color'])
      return {
        preset,
        count: integer(
          required(record, 'count', path),
          `${path}.count`,
          1,
          GENERATED_EFFECT_LIMITS.maxParticleCount
        ),
        size: finiteNumber(required(record, 'size', path), `${path}.size`, 0.002, 0.25),
        drift: finiteNumber(required(record, 'drift', path), `${path}.drift`, -2, 2),
        color: color(required(record, 'color', path), `${path}.color`)
      }
  }
  return unreachableGeneratedEffectVariant(preset)
}

function parseUniforms(value: unknown): GeneratedEffectUniforms {
  const path = 'generatedEffect.uniforms'
  const record = strictRecord(value, path, ['time', 'seed'])
  const timePath = `${path}.time`
  const time = strictRecord(required(record, 'time', path), timePath, [
    'source',
    'scale',
    'offsetMs',
    'frequencyHz'
  ])
  if (required(time, 'source', timePath) !== 'timeline') {
    invalid(`${timePath}.source`, 'invalid_value', 'Only the explicit timeline source is supported')
  }
  return {
    time: {
      source: 'timeline',
      scale: finiteNumber(
        required(time, 'scale', timePath),
        `${timePath}.scale`,
        0,
        GENERATED_EFFECT_LIMITS.maxTimeScale
      ),
      offsetMs: finiteNumber(
        required(time, 'offsetMs', timePath),
        `${timePath}.offsetMs`,
        -GENERATED_EFFECT_LIMITS.maxTimeOffsetMs,
        GENERATED_EFFECT_LIMITS.maxTimeOffsetMs
      ),
      frequencyHz: finiteNumber(
        required(time, 'frequencyHz', timePath),
        `${timePath}.frequencyHz`,
        0,
        GENERATED_EFFECT_LIMITS.maxFrequencyHz
      )
    },
    seed: integer(
      required(record, 'seed', path),
      `${path}.seed`,
      0,
      GENERATED_EFFECT_LIMITS.maxSeed
    )
  }
}

function parseBudget(value: unknown): GeneratedEffectBudget {
  const path = 'generatedEffect.budget'
  const record = strictRecord(value, path, ['maxPrimitives', 'maxRasterPixels'])
  return {
    maxPrimitives: integer(
      required(record, 'maxPrimitives', path),
      `${path}.maxPrimitives`,
      1,
      GENERATED_EFFECT_LIMITS.maxPrimitives
    ),
    maxRasterPixels: integer(
      required(record, 'maxRasterPixels', path),
      `${path}.maxRasterPixels`,
      1,
      GENERATED_EFFECT_LIMITS.maxRasterPixels
    )
  }
}

function parseReducedMotion(value: unknown): GeneratedEffectReducedMotion {
  const path = 'generatedEffect.reducedMotion'
  const record = strictRecord(value, path, ['mode', 'timeMs'])
  const mode = enumValue(
    required(record, 'mode', path),
    `${path}.mode`,
    ['disable', 'static'] as const,
    'reduced-motion mode'
  )
  if (mode === 'disable') {
    if (Object.hasOwn(record, 'timeMs'))
      invalid(`${path}.timeMs`, 'unknown_key', 'disable mode has no timeMs')
    return { mode }
  }
  return {
    mode,
    timeMs: finiteNumber(
      required(record, 'timeMs', path),
      `${path}.timeMs`,
      0,
      GENERATED_EFFECT_LIMITS.maxStaticTimeMs
    )
  }
}

function parseFallback(value: unknown): GeneratedEffectFallback {
  const path = 'generatedEffect.fallback'
  const record = strictRecord(value, path, ['kind', 'timeMs'])
  const kind = enumValue(
    required(record, 'kind', path),
    `${path}.kind`,
    ['none', 'static'] as const,
    'fallback kind'
  )
  if (kind === 'none') {
    if (Object.hasOwn(record, 'timeMs'))
      invalid(`${path}.timeMs`, 'unknown_key', 'none fallback has no timeMs')
    return { kind }
  }
  return {
    kind,
    timeMs: finiteNumber(
      required(record, 'timeMs', path),
      `${path}.timeMs`,
      0,
      GENERATED_EFFECT_LIMITS.maxStaticTimeMs
    )
  }
}

function requiredPrimitiveCount(params: GeneratedEffectParams): number {
  switch (params.preset) {
    case 'noise':
      return params.cells
    case 'shimmer':
      return params.bands
    case 'scanlines':
      return params.lines
    case 'particles':
      return params.count
  }
  return unreachableGeneratedEffectVariant(params)
}

/** Parse a fresh canonical snapshot and reject every unrecognized field/version. */
export function parseGeneratedEffectSpec(value: unknown): GeneratedEffectSpecV1 {
  assertMotionPortableValue(value, 'generatedEffect', {
    invalid,
    plainRecord: (candidate, path) =>
      strictRecord(candidate, path, Object.keys(candidate as object))
  })
  const path = 'generatedEffect'
  const record = strictRecord(value, path, [
    'version',
    'params',
    'uniforms',
    'budget',
    'opacity',
    'blendMode',
    'reducedMotion',
    'fallback'
  ])
  if (required(record, 'version', path) !== GENERATED_EFFECT_SPEC_VERSION) {
    invalid(`${path}.version`, 'invalid_value', 'Unsupported generated-effect version')
  }
  const params = parseParams(required(record, 'params', path))
  const budget = parseBudget(required(record, 'budget', path))
  if (requiredPrimitiveCount(params) > budget.maxPrimitives) {
    invalid(
      `${path}.budget.maxPrimitives`,
      'limit_exceeded',
      `Preset requires ${requiredPrimitiveCount(params)} primitives`
    )
  }
  return {
    version: GENERATED_EFFECT_SPEC_VERSION,
    params,
    uniforms: parseUniforms(required(record, 'uniforms', path)),
    budget,
    opacity: finiteNumber(required(record, 'opacity', path), `${path}.opacity`, 0, 1),
    blendMode: enumValue(
      required(record, 'blendMode', path),
      `${path}.blendMode`,
      ['normal', 'screen', 'multiply', 'overlay'] as const,
      'blend mode'
    ),
    reducedMotion: parseReducedMotion(required(record, 'reducedMotion', path)),
    fallback: parseFallback(required(record, 'fallback', path))
  }
}

export function validateGeneratedEffectSpec(value: unknown): GeneratedEffectValidationResult {
  try {
    return { success: true, value: parseGeneratedEffectSpec(value) }
  } catch (error) {
    if (error instanceof GeneratedEffectValidationError) {
      return { success: false, issues: error.issues }
    }
    throw error
  }
}

export function cloneGeneratedEffectSpec(value: GeneratedEffectSpecV1): GeneratedEffectSpecV1 {
  return parseGeneratedEffectSpec(structuredClone(value))
}

export function generatedEffectIsAnimated(value: GeneratedEffectSpecV1): boolean {
  const parsed = parseGeneratedEffectSpec(value)
  return parsed.uniforms.time.scale > 0 && parsed.uniforms.time.frequencyHz > 0
}
