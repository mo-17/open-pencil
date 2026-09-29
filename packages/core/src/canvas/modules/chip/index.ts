import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewRectClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import {
  CHIP_CHECK_PATH,
  CHIP_DELETE_PATH,
  CHIP_LAYOUT,
  CHIP_MODULE_TYPE,
  CHIP_PLUGIN_ID,
  resolveChipModule
} from '#core/plugins/chip'

import { chipTextNode } from './text'

function drawIcon(renderer: SkiaRenderer, canvas: Canvas, source: string, x: number, y: number) {
  const path = renderer.ck.Path.MakeFromSVGString(source)
  if (!path) return
  canvas.save()
  try {
    canvas.translate(x, y)
    canvas.drawPath(path, renderer.auxStroke)
  } finally {
    canvas.restore()
    path.delete()
  }
}
export function renderChipModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveChipModule, (frame) => {
    const { config, width, height } = frame
    const selected = config.selectable && config.initialSelected
    const filled = config.variant === 'filled' || selected
    const foreground = filled ? config.filledTextColor : config.color
    const opacity = config.disabled ? 0.45 : 1
    const label = chipTextNode(node)
    withModulePreviewRectClip(renderer, canvas, { x: 0, y: 0, width, height }, () => {
      const rect = renderer.ck.RRectXY(
        renderer.ck.LTRBRect(0.5, 0.5, width - 0.5, height - 0.5),
        config.borderRadius,
        config.borderRadius
      )
      configureModulePreviewPaint(renderer, config.color)
      const softOpacity = config.variant === 'soft' ? 0.12 : 0
      renderer.fillPaint.setAlphaf(opacity * (filled ? 1 : softOpacity))
      canvas.drawRRect(rect, renderer.fillPaint)
      if (config.variant === 'outlined') {
        configureControlPaint(renderer, config.color, opacity, 1)
        canvas.drawRRect(rect, renderer.auxStroke)
      }
      configureControlPaint(renderer, foreground, opacity, 1.8)
      if (selected) drawIcon(renderer, canvas, CHIP_CHECK_PATH, 12, (height - 16) / 2)
      if (config.deletable)
        drawIcon(renderer, canvas, CHIP_DELETE_PATH, width - 30, (height - 16) / 2)
      if (!label || !renderer.fontProvider || !renderer.fontsLoaded) return
      const x = selected ? CHIP_LAYOUT.selectedInset : CHIP_LAYOUT.inset
      label.width = Math.max(
        0,
        width - x - (config.deletable ? CHIP_LAYOUT.actionSize : CHIP_LAYOUT.inset)
      )
      const ready = renderer.nodeFontReadiness(label)
      if (label.width <= 0 || (ready !== 'ready' && ready !== 'substituted')) return
      const color = parseColor(foreground)
      withTextParagraph(
        renderer,
        label,
        renderer.color4f(color.r, color.g, color.b, opacity),
        { halfLeading: true },
        (paragraph) => {
          canvas.drawParagraph(
            paragraph,
            x,
            (height - config.fontSize * CHIP_LAYOUT.lineHeight) / 2
          )
        }
      )
    })
  })
}
export const CHIP_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CHIP_PLUGIN_ID,
  moduleType: CHIP_MODULE_TYPE,
  render: renderChipModulePreview
})
