import {
  hasExactPluginKeys,
  parseCanonicalPublicHttpsURL
} from '@open-pencil/plugin-contracts/adapter-helpers'
import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const VIDEO_PLUGIN_ID = 'open-pencil.video'
export const VIDEO_MODULE_TYPE = 'video'
export const VIDEO_MODULE_CONFIG_VERSION = 1
export const VIDEO_MODULE_DEFAULT_SIZE = Object.freeze({ width: 640, height: 360 })
export const VIDEO_MODULE_LIMITS = Object.freeze({ url: 2_048 })

export type VideoFitV1 = 'contain' | 'cover' | 'fill'

export interface VideoModuleConfigV1 extends JSONObject {
  src: string
  poster: string
  controls: boolean
  autoplay: boolean
  muted: boolean
  loop: boolean
  fit: VideoFitV1
}

export type VideoModuleConfig = VideoModuleConfigV1

export const VIDEO_MODULE_DEFAULT_CONFIG: Readonly<VideoModuleConfigV1> = Object.freeze({
  src: '',
  poster: '',
  controls: true,
  autoplay: false,
  muted: false,
  loop: false,
  fit: 'contain'
})

const CONFIG_KEYS = new Set(['src', 'poster', 'controls', 'autoplay', 'muted', 'loop', 'fit'])
const FITS = new Set<VideoFitV1>(['contain', 'cover', 'fill'])

type ParseResult = { ok: true; config: VideoModuleConfigV1 } | { ok: false; reason: string }

export function isCanonicalPublicHttpsURL(value: string): boolean {
  if (value === '') return false
  try {
    parseCanonicalPublicHttpsURL(value, 'video URL', VIDEO_MODULE_LIMITS.url)
    return true
  } catch {
    return false
  }
}

function optionalURL(value: unknown, path: string): string {
  if (value === '') return ''
  return parseCanonicalPublicHttpsURL(value, path, VIDEO_MODULE_LIMITS.url)
}

function parseVideoConfig(value: unknown): ParseResult {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'video config must contain exactly src, poster, controls, autoplay, muted, loop, and fit'
    }
  }
  let src: string
  let poster: string
  try {
    src = optionalURL(value.src, 'video config src')
    poster = optionalURL(value.poster, 'video config poster')
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
  const { controls, autoplay, muted, loop } = value
  if (typeof controls !== 'boolean') {
    return { ok: false, reason: 'video config controls must be a boolean' }
  }
  if (typeof autoplay !== 'boolean') {
    return { ok: false, reason: 'video config autoplay must be a boolean' }
  }
  if (typeof muted !== 'boolean') {
    return { ok: false, reason: 'video config muted must be a boolean' }
  }
  if (typeof loop !== 'boolean') {
    return { ok: false, reason: 'video config loop must be a boolean' }
  }
  if (typeof value.fit !== 'string' || !FITS.has(value.fit as VideoFitV1)) {
    return { ok: false, reason: 'video config fit must be contain, cover, or fill' }
  }
  if (autoplay && !muted) {
    return { ok: false, reason: 'video config autoplay requires muted to be true' }
  }
  return {
    ok: true,
    config: {
      src,
      poster,
      controls,
      autoplay,
      muted,
      loop,
      fit: value.fit as VideoFitV1
    }
  }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(VIDEO_MODULE_DEFAULT_CONFIG)
  if (!isPlainJSONObject(config)) return config
  return { ...structuredClone(VIDEO_MODULE_DEFAULT_CONFIG), ...config }
}

export function createVideoModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseVideoConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: VIDEO_PLUGIN_ID,
    moduleType: VIDEO_MODULE_TYPE,
    configVersion: VIDEO_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createVideoModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Video',
    defaultSize: VIDEO_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.06, g: 0.07, b: 0.09, a: 1 },
    strokeColor: { r: 0.25, g: 0.27, b: 0.32, a: 1 },
    module: createVideoModuleInstance(config)
  })
}

export function resolveVideoModule(value: unknown): ModuleResolution<VideoModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== VIDEO_PLUGIN_ID ||
    instance.value.moduleType !== VIDEO_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== VIDEO_MODULE_CONFIG_VERSION) {
    return { ok: false, reason: `unsupported video config version ${instance.value.configVersion}` }
  }
  const config = parseVideoConfig(instance.value.config)
  if (!config.ok) return config
  return { ok: true, instance: { ...instance.value, config: config.config }, config: config.config }
}

const VIDEO_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['src'], kind: 'text', label: 'Source', i18nLabelKey: 'lowcodeModuleFieldVideoSrc' },
  {
    path: ['poster'],
    kind: 'text',
    label: 'Poster',
    i18nLabelKey: 'lowcodeModuleFieldVideoPoster'
  },
  {
    path: ['controls'],
    kind: 'boolean',
    label: 'Controls',
    i18nLabelKey: 'lowcodeModuleFieldControls'
  },
  {
    path: ['muted'],
    kind: 'boolean',
    label: 'Muted',
    i18nLabelKey: 'lowcodeModuleFieldMuted'
  },
  {
    path: ['autoplay'],
    kind: 'boolean',
    label: 'Autoplay',
    i18nLabelKey: 'lowcodeModuleFieldAutoplay'
  },
  { path: ['loop'], kind: 'boolean', label: 'Loop', i18nLabelKey: 'lowcodeModuleFieldLoop' },
  {
    path: ['fit'],
    kind: 'select',
    label: 'Fit',
    i18nLabelKey: 'lowcodeModuleFieldFit',
    options: ['contain', 'cover', 'fill']
  }
])

export const VIDEO_MODULE_DEFINITION: ModuleDefinition<VideoModuleConfigV1> = Object.freeze({
  pluginId: VIDEO_PLUGIN_ID,
  moduleType: VIDEO_MODULE_TYPE,
  name: 'Video',
  description: 'HTTPS video playback with bounded, explicit media behavior.',
  i18nNameKey: 'lowcodeModuleVideoName',
  i18nDescriptionKey: 'lowcodeModuleVideoDescription',
  configVersion: VIDEO_MODULE_CONFIG_VERSION,
  defaultSize: VIDEO_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(VIDEO_MODULE_DEFAULT_CONFIG),
  fields: VIDEO_MODULE_FIELDS,
  createInstance: createVideoModuleInstance,
  createFrameOverrides: createVideoModuleFrameOverrides,
  resolve: resolveVideoModule
})

export const VIDEO_PLUGIN = Object.freeze({
  id: VIDEO_PLUGIN_ID,
  name: 'OpenPencil Video',
  version: '1.0.0',
  modules: Object.freeze([VIDEO_MODULE_DEFINITION])
})
