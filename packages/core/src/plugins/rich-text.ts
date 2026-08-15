import { hasExactPluginKeys } from '@open-pencil/plugin-contracts/adapter-helpers'
import {
  isPlainJSONObject,
  validateModuleInstance,
  type ModuleInstanceV1,
  type SceneNode
} from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { createModuleFrameOverrides } from './module-frame'
import type { ModuleDefinition, ModulePropertyField, ModuleResolution } from './types'

export const RICH_TEXT_PLUGIN_ID = 'open-pencil.rich-text'
export const RICH_TEXT_MODULE_TYPE = 'rich-text'
export const RICH_TEXT_MODULE_CONFIG_VERSION = 1
export const RICH_TEXT_MODULE_DEFAULT_SIZE = Object.freeze({ width: 480, height: 320 })
export const RICH_TEXT_MODULE_LIMITS = Object.freeze({
  blocks: 64,
  inlinesPerBlock: 64,
  inlines: 256,
  listItemsPerBlock: 32,
  listItems: 128,
  marksPerInline: 4,
  marks: 256,
  textPerInline: 2_000,
  codeBlockText: 8_000,
  totalText: 24_000,
  href: 2_048,
  language: 32,
  fontSizeMin: 8,
  fontSizeMax: 96,
  lineHeightMin: 1,
  lineHeightMax: 3
})

export type RichTextAlignmentV1 = 'left' | 'center' | 'right'
export type RichTextSimpleMarkTypeV1 = 'bold' | 'italic' | 'underline' | 'strike' | 'code'

export interface RichTextSimpleMarkV1 extends JSONObject {
  type: RichTextSimpleMarkTypeV1
}

export interface RichTextLinkMarkV1 extends JSONObject {
  type: 'link'
  href: string
}

export type RichTextMarkV1 = RichTextSimpleMarkV1 | RichTextLinkMarkV1

export interface RichTextInlineV1 extends JSONObject {
  type: 'text'
  text: string
  marks: RichTextMarkV1[]
}

export interface RichTextParagraphV1 extends JSONObject {
  type: 'paragraph'
  align: RichTextAlignmentV1
  children: RichTextInlineV1[]
}

export interface RichTextHeadingV1 extends JSONObject {
  type: 'heading'
  level: 1 | 2 | 3
  align: RichTextAlignmentV1
  children: RichTextInlineV1[]
}

export interface RichTextBlockquoteV1 extends JSONObject {
  type: 'blockquote'
  children: RichTextInlineV1[]
}

export interface RichTextCodeBlockV1 extends JSONObject {
  type: 'codeBlock'
  language: string
  text: string
}

export interface RichTextListItemV1 extends JSONObject {
  children: RichTextInlineV1[]
}

export interface RichTextListV1 extends JSONObject {
  type: 'bulletList' | 'orderedList'
  items: RichTextListItemV1[]
}

export type RichTextBlockV1 =
  | RichTextParagraphV1
  | RichTextHeadingV1
  | RichTextBlockquoteV1
  | RichTextCodeBlockV1
  | RichTextListV1

export interface RichTextDocumentV1 extends JSONObject {
  type: 'doc'
  blocks: RichTextBlockV1[]
}

export interface RichTextModuleConfigV1 extends JSONObject {
  content: RichTextDocumentV1
  textColor: string
  linkColor: string
  fontSize: number
  lineHeight: number
}

export type RichTextModuleConfig = RichTextModuleConfigV1

const DEFAULT_HEADING_MARKS: RichTextMarkV1[] = [{ type: 'bold' }]
const DEFAULT_BODY_MARKS: RichTextMarkV1[] = []
const DEFAULT_BLOCKS: RichTextBlockV1[] = [
  {
    type: 'heading',
    level: 2,
    align: 'left',
    children: [{ type: 'text', text: 'Rich text', marks: DEFAULT_HEADING_MARKS }]
  },
  {
    type: 'paragraph',
    align: 'left',
    children: [
      {
        type: 'text',
        text: 'Write structured content with safe formatting.',
        marks: DEFAULT_BODY_MARKS
      }
    ]
  }
]
Object.freeze(DEFAULT_HEADING_MARKS[0])
Object.freeze(DEFAULT_HEADING_MARKS)
Object.freeze(DEFAULT_BODY_MARKS)
DEFAULT_BLOCKS.forEach((block) => {
  if ('children' in block) Object.freeze(block.children)
  Object.freeze(block)
})
Object.freeze(DEFAULT_BLOCKS)

