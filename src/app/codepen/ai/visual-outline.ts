const MAX_OUTLINE_NODES = 80
const MAX_OUTLINE_DEPTH = 12
const MAX_TEXT_VALUES = 64
const MAX_TEXT_BYTES = 8 * 1024
const MAX_DATA_VALUES = 64
const MAX_VALUE_LENGTH = 160
const TEXT_TOKEN_PREFIX = '[[OPENPENCIL_CODEPEN_TEXT_'

const LABEL_ATTRIBUTES = Object.freeze([
  'role',
  'type',
  'aria-label',
  'alt',
  'placeholder',
  'value'
] as const)

const VISUAL_DATA_KEYS = new Set([
  'author',
  'badge',
  'brand',
  'button',
  'category',
  'cta',
  'description',
  'heading',
  'id',
  'label',
  'name',
  'price',
  'pricelabel',
  'rating',
  'status',
  'subtitle',
  'tag',
  'text',
  'title'
])

export interface CodePenAIOutlineNode {
  readonly index: number
  readonly parentIndex: number | null
  readonly tag: string
  readonly labels?: Readonly<Record<string, CodePenAITextReference>>
  readonly text?: readonly CodePenAITextReference[]
}

export interface CodePenAITextReference {
  readonly token: string
  readonly kind: 'visible-text' | 'label' | 'data'
  readonly characterCount: number
  readonly wordCount: number
}

export type CodePenAIDataValue =
  | Readonly<{
      readonly key: string
      readonly type: 'string'
      readonly text: CodePenAITextReference
    }>
  | Readonly<{
      readonly key: string
      readonly type: 'number' | 'boolean' | 'null'
      readonly value: number | boolean | null
    }>

export interface CodePenAIVisualOutline {
  readonly nodes: readonly CodePenAIOutlineNode[]
  readonly dataValues: readonly CodePenAIDataValue[]
  readonly truncated: Readonly<{ nodes: boolean; text: boolean; data: boolean }>
  readonly policy: Readonly<{
    trust: 'opaque-host-substituted-text'
    executableSourceIncluded: false
    resourceURLsIncluded: false
    literalTextReturnedToAI: false
  }>
}

/** @internal Host-only resolver; never include it in an AI tool result. */
export interface CodePenAIVisualOutlineBundle {
  readonly outline: CodePenAIVisualOutline
  resolveTextToken(token: string): string | undefined
}

type MutableOutlineState = {
  nodes: MutableOutlineNode[]
  textValues: number
  textBytes: number
  nodesTruncated: boolean
  textTruncated: boolean
}

type MutableOutlineNode = {
  index: number
  parentIndex: number | null
  tag: string
  labels?: Readonly<Record<string, CodePenAITextReference>>
  text: CodePenAITextReference[]
}

type TextReferenceState = {
  readonly substitutions: Map<string, string>
  nextToken: number
}

type HTMLStackEntry = Readonly<{ tag: string; nodeIndex: number | null; suppressed: boolean }>

const NON_RENDERED_TAGS = new Set(['head', 'link', 'meta', 'script', 'style', 'template', 'title'])
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

function boundedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH)
}

function labelsFor(
  attrs: Readonly<Record<string, string>>,
  references: TextReferenceState
): Readonly<Record<string, CodePenAITextReference>> | undefined {
  const labels: Record<string, CodePenAITextReference> = {}
  for (const key of LABEL_ATTRIBUTES) {
    const value = boundedText(attrs[key] ?? '')
    if (value && !/(?:javascript|data:|https?:\/\/)/i.test(value)) {
      labels[key] = textReference(value, 'label', references)
    }
  }
  return Object.keys(labels).length > 0 ? Object.freeze(labels) : undefined
}

function textReference(
  value: string,
  kind: CodePenAITextReference['kind'],
  state: TextReferenceState
): CodePenAITextReference {
  const token = `${TEXT_TOKEN_PREFIX}${String(state.nextToken++).padStart(4, '0')}]]`
  state.substitutions.set(token, value)
  return Object.freeze({
    token,
    kind,
    characterCount: Array.from(value).length,
    wordCount: value.split(/\s+/).filter(Boolean).length
  })
}

