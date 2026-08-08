import {
  isPlainJsonObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import {
  assertBoundedPluginConfigBytes,
  hasExactPluginKeys,
  mergePluginConfigWithDefaults,
  parseCanonicalPluginColor as canonicalColor
} from './parse-helpers'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const DATA_GRID_PLUGIN_ID = 'open-pencil.data-grid'
export const DATA_GRID_MODULE_TYPE = 'data-grid'
export const DATA_GRID_MODULE_CONFIG_VERSION = 1
export const DATA_GRID_MODULE_DEFAULT_SIZE = Object.freeze({ width: 800, height: 420 })
export const DATA_GRID_MODULE_LIMITS = Object.freeze({
  columns: 16,
  rows: 200,
  cells: 2_000,
  filters: 8,
  id: 64,
  label: 120,
  cellText: 2_000,
  totalText: 40_000,
  columnWidthMin: 64,
  columnWidthMax: 640,
  pageSizeMin: 10,
  pageSizeMax: 100,
  fontSizeMin: 8,
  fontSizeMax: 32,
  configBytes: 48 * 1024
})

export type DataGridColumnTypeV1 = 'text' | 'number' | 'date' | 'boolean'
export type DataGridColumnAlignV1 = 'start' | 'center' | 'end'
export type DataGridSortDirectionV1 = 'ascending' | 'descending'
export type DataGridFilterOperatorV1 = 'contains' | 'equals' | 'greater-than' | 'less-than'
export type DataGridSelectionModeV1 = 'none' | 'single' | 'multiple'
export type DataGridDensityV1 = 'compact' | 'comfortable'
export type DataGridCellV1 = string | number | boolean | null

export interface DataGridColumnV1 extends JsonObject {
  id: string
  label: string
  type: DataGridColumnTypeV1
  align: DataGridColumnAlignV1
  width: number
  sortable: boolean
  filterable: boolean
}

export interface DataGridRowV1 extends JsonObject {
  id: string
  cells: DataGridCellV1[]
}

export interface DataGridDataV1 extends JsonObject {
  columns: DataGridColumnV1[]
  rows: DataGridRowV1[]
}

export interface DataGridSortV1 extends JsonObject {
  columnId: string
  direction: DataGridSortDirectionV1
}

export interface DataGridFilterV1 extends JsonObject {
  columnId: string
  operator: DataGridFilterOperatorV1
  value: DataGridCellV1
}

export interface DataGridModuleConfigV1 extends JsonObject {
  data: DataGridDataV1
  initialSort: DataGridSortV1 | null
  filters: DataGridFilterV1[]
  pageSize: number
  selectionMode: DataGridSelectionModeV1
  density: DataGridDensityV1
  showHeader: boolean
  stickyHeader: boolean
  striped: boolean
  borderColor: string
  headerBackground: string
  textColor: string
  accentColor: string
  fontSize: number
}

const DEFAULT_COLUMNS: DataGridColumnV1[] = [
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    align: 'start',
    width: 240,
    sortable: true,
    filterable: true
  },
  {
    id: 'status',
    label: 'Status',
    type: 'text',
    align: 'start',
    width: 160,
    sortable: true,
    filterable: true
  },
  {
    id: 'score',
    label: 'Score',
    type: 'number',
    align: 'end',
    width: 120,
    sortable: true,
    filterable: false
  }
]
const DEFAULT_ROWS: DataGridRowV1[] = [
  { id: 'landing', cells: ['Landing page', 'Ready', 98] },
  { id: 'mobile', cells: ['Mobile app', 'Review', 84] },
  { id: 'system', cells: ['Design system', 'Draft', 72] }
]
const DEFAULT_FILTERS: DataGridFilterV1[] = []
DEFAULT_COLUMNS.forEach(Object.freeze)
DEFAULT_ROWS.forEach((row) => {
  Object.freeze(row.cells)
  Object.freeze(row)
})
Object.freeze(DEFAULT_COLUMNS)
Object.freeze(DEFAULT_ROWS)
Object.freeze(DEFAULT_FILTERS)

export const DATA_GRID_MODULE_DEFAULT_CONFIG: Readonly<DataGridModuleConfigV1> = Object.freeze({
  data: Object.freeze({ columns: DEFAULT_COLUMNS, rows: DEFAULT_ROWS }),
  initialSort: null,
  filters: DEFAULT_FILTERS,
  pageSize: 20,
  selectionMode: 'multiple',
  density: 'comfortable',
  showHeader: true,
  stickyHeader: true,
  striped: true,
  borderColor: '#D1D5DB',
  headerBackground: '#F3F4F6',
  textColor: '#111827',
  accentColor: '#2563EB',
  fontSize: 14
})