export const RICH_TEXT_MODULE_DEFAULT_CONFIG: Readonly<RichTextModuleConfigV1> = Object.freeze({
  content: Object.freeze({ type: 'doc', blocks: DEFAULT_BLOCKS }),
  textColor: '#111827',
  linkColor: '#2563EB',
  fontSize: 16,
  lineHeight: 1.5
})

const CONFIG_KEYS = new Set(['content', 'textColor', 'linkColor', 'fontSize', 'lineHeight'])
const DOCUMENT_KEYS = new Set(['type', 'blocks'])
const PARAGRAPH_KEYS = new Set(['type', 'align', 'children'])
const HEADING_KEYS = new Set(['type', 'level', 'align', 'children'])
const BLOCKQUOTE_KEYS = new Set(['type', 'children'])
const CODE_BLOCK_KEYS = new Set(['type', 'language', 'text'])
const LIST_KEYS = new Set(['type', 'items'])
const LIST_ITEM_KEYS = new Set(['children'])
const INLINE_KEYS = new Set(['type', 'text', 'marks'])
const SIMPLE_MARK_KEYS = new Set(['type'])
const LINK_MARK_KEYS = new Set(['type', 'href'])
const ALIGNMENTS = new Set<RichTextAlignmentV1>(['left', 'center', 'right'])
const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code'])
const HEX_COLOR = /^#[\dA-F]{6}$/i
const LANGUAGE = /^[A-Za-z0-9_+#.-]*$/

type ParseResult<T> = { ok: true; value: T } | { ok: false; reason: string }

interface ParseState {
  inlines: number
  listItems: number
  marks: number
  totalText: number
}

function fail<T>(reason: string): ParseResult<T> {
  return { ok: false, reason }
}

function addText(state: ParseState, text: string, limit: number, path: string): string | null {
  if (text.length > limit) return `${path} exceeds ${limit} characters`
  state.totalText += text.length
  return state.totalText > RICH_TEXT_MODULE_LIMITS.totalText
    ? `rich text document exceeds ${RICH_TEXT_MODULE_LIMITS.totalText} characters`
    : null
}

export function isSafeRichTextHref(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > RICH_TEXT_MODULE_LIMITS.href ||
    value.trim() !== value
  ) {
    return false
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return false
  }
  if (value.startsWith('/') && !value.startsWith('//')) return true
  if (value.startsWith('#') || value.startsWith('?')) return true
  return /^(?:https?:|mailto:|tel:)/i.test(value)
}

function parseMark(value: unknown, path: string, state: ParseState): ParseResult<RichTextMarkV1> {
  if (!isPlainJSONObject(value) || typeof value.type !== 'string') {
    return fail(`${path} must be a rich text mark object`)
  }
  state.marks += 1
  if (state.marks > RICH_TEXT_MODULE_LIMITS.marks) {
    return fail(`rich text document exceeds ${RICH_TEXT_MODULE_LIMITS.marks} marks`)
  }
  if (value.type === 'link') {
    if (!hasExactPluginKeys(value, LINK_MARK_KEYS) || !isSafeRichTextHref(value.href)) {
      return fail(`${path} link must contain only a safe bounded href`)
    }
    return { ok: true, value: { type: 'link', href: value.href } }
  }
  if (!hasExactPluginKeys(value, SIMPLE_MARK_KEYS) || !SIMPLE_MARKS.has(value.type)) {
    return fail(`${path} contains an unsupported rich text mark`)
  }
  return { ok: true, value: { type: value.type as RichTextSimpleMarkTypeV1 } }
}

function parseInline(
  value: unknown,
  path: string,
  state: ParseState
): ParseResult<RichTextInlineV1> {
  if (
    !isPlainJSONObject(value) ||
    !hasExactPluginKeys(value, INLINE_KEYS) ||
    value.type !== 'text'
  ) {
    return fail(`${path} must contain exactly type, text, and marks`)
  }
  if (typeof value.text !== 'string') return fail(`${path}.text must be a string`)
  const textReason = addText(
    state,
    value.text,
    RICH_TEXT_MODULE_LIMITS.textPerInline,
    `${path}.text`
  )
  if (textReason) return fail(textReason)
  if (!Array.isArray(value.marks) || value.marks.length > RICH_TEXT_MODULE_LIMITS.marksPerInline) {
    return fail(
      `${path}.marks must contain at most ${RICH_TEXT_MODULE_LIMITS.marksPerInline} marks`
    )
  }
  state.inlines += 1
  if (state.inlines > RICH_TEXT_MODULE_LIMITS.inlines) {
    return fail(`rich text document exceeds ${RICH_TEXT_MODULE_LIMITS.inlines} inline nodes`)
  }
  const markTypes = new Set<string>()
  const marks: RichTextMarkV1[] = []
  for (let index = 0; index < value.marks.length; index += 1) {
    const mark = parseMark(value.marks[index], `${path}.marks[${index}]`, state)
    if (!mark.ok) return mark
    if (markTypes.has(mark.value.type)) return fail(`${path}.marks contains duplicate mark types`)
    markTypes.add(mark.value.type)
    marks.push(mark.value)
  }
  return { ok: true, value: { type: 'text', text: value.text, marks } }
}

