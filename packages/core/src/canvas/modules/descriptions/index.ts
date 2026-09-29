import type { Canvas, Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import * as descriptions from '#core/plugins/descriptions'

import { descriptionsParagraph } from './paragraph'

interface Cell {
  label?: Paragraph
  value?: Paragraph
  labelHeight: number
  height: number
}
function paintCell(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: descriptions.DescriptionsModuleConfigV1,
  cell: Cell,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const metrics = descriptions.descriptionsCellMetrics(width, config)
  const horizontal = config.layout === 'horizontal'
  const labelHeight = horizontal ? height : cell.labelHeight + metrics.padding * 2
  if (config.bordered) {
    configureModulePreviewPaint(renderer, config.labelBackgroundColor)
    canvas.drawRect(
      renderer.ck.LTRBRect(left, top, left + metrics.labelWidth, top + labelHeight),
      renderer.fillPaint
    )
  }
  if (cell.label) canvas.drawParagraph(cell.label, left + metrics.padding, top + metrics.padding)
  if (cell.value)
    canvas.drawParagraph(
      cell.value,
      left + (horizontal ? metrics.labelWidth : 0) + metrics.padding,
      top + (horizontal ? 0 : labelHeight) + metrics.padding
    )
  if (config.bordered) {
    configureModulePreviewPaint(renderer, config.borderColor)
    for (const [x, y, w, h] of [
      [left, top, width, 1],
      [left, top, 1, height],
      [left + width - 1, top, 1, height],
      [left, top + height - 1, width, 1],
      horizontal ? [left + metrics.labelWidth, top, 1, height] : [left, top + labelHeight, width, 1]
    ]) {
      canvas.drawRect(renderer.ck.LTRBRect(x, y, x + w, y + h), renderer.fillPaint)
    }
  }
}
export function renderDescriptionsModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, descriptions.resolveDescriptionsModule, (frame) => {
    const { config, width } = frame
    const columns = descriptions.descriptionsColumns(width, config.columns),
      cellWidth = width / columns
    const metrics = descriptions.descriptionsCellMetrics(cellWidth, config)
    const cells: Cell[] = []
    try {
      for (const item of config.items) {
        const cell: Cell = { labelHeight: 0, height: 0 }
        cells.push(cell)
        cell.label = descriptionsParagraph(
          renderer,
          node,
          item.label,
          metrics.labelTextWidth,
          config.fontSize,
          config.labelColor
        )
        cell.value = descriptionsParagraph(
          renderer,
          node,
          item.value,
          metrics.valueTextWidth,
          config.fontSize,
          config.textColor
        )
        cell.labelHeight =
          cell.label?.getHeight() ?? config.fontSize * descriptions.DESCRIPTIONS_LAYOUT.lineHeight
        const valueHeight =
          cell.value?.getHeight() ?? config.fontSize * descriptions.DESCRIPTIONS_LAYOUT.lineHeight
        cell.height =
          config.layout === 'horizontal'
            ? Math.max(cell.labelHeight, valueHeight) + metrics.padding * 2
            : cell.labelHeight + valueHeight + metrics.padding * 4
      }
      withModulePreviewSurface(
        renderer,
        canvas,
        {
          ...frame,
          node: { ...node, cornerRadius: config.borderRadius, independentCorners: false }
        },
        config.backgroundColor,
        () => {
          let top = 0
          for (let start = 0; start < cells.length; start += columns) {
            const row = cells.slice(start, start + columns),
              height = Math.max(...row.map((cell) => cell.height))
            for (const [column, cell] of row.entries()) {
              paintCell(renderer, canvas, config, cell, column * cellWidth, top, cellWidth, height)
            }
            top += height
          }
        }
      )
    } finally {
      for (const cell of cells) {
        cell.label?.delete()
        cell.value?.delete()
      }
    }
  })
}
export const DESCRIPTIONS_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: descriptions.DESCRIPTIONS_PLUGIN_ID,
  moduleType: descriptions.DESCRIPTIONS_MODULE_TYPE,
  render: renderDescriptionsModulePreview
})
