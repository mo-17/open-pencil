import { hasExactPluginKeys } from '@open-pencil/plugin-contracts/adapter-helpers'
import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const MAP_PLUGIN_ID = 'open-pencil.map'
export const MAP_MODULE_TYPE = 'map'
export const MAP_MODULE_CONFIG_VERSION = 1
export const MAP_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 240 })
export const MAP_MODULE_ATTRIBUTION = '© OpenStreetMap contributors'
export const MAP_MODULE_LIMITS = Object.freeze({
  markers: 100,
  markerId: 128,
  label: 120,
  zoom: 19
})

export interface MapMarkerV1 extends JSONObject {
  id: string
  lng: number
  lat: number
  label?: string
}

export interface MapModuleConfigV1 extends JSONObject {
  provider: 'openstreetmap'
  style: 'standard' | 'light' | 'dark'
  center: [number, number]
  zoom: number
  interactive: boolean
  markers: MapMarkerV1[]
  layers: []
  attribution: string
}

export type MapModuleConfig = MapModuleConfigV1

const DEFAULT_MAP_CENTER: [number, number] = [0, 0]
const DEFAULT_MAP_MARKERS: MapMarkerV1[] = []
const DEFAULT_MAP_LAYERS: [] = []
Object.freeze(DEFAULT_MAP_CENTER)
Object.freeze(DEFAULT_MAP_MARKERS)
Object.freeze(DEFAULT_MAP_LAYERS)

export const MAP_MODULE_DEFAULT_CONFIG: Readonly<MapModuleConfigV1> = Object.freeze({
  provider: 'openstreetmap',
  style: 'standard',
  center: DEFAULT_MAP_CENTER,
  zoom: 2,
  interactive: true,
  markers: DEFAULT_MAP_MARKERS,
  layers: DEFAULT_MAP_LAYERS,
  attribution: MAP_MODULE_ATTRIBUTION
})

const MAP_CONFIG_KEYS = new Set([
  'provider',
  'style',
  'center',
  'zoom',
  'interactive',
  'markers',
  'layers',
  'attribution'
])
const MARKER_KEYS = new Set(['id', 'lng', 'lat', 'label'])
const MAP_STYLES = new Set<MapModuleConfigV1['style']>(['standard', 'light', 'dark'])
const MARKER_ID = /^[A-Za-z0-9._:-]+$/

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function parseCenter(value: unknown): ParseResult<[number, number]> {
  if (!Array.isArray(value) || value.length !== 2) {
    return { ok: false, reason: 'map config center must contain longitude and latitude' }
  }
  if (!finiteInRange(value[0], -180, 180) || !finiteInRange(value[1], -90, 90)) {
    return {
      ok: false,
      reason: 'map config center must be [longitude -180..180, latitude -90..90]'
    }
  }
  return { ok: true, value: [value[0], value[1]] }
}

function markerHasExpectedKeys(marker: Record<string, unknown>): boolean {
  const keys = Object.keys(marker)
  return (
    keys.every((key) => MARKER_KEYS.has(key)) &&
    keys.includes('id') &&
    keys.includes('lng') &&
    keys.includes('lat')
  )
}

function validMarkerId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAP_MODULE_LIMITS.markerId &&
    MARKER_ID.test(value)
  )
}

function parseMarker(value: unknown, index: number): ParseResult<MapMarkerV1> {
  if (!isPlainJSONObject(value)) {
    return { ok: false, reason: `map marker ${index} must be an object` }
  }
  if (!markerHasExpectedKeys(value)) {
    return {
      ok: false,
      reason: `map marker ${index} must contain id, lng, lat, and optional label only`
    }
  }
  if (!validMarkerId(value.id)) return { ok: false, reason: `map marker ${index} id is invalid` }
  if (!finiteInRange(value.lng, -180, 180) || !finiteInRange(value.lat, -90, 90)) {
    return { ok: false, reason: `map marker ${index} coordinates are out of range` }
  }
  if (
    value.label !== undefined &&
    (typeof value.label !== 'string' || value.label.length > MAP_MODULE_LIMITS.label)
  ) {
    return {
      ok: false,
      reason: `map marker ${index} label exceeds ${MAP_MODULE_LIMITS.label} characters`
    }
  }
  return {
    ok: true,
    value: {
      id: value.id,
      lng: value.lng,
      lat: value.lat,
      ...(value.label === undefined ? {} : { label: value.label })
    }
  }
}

function parseMarkers(value: unknown): ParseResult<MapMarkerV1[]> {
  if (!Array.isArray(value) || value.length > MAP_MODULE_LIMITS.markers) {
    return {
      ok: false,
      reason: `map config markers must be an array of at most ${MAP_MODULE_LIMITS.markers}`
    }
  }
  const markerIds = new Set<string>()
  const markers: MapMarkerV1[] = []
  for (let index = 0; index < value.length; index += 1) {
    const marker = parseMarker(value[index], index)
    if (!marker.ok) return marker
    if (markerIds.has(marker.value.id)) {
      return { ok: false, reason: `map marker id must be unique: ${marker.value.id}` }
    }
    markerIds.add(marker.value.id)
    markers.push(marker.value)
  }
  return { ok: true, value: markers }
}

