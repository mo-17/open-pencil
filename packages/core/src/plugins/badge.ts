import * as badgeConfig from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const BADGE_PLUGIN_ID = 'open-pencil.badge'
export const BADGE_MODULE_TYPE = 'badge'
export const BADGE_MODULE_CONFIG_VERSION = 1
export const BADGE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 160, height: 80 })

export interface BadgeModuleConfigV1 extends JSONObject {
  mode: 'count' | 'dot'
  count: number
  max: number
  showZero: boolean
  placement: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  size: 'small' | 'medium' | 'large'
  badgeColor: string
  textColor: string
  hostLabel: string
  hostBackground: string
  hostTextColor: string
  label: string
}

export const BADGE_MODULE_DEFAULT_CONFIG: Readonly<BadgeModuleConfigV1> = Object.freeze({
  mode: 'count',
  count: 5,
  max: 99,
  showZero: false,
  placement: 'top-right',
  size: 'medium',
  badgeColor: '#DC2626',
  textColor: '#FFFFFF',
  hostLabel: 'Messages',
  hostBackground: '#F3F4F6',
  hostTextColor: '#1F2937',
  label: 'Count'
})

/** Fixed numeric cells keep badge dimensions identical across canvas and web fonts. */
export const BADGE_SIZE_METRICS = Object.freeze({
  small: { height: 18, fontSize: 10, dotSize: 8 },
  medium: { height: 22, fontSize: 12, dotSize: 10 },
  large: { height: 26, fontSize: 14, dotSize: 12 }
})

export function badgeDisplayValue(
  config: Pick<BadgeModuleConfigV1, 'mode' | 'count' | 'max'>
): string {
  if (config.mode === 'dot') return ''
  return config.count > config.max ? `${config.max}+` : String(config.count)
}

export function badgeIsVisible(
  config: Pick<BadgeModuleConfigV1, 'mode' | 'count' | 'showZero'>
): boolean {
  return config.mode === 'dot' || config.showZero || config.count > 0
}

export function badgeMetrics(config: Pick<BadgeModuleConfigV1, 'mode' | 'size' | 'count' | 'max'>) {
  const metrics = BADGE_SIZE_METRICS[config.size]
  const height = config.mode === 'dot' ? metrics.dotSize : metrics.height
  const width =
    config.mode === 'dot'
      ? height
      : Math.max(height, Math.ceil(badgeDisplayValue(config).length * metrics.fontSize * 0.7 + 12))
  return { width, height, fontSize: metrics.fontSize, contentInset: Math.max(24, height + 4) }
}

const CONFIG_KEYS = new Set(Object.keys(BADGE_MODULE_DEFAULT_CONFIG))
const MODES = new Set<BadgeModuleConfigV1['mode']>(['count', 'dot'])
const SIZES = new Set<BadgeModuleConfigV1['size']>(['small', 'medium', 'large'])
const PLACEMENTS = new Set<BadgeModuleConfigV1['placement']>([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right'
])

export function parseBadgeConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'badge config must contain exactly the declared badge fields',
    (source): BadgeModuleConfigV1 => {
      const count = badgeConfig.parseBoundedPluginInteger(
        source.count,
        'badge count',
        0,
        999_999_999
      )
      const max = badgeConfig.parseBoundedPluginInteger(source.max, 'badge max', 1, 999_999)
      const config: BadgeModuleConfigV1 = {
        mode: badgeConfig.parsePluginStringEnum(source.mode, 'badge mode', MODES, 'count or dot'),
        count,
        max,
        showZero: badgeConfig.parsePluginBoolean(source.showZero, 'badge showZero'),
        placement: badgeConfig.parsePluginStringEnum(
          source.placement,
          'badge placement',
          PLACEMENTS,
          'one of the four corners'
        ),
        size: badgeConfig.parsePluginStringEnum(
          source.size,
          'badge size',
          SIZES,
          'small, medium, or large'
        ),
        badgeColor: badgeConfig.parseCanonicalPluginColor(source.badgeColor, 'badge color'),
        textColor: badgeConfig.parseCanonicalPluginColor(source.textColor, 'badge text color'),
        hostLabel: badgeConfig.parseBoundedPluginText(source.hostLabel, 'badge host label', 1, 120),
        hostBackground: badgeConfig.parseCanonicalPluginColor(
          source.hostBackground,
          'badge host background'
        ),
        hostTextColor: badgeConfig.parseCanonicalPluginColor(
          source.hostTextColor,
          'badge host text color'
        ),
        label: badgeConfig.parseBoundedPluginText(
          source.label,
          'badge accessible count label',
          1,
          80
        )
      }
      badgeConfig.assertBoundedPluginConfigBytes(config, 'badge config', 4096)
      return config
    }
  )
}

