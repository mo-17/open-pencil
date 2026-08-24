import {
  assertInertCSSText,
  parseInertHTML,
  sanitizeDesignDocument,
  sanitizeDesignDocumentForStyleComputation
} from '../inert-markup'
import { serializeHTML } from '../serialize'
import type {
  CSSComputeOptions,
  CSSRuntime,
  DesignDocument,
  DesignElement,
  DesignNode
} from '../types'

export interface BrowserCSSRuntimeOptions {
  document?: Document
  sandbox?: 'shadow-root' | 'iframe'
}

const DEFAULT_COMPUTED_PROPERTIES = [
  'align-items',
  'aspect-ratio',
  'background-color',
  'background-image',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-width',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-top-color',
  'border-top-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-width',
  'box-shadow',
  'color',
  'column-gap',
  'display',
  'align-self',
  'bottom',
  'flex-direction',
  'flex-wrap',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'height',
  'justify-content',
  'letter-spacing',
  'left',
  'line-height',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'overflow',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'row-gap',
  'text-align',
  'text-decoration-line',
  'text-shadow',
  'text-transform',
  'top',
  'white-space',
  'width'
] as const

function resolveBrowserDocument(documentOverride: Document | undefined): Document {
  if (documentOverride) return documentOverride
  if (typeof document === 'undefined') {
    throw new TypeError('Browser CSS runtime requires a DOM document')
  }
  return document
}

function parseStyleAttributeWithDocument(
  browserDocument: Document,
  value: string | undefined
): Record<string, string> | undefined {
  if (!value) return undefined
  const element = browserDocument.createElement('div')
  element.style.cssText = value
  const style: Record<string, string> = {}
  for (const property of Array.from(element.style)) {
    const propertyValue = element.style.getPropertyValue(property)
    if (propertyValue) style[property] = propertyValue
  }
  return Object.keys(style).length > 0 ? style : undefined
}

function collectElementPairs(
  designNode: DesignNode,
  domNode: Node,
  pairs: [DesignElement, Element][]
): void {
  if (designNode.type === 'text') return
  const view = domNode.ownerDocument?.defaultView
  if (!view || !(domNode instanceof view.Element)) return

  pairs.push([designNode, domNode])

  const elementChildren = designNode.children.filter(
    (child): child is DesignElement => child.type === 'element'
  )
  const domChildren = Array.from(domNode.children)
  for (const [index, child] of elementChildren.entries()) {
    const domChild = domChildren.at(index)
    if (domChild) collectElementPairs(child, domChild, pairs)
  }
}

function computedStyleToRecord(
  style: CSSStyleDeclaration,
  options: CSSComputeOptions
): Record<string, string> {
  const entries: Record<string, string> = {}
  const properties = options.includeBrowserDefaults
    ? Array.from(style)
    : DEFAULT_COMPUTED_PROPERTIES

  for (const property of properties) {
    const value = style.getPropertyValue(property)
    if (value) entries[property] = value
  }

  return entries
}

