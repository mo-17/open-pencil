import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import { POPOVER_PLUGIN_ID, POPOVER_MODULE_TYPE, resolvePopoverModule } from '#core/plugins/popover'

import { popoverTriggerTextNode } from './text'

/** Only the closed trigger is painted. Slot children are edited in content isolation. */
export function renderPopoverModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolvePopoverModule, ({ config, width, height }) => {
    withModulePreviewClip(renderer, canvas, node, () => {
      configureModulePreviewPaint(renderer, config.triggerBackground)
      const opacity = config.disabled ? 0.5 : 1
      renderer.fillPaint.setAlphaf(opacity)
      const radius = Math.min(config.borderRadius, width / 2, height / 2)
      canvas.drawRRect(
        renderer.ck.RRectXY(renderer.ck.LTRBRect(0, 0, width, height), radius, radius),
        renderer.fillPaint
      )
      renderer.fillPaint.setAlphaf(1)
      const label = popoverTriggerTextNode(node)
      if (!label || label.width <= 0 || !renderer.fontProvider || !renderer.fontsLoaded) return
      const readiness = renderer.nodeFontReadiness(label)
      if (readiness !== 'ready' && readiness !== 'substituted') return
      const color = parseColor(config.triggerTextColor)
      const paragraph = renderer.buildParagraph(
        label,
        renderer.color4f(color.r, color.g, color.b, color.a * opacity),
        { halfLeading: true }
      )
      try {
        paragraph.draw(canvas, 12, (height - paragraph.getHeight()) / 2)
      } finally {
        paragraph.delete()
      }
    })
  })
}
export const POPOVER_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: POPOVER_PLUGIN_ID,
  moduleType: POPOVER_MODULE_TYPE,
  render: renderPopoverModulePreview
})
