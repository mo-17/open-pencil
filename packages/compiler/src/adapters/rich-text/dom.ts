/** Safe DOM creation and bounded DOM-to-AST reading for the reviewed editor. */
export const RICH_TEXT_DOM_RUNTIME = `
function appendInlineElement(
  parent: HTMLElement,
  inline: RichTextInline,
  linkColor: string
): void {
  let content: Node = document.createTextNode(inline.text)
  for (const mark of inline.marks) {
    let wrapper: HTMLElement
    if (mark.type === 'link') {
      const href = safeHref(mark.href)
      if (!href) continue
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.rel = 'noopener noreferrer'
      anchor.style.color = linkColor
      wrapper = anchor
    } else {
      const tag =
        mark.type === 'bold'
          ? 'strong'
          : mark.type === 'italic'
            ? 'em'
            : mark.type === 'underline'
              ? 'u'
              : mark.type === 'strike'
                ? 's'
                : 'code'
      wrapper = document.createElement(tag)
    }
    wrapper.append(content)
    content = wrapper
  }
  parent.append(content)
}

function appendInlines(
  parent: HTMLElement,
  children: readonly RichTextInline[],
  linkColor: string
): void {
  for (const child of children) appendInlineElement(parent, child, linkColor)
}

function createBlockElement(block: RichTextBlock, linkColor: string): HTMLElement {
  if (block.type === 'paragraph') {
    const paragraph = document.createElement('p')
    paragraph.style.margin = '0'
    paragraph.style.textAlign = block.align
    appendInlines(paragraph, block.children, linkColor)
    return paragraph
  }
  if (block.type === 'heading') {
    const heading = document.createElement('h' + block.level)
    heading.style.margin = '0'
    heading.style.textAlign = block.align
    appendInlines(heading, block.children, linkColor)
    return heading
  }
  if (block.type === 'blockquote') {
    const quote = document.createElement('blockquote')
    quote.style.borderInlineStart = '3px solid currentColor'
    quote.style.margin = '0'
    quote.style.paddingInlineStart = '1em'
    appendInlines(quote, block.children, linkColor)
    return quote
  }
  if (block.type === 'codeBlock') {
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.style.margin = '0'
    pre.style.overflowX = 'auto'
    pre.style.whiteSpace = 'pre-wrap'
    code.dataset.language = block.language
    code.append(document.createTextNode(block.text))
    pre.append(code)
    return pre
  }
  const list = document.createElement(block.type === 'orderedList' ? 'ol' : 'ul')
  list.style.margin = '0'
  list.style.paddingInlineStart = '1.5em'
  for (const item of block.items) {
    const listItem = document.createElement('li')
    appendInlines(listItem, item.children, linkColor)
    list.append(listItem)
  }
  return list
}

function mountDocument(
  editor: HTMLElement,
  value: OpenPencilRichTextDocument,
  linkColor: string
): void {
  const fragment = document.createDocumentFragment()
  for (const block of value.blocks) fragment.append(createBlockElement(block, linkColor))
  if (value.blocks.length === 0) fragment.append(createBlockElement(
    { type: 'paragraph', align: 'left', children: [] },
    linkColor
  ))
  editor.replaceChildren(fragment)
}

function sameMarks(left: readonly RichTextMark[], right: readonly RichTextMark[]): boolean {
  if (left.length !== right.length) return false
  return left.every((mark, index) => {
    const candidate = right[index]
    return (
      candidate?.type === mark.type &&
      (mark.type !== 'link' || (candidate.type === 'link' && candidate.href === mark.href))
    )
  })
}

function normalizeMarks(marks: readonly RichTextMark[]): RichTextMark[] {
  const simple = new Map<SimpleMark, RichTextMark>()
  let link: RichTextMark | undefined
  for (const mark of marks) {
    if (mark.type === 'link') {
      const href = safeHref(mark.href)
      if (href) link = { type: 'link', href }
    } else if (!simple.has(mark.type)) {
      simple.set(mark.type, { type: mark.type })
    }
  }
  const normalized = SIMPLE_MARK_ORDER.flatMap((type) => {
    const mark = simple.get(type)
    return mark ? [mark] : []
  })
  if (link) normalized.splice(Math.min(3, normalized.length), 0, link)
  return normalized.slice(0, LIMITS.marksPerInline)
}

function marksForElement(element: HTMLElement, inherited: readonly RichTextMark[]): RichTextMark[] {
  const marks = [...inherited]
  const tag = element.tagName.toLowerCase()
  if (tag === 'b' || tag === 'strong') marks.push({ type: 'bold' })
  if (tag === 'i' || tag === 'em') marks.push({ type: 'italic' })
  if (tag === 'u') marks.push({ type: 'underline' })
  if (tag === 's' || tag === 'strike') marks.push({ type: 'strike' })
  if (tag === 'code') marks.push({ type: 'code' })
  if (tag === 'a') {
    const href = safeHref(element.getAttribute('href') ?? '')
    if (href) marks.push({ type: 'link', href })
  }

  const weight = element.style.fontWeight
  if (weight === 'bold' || Number.parseInt(weight, 10) >= 600) marks.push({ type: 'bold' })
  if (element.style.fontStyle === 'italic') marks.push({ type: 'italic' })
  const decoration = element.style.textDecorationLine || element.style.textDecoration
  if (decoration.includes('underline')) marks.push({ type: 'underline' })
  if (decoration.includes('line-through')) marks.push({ type: 'strike' })
  return normalizeMarks(marks)
}

function appendInline(
  inlines: RichTextInline[],
  text: string,
  marks: readonly RichTextMark[],
  budget: ParseBudget
): void {
  if (text.length === 0) return
  const remainingTotal = Math.max(0, LIMITS.totalText - budget.totalText)
  const clipped = text.slice(0, Math.min(LIMITS.textPerInline, remainingTotal))
  if (clipped.length !== text.length) budget.truncated = true
  if (clipped.length === 0) return

  const normalizedMarks = normalizeMarks(marks)
  const previous = inlines.at(-1)
  if (
    previous &&
    sameMarks(previous.marks, normalizedMarks) &&
    previous.text.length + clipped.length <= LIMITS.textPerInline
  ) {
    inlines[inlines.length - 1] = { ...previous, text: previous.text + clipped }
    budget.totalText += clipped.length
    return
  }
  if (inlines.length >= LIMITS.inlinesPerBlock || budget.inlines >= LIMITS.inlines) {
    budget.truncated = true
    return
  }
  const remainingMarks = Math.max(0, LIMITS.marks - budget.marks)
  const boundedMarks = normalizedMarks.slice(0, remainingMarks)
  if (boundedMarks.length !== normalizedMarks.length) budget.truncated = true
  inlines.push({ type: 'text', text: clipped, marks: boundedMarks })
  budget.inlines += 1
  budget.marks += boundedMarks.length
  budget.totalText += clipped.length
}

function readInlineNodes(
  nodes: Iterable<ChildNode>,
  inherited: readonly RichTextMark[],
  budget: ParseBudget,
  result: RichTextInline[] = []
): RichTextInline[] {
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      appendInline(result, node.textContent ?? '', inherited, budget)
      continue
    }
    if (!(node instanceof HTMLElement)) continue
    if (node.tagName.toLowerCase() === 'br') {
      appendInline(result, '\\n', inherited, budget)
      continue
    }
    readInlineNodes(node.childNodes, marksForElement(node, inherited), budget, result)
  }
  return result
}

function readAlignment(element: HTMLElement): RichTextAlign {
  const alignment = element.style.textAlign || element.getAttribute('align') || ''
  return alignment === 'center' || alignment === 'right' ? alignment : 'left'
}

function readTextBlock(
  element: HTMLElement,
  budget: ParseBudget,
  type: 'paragraph' | 'blockquote' | 'heading',
  level?: 1 | 2 | 3
): RichTextBlock {
  const children = readInlineNodes(element.childNodes, [], budget)
  if (type === 'blockquote') return { type, children }
  if (type === 'heading' && level) {
    return { type, level, align: readAlignment(element), children }
  }
  return { type: 'paragraph', align: readAlignment(element), children }
}

function readListBlock(
  element: HTMLElement,
  budget: ParseBudget,
  type: 'bulletList' | 'orderedList'
): RichTextBlock {
  const items: { children: readonly RichTextInline[] }[] = []
  for (const child of element.children) {
    if (!(child instanceof HTMLElement) || child.tagName.toLowerCase() !== 'li') continue
    if (items.length >= LIMITS.listItemsPerBlock || budget.listItems >= LIMITS.listItems) {
      budget.truncated = true
      break
    }
    items.push({ children: readInlineNodes(child.childNodes, [], budget) })
    budget.listItems += 1
  }
  return { type, items }
}

function readBlock(node: ChildNode, budget: ParseBudget): RichTextBlock | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const children: RichTextInline[] = []
    appendInline(children, node.textContent ?? '', [], budget)
    return children.length > 0 ? { type: 'paragraph', align: 'left', children } : null
  }
  if (!(node instanceof HTMLElement)) return null
  const tag = node.tagName.toLowerCase()
  if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
    return readTextBlock(node, budget, 'heading', Number(tag[1]) as 1 | 2 | 3)
  }
  if (tag === 'blockquote') return readTextBlock(node, budget, 'blockquote')
  if (tag === 'pre') {
    const remaining = Math.max(0, LIMITS.totalText - budget.totalText)
    const source = node.textContent ?? ''
    const text = source.slice(0, Math.min(LIMITS.codeBlockText, remaining))
    if (text.length !== source.length) budget.truncated = true
    budget.totalText += text.length
    const language = node.querySelector('code')?.getAttribute('data-language') ?? ''
    return { type: 'codeBlock', language: /^[A-Za-z0-9_+#.-]{0,32}$/.test(language) ? language : '', text }
  }
  if (tag === 'ol' || tag === 'ul') {
    return readListBlock(node, budget, tag === 'ol' ? 'orderedList' : 'bulletList')
  }
  return readTextBlock(node, budget, 'paragraph')
}

function readDocument(editor: HTMLElement): {
  document: OpenPencilRichTextDocument
  truncated: boolean
} {
  const budget: ParseBudget = {
    inlines: 0,
    listItems: 0,
    marks: 0,
    totalText: 0,
    truncated: false
  }
  const blocks: RichTextBlock[] = []
  for (const node of editor.childNodes) {
    if (blocks.length >= LIMITS.blocks) {
      budget.truncated = true
      break
    }
    const block = readBlock(node, budget)
    if (block) blocks.push(block)
  }
  if (blocks.length === 0) {
    blocks.push({ type: 'paragraph', align: 'left', children: [] })
  }
  return { document: { type: 'doc', blocks }, truncated: budget.truncated }
}

`
