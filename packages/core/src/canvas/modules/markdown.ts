import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  MARKDOWN_MODULE_TYPE,
  MARKDOWN_PLUGIN_ID,
  resolveMarkdownModule
} from '#core/plugins/markdown'

import {
  configureModulePreviewPaint,
  drawModulePreviewCellText,
  renderResolvedModulePreview,
  withModulePreviewFont,
  withModulePreviewSurface
} from './preview'
import type { ModuleCanvasAdapter } from './types'

export interface MarkdownPreviewLine {
  text: string
  heading: boolean
}

function plainMarkdownLine(value: string): MarkdownPreviewLine | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const heading = /^#{1,6}\s/.test(trimmed)
  const withoutHtml = trimmed.replace(/<[^>]{0,256}>/g, '')
  const text = withoutHtml
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/^\d+[.)]\s+/, '• ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
  return text === '' ? null : { text: text.slice(0, 512), heading }
}

/** Convert Markdown to a bounded plain-text preview; raw HTML is stripped and never interpreted. */
export function markdownPreviewLines(source: string, maximumLines: number): MarkdownPreviewLine[] {
  const lines: MarkdownPreviewLine[] = []
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = plainMarkdownLine(sourceLine)
    if (!line) continue
    lines.push(line)
    if (lines.length >= maximumLines) break
  }
  return lines
}

/** Draw bounded plain text only; Markdown HTML and link destinations are never executed or fetched. */
export function renderMarkdownModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  return renderResolvedModulePreview(node, resolveMarkdownModule, (frame) => {
    const { width, height, config } = frame
    const rowHeight = Math.max(18, config.fontSize * config.lineHeight)
    const maximumLines = Math.min(24, Math.max(1, Math.floor(height / rowHeight)))
    const lines = markdownPreviewLines(config.source, maximumLines)
    withModulePreviewFont(renderer, config.fontSize, () => {
      withModulePreviewSurface(renderer, canvas, frame, config.backgroundColor, () => {
        lines.forEach((line, index) => {
          drawModulePreviewCellText(
            renderer,
            canvas,
            line.text,
            0,
            index * rowHeight,
            width,
            rowHeight,
            line.heading ? config.headingColor : config.textColor,
            { horizontalInsetRatio: 0.035, baselineRatio: 0.72 }
          )
          if (line.heading && index * rowHeight + rowHeight < height) {
            configureModulePreviewPaint(renderer, config.accentColor)
            const bottom = (index + 1) * rowHeight
            canvas.drawRect(
              renderer.ck.LTRBRect(8, bottom - 2, width - 8, bottom),
              renderer.fillPaint
            )
          }
        })
      })
    })
  })
}

export const MARKDOWN_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: MARKDOWN_PLUGIN_ID,
  moduleType: MARKDOWN_MODULE_TYPE,
  render: renderMarkdownModulePreview
})
