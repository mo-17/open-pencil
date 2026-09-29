import * as alertConfig from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { TRANSPARENT } from '#core/constants'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const ALERT_PLUGIN_ID = 'open-pencil.alert'
export const ALERT_MODULE_TYPE = 'alert'
export const ALERT_MODULE_CONFIG_VERSION = 1
export const ALERT_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 116 })

export interface AlertModuleConfigV1 extends JSONObject {
  tone: 'info' | 'success' | 'warning' | 'error'
  variant: 'soft' | 'outlined' | 'filled'
  title: string
  description: string
  showIcon: boolean
  closable: boolean
  closeLabel: string
  fontSize: number
  borderRadius: number
  announcement: 'polite' | 'assertive' | 'off'
}

export const ALERT_MODULE_DEFAULT_CONFIG: Readonly<AlertModuleConfigV1> = Object.freeze({
  tone: 'info',
  variant: 'soft',
  title: 'Information',
  description: 'Add a helpful message for your users.',
  showIcon: true,
  closable: true,
  closeLabel: 'Dismiss message',
  fontSize: 14,
  borderRadius: 8,
  announcement: 'polite'
})

/** Semantic colors and vector paths are shared by the canvas and both web targets. */
export const ALERT_TONE_PALETTE = Object.freeze({
  info: { background: '#EFF6FF', foreground: '#1E40AF', accent: '#1D4ED8', border: '#93C5FD' },
  success: { background: '#F0FDF4', foreground: '#166534', accent: '#15803D', border: '#86EFAC' },
  warning: { background: '#FFFBEB', foreground: '#92400E', accent: '#92400E', border: '#FCD34D' },
  error: { background: '#FEF2F2', foreground: '#991B1B', accent: '#B91C1C', border: '#FCA5A5' }
})
export const ALERT_ICON_PATHS = Object.freeze({
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 10v7M12 7v.1',
  success: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 12l3 3 5-6',
  warning: 'M12 3 2 21h20L12 3ZM12 9v5M12 17v.1',
  error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M9 9l6 6M15 9l-6 6'
})
export const ALERT_CLOSE_PATH = 'M6 6l12 12M18 6 6 18'

export function alertAppearance(config: Pick<AlertModuleConfigV1, 'tone' | 'variant'>) {
  const palette = ALERT_TONE_PALETTE[config.tone]
  const background = config.variant === 'outlined' ? '#FFFFFF' : palette.background
  return {
    background: config.variant === 'filled' ? palette.accent : background,
    foreground: config.variant === 'filled' ? '#FFFFFF' : palette.foreground,
    border: config.variant === 'filled' ? palette.accent : palette.border
  }
}

const CONFIG_KEYS = new Set(Object.keys(ALERT_MODULE_DEFAULT_CONFIG))
const TONES = new Set<AlertModuleConfigV1['tone']>(['info', 'success', 'warning', 'error'])
const VARIANTS = new Set<AlertModuleConfigV1['variant']>(['soft', 'outlined', 'filled'])
const ANNOUNCEMENTS = new Set<AlertModuleConfigV1['announcement']>(['polite', 'assertive', 'off'])

export function parseAlertConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'alert config must contain exactly the declared alert fields',
    (source): AlertModuleConfigV1 => {
      const config: AlertModuleConfigV1 = {
        tone: alertConfig.parsePluginStringEnum(
          source.tone,
          'alert tone',
          TONES,
          'info, success, warning, or error'
        ),
        variant: alertConfig.parsePluginStringEnum(
          source.variant,
          'alert variant',
          VARIANTS,
          'soft, outlined, or filled'
        ),
        title: alertConfig.parseBoundedPluginText(source.title, 'alert title', 0, 120),
        description: alertConfig.parseBoundedPluginText(
          source.description,
          'alert description',
          0,
          2000
        ),
        showIcon: alertConfig.parsePluginBoolean(source.showIcon, 'alert showIcon'),
        closable: alertConfig.parsePluginBoolean(source.closable, 'alert closable'),
        closeLabel: alertConfig.parseBoundedPluginText(
          source.closeLabel,
          'alert closeLabel',
          1,
          80
        ),
        fontSize: alertConfig.parseBoundedPluginNumber(source.fontSize, 'alert fontSize', 10, 24),
        borderRadius: alertConfig.parseBoundedPluginNumber(
          source.borderRadius,
          'alert borderRadius',
          0,
          24
        ),
        announcement: alertConfig.parsePluginStringEnum(
          source.announcement,
          'alert announcement',
          ANNOUNCEMENTS,
          'polite, assertive, or off'
        )
      }
      if (!config.title.trim() && !config.description.trim())
        throw new TypeError('alert needs a title or description')
      alertConfig.assertBoundedPluginConfigBytes(config, 'alert config', 16384)
      return config
    }
  )
}

