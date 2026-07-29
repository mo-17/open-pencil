import {
  parseGeneratedEffectSpec,
  parseMotionDriverSpec,
  parseMotionSceneSpec,
  parseMotionSpec,
  parseMotionTransitionKey,
  parsePrototypeSpec,
  type GeneratedEffectSpecV1,
  type MotionDriverSpecV1,
  type MotionSceneSpec,
  type MotionSpec,
  type MotionTransitionKey,
  type PluginDataEntry,
  type PrototypeSpecV1
} from '@open-pencil/scene-graph'

import { isPlainPenRecord, type PenRecord } from './record'

/** Plugin-data carrier used to keep original `.pen` metadata format-neutral
 * while a document is edited or converted through another format. */
export const PEN_METADATA_PLUGIN_ID = 'open-pencil'
export const PEN_METADATA_PLUGIN_KEY = 'pen/metadata'

/** pen.dev's `Entity.metadata` is the supported extension point. OpenPencil
 * owns only this nested key and never replaces a foreign metadata `type`. */
export const PEN_OPEN_PENCIL_METADATA_KEY = 'openPencil'
export const PEN_OPEN_PENCIL_SCHEMA_VERSION = 1 as const
export const PEN_OPEN_PENCIL_SCHEMA_VERSION_V2 = 2 as const
export const PEN_OPEN_PENCIL_SCHEMA_VERSION_V3 = 3 as const
export const PEN_OPEN_PENCIL_CURRENT_SCHEMA_VERSION = PEN_OPEN_PENCIL_SCHEMA_VERSION_V3

export interface PenMetadata {
  type: string
  [key: string]: unknown
}

export interface PenOpenPencilMetadataV1 {
  schemaVersion: typeof PEN_OPEN_PENCIL_SCHEMA_VERSION
  /** `null` is an explicit tombstone. It prevents a ref or descendant from
   * re-inheriting Motion from its reusable source after save/reopen. */
  motion: MotionSpec | null
}

export interface PenOpenPencilMetadataV2 {
  schemaVersion: typeof PEN_OPEN_PENCIL_SCHEMA_VERSION_V2
  motion?: MotionSpec | null
  motionScene?: MotionSceneSpec | null
  motionDrivers?: MotionDriverSpecV1 | null
  prototype?: PrototypeSpecV1 | null
  transitionKey?: MotionTransitionKey | null
}

export interface PenOpenPencilMetadataV3 {
  schemaVersion: typeof PEN_OPEN_PENCIL_SCHEMA_VERSION_V3
  motion?: MotionSpec | null
  motionScene?: MotionSceneSpec | null
  motionDrivers?: MotionDriverSpecV1 | null
  prototype?: PrototypeSpecV1 | null
  transitionKey?: MotionTransitionKey | null
  generatedEffect?: GeneratedEffectSpecV1 | null
}

export type PenMotionContractField =
  | 'motion'
  | 'motionScene'
  | 'motionDrivers'
  | 'prototype'
  | 'transitionKey'
  | 'generatedEffect'

const PEN_V2_CONTRACT_FIELDS = Object.freeze<readonly PenMotionContractField[]>([
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey'
])

export const PEN_MOTION_CONTRACT_FIELDS = Object.freeze<readonly PenMotionContractField[]>([
  'motion',
  'motionScene',
  'motionDrivers',
  'prototype',
  'transitionKey',
  'generatedEffect'
])

export interface PenOpenPencilValues {
  motion?: MotionSpec | null
  motionScene?: MotionSceneSpec | null
  motionDrivers?: MotionDriverSpecV1 | null
  prototype?: PrototypeSpecV1 | null
  transitionKey?: MotionTransitionKey | null
  generatedEffect?: GeneratedEffectSpecV1 | null
}

export type PenOpenPencilMetadataState =
  | { kind: 'absent' }
  | {
      kind: 'valid'
      schemaVersion:
        | typeof PEN_OPEN_PENCIL_SCHEMA_VERSION
        | typeof PEN_OPEN_PENCIL_SCHEMA_VERSION_V2
        | typeof PEN_OPEN_PENCIL_SCHEMA_VERSION_V3
      values: PenOpenPencilValues
    }
  | { kind: 'inert' }