const BADGE_MODULE_CONTRACT: moduleContract.ModuleContract<BadgeModuleConfigV1> = {
  pluginId: BADGE_PLUGIN_ID,
  moduleType: BADGE_MODULE_TYPE,
  configVersion: BADGE_MODULE_CONFIG_VERSION,
  displayName: 'badge',
  defaultConfig: BADGE_MODULE_DEFAULT_CONFIG,
  parseConfig: parseBadgeConfig
}

export function createBadgeModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(BADGE_MODULE_CONTRACT, config)
}

export function createBadgeModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return {
    ...createModuleFrameOverrides({
      name: 'Badge',
      defaultSize: BADGE_MODULE_DEFAULT_SIZE,
      fillColor: TRANSPARENT,
      strokeColor: TRANSPARENT,
      module: createBadgeModuleInstance(config)
    }),
    fills: [],
    strokes: [],
    cornerRadius: 0
  }
}

export function resolveBadgeModule(value: unknown): ModuleResolution<BadgeModuleConfigV1> {
  return moduleContract.resolveContractModule(value, BADGE_MODULE_CONTRACT)
}

const BADGE_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['mode'],
    kind: 'select',
    label: 'Badge type',
    i18nLabelKey: 'lowcodeModuleFieldBadgeMode',
    options: [...MODES]
  },
  {
    path: ['count'],
    kind: 'number',
    label: 'Configured count',
    i18nLabelKey: 'lowcodeModuleFieldBadgeCount',
    min: 0,
    max: 999_999_999,
    step: 1
  },
  {
    path: ['max'],
    kind: 'number',
    label: 'Display limit',
    i18nLabelKey: 'lowcodeModuleFieldBadgeMax',
    min: 1,
    max: 999_999,
    step: 1
  },
  {
    path: ['showZero'],
    kind: 'boolean',
    label: 'Show zero',
    i18nLabelKey: 'lowcodeModuleFieldBadgeShowZero'
  },
  {
    path: ['placement'],
    kind: 'select',
    label: 'Position',
    i18nLabelKey: 'lowcodeModuleFieldBadgePlacement',
    options: [...PLACEMENTS]
  },
  {
    path: ['size'],
    kind: 'select',
    label: 'Badge size',
    i18nLabelKey: 'lowcodeModuleFieldBadgeSize',
    options: [...SIZES]
  },
  {
    path: ['hostLabel'],
    kind: 'text',
    label: 'Host text',
    i18nLabelKey: 'lowcodeModuleFieldBadgeHostLabel'
  },
  {
    path: ['label'],
    kind: 'text',
    label: 'Accessible count label',
    i18nLabelKey: 'lowcodeModuleFieldBadgeLabel'
  },
  {
    path: ['badgeColor'],
    kind: 'color',
    label: 'Badge color',
    i18nLabelKey: 'lowcodeModuleFieldBadgeColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Badge text color',
    i18nLabelKey: 'lowcodeModuleFieldBadgeTextColor'
  },
  {
    path: ['hostBackground'],
    kind: 'color',
    label: 'Host background',
    i18nLabelKey: 'lowcodeModuleFieldBadgeHostBackground'
  },
  {
    path: ['hostTextColor'],
    kind: 'color',
    label: 'Host text color',
    i18nLabelKey: 'lowcodeModuleFieldBadgeHostTextColor'
  }
])

export const BADGE_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  BADGE_MODULE_CONTRACT,
  {
    name: 'Badge',
    description: 'A text host with a configured count or decorative dot; no remote data source.',
    i18nNameKey: 'lowcodeModuleBadgeName',
    i18nDescriptionKey: 'lowcodeModuleBadgeDescription',
    defaultSize: BADGE_MODULE_DEFAULT_SIZE,
    fields: BADGE_MODULE_FIELDS,
    createInstance: createBadgeModuleInstance,
    createFrameOverrides: createBadgeModuleFrameOverrides,
    resolve: resolveBadgeModule
  }
)
export const BADGE_PLUGIN = moduleContract.createSingleModulePlugin(
  BADGE_PLUGIN_ID,
  'Badge',
  BADGE_MODULE_DEFINITION
)
