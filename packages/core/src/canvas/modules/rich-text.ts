import type { Canvas } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { ellipsizeLabelText, measureLabelText } from '#core/canvas/labels/text'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  RICH_TEXT_MODULE_TYPE,
  RICH_TEXT_PLUGIN_ID,
  resolveRichTextModule,
  type RichTextAlignmentV1,
  type RichTextInlineV1,
  type RichTextModuleConfigV1
} from '#core/plugins/rich-text'

import { configureModulePreviewPaint, modulePreviewFrame } from './preview'
import type { ModuleCanvasAdapter } from './types'

interface RichTextPreviewLine {
  text: string
  align: RichTextAlignmentV1
  color: string
}

function inlineText(children: readonly RichTextInlineV1[]): string {
  return children
    .map((child) => child.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

function inlineColor(
  children: readonly RichTextInlineV1[],
  config: RichTextModuleConfigV1
): string {
  const nonempty = children.filter((child) => child.text.length > 0)
  return nonempty.length > 0 &&
    nonempty.every((child) => child.marks.some((mark) => mark.type === 'link'))
    ? config.linkColor
    : config.textColor
}

/** Collapse the bounded AST into logical preview lines without loading DOM or network resources. */
export function richTextPreviewLines(config: RichTextModuleConfigV1): RichTextPreviewLine[] {
  const lines: RichTextPreviewLine[] = []
  for (const block of config.content.blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      lines.push({
        text: `${block.type === 'heading' ? `${'#'.repeat(block.level)} ` : ''}${inlineText(block.children)}`,
        align: block.align,
        color: inlineColor(block.children, config)
      })
      continue
    }
    if (block.type === 'blockquote') {
      lines.push({
        text: `> ${inlineText(block.children)}`,
        align: 'left',
        color: inlineColor(block.children, config)
      })
      continue
    }
    if (block.type === 'codeBlock') {
      const codeLines = block.text.split(/\r?\n/)
      for (const line of codeLines) {
        lines.push({ text: `› ${line}`, align: 'left', color: config.textColor })
      }
      continue
    }
    block.items.forEach((item, index) => {
      lines.push({
        text: `${block.type === 'orderedList' ? `${index + 1}.` : '•'} ${inlineText(item.children)}`,
        align: 'left',
        color: inlineColor(item.children, config)
      })
    })
  }
  return lines
}

function lineX(
  align: RichTextAlignmentV1,
  width: number,
  inset: number,
  measuredWidth: number
): number {
  if (align === 'center') return Math.max(inset, (width - measuredWidth) / 2)
  if (align === 'right') return Math.max(inset, width - inset - measuredWidth)
  return inset
}

/** Draw a deterministic, dependency-free editor preview for a trusted rich-text module. */
export function renderRichTextModulePreview(
  renderer: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode
): boolean {
  const frame = modulePreviewFrame(node)
  if (!frame) return false
  const resolved = resolveRichTextModule(frame.node.interactiveProps?.module)
  if (!resolved?.ok) return false
  if (frame.empty) return true
  const { width, height } = frame

  const font = renderer.labelFont
  if (!font) return true
  const inset = Math.min(24, Math.max(8, Math.min(width, height) * 0.06))
  const lineHeight = Math.min(
    30,
    Math.max(14, resolved.config.fontSize * resolved.config.lineHeight)
  )
  const availableWidth = Math.max(0, width - inset * 2)
  const maxLines = Math.max(0, Math.floor((height - inset * 2) / lineHeight))
  const allLines = richTextPreviewLines(resolved.config)
  const lines = allLines.slice(0, maxLines)
  if (allLines.length > lines.length && lines.length > 0) {
    const last = lines.at(-1)
    if (last) lines[lines.length - 1] = { ...last, text: `${last.text} …` }
  }

  canvas.save()
  try {
    canvas.clipRRect(renderer.makeRRect(frame.node), renderer.ck.ClipOp.Intersect, true)
    lines.forEach((line, index) => {
      const text = ellipsizeLabelText(font, line.text, availableWidth)
      if (!text) return
      configureModulePreviewPaint(renderer, line.color)
      canvas.drawText(
        text,
        lineX(line.align, width, inset, measureLabelText(font, text)),
        inset + lineHeight * (index + 0.8),
        renderer.fillPaint,
        font
      )
    })
  } finally {
    canvas.restore()
  }
  return true
}

export const RICH_TEXT_MODULE_CANVAS_ADAPTER: ModuleCanvasAdapter = Object.freeze({
  pluginId: RICH_TEXT_PLUGIN_ID,
  moduleType: RICH_TEXT_MODULE_TYPE,
  render: renderRichTextModulePreview
})
