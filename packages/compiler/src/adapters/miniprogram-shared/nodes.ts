import type { IRElement, IRNode } from '#compiler/ir/types'

import { staticNativeAttr } from '../native-shared'

export type MiniProgramElementTag =
  | 'view'
  | 'text'
  | 'image'
  | 'button'
  | 'input'
  | 'textarea'
  | 'form'

const TEXT_TAGS = new Set(['span', 'label', 'option'])
const VIEW_TAGS = new Set([
  'div',
  'main',
  'section',
  'header',
  'footer',
  'article',
  'aside',
  'nav',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li'
])

export function miniProgramElementTag(node: IRElement): MiniProgramElementTag {
  if (node.tag === 'img' || node.image) return 'image'
  if (node.tag === 'button') return 'button'
  if (node.tag === 'input') return 'input'
  if (node.tag === 'textarea') return 'textarea'
  if (node.tag === 'form') return 'form'
  if (TEXT_TAGS.has(node.tag)) return 'text'
  if (VIEW_TAGS.has(node.tag)) return 'view'
  return 'view'
}

export const staticMiniProgramAttr = staticNativeAttr

export function walkMiniProgramNodes(
  nodes: readonly IRNode[],
  visit: (node: IRNode) => void
): void {
  for (const node of nodes) {
    visit(node)
    if (node.kind === 'element') walkMiniProgramNodes(node.children, visit)
    else if (node.kind === 'conditional') walkMiniProgramNodes([node.consequent], visit)
    else if (node.kind === 'list') walkMiniProgramNodes([node.template], visit)
  }
}

function escapeMiniProgramMarkupSyntax(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function escapeMiniProgramTemplateExpression(value: string): string {
  return escapeMiniProgramMarkupSyntax(value).replaceAll('`', '&#96;')
}

export function escapeMiniProgramMarkupText(value: string): string {
  return escapeMiniProgramMarkupSyntax(value).replaceAll('{', '&#123;').replaceAll('}', '&#125;')
}

export function escapeMiniProgramMarkupAttribute(value: string): string {
  return escapeMiniProgramMarkupText(value).replaceAll('`', '&#96;')
}
