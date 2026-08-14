import { normalizeStaticDocument, staticDocumentBounds } from './static-layout'
import type { DesignDocument, DesignElement, DesignNode, DesignStyleDeclaration } from './types'

export interface StaticHTMLShowcaseFragment {
  html: string
  css: string
  width: number
  height: number
}

const VOID_ELEMENTS = new Set(['img'])
const SAFE_ELEMENTS = new Set(['div', 'img', 'main', 'span'])
const SAFE_ATTRIBUTE = /^(?:aria-[a-z0-9-]+|data-[a-z0-9-]+|alt|class|id|role|title)$/
const SAFE_STYLE_PROPERTY = /^(?:[a-z][a-z0-9-]*)$/
const UNSAFE_STYLE_VALUE = /(?:javascript\s*:|expression\s*\(|@import|<\/style|url\s*\()/i
const RESET_CSS =
  '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#fff}.op-codepen-stage{position:relative;overflow:hidden;background:transparent}'

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', '&quot;')
}

function safeImageSource(value: string): boolean {
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function serializeStyle(style: DesignStyleDeclaration | undefined): string | undefined {
  if (!style) return undefined
  const declarations: string[] = []
  for (const [property, value] of Object.entries(style)) {
    if (!SAFE_STYLE_PROPERTY.test(property) || UNSAFE_STYLE_VALUE.test(value)) {
      throw new TypeError('Static HTML contains an unsupported style declaration')
    }
    if (value !== '') declarations.push(`${property}: ${value}`)
  }
  return declarations.length > 0 ? declarations.join('; ') : undefined
}

function serializeAttributes(node: DesignElement): string {
  const entries: Array<[string, string]> = []
  for (const [name, value] of Object.entries(node.attrs)) {
    const normalized = name.toLowerCase()
    if (normalized === 'src') {
      if (node.tagName.toLowerCase() !== 'img' || !safeImageSource(value)) {
        throw new TypeError('Static HTML contains an unsupported image source')
      }
      entries.push(['src', value])
      continue
    }
    if (!SAFE_ATTRIBUTE.test(normalized)) continue
    entries.push([normalized, value])
  }
  const style = serializeStyle(node.inlineStyle)
  if (style) entries.push(['style', style])
  return entries.length === 0
    ? ''
    : ` ${entries.map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(' ')}`
}

function serializeNode(node: DesignNode): string {
  if (node.type === 'text') return escapeText(node.text)
  const tagName = node.tagName.toLowerCase()
  if (!SAFE_ELEMENTS.has(tagName))
    throw new TypeError('Static HTML contains an unsupported element')
  const attrs = serializeAttributes(node)
  if (VOID_ELEMENTS.has(tagName)) return `<${tagName}${attrs}>`
  return `<${tagName}${attrs}>${node.children.map(serializeNode).join('')}</${tagName}>`
}

/**
 * Serialize a DesignDOM document as a bounded, script-free CodePen body/CSS pair.
 * This entry point is browser-safe: it does not load Tailwind, a source compiler,
 * Node APIs, or an executable JavaScript runtime.
 */
export function createStaticHTMLShowcaseFragment(
  document: DesignDocument
): StaticHTMLShowcaseFragment {
  const bounds = staticDocumentBounds(document)
  const positioned = normalizeStaticDocument(document, bounds)
  const body = positioned.children.map(serializeNode).join('')
  return {
    html: `<main data-open-pencil-codepen-static="" class="op-codepen-stage" style="width: ${bounds.width}px; height: ${bounds.height}px">${body}</main>`,
    css: RESET_CSS,
    width: bounds.width,
    height: bounds.height
  }
}

export { sceneGraphToDesignDocument } from './from-scene-graph'
export type { ToDesignDocumentOptions } from './from-scene-graph'
