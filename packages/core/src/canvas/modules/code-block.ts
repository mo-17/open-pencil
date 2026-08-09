import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  CODE_BLOCK_MODULE_TYPE,
  CODE_BLOCK_PLUGIN_ID,
  resolveCodeBlockModule
} from '#core/plugins/code-block'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

export function codeBlockPreviewLines(code: string, maximumLines: number): string[] {
  return code
    .split(/\r?\n/)
    .slice(0, maximumLines)
    .map((line) => line.slice(0, 512))
}

/** Draw source as inert text only; no syntax engine, code execution, or clipboard access occurs. */
export function renderCodeBlockModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveCodeBlockModule, (frame) => {
    const { width, height, config } = frame
    const headerHeight = Math.min(36, Math.max(24, config.fontSize * 1.8))
    const rowHeight = Math.max(16, config.fontSize * 1.45)
    const maximumLines = Math.min(50, Math.max(0, Math.floor((height - headerHeight) / rowHeight)))
    const lines = codeBlockPreviewLines(config.code, maximumLines)
    const numberWidth = config.showLineNumbers
      ? Math.min(56, Math.max(30, config.fontSize * 2.8))
      : 0
    withModulePreviewFont(renderer, config.fontSize, () => {
      withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
        configureModulePreviewPaint(renderer, config.accentColor)
        canvas.drawRect(
          renderer.ck.LTRBRect(0, headerHeight - 2, width, headerHeight),
          renderer.fillPaint
        )
        drawModulePreviewCellText(
          renderer,
          canvas,
          config.language,
          0,
          0,
          width,
          headerHeight,
          config.textColor,
          { horizontalInsetRatio: 0.025, baselineRatio: 0.68 }
        )
        if (config.showCopyButton && width >= 96) {
          configureModulePreviewPaint(renderer, config.accentColor)
          canvas.drawRect(
            renderer.ck.LTRBRect(width - 54, 7, width - 10, headerHeight - 7),
            renderer.fillPaint
          )
        }
        lines.forEach((line, index) => {
          const top = headerHeight + index * rowHeight
          if (config.showLineNumbers) {
            drawModulePreviewCellText(
              renderer,
              canvas,
              String(index + 1),
              0,
              top,
              numberWidth,
              rowHeight,
              config.accentColor,
              { horizontalInsetRatio: 0.15, baselineRatio: 0.72 }
            )
          }
          drawModulePreviewCellText(
            renderer,
            canvas,
            line,
            numberWidth,
            top,
            Math.max(0, width - numberWidth),
            rowHeight,
            config.textColor,
            { horizontalInsetRatio: 0.025, baselineRatio: 0.72 }
          )
        })
      })
    })
  })
}

export const CODE_BLOCK_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: CODE_BLOCK_PLUGIN_ID,
  moduleType: CODE_BLOCK_MODULE_TYPE,
  render: renderCodeBlockModulePreview
})