function decodeHTMLText(value: string): string {
  return value
    .replace(/&#(\d{1,7});/g, (_, code: string) =>
      String.fromCodePoint(Math.min(Number(code), 0x10ffff))
    )
    .replace(/&#x([\da-f]{1,6});/gi, (_, code: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff))
    )
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g, (entity) => {
      const values: Record<string, string> = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'"
      }
      return values[entity] ?? ''
    })
}

function parseAttributes(raw: string): Readonly<Record<string, string>> {
  const attributes: Record<string, string> = {}
  const pattern =
    /([A-Za-z_:][A-Za-z0-9_:.-]{0,80})(?:\s*=\s*(?:"([^"]{0,1024})"|'([^']{0,1024})'|([^\s"'=<>`]{1,1024})))?/g
  for (const match of raw.matchAll(pattern)) {
    const name = match[1].toLowerCase()
    if (name === 'src' || name === 'href' || name.startsWith('on')) continue
    attributes[name] = decodeHTMLText(match[2] || match[3] || match[4] || '')
  }
  return attributes
}

function tagEnd(html: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < html.length && index - start <= 4096; index++) {
    const char = html[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function appendText(
  raw: string,
  stack: readonly HTMLStackEntry[],
  state: MutableOutlineState,
  references: TextReferenceState
): void {
  if (stack.at(-1)?.suppressed) return
  const nodeIndex = [...stack].reverse().find(({ nodeIndex: value }) => value !== null)?.nodeIndex
  if (nodeIndex === undefined || nodeIndex === null) return
  const value = boundedText(decodeHTMLText(raw))
  if (!value) return
  const bytes = new TextEncoder().encode(value).byteLength
  if (state.textValues >= MAX_TEXT_VALUES || state.textBytes + bytes > MAX_TEXT_BYTES) {
    state.textTruncated = true
    return
  }
  state.textValues++
  state.textBytes += bytes
  state.nodes[nodeIndex]?.text.push(textReference(value, 'visible-text', references))
}

function closeTag(stack: HTMLStackEntry[], tag: string): void {
  for (let index = stack.length - 1; index >= 0; index--) {
    if (stack[index]?.tag !== tag) continue
    stack.splice(index)
    return
  }
}

function parentIndex(stack: readonly HTMLStackEntry[]): number | null {
  return [...stack].reverse().find(({ nodeIndex }) => nodeIndex !== null)?.nodeIndex ?? null
}

function appendTag(
  raw: string,
  stack: HTMLStackEntry[],
  state: MutableOutlineState,
  references: TextReferenceState
): void {
  const closing = /^<\s*\//.test(raw)
  const match = /^<\s*\/?\s*([A-Za-z][A-Za-z0-9-]{0,80})/.exec(raw)
  if (!match) return
  const tag = match[1].toLowerCase()
  if (closing) {
    closeTag(stack, tag)
    return
  }
  const suppressed = stack.at(-1)?.suppressed === true || NON_RENDERED_TAGS.has(tag)
  const selfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(tag)
  if (suppressed) {
    if (!selfClosing) stack.push(Object.freeze({ tag, nodeIndex: null, suppressed: true }))
    return
  }
  if (stack.length > MAX_OUTLINE_DEPTH || state.nodes.length >= MAX_OUTLINE_NODES) {
    state.nodesTruncated = true
    if (!selfClosing) stack.push(Object.freeze({ tag, nodeIndex: null, suppressed: false }))
    return
  }
  const attrs = parseAttributes(raw.slice(match[0].length, -1))
  const labels = labelsFor(attrs, references)
  const index = state.nodes.length
  state.nodes.push({
    index,
    parentIndex: parentIndex(stack),
    tag,
    ...(labels ? { labels } : {}),
    text: []
  })
  if (!selfClosing) stack.push(Object.freeze({ tag, nodeIndex: index, suppressed: false }))
}

function outlineNodes(
  html: string,
  references: TextReferenceState
): Readonly<{
  nodes: readonly CodePenAIOutlineNode[]
  nodesTruncated: boolean
  textTruncated: boolean
}> {
  const state: MutableOutlineState = {
    nodes: [],
    textValues: 0,
    textBytes: 0,
    nodesTruncated: false,
    textTruncated: false
  }
  const stack: HTMLStackEntry[] = []
  let index = 0
  while (index < html.length) {
    const next = html.indexOf('<', index)
    if (next === -1) {
      appendText(html.slice(index), stack, state, references)
      break
    }
    appendText(html.slice(index, next), stack, state, references)
    if (html.startsWith('<!--', next)) {
      const commentEnd = html.indexOf('-->', next + 4)
      index = commentEnd === -1 ? html.length : commentEnd + 3
      continue
    }
    const end = tagEnd(html, next)
    if (end === -1) break
    appendTag(html.slice(next, end + 1), stack, state, references)
    index = end + 1
  }
  return Object.freeze({
    nodes: Object.freeze(
      state.nodes.map(({ text, ...node }) =>
        Object.freeze({ ...node, ...(text.length > 0 ? { text: Object.freeze(text) } : {}) })
      )
    ),
    nodesTruncated: state.nodesTruncated,
    textTruncated: state.textTruncated
  })
}

function normalizedDataKey(value: string): string | null {
  const key = value.replace(/[_-]/g, '').toLowerCase()
  return VISUAL_DATA_KEYS.has(key) ? key : null
}

function literalValue(
  quote: string | undefined,
  raw: string | undefined,
  number: string | undefined
) {
  if (number !== undefined) {
    const value = Number(number)
    return Number.isFinite(value) ? value : null
  }
  if (!quote || raw === undefined) return null
  const value = boundedText(raw.replace(/\\(?:n|r|t)/g, ' ').replace(/\\([\\"'`])/g, '$1'))
  if (!value || /^(?:data:|javascript:|https?:\/\/|\/\/)/i.test(value)) return null
  return value
}

function dataValues(
  js: string,
  references: TextReferenceState
): Readonly<{ values: readonly CodePenAIDataValue[]; truncated: boolean }> {
  const values: CodePenAIDataValue[] = []
  const seen = new Set<string>()
  const pattern =
    /(?:^|[,{])\s*([A-Za-z_$][\w$-]{0,40})\s*:\s*(?:(["'`])((?:\\.|(?!\2)[\s\S]){0,256})\2|(-?\d+(?:\.\d+)?|true|false|null))/gm
  let matches = 0
  for (const match of js.matchAll(pattern)) {
    const key = normalizedDataKey(match[1])
    if (!key) continue
    const primitive = match[4]
    let value: string | number | boolean | null
    if (primitive === 'true') value = true
    else if (primitive === 'false') value = false
    else if (primitive === 'null') value = null
    else value = literalValue(match[2], match[3], primitive)
    if (value === null && primitive !== 'null') continue
    const identity = `${key}:${String(value)}`
    if (seen.has(identity)) continue
    seen.add(identity)
    matches++
    if (values.length < MAX_DATA_VALUES) {
      if (typeof value === 'string') {
        values.push(
          Object.freeze({ key, type: 'string', text: textReference(value, 'data', references) })
        )
      } else if (typeof value === 'number') {
        values.push(Object.freeze({ key, type: 'number', value }))
      } else if (typeof value === 'boolean') {
        values.push(Object.freeze({ key, type: 'boolean', value }))
      } else {
        values.push(Object.freeze({ key, type: 'null', value: null }))
      }
    }
  }
  return Object.freeze({ values: Object.freeze(values), truncated: matches > values.length })
}

export function deriveCodePenAIVisualOutline(input: {
  readonly html: string
  readonly css: string
  readonly js: string
}): CodePenAIVisualOutline {
  return createCodePenAIVisualOutlineBundle(input).outline
}

/** @internal Creates the AI-safe outline plus a host-only literal resolver. */
export function createCodePenAIVisualOutlineBundle(input: {
  readonly html: string
  readonly css: string
  readonly js: string
}): CodePenAIVisualOutlineBundle {
  const references: TextReferenceState = { substitutions: new Map(), nextToken: 1 }
  const nodeResult = outlineNodes(input.html, references)
  const dataResult = dataValues(input.js, references)
  const outline = Object.freeze({
    nodes: nodeResult.nodes,
    dataValues: dataResult.values,
    truncated: Object.freeze({
      nodes: nodeResult.nodesTruncated,
      text: nodeResult.textTruncated,
      data: dataResult.truncated
    }),
    policy: Object.freeze({
      trust: 'opaque-host-substituted-text' as const,
      executableSourceIncluded: false as const,
      resourceURLsIncluded: false as const,
      literalTextReturnedToAI: false as const
    })
  })
  return Object.freeze({
    outline,
    resolveTextToken: (token: string) => references.substitutions.get(token)
  })
}
