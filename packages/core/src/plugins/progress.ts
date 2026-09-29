import * as configValues from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const PROGRESS_PLUGIN_ID = 'open-pencil.progress'
export const PROGRESS_MODULE_TYPE = 'progress'
export const PROGRESS_MODULE_CONFIG_VERSION = 1
export const PROGRESS_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 200 })

export interface ProgressModuleConfigV1 extends JSONObject {
  variant: 'linear' | 'circular'
  value: number
  indeterminate: boolean
  label: string
  pendingLabel: string
  showLabel: boolean
  showValue: boolean
  accentColor: string
  trackColor: string
  textColor: string
  backgroundColor: string
  fontSize: number
  thickness: number
  diameter: number
}
export type ProgressModuleConfig = ProgressModuleConfigV1

export const PROGRESS_MODULE_DEFAULT_CONFIG: Readonly<ProgressModuleConfigV1> = Object.freeze({
  variant: 'linear',
  value: 65,
  indeterminate: false,
  label: 'Progress',
  pendingLabel: 'In progress',
  showLabel: true,
  showValue: true,
  accentColor: '#2563EB',
  trackColor: '#E2E8F0',
  textColor: '#172B4D',
  backgroundColor: '#FFFFFF',
  fontSize: 14,
  thickness: 8,
  diameter: 120
})

const CONFIG_KEYS = new Set(Object.keys(PROGRESS_MODULE_DEFAULT_CONFIG))
function parseProgressConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'progress config must contain exactly its supported fields',
    (source): ProgressModuleConfigV1 => {
      const progress = configValues.parseBoundedPluginNumber(source.value, 'progress value', 0, 100)
      if (Math.abs(progress * 100 - Math.round(progress * 100)) > 0.000001)
        throw new TypeError('progress value must have at most two decimal places')
      const config: ProgressModuleConfigV1 = {
        variant: configValues.parsePluginStringEnum(
          source.variant,
          'progress variant',
          new Set(['linear', 'circular'] as const),
          'linear or circular'
        ),
        value: Math.round(progress * 100) / 100,
        indeterminate: configValues.parsePluginBoolean(
          source.indeterminate,
          'progress indeterminate'
        ),
        label: configValues.parseBoundedPluginText(source.label, 'progress label', 1, 120),
        pendingLabel: configValues.parseBoundedPluginText(
          source.pendingLabel,
          'progress pendingLabel',
          1,
          120
        ),
        showLabel: configValues.parsePluginBoolean(source.showLabel, 'progress showLabel'),
        showValue: configValues.parsePluginBoolean(source.showValue, 'progress showValue'),
        accentColor: configValues.parseCanonicalPluginColor(
          source.accentColor,
          'progress accentColor'
        ),
        trackColor: configValues.parseCanonicalPluginColor(
          source.trackColor,
          'progress trackColor'
        ),
        textColor: configValues.parseCanonicalPluginColor(source.textColor, 'progress textColor'),
        backgroundColor: configValues.parseCanonicalPluginColor(
          source.backgroundColor,
          'progress backgroundColor'
        ),
        fontSize: configValues.parseBoundedPluginNumber(
          source.fontSize,
          'progress fontSize',
          10,
          32
        ),
        thickness: configValues.parseBoundedPluginNumber(
          source.thickness,
          'progress thickness',
          2,
          16
        ),
        diameter: configValues.parseBoundedPluginNumber(
          source.diameter,
          'progress diameter',
          48,
          240
        )
      }
      configValues.assertBoundedPluginConfigBytes(config, 'progress config', 4096)
      return config
    }
  )
}

const CONTRACT: moduleContract.ModuleContract<ProgressModuleConfigV1> = {
  pluginId: PROGRESS_PLUGIN_ID,
  moduleType: PROGRESS_MODULE_TYPE,
  configVersion: PROGRESS_MODULE_CONFIG_VERSION,
  displayName: 'progress',
  defaultConfig: PROGRESS_MODULE_DEFAULT_CONFIG,
  parseConfig: parseProgressConfig
}

export function createProgressModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(CONTRACT, config)
}
export function createProgressModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Progress',
    defaultSize: PROGRESS_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.89, g: 0.91, b: 0.94, a: 1 },
    module: createProgressModuleInstance(config)
  })
}
export function resolveProgressModule(value: unknown): ModuleResolution<ProgressModuleConfigV1> {
  return moduleContract.resolveContractModule(value, CONTRACT)
}

/** A pending indicator has no percentage, even when an authored value is retained. */
export function progressDisplayValue(config: ProgressModuleConfigV1): string {
  if (config.indeterminate) return config.pendingLabel
  return config.showValue ? `${config.value}%` : ''
}

const FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['variant'],
    kind: 'select',
    label: 'Appearance',
    i18nLabelKey: 'lowcodeModuleFieldProgressVariant',
    options: ['linear', 'circular']
  },
  {
    path: ['value'],
    kind: 'number',
    label: 'Progress (%)',
    i18nLabelKey: 'lowcodeModuleFieldProgressValue',
    min: 0,
    max: 100,
    step: 0.01
  },
  {
    path: ['indeterminate'],
    kind: 'boolean',
    label: 'Indeterminate',
    i18nLabelKey: 'lowcodeModuleFieldProgressIndeterminate'
  },
  {
    path: ['label'],
    kind: 'text',
    label: 'Label',
    i18nLabelKey: 'lowcodeModuleFieldProgressLabel'
  },
  {
    path: ['pendingLabel'],
    kind: 'text',
    label: 'Indeterminate text',
    i18nLabelKey: 'lowcodeModuleFieldProgressPendingLabel'
  },
  {
    path: ['showLabel'],
    kind: 'boolean',
    label: 'Show label',
    i18nLabelKey: 'lowcodeModuleFieldProgressShowLabel'
  },
  {
    path: ['showValue'],
    kind: 'boolean',
    label: 'Show percentage',
    i18nLabelKey: 'lowcodeModuleFieldProgressShowValue'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Progress color',
    i18nLabelKey: 'lowcodeModuleFieldProgressAccentColor'
  },
  {
    path: ['trackColor'],
    kind: 'color',
    label: 'Track color',
    i18nLabelKey: 'lowcodeModuleFieldProgressTrackColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldProgressTextColor'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background color',
    i18nLabelKey: 'lowcodeModuleFieldProgressBackgroundColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldProgressFontSize',
    min: 10,
    max: 32,
    step: 1
  },
  {
    path: ['thickness'],
    kind: 'number',
    label: 'Track thickness',
    i18nLabelKey: 'lowcodeModuleFieldProgressThickness',
    min: 2,
    max: 16,
    step: 1
  },
  {
    path: ['diameter'],
    kind: 'number',
    label: 'Circle diameter',
    i18nLabelKey: 'lowcodeModuleFieldProgressDiameter',
    min: 48,
    max: 240,
    step: 1
  }
])

export const PROGRESS_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(CONTRACT, {
  name: 'Progress',
  description: 'Linear or circular progress with an explicit value or an indeterminate indicator.',
  i18nNameKey: 'lowcodeModuleProgressName',
  i18nDescriptionKey: 'lowcodeModuleProgressDescription',
  defaultSize: PROGRESS_MODULE_DEFAULT_SIZE,
  fields: FIELDS,
  createInstance: createProgressModuleInstance,
  createFrameOverrides: createProgressModuleFrameOverrides,
  resolve: resolveProgressModule
})
export const PROGRESS_PLUGIN = moduleContract.createSingleModulePlugin(
  PROGRESS_PLUGIN_ID,
  'OpenPencil Progress',
  PROGRESS_MODULE_DEFINITION
)
