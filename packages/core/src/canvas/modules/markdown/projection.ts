import type { SceneNode } from '@open-pencil/scene-graph'

import { moduleLabelTextNode } from '#core/canvas/modules/label'
import { resolveMarkdownModule } from '#core/plugins/markdown'

export interface MarkdownPreviewLine {
  text: string
  heading: boolean
}

function plainMarkdownLine(value: string): MarkdownPreviewLine | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const heading = /^#{1,6}\s/.test(trimmed)
  const text = trimmed
    .replace(/<[^>]{0,256}>/g, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '• ')
    .replace(/^\d+[.)]\s+/, '• ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .trim()
  return text ? { text: text.slice(0, 512), heading } : null
}

/** Bounded plain-text summary, not a CommonMark parser. Runtime uses the real Markdown parser. */
export function markdownPreviewLines(source: string, maximumLines: number): MarkdownPreviewLine[] {
  const lines: MarkdownPreviewLine[] = []
  if (maximumLines <= 0) return lines
  for (const sourceLine of source.split(/\r?\n/)) {
    const line = plainMarkdownLine(sourceLine)
    if (line) lines.push(line)
    if (lines.length >= maximumLines) break
  }
  return lines
}

export interface MarkdownPreviewBlock {
  text: string
  kind: 'text' | 'heading' | 'code' | 'quote' | 'rule' | 'space'
  level: number
}

/** Static source-line projection only: nested syntax, tables and inline runs remain approximate. */
export function markdownPreviewBlocks(source: string): MarkdownPreviewBlock[] {
  const blocks: MarkdownPreviewBlock[] = []
  let fence = ''
  for (const raw of source.split(/\r?\n/).slice(0, 256)) {
    const delimiter = /^\s{0,3}(`{3,}|~{3,})/.exec(raw)?.[1]
    if (delimiter && (!fence || (delimiter[0] === fence[0] && delimiter.length >= fence.length))) {
      fence = fence ? '' : delimiter
      continue
    }
    if (fence) {
      blocks.push({ text: raw.slice(0, 512) || ' ', kind: 'code', level: 0 })
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s/.exec(raw)
    const kind = heading ? 'heading' : 'text'
    const line = plainMarkdownLine(raw)
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(raw))
      blocks.push({ text: '', kind: 'rule', level: 0 })
    else if (line)
      blocks.push({
        text: line.text,
        kind: /^\s*>/.test(raw) ? 'quote' : kind,
        level: heading?.[1].length ?? 0
      })
    else blocks.push({ text: '', kind: 'space', level: 0 })
  }
  return blocks
}

export function markdownTextNode(node: SceneNode): SceneNode | null {
  if (node.type !== 'FRAME') return null
  const resolved = resolveMarkdownModule(node.interactiveProps?.module)
  if (!resolved?.ok) return null
  const blocks = markdownPreviewBlocks(resolved.config.source)
  const text = blocks.map((block) => block.text).join('\n')
  const projection = moduleLabelTextNode(
    node,
    text,
    node.width,
    resolved.config.fontSize,
    node.textLanguage || 'en'
  )
  let start = 0
  projection.styleRuns = blocks.flatMap((block) => {
    const offset = start
    start += block.text.length + 1
    return block.kind === 'heading' && block.text
      ? [{ start: offset, length: block.text.length, style: { fontWeight: 600 } }]
      : []
  })
  return projection
}
