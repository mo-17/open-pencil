import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  resolveDataGridModule,
  type DataGridCellV1,
  type DataGridModuleConfigV1
} from '#core/plugins/data-grid'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  drawModulePreviewStripedRows,
  modulePreviewFrame
} from './preview'
import type { ModuleCanvasAdapter } from './types'

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

function cellText(value: DataGridCellV1): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

function sortMarker(config: DataGridModuleConfigV1, columnId: string): string {
  const sort = config.initialSort
  if (!sort || sort.columnId !== columnId) return ''
  return sort.direction === 'ascending' ? ' ↑' : ' ↓'
}

/** Draw a bounded first-page summary. Sorting and filtering remain runtime-only and no I/O occurs. */
export function renderDataGridModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveDataGridModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true

  const { width, height } = frame
  const config = resolved.config
  const visible = visibleDataGridRows(config, height)
  const bodyHeight = Math.max(0, height - visible.footerHeight)
  const totalColumnWidth = config.data.columns.reduce((total, column) => total + column.width, 0)
  const scale = totalColumnWidth > 0 ? width / totalColumnWidth : 1
  const columnWidths = config.data.columns.map((column) => column.width * scale)
  const font = renderer.labelFont
  const previousFontSize = font?.getSize()

  canvas.save()
  try {
    font?.setSize(config.fontSize)
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#FFFFFF')
    canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, height), renderer.fillPaint)

    if (visible.headerRows === 1) {
      configureModulePreviewPaint(renderer, config.headerBackground)
      canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, visible.rowHeight), renderer.fillPaint)
    }
    if (config.striped) {
      drawModulePreviewStripedRows(
        renderer,
        canvas,
        visible.rows.length,
        visible.headerRows,
        visible.rowHeight,
        width,
        bodyHeight
      )
    }

    configureModulePreviewPaint(renderer, config.borderColor)
    let columnLeft = 0
    for (let index = 0; index < columnWidths.length - 1; index += 1) {
      columnLeft += columnWidths[index]
      canvas.drawRect(
        renderer.ck.LTRBRect(columnLeft, 0, columnLeft + 1, bodyHeight),
        renderer.fillPaint
      )
    }
    const renderedRows = visible.headerRows + visible.rows.length
    for (let row = 1; row <= renderedRows; row += 1) {
      const y = Math.min(bodyHeight, row * visible.rowHeight)
      canvas.drawRect(renderer.ck.LTRBRect(0, y, width, y + 1), renderer.fillPaint)
    }

    if (visible.headerRows === 1) {
      let left = 0
      config.data.columns.forEach((column, index) => {
        drawModulePreviewCellText(
          renderer,
          canvas,
          `${column.label}${sortMarker(config, column.id)}`,
          left,
          0,
          columnWidths[index],
          visible.rowHeight,
          config.textColor,
          { horizontalInsetRatio: 0.05, baselineRatio: 0.66 }
        )
        left += columnWidths[index]
      })
    }
    visible.rows.forEach((row, rowIndex) => {
      let left = 0
      row.cells.forEach((cell, columnIndex) => {
        drawModulePreviewCellText(
          renderer,
          canvas,
          cellText(cell),
          left,
          (visible.headerRows + rowIndex) * visible.rowHeight,
          columnWidths[columnIndex],
          visible.rowHeight,
          config.textColor,
          { horizontalInsetRatio: 0.05, baselineRatio: 0.66 }
        )
        left += columnWidths[columnIndex]
      })
    })

    if (visible.footerHeight > 0 && font) {
      configureModulePreviewPaint(renderer, config.headerBackground)
      canvas.drawRect(renderer.ck.LTRBRect(0, bodyHeight, width, height), renderer.fillPaint)
      font.setSize(Math.max(8, Math.min(12, config.fontSize * 0.85)))
      const summary = `${config.data.rows.length} rows · ${config.filters.length} filters · ${config.pageSize}/page`
      drawModulePreviewCellText(
        renderer,
        canvas,
        summary,
        0,
        bodyHeight,
        width,
        visible.footerHeight,
        config.accentColor,
        { horizontalInsetRatio: 0.05, baselineRatio: 0.66 }
      )
    }
  } finally {
    try {
      canvas.restore()
    } finally {
      if (font && previousFontSize !== undefined) font.setSize(previousFontSize)
    }
  }
  return true
}

export const DATA_GRID_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: DATA_GRID_PLUGIN_ID,
  moduleType: DATA_GRID_MODULE_TYPE,
  render: renderDataGridModulePreview
})