function requestFrame(browserDocument: Document): Promise<void> {
  const requestAnimationFrame = browserDocument.defaultView?.requestAnimationFrame
  if (!requestAnimationFrame) return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function applySandboxHostStyle(element: HTMLElement): void {
  element.style.cssText = [
    'position: fixed',
    'left: -100000px',
    'top: 0',
    'width: 1000px',
    'height: auto',
    'visibility: hidden',
    'pointer-events: none',
    'contain: layout style paint'
  ].join(';')
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const IFRAME_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function shouldCreateSVGElement(parent: Node, tagName: string): boolean {
  if (tagName === 'svg') return true
  if (parent.nodeType !== 1) return false
  const element = parent as Element
  return element.namespaceURI === SVG_NAMESPACE && element.localName !== 'foreignObject'
}

function appendInertNode(browserDocument: Document, parent: Node, node: DesignNode): void {
  if (node.type === 'text') {
    parent.appendChild(browserDocument.createTextNode(node.text))
    return
  }

  const element = shouldCreateSVGElement(parent, node.tagName)
    ? browserDocument.createElementNS(SVG_NAMESPACE, node.tagName)
    : browserDocument.createElement(node.tagName)
  for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, value)
  for (const [property, value] of Object.entries(node.inlineStyle ?? {})) {
    element.style.setProperty(property, value)
  }
  for (const child of node.children) appendInertNode(browserDocument, element, child)
  parent.appendChild(element)
}

function appendInertDocument(
  browserDocument: Document,
  parent: Node,
  designDocument: DesignDocument
): void {
  for (const node of designDocument.children) appendInertNode(browserDocument, parent, node)
}

async function computeStylesInShadowRoot(
  browserDocument: Document,
  designDocument: DesignDocument,
  cssText: string,
  options: CSSComputeOptions
): Promise<DesignDocument> {
  const host = browserDocument.createElement('div')
  applySandboxHostStyle(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = browserDocument.createElement('style')
  style.textContent = cssText
  shadow.append(style)

  const content = browserDocument.createElement('div')
  appendInertDocument(
    browserDocument,
    content,
    sanitizeDesignDocumentForStyleComputation(designDocument)
  )
  shadow.append(content)
  browserDocument.body.append(host)

  try {
    await requestFrame(browserDocument)
    return copyComputedStyles(designDocument, content, options)
  } finally {
    host.remove()
  }
}

async function computeStylesInIframe(
  browserDocument: Document,
  designDocument: DesignDocument,
  cssText: string,
  options: CSSComputeOptions
): Promise<DesignDocument> {
  const iframe = browserDocument.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-same-origin')
  applySandboxHostStyle(iframe)
  browserDocument.body.append(iframe)

  try {
    const iframeDocument = iframe.contentDocument
    if (!iframeDocument) throw new TypeError('Browser CSS runtime could not create iframe document')
    const csp = iframeDocument.createElement('meta')
    csp.httpEquiv = 'Content-Security-Policy'
    csp.content = IFRAME_CSP
    iframeDocument.head.replaceChildren(csp)
    iframeDocument.body.replaceChildren()

    const style = iframeDocument.createElement('style')
    style.textContent = cssText
    iframeDocument.head.append(style)

    const content = iframeDocument.createElement('div')
    appendInertDocument(
      iframeDocument,
      content,
      sanitizeDesignDocumentForStyleComputation(designDocument)
    )
    iframeDocument.body.append(content)

    await requestFrame(iframeDocument)
    return copyComputedStyles(designDocument, content, options)
  } finally {
    iframe.remove()
  }
}

function copyComputedStyles(
  designDocument: DesignDocument,
  content: Element,
  options: CSSComputeOptions
): DesignDocument {
  const view = content.ownerDocument.defaultView
  if (!view) throw new TypeError('Browser CSS runtime requires getComputedStyle')

  const nextDocument = structuredClone(designDocument)
  const pairs: [DesignElement, Element][] = []
  const domChildren = Array.from(content.childNodes)
  for (const [index, child] of nextDocument.children.entries()) {
    const domChild = domChildren.at(index)
    if (domChild) collectElementPairs(child, domChild, pairs)
  }

  for (const [designElement, domElement] of pairs) {
    designElement.computedStyle = computedStyleToRecord(view.getComputedStyle(domElement), options)
  }

  return nextDocument
}

export function createBrowserCSSRuntime(options: BrowserCSSRuntimeOptions = {}): CSSRuntime {
  const browserDocument = resolveBrowserDocument(options.document)
  const sandbox = options.sandbox ?? 'shadow-root'

  return {
    kind: 'browser',
    parseHTML: (html) =>
      parseInertHTML(html, (value) => parseStyleAttributeWithDocument(browserDocument, value)),
    serializeHTML,
    computeStyles: (designDocument, cssText = '', computeOptions = {}) => {
      assertInertCSSText(cssText)
      const inertDocument = sanitizeDesignDocument(designDocument)
      return sandbox === 'iframe'
        ? computeStylesInIframe(browserDocument, inertDocument, cssText, computeOptions)
        : computeStylesInShadowRoot(browserDocument, inertDocument, cssText, computeOptions)
    }
  }
}