function parseChildren(
  value: unknown,
  path: string,
  state: ParseState
): ParseResult<RichTextInlineV1[]> {
  if (!Array.isArray(value) || value.length > RICH_TEXT_MODULE_LIMITS.inlinesPerBlock) {
    return fail(
      `${path} must contain at most ${RICH_TEXT_MODULE_LIMITS.inlinesPerBlock} inline nodes`
    )
  }
  const children: RichTextInlineV1[] = []
  for (let index = 0; index < value.length; index += 1) {
    const child = parseInline(value[index], `${path}[${index}]`, state)
    if (!child.ok) return child
    children.push(child.value)
  }
  return { ok: true, value: children }
}

function parseTextBlock(
  value: Record<string, unknown>,
  index: number,
  state: ParseState
): ParseResult<RichTextBlockV1> {
  const path = `rich text block ${index}`
  if (value.type === 'paragraph' || value.type === 'blockquote') {
    const keys = value.type === 'paragraph' ? PARAGRAPH_KEYS : BLOCKQUOTE_KEYS
    if (!hasExactPluginKeys(value, keys)) return fail(`${path} has unexpected properties`)
    if (
      value.type === 'paragraph' &&
      (typeof value.align !== 'string' || !ALIGNMENTS.has(value.align as never))
    ) {
      return fail(`${path}.align must be left, center, or right`)
    }
    const children = parseChildren(value.children, `${path}.children`, state)
    if (!children.ok) return children
    return value.type === 'paragraph'
      ? {
          ok: true,
          value: {
            type: 'paragraph',
            align: value.align as RichTextAlignmentV1,
            children: children.value
          }
        }
      : { ok: true, value: { type: 'blockquote', children: children.value } }
  }
  if (!hasExactPluginKeys(value, HEADING_KEYS)) return fail(`${path} has unexpected properties`)
  if (value.level !== 1 && value.level !== 2 && value.level !== 3) {
    return fail(`${path}.level must be 1, 2, or 3`)
  }
  if (typeof value.align !== 'string' || !ALIGNMENTS.has(value.align as never)) {
    return fail(`${path}.align must be left, center, or right`)
  }
  const children = parseChildren(value.children, `${path}.children`, state)
  if (!children.ok) return children
  return {
    ok: true,
    value: {
      type: 'heading',
      level: value.level,
      align: value.align as RichTextAlignmentV1,
      children: children.value
    }
  }
}

function parseListBlock(
  value: Record<string, unknown>,
  index: number,
  state: ParseState
): ParseResult<RichTextListV1> {
  const path = `rich text block ${index}`
  if (!hasExactPluginKeys(value, LIST_KEYS)) return fail(`${path} has unexpected properties`)
  if (
    !Array.isArray(value.items) ||
    value.items.length > RICH_TEXT_MODULE_LIMITS.listItemsPerBlock
  ) {
    return fail(
      `${path}.items must contain at most ${RICH_TEXT_MODULE_LIMITS.listItemsPerBlock} items`
    )
  }
  const items: RichTextListItemV1[] = []
  for (let itemIndex = 0; itemIndex < value.items.length; itemIndex += 1) {
    const item = value.items[itemIndex]
    if (!isPlainJSONObject(item) || !hasExactPluginKeys(item, LIST_ITEM_KEYS)) {
      return fail(`${path}.items[${itemIndex}] must contain only children`)
    }
    state.listItems += 1
    if (state.listItems > RICH_TEXT_MODULE_LIMITS.listItems) {
      return fail(`rich text document exceeds ${RICH_TEXT_MODULE_LIMITS.listItems} list items`)
    }
    const children = parseChildren(item.children, `${path}.items[${itemIndex}].children`, state)
    if (!children.ok) return children
    items.push({ children: children.value })
  }
  return {
    ok: true,
    value: { type: value.type as RichTextListV1['type'], items }
  }
}

