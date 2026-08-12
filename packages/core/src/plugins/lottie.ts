import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import {
  hasDensePluginArrayKeys,
  hasExactPluginKeys,
  parseCanonicalPublicHttpsURL
} from './parse-helpers'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const LOTTIE_PLUGIN_ID = 'open-pencil.lottie'
export const LOTTIE_MODULE_TYPE = 'lottie'
export const LOTTIE_MODULE_CONFIG_VERSION = 1
export const LOTTIE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 360 })

/**
 * Lottie data lives inside the globally bounded module envelope (64 KiB, depth 12,
 * 1,000 array items). These tighter limits leave room for the envelope and config.
 */
export const LOTTIE_MODULE_LIMITS = Object.freeze({
  url: 2_048,
  dataBytes: 48 * 1_024,
  dataDepth: 9,
  dataEntries: 1_800,
  dataArrayItems: 900,
  dataString: 8_192,
  layers: 256,
  assets: 128,
  dimension: 8_192,
  frameRate: 240,
  durationSeconds: 600,
  speedMin: 0.1,
  speedMax: 4
})

export type LottieSourceV1 = 'url' | 'json'
export type LottieDirectionV1 = 'forward' | 'reverse'
export type LottieFitV1 = 'contain' | 'cover' | 'fill'

export interface LottieAnimationDataV1 extends JSONObject {
  v: string
  fr: number
  ip: number
  op: number
  w: number
  h: number
  layers: unknown[]
}

export interface LottieModuleConfigV1 extends JSONObject {
  source: LottieSourceV1
  url: string
  data: LottieAnimationDataV1
  autoplay: boolean
  loop: boolean
  speed: number
  direction: LottieDirectionV1
  fit: LottieFitV1
}

export type LottieModuleConfig = LottieModuleConfigV1

const DEFAULT_LAYERS: unknown[] = []
Object.freeze(DEFAULT_LAYERS)

export const LOTTIE_MODULE_DEFAULT_DATA: Readonly<LottieAnimationDataV1> = Object.freeze({
  v: '5.13.0',
  fr: 60,
  ip: 0,
  op: 1,
  w: 360,
  h: 360,
  layers: DEFAULT_LAYERS
})

export const LOTTIE_MODULE_DEFAULT_CONFIG: Readonly<LottieModuleConfigV1> = Object.freeze({
  source: 'url',
  url: '',
  data: LOTTIE_MODULE_DEFAULT_DATA as LottieAnimationDataV1,
  autoplay: true,
  loop: true,
  speed: 1,
  direction: 'forward',
  fit: 'contain'
})

const CONFIG_KEYS = new Set([
  'source',
  'url',
  'data',
  'autoplay',
  'loop',
  'speed',
  'direction',
  'fit'
])
const DATA_KEYS = new Set([
  'v',
  'fr',
  'ip',
  'op',
  'w',
  'h',
  'nm',
  'ddd',
  'assets',
  'layers',
  'fonts',
  'chars',
  'markers',
  'meta'
])
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const SOURCES = new Set<LottieSourceV1>(['url', 'json'])
const DIRECTIONS = new Set<LottieDirectionV1>(['forward', 'reverse'])
const FITS = new Set<LottieFitV1>(['contain', 'cover', 'fill'])
const VERSION = /^\d+(?:\.\d+){1,3}$/

interface JSONBudget {
  entries: number
  arrayItems: number
  seen: WeakSet<object>
}

type ParseResult = { ok: true; config: LottieModuleConfigV1 } | { ok: false; reason: string }