const CONFIG_KEYS = new Set([
  'data',
  'initialSort',
  'filters',
  'pageSize',
  'selectionMode',
  'density',
  'showHeader',
  'stickyHeader',
  'striped',
  'borderColor',
  'headerBackground',
  'textColor',
  'accentColor',
  'fontSize'
])
const DATA_KEYS = new Set(['columns', 'rows'])
const COLUMN_KEYS = new Set(['id', 'label', 'type', 'align', 'width', 'sortable', 'filterable'])
const ROW_KEYS = new Set(['id', 'cells'])
const SORT_KEYS = new Set(['columnId', 'direction'])
const FILTER_KEYS = new Set(['columnId', 'operator', 'value'])
const COLUMN_TYPES = new Set<DataGridColumnTypeV1>(['text', 'number', 'date', 'boolean'])
const COLUMN_ALIGNS = new Set<DataGridColumnAlignV1>(['start', 'center', 'end'])
const SORT_DIRECTIONS = new Set<DataGridSortDirectionV1>(['ascending', 'descending'])
const SELECTION_MODES = new Set<DataGridSelectionModeV1>(['none', 'single', 'multiple'])
const DENSITIES = new Set<DataGridDensityV1>(['compact', 'comfortable'])
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
type ParseResult = { ok: true; config: DataGridModuleConfigV1 } | { ok: false; reason: string }

function boundedText(value: unknown, path: string, maximum: number, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    (!allowEmpty && value.trim().length === 0)
  ) {
    throw new TypeError(
      `${path} must be a string of ${allowEmpty ? '0' : '1'} to ${maximum} characters`
    )
  }
  return value
}

function identifier(value: unknown, path: string): string {
  const parsed = boundedText(value, path, DATA_GRID_MODULE_LIMITS.id)
  if (!ID_PATTERN.test(parsed)) {
    throw new TypeError(`${path} must start with a letter and contain only letters, digits, _ or -`)
  }
  return parsed
}

function parseColumns(value: unknown): DataGridColumnV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > DATA_GRID_MODULE_LIMITS.columns) {
    throw new TypeError(
      `data grid columns must contain 1 to ${DATA_GRID_MODULE_LIMITS.columns} columns`
    )
  }
  const ids = new Set<string>()
  return Array.from(value, (entry, index) => {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`data grid columns[${index}] must be a column object`)
    }
    if (!isPlainJsonObject(entry) || !hasExactPluginKeys(entry, COLUMN_KEYS)) {
      throw new TypeError(
        `data grid columns[${index}] must contain exactly id, label, type, align, width, sortable, and filterable`
      )
    }
    const id = identifier(entry.id, `data grid columns[${index}].id`)
    if (ids.has(id)) throw new TypeError(`data grid column id ${id} must be unique`)
    ids.add(id)
    if (typeof entry.type !== 'string' || !COLUMN_TYPES.has(entry.type as never)) {
      throw new TypeError(`data grid columns[${index}].type is unsupported`)
    }
    if (typeof entry.align !== 'string' || !COLUMN_ALIGNS.has(entry.align as never)) {
      throw new TypeError(`data grid columns[${index}].align is unsupported`)
    }
    if (
      !Number.isSafeInteger(entry.width) ||
      (entry.width as number) < DATA_GRID_MODULE_LIMITS.columnWidthMin ||
      (entry.width as number) > DATA_GRID_MODULE_LIMITS.columnWidthMax
    ) {
      throw new TypeError(
        `data grid columns[${index}].width must be between ${DATA_GRID_MODULE_LIMITS.columnWidthMin} and ${DATA_GRID_MODULE_LIMITS.columnWidthMax}`
      )
    }
    if (typeof entry.sortable !== 'boolean' || typeof entry.filterable !== 'boolean') {
      throw new TypeError(`data grid columns[${index}] sortable and filterable must be booleans`)
    }
    return {
      id,
      label: boundedText(
        entry.label,
        `data grid columns[${index}].label`,
        DATA_GRID_MODULE_LIMITS.label
      ),
      type: entry.type as DataGridColumnTypeV1,
      align: entry.align as DataGridColumnAlignV1,
      width: entry.width as number,
      sortable: entry.sortable,
      filterable: entry.filterable
    }
  })
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseCell(value: unknown, column: DataGridColumnV1, path: string): DataGridCellV1 {
  if (value === null) return null
  if (column.type === 'text')
    return boundedText(value, path, DATA_GRID_MODULE_LIMITS.cellText, true)
  if (column.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite number or null`)
    }
    return value
  }
  if (column.type === 'boolean') {
    if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean or null`)
    return value
  }
  if (typeof value !== 'string' || !validDate(value)) {
    throw new TypeError(`${path} must be a canonical YYYY-MM-DD date or null`)
  }
  return value
}

