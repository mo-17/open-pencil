import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { drawModuleLabel } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  drawModulePreviewStripedRows,
  modulePreviewFrame,
  withModulePreviewRectClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  DATA_GRID_MODULE_TYPE,
  DATA_GRID_PLUGIN_ID,
  resolveDataGridModule
} from '#core/plugins/data-grid'

import {
  dataGridCellText,
  dataGridCanvasData,
  dataGridUnavailableText,
  dataGridHeaderText,
  dataGridSummaryText,
  visibleDataGridRows
} from './text'

export { visibleDataGridRows } from './text'

function drawDataGridCellText(
  renderer: SkiaRenderer,
  canvas: Canvas,
  host: SceneNode,
  text: string,
  bounds: Rect,
  color: string
): void {
  const inset = Math.min(8, Math.max(3, bounds.width * 0.05))
  if (bounds.width <= inset * 2 || bounds.height <= 0) return
  withModulePreviewRectClip(renderer, canvas, bounds, () => {
    drawModuleLabel(renderer, canvas, host, {
      text,
      x: bounds.x + inset,
      baseline: bounds.y + bounds.height * 0.66,
      maxWidth: bounds.width - inset * 2,
      color,
      locale: host.textLanguage ?? 'en'
    })
  })
}

/** Draw a bounded first-page summary. Sorting and filtering remain runtime-only and no I/O occurs. */
export function renderDataGridModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph?: SceneGraph
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveDataGridModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true

  const { width, height } = frame
  const { config, unavailable } = dataGridCanvasData(node, resolved.config, graph)
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
      config.data.columns.forEach((_, index) => {
        drawDataGridCellText(
          renderer,
          canvas,
          node,
          dataGridHeaderText(config, index),
          { x: left, y: 0, width: columnWidths[index], height: visible.rowHeight },
          config.textColor
        )
        left += columnWidths[index]
      })
    }
    visible.rows.forEach((row, rowIndex) => {
      let left = 0
      row.cells.forEach((cell, columnIndex) => {
        drawDataGridCellText(
          renderer,
          canvas,
          node,
          dataGridCellText(cell),
          {
            x: left,
            y: (visible.headerRows + rowIndex) * visible.rowHeight,
            width: columnWidths[columnIndex],
            height: visible.rowHeight
          },
          config.textColor
        )
        left += columnWidths[columnIndex]
      })
    })

    if (unavailable) {
      drawDataGridCellText(
        renderer,
        canvas,
        node,
        dataGridUnavailableText(node),
        {
          x: 0,
          y: visible.headerRows * visible.rowHeight,
          width,
          height: visible.rowHeight
        },
        config.textColor
      )
    }

    if (visible.footerHeight > 0 && font) {
      configureModulePreviewPaint(renderer, config.headerBackground)
      canvas.drawRect(renderer.ck.LTRBRect(0, bodyHeight, width, height), renderer.fillPaint)
      font.setSize(Math.max(8, Math.min(12, config.fontSize * 0.85)))
      drawDataGridCellText(
        renderer,
        canvas,
        node,
        dataGridSummaryText(config),
        { x: 0, y: bodyHeight, width, height: visible.footerHeight },
        config.accentColor
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
