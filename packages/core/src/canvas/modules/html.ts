import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import { HTML_MODULE_TYPE, HTML_PLUGIN_ID, resolveHTMLModule } from '#core/plugins/html'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

const HIDDEN_ELEMENT_CONTENT =
  /<\s*(script|style|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi
const BLOCK_BOUNDARY =
  /<\s*\/?\s*(?:address|article|aside|blockquote|br|div|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tr|ul)\b[^>]*>/gi
const COMMENT = /<!--[\s\S]*?-->/g
const TAG = /<[^>]*>/g

/** Reduce bounded authored HTML to inert text for CanvasKit's dependency-free summary. */
export function htmlPreviewText(html: string): string {
  return html
    .replace(HIDDEN_ELEMENT_CONTENT, ' ')
    .replace(COMMENT, ' ')
    .replace(BLOCK_BOUNDARY, '\n')
    .replace(TAG, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ')
}

/** Draw a deterministic offline summary; the real HTML renders only inside an isolated iframe. */
export function renderHTMLModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveHTMLModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true

  const font = renderer.labelFont
  if (!font) return true
  const { width, height } = frame
  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.06))
  const availableWidth = Math.max(0, width - inset * 2)
  const summary = htmlPreviewText(resolved.config.html)

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    configureModulePreviewPaint(renderer, '#2563EB')
    canvas.drawText(
      ellipsizeLabelText(font, '</> HTML', availableWidth),
      inset,
      inset + 14,
      renderer.fillPaint,
      font
    )
    if (summary && height >= inset * 2 + 28) {
      configureModulePreviewPaint(renderer, '#374151')
      canvas.drawText(
        ellipsizeLabelText(font, summary, availableWidth),
        inset,
        inset + 36,
        renderer.fillPaint,
        font
      )
    }
  } finally {
    canvas.restore()
  }
  return true
}

export const HTML_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: HTML_PLUGIN_ID,
  moduleType: HTML_MODULE_TYPE,
  render: renderHTMLModulePreview
})
