import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  ACCORDION_MODULE_TYPE,
  ACCORDION_PLUGIN_ID,
  resolveAccordionModule
} from '#core/plugins/accordion'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

/** Draw a bounded initial-state summary using inline content only. */
export function renderAccordionModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveAccordionModule, (frame) => {
    const { width, height, config } = frame
    const headerHeight = Math.max(30, config.fontSize * 2.35)
    const openHeight = Math.max(28, config.fontSize * 2.6)
    const openIds = new Set(config.initialOpenIds)
    withModulePreviewFont(renderer, config.fontSize, () => {
      withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
        let top = 0
        for (const item of config.items) {
          if (top >= height) break
          const isOpen = openIds.has(item.id)
          drawModulePreviewCellText(
            renderer,
            canvas,
            `${isOpen ? '−' : '+'}  ${item.title}`,
            0,
            top,
            width,
            Math.min(headerHeight, height - top),
            isOpen ? config.accentColor : config.textColor,
            { horizontalInsetRatio: 0.035, baselineRatio: 0.68 }
          )
          top += headerHeight
          if (config.showDividers && top < height) {
            configureModulePreviewPaint(renderer, '#D1D5DB')
            canvas.drawRect(renderer.ck.LTRBRect(0, top, width, top + 1), renderer.fillPaint)
          }
          if (!isOpen || top >= height) continue
          drawModulePreviewCellText(
            renderer,
            canvas,
            item.content,
            0,
            top,
            width,
            Math.min(openHeight, height - top),
            config.textColor,
            { horizontalInsetRatio: 0.05, baselineRatio: 0.58 }
          )
          top += openHeight
        }
      })
    })
  })
}

export const ACCORDION_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: ACCORDION_PLUGIN_ID,
  moduleType: ACCORDION_MODULE_TYPE,
  render: renderAccordionModulePreview
})
