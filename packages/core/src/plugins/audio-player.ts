import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  createContractModuleDefinition,
  createContractModuleInstance,
  createSingleModulePlugin,
  parseExactModuleConfig,
  resolveContractModule,
  type ModuleContract
} from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  parseBoundedPluginNumber,
  parseBoundedPluginText,
  parseCanonicalPluginColor,
  parsePluginBoolean,
  parsePluginStringEnum,
  parseSafePluginAssetSource
} from './parse-helpers'
import type { ModulePropertyField, ModuleResolution } from './types'

export const AUDIO_PLAYER_PLUGIN_ID = 'open-pencil.audio-player'
export const AUDIO_PLAYER_MODULE_TYPE = 'audio-player'
export const AUDIO_PLAYER_MODULE_CONFIG_VERSION = 1
export const AUDIO_PLAYER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 520, height: 120 })
export const AUDIO_PLAYER_MODULE_LIMITS = Object.freeze({
  src: 2_048,
  title: 160,
  artist: 160,
  volumeMin: 0,
  volumeMax: 1,
  playbackRateMin: 0.5,
  playbackRateMax: 2,
  configBytes: 8_192
})

export type AudioPreloadV1 = 'none' | 'metadata'

export interface AudioPlayerModuleConfigV1 extends JSONObject {
  src: string
  title: string
  artist: string
  controls: boolean
  autoplay: boolean
  loop: boolean
  muted: boolean
  preload: AudioPreloadV1
  volume: number
  playbackRate: number
  backgroundColor: string
  textColor: string
  accentColor: string
}

export type AudioPlayerModuleConfig = AudioPlayerModuleConfigV1

export const AUDIO_PLAYER_MODULE_DEFAULT_CONFIG: Readonly<AudioPlayerModuleConfigV1> =
  Object.freeze({
    src: '',
    title: 'Audio track',
    artist: '',
    controls: true,
    autoplay: false,
    loop: false,
    muted: false,
    preload: 'metadata',
    volume: 1,
    playbackRate: 1,
    backgroundColor: '#111827',
    textColor: '#F9FAFB',
    accentColor: '#60A5FA'
  })

const CONFIG_KEYS = new Set([
  'src',
  'title',
  'artist',
  'controls',
  'autoplay',
  'loop',
  'muted',
  'preload',
  'volume',
  'playbackRate',
  'backgroundColor',
  'textColor',
  'accentColor'
])
const PRELOADS = new Set<AudioPreloadV1>(['none', 'metadata'])

function parseAudioPlayerConfig(value: unknown) {
  return parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'audio player config must contain exactly src, title, artist, controls, autoplay, loop, muted, preload, volume, playbackRate, backgroundColor, textColor, and accentColor',
    (source): AudioPlayerModuleConfigV1 => {
      const autoplay = parsePluginBoolean(source.autoplay, 'audio player config autoplay')
      const muted = parsePluginBoolean(source.muted, 'audio player config muted')
      if (autoplay && !muted) {
        throw new TypeError('audio player config autoplay requires muted to be true')
      }
      const config: AudioPlayerModuleConfigV1 = {
        src: parseSafePluginAssetSource(
          source.src,
          'audio player config src',
          AUDIO_PLAYER_MODULE_LIMITS.src
        ),
        title: parseBoundedPluginText(
          source.title,
          'audio player config title',
          1,
          AUDIO_PLAYER_MODULE_LIMITS.title
        ),
        artist: parseBoundedPluginText(
          source.artist,
          'audio player config artist',
          0,
          AUDIO_PLAYER_MODULE_LIMITS.artist
        ),
        controls: parsePluginBoolean(source.controls, 'audio player config controls'),
        autoplay,
        loop: parsePluginBoolean(source.loop, 'audio player config loop'),
        muted,
        preload: parsePluginStringEnum(
          source.preload,
          'audio player config preload',
          PRELOADS,
          'none or metadata'
        ),
        volume: parseBoundedPluginNumber(
          source.volume,
          'audio player config volume',
          AUDIO_PLAYER_MODULE_LIMITS.volumeMin,
          AUDIO_PLAYER_MODULE_LIMITS.volumeMax
        ),
        playbackRate: parseBoundedPluginNumber(
          source.playbackRate,
          'audio player config playbackRate',
          AUDIO_PLAYER_MODULE_LIMITS.playbackRateMin,
          AUDIO_PLAYER_MODULE_LIMITS.playbackRateMax
        ),
        backgroundColor: parseCanonicalPluginColor(
          source.backgroundColor,
          'audio player config backgroundColor'
        ),
        textColor: parseCanonicalPluginColor(source.textColor, 'audio player config textColor'),
        accentColor: parseCanonicalPluginColor(
          source.accentColor,
          'audio player config accentColor'
        )
      }
      assertBoundedPluginConfigBytes(
        config,
        'audio player config',
        AUDIO_PLAYER_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const AUDIO_PLAYER_MODULE_CONTRACT: ModuleContract<AudioPlayerModuleConfigV1> = {
  pluginId: AUDIO_PLAYER_PLUGIN_ID,
  moduleType: AUDIO_PLAYER_MODULE_TYPE,
  configVersion: AUDIO_PLAYER_MODULE_CONFIG_VERSION,
  displayName: 'audio player',
  defaultConfig: AUDIO_PLAYER_MODULE_DEFAULT_CONFIG,
  parseConfig: parseAudioPlayerConfig
}

export function createAudioPlayerModuleInstance(config?: unknown): ModuleInstanceV1 {
  return createContractModuleInstance(AUDIO_PLAYER_MODULE_CONTRACT, config)
}

export function createAudioPlayerModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Audio Player',
    defaultSize: AUDIO_PLAYER_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.07, g: 0.09, b: 0.15, a: 1 },
    strokeColor: { r: 0.23, g: 0.29, b: 0.39, a: 1 },
    module: createAudioPlayerModuleInstance(config)
  })
}

