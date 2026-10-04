/** Strict data-only AST projection embedded in the reviewed React runtime. */
export const RICH_TEXT_CONTROLLED_RUNTIME = `
function richRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) return null
  const actual = Reflect.ownKeys(value)
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) return null
  const result: Record<string, unknown> = Object.create(null)
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    result[key] = descriptor.value
  }
  return result
}

function richArray(value: unknown, limit: number): unknown[] | null {
  if (!Array.isArray(value) || value.length > limit || Reflect.ownKeys(value).length !== value.length + 1) return null
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null
    result.push(descriptor.value)
  }
  return result
}

function projectRichText(value: unknown): OpenPencilRichTextDocument | null {
  try {
    const doc = richRecord(value, ['type', 'blocks'])
    const blocks = doc && doc.type === 'doc' ? richArray(doc.blocks, LIMITS.blocks) : null
    if (!blocks) return null
    let inlineCount = 0
    let listCount = 0
    let markCount = 0
    let textCount = 0
    const text = (value: unknown, limit: number): string | null => {
      if (typeof value !== 'string' || value.length > limit) return null
      textCount += value.length
      return textCount <= LIMITS.totalText ? value : null
    }
    const children = (value: unknown): RichTextInline[] | null => {
      const items = richArray(value, LIMITS.inlinesPerBlock)
      if (!items) return null
      const result: RichTextInline[] = []
      for (const item of items) {
        const inline = richRecord(item, ['type', 'text', 'marks'])
        if (!inline || inline.type !== 'text' || ++inlineCount > LIMITS.inlines) return null
        const content = text(inline.text, LIMITS.textPerInline)
        const rawMarks = richArray(inline.marks, LIMITS.marksPerInline)
        if (content === null || !rawMarks) return null
        const marks: RichTextMark[] = []
        const seen = new Set<string>()
        for (const raw of rawMarks) {
          const type = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'type')?.value : undefined
          const mark = richRecord(raw, type === 'link' ? ['type', 'href'] : ['type'])
          if (!mark || typeof type !== 'string' || seen.has(type) || ++markCount > LIMITS.marks) return null
          seen.add(type)
          if (type === 'link') {
            if (typeof mark.href !== 'string' || !safeHref(mark.href)) return null
            marks.push({ type: 'link', href: mark.href })
          } else {
            if (!(SIMPLE_MARK_ORDER as readonly string[]).includes(type)) return null
            marks.push({ type: type as SimpleMark })
          }
        }
        result.push({ type: 'text', text: content, marks })
      }
      return result
    }
    const result: RichTextBlock[] = []
    for (const raw of blocks) {
      const type = raw && typeof raw === 'object' ? Object.getOwnPropertyDescriptor(raw, 'type')?.value : undefined
      if (type === 'codeBlock') {
        const block = richRecord(raw, ['type', 'language', 'text'])
        if (!block || typeof block.language !== 'string' || block.language.length > 32 || !/^[A-Za-z0-9_+#.-]*$/.test(block.language)) return null
        const content = text(block.text, LIMITS.codeBlockText)
        if (content === null) return null
        result.push({ type, language: block.language, text: content })
      } else if (type === 'bulletList' || type === 'orderedList') {
        const block = richRecord(raw, ['type', 'items'])
        const items = block ? richArray(block.items, LIMITS.listItemsPerBlock) : null
        if (!items) return null
        const next: { children: RichTextInline[] }[] = []
        for (const rawItem of items) {
          const item = richRecord(rawItem, ['children'])
          const content = item ? children(item.children) : null
          if (!content || ++listCount > LIMITS.listItems) return null
          next.push({ children: content })
        }
        result.push({ type, items: next })
      } else if (type === 'paragraph' || type === 'heading' || type === 'blockquote') {
        const keys = type === 'paragraph' ? ['type', 'align', 'children'] : type === 'heading' ? ['type', 'level', 'align', 'children'] : ['type', 'children']
        const block = richRecord(raw, keys)
        const content = block ? children(block.children) : null
        if (!block || !content) return null
        if (type === 'blockquote') result.push({ type, children: content })
        else {
          if (block.align !== 'left' && block.align !== 'center' && block.align !== 'right') return null
          if (type === 'paragraph') result.push({ type, align: block.align, children: content })
          else {
            if (block.level !== 1 && block.level !== 2 && block.level !== 3) return null
            result.push({ type, level: block.level, align: block.align, children: content })
          }
        }
      } else return null
    }
    return { type: 'doc', blocks: result }
  } catch {
    return null
  }
}
`
