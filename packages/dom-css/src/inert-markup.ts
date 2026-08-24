import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import valueParser, { type ParsedNode } from 'postcss-value-parser'

import type { DesignDocument, DesignNode, DesignStyleDeclaration } from './types'

export type StyleAttributeParser = (value: string | undefined) => DesignStyleDeclaration | undefined

const ACTIVE_OR_RESOURCE_TAGS = new Set([
  'applet',
  'audio',
  'base',
  'embed',
  'frame',
  'frameset',
  'head',
  'iframe',
  'link',
  'meta',
  'noscript',
  'object',
  'portal',
  'script',
  'source',
  'style',
  'template',
  'title',
  'track',
  'video'
])

const URL_ATTRIBUTES = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'codebase',
  'data',
  'formaction',
  'href',
  'longdesc',
  'manifest',
  'ping',
  'poster',
  'profile',
  'src',
  'srcset',
  'usemap',
  'xlink:href'
])

const ACTIVE_ATTRIBUTES = new Set(['autofocus', 'is', 'nonce', 'srcdoc'])
const DANGEROUS_CSS_PROPERTIES = new Set(['behavior', '-moz-binding'])
const RESOURCE_FUNCTIONS = new Set([
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  'expression',
  'image',
  'image-set',
  '-webkit-image-set',
  'paint',
  'src',
  'url'
])

const SAFE_DATA_IMAGE = /^data:image\/(?:gif|jpeg|png|webp);base64,[a-z\d+/=\s]+$/i
const SAFE_LOCAL_FRAGMENT = /^#[A-Za-z_][A-Za-z0-9_.:-]*$/
const SAFE_TAG_NAME = /^[A-Za-z][A-Za-z0-9]*$/
const SAFE_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/

function decodeCSSEscapes(value: string): string {
  return value.replace(
    /\\([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f\da-f])/gi,
    (_match, hexadecimal: string | undefined, escaped: string | undefined) => {
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16)
        return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\uFFFD'
      }
      return escaped ?? ''
    }
  )
}

function parsedNodesContainResource(nodes: ParsedNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'function') continue
    const functionNode = node as ParsedNode & { nodes: ParsedNode[] }
    const name = decodeCSSEscapes(node.value).toLowerCase()
    if (RESOURCE_FUNCTIONS.has(name) || parsedNodesContainResource(functionNode.nodes)) return true
  }
  return false
}

function resourceURLFromFunction(node: ParsedNode & { nodes: ParsedNode[] }): string {
  return decodeCSSEscapes(valueParser.stringify(node.nodes))
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
}

function isSafeSerializedURL(value: string, allowNavigationProtocols = false): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  for (const character of trimmed) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return false
  }
  if (SAFE_LOCAL_FRAGMENT.test(trimmed)) return true
  try {
    const parsed = new URL(trimmed, 'https://openpencil.invalid/')
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      (allowNavigationProtocols && (parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'))
    )
  } catch {
    return false
  }
}

function parsedNodesContainDangerousResource(nodes: ParsedNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'function') continue
    const functionNode = node as ParsedNode & { nodes: ParsedNode[] }
    const name = decodeCSSEscapes(node.value).toLowerCase()
    if (name === 'url') {
      const url = resourceURLFromFunction(functionNode)
      if (!isSafeSerializedURL(url) && !SAFE_DATA_IMAGE.test(url)) return true
    } else if (RESOURCE_FUNCTIONS.has(name)) {
      return true
    }
    if (parsedNodesContainDangerousResource(functionNode.nodes)) return true
  }
  return false
}

