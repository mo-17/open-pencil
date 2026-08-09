import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { TABS_MODULE_TYPE, TABS_PLUGIN_ID, resolveTabsModule } from '#core/plugins/tabs'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

const CELL_TEXT = Object.freeze({ horizontalInsetRatio: 0.06, baselineRatio: 0.68 })

/** Draw only validated inline labels and content; tab behavior remains runtime-owned. */
export function renderTabsModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveTabsModule, (frame) => {
    const { width, height, config } = frame
    const activeIndex = config.tabs.findIndex((tab) => tab.id === config.initialTabId)
    const active = config.tabs[activeIndex]
    withModulePreviewFont(renderer, config.fontSize, () => {
      withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
        if (config.orientation === 'horizontal') {
          const tabHeight = Math.min(height, Math.max(32, config.fontSize * 2.4))
          const tabWidth = width / config.tabs.length
          config.tabs.forEach((tab, index) => {
            if (index === activeIndex) {
              configureModulePreviewPaint(renderer, config.accentColor)
              canvas.drawRect(
                renderer.ck.LTRBRect(
                  index * tabWidth,
                  tabHeight - 3,
                  (index + 1) * tabWidth,
                  tabHeight
                ),
                renderer.fillPaint
              )
            }
            drawModulePreviewCellText(
              renderer,
              canvas,
              tab.label,
              index * tabWidth,
              0,
              tabWidth,
              tabHeight,
              config.textColor,
              CELL_TEXT
            )
          })
          if (config.showDivider) {
            configureModulePreviewPaint(renderer, '#D1D5DB')
            canvas.drawRect(
              renderer.ck.LTRBRect(0, tabHeight, width, tabHeight + 1),
              renderer.fillPaint
            )
          }
          drawModulePreviewCellText(
            renderer,
            canvas,
            active.content,
            0,
            tabHeight,
            width,
            Math.max(1, height - tabHeight),
            config.textColor,
            { horizontalInsetRatio: 0.04, baselineRatio: 0.35 }
          )
          return
        }

        const sidebarWidth = Math.min(width * 0.42, Math.max(112, width * 0.3))
        const tabHeight = Math.min(44, height / config.tabs.length)
        config.tabs.forEach((tab, index) => {
          if (index === activeIndex) {
            configureModulePreviewPaint(renderer, config.accentColor)
            canvas.drawRect(
              renderer.ck.LTRBRect(0, index * tabHeight, 3, (index + 1) * tabHeight),
              renderer.fillPaint
            )
          }
          drawModulePreviewCellText(
            renderer,
            canvas,
            tab.label,
            0,
            index * tabHeight,
            sidebarWidth,
            tabHeight,
            config.textColor,
            CELL_TEXT
          )
        })
        if (config.showDivider) {
          configureModulePreviewPaint(renderer, '#D1D5DB')
          canvas.drawRect(
            renderer.ck.LTRBRect(sidebarWidth, 0, sidebarWidth + 1, height),
            renderer.fillPaint
          )
        }
        drawModulePreviewCellText(
          renderer,
          canvas,
          active.content,
          sidebarWidth,
          0,
          Math.max(0, width - sidebarWidth),
          height,
          config.textColor,
          { horizontalInsetRatio: 0.05, baselineRatio: 0.18 }
        )
      })
    })
  })
}

export const TABS_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: TABS_PLUGIN_ID,
  moduleType: TABS_MODULE_TYPE,
  render: renderTabsModulePreview
})