const ALERT_MODULE_CONTRACT: moduleContract.ModuleContract<AlertModuleConfigV1> = {
  pluginId: ALERT_PLUGIN_ID,
  moduleType: ALERT_MODULE_TYPE,
  configVersion: ALERT_MODULE_CONFIG_VERSION,
  displayName: 'alert',
  defaultConfig: ALERT_MODULE_DEFAULT_CONFIG,
  parseConfig: parseAlertConfig
}

export function createAlertModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(ALERT_MODULE_CONTRACT, config)
}

export function createAlertModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  const module = createAlertModuleInstance(config)
  const resolved = resolveAlertModule(module)
  if (!resolved?.ok) throw new TypeError('Unable to resolve the alert configuration')
  return {
    ...createModuleFrameOverrides({
      name: 'Alert',
      defaultSize: ALERT_MODULE_DEFAULT_SIZE,
      fillColor: { r: 1, g: 1, b: 1, a: 1 },
      strokeColor: TRANSPARENT,
      module
    }),
    fills: [],
    strokes: [],
    cornerRadius: resolved.config.borderRadius
  }
}

export function resolveAlertModule(value: unknown): ModuleResolution<AlertModuleConfigV1> {
  return moduleContract.resolveContractModule(value, ALERT_MODULE_CONTRACT)
}

const ALERT_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['tone'],
    kind: 'select',
    label: 'Tone',
    i18nLabelKey: 'lowcodeModuleFieldAlertTone',
    options: ['info', 'success', 'warning', 'error']
  },
  {
    path: ['variant'],
    kind: 'select',
    label: 'Appearance',
    i18nLabelKey: 'lowcodeModuleFieldAlertVariant',
    options: ['soft', 'outlined', 'filled']
  },
  { path: ['title'], kind: 'text', label: 'Title', i18nLabelKey: 'lowcodeModuleFieldAlertTitle' },
  {
    path: ['description'],
    kind: 'text',
    label: 'Description',
    i18nLabelKey: 'lowcodeModuleFieldAlertDescription'
  },
  {
    path: ['showIcon'],
    kind: 'boolean',
    label: 'Show icon',
    i18nLabelKey: 'lowcodeModuleFieldAlertShowIcon'
  },
  {
    path: ['closable'],
    kind: 'boolean',
    label: 'Dismissible',
    i18nLabelKey: 'lowcodeModuleFieldAlertClosable'
  },
  {
    path: ['closeLabel'],
    kind: 'text',
    label: 'Dismiss button label',
    i18nLabelKey: 'lowcodeModuleFieldAlertCloseLabel'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldAlertFontSize',
    min: 10,
    max: 24,
    step: 1
  },
  {
    path: ['borderRadius'],
    kind: 'number',
    label: 'Corner radius',
    i18nLabelKey: 'lowcodeModuleFieldAlertRadius',
    min: 0,
    max: 24,
    step: 1
  },
  {
    path: ['announcement'],
    kind: 'select',
    label: 'Screen reader announcement',
    i18nLabelKey: 'lowcodeModuleFieldAlertAnnouncement',
    options: ['polite', 'assertive', 'off']
  }
])

export const ALERT_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  ALERT_MODULE_CONTRACT,
  {
    name: 'Alert',
    description: 'Semantic status messages with optional instance-local dismissal.',
    i18nNameKey: 'lowcodeModuleAlertName',
    i18nDescriptionKey: 'lowcodeModuleAlertDescription',
    defaultSize: ALERT_MODULE_DEFAULT_SIZE,
    fields: ALERT_MODULE_FIELDS,
    createInstance: createAlertModuleInstance,
    createFrameOverrides: createAlertModuleFrameOverrides,
    resolve: resolveAlertModule
  }
)
export const ALERT_PLUGIN = moduleContract.createSingleModulePlugin(
  ALERT_PLUGIN_ID,
  'Alert',
  ALERT_MODULE_DEFINITION
)
