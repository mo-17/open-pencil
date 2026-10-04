import { mergePluginConfigWithDefaults } from '@open-pencil/plugin-contracts/adapter-helpers'
import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { CHART_MODULE_LIMITS } from './chart/limits'
import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const CHART_PLUGIN_ID = 'open-pencil.chart'
export const CHART_MODULE_TYPE = 'chart'
export const CHART_MODULE_CONFIG_VERSION = 1
export const CHART_MODULE_DEFAULT_SIZE = Object.freeze({ width: 360, height: 240 })
export { CHART_MODULE_LIMITS } from './chart/limits'

export interface ChartModuleConfigV1 extends JSONObject {
  chartType: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  values: number[]
  labels: string[]
  color: string
  showValues: boolean
}

export type ChartModuleConfig = ChartModuleConfigV1

const DEFAULT_VALUES: number[] = [32, 68, 46, 84]
const DEFAULT_LABELS: string[] = ['Q1', 'Q2', 'Q3', 'Q4']
Object.freeze(DEFAULT_VALUES)
Object.freeze(DEFAULT_LABELS)
const CHART_CONFIG_KEYS = new Set(['chartType', 'values', 'labels', 'color', 'showValues'])
const CHART_TYPES = new Set(['bar', 'line', 'area', 'pie', 'donut'])
const HEX_COLOR = /^#[\dA-F]{6}$/i

export const CHART_MODULE_DEFAULT_CONFIG: Readonly<ChartModuleConfigV1> = Object.freeze({
  chartType: 'bar',
  values: DEFAULT_VALUES,
  labels: DEFAULT_LABELS,
  color: '#2563EB',
  showValues: false
})

type ParseResult = { ok: true; config: ChartModuleConfigV1 } | { ok: false; reason: string }

function exactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value)
  return keys.length === CHART_CONFIG_KEYS.size && keys.every((key) => CHART_CONFIG_KEYS.has(key))
}

function parseValues(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CHART_MODULE_LIMITS.values) {
    return null
  }
  if (
    value.some(
      (entry) =>
        typeof entry !== 'number' ||
        !Number.isFinite(entry) ||
        Math.abs(entry) > CHART_MODULE_LIMITS.value
    )
  ) {
    return null
  }
  return [...value]
}

function parseLabels(value: unknown, valueCount: number): string[] | null {
  if (!Array.isArray(value) || value.length !== valueCount) return null
  if (
    value.some((entry) => typeof entry !== 'string' || entry.length > CHART_MODULE_LIMITS.label)
  ) {
    return null
  }
  return [...value]
}

function parseChartConfig(value: unknown): ParseResult {
  if (!isPlainJSONObject(value) || !exactKeys(value)) {
    return {
      ok: false,
      reason: 'chart config must contain exactly chartType, values, labels, color, and showValues'
    }
  }
  if (typeof value.chartType !== 'string' || !CHART_TYPES.has(value.chartType)) {
    return { ok: false, reason: 'chart config chartType must be bar, line, area, pie, or donut' }
  }
  const values = parseValues(value.values)
  if (!values) {
    return {
      ok: false,
      reason: `chart config values must contain 1 to ${CHART_MODULE_LIMITS.values} bounded numbers`
    }
  }
  if (
    (value.chartType === 'pie' || value.chartType === 'donut') &&
    values.some((entry) => entry < 0)
  ) {
    return { ok: false, reason: 'pie and donut values must be non-negative' }
  }
  const labels = parseLabels(value.labels, values.length)
  if (!labels) {
    return {
      ok: false,
      reason: 'chart config labels must match values and contain bounded strings'
    }
  }
  if (typeof value.color !== 'string' || !HEX_COLOR.test(value.color)) {
    return { ok: false, reason: 'chart config color must be a #RRGGBB value' }
  }
  if (typeof value.showValues !== 'boolean') {
    return { ok: false, reason: 'chart config showValues must be a boolean' }
  }
  return {
    ok: true,
    config: {
      chartType: value.chartType as ChartModuleConfigV1['chartType'],
      values,
      labels,
      color: value.color.toUpperCase(),
      showValues: value.showValues
    }
  }
}

export function createChartModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseChartConfig(
    mergePluginConfigWithDefaults(CHART_MODULE_DEFAULT_CONFIG, config)
  )
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: CHART_PLUGIN_ID,
    moduleType: CHART_MODULE_TYPE,
    configVersion: CHART_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createChartModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Chart',
    defaultSize: CHART_MODULE_DEFAULT_SIZE,
    fillColor: { r: 0.98, g: 0.98, b: 0.99, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createChartModuleInstance(config)
  })
}

export function resolveChartModule(value: unknown): ModuleResolution<ChartModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== CHART_PLUGIN_ID ||
    instance.value.moduleType !== CHART_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== CHART_MODULE_CONFIG_VERSION) {
    return { ok: false, reason: `unsupported chart config version ${instance.value.configVersion}` }
  }
  const config = parseChartConfig(instance.value.config)
  if (!config.ok) return config
  return { ok: true, instance: { ...instance.value, config: config.config }, config: config.config }
}

const CHART_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['chartType'],
    kind: 'select',
    label: 'Chart type',
    i18nLabelKey: 'lowcodeModuleFieldChartType',
    options: ['bar', 'line', 'area', 'pie', 'donut']
  },
  {
    path: ['values'],
    kind: 'json',
    label: 'Values',
    i18nLabelKey: 'lowcodeModuleFieldValues'
  },
  {
    path: ['labels'],
    kind: 'json',
    label: 'Labels',
    i18nLabelKey: 'lowcodeModuleFieldLabels'
  },
  {
    path: ['color'],
    kind: 'color',
    label: 'Color',
    i18nLabelKey: 'lowcodeModuleFieldColor'
  },
  {
    path: ['showValues'],
    kind: 'boolean',
    label: 'Show values',
    i18nLabelKey: 'lowcodeModuleFieldShowValues'
  }
])

export const CHART_MODULE_DEFINITION: ModuleDefinition<ChartModuleConfigV1> = Object.freeze({
  pluginId: CHART_PLUGIN_ID,
  moduleType: CHART_MODULE_TYPE,
  name: 'Chart',
  description: 'Deterministic charts with bounded authored data and shared canvas/export geometry.',
  i18nNameKey: 'lowcodeModuleChartName',
  i18nDescriptionKey: 'lowcodeModuleChartDescription',
  configVersion: CHART_MODULE_CONFIG_VERSION,
  defaultSize: CHART_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(CHART_MODULE_DEFAULT_CONFIG),
  fields: CHART_MODULE_FIELDS,
  createInstance: createChartModuleInstance,
  createFrameOverrides: createChartModuleFrameOverrides,
  resolve: resolveChartModule
})

export const CHART_PLUGIN = Object.freeze({
  id: CHART_PLUGIN_ID,
  name: 'OpenPencil Chart',
  version: '1.0.0',
  modules: Object.freeze([CHART_MODULE_DEFINITION])
})

export { buildChartLayout } from './chart/layout'
export type { ChartLayout, ChartText, ChartPath, ChartRect, ChartCircle } from './chart/types'
export { parseChartData, buildChartDataLayout } from './chart/data'
export type { ChartData } from './chart/data'
