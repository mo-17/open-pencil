import type { Canvas } from 'canvaskit-wasm'

import { configureControlPaint } from '#core/canvas/control-content'
import { configureModulePreviewPaint } from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { ChartLayout } from '#core/plugins/chart'

export function drawChartGeometry(
  renderer: SkiaRenderer,
  canvas: Canvas,
  model: ChartLayout
): void {
  try {
    for (const shape of model.paths) {
      const path = renderer.ck.Path.MakeFromSVGString(shape.d)
      if (!path) continue
      try {
        if (shape.fill !== 'none') {
          configureModulePreviewPaint(renderer, shape.fill)
          renderer.fillPaint.setAlphaf(shape.opacity)
          canvas.drawPath(path, renderer.fillPaint)
        }
        if (shape.stroke !== 'none' && shape.strokeWidth > 0) {
          configureControlPaint(renderer, shape.stroke, shape.opacity, shape.strokeWidth)
          canvas.drawPath(path, renderer.auxStroke)
        }
      } finally {
        path.delete()
      }
    }
    for (const shape of model.rects) {
      configureModulePreviewPaint(renderer, shape.fill)
      renderer.fillPaint.setAlphaf(shape.opacity)
      const bounds = renderer.ck.LTRBRect(
        shape.x,
        shape.y,
        shape.x + shape.width,
        shape.y + shape.height
      )
      if (shape.radius)
        canvas.drawRRect(
          renderer.ck.RRectXY(bounds, shape.radius, shape.radius),
          renderer.fillPaint
        )
      else canvas.drawRect(bounds, renderer.fillPaint)
    }
    for (const shape of model.circles) {
      if (shape.fill !== 'none') {
        configureModulePreviewPaint(renderer, shape.fill)
        renderer.fillPaint.setAlphaf(shape.opacity)
        canvas.drawCircle(shape.x, shape.y, shape.radius, renderer.fillPaint)
      }
      if (shape.stroke !== 'none' && shape.strokeWidth > 0) {
        configureControlPaint(renderer, shape.stroke, shape.opacity, shape.strokeWidth)
        canvas.drawCircle(shape.x, shape.y, shape.radius, renderer.auxStroke)
      }
    }
  } finally {
    renderer.fillPaint.setAlphaf(1)
  }
}