function validateJSONValue(
  value: unknown,
  path: string,
  depth: number,
  budget: JSONBudget
): string | null {
  if (depth > LOTTIE_MODULE_LIMITS.dataDepth) {
    return `${path} exceeds the maximum Lottie JSON depth of ${LOTTIE_MODULE_LIMITS.dataDepth}`
  }
  if (value === null || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} must be finite`
  if (typeof value === 'string') {
    return value.length <= LOTTIE_MODULE_LIMITS.dataString
      ? null
      : `${path} exceeds the maximum Lottie string length of ${LOTTIE_MODULE_LIMITS.dataString}`
  }
  if (typeof value !== 'object') return `${path} contains a non-JSON value`
  if (budget.seen.has(value)) return `${path} contains a circular reference`
  budget.seen.add(value)
  return Array.isArray(value)
    ? validateJSONArray(value, path, depth, budget)
    : validateJSONObject(value, path, depth, budget)
}

function validateJSONArray(
  value: unknown[],
  path: string,
  depth: number,
  budget: JSONBudget
): string | null {
  if (!hasDensePluginArrayKeys(value)) {
    return `${path} must be a dense JSON array without custom properties`
  }
  budget.arrayItems += value.length
  if (budget.arrayItems > LOTTIE_MODULE_LIMITS.dataArrayItems) {
    return `${path} exceeds the maximum total Lottie array items of ${LOTTIE_MODULE_LIMITS.dataArrayItems}`
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return `${path}[${index}] must be an enumerable data property`
    }
    const reason = validateJSONValue(descriptor.value, `${path}[${index}]`, depth + 1, budget)
    if (reason) return reason
  }
  return null
}

function validateJSONObject(
  value: object,
  path: string,
  depth: number,
  budget: JSONBudget
): string | null {
  if (!isPlainJSONObject(value)) return `${path} must be a plain JSON object`
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => typeof key !== 'string')) return `${path} must not contain symbol keys`
  budget.entries += keys.length
  if (budget.entries > LOTTIE_MODULE_LIMITS.dataEntries) {
    return `${path} exceeds the maximum total Lottie object entries of ${LOTTIE_MODULE_LIMITS.dataEntries}`
  }
  for (const key of keys as string[]) {
    if (UNSAFE_KEYS.has(key)) return `${path} contains unsafe key "${key}"`
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return `${path}.${key} must be an enumerable data property`
    }
    const reason = validateJSONValue(descriptor.value, `${path}.${key}`, depth + 1, budget)
    if (reason) return reason
  }
  return null
}

function validateNoExpressions(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const reason = validateNoExpressions(value[index], `${path}[${index}]`)
      if (reason) return reason
    }
    return null
  }
  if (!isPlainJSONObject(value)) return null
  for (const [key, child] of Object.entries(value)) {
    if (key === 'x' && typeof child === 'string' && child.trim() !== '') {
      return `${path}.${key} contains an unsupported Lottie expression`
    }
    const reason = validateNoExpressions(child, `${path}.${key}`)
    if (reason) return reason
  }
  return null
}

function validateLayers(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length > LOTTIE_MODULE_LIMITS.layers) {
    return `${path} must be an array with at most ${LOTTIE_MODULE_LIMITS.layers} layers`
  }
  for (let index = 0; index < value.length; index += 1) {
    const layer = value[index]
    if (!isPlainJSONObject(layer)) return `${path}[${index}] must be a plain JSON object`
    if (layer.ty === 2) return `${path}[${index}] uses an unsupported image layer`
    if (layer.ty === 6) return `${path}[${index}] uses an unsupported audio layer`
  }
  return null
}

function validateAssets(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length > LOTTIE_MODULE_LIMITS.assets) {
    return `${path} must be an array with at most ${LOTTIE_MODULE_LIMITS.assets} assets`
  }
  for (let index = 0; index < value.length; index += 1) {
    const asset = value[index]
    const assetPath = `${path}[${index}]`
    if (!isPlainJSONObject(asset)) return `${assetPath} must be a plain JSON object`
    if (Object.hasOwn(asset, 'p') || Object.hasOwn(asset, 'u')) {
      return `${assetPath} contains an unsupported external or embedded image asset`
    }
    if (!Object.hasOwn(asset, 'layers')) {
      return `${assetPath} must be a vector precomposition with layers`
    }
    const reason = validateLayers(asset.layers, `${assetPath}.layers`)
    if (reason) return reason
  }
  return null
}

function validateFonts(value: unknown, path: string): string | null {
  if (!isPlainJSONObject(value) || !Array.isArray(value.list)) {
    return `${path} must contain a font list array`
  }
  for (let index = 0; index < value.list.length; index += 1) {
    const font = value.list[index]
    if (!isPlainJSONObject(font)) return `${path}.list[${index}] must be a plain JSON object`
    if (font.fPath !== undefined && font.fPath !== '') {
      return `${path}.list[${index}].fPath must not load an external font`
    }
  }
  return null
}

function isBoundedLottieDimension(value: unknown): boolean {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 1 &&
    Number(value) <= LOTTIE_MODULE_LIMITS.dimension
  )
}

function validateAnimationMetadata(value: Record<string, unknown>): string | null {
  const unknownKey = Object.keys(value).find((key) => !DATA_KEYS.has(key))
  if (unknownKey) return `lottie data contains unsupported top-level key "${unknownKey}"`
  if (typeof value.v !== 'string' || !VERSION.test(value.v)) {
    return 'lottie data v must be a dotted numeric version'
  }
  if (
    typeof value.fr !== 'number' ||
    !Number.isFinite(value.fr) ||
    value.fr <= 0 ||
    value.fr > LOTTIE_MODULE_LIMITS.frameRate
  ) {
    return `lottie data fr must be greater than 0 and at most ${LOTTIE_MODULE_LIMITS.frameRate}`
  }
  if (typeof value.ip !== 'number' || !Number.isFinite(value.ip)) {
    return 'lottie data ip must be finite'
  }
  if (typeof value.op !== 'number' || !Number.isFinite(value.op) || value.op <= value.ip) {
    return 'lottie data op must be finite and greater than ip'
  }
  if ((value.op - value.ip) / value.fr > LOTTIE_MODULE_LIMITS.durationSeconds) {
    return `lottie data duration must not exceed ${LOTTIE_MODULE_LIMITS.durationSeconds} seconds`
  }
  for (const key of ['w', 'h'] as const) {
    if (!isBoundedLottieDimension(value[key])) {
      return `lottie data ${key} must be an integer between 1 and ${LOTTIE_MODULE_LIMITS.dimension}`
    }
  }
  if (value.ddd !== undefined && value.ddd !== 0 && value.ddd !== 1) {
    return 'lottie data ddd must be 0 or 1'
  }
  return null
}

function validateAnimationResources(value: Record<string, unknown>): string | null {
  const layersReason = validateLayers(value.layers, 'lottie data.layers')
  if (layersReason) return layersReason
  if (value.assets !== undefined) {
    const assetsReason = validateAssets(value.assets, 'lottie data.assets')
    if (assetsReason) return assetsReason
  }
  if (value.fonts !== undefined) {
    const fontsReason = validateFonts(value.fonts, 'lottie data.fonts')
    if (fontsReason) return fontsReason
  }
  return validateNoExpressions(value, 'lottie data')
}

/** Validate the supported, vector-only Lottie JSON subset without executing it. */
export function validateLottieAnimationData(value: unknown): string | null {
  const jsonReason = validateJSONValue(value, 'lottie data', 0, {
    entries: 0,
    arrayItems: 0,
    seen: new WeakSet()
  })
  if (jsonReason) return jsonReason
  if (!isPlainJSONObject(value)) return 'lottie data must be a plain JSON object'
  const metadataReason = validateAnimationMetadata(value)
  if (metadataReason) return metadataReason
  const resourcesReason = validateAnimationResources(value)
  if (resourcesReason) return resourcesReason
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > LOTTIE_MODULE_LIMITS.dataBytes) {
    return `lottie data exceeds the maximum serialized size of ${LOTTIE_MODULE_LIMITS.dataBytes} bytes`
  }
  return null
}

export function isCanonicalPublicLottieURL(value: string): boolean {
  if (value === '') return false
  try {
    parseCanonicalPublicHttpsURL(value, 'Lottie URL', LOTTIE_MODULE_LIMITS.url)
    return true
  } catch {
    return false
  }
}

function optionalURL(value: unknown): string {
  if (value === '') return ''
  return parseCanonicalPublicHttpsURL(value, 'lottie config url', LOTTIE_MODULE_LIMITS.url)
}

function parseLottieConfig(value: unknown): ParseResult {
  const envelope = validateModuleInstance({
    version: 1,
    pluginId: LOTTIE_PLUGIN_ID,
    moduleType: LOTTIE_MODULE_TYPE,
    configVersion: LOTTIE_MODULE_CONFIG_VERSION,
    config: value
  })
  if (!envelope.ok) return { ok: false, reason: envelope.reason }
  const config = envelope.value.config
  if (!hasExactPluginKeys(config, CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'lottie config must contain exactly source, url, data, autoplay, loop, speed, direction, and fit'
    }
  }
  if (typeof config.source !== 'string' || !SOURCES.has(config.source as LottieSourceV1)) {
    return { ok: false, reason: 'lottie config source must be url or json' }
  }
  let url: string
  try {
    url = optionalURL(config.url)
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
  const dataReason = validateLottieAnimationData(config.data)
  if (dataReason) return { ok: false, reason: dataReason }
  if (config.source === 'json' && !isPlainJSONObject(config.data)) {
    return { ok: false, reason: 'lottie config data must be a plain JSON object' }
  }
  if (typeof config.autoplay !== 'boolean') {
    return { ok: false, reason: 'lottie config autoplay must be a boolean' }
  }
  if (typeof config.loop !== 'boolean') {
    return { ok: false, reason: 'lottie config loop must be a boolean' }
  }
  if (
    typeof config.speed !== 'number' ||
    !Number.isFinite(config.speed) ||
    config.speed < LOTTIE_MODULE_LIMITS.speedMin ||
    config.speed > LOTTIE_MODULE_LIMITS.speedMax
  ) {
    return {
      ok: false,
      reason: `lottie config speed must be between ${LOTTIE_MODULE_LIMITS.speedMin} and ${LOTTIE_MODULE_LIMITS.speedMax}`
    }
  }
  if (
    typeof config.direction !== 'string' ||
    !DIRECTIONS.has(config.direction as LottieDirectionV1)
  ) {
    return { ok: false, reason: 'lottie config direction must be forward or reverse' }
  }
  if (typeof config.fit !== 'string' || !FITS.has(config.fit as LottieFitV1)) {
    return { ok: false, reason: 'lottie config fit must be contain, cover, or fill' }
  }
  return {
    ok: true,
    config: {
      source: config.source as LottieSourceV1,
      url,
      data: structuredClone(config.data) as LottieAnimationDataV1,
      autoplay: config.autoplay,
      loop: config.loop,
      speed: config.speed,
      direction: config.direction as LottieDirectionV1,
      fit: config.fit as LottieFitV1
    }
  }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(LOTTIE_MODULE_DEFAULT_CONFIG)
  if (!isPlainJSONObject(config)) return config
  const next = structuredClone(LOTTIE_MODULE_DEFAULT_CONFIG) as JSONObject
  for (const key of Reflect.ownKeys(config)) {
    if (typeof key !== 'string') return config
    const descriptor = Object.getOwnPropertyDescriptor(config, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) return config
    Reflect.set(next, key, descriptor.value)
  }
  return next
}

export function createLottieModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseLottieConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  const instance = validateModuleInstance({
    version: 1,
    pluginId: LOTTIE_PLUGIN_ID,
    moduleType: LOTTIE_MODULE_TYPE,
    configVersion: LOTTIE_MODULE_CONFIG_VERSION,
    config: parsed.config
  })
  if (!instance.ok) throw new TypeError(instance.reason)
  return instance.value
}

export function createLottieModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Lottie',
    defaultSize: LOTTIE_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.04, g: 0.05, b: 0.08, a: 1 },
    strokeColor: { r: 0.18, g: 0.22, b: 0.3, a: 1 },
    module: createLottieModuleInstance(config)
  })
}

export function resolveLottieModule(value: unknown): ModuleResolution<LottieModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== LOTTIE_PLUGIN_ID ||
    instance.value.moduleType !== LOTTIE_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== LOTTIE_MODULE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `unsupported Lottie config version ${instance.value.configVersion}`
    }
  }
  const config = parseLottieConfig(instance.value.config)
  if (!config.ok) return config
  return {
    ok: true,
    instance: { ...instance.value, config: config.config },
    config: config.config
  }
}

const LOTTIE_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['source'],
    kind: 'select',
    label: 'Source type',
    i18nLabelKey: 'lowcodeModuleFieldLottieSource',
    options: ['url', 'json']
  },
  { path: ['url'], kind: 'text', label: 'URL', i18nLabelKey: 'lowcodeModuleFieldLottieUrl' },
  {
    path: ['data'],
    kind: 'json',
    label: 'Animation JSON',
    i18nLabelKey: 'lowcodeModuleFieldLottieData'
  },
  {
    path: ['autoplay'],
    kind: 'boolean',
    label: 'Autoplay',
    i18nLabelKey: 'lowcodeModuleFieldAutoplay'
  },
  { path: ['loop'], kind: 'boolean', label: 'Loop', i18nLabelKey: 'lowcodeModuleFieldLoop' },
  {
    path: ['speed'],
    kind: 'number',
    label: 'Speed',
    i18nLabelKey: 'lowcodeModuleFieldLottieSpeed',
    min: LOTTIE_MODULE_LIMITS.speedMin,
    max: LOTTIE_MODULE_LIMITS.speedMax,
    step: 0.1
  },
  {
    path: ['direction'],
    kind: 'select',
    label: 'Direction',
    i18nLabelKey: 'lowcodeModuleFieldLottieDirection',
    options: ['forward', 'reverse']
  },
  {
    path: ['fit'],
    kind: 'select',
    label: 'Fit',
    i18nLabelKey: 'lowcodeModuleFieldFit',
    options: ['contain', 'cover', 'fill']
  }
])

export const LOTTIE_MODULE_DEFINITION: ModuleDefinition<LottieModuleConfigV1> = Object.freeze({
  pluginId: LOTTIE_PLUGIN_ID,
  moduleType: LOTTIE_MODULE_TYPE,
  name: 'Lottie',
  description: 'Bounded vector Lottie animation from embedded JSON or a gated HTTPS source.',
  i18nNameKey: 'lowcodeModuleLottieName',
  i18nDescriptionKey: 'lowcodeModuleLottieDescription',
  configVersion: LOTTIE_MODULE_CONFIG_VERSION,
  defaultSize: LOTTIE_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(LOTTIE_MODULE_DEFAULT_CONFIG),
  fields: LOTTIE_MODULE_FIELDS,
  createInstance: createLottieModuleInstance,
  createFrameOverrides: createLottieModuleFrameOverrides,
  resolve: resolveLottieModule
})

export const LOTTIE_PLUGIN = Object.freeze({
  id: LOTTIE_PLUGIN_ID,
  name: 'OpenPencil Lottie',
  version: '1.0.0',
  modules: Object.freeze([LOTTIE_MODULE_DEFINITION])
})
