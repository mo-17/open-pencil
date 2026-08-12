import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import { hasExactPluginKeys } from './parse-helpers'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const TABLE_PLUGIN_ID = 'open-pencil.table'
export const TABLE_MODULE_TYPE = 'table'
export const TABLE_MODULE_CONFIG_VERSION = 1
export const TABLE_MODULE_DEFAULT_SIZE = Object.freeze({ width: 720, height: 360 })
export const TABLE_MODULE_LIMITS = Object.freeze({
  columns: 12,
  rows: 100,
  cellText: 2_000,
  totalText: 100_000,
  fontSizeMin: 8,
  fontSizeMax: 72
})

export interface TableDataV1 extends JSONObject {
  columns: string[]
  rows: string[][]
}

export interface TableModuleConfigV1 extends JSONObject {
  table: TableDataV1
  showHeader: boolean
  striped: boolean
  borderColor: string
  headerBackground: string
  textColor: string
  fontSize: number
}

export type TableModuleConfig = TableModuleConfigV1

const DEFAULT_COLUMNS = ['Name', 'Status', 'Owner']
const DEFAULT_ROWS = [
  ['Landing page', 'Ready', 'Alex'],
  ['Mobile app', 'Review', 'Sam'],
  ['Design system', 'Draft', 'Jordan']
]
DEFAULT_ROWS.forEach(Object.freeze)
Object.freeze(DEFAULT_COLUMNS)
Object.freeze(DEFAULT_ROWS)

export const TABLE_MODULE_DEFAULT_CONFIG: Readonly<TableModuleConfigV1> = Object.freeze({
  table: Object.freeze({ columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS }),
  showHeader: true,
  striped: true,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  fontSize: 14
})

const CONFIG_KEYS = new Set([
  'table',
  'showHeader',
  'striped',
  'borderColor',
  'headerBackground',
  'textColor',
  'fontSize'
])
const TABLE_KEYS = new Set(['columns', 'rows'])
const HEX_COLOR = /^#[\dA-F]{6}$/i

type ParseResult = { ok: true; config: TableModuleConfigV1 } | { ok: false; reason: string }

function parseColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toUpperCase() : null
}

function parseCell(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > TABLE_MODULE_LIMITS.cellText) {
    throw new TypeError(
      `${path} must be a string of at most ${TABLE_MODULE_LIMITS.cellText} characters`
    )
  }
  return value
}

function parseTableData(value: unknown): TableDataV1 {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, TABLE_KEYS)) {
    throw new TypeError('table config table must contain exactly columns and rows')
  }
  if (
    !Array.isArray(value.columns) ||
    value.columns.length < 1 ||
    value.columns.length > TABLE_MODULE_LIMITS.columns
  ) {
    throw new TypeError(
      `table config columns must contain 1 to ${TABLE_MODULE_LIMITS.columns} strings`
    )
  }
  if (!Array.isArray(value.rows) || value.rows.length > TABLE_MODULE_LIMITS.rows) {
    throw new TypeError(`table config rows must contain at most ${TABLE_MODULE_LIMITS.rows} rows`)
  }
  let totalText = 0
  const columns = Array.from(value.columns, (entry, index) => {
    const cell = parseCell(entry, `table config columns[${index}]`)
    totalText += cell.length
    return cell
  })
  const rows = Array.from(value.rows, (row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw new TypeError(
        `table config rows[${rowIndex}] must contain exactly ${columns.length} cells`
      )
    }
    return Array.from(row, (entry, columnIndex) => {
      const cell = parseCell(entry, `table config rows[${rowIndex}][${columnIndex}]`)
      totalText += cell.length
      return cell
    })
  })
  if (totalText > TABLE_MODULE_LIMITS.totalText) {
    throw new TypeError(
      `table config text must not exceed ${TABLE_MODULE_LIMITS.totalText} characters`
    )
  }
  return { columns, rows }
}

