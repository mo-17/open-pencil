import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { drawModuleLabel } from '#core/canvas/modules/label'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  PROGRESS_MODULE_TYPE,
  PROGRESS_PLUGIN_ID,
  resolveProgressModule
} from '#core/plugins/progress'

import { progressPreviewGeometry } from './geometry'

export function renderProgressModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveProgressModule, (frame) => {
    const { config, width, height } = frame
    const geometry = progressPreviewGeometry(width, height, config)
    const { inset, innerWidth, valueText, top, diameter, circleStroke, circleX, circleY } = geometry
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      withModulePreviewFont(renderer, config.fontSize, () => {
        const valueWidth = valueText ? (config.showLabel ? innerWidth * 0.45 : innerWidth) : 0
        if (config.showLabel)
          drawModuleLabel(renderer, canvas, node, {
            text: config.label,
            x: inset,
            baseline: 16 + config.fontSize,
            maxWidth: Math.max(0, innerWidth - valueWidth - (valueText ? 8 : 0)),
            color: config.textColor,
            locale: node.textLanguage ?? 'en'
          })
        if (valueText)
          drawModuleLabel(renderer, canvas, node, {
            text: valueText,
            x: inset + innerWidth - valueWidth,
            baseline: 16 + config.fontSize,
            maxWidth: valueWidth,
            color: config.textColor,
            locale: node.textLanguage ?? 'en'
          })
      })
      if (config.variant === 'linear') {
        const pill = (x: number, size: number, color: string) => {
          if (size <= 0 || geometry.linearHeight <= 0) return
          configureModulePreviewPaint(renderer, color)
          canvas.drawRRect(
            renderer.ck.RRectXY(
              renderer.ck.LTRBRect(x, top, x + size, top + geometry.linearHeight),
              geometry.linearHeight / 2,
              geometry.linearHeight / 2
            ),
            renderer.fillPaint
          )
        }
        pill(inset, innerWidth, config.trackColor)
        pill(inset + geometry.fillStart, geometry.fillWidth, config.accentColor)
      } else if (diameter > 0) {
        const radius = (diameter - circleStroke) / 2
        const bounds = renderer.ck.LTRBRect(
          circleX - radius,
          circleY - radius,
          circleX + radius,
          circleY + radius
        )
        const stroke = (color: string) => {
          configureModulePreviewPaint(renderer, color)
          renderer.fillPaint.setStyle(renderer.ck.PaintStyle.Stroke)
          renderer.fillPaint.setStrokeWidth(circleStroke)
          renderer.fillPaint.setStrokeCap(renderer.ck.StrokeCap.Butt)
        }
        try {
          stroke(config.trackColor)
          canvas.drawCircle(circleX, circleY, radius, renderer.fillPaint)
          stroke(config.accentColor)
          if (config.indeterminate || config.value > 0)
            canvas.drawArc(
              bounds,
              -90,
              config.indeterminate ? 90 : config.value * 3.6,
              false,
              renderer.fillPaint
            )
        } finally {
          renderer.fillPaint.setStyle(renderer.ck.PaintStyle.Fill)
        }
      }
    })
  })
}

export const PROGRESS_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: PROGRESS_PLUGIN_ID,
  moduleType: PROGRESS_MODULE_TYPE,
  render: renderProgressModulePreview
})