export function resolveAudioPlayerModule(
  value: unknown
): ModuleResolution<AudioPlayerModuleConfigV1> {
  return resolveContractModule(value, AUDIO_PLAYER_MODULE_CONTRACT)
}

const AUDIO_PLAYER_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['src'],
    kind: 'text',
    label: 'Audio source',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerSource'
  },
  {
    path: ['title'],
    kind: 'text',
    label: 'Title',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerTitle'
  },
  {
    path: ['artist'],
    kind: 'text',
    label: 'Artist',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerArtist'
  },
  {
    path: ['controls'],
    kind: 'boolean',
    label: 'Controls',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerControls'
  },
  {
    path: ['autoplay'],
    kind: 'boolean',
    label: 'Autoplay',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerAutoplay'
  },
  {
    path: ['loop'],
    kind: 'boolean',
    label: 'Loop',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerLoop'
  },
  {
    path: ['muted'],
    kind: 'boolean',
    label: 'Muted',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerMuted'
  },
  {
    path: ['preload'],
    kind: 'select',
    label: 'Preload',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerPreload',
    options: ['none', 'metadata']
  },
  {
    path: ['volume'],
    kind: 'number',
    label: 'Volume',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerVolume',
    min: AUDIO_PLAYER_MODULE_LIMITS.volumeMin,
    max: AUDIO_PLAYER_MODULE_LIMITS.volumeMax,
    step: 0.05
  },
  {
    path: ['playbackRate'],
    kind: 'number',
    label: 'Playback rate',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerPlaybackRate',
    min: AUDIO_PLAYER_MODULE_LIMITS.playbackRateMin,
    max: AUDIO_PLAYER_MODULE_LIMITS.playbackRateMax,
    step: 0.1
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldAudioPlayerAccentColor'
  }
])

export const AUDIO_PLAYER_MODULE_DEFINITION = createContractModuleDefinition(
  AUDIO_PLAYER_MODULE_CONTRACT,
  {
    name: 'Audio Player',
    description: 'Bounded audio source metadata with explicit playback and loading behavior.',
    i18nNameKey: 'lowcodeModuleAudioPlayerName',
    i18nDescriptionKey: 'lowcodeModuleAudioPlayerDescription',
    defaultSize: AUDIO_PLAYER_MODULE_DEFAULT_SIZE,
    fields: AUDIO_PLAYER_MODULE_FIELDS,
    createInstance: createAudioPlayerModuleInstance,
    createFrameOverrides: createAudioPlayerModuleFrameOverrides,
    resolve: resolveAudioPlayerModule
  }
)

export const AUDIO_PLAYER_PLUGIN = createSingleModulePlugin(
  AUDIO_PLAYER_PLUGIN_ID,
  'OpenPencil Audio Player',
  AUDIO_PLAYER_MODULE_DEFINITION
)
