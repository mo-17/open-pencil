import * as pluginConfig from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const RATING_PLUGIN_ID = 'open-pencil.rating'
export const RATING_MODULE_TYPE = 'rating'
export const RATING_MODULE_CONFIG_VERSION = 1
export const RATING_MODULE_DEFAULT_SIZE = Object.freeze({ width: 280, height: 144 })
/** Shared path in a 24 × 24 viewport; no star glyph or external icon font is required. */
export const RATING_STAR_PATH =
  'M12 2.5 14.94 8.46 21.52 9.42 16.76 14.06 17.88 20.61 12 17.52 6.12 20.61 7.24 14.06 2.48 9.42 9.06 8.46Z'

export interface RatingModuleConfigV1 extends JSONObject {
  label: string
  max: number
  initialValue: number
  allowHalf: boolean
  disabled: boolean
  readOnly: boolean
  showValue: boolean
  allowClear: boolean
  clearLabel: string
  activeColor: string
  inactiveColor: string
  textColor: string
  backgroundColor: string
  starSize: number
  fontSize: number
}

export const RATING_MODULE_DEFAULT_CONFIG: Readonly<RatingModuleConfigV1> = Object.freeze({
  label: 'Rating',
  max: 5,
  initialValue: 3,
  allowHalf: false,
  disabled: false,
  readOnly: false,
  showValue: true,
  allowClear: true,
  clearLabel: 'Clear rating',
  activeColor: '#D97706',
  inactiveColor: '#D1D5DB',
  textColor: '#111827',
  backgroundColor: '#FFFFFF',
  starSize: 32,
  fontSize: 14
})

const CONFIG_KEYS = new Set(Object.keys(RATING_MODULE_DEFAULT_CONFIG))

function parseRatingConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'rating config must contain exactly the declared rating fields',
    (source): RatingModuleConfigV1 => {
      const max = pluginConfig.parseBoundedPluginNumber(source.max, 'rating config max', 1, 10)
      if (!Number.isInteger(max)) throw new TypeError('rating config max must be an integer')
      const allowHalf = pluginConfig.parsePluginBoolean(source.allowHalf, 'rating config allowHalf')
      const initialValue = pluginConfig.parseBoundedPluginNumber(
        source.initialValue,
        'rating config initialValue',
        0,
        max
      )
      if (!Number.isInteger(initialValue / (allowHalf ? 0.5 : 1))) {
        throw new TypeError('rating config initialValue must match whole-star or half-star steps')
      }
      const config: RatingModuleConfigV1 = {
        label: pluginConfig.parseBoundedPluginText(source.label, 'rating config label', 1, 120),
        max,
        initialValue,
        allowHalf,
        disabled: pluginConfig.parsePluginBoolean(source.disabled, 'rating config disabled'),
        readOnly: pluginConfig.parsePluginBoolean(source.readOnly, 'rating config readOnly'),
        showValue: pluginConfig.parsePluginBoolean(source.showValue, 'rating config showValue'),
        allowClear: pluginConfig.parsePluginBoolean(source.allowClear, 'rating config allowClear'),
        clearLabel: pluginConfig.parseBoundedPluginText(
          source.clearLabel,
          'rating config clearLabel',
          1,
          80
        ),
        activeColor: pluginConfig.parseCanonicalPluginColor(
          source.activeColor,
          'rating config activeColor'
        ),
        inactiveColor: pluginConfig.parseCanonicalPluginColor(
          source.inactiveColor,
          'rating config inactiveColor'
        ),
        textColor: pluginConfig.parseCanonicalPluginColor(
          source.textColor,
          'rating config textColor'
        ),
        backgroundColor: pluginConfig.parseCanonicalPluginColor(
          source.backgroundColor,
          'rating config backgroundColor'
        ),
        starSize: pluginConfig.parseBoundedPluginNumber(
          source.starSize,
          'rating config starSize',
          16,
          48
        ),
        fontSize: pluginConfig.parseBoundedPluginNumber(
          source.fontSize,
          'rating config fontSize',
          10,
          32
        )
      }
      pluginConfig.assertBoundedPluginConfigBytes(config, 'rating config', 4096)
      return config
    }
  )
}

