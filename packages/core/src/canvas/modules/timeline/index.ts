import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import { drawTimelineText } from '#core/canvas/modules/timeline/paragraph'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  TIMELINE_PLUGIN_ID,
  TIMELINE_MODULE_TYPE,
  TIMELINE_LAYOUT,
  TIMELINE_MARK_PATHS,
  timelineColumns,
  resolveTimelineModule,
  type TimelineItemV1,
  type TimelineModuleConfig
} from '#core/plugins/timeline'

function drawMarker(
  renderer: SkiaRenderer,
  canvas: Canvas,
  config: TimelineModuleConfig,
  status: TimelineItemV1['status'],
  x: number,
  y: number
) {
  let color = config.accentColor
  if (status === 'completed') color = config.completedColor
  if (status === 'error') color = config.errorColor
  if (status === 'pending') color = config.lineColor
  const radius = config.markerSize / 2
  configureModulePreviewPaint(renderer, status === 'pending' ? config.backgroundColor : color)
  canvas.drawCircle(x, y, radius, renderer.fillPaint)
  configureControlPaint(renderer, color, 1, 2)
  canvas.drawCircle(x, y, Math.max(0, radius - 1), renderer.auxStroke)
  if (status === 'current') {
    configureModulePreviewPaint(renderer, config.backgroundColor)
    canvas.drawCircle(x, y, radius / 3, renderer.fillPaint)
  }
  if (status !== 'completed' && status !== 'error') return
  const path = renderer.ck.Path.MakeFromSVGString(TIMELINE_MARK_PATHS[status])
  if (!path) return
  canvas.save()
  try {
    canvas.translate(x - radius, y - radius)
    canvas.scale(config.markerSize / 16, config.markerSize / 16)
    configureControlPaint(renderer, '#FFFFFF', 1, 1.8)
    canvas.drawPath(path, renderer.auxStroke)
  } finally {
    canvas.restore()
    path.delete()
  }
}

function drawEvent(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  config: TimelineModuleConfig,
  item: TimelineItemV1,
  index: number,
  y: number
): number {
  const columns = timelineColumns(node.width, config.markerSize, config.layout)
  const endAligned = columns.alternate && index % 2 === 1
  const x = endAligned ? columns.startX : columns.endX
  let textY = y
  const texts = [
    { text: item.time, strong: false, secondary: true },
    { text: item.title, strong: true, secondary: false },
    { text: item.description, strong: false, secondary: true }
  ].filter((block) => block.text)
  for (const [blockIndex, block] of texts.entries()) {
    if (blockIndex) textY += TIMELINE_LAYOUT.textGap
    textY += drawTimelineText(renderer, canvas, node, {
      ...block,
      x,
      y: textY,
      width: columns.textWidth,
      fontSize: config.fontSize * (block.secondary ? TIMELINE_LAYOUT.secondaryScale : 1),
      color: config.textColor + (block.secondary ? 'BF' : 'FF'),
      endAligned
    })
  }
  const rowHeight = Math.max(
    config.markerSize,
    config.fontSize * TIMELINE_LAYOUT.lineHeight,
    textY - y
  )
  const centerY = y + Math.max(config.markerSize, config.fontSize * TIMELINE_LAYOUT.lineHeight) / 2
  if (index < config.items.length - 1) {
    configureControlPaint(renderer, config.lineColor, 1, config.lineWidth)
    canvas.drawLine(
      columns.markerX,
      centerY + config.markerSize / 2 + 4,
      columns.markerX,
      centerY + rowHeight + config.itemGap - config.markerSize / 2 - 4,
      renderer.auxStroke
    )
  }
  drawMarker(renderer, canvas, config, item.status, columns.markerX, centerY)
  return rowHeight + config.itemGap
}

export function renderTimelineModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveTimelineModule, (frame) => {
    const { config } = frame
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      let y = TIMELINE_LAYOUT.inset
      if (!config.items.length)
        drawTimelineText(renderer, canvas, node, {
          text: config.emptyText,
          x: TIMELINE_LAYOUT.inset,
          y,
          width: Math.max(0, frame.width - TIMELINE_LAYOUT.inset * 2),
          fontSize: config.fontSize,
          color: config.textColor + 'BF'
        })
      for (const [index, item] of config.items.entries()) {
        if (y >= frame.height) break
        y += drawEvent(renderer, canvas, node, config, item, index, y)
      }
    })
  })
}

export const TIMELINE_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TIMELINE_PLUGIN_ID,
  moduleType: TIMELINE_MODULE_TYPE,
  render: renderTimelineModulePreview
})
