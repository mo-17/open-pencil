import * as pluginValues from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import * as moduleContract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModulePropertyField, ModuleResolution } from './types'

export const SLIDER_PLUGIN_ID = 'open-pencil.slider'
export const SLIDER_MODULE_TYPE = 'slider'
export const SLIDER_MODULE_CONFIG_VERSION = 1
export const SLIDER_MODULE_DEFAULT_SIZE = Object.freeze({ width: 320, height: 116 })
export const SLIDER_MODULE_LIMITS = Object.freeze({
  label: 120,
  magnitude: 1_000_000,
  precision: 1_000_000,
  configBytes: 4_096
})

export interface SliderModuleConfigV1 extends JSONObject {
  label: string
  range: boolean
  min: number
  max: number
  step: number
  initialValue: number
  initialEndValue: number
  disabled: boolean
  readOnly: boolean
  showValue: boolean
  showBounds: boolean
  backgroundColor: string
  textColor: string
  accentColor: string
  trackColor: string
  fontSize: number
}

export type SliderModuleConfig = SliderModuleConfigV1

export const SLIDER_MODULE_DEFAULT_CONFIG: Readonly<SliderModuleConfigV1> = Object.freeze({
  label: 'Value',
  range: false,
  min: 0,
  max: 100,
  step: 1,
  initialValue: 30,
  initialEndValue: 70,
  disabled: false,
  readOnly: false,
  showValue: true,
  showBounds: true,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  accentColor: '#2563EB',
  trackColor: '#E2E8F0',
  fontSize: 14
})

const CONFIG_KEYS = new Set(Object.keys(SLIDER_MODULE_DEFAULT_CONFIG))

function parseSliderNumber(value: unknown, field: string, min: number, max: number): number {
  const number = pluginValues.parseBoundedPluginNumber(value, `slider config ${field}`, min, max)
  const scaled = number * SLIDER_MODULE_LIMITS.precision
  if (Math.abs(scaled - Math.round(scaled)) > 0.0001) {
    throw new TypeError(`slider config ${field} must have at most six decimal places`)
  }
  return number
}

/** Keep authored values on the same min-based step grid as both generated runtimes. */
export function normalizeSliderValue(value: number, config: SliderModuleConfigV1): number {
  const scale = SLIDER_MODULE_LIMITS.precision
  const min = Math.round(config.min * scale)
  const max = Math.round(config.max * scale)
  const step = Math.round(config.step * scale)
  const last = Math.floor((max - min) / step)
  const index = Math.max(0, Math.min(last, Math.round((value * scale - min) / step)))
  return (min + index * step) / scale
}

export function sliderInitialValues(config: SliderModuleConfigV1): readonly [number, number] {
  return [
    normalizeSliderValue(config.initialValue, config),
    normalizeSliderValue(config.initialEndValue, config)
  ]
}

function parseSliderConfig(value: unknown) {
  return moduleContract.parseExactModuleConfig(
    value,
    CONFIG_KEYS,
    'slider config must contain exactly the supported slider fields',
    (source): SliderModuleConfigV1 => {
      const bound = SLIDER_MODULE_LIMITS.magnitude
      const min = parseSliderNumber(source.min, 'min', -bound, bound)
      const max = parseSliderNumber(source.max, 'max', -bound, bound)
      if (min >= max) throw new TypeError('slider config min must be less than max')
      const config: SliderModuleConfigV1 = {
        label: pluginValues.parseBoundedPluginText(
          source.label,
          'slider config label',
          1,
          SLIDER_MODULE_LIMITS.label
        ),
        range: pluginValues.parsePluginBoolean(source.range, 'slider config range'),
        min,
        max,
        step: parseSliderNumber(source.step, 'step', 1 / SLIDER_MODULE_LIMITS.precision, max - min),
        initialValue: parseSliderNumber(source.initialValue, 'initialValue', min, max),
        initialEndValue: parseSliderNumber(source.initialEndValue, 'initialEndValue', min, max),
        disabled: pluginValues.parsePluginBoolean(source.disabled, 'slider config disabled'),
        readOnly: pluginValues.parsePluginBoolean(source.readOnly, 'slider config readOnly'),
        showValue: pluginValues.parsePluginBoolean(source.showValue, 'slider config showValue'),
        showBounds: pluginValues.parsePluginBoolean(source.showBounds, 'slider config showBounds'),
        backgroundColor: pluginValues.parseCanonicalPluginColor(
          source.backgroundColor,
          'slider config backgroundColor'
        ),
        textColor: pluginValues.parseCanonicalPluginColor(
          source.textColor,
          'slider config textColor'
        ),
        accentColor: pluginValues.parseCanonicalPluginColor(
          source.accentColor,
          'slider config accentColor'
        ),
        trackColor: pluginValues.parseCanonicalPluginColor(
          source.trackColor,
          'slider config trackColor'
        ),
        fontSize: pluginValues.parseBoundedPluginNumber(
          source.fontSize,
          'slider config fontSize',
          10,
          32
        )
      }
      if (config.range && config.initialValue > config.initialEndValue) {
        throw new TypeError(
          'slider config initialValue must not exceed initialEndValue in range mode'
        )
      }
      pluginValues.assertBoundedPluginConfigBytes(
        config,
        'slider config',
        SLIDER_MODULE_LIMITS.configBytes
      )
      return config
    }
  )
}

