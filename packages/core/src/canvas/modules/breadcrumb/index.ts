import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { drawNavigationLabel } from '#core/canvas/modules/navigation/shared'
import { renderResolvedModulePreview, withModulePreviewSurface } from '#core/canvas/modules/preview'
import type { ModuleCanvasAdapter } from '#core/canvas/modules/types'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  BREADCRUMB_MODULE_TYPE,
  BREADCRUMB_PLUGIN_ID,
  resolveBreadcrumbModule
} from '#core/plugins/breadcrumb'

export function renderBreadcrumbModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveBreadcrumbModule, (frame) => {
    const { config, width } = frame
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      let x = 12
      let y = 6
      const available = Math.max(0, width - 24)
      const separator = ({ slash: '/', dot: '·', chevron: '›' } as const)[config.separator]
      const entries = config.items.map((item, index) => {
        const current = index === config.items.length - 1
        const leading = index > 0 ? 18 : 0
        const textWidth = Math.max(0, Math.min(220, available - leading))
        const style = {
          fontSize: config.fontSize,
          color: current || !item.href ? config.textColor : config.accentColor,
          strong: current
        }
        const measured = drawNavigationLabel(
          renderer,
          canvas,
          node,
          item.label,
          { x: 0, y: 0, width: textWidth, height: 44 },
          style,
          false
        )
        return { item, leading, textWidth: measured, style }
      })
      const separatorWidth = entries.reduce((sum, entry) => sum + entry.leading, 0)
      const labelWidth = entries.reduce((sum, entry) => sum + entry.textWidth, 0)
      const textBudget = Math.max(0, available - separatorWidth - (entries.length - 1) * 8)
      // Flex items share the available line in nowrap mode so the current page is not lost.
      const scale = config.wrap || labelWidth <= textBudget ? 1 : textBudget / labelWidth
      entries.forEach(({ item, leading, textWidth, style }, index) => {
        const allocatedTextWidth = textWidth * scale
        const itemWidth = allocatedTextWidth + leading
        if (config.wrap && x > 12 && x + itemWidth > width - 12) {
          x = 12
          y += 48
        }
        if (y >= frame.height) return
        if (index > 0)
          drawNavigationLabel(
            renderer,
            canvas,
            node,
            separator,
            { x, y: y + (44 - config.fontSize * 1.5) / 2, width: 10, height: 44 },
            { fontSize: config.fontSize, color: config.textColor + '88' }
          )
        drawNavigationLabel(
          renderer,
          canvas,
          node,
          item.label,
          {
            x: x + leading,
            y: y + (44 - config.fontSize * 1.5) / 2,
            width: Math.min(allocatedTextWidth, Math.max(0, width - 12 - x - leading)),
            height: 44
          },
          style
        )
        x += itemWidth + 8
      })
    })
  })
}
export const BREADCRUMB_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: BREADCRUMB_PLUGIN_ID,
  moduleType: BREADCRUMB_MODULE_TYPE,
  render: renderBreadcrumbModulePreview
})