function parseRows(value: unknown, columns: DataGridColumnV1[]): DataGridRowV1[] {
  if (!Array.isArray(value) || value.length > DATA_GRID_MODULE_LIMITS.rows) {
    throw new TypeError(`data grid rows must contain at most ${DATA_GRID_MODULE_LIMITS.rows} rows`)
  }
  if (value.length * columns.length > DATA_GRID_MODULE_LIMITS.cells) {
    throw new TypeError(
      `data grid data must contain at most ${DATA_GRID_MODULE_LIMITS.cells} cells`
    )
  }
  const ids = new Set<string>()
  let totalText = columns.reduce((total, column) => total + column.label.length, 0)
  const rows = Array.from(value, (entry, rowIndex) => {
    if (!Object.hasOwn(value, rowIndex)) {
      throw new TypeError(`data grid rows[${rowIndex}] must be a row object`)
    }
    if (!isPlainJsonObject(entry) || !hasExactPluginKeys(entry, ROW_KEYS)) {
      throw new TypeError(`data grid rows[${rowIndex}] must contain exactly id and cells`)
    }
    const id = identifier(entry.id, `data grid rows[${rowIndex}].id`)
    if (ids.has(id)) throw new TypeError(`data grid row id ${id} must be unique`)
    ids.add(id)
    if (!Array.isArray(entry.cells) || entry.cells.length !== columns.length) {
      throw new TypeError(
        `data grid rows[${rowIndex}].cells must contain exactly ${columns.length} cells`
      )
    }
    const cells = Array.from(entry.cells, (cell, columnIndex) => {
      if (!Object.hasOwn(entry.cells as unknown[], columnIndex)) {
        throw new TypeError(`data grid rows[${rowIndex}].cells[${columnIndex}] must be present`)
      }
      const parsed = parseCell(
        cell,
        columns[columnIndex],
        `data grid rows[${rowIndex}].cells[${columnIndex}]`
      )
      if (typeof parsed === 'string') totalText += parsed.length
      return parsed
    })
    return { id, cells }
  })
  if (totalText > DATA_GRID_MODULE_LIMITS.totalText) {
    throw new TypeError(
      `data grid text must not exceed ${DATA_GRID_MODULE_LIMITS.totalText} characters`
    )
  }
  return rows
}

function parseData(value: unknown): DataGridDataV1 {
  if (!isPlainJsonObject(value) || !hasExactPluginKeys(value, DATA_KEYS)) {
    throw new TypeError('data grid data must contain exactly columns and rows')
  }
  const columns = parseColumns(value.columns)
  return { columns, rows: parseRows(value.rows, columns) }
}

function columnById(columns: DataGridColumnV1[], value: unknown, path: string): DataGridColumnV1 {
  const id = identifier(value, path)
  const column = columns.find((entry) => entry.id === id)
  if (!column) throw new TypeError(`${path} must reference an existing column`)
  return column
}

function parseInitialSort(value: unknown, columns: DataGridColumnV1[]): DataGridSortV1 | null {
  if (value === null) return null
  if (!isPlainJsonObject(value) || !hasExactPluginKeys(value, SORT_KEYS)) {
    throw new TypeError(
      'data grid initialSort must be null or contain exactly columnId and direction'
    )
  }
  const column = columnById(columns, value.columnId, 'data grid initialSort.columnId')
  if (!column.sortable) throw new TypeError('data grid initialSort column must be sortable')
  if (typeof value.direction !== 'string' || !SORT_DIRECTIONS.has(value.direction as never)) {
    throw new TypeError('data grid initialSort.direction must be ascending or descending')
  }
  return { columnId: column.id, direction: value.direction as DataGridSortDirectionV1 }
}