function containsDangerousCSS(cssText: string): boolean {
  const canonical = decodeCSSEscapes(cssText.replace(/\/\*[\s\S]*?\*\//g, '')).toLowerCase()
  if (/@\s*import(?:\s|;|url|$)/.test(canonical)) return true
  if (/(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/.test(canonical)) return true
  return parsedNodesContainDangerousResource(valueParser(canonical).nodes)
}

export function containsActiveCSS(cssText: string): boolean {
  const canonical = decodeCSSEscapes(cssText.replace(/\/\*[\s\S]*?\*\//g, '')).toLowerCase()
  if (/@\s*import(?:\s|;|url|$)/.test(canonical)) return true
  if (/(?:^|[;{\s])(?:behavior|-moz-binding)\s*:/.test(canonical)) return true
  return parsedNodesContainResource(valueParser(canonical).nodes)
}

export function assertInertCSSText(cssText: string): void {
  if (containsActiveCSS(cssText)) {
    throw new TypeError('DOM/CSS import rejected active or external CSS resource syntax')
  }
}

function sanitizeStyle(
  style: DesignStyleDeclaration | undefined,
  strict: boolean
): DesignStyleDeclaration | undefined {
  if (!style) return undefined
  const sanitized: DesignStyleDeclaration = {}
  for (const [rawProperty, value] of Object.entries(style)) {
    const property = rawProperty.trim().toLowerCase()
    if (
      property.length === 0 ||
      DANGEROUS_CSS_PROPERTIES.has(property) ||
      (strict ? containsActiveCSS(value) : containsDangerousCSS(value))
    ) {
      continue
    }
    sanitized[property] = value
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

function isSafeInertURLAttribute(tagName: string, name: string, value: string): boolean {
  if ((name === 'href' || name === 'xlink:href') && SAFE_LOCAL_FRAGMENT.test(value)) return true
  return tagName === 'img' && name === 'src' && SAFE_DATA_IMAGE.test(value)
}

function isSafePreservedURLAttribute(tagName: string, name: string, value: string): boolean {
  if (name === 'srcset') return false
  if (tagName === 'img' && name === 'src' && SAFE_DATA_IMAGE.test(value)) return true
  return isSafeSerializedURL(value, name === 'href')
}

function sanitizeAttrs(
  tagName: string,
  attrs: Record<string, string>,
  strict: boolean
): Record<string, string> {
  const sanitized: Record<string, string> = {}
  for (const [rawName, value] of Object.entries(attrs)) {
    const name = rawName.toLowerCase()
    if (
      !SAFE_ATTRIBUTE_NAME.test(name) ||
      name === 'style' ||
      name.startsWith('on') ||
      ACTIVE_ATTRIBUTES.has(name) ||
      (strict ? containsActiveCSS(value) : containsDangerousCSS(value))
    ) {
      continue
    }
    if (
      URL_ATTRIBUTES.has(name) &&
      !(strict
        ? isSafeInertURLAttribute(tagName, name, value)
        : isSafePreservedURLAttribute(tagName, name, value))
    ) {
      continue
    }
    sanitized[name] = value
  }
  return sanitized
}

function isSafeTag(tagName: string): boolean {
  const canonical = tagName.toLowerCase()
  return (
    SAFE_TAG_NAME.test(canonical) &&
    !canonical.includes('-') &&
    !ACTIVE_OR_RESOURCE_TAGS.has(canonical)
  )
}

function sanitizeDesignNodeWithMode(node: DesignNode, strict: boolean): DesignNode | null {
  if (node.type === 'text') return { type: 'text', text: node.text }

  const tagName = node.tagName.toLowerCase()
  if (!isSafeTag(tagName)) return null
  const attrs = sanitizeAttrs(tagName, node.attrs, strict)
  const inlineStyle = sanitizeStyle(node.inlineStyle, strict)
  if (
    !inlineStyle &&
    !node.inlineStyle &&
    node.attrs.style &&
    !(strict ? containsActiveCSS : containsDangerousCSS)(node.attrs.style)
  ) {
    attrs.style = node.attrs.style
  }
  const computedStyle = sanitizeStyle(node.computedStyle, strict)
  return {
    ...node,
    tagName,
    attrs,
    children: node.children
      .map((child) => sanitizeDesignNodeWithMode(child, strict))
      .filter((child): child is DesignNode => child !== null),
    ...(inlineStyle ? { inlineStyle } : { inlineStyle: undefined }),
    ...(computedStyle ? { computedStyle } : { computedStyle: undefined })
  }
}

export function sanitizeDesignNode(node: DesignNode): DesignNode | null {
  return sanitizeDesignNodeWithMode(node, false)
}

function sanitizeDesignDocumentWithMode(document: DesignDocument, strict: boolean): DesignDocument {
  return {
    ...document,
    children: document.children
      .map((node) => sanitizeDesignNodeWithMode(node, strict))
      .filter((node): node is DesignNode => node !== null),
    ...(document.stylesheets
      ? {
          stylesheets: document.stylesheets
            .filter((sheet) => !(strict ? containsActiveCSS : containsDangerousCSS)(sheet.cssText))
            .map((sheet) => ({ type: 'stylesheet', cssText: sheet.cssText }))
        }
      : {})
  }
}

export function sanitizeDesignDocument(document: DesignDocument): DesignDocument {
  return sanitizeDesignDocumentWithMode(document, false)
}

export function sanitizeDesignDocumentForStyleComputation(
  document: DesignDocument
): DesignDocument {
  return sanitizeDesignDocumentWithMode(document, true)
}

function attrsToRecord(attrs: DefaultTreeAdapterTypes.Element['attrs']): Record<string, string> {
  return Object.fromEntries(attrs.map((attr) => [attr.name, attr.value]))
}

function isTextNode(
  node: DefaultTreeAdapterTypes.ChildNode
): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text'
}

function parsedChildToDesignNode(
  node: DefaultTreeAdapterTypes.ChildNode,
  parseStyleAttribute: StyleAttributeParser
): DesignNode | null {
  if (isTextNode(node)) {
    return node.value.trim().length > 0 ? { type: 'text', text: node.value } : null
  }
  if (!('tagName' in node)) return null

  const tagName = node.tagName.toLowerCase()
  if (!isSafeTag(tagName)) return null
  const rawAttrs = attrsToRecord(node.attrs)
  const attrs = sanitizeAttrs(tagName, rawAttrs, false)
  const inlineStyle = sanitizeStyle(parseStyleAttribute(rawAttrs.style), false)
  return {
    type: 'element',
    tagName,
    attrs,
    children: node.childNodes
      .map((child) => parsedChildToDesignNode(child, parseStyleAttribute))
      .filter((child): child is DesignNode => child !== null),
    ...(inlineStyle ? { inlineStyle } : {})
  }
}

export function parseInertHTML(
  html: string,
  parseStyleAttribute: StyleAttributeParser
): DesignDocument {
  const fragment = parseFragment(html)
  return {
    type: 'document',
    children: fragment.childNodes
      .map((node) => parsedChildToDesignNode(node, parseStyleAttribute))
      .filter((node): node is DesignNode => node !== null)
  }
}

type ParsedWalkNode = {
  childNodes?: ParsedWalkNode[]
  tagName?: string
  value?: string
}

function collectStyleText(node: ParsedWalkNode, styles: string[]): void {
  if (node.tagName?.toLowerCase() === 'style') {
    const cssText = (node.childNodes ?? [])
      .map((child) => child.value ?? '')
      .join('')
      .trim()
    if (cssText) styles.push(cssText)
    return
  }
  for (const child of node.childNodes ?? []) collectStyleText(child, styles)
}

export function extractInertCSSText(html: string): string | undefined {
  const styles: string[] = []
  collectStyleText(parse(html) as ParsedWalkNode, styles)
  return styles.length > 0 ? styles.join('\n') : undefined
}
