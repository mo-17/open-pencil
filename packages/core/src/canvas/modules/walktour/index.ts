import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

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
  WALKTOUR_MODULE_TYPE,
  WALKTOUR_PLUGIN_ID,
  WALKTOUR_MODULE_TRIGGER_HEIGHT,
  resolveWalktourModule
} from '#core/plugins/walktour'

import { walktourTextNode } from './text'

export function renderWalktourModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveWalktourModule, (frame) => {
    const { config, width } = frame,
      height = Math.min(frame.height, WALKTOUR_MODULE_TRIGGER_HEIGHT)
    const opacity = config.disabled ? 0.5 : 1
    withModulePreviewRectClip(renderer, canvas, { x: 0, y: 0, width, height }, () => {
      configureModulePreviewPaint(renderer, config.triggerBackground)
      renderer.fillPaint.setAlphaf(opacity)
      const radius = Math.min(config.borderRadius, width / 2, height / 2)
      canvas.drawRRect(
        renderer.ck.RRectXY(renderer.ck.XYWHRect(0, 0, width, height), radius, radius),
        renderer.fillPaint
      )
      renderer.fillPaint.setAlphaf(1)
      const label = walktourTextNode(node)
      if (!label || label.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return
      const status = renderer.nodeFontReadiness(label)
      if (status !== 'ready' && status !== 'substituted') return
      const color = parseColor(config.triggerTextColor)
      withTextParagraph(
        renderer,
        label,
        renderer.color4f(color.r, color.g, color.b, color.a * opacity),
        { halfLeading: true },
        (paragraph) => {
          paragraph.draw(canvas, 12, (height - paragraph.getHeight()) / 2)
        }
      )
    })
  })
}
export const WALKTOUR_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: WALKTOUR_PLUGIN_ID,
  moduleType: WALKTOUR_MODULE_TYPE,
  render: renderWalktourModulePreview
})
