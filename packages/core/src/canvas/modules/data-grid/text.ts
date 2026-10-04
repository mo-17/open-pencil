import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readModuleDataInitial } from '#core/canvas/module-data'
import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  resolveDataGridModule,
  resolveDataGridRows,
  type DataGridCellV1,
  type DataGridModuleConfigV1
} from '#core/plugins/data-grid'

interface VisibleDataGridRows {
  rows: DataGridModuleConfigV1['data']['rows']
  headerRows: number
  rowHeight: number
  footerHeight: number
}

export function visibleDataGridRows(
  config: DataGridModuleConfigV1,
  height: number
): VisibleDataGridRows {
  const rowHeight = Math.max(
    config.density === 'compact' ? 22 : 30,
    config.fontSize * (config.density === 'compact' ? 1.35 : 1.7)
  )
  const footerHeight = height >= rowHeight * 3 ? Math.max(20, rowHeight * 0.75) : 0
  const availableRows = Math.max(0, Math.floor(Math.max(0, height - footerHeight) / rowHeight))
  const headerRows = config.showHeader && availableRows > 0 ? 1 : 0
  return {
    rows: config.data.rows.slice(0, Math.max(0, availableRows - headerRows)),
    headerRows,
    rowHeight,
    footerHeight
  }
}

export function dataGridCellText(value: DataGridCellV1): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

export function dataGridHeaderText(config: DataGridModuleConfigV1, index: number): string {
  const column = config.data.columns[index]
  const sort = config.initialSort
  if (!sort || sort.columnId !== column.id) return column.label
  return column.label + (sort.direction === 'ascending' ? ' ↑' : ' ↓')
}

export function dataGridSummaryText(config: DataGridModuleConfigV1): string {
  return `${config.data.rows.length} rows · ${config.filters.length} filters · ${config.pageSize}/page`
}

/** Read only the bounded canvas summary, not every record in the runtime data source. */
export function dataGridTextNode(node: SceneNode, graph?: SceneGraph): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height <= 0) return null
  const resolved = resolveDataGridModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { config, unavailable } = dataGridCanvasData(node, resolved.config, graph)
  const visible = visibleDataGridRows(config, node.height)
  const labels = visible.headerRows
    ? config.data.columns.map((_, index) => dataGridHeaderText(config, index))
    : []
  for (const row of visible.rows) labels.push(...row.cells.map(dataGridCellText))
  if (unavailable) labels.push(dataGridUnavailableText(node))
  if (visible.footerHeight > 0) labels.push(dataGridSummaryText(config))
  return moduleLabelTextNode(
    node,
    labels.join('\n'),
    node.width,
    config.fontSize,
    node.textLanguage ?? 'en'
  )
}

/** Canvas reads authored initial rows only; present unresolved bindings stay unavailable. */
export function dataGridCanvasData(
  node: SceneNode,
  config: DataGridModuleConfigV1,
  graph?: SceneGraph
): { config: DataGridModuleConfigV1; unavailable: boolean } {
  const source = graph
    ? readModuleDataInitial(node, graph, 'rows')
    : { bound: Boolean(node.bindings && Object.hasOwn(node.bindings, 'rows')), value: undefined }
  if (!source.bound) return { config, unavailable: false }
  const parsed = resolveDataGridRows(source.value, config.data.columns)
  return {
    config: { ...config, data: { ...config.data, rows: parsed.rows } },
    unavailable: !parsed.ok
  }
}

export function dataGridUnavailableText(node: SceneNode): string {
  return node.textLanguage?.toLowerCase().startsWith('zh')
    ? '绑定的表格数据不可用。'
    : 'Bound data grid rows are unavailable.'
}
