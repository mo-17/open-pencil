import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import {
  resolveRichTextModule,
  type RichTextAlignmentV1,
  type RichTextInlineV1,
  type RichTextModuleConfigV1
} from '#core/plugins/rich-text'

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

export function richTextVisibleLines(node: SceneNode, config: RichTextModuleConfigV1) {
  const inset = Math.min(24, Math.max(8, Math.min(node.width, node.height) * 0.06))
  const lineHeight = Math.max(14, config.fontSize * config.lineHeight)
  const availableWidth = Math.max(0, node.width - inset * 2)
  const maxLines = Math.max(0, Math.floor((node.height - inset * 2) / lineHeight))
  const allLines = richTextPreviewLines(config),
    lines = allLines.slice(0, maxLines)
  if (allLines.length > lines.length && lines.length > 0) {
    const last = lines.at(-1)
    if (last) lines[lines.length - 1] = { ...last, text: `${last.text} …` }
  }
  return { inset, lineHeight, availableWidth, lines }
}

/** Font preflight shares the same bounded logical lines as the offline AST preview. */
export function richTextTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveRichTextModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const { lines, availableWidth } = richTextVisibleLines(node, resolved.config)
  return moduleLabelTextNode(
    node,
    lines.map((line) => line.text).join('\n'),
    availableWidth,
    resolved.config.fontSize,
    node.textLanguage ?? 'en'
  )
}
