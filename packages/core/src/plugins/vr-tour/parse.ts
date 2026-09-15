import {
  assertBoundedPluginConfigBytes,
  hasDensePluginArrayKeys,
  hasExactPluginKeys,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parseCanonicalPublicHttpsURL,
  parsePluginBoolean,
  parsePluginStringEnum
} from '@open-pencil/plugin-contracts/adapter-helpers'

import {
  parseBoundedModuleObjectArray,
  parseExactModuleConfig
} from '#core/plugins/module-contract'

import { VR_TOUR_MODULE_LIMITS as LIMITS } from './defaults'
import type { VRTourHotspotV1, VRTourLocale, VRTourModuleConfigV1, VRTourSceneV1 } from './types'

const LEGACY_CONFIG_KEYS = new Set([
  'label',
  'scenes',
  'initialSceneId',
  'initialYaw',
  'initialPitch',
  'initialFov',
  'showControls',
  'showSceneList',
  'accentColor',
  'backgroundColor',
  'textColor'
])
const CONFIG_KEYS = new Set([...LEGACY_CONFIG_KEYS, 'locale'])
const LOCALES = new Set<VRTourLocale>(['en', 'zh-CN'])
const SCENE_KEYS = new Set(['id', 'title', 'panoramaUrl', 'hotspots'])
const HOTSPOT_KEYS = new Set(['id', 'label', 'targetSceneId', 'yaw', 'pitch'])
const LOCAL_PANORAMA =
  /^\/assets\/vr-tour\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/u
const RASTER_EXTENSION = /\.(?:jpg|jpeg|png|webp)$/iu

function identifier(value: unknown, path: string): string {
  const text = parseBoundedPluginText(value, path, 1, LIMITS.id)
  if (!/^[a-z][a-z0-9-]*$/u.test(text))
    throw new TypeError(path + ' must be a lowercase scene or hotspot identifier')
  return text
}

