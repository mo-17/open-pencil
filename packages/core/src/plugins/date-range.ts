import { isIsoDate } from '@open-pencil/lowcode'
import * as values from '@open-pencil/plugin-contracts/adapter-helpers'
import type { ModuleInstanceV1, SceneNode } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { DATE_RANGE_FIELDS } from './date-range/fields'
import * as contract from './module-contract'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleResolution } from './types'

export {
  DATE_RANGE_LAYOUT,
  DATE_RANGE_MESSAGES,
  dateRangeGeometry,
  dateRangeLocale
} from './date-range/layout'

export const DATE_RANGE_PLUGIN_ID = 'open-pencil.date-range'
export const DATE_RANGE_MODULE_TYPE = 'date-range'
export const DATE_RANGE_MODULE_CONFIG_VERSION = 1
export const DATE_RANGE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 188 })

/** Authored defaults apply only while unbound; reviewed bindings own runtime values and FORM fields. */
export interface DateRangeModuleConfigV1 extends JSONObject {
  label: string
  startLabel: string
  endLabel: string
  initialStart: string
  initialEnd: string
  min: string
  max: string
  disabled: boolean
  allowClear: boolean
  backgroundColor: string
  textColor: string
  borderColor: string
  accentColor: string
  fontSize: number
  borderRadius: number
}
export const DATE_RANGE_MODULE_DEFAULT_CONFIG: Readonly<DateRangeModuleConfigV1> = Object.freeze({
  label: 'Date range',
  startLabel: '',
  endLabel: '',
  initialStart: '',
  initialEnd: '',
  min: '',
  max: '',
  disabled: false,
  allowClear: true,
  backgroundColor: '#FFFFFF',
  textColor: '#111827',
  borderColor: '#CBD5E1',
  accentColor: '#2563EB',
  fontSize: 14,
  borderRadius: 8
})
const KEYS = new Set(Object.keys(DATE_RANGE_MODULE_DEFAULT_CONFIG))
function dateValue(source: unknown, field: string): string {
  const value = values.parseBoundedPluginText(source, 'date range ' + field, 0, 10)
  if (value && !isIsoDate(value))
    throw new TypeError('date range ' + field + ' must be an ISO calendar date or empty')
  return value
}
function parseConfig(value: unknown) {
  return contract.parseExactModuleConfig(
    value,
    KEYS,
    'date range config must contain exactly the declared fields',
    (source) => {
      const config: DateRangeModuleConfigV1 = {
        label: values.parseBoundedPluginText(source.label, 'date range label', 1, 120),
        startLabel: values.parseBoundedPluginText(
          source.startLabel,
          'date range startLabel',
          0,
          80
        ),
        endLabel: values.parseBoundedPluginText(source.endLabel, 'date range endLabel', 0, 80),
        initialStart: dateValue(source.initialStart, 'initialStart'),
        initialEnd: dateValue(source.initialEnd, 'initialEnd'),
        min: dateValue(source.min, 'min'),
        max: dateValue(source.max, 'max'),
        disabled: values.parsePluginBoolean(source.disabled, 'date range disabled'),
        allowClear: values.parsePluginBoolean(source.allowClear, 'date range allowClear'),
        backgroundColor: values.parseCanonicalPluginColor(
          source.backgroundColor,
          'date range backgroundColor'
        ),
        textColor: values.parseCanonicalPluginColor(source.textColor, 'date range textColor'),
        borderColor: values.parseCanonicalPluginColor(source.borderColor, 'date range borderColor'),
        accentColor: values.parseCanonicalPluginColor(source.accentColor, 'date range accentColor'),
        fontSize: values.parseBoundedPluginNumber(source.fontSize, 'date range fontSize', 10, 24),
        borderRadius: values.parseBoundedPluginNumber(
          source.borderRadius,
          'date range borderRadius',
          0,
          24
        )
      }
      if (config.min && config.max && config.min > config.max)
        throw new TypeError('date range min must not exceed max')
      if (config.initialStart && config.initialEnd && config.initialStart > config.initialEnd)
        throw new TypeError('date range start must not exceed end')
      for (const date of [config.initialStart, config.initialEnd]) {
        if (date && ((config.min && date < config.min) || (config.max && date > config.max)))
          throw new TypeError('date range initial values must be within min and max')
      }
      values.assertBoundedPluginConfigBytes(config, 'date range config', 4096)
      return config
    }
  )
}
const CONTRACT: contract.ModuleContract<DateRangeModuleConfigV1> = {
  pluginId: DATE_RANGE_PLUGIN_ID,
  moduleType: DATE_RANGE_MODULE_TYPE,
  configVersion: DATE_RANGE_MODULE_CONFIG_VERSION,
  displayName: 'date range',
  defaultConfig: DATE_RANGE_MODULE_DEFAULT_CONFIG,
  parseConfig
}
export function createDateRangeModuleInstance(config?: unknown): ModuleInstanceV1 {
  return contract.createContractModuleInstance(CONTRACT, config)
}
export function resolveDateRangeModule(value: unknown): ModuleResolution<DateRangeModuleConfigV1> {
  return contract.resolveContractModule(value, CONTRACT)
}
export function createDateRangeModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Date range',
    defaultSize: DATE_RANGE_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.8, g: 0.84, b: 0.89, a: 1 },
    module: createDateRangeModuleInstance(config)
  })
}
export const DATE_RANGE_MODULE_DEFINITION = contract.createContractModuleDefinition(CONTRACT, {
  name: 'Date range',
  description:
    'Two native calendar inputs with range validation and optional state bindings for independent FORM endpoints.',
  i18nNameKey: 'lowcodeModuleDateRangeName',
  i18nDescriptionKey: 'lowcodeModuleDateRangeDescription',
  defaultSize: DATE_RANGE_MODULE_DEFAULT_SIZE,
  fields: DATE_RANGE_FIELDS,
  createInstance: createDateRangeModuleInstance,
  createFrameOverrides: createDateRangeModuleFrameOverrides,
  resolve: resolveDateRangeModule
})
export const DATE_RANGE_PLUGIN = contract.createSingleModulePlugin(
  DATE_RANGE_PLUGIN_ID,
  'OpenPencil Date Range',
  DATE_RANGE_MODULE_DEFINITION
)
