import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  renderResolvedModulePreview,
  configureModulePreviewPaint,
  withModulePreviewClip,
  withModulePreviewRectClip
} from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { withTextParagraph } from '#core/canvas/text'
import { parseColor } from '#core/color'
import { TOOLTIP_PLUGIN_ID, TOOLTIP_MODULE_TYPE, resolveTooltipModule } from '#core/plugins/tooltip'

import { tooltipTextNode } from './text'
/** Canvas draws the resting trigger. Help opens only in the generated runtime. */
export function renderTooltipModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveTooltipModule, ({ config, width, height }) => {
    withModulePreviewClip(renderer, canvas, node, () => {
      configureModulePreviewPaint(renderer, config.triggerBackground)
      const radius = Math.min(config.borderRadius, width / 2, height / 2)
      canvas.drawRRect(
        renderer.ck.RRectXY(renderer.ck.LTRBRect(0, 0, width, height), radius, radius),
        renderer.fillPaint
      )
      const label = tooltipTextNode(node)
      if (!label || !renderer.fontProvider || !renderer.fontsLoaded || width <= 24) return
      const readiness = renderer.nodeFontReadiness(label)
      if (readiness !== 'ready' && readiness !== 'substituted') return
      label.textAlignHorizontal = 'CENTER'
      const color = parseColor(config.triggerTextColor)
      withTextParagraph(
        renderer,
        label,
        renderer.color4f(color.r, color.g, color.b, color.a),
        { halfLeading: true },
        (paragraph) => {
          withModulePreviewRectClip(
            renderer,
            canvas,
            { x: 12, y: 0, width: width - 24, height },
            () => {
              paragraph.draw(canvas, 12, Math.max(0, (height - paragraph.getHeight()) / 2))
            }
          )
        }
      )
    })
  })
}
export const TOOLTIP_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TOOLTIP_PLUGIN_ID,
  moduleType: TOOLTIP_MODULE_TYPE,
  render: renderTooltipModulePreview
})
