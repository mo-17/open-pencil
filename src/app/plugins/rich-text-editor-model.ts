import {
  RICH_TEXT_MODULE_LIMITS,
  isSafeRichTextHref,
  type RichTextAlignmentV1,
  type RichTextBlockV1,
  type RichTextBlockquoteV1,
  type RichTextHeadingV1,
  type RichTextInlineV1,
  type RichTextMarkV1,
  type RichTextParagraphV1,
  type RichTextSimpleMarkTypeV1
} from '@open-pencil/core/plugins'

/** Safe editor operations shared by the Rich Text property surface and its tests. */
export type RichTextEditorBlockKind =
  | 'paragraph'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'blockquote'
  | 'codeBlock'
  | 'bulletList'
  | 'orderedList'

export const RICH_TEXT_EDITOR_BLOCK_KINDS: readonly RichTextEditorBlockKind[] = Object.freeze([
  'paragraph',
  'heading-1',
  'heading-2',
  'heading-3',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList'
])

export function createRichTextInline(text = ''): RichTextInlineV1 {
  return { type: 'text', text, marks: [] }
}

export function richTextEditorBlockKind(block: RichTextBlockV1): RichTextEditorBlockKind {
  return block.type === 'heading' ? `heading-${block.level}` : block.type
}

function cloneInlines(children: readonly RichTextInlineV1[]): RichTextInlineV1[] {
  return children.map((inline) => structuredClone(inline))
}

type RichTextChildrenBlock = RichTextParagraphV1 | RichTextHeadingV1 | RichTextBlockquoteV1

function isChildrenBlock(block: RichTextBlockV1): block is RichTextChildrenBlock {
  return block.type === 'paragraph' || block.type === 'heading' || block.type === 'blockquote'
}

function blockInlines(block: RichTextBlockV1): RichTextInlineV1[] {
  if (block.type === 'codeBlock') return [createRichTextInline(block.text)]
  if (isChildrenBlock(block)) return cloneInlines(block.children)
  const children: RichTextInlineV1[] = []
  block.items.forEach((item, index) => {
    children.push(...cloneInlines(item.children))
    if (index < block.items.length - 1) children.push(createRichTextInline('\n'))
  })
  return children.length > 0 ? children : [createRichTextInline()]
}

function blockPlainText(block: RichTextBlockV1): string {
  if (block.type === 'codeBlock') return block.text
  if (block.type === 'bulletList' || block.type === 'orderedList') {
    return block.items.map((item) => item.children.map((inline) => inline.text).join('')).join('\n')
  }
  return isChildrenBlock(block) ? block.children.map((inline) => inline.text).join('') : ''
}

function blockAlignment(block: RichTextBlockV1): RichTextAlignmentV1 {
  return block.type === 'paragraph' || block.type === 'heading' ? block.align : 'left'
}

export function createRichTextBlock(kind: RichTextEditorBlockKind): RichTextBlockV1 {
  if (kind === 'codeBlock') return { type: 'codeBlock', language: '', text: '' }
  if (kind === 'bulletList' || kind === 'orderedList') {
    return { type: kind, items: [{ children: [createRichTextInline()] }] }
  }
  if (kind === 'blockquote') return { type: 'blockquote', children: [createRichTextInline()] }
  if (kind.startsWith('heading-')) {
    return {
      type: 'heading',
      level: Number(kind.slice(-1)) as 1 | 2 | 3,
      align: 'left',
      children: [createRichTextInline()]
    }
  }
  return { type: 'paragraph', align: 'left', children: [createRichTextInline()] }
}

export function convertRichTextBlock(
  block: RichTextBlockV1,
  kind: RichTextEditorBlockKind
): RichTextBlockV1 {
  if (richTextEditorBlockKind(block) === kind) return structuredClone(block)
  if (kind === 'codeBlock') {
    return { type: 'codeBlock', language: '', text: blockPlainText(block) }
  }
  if (kind === 'bulletList' || kind === 'orderedList') {
    if (block.type === 'bulletList' || block.type === 'orderedList') {
      return { type: kind, items: structuredClone(block.items) }
    }
    return { type: kind, items: [{ children: blockInlines(block) }] }
  }
  const children = blockInlines(block)
  if (kind === 'blockquote') return { type: 'blockquote', children }
  if (kind.startsWith('heading-')) {
    return {
      type: 'heading',
      level: Number(kind.slice(-1)) as 1 | 2 | 3,
      align: blockAlignment(block),
      children
    }
  }
  return { type: 'paragraph', align: blockAlignment(block), children }
}

function hasMark(inline: RichTextInlineV1, type: RichTextMarkV1['type']): boolean {
  return inline.marks.some((mark) => mark.type === type)
}

export function toggleRichTextInlineMark(
  inline: RichTextInlineV1,
  type: RichTextSimpleMarkTypeV1
): RichTextInlineV1 {
  if (hasMark(inline, type)) {
    return { ...inline, marks: inline.marks.filter((mark) => mark.type !== type) }
  }
  if (inline.marks.length >= RICH_TEXT_MODULE_LIMITS.marksPerInline) {
    throw new RangeError(
      `Rich text inline supports at most ${RICH_TEXT_MODULE_LIMITS.marksPerInline} marks`
    )
  }
  return { ...inline, marks: [...inline.marks, { type }] }
}

export function setRichTextInlineLink(inline: RichTextInlineV1, href: string): RichTextInlineV1 {
  const marks = inline.marks.filter((mark) => mark.type !== 'link')
  if (href === '') return { ...inline, marks }
  if (!isSafeRichTextHref(href)) throw new TypeError('Link must use a safe URL')
  if (!hasMark(inline, 'link') && inline.marks.length >= RICH_TEXT_MODULE_LIMITS.marksPerInline) {
    throw new RangeError(
      `Rich text inline supports at most ${RICH_TEXT_MODULE_LIMITS.marksPerInline} marks`
    )
  }
  return { ...inline, marks: [...marks, { type: 'link', href }] }
}

export function richTextInlineLink(inline: RichTextInlineV1): string {
  const mark = inline.marks.find((candidate) => candidate.type === 'link')
  return mark?.type === 'link' ? mark.href : ''
}
