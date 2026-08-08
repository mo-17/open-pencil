import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText, measureLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { CHART_MODULE_TYPE, CHART_PLUGIN_ID, resolveChartModule } from '#core/plugins/chart'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

/** Draw a deterministic, dependency-free editor preview for a trusted chart module. */
export function renderChartModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveChartModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true
  const { width, height } = frame

  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.08))
  const chartWidth = Math.max(0, width - inset * 2)
  const labelFont = renderer.labelFont
  const labelBand = labelFont && height >= 48 ? Math.min(18, height * 0.16) : 0
  const chartHeight = Math.max(0, height - inset * 2 - labelBand)
  const values = resolved.config.values
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const span = Math.max(1, max - min)
  const gap = Math.min(12, chartWidth / Math.max(1, values.length * 4))
  const barWidth = Math.max(1, (chartWidth - gap * Math.max(0, values.length - 1)) / values.length)
  const zeroY = inset + (max / span) * chartHeight

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#E5E7EB')
    canvas.drawRect(
      renderer.ck.LTRBRect(inset, Math.max(inset, zeroY - 0.5), width - inset, zeroY + 0.5),
      renderer.fillPaint
    )
    configureModulePreviewPaint(renderer, resolved.config.color)
    values.forEach((value, index) => {
      const valueY = inset + ((max - value) / span) * chartHeight
      const left = inset + index * (barWidth + gap)
      const top = Math.min(zeroY, valueY)
      const bottom = Math.max(zeroY, valueY)
      canvas.drawRect(
        renderer.ck.LTRBRect(left, top, Math.min(width - inset, left + barWidth), bottom),
        renderer.fillPaint
      )
    })
    if (labelFont && labelBand > 0) {
      configureModulePreviewPaint(renderer, '#4B5563')
      values.forEach((value, index) => {
        const left = inset + index * (barWidth + gap)
        const centerX = left + barWidth / 2
        const label = ellipsizeLabelText(
          labelFont,
          resolved.config.labels[index] ?? '',
          Math.max(0, barWidth + gap - 2)
        )
        if (label) {
          canvas.drawText(
            label,
            centerX - measureLabelText(labelFont, label) / 2,
            height - Math.max(2, inset * 0.25),
            renderer.fillPaint,
            labelFont
          )
        }
        if (!resolved.config.showValues || barWidth + gap < 20) return
        const valueY = inset + ((max - value) / span) * chartHeight
        const baseline =
          value >= 0
            ? Math.max(inset + 9, valueY - 3)
            : Math.min(inset + chartHeight - 2, valueY + 11)
        const valueLabel = String(value)
        canvas.drawText(
          valueLabel,
          centerX - measureLabelText(labelFont, valueLabel) / 2,
          baseline,
          renderer.fillPaint,
          labelFont
        )
      })
    }
  } finally {
    canvas.restore()
  }
  return true
}

export const CHART_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CHART_PLUGIN_ID,
  moduleType: CHART_MODULE_TYPE,
  render: renderChartModulePreview
})
