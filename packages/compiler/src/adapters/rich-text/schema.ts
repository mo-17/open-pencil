/** Framework-neutral declarations for generated RichText components. */
export function buildRichTextSchemaTypes(exportTypes: boolean): string {
  const prefix = exportTypes ? 'export ' : ''
  return `type RichTextAlign = 'left' | 'center' | 'right'
type RichTextMark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'code' }
  | { type: 'link'; href: string }

interface RichTextInline {
  type: 'text'
  text: string
  marks: readonly RichTextMark[]
}

type RichTextBlock =
  | { type: 'paragraph'; align: RichTextAlign; children: readonly RichTextInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; align: RichTextAlign; children: readonly RichTextInline[] }
  | { type: 'blockquote'; children: readonly RichTextInline[] }
  | { type: 'codeBlock'; language: string; text: string }
  | {
      type: 'bulletList' | 'orderedList'
      items: readonly { children: readonly RichTextInline[] }[]
    }

${prefix}interface OpenPencilRichTextDocument {
  type: 'doc'
  blocks: readonly RichTextBlock[]
}

${prefix}interface OpenPencilRichTextConfig {
  content: OpenPencilRichTextDocument
  textColor: string
  linkColor: string
  fontSize: number
  lineHeight: number
}`
}

/** Shared bounds, parsing budget, and safe link policy. */
export const RICH_TEXT_PARSE_RUNTIME = `const LIMITS = {
  blocks: 64,
  codeBlockText: 8000,
  inlines: 256,
  inlinesPerBlock: 64,
  listItems: 128,
  listItemsPerBlock: 32,
  marks: 256,
  marksPerInline: 4,
  textPerInline: 2000,
  totalText: 24000
} as const

const SIMPLE_MARK_ORDER = ['bold', 'italic', 'underline', 'strike', 'code'] as const
type SimpleMark = (typeof SIMPLE_MARK_ORDER)[number]

interface ParseBudget {
  inlines: number
  listItems: number
  marks: number
  totalText: number
  truncated: boolean
}

function safeHref(value: string): string | null {
  if (value.length === 0 || value.length > 2048 || value.trim() !== value) return null
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return null
  }
  if (value.startsWith('/') && !value.startsWith('//')) return value
  if (value.startsWith('#') || value.startsWith('?')) return value
  return /^(?:https?:|mailto:|tel:)/i.test(value) ? value : null
}`
