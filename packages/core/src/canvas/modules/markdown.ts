import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleMultilineLabelNode } from '#core/canvas/modules/label'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { parseColor } from '#core/color'
import {
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  resolveMarkdownModule
} from '#core/plugins/markdown'

import { markdownPreviewBlocks } from './markdown/projection'
import {
  configureModulePreviewPaint,
  renderResolvedModulePreview,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

export { markdownPreviewLines, markdownTextNode } from './markdown/projection'
export type { MarkdownPreviewLine } from './markdown/projection'

/** Canvas is a bounded static text projection; the web targets own CommonMark/GFM semantics. */
export function renderMarkdownModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveMarkdownModule, (frame) => {
    const { width, height, config } = frame
    withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
      if (!renderer.fontProvider || !renderer.fontsLoaded) return
      const inset = Math.min(16, width / 8, height / 8)
      const innerWidth = Math.max(0, width - inset * 2)
      let y = inset
      for (const block of markdownPreviewBlocks(config.source)) {
        if (y >= height - inset || !innerWidth) break
        if (block.kind === 'space') {
          y += config.fontSize * 0.4
          continue
        }
        if (block.kind === 'rule') {
          configureModulePreviewPaint(renderer, config.accentColor)
          canvas.drawRect(
            renderer.ck.LTRBRect(inset, y + 3, width - inset, Math.min(height, y + 4)),
            renderer.fillPaint
          )
          y += config.fontSize
          continue
        }
        const decorated = block.kind === 'code' || block.kind === 'quote'
        const textInset = decorated ? Math.min(8, innerWidth / 8) : 0
        const fontSize =
          config.fontSize * (block.kind === 'heading' ? Math.max(1.1, 2 - block.level * 0.15) : 1)
        const label = moduleMultilineLabelNode(node, block.text, {
          width: Math.max(1, innerWidth - textInset * 2),
          fontSize,
          fontWeight: block.kind === 'heading' ? 600 : 400,
          lineHeight: fontSize * config.lineHeight
        })
        const readiness = renderer.nodeFontReadiness(label)
        if (readiness !== 'ready' && readiness !== 'substituted') break
        const color = parseColor(block.kind === 'heading' ? config.headingColor : config.textColor)
        const paragraph = renderer.buildParagraph(
          label,
          renderer.color4f(color.r, color.g, color.b, color.a),
          { halfLeading: true }
        )
        try {
          const blockHeight = paragraph.getHeight()
          if (decorated) {
            configureModulePreviewPaint(renderer, config.accentColor)
            renderer.fillPaint.setAlphaf(block.kind === 'code' ? 0.08 : 0.5)
            const right = block.kind === 'code' ? width - inset : inset + Math.min(3, innerWidth)
            canvas.drawRect(
              renderer.ck.LTRBRect(inset, y, right, Math.min(height - inset, y + blockHeight)),
              renderer.fillPaint
            )
          }
          canvas.drawParagraph(paragraph, inset + textInset, y)
          y += blockHeight + (block.kind === 'heading' ? config.fontSize * 0.5 : 0)
        } finally {
          paragraph.delete()
        }
      }
    })
  })
}

export const MARKDOWN_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: MARKDOWN_PLUGIN_ID,
  moduleType: MARKDOWN_MODULE_TYPE,
  render: renderMarkdownModulePreview
})
