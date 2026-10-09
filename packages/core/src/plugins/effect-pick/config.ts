import * as v from 'valibot'

import { isPlainJSONObject } from '@open-pencil/scene-graph'

import { EFFECT_PICK_COLLECTION_VERSIONS, getEffectPickCatalogEntry } from './catalog'
import type { EffectPickCatalogEntry, EffectPickConfigV1 } from './types'

export const EFFECT_PICK_LIMITS = Object.freeze({ text: 160, minSpeed: 0.1, maxSpeed: 4 })

const color = v.pipe(v.string(), v.regex(/^#[\da-fA-F]{6}(?:[\da-fA-F]{2})?$/))

export const EFFECT_PICK_CONFIG_SCHEMA = v.strictObject({
  effectId: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
  collectionVersion: v.picklist(EFFECT_PICK_COLLECTION_VERSIONS),
  artifactDigest: v.pipe(v.string(), v.regex(/^[\da-f]{64}$/)),
  text: v.pipe(v.string(), v.maxLength(EFFECT_PICK_LIMITS.text)),
  color,
  secondaryColor: color,
  speed: v.pipe(
    v.number(),
    v.finite(),
    v.minValue(EFFECT_PICK_LIMITS.minSpeed),
    v.maxValue(EFFECT_PICK_LIMITS.maxSpeed)
  )
})

export type EffectPickConfigResult =
  | { ok: true; config: EffectPickConfigV1 }
  | { ok: false; reason: string }

export function parseEffectPickConfig(value: unknown): EffectPickConfigResult {
  if (!isPlainJSONObject(value)) {
    return { ok: false, reason: 'EffectPick config must be a plain JSON object' }
  }
  const parsed = v.safeParse(EFFECT_PICK_CONFIG_SCHEMA, value)
  if (!parsed.success) return { ok: false, reason: parsed.issues[0].message }
  const entry = getEffectPickCatalogEntry(parsed.output.effectId)
  if (!entry) return { ok: false, reason: `Unknown EffectPick effect ${parsed.output.effectId}` }
  if (parsed.output.collectionVersion !== entry.collectionVersion) {
    return { ok: false, reason: 'EffectPick collection version does not match the reviewed effect' }
  }
  if (parsed.output.artifactDigest !== entry.artifactDigest) {
    return { ok: false, reason: 'EffectPick artifact digest is not in the reviewed catalog' }
  }
  return { ok: true, config: parsed.output }
}

export function requireEffectPickConfig(value: unknown): EffectPickConfigV1 {
  const result = parseEffectPickConfig(value)
  if (!result.ok) throw new TypeError(result.reason)
  return result.config
}

export function createEffectPickConfig(
  effectId = 'diagonal-fill',
  overrides?: unknown
): EffectPickConfigV1 {
  const entry = getEffectPickCatalogEntry(effectId)
  if (!entry) throw new TypeError(`Unknown EffectPick effect ${effectId}`)
  if (overrides === undefined) return structuredClone(entry.defaultConfig)
  if (!isPlainJSONObject(overrides))
    throw new TypeError('EffectPick overrides must be a plain JSON object')
  return requireEffectPickConfig({ ...entry.defaultConfig, ...overrides })
}

/** Reject unreviewed identity or props before either editor or compiler receives an artifact. */
export function findEffectPickArtifact(config: unknown): EffectPickCatalogEntry | undefined {
  const parsed = parseEffectPickConfig(config)
  return parsed.ok ? getEffectPickCatalogEntry(parsed.config.effectId) : undefined
}