export interface ExtractedPenMetadata extends PenOpenPencilValues {
  hasMotion: boolean
  clearsMotion: boolean
  hasMotionScene: boolean
  clearsMotionScene: boolean
  hasMotionDrivers: boolean
  clearsMotionDrivers: boolean
  hasPrototype: boolean
  clearsPrototype: boolean
  hasTransitionKey: boolean
  clearsTransitionKey: boolean
  hasGeneratedEffect: boolean
  clearsGeneratedEffect: boolean
  /** True when an OpenPencil payload exists but this version cannot safely
   * interpret it. Writers must preserve that raw payload instead of replacing
   * it with a current-version structured value. */
  hasInertOpenPencilPayload: boolean
  /** The complete original metadata value. This includes foreign fields and
   * lets `.pen -> .fig -> .pen` retain extensions outside OpenPencil's schema. */
  pluginData: PluginDataEntry[]
}

function hasOnlyKeys(record: PenRecord, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key))
}

function parseNullable<T>(value: unknown, parse: (candidate: unknown) => T): T | null {
  return value === null ? null : parse(value)
}

function parseV2Payload(payload: PenRecord): PenOpenPencilValues | null {
  if (!hasOnlyKeys(payload, ['schemaVersion', ...PEN_V2_CONTRACT_FIELDS])) return null
  if (!PEN_V2_CONTRACT_FIELDS.some((field) => Object.hasOwn(payload, field))) return null
  return parseV2CompatibleFields(payload)
}

function parseV3Payload(payload: PenRecord): PenOpenPencilValues | null {
  if (!hasOnlyKeys(payload, ['schemaVersion', ...PEN_MOTION_CONTRACT_FIELDS])) return null
  const values = parseV2CompatibleFields(payload)
  if (Object.hasOwn(payload, 'generatedEffect')) {
    values.generatedEffect = parseNullable(payload.generatedEffect, parseGeneratedEffectSpec)
  }
  return PEN_MOTION_CONTRACT_FIELDS.some((field) => Object.hasOwn(values, field)) ? values : null
}

function parseV2CompatibleFields(payload: PenRecord): PenOpenPencilValues {
  const values: PenOpenPencilValues = {}
  if (Object.hasOwn(payload, 'motion'))
    values.motion = parseNullable(payload.motion, parseMotionSpec)
  if (Object.hasOwn(payload, 'motionScene')) {
    values.motionScene = parseNullable(payload.motionScene, parseMotionSceneSpec)
  }
  if (Object.hasOwn(payload, 'motionDrivers')) {
    values.motionDrivers = parseNullable(payload.motionDrivers, parseMotionDriverSpec)
  }
  if (Object.hasOwn(payload, 'prototype')) {
    values.prototype = parseNullable(payload.prototype, parsePrototypeSpec)
  }
  if (Object.hasOwn(payload, 'transitionKey')) {
    values.transitionKey = parseNullable(payload.transitionKey, parseMotionTransitionKey)
  }
  return values
}

/** Inspect only the namespaced OpenPencil payload. The surrounding metadata
 * remains opaque and is always preserved by `extractPenMetadata`. */
export function inspectPenOpenPencilMetadata(metadata: unknown): PenOpenPencilMetadataState {
  if (!isPlainPenRecord(metadata) || !Object.hasOwn(metadata, PEN_OPEN_PENCIL_METADATA_KEY)) {
    return { kind: 'absent' }
  }
  if (typeof metadata.type !== 'string' || metadata.type.length === 0) {
    return { kind: 'inert' }
  }

  const payload = metadata[PEN_OPEN_PENCIL_METADATA_KEY]
  if (!isPlainPenRecord(payload)) return { kind: 'inert' }

  try {
    if (payload.schemaVersion === PEN_OPEN_PENCIL_SCHEMA_VERSION) {
      if (!hasOnlyKeys(payload, ['schemaVersion', 'motion']) || !Object.hasOwn(payload, 'motion')) {
        return { kind: 'inert' }
      }
      return {
        kind: 'valid',
        schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION,
        values: { motion: parseNullable(payload.motion, parseMotionSpec) }
      }
    }
    if (payload.schemaVersion === PEN_OPEN_PENCIL_SCHEMA_VERSION_V2) {
      const values = parseV2Payload(payload)
      return values
        ? { kind: 'valid', schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION_V2, values }
        : { kind: 'inert' }
    }
    if (payload.schemaVersion === PEN_OPEN_PENCIL_SCHEMA_VERSION_V3) {
      const values = parseV3Payload(payload)
      return values
        ? { kind: 'valid', schemaVersion: PEN_OPEN_PENCIL_SCHEMA_VERSION_V3, values }
        : { kind: 'inert' }
    }
    return { kind: 'inert' }
  } catch {
    return { kind: 'inert' }
  }
}