function allowedOperators(type: DataGridColumnTypeV1): ReadonlySet<DataGridFilterOperatorV1> {
  if (type === 'text') return new Set(['contains', 'equals'])
  if (type === 'boolean') return new Set(['equals'])
  return new Set(['equals', 'greater-than', 'less-than'])
}

function parseFilters(value: unknown, columns: DataGridColumnV1[]): DataGridFilterV1[] {
  if (!Array.isArray(value) || value.length > DATA_GRID_MODULE_LIMITS.filters) {
    throw new TypeError(
      `data grid filters must contain at most ${DATA_GRID_MODULE_LIMITS.filters} filters`
    )
  }
  const seen = new Set<string>()
  return Array.from(value, (entry, index) => {
    if (!Object.hasOwn(value, index)) {
      throw new TypeError(`data grid filters[${index}] must be a filter object`)
    }
    if (!isPlainJsonObject(entry) || !hasExactPluginKeys(entry, FILTER_KEYS)) {
      throw new TypeError(
        `data grid filters[${index}] must contain exactly columnId, operator, and value`
      )
    }
    const column = columnById(columns, entry.columnId, `data grid filters[${index}].columnId`)
    if (!column.filterable)
      throw new TypeError(`data grid filters[${index}] column must be filterable`)
    if (seen.has(column.id))
      throw new TypeError('data grid filters must use each column at most once')
    seen.add(column.id)
    if (
      typeof entry.operator !== 'string' ||
      !allowedOperators(column.type).has(entry.operator as DataGridFilterOperatorV1)
    ) {
      throw new TypeError(`data grid filters[${index}].operator is invalid for ${column.type}`)
    }
    const filterValue = parseCell(entry.value, column, `data grid filters[${index}].value`)
    if (filterValue === null)
      throw new TypeError(`data grid filters[${index}].value must not be null`)
    return {
      columnId: column.id,
      operator: entry.operator as DataGridFilterOperatorV1,
      value: filterValue
    }
  })
}

function parseDataGridConfig(value: unknown): ParseResult {
  if (!isPlainJsonObject(value) || !hasExactPluginKeys(value, CONFIG_KEYS)) {
    return {
      ok: false,
      reason:
        'data grid config must contain exactly data, initialSort, filters, pageSize, selectionMode, density, showHeader, stickyHeader, striped, borderColor, headerBackground, textColor, accentColor, and fontSize'
    }
  }
  try {
    const data = parseData(value.data)
    if (
      !Number.isSafeInteger(value.pageSize) ||
      (value.pageSize as number) < DATA_GRID_MODULE_LIMITS.pageSizeMin ||
      (value.pageSize as number) > DATA_GRID_MODULE_LIMITS.pageSizeMax
    ) {
      throw new TypeError(
        `data grid pageSize must be between ${DATA_GRID_MODULE_LIMITS.pageSizeMin} and ${DATA_GRID_MODULE_LIMITS.pageSizeMax}`
      )
    }
    if (
      typeof value.selectionMode !== 'string' ||
      !SELECTION_MODES.has(value.selectionMode as never)
    ) {
      throw new TypeError('data grid selectionMode must be none, single, or multiple')
    }
    if (typeof value.density !== 'string' || !DENSITIES.has(value.density as never)) {
      throw new TypeError('data grid density must be compact or comfortable')
    }
    for (const key of ['showHeader', 'stickyHeader', 'striped'] as const) {
      if (typeof value[key] !== 'boolean') throw new TypeError(`data grid ${key} must be a boolean`)
    }
    if (
      typeof value.fontSize !== 'number' ||
      !Number.isFinite(value.fontSize) ||
      value.fontSize < DATA_GRID_MODULE_LIMITS.fontSizeMin ||
      value.fontSize > DATA_GRID_MODULE_LIMITS.fontSizeMax
    ) {
      throw new TypeError(
        `data grid fontSize must be between ${DATA_GRID_MODULE_LIMITS.fontSizeMin} and ${DATA_GRID_MODULE_LIMITS.fontSizeMax}`
      )
    }
    const config: DataGridModuleConfigV1 = {
      data,
      initialSort: parseInitialSort(value.initialSort, data.columns),
      filters: parseFilters(value.filters, data.columns),
      pageSize: value.pageSize as number,
      selectionMode: value.selectionMode as DataGridSelectionModeV1,
      density: value.density as DataGridDensityV1,
      showHeader: value.showHeader as boolean,
      stickyHeader: value.stickyHeader as boolean,
      striped: value.striped as boolean,
      borderColor: canonicalColor(value.borderColor, 'data grid borderColor'),
      headerBackground: canonicalColor(value.headerBackground, 'data grid headerBackground'),
      textColor: canonicalColor(value.textColor, 'data grid textColor'),
      accentColor: canonicalColor(value.accentColor, 'data grid accentColor'),
      fontSize: value.fontSize
    }
    assertBoundedPluginConfigBytes(config, 'data grid config', DATA_GRID_MODULE_LIMITS.configBytes)
    return { ok: true, config }
  } catch (cause) {
    return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) }
  }
}