function parseMapConfig(
  value: unknown
): { ok: true; config: MapModuleConfigV1 } | { ok: false; reason: string } {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, MAP_CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'map config must contain exactly provider, style, center, zoom, interactive, markers, layers, and attribution'
    }
  }
  if (value.provider !== 'openstreetmap') {
    return { ok: false, reason: 'map config provider must be openstreetmap' }
  }
  if (
    typeof value.style !== 'string' ||
    !MAP_STYLES.has(value.style as MapModuleConfigV1['style'])
  ) {
    return { ok: false, reason: 'map config style must be standard, light, or dark' }
  }
  const center = parseCenter(value.center)
  if (!center.ok) return center
  if (!finiteInRange(value.zoom, 0, MAP_MODULE_LIMITS.zoom)) {
    return {
      ok: false,
      reason: `map config zoom must be a finite number from 0 to ${MAP_MODULE_LIMITS.zoom}`
    }
  }
  if (typeof value.interactive !== 'boolean') {
    return { ok: false, reason: 'map config interactive must be a boolean' }
  }
  const markers = parseMarkers(value.markers)
  if (!markers.ok) return markers
  if (!Array.isArray(value.layers) || value.layers.length !== 0) {
    return { ok: false, reason: 'map config layers must be an empty array in config version 1' }
  }
  if (value.attribution !== MAP_MODULE_ATTRIBUTION) {
    return {
      ok: false,
      reason: `map config attribution must be exactly "${MAP_MODULE_ATTRIBUTION}"`
    }
  }
  return {
    ok: true,
    config: {
      provider: 'openstreetmap',
      style: value.style as MapModuleConfigV1['style'],
      center: center.value,
      zoom: value.zoom,
      interactive: value.interactive,
      markers: markers.value,
      layers: [],
      attribution: MAP_MODULE_ATTRIBUTION
    }
  }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(MAP_MODULE_DEFAULT_CONFIG)
  if (!isPlainJSONObject(config)) return config
  return { ...structuredClone(MAP_MODULE_DEFAULT_CONFIG), ...config }
}

export function createMapModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseMapConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: MAP_PLUGIN_ID,
    moduleType: MAP_MODULE_TYPE,
    configVersion: MAP_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createMapModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Map',
    defaultSize: MAP_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.91, g: 0.94, b: 0.96, a: 1 },
    strokeColor: { r: 0.69, g: 0.74, b: 0.78, a: 1 },
    module: createMapModuleInstance(config)
  })
}

export function resolveMapModule(value: unknown): ModuleResolution<MapModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (instance.value.pluginId !== MAP_PLUGIN_ID || instance.value.moduleType !== MAP_MODULE_TYPE) {
    return null
  }
  if (instance.value.configVersion !== MAP_MODULE_CONFIG_VERSION) {
    return { ok: false, reason: `unsupported map config version ${instance.value.configVersion}` }
  }
  const config = parseMapConfig(instance.value.config)
  if (!config.ok) return config
  return { ok: true, instance: { ...instance.value, config: config.config }, config: config.config }
}

const MAP_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['provider'],
    kind: 'select',
    label: 'Provider',
    i18nLabelKey: 'lowcodeModuleFieldProvider',
    options: ['openstreetmap']
  },
  {
    path: ['style'],
    kind: 'select',
    label: 'Style',
    i18nLabelKey: 'lowcodeModuleFieldStyle',
    options: ['standard', 'light', 'dark']
  },
  {
    path: ['center', 0],
    kind: 'number',
    label: 'Longitude',
    i18nLabelKey: 'lowcodeModuleFieldLongitude',
    min: -180,
    max: 180,
    step: 0.0001
  },
  {
    path: ['center', 1],
    kind: 'number',
    label: 'Latitude',
    i18nLabelKey: 'lowcodeModuleFieldLatitude',
    min: -90,
    max: 90,
    step: 0.0001
  },
  {
    path: ['zoom'],
    kind: 'number',
    label: 'Zoom',
    i18nLabelKey: 'lowcodeModuleFieldZoom',
    min: 0,
    max: MAP_MODULE_LIMITS.zoom,
    step: 0.25
  },
  {
    path: ['interactive'],
    kind: 'boolean',
    label: 'Interactive',
    i18nLabelKey: 'lowcodeModuleFieldInteractive'
  },
  {
    path: ['markers'],
    kind: 'json',
    label: 'Markers',
    i18nLabelKey: 'lowcodeModuleFieldMarkers'
  },
  {
    path: ['layers'],
    kind: 'json',
    label: 'Layers',
    i18nLabelKey: 'lowcodeModuleFieldLayers'
  }
])

export const MAP_MODULE_DEFINITION: ModuleDefinition<MapModuleConfigV1> = Object.freeze({
  pluginId: MAP_PLUGIN_ID,
  moduleType: MAP_MODULE_TYPE,
  name: 'Map',
  description:
    'Interactive OpenStreetMap module with bounded markers and declarative configuration.',
  i18nNameKey: 'lowcodeModuleMapName',
  i18nDescriptionKey: 'lowcodeModuleMapDescription',
  configVersion: MAP_MODULE_CONFIG_VERSION,
  defaultSize: MAP_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(MAP_MODULE_DEFAULT_CONFIG),
  fields: MAP_MODULE_FIELDS,
  createInstance: createMapModuleInstance,
  createFrameOverrides: createMapModuleFrameOverrides,
  resolve: resolveMapModule
})

export const MAP_PLUGIN = Object.freeze({
  id: MAP_PLUGIN_ID,
  name: 'OpenPencil Map',
  version: '1.0.0',
  modules: Object.freeze([MAP_MODULE_DEFINITION])
})
