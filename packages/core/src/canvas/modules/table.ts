import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  TABLE_MODULE_TYPE,
  TABLE_PLUGIN_ID,
  resolveTableModule,
  type TableModuleConfigV1
} from '#core/plugins/table'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  drawModulePreviewStripedRows,
  modulePreviewFrame
} from './preview'
import type { ModuleCanvasAdapter } from './types'

interface VisibleTableRows {
  rows: readonly string[][]
  headerRows: number
  rowHeight: number
}

export function visibleTableRows(config: TableModuleConfigV1, height: number): VisibleTableRows {
  const rowHeight = Math.max(22, config.fontSize * 1.4)
  const availableRows = Math.max(0, Math.floor(Math.max(0, height) / rowHeight))
  const headerRows = config.showHeader && availableRows > 0 ? 1 : 0
  return {
    rows: config.table.rows.slice(0, Math.max(0, availableRows - headerRows)),
    headerRows,
    rowHeight
  }
}

/** Draw a bounded table grid using only already-validated inline data. */
export function renderTableModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveTableModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true
  const { width, height } = frame
  const columns = resolved.config.table.columns
  const columnWidth = width / columns.length
  const visible = visibleTableRows(resolved.config, height)
  const renderedRows = visible.headerRows + visible.rows.length
  if (renderedRows === 0) return true
  const font = renderer.labelFont
  const previousFontSize = font?.getSize()

  canvas.save()
  try {
    font?.setSize(resolved.config.fontSize)
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    if (visible.headerRows === 1) {
      configureModulePreviewPaint(renderer, resolved.config.headerBackground)
      canvas.drawRect(renderer.ck.LTRBRect(0, 0, width, visible.rowHeight), renderer.fillPaint)
    }
    if (resolved.config.striped) {
      drawModulePreviewStripedRows(
        renderer,
        canvas,
        visible.rows.length,
        visible.headerRows,
        visible.rowHeight,
        width,
        height
      )
    }

    configureModulePreviewPaint(renderer, resolved.config.borderColor)
    for (let column = 1; column < columns.length; column += 1) {
      const x = column * columnWidth
      canvas.drawRect(renderer.ck.LTRBRect(x, 0, x + 1, height), renderer.fillPaint)
    }
    for (let row = 1; row <= renderedRows; row += 1) {
      const y = Math.min(height, row * visible.rowHeight)
      canvas.drawRect(renderer.ck.LTRBRect(0, y, width, y + 1), renderer.fillPaint)
    }

    if (visible.headerRows === 1) {
      columns.forEach((value, column) => {
        drawModulePreviewCellText(
          renderer,
          canvas,
          value,
          column * columnWidth,
          0,
          columnWidth,
          visible.rowHeight,
          resolved.config.textColor,
          { horizontalInsetRatio: 0.06, baselineRatio: 0.68 }
        )
      })
    }
    visible.rows.forEach((row, rowIndex) => {
      const top = (visible.headerRows + rowIndex) * visible.rowHeight
      row.forEach((value, column) => {
        drawModulePreviewCellText(
          renderer,
          canvas,
          value,
          column * columnWidth,
          top,
          columnWidth,
          visible.rowHeight,
          resolved.config.textColor,
          { horizontalInsetRatio: 0.06, baselineRatio: 0.68 }
        )
      })
    })
  } finally {
    try {
      canvas.restore()
    } finally {
      if (font && previousFontSize !== undefined) font.setSize(previousFontSize)
    }
  }
  return true
}

export const TABLE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TABLE_PLUGIN_ID,
  moduleType: TABLE_MODULE_TYPE,
  render: renderTableModulePreview
})