export function createDataGridModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseDataGridConfig(
    mergePluginConfigWithDefaults(DATA_GRID_MODULE_DEFAULT_CONFIG, config)
  )
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: DATA_GRID_PLUGIN_ID,
    moduleType: DATA_GRID_MODULE_TYPE,
    configVersion: DATA_GRID_MODULE_CONFIG_VERSION,
    config: parsed.config
  }
}

export function createDataGridModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Advanced Data Grid',
    defaultSize: DATA_GRID_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createDataGridModuleInstance(config)
  })
}

export function resolveDataGridModule(value: unknown): ModuleResolution<DataGridModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== DATA_GRID_PLUGIN_ID ||
    instance.value.moduleType !== DATA_GRID_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== DATA_GRID_MODULE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `unsupported data grid config version ${instance.value.configVersion}`
    }
  }
  const parsed = parseDataGridConfig(instance.value.config)
  if (!parsed.ok) return parsed
  return {
    ok: true,
    instance: { ...instance.value, config: parsed.config },
    config: parsed.config
  }
}

const DATA_GRID_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  { path: ['data'], kind: 'json', label: 'Grid data' },
  { path: ['initialSort'], kind: 'json', label: 'Initial sort' },
  { path: ['filters'], kind: 'json', label: 'Initial filters' },
  {
    path: ['pageSize'],
    kind: 'number',
    label: 'Page size',
    min: DATA_GRID_MODULE_LIMITS.pageSizeMin,
    max: DATA_GRID_MODULE_LIMITS.pageSizeMax,
    step: 1
  },
  {
    path: ['selectionMode'],
    kind: 'select',
    label: 'Selection mode',
    options: ['none', 'single', 'multiple']
  },
  {
    path: ['density'],
    kind: 'select',
    label: 'Density',
    options: ['compact', 'comfortable']
  },
  { path: ['showHeader'], kind: 'boolean', label: 'Show header' },
  { path: ['stickyHeader'], kind: 'boolean', label: 'Sticky header' },
  { path: ['striped'], kind: 'boolean', label: 'Striped rows' },
  { path: ['borderColor'], kind: 'color', label: 'Border color' },
  { path: ['headerBackground'], kind: 'color', label: 'Header background' },
  { path: ['textColor'], kind: 'color', label: 'Text color' },
  { path: ['accentColor'], kind: 'color', label: 'Accent color' },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    min: DATA_GRID_MODULE_LIMITS.fontSizeMin,
    max: DATA_GRID_MODULE_LIMITS.fontSizeMax,
    step: 1
  }
])

export const DATA_GRID_MODULE_DEFINITION: ModuleDefinition<DataGridModuleConfigV1> = Object.freeze({
  pluginId: DATA_GRID_PLUGIN_ID,
  moduleType: DATA_GRID_MODULE_TYPE,
  name: 'Advanced Data Grid',
  description: 'A bounded typed data grid with sorting, filtering, pagination, and selection.',
  configVersion: DATA_GRID_MODULE_CONFIG_VERSION,
  defaultSize: DATA_GRID_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(DATA_GRID_MODULE_DEFAULT_CONFIG),
  fields: DATA_GRID_MODULE_FIELDS,
  createInstance: createDataGridModuleInstance,
  createFrameOverrides: createDataGridModuleFrameOverrides,
  resolve: resolveDataGridModule
})

export const DATA_GRID_PLUGIN = Object.freeze({
  id: DATA_GRID_PLUGIN_ID,
  name: 'OpenPencil Advanced Data Grid',
  version: '1.0.0',
  modules: Object.freeze([DATA_GRID_MODULE_DEFINITION])
})