/** This validates a data locator only; neither parsing nor canvas rendering requests the image. */
export function parseVRTourPanoramaURL(value: unknown, path = 'VR tour panorama URL'): string {
  if (value === '') return ''
  const text = parseBoundedPluginText(value, path, 1, LIMITS.url)
  if (LOCAL_PANORAMA.test(text)) return text
  const result = parseCanonicalPublicHttpsURL(text, path, LIMITS.url)
  const url = new URL(result)
  if (url.search !== '' || /[?#%]/u.test(text) || !RASTER_EXTENSION.test(url.pathname))
    throw new TypeError(
      path +
        ' must be a public JPG, PNG or WebP URL without query parameters or encoding, or an /assets/vr-tour/ path'
    )
  return result
}

function parseHotspots(value: unknown, path: string): VRTourHotspotV1[] {
  if (!Array.isArray(value) || !hasDensePluginArrayKeys(value))
    throw new TypeError(path + ' must be a dense hotspot array without custom keys')
  const parsed = parseBoundedModuleObjectArray(
    value,
    0,
    LIMITS.hotspotsPerScene,
    path + ' must contain 0 to ' + LIMITS.hotspotsPerScene + ' hotspots',
    (index) => path + '[' + index + '] must be a plain hotspot object',
    (source, index): VRTourHotspotV1 => {
      const at = path + '[' + index + ']'
      if (!hasExactPluginKeys(source, HOTSPOT_KEYS))
        throw new TypeError(at + ' must contain exactly id, label, targetSceneId, yaw and pitch')
      return Object.freeze({
        id: identifier(source.id, at + '.id'),
        label: parseBoundedPluginText(source.label, at + '.label', 1, LIMITS.label),
        targetSceneId: identifier(source.targetSceneId, at + '.targetSceneId'),
        yaw: parseBoundedPluginNumber(source.yaw, at + '.yaw', LIMITS.yawMin, LIMITS.yawMax),
        pitch: parseBoundedPluginNumber(
          source.pitch,
          at + '.pitch',
          LIMITS.pitchMin,
          LIMITS.pitchMax
        )
      })
    }
  )
  if (new Set(parsed.map((hotspot) => hotspot.id)).size !== parsed.length)
    throw new TypeError(path + ' must contain unique hotspot identifiers')
  return Object.freeze(parsed) as VRTourHotspotV1[]
}

function parseScenes(value: unknown): VRTourSceneV1[] {
  if (!Array.isArray(value) || !hasDensePluginArrayKeys(value))
    throw new TypeError('VR tour scenes must be a dense array without custom keys')
  const scenes = parseBoundedModuleObjectArray(
    value,
    1,
    LIMITS.scenes,
    'VR tour scenes must contain 1 to ' + LIMITS.scenes + ' rooms',
    (index) => 'VR tour scene[' + index + '] must be a plain scene object',
    (source, index): VRTourSceneV1 => {
      const at = 'VR tour scene[' + index + ']'
      if (!hasExactPluginKeys(source, SCENE_KEYS))
        throw new TypeError(at + ' must contain exactly id, title, panoramaUrl and hotspots')
      return Object.freeze({
        id: identifier(source.id, at + '.id'),
        title: parseBoundedPluginText(source.title, at + '.title', 1, LIMITS.label),
        panoramaUrl: parseVRTourPanoramaURL(source.panoramaUrl, at + '.panoramaUrl'),
        hotspots: parseHotspots(source.hotspots, at + '.hotspots')
      })
    }
  )
  const ids = new Set(scenes.map((scene) => scene.id))
  if (ids.size !== scenes.length) throw new TypeError('VR tour scenes must have unique identifiers')
  const hotspots = scenes.flatMap((scene) => scene.hotspots)
  if (hotspots.length > LIMITS.hotspotsTotal)
    throw new TypeError(
      'VR tour must contain at most ' + LIMITS.hotspotsTotal + ' hotspots in total'
    )
  if (hotspots.some((hotspot) => !ids.has(hotspot.targetSceneId)))
    throw new TypeError('VR tour hotspot targets must select an existing scene')
  return Object.freeze(scenes) as VRTourSceneV1[]
}

export function parseVRTourConfig(value: unknown) {
  const hasLocale = value !== null && typeof value === 'object' && Object.hasOwn(value, 'locale')
  return parseExactModuleConfig(
    value,
    hasLocale ? CONFIG_KEYS : LEGACY_CONFIG_KEYS,
    'VR tour config must contain exactly the supported scene, viewpoint, visibility and color fields',
    (source): VRTourModuleConfigV1 => {
      const scenes = parseScenes(source.scenes)
      const initialSceneId = identifier(source.initialSceneId, 'VR tour initialSceneId')
      if (!scenes.some((scene) => scene.id === initialSceneId))
        throw new TypeError('VR tour initialSceneId must select an existing scene')
      const config: VRTourModuleConfigV1 = {
        locale: hasLocale
          ? parsePluginStringEnum(source.locale, 'VR tour locale', LOCALES, 'en or zh-CN')
          : 'en',
        label: parseBoundedPluginText(source.label, 'VR tour label', 1, LIMITS.label),
        scenes,
        initialSceneId,
        initialYaw: parseBoundedPluginNumber(
          source.initialYaw,
          'VR tour initialYaw',
          LIMITS.yawMin,
          LIMITS.yawMax
        ),
        initialPitch: parseBoundedPluginNumber(
          source.initialPitch,
          'VR tour initialPitch',
          LIMITS.pitchMin,
          LIMITS.pitchMax
        ),
        initialFov: parseBoundedPluginNumber(
          source.initialFov,
          'VR tour initialFov',
          LIMITS.fovMin,
          LIMITS.fovMax
        ),
        showControls: parsePluginBoolean(source.showControls, 'VR tour showControls'),
        showSceneList: parsePluginBoolean(source.showSceneList, 'VR tour showSceneList'),
        accentColor: parseCanonicalPluginColor(source.accentColor, 'VR tour accentColor'),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'VR tour backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'VR tour textColor')
      }
      assertBoundedPluginConfigBytes(config, 'VR tour config', LIMITS.configBytes)
      return Object.freeze(config)
    }
  )
}
