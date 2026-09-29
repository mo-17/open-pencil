import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { drawModuleLabel } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  withModulePreviewRectClip,
  drawModulePreviewStripedRows,
  modulePreviewFrame
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { TABLE_MODULE_TYPE, TABLE_PLUGIN_ID, resolveTableModule } from '#core/plugins/table'

import { visibleTableRows } from './text'

export { visibleTableRows } from './text'

function drawCell(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  value: string,
  left: number,
  top: number,
  width: number,
  height: number,
  color: string
): void {
  const inset = Math.min(8, Math.max(3, width * 0.06))
  withModulePreviewRectClip(renderer, canvas, { x: left, y: top, width, height }, () => {
    drawModuleLabel(renderer, canvas, node, {
      text: value,
      x: left + inset,
      baseline: top + height * 0.68,
      maxWidth: Math.max(0, width - inset * 2),
      color,
      locale: node.textLanguage ?? 'en'
    })
  })
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
        drawCell(
          renderer,
          canvas,
          node,
          value,
          column * columnWidth,
          0,
          columnWidth,
          visible.rowHeight,
          resolved.config.textColor
        )
      })
    }
    visible.rows.forEach((row, rowIndex) => {
      const top = (visible.headerRows + rowIndex) * visible.rowHeight
      row.forEach((value, column) => {
        drawCell(
          renderer,
          canvas,
          node,
          value,
          column * columnWidth,
          top,
          columnWidth,
          visible.rowHeight,
          resolved.config.textColor
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
