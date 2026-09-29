import type { SceneNode } from '@open-pencil/scene-graph'

import {
  resolveDataGridModule,
  type DataGridCellV1,
  type DataGridModuleConfigV1
} from '#core/plugins/data-grid'

import { moduleLabelTextNode } from '#core/canvas/modules/label'

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
export function dataGridTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME' || node.width <= 0 || node.height <= 0) return null
  const resolved = resolveDataGridModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const config = resolved.config
  const visible = visibleDataGridRows(config, node.height)
  const labels = visible.headerRows
    ? config.data.columns.map((_, index) => dataGridHeaderText(config, index))
    : []
  for (const row of visible.rows) labels.push(...row.cells.map(dataGridCellText))
  if (visible.footerHeight > 0) labels.push(dataGridSummaryText(config))
  return moduleLabelTextNode(
    node,
    labels.join('\n'),
    node.width,
    config.fontSize,
    node.textLanguage ?? 'en'
  )
}
