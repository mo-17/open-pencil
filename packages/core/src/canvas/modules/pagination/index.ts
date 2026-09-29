import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import * as pagination from '#core/plugins/pagination'

import { drawPaginationText } from './draw-text'

function drawArrow(
  renderer: SkiaRenderer,
  canvas: Canvas,
  cell: pagination.PaginationCell,
  top: number,
  size: number
) {
  const forward = cell.kind === 'next' || cell.kind === 'last'
  const path = renderer.ck.Path.MakeFromSVGString('M15 5L8 12L15 19L17 17L12 12L17 7Z')
  if (!path) return
  canvas.save()
  try {
    canvas.translate(cell.x + cell.width / 2, top + size / 2)
    canvas.scale(forward ? -0.75 : 0.75, 0.75)
    canvas.translate(-12, -12)
    canvas.drawPath(path, renderer.fillPaint)
    if (cell.kind === 'first' || cell.kind === 'last')
      canvas.drawRect(renderer.ck.LTRBRect(5, 5, 7, 19), renderer.fillPaint)
  } finally {
    canvas.restore()
    path.delete()
  }
}
function drawCell(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: pagination.PaginationModuleConfigV1,
  layout: pagination.PaginationLayout,
  cell: pagination.PaginationCell
) {
  const top = Math.max(0, (node.height - layout.buttonSize) / 2)
  const muted = config.disabled || (!cell.active && cell.disabled && cell.kind !== 'summary')
  const opacity = muted ? 0.45 : 1
  const button = cell.kind !== 'ellipsis' && cell.kind !== 'summary'
  if (button) {
    const radius = Math.min(config.borderRadius, layout.buttonSize / 2)
    configureModulePreviewPaint(renderer, cell.active ? config.accentColor : config.borderColor)
    renderer.fillPaint.setAlphaf(opacity)
    canvas.drawRRect(
      renderer.ck.RRectXY(
        renderer.ck.LTRBRect(cell.x, top, cell.x + cell.width, top + layout.buttonSize),
        radius,
        radius
      ),
      renderer.fillPaint
    )
    if (!cell.active && cell.width > 2 && layout.buttonSize > 2) {
      configureModulePreviewPaint(renderer, config.backgroundColor)
      canvas.drawRRect(
        renderer.ck.RRectXY(
          renderer.ck.LTRBRect(
            cell.x + 1,
            top + 1,
            cell.x + cell.width - 1,
            top + layout.buttonSize - 1
          ),
          Math.max(0, radius - 1),
          Math.max(0, radius - 1)
        ),
        renderer.fillPaint
      )
    }
  }
  const color = cell.active ? '#FFFFFF' : config.textColor
  if (cell.text)
    drawPaginationText(renderer, canvas, node, cell, {
      top,
      height: layout.buttonSize,
      fontSize: layout.fontSize,
      color,
      opacity
    })
  else {
    configureModulePreviewPaint(renderer, color)
    renderer.fillPaint.setAlphaf(opacity)
    drawArrow(renderer, canvas, cell, top, layout.buttonSize)
  }
}
export function renderPaginationModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, pagination.resolvePaginationModule, (frame) => {
    const layout = pagination.paginationLayout(frame.width, frame.config)
    withModulePreviewSurface(renderer, canvas, frame, frame.config.backgroundColor, () => {
      for (const cell of layout.cells) drawCell(renderer, canvas, node, frame.config, layout, cell)
    })
  })
}
export const PAGINATION_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: pagination.PAGINATION_PLUGIN_ID,
  moduleType: pagination.PAGINATION_MODULE_TYPE,
  render: renderPaginationModulePreview
})