function parseTableConfig(value: unknown): ParseResult {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'table config must contain exactly table, showHeader, striped, borderColor, headerBackground, textColor, and fontSize'
    }
  }
  let table: TableDataV1
  try {
    table = parseTableData(value.table)
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
  if (typeof value.showHeader !== 'boolean' || typeof value.striped !== 'boolean') {
    return { ok: false, reason: 'table config showHeader and striped must be booleans' }
  }
  const borderColor = parseColor(value.borderColor)
  if (borderColor === null) {
    return { ok: false, reason: 'table config borderColor must be a #RRGGBB value' }
  }
  const headerBackground = parseColor(value.headerBackground)
  if (headerBackground === null) {
    return { ok: false, reason: 'table config headerBackground must be a #RRGGBB value' }
  }
  const textColor = parseColor(value.textColor)
  if (textColor === null) {
    return { ok: false, reason: 'table config textColor must be a #RRGGBB value' }
  }
  if (
    typeof value.fontSize !== 'number' ||
    !Number.isFinite(value.fontSize) ||
    value.fontSize < TABLE_MODULE_LIMITS.fontSizeMin ||
    value.fontSize > TABLE_MODULE_LIMITS.fontSizeMax
  ) {
    return {
      ok: false,
      reason: `table config fontSize must be between ${TABLE_MODULE_LIMITS.fontSizeMin} and ${TABLE_MODULE_LIMITS.fontSizeMax}`
    }
  }
  return {
    ok: true,
    config: {
      table,
      showHeader: value.showHeader,
      striped: value.striped,
      borderColor,
      headerBackground,
      textColor,
      fontSize: value.fontSize
    }
  }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(TABLE_MODULE_DEFAULT_CONFIG)
  if (!isPlainJSONObject(config)) return config
  return { ...structuredClone(TABLE_MODULE_DEFAULT_CONFIG), ...config }
}

export function createTableModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseTableConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: TABLE_PLUGIN_ID,
    moduleType: TABLE_MODULE_TYPE,
    configVersion: TABLE_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createTableModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Table',
    defaultSize: TABLE_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createTableModuleInstance(config)
  })
}

export function resolveTableModule(value: unknown): ModuleResolution<TableModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== TABLE_PLUGIN_ID ||
    instance.value.moduleType !== TABLE_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== TABLE_MODULE_CONFIG_VERSION) {
    return { ok: false, reason: `unsupported table config version ${instance.value.configVersion}` }
  }
  const config = parseTableConfig(instance.value.config)
  if (!config.ok) return config
  return { ok: true, instance: { ...instance.value, config: config.config }, config: config.config }
}

const TABLE_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['table'],
    kind: 'json',
    label: 'Table data',
    i18nLabelKey: 'lowcodeModuleFieldTableData'
  },
  {
    path: ['showHeader'],
    kind: 'boolean',
    label: 'Show header',
    i18nLabelKey: 'lowcodeModuleFieldShowHeader'
  },
  {
    path: ['striped'],
    kind: 'boolean',
    label: 'Striped rows',
    i18nLabelKey: 'lowcodeModuleFieldStriped'
  },
  {
    path: ['borderColor'],
    kind: 'color',
    label: 'Border color',
    i18nLabelKey: 'lowcodeModuleFieldBorderColor'
  },
  {
    path: ['headerBackground'],
    kind: 'color',
    label: 'Header background',
    i18nLabelKey: 'lowcodeModuleFieldHeaderBackground'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldTextColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldFontSize',
    min: TABLE_MODULE_LIMITS.fontSizeMin,
    max: TABLE_MODULE_LIMITS.fontSizeMax,
    step: 1
  }
])

export const TABLE_MODULE_DEFINITION: ModuleDefinition<TableModuleConfigV1> = Object.freeze({
  pluginId: TABLE_PLUGIN_ID,
  moduleType: TABLE_MODULE_TYPE,
  name: 'Table',
  description: 'Structured, bounded table data with deterministic presentation.',
  i18nNameKey: 'lowcodeModuleTableName',
  i18nDescriptionKey: 'lowcodeModuleTableDescription',
  configVersion: TABLE_MODULE_CONFIG_VERSION,
  defaultSize: TABLE_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(TABLE_MODULE_DEFAULT_CONFIG),
  fields: TABLE_MODULE_FIELDS,
  createInstance: createTableModuleInstance,
  createFrameOverrides: createTableModuleFrameOverrides,
  resolve: resolveTableModule
})

export const TABLE_PLUGIN = Object.freeze({
  id: TABLE_PLUGIN_ID,
  name: 'OpenPencil Table',
  version: '1.0.0',
  modules: Object.freeze([TABLE_MODULE_DEFINITION])
})
