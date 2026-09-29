import type { Canvas } from 'canvaskit-wasm'

import { configureControlPaint } from '#core/canvas/control-content'
import {
  configureModulePreviewPaint,
  withModulePreviewRectClip,
  type ResolvedModulePreviewFrame
} from '#core/canvas/modules/preview'
import type { SkiaRenderer } from '#core/canvas/renderer'
import type { CodeBlockModuleConfigV1 } from '#core/plugins/code-block'
import { CODE_BLOCK_LAYOUT as L, codeBlockCanvasLine } from '#core/plugins/code-block/layout'

import { codeBlockParagraph, paintCodeBlockLabel } from './paragraph'
import { codeBlockCopyLabel } from './text'

type Frame = ResolvedModulePreviewFrame<CodeBlockModuleConfigV1>

export function drawCodeBlockHeader(renderer: SkiaRenderer, canvas: Canvas, frame: Frame): void {
  const { node, width, config } = frame
  const copy = config.showCopyButton && width >= L.copyMinimumWidth
  const available = Math.max(0, width - L.inset * 2 - (copy ? L.copyWidth + 8 : 0))
  paintCodeBlockLabel(renderer, canvas, node, L.inset, 12, {
    text: config.label,
    width: available,
    fontSize: L.headerFontSize,
    weight: 600,
    color: config.textColor,
    lineHeight: 18
  })
  paintCodeBlockLabel(renderer, canvas, node, L.inset, 32, {
    text: config.language,
    width: available,
    fontSize: L.languageFontSize,
    color: config.accentColor,
    lineHeight: 16
  })
  configureModulePreviewPaint(renderer, config.accentColor + '55')
  canvas.drawRect(
    renderer.ck.LTRBRect(0, L.headerHeight - 1, width, L.headerHeight),
    renderer.fillPaint
  )
  if (!copy) return
  const x = width - L.inset - L.copyWidth
  configureControlPaint(renderer, config.accentColor, 1, 1)
  canvas.drawRRect(
    renderer.ck.RRectXY(
      renderer.ck.LTRBRect(x, L.headerInset, x + L.copyWidth, L.headerInset + L.actionHeight),
      6,
      6
    ),
    renderer.auxStroke
  )
  paintCodeBlockLabel(renderer, canvas, node, x + 6, 21, {
    text: codeBlockCopyLabel(node),
    width: L.copyWidth - 12,
    fontSize: L.headerFontSize,
    color: config.textColor,
    lineHeight: 18,
    align: 'CENTER'
  })
}

export function drawCodeBlockLines(renderer: SkiaRenderer, canvas: Canvas, frame: Frame): void {
  const { node, width, height, config } = frame
  const lines = config.code.split(/\r\n|\r|\n/)
  const lineHeight = config.fontSize * L.lineHeight
  const gutter = config.showLineNumbers
    ? Math.max(30, String(lines.length).length * config.fontSize * 0.7 + L.inset)
    : 0
  const x = L.inset + gutter
  const contentWidth = Math.max(0, width - x - L.inset)
  if (contentWidth <= 0) return
  let y = L.headerHeight + L.inset
  withModulePreviewRectClip(
    renderer,
    canvas,
    { x: 0, y: L.headerHeight, width, height: Math.max(0, height - L.headerHeight) },
    () => {
      for (const [index, source] of lines.entries()) {
        if (y >= height) break
        const text = codeBlockCanvasLine(source, config.tabSize)
        const paragraph = codeBlockParagraph(renderer, node, {
          text,
          width: config.wrapLines
            ? contentWidth
            : Math.max(contentWidth, text.length * config.fontSize),
          fontSize: config.fontSize,
          color: config.textColor,
          lineHeight,
          wrap: true
        })
        if (!paragraph) break
        const rowY = y
        try {
          if (config.showLineNumbers)
            paintCodeBlockLabel(renderer, canvas, node, L.inset, y, {
              text: String(index + 1),
              width: gutter - 8,
              fontSize: config.fontSize,
              color: config.accentColor,
              lineHeight,
              align: 'RIGHT'
            })
          withModulePreviewRectClip(
            renderer,
            canvas,
            { x, y, width: contentWidth, height: Math.max(0, height - y) },
            () => canvas.drawParagraph(paragraph, x, rowY)
          )
          y += Math.max(lineHeight, paragraph.getHeight())
        } finally {
          paragraph.delete()
        }
      }
    }
  )
}