function parseBlock(
  value: unknown,
  index: number,
  state: ParseState
): ParseResult<RichTextBlockV1> {
  if (!isPlainJSONObject(value) || typeof value.type !== 'string') {
    return fail(`rich text block ${index} must be an object with a supported type`)
  }
  if (value.type === 'paragraph' || value.type === 'heading' || value.type === 'blockquote') {
    return parseTextBlock(value, index, state)
  }
  if (value.type === 'codeBlock') {
    if (!hasExactPluginKeys(value, CODE_BLOCK_KEYS))
      return fail(`rich text block ${index} has unexpected properties`)
    if (
      typeof value.language !== 'string' ||
      value.language.length > RICH_TEXT_MODULE_LIMITS.language ||
      !LANGUAGE.test(value.language)
    ) {
      return fail(`rich text block ${index}.language is invalid`)
    }
    if (typeof value.text !== 'string')
      return fail(`rich text block ${index}.text must be a string`)
    const reason = addText(
      state,
      value.text,
      RICH_TEXT_MODULE_LIMITS.codeBlockText,
      `rich text block ${index}.text`
    )
    return reason
      ? fail(reason)
      : { ok: true, value: { type: 'codeBlock', language: value.language, text: value.text } }
  }
  if (value.type === 'bulletList' || value.type === 'orderedList') {
    return parseListBlock(value, index, state)
  }
  return fail(`rich text block ${index} uses unsupported type ${value.type}`)
}

function parseDocument(value: unknown): ParseResult<RichTextDocumentV1> {
  if (
    !isPlainJSONObject(value) ||
    !hasExactPluginKeys(value, DOCUMENT_KEYS) ||
    value.type !== 'doc'
  ) {
    return fail('rich text document must contain exactly type "doc" and blocks')
  }
  if (!Array.isArray(value.blocks) || value.blocks.length > RICH_TEXT_MODULE_LIMITS.blocks) {
    return fail(`rich text document must contain at most ${RICH_TEXT_MODULE_LIMITS.blocks} blocks`)
  }
  const state: ParseState = { inlines: 0, listItems: 0, marks: 0, totalText: 0 }
  const blocks: RichTextBlockV1[] = []
  for (let index = 0; index < value.blocks.length; index += 1) {
    const block = parseBlock(value.blocks[index], index, state)
    if (!block.ok) return block
    blocks.push(block.value)
  }
  return { ok: true, value: { type: 'doc', blocks } }
}

function finiteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function parseRichTextConfig(value: unknown): ParseResult<RichTextModuleConfigV1> {
  if (!isPlainJSONObject(value) || !hasExactPluginKeys(value, CONFIG_KEYS)) {
    return fail(
      'rich text config must contain exactly content, textColor, linkColor, fontSize, and lineHeight'
    )
  }
  const content = parseDocument(value.content)
  if (!content.ok) return content
  if (typeof value.textColor !== 'string' || !HEX_COLOR.test(value.textColor)) {
    return fail('rich text config textColor must be a #RRGGBB value')
  }
  if (typeof value.linkColor !== 'string' || !HEX_COLOR.test(value.linkColor)) {
    return fail('rich text config linkColor must be a #RRGGBB value')
  }
  if (
    !finiteInRange(
      value.fontSize,
      RICH_TEXT_MODULE_LIMITS.fontSizeMin,
      RICH_TEXT_MODULE_LIMITS.fontSizeMax
    )
  ) {
    return fail(
      `rich text config fontSize must be ${RICH_TEXT_MODULE_LIMITS.fontSizeMin} to ${RICH_TEXT_MODULE_LIMITS.fontSizeMax}`
    )
  }
  if (
    !finiteInRange(
      value.lineHeight,
      RICH_TEXT_MODULE_LIMITS.lineHeightMin,
      RICH_TEXT_MODULE_LIMITS.lineHeightMax
    )
  ) {
    return fail(
      `rich text config lineHeight must be ${RICH_TEXT_MODULE_LIMITS.lineHeightMin} to ${RICH_TEXT_MODULE_LIMITS.lineHeightMax}`
    )
  }
  return {
    ok: true,
    value: {
      content: content.value,
      textColor: value.textColor.toUpperCase(),
      linkColor: value.linkColor.toUpperCase(),
      fontSize: value.fontSize,
      lineHeight: value.lineHeight
    }
  }
}

function mergeWithDefaults(config: unknown): unknown {
  if (config === undefined) return structuredClone(RICH_TEXT_MODULE_DEFAULT_CONFIG)
  if (!isPlainJSONObject(config)) return config
  return { ...structuredClone(RICH_TEXT_MODULE_DEFAULT_CONFIG), ...config }
}