const RATING_MODULE_CONTRACT: moduleContract.ModuleContract<RatingModuleConfigV1> = {
  pluginId: RATING_PLUGIN_ID,
  moduleType: RATING_MODULE_TYPE,
  configVersion: RATING_MODULE_CONFIG_VERSION,
  displayName: 'rating',
  defaultConfig: RATING_MODULE_DEFAULT_CONFIG,
  parseConfig: parseRatingConfig
}

export function createRatingModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(RATING_MODULE_CONTRACT, config)
}

export function createRatingModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Rating',
    defaultSize: RATING_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createRatingModuleInstance(config)
  })
}

export function resolveRatingModule(value: unknown): ModuleResolution<RatingModuleConfigV1> {
  return moduleContract.resolveContractModule(value, RATING_MODULE_CONTRACT)
}

const RATING_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['label'], kind: 'text', label: 'Label', i18nLabelKey: 'lowcodeModuleFieldRatingLabel' },
  {
    path: ['max'],
    kind: 'number',
    label: 'Star count',
    i18nLabelKey: 'lowcodeModuleFieldRatingMax',
    min: 1,
    max: 10,
    step: 1
  },
  {
    path: ['allowHalf'],
    kind: 'boolean',
    label: 'Half stars',
    i18nLabelKey: 'lowcodeModuleFieldRatingHalf'
  },
  {
    path: ['initialValue'],
    kind: 'number',
    label: 'Initial rating',
    i18nLabelKey: 'lowcodeModuleFieldRatingInitialValue',
    min: 0,
    max: 10,
    step: 0.5
  },
  {
    path: ['disabled'],
    kind: 'boolean',
    label: 'Disabled',
    i18nLabelKey: 'lowcodeModuleFieldRatingDisabled'
  },
  {
    path: ['readOnly'],
    kind: 'boolean',
    label: 'Read only',
    i18nLabelKey: 'lowcodeModuleFieldRatingReadOnly'
  },
  {
    path: ['showValue'],
    kind: 'boolean',
    label: 'Show value',
    i18nLabelKey: 'lowcodeModuleFieldRatingShowValue'
  },
  {
    path: ['allowClear'],
    kind: 'boolean',
    label: 'Allow clearing',
    i18nLabelKey: 'lowcodeModuleFieldRatingAllowClear'
  },
  {
    path: ['clearLabel'],
    kind: 'text',
    label: 'Clear button text',
    i18nLabelKey: 'lowcodeModuleFieldRatingClearLabel'
  },
  {
    path: ['activeColor'],
    kind: 'color',
    label: 'Selected color',
    i18nLabelKey: 'lowcodeModuleFieldRatingActiveColor'
  },
  {
    path: ['inactiveColor'],
    kind: 'color',
    label: 'Empty color',
    i18nLabelKey: 'lowcodeModuleFieldRatingInactiveColor'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldRatingTextColor'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldRatingBackground'
  },
  {
    path: ['starSize'],
    kind: 'number',
    label: 'Star size',
    i18nLabelKey: 'lowcodeModuleFieldRatingStarSize',
    min: 16,
    max: 48,
    step: 1
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldRatingFontSize',
    min: 10,
    max: 32,
    step: 1
  }
])

export const RATING_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  RATING_MODULE_CONTRACT,
  {
    name: 'Rating',
    description: 'Accessible whole-star or half-star rating with optional state binding and form validation.',
    i18nNameKey: 'lowcodeModuleRatingName',
    i18nDescriptionKey: 'lowcodeModuleRatingDescription',
    defaultSize: RATING_MODULE_DEFAULT_SIZE,
    fields: RATING_MODULE_FIELDS,
    createInstance: createRatingModuleInstance,
    createFrameOverrides: createRatingModuleFrameOverrides,
    resolve: resolveRatingModule
  }
)

export const RATING_PLUGIN = moduleContract.createSingleModulePlugin(
  RATING_PLUGIN_ID,
  'OpenPencil Rating',
  RATING_MODULE_DEFINITION
)