const SLIDER_MODULE_CONTRACT: moduleContract.ModuleContract<SliderModuleConfigV1> = {
  pluginId: SLIDER_PLUGIN_ID,
  moduleType: SLIDER_MODULE_TYPE,
  configVersion: SLIDER_MODULE_CONFIG_VERSION,
  displayName: 'slider',
  defaultConfig: SLIDER_MODULE_DEFAULT_CONFIG,
  parseConfig: parseSliderConfig
}

export function createSliderModuleInstance(config?: unknown): ModuleInstanceV1 {
  return moduleContract.createContractModuleInstance(SLIDER_MODULE_CONTRACT, config)
}

export function createSliderModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Slider',
    defaultSize: SLIDER_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.89, g: 0.91, b: 0.94, a: 1 },
    module: createSliderModuleInstance(config)
  })
}

export function resolveSliderModule(value: unknown): ModuleResolution<SliderModuleConfigV1> {
  return moduleContract.resolveContractModule(value, SLIDER_MODULE_CONTRACT)
}

const SLIDER_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['label'], kind: 'text', label: 'Label', i18nLabelKey: 'lowcodeModuleFieldSliderLabel' },
  {
    path: ['range'],
    kind: 'boolean',
    label: 'Range selection',
    i18nLabelKey: 'lowcodeModuleFieldSliderRange'
  },
  {
    path: ['min'],
    kind: 'number',
    label: 'Minimum',
    i18nLabelKey: 'lowcodeModuleFieldSliderMin',
    min: -1_000_000,
    max: 1_000_000,
    step: 0.000001
  },
  {
    path: ['max'],
    kind: 'number',
    label: 'Maximum',
    i18nLabelKey: 'lowcodeModuleFieldSliderMax',
    min: -1_000_000,
    max: 1_000_000,
    step: 0.000001
  },
  {
    path: ['step'],
    kind: 'number',
    label: 'Step',
    i18nLabelKey: 'lowcodeModuleFieldSliderStep',
    min: 0.000001,
    max: 2_000_000,
    step: 0.000001
  },
  {
    path: ['initialValue'],
    kind: 'number',
    label: 'Initial value / range start',
    i18nLabelKey: 'lowcodeModuleFieldSliderInitialValue',
    min: -1_000_000,
    max: 1_000_000,
    step: 0.000001
  },
  {
    path: ['initialEndValue'],
    kind: 'number',
    label: 'Initial range end',
    i18nLabelKey: 'lowcodeModuleFieldSliderInitialEndValue',
    min: -1_000_000,
    max: 1_000_000,
    step: 0.000001
  },
  {
    path: ['disabled'],
    kind: 'boolean',
    label: 'Disabled',
    i18nLabelKey: 'lowcodeModuleFieldSliderDisabled'
  },
  {
    path: ['readOnly'],
    kind: 'boolean',
    label: 'Read only',
    i18nLabelKey: 'lowcodeModuleFieldSliderReadOnly'
  },
  {
    path: ['showValue'],
    kind: 'boolean',
    label: 'Show value',
    i18nLabelKey: 'lowcodeModuleFieldSliderShowValue'
  },
  {
    path: ['showBounds'],
    kind: 'boolean',
    label: 'Show bounds',
    i18nLabelKey: 'lowcodeModuleFieldSliderShowBounds'
  },
  {
    path: ['backgroundColor'],
    kind: 'color',
    label: 'Background',
    i18nLabelKey: 'lowcodeModuleFieldSliderBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldSliderTextColor'
  },
  {
    path: ['accentColor'],
    kind: 'color',
    label: 'Accent color',
    i18nLabelKey: 'lowcodeModuleFieldSliderAccentColor'
  },
  {
    path: ['trackColor'],
    kind: 'color',
    label: 'Track color',
    i18nLabelKey: 'lowcodeModuleFieldSliderTrackColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldSliderFontSize',
    min: 10,
    max: 32,
    step: 1
  }
])

export const SLIDER_MODULE_DEFINITION = moduleContract.createContractModuleDefinition(
  SLIDER_MODULE_CONTRACT,
  {
    name: 'Slider',
    description:
      'Single-value or range selection with optional state binding, form validation and keyboard controls.',
    i18nNameKey: 'lowcodeModuleSliderName',
    i18nDescriptionKey: 'lowcodeModuleSliderDescription',
    defaultSize: SLIDER_MODULE_DEFAULT_SIZE,
    fields: SLIDER_MODULE_FIELDS,
    createInstance: createSliderModuleInstance,
    createFrameOverrides: createSliderModuleFrameOverrides,
    resolve: resolveSliderModule
  }
)

export const SLIDER_PLUGIN = moduleContract.createSingleModulePlugin(
  SLIDER_PLUGIN_ID,
  'OpenPencil Slider',
  SLIDER_MODULE_DEFINITION
)