export function createRichTextModuleInstance(config?: unknown): ModuleInstanceV1 {
  const parsed = parseRichTextConfig(mergeWithDefaults(config))
  if (!parsed.ok) throw new TypeError(parsed.reason)
  return {
    version: 1,
    pluginId: RICH_TEXT_PLUGIN_ID,
    moduleType: RICH_TEXT_MODULE_TYPE,
    configVersion: RICH_TEXT_MODULE_CONFIG_VERSION,
    config: parsed.value
  }
}

export function createRichTextModuleFrameOverrides(config?: unknown): Partial<SceneNode> {
  return createModuleFrameOverrides({
    name: 'Rich Text',
    defaultSize: RICH_TEXT_MODULE_DEFAULT_SIZE,
    fillColor: { r: 1, g: 1, b: 1, a: 1 },
    strokeColor: { r: 0.82, g: 0.84, b: 0.88, a: 1 },
    module: createRichTextModuleInstance(config)
  })
}

export function resolveRichTextModule(value: unknown): ModuleResolution<RichTextModuleConfigV1> {
  if (value === null || value === undefined) return null
  const instance = validateModuleInstance(value)
  if (!instance.ok) return { ok: false, reason: instance.reason }
  if (
    instance.value.pluginId !== RICH_TEXT_PLUGIN_ID ||
    instance.value.moduleType !== RICH_TEXT_MODULE_TYPE
  ) {
    return null
  }
  if (instance.value.configVersion !== RICH_TEXT_MODULE_CONFIG_VERSION) {
    return {
      ok: false,
      reason: `unsupported rich text config version ${instance.value.configVersion}`
    }
  }
  const config = parseRichTextConfig(instance.value.config)
  if (!config.ok) return config
  return {
    ok: true,
    instance: { ...instance.value, config: config.value },
    config: config.value
  }
}

const RICH_TEXT_MODULE_FIELDS: readonly ModulePropertyField[] = Object.freeze([
  {
    path: ['content'],
    kind: 'json',
    label: 'Document',
    i18nLabelKey: 'lowcodeModuleFieldDocument'
  },
  {
    path: ['textColor'],
    kind: 'color',
    label: 'Text color',
    i18nLabelKey: 'lowcodeModuleFieldTextColor'
  },
  {
    path: ['linkColor'],
    kind: 'color',
    label: 'Link color',
    i18nLabelKey: 'lowcodeModuleFieldLinkColor'
  },
  {
    path: ['fontSize'],
    kind: 'number',
    label: 'Font size',
    i18nLabelKey: 'lowcodeModuleFieldFontSize',
    min: RICH_TEXT_MODULE_LIMITS.fontSizeMin,
    max: RICH_TEXT_MODULE_LIMITS.fontSizeMax,
    step: 1
  },
  {
    path: ['lineHeight'],
    kind: 'number',
    label: 'Line height',
    i18nLabelKey: 'lowcodeModuleFieldLineHeight',
    min: RICH_TEXT_MODULE_LIMITS.lineHeightMin,
    max: RICH_TEXT_MODULE_LIMITS.lineHeightMax,
    step: 0.1
  }
])

export const RICH_TEXT_MODULE_DEFINITION: ModuleDefinition<RichTextModuleConfigV1> = Object.freeze({
  pluginId: RICH_TEXT_PLUGIN_ID,
  moduleType: RICH_TEXT_MODULE_TYPE,
  name: 'Rich Text',
  description: 'Structured rich text with bounded blocks, inline marks, and safe links.',
  i18nNameKey: 'lowcodeModuleRichTextName',
  i18nDescriptionKey: 'lowcodeModuleRichTextDescription',
  configVersion: RICH_TEXT_MODULE_CONFIG_VERSION,
  defaultSize: RICH_TEXT_MODULE_DEFAULT_SIZE,
  defaultConfig: structuredClone(RICH_TEXT_MODULE_DEFAULT_CONFIG),
  fields: RICH_TEXT_MODULE_FIELDS,
  createInstance: createRichTextModuleInstance,
  createFrameOverrides: createRichTextModuleFrameOverrides,
  resolve: resolveRichTextModule
})

export const RICH_TEXT_PLUGIN = Object.freeze({
  id: RICH_TEXT_PLUGIN_ID,
  name: 'OpenPencil Rich Text',
  version: '1.0.0',
  modules: Object.freeze([RICH_TEXT_MODULE_DEFINITION])
})