function metadataPluginEntry(metadata: unknown): PluginDataEntry | null {
  if (metadata === undefined) return null
  const value = JSON.stringify(metadata)
  return {
    pluginId: PEN_METADATA_PLUGIN_ID,
    key: PEN_METADATA_PLUGIN_KEY,
    value
  }
}

/** Extract executable OpenPencil semantics while retaining the complete raw
 * metadata value as inert plugin data. */
export function extractPenMetadata(metadata: unknown): ExtractedPenMetadata {
  const state = inspectPenOpenPencilMetadata(metadata)
  const entry = metadataPluginEntry(metadata)
  const values = state.kind === 'valid' ? state.values : {}
  const has = (field: PenMotionContractField) => Object.hasOwn(values, field)
  return {
    ...(values.motion ? { motion: values.motion } : {}),
    ...(values.motionScene ? { motionScene: values.motionScene } : {}),
    ...(values.motionDrivers ? { motionDrivers: values.motionDrivers } : {}),
    ...(values.prototype ? { prototype: values.prototype } : {}),
    ...(values.transitionKey ? { transitionKey: values.transitionKey } : {}),
    ...(values.generatedEffect ? { generatedEffect: values.generatedEffect } : {}),
    hasMotion: has('motion'),
    clearsMotion: has('motion') && values.motion === null,
    hasMotionScene: has('motionScene'),
    clearsMotionScene: has('motionScene') && values.motionScene === null,
    hasMotionDrivers: has('motionDrivers'),
    clearsMotionDrivers: has('motionDrivers') && values.motionDrivers === null,
    hasPrototype: has('prototype'),
    clearsPrototype: has('prototype') && values.prototype === null,
    hasTransitionKey: has('transitionKey'),
    clearsTransitionKey: has('transitionKey') && values.transitionKey === null,
    hasGeneratedEffect: has('generatedEffect'),
    clearsGeneratedEffect: has('generatedEffect') && values.generatedEffect === null,
    hasInertOpenPencilPayload: state.kind === 'inert',
    pluginData: entry ? [entry] : []
  }
}

export function isPenMetadataPluginEntry(entry: PluginDataEntry): boolean {
  return entry.pluginId === PEN_METADATA_PLUGIN_ID && entry.key === PEN_METADATA_PLUGIN_KEY
}

export function findPreservedPenMetadataEntry(
  entries: readonly PluginDataEntry[]
): PluginDataEntry | undefined {
  return entries.find(isPenMetadataPluginEntry)
}

/** Parse metadata previously carried through SceneGraph plugin data. A
 * malformed carrier stays available through `findPreservedPenMetadataEntry`
 * so a writer can preserve its original string without interpreting it. */
export function readPreservedPenMetadata(entries: readonly PluginDataEntry[]): unknown {
  const entry = findPreservedPenMetadataEntry(entries)
  if (!entry) return undefined
  try {
    return JSON.parse(entry.value) as unknown
  } catch {
    return undefined
  }
}

/** Replace only OpenPencil's `.pen` metadata carrier, leaving all foreign
 * plugin data untouched. */
export function replacePreservedPenMetadata(
  entries: readonly PluginDataEntry[],
  metadata: unknown
): PluginDataEntry[] {
  const next = entries.filter((entry) => !isPenMetadataPluginEntry(entry))
  const entry = metadataPluginEntry(metadata)
  if (entry) next.push(entry)
  return next
}
