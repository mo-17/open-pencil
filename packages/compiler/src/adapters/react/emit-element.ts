import type { IRAttrValue, IRNode } from '#compiler/ir/types'

/** Tags that must self-close in JSX (no children). */
const VOID_TAGS: ReadonlySet<string> = new Set(['input', 'br', 'hr', 'img', 'meta', 'link'])

/**
 * IR → JSX source string. Pure, single-pass, no scene-graph access — the
 * adapter layer's contract.
 *
 * Indent is in two-space units, matching the surrounding `App.tsx` template.
 */
export function emitElement(node: IRNode, indent: number): string {
  const pad = '  '.repeat(indent)

  if (node.kind === 'text') {
    return `${pad}${escapeJSXText(node.value)}`
  }

  const attrsStr = formatAttrs(node.className, node.attrs)
  const opening = attrsStr ? `<${node.tag} ${attrsStr}` : `<${node.tag}`

  if (VOID_TAGS.has(node.tag) || node.children.length === 0) {
    return `${pad}${opening} />`
  }

  // Inline single text child for compactness: <p>Hello</p>
  if (node.children.length === 1 && node.children[0].kind === 'text') {
    const value = node.children[0].value
    if (!value.includes('\n')) {
      return `${pad}${opening}>${escapeJSXText(value)}</${node.tag}>`
    }
  }

  const lines = [`${pad}${opening}>`]
  for (const child of node.children) lines.push(emitElement(child, indent + 1))
  lines.push(`${pad}</${node.tag}>`)
  return lines.join('\n')
}

function formatAttrs(className: string, attrs: Record<string, IRAttrValue>): string {
  const parts: string[] = []
  if (className) parts.push(`className="${escapeAttr(className)}"`)
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(formatAttr(key, value))
  }
  return parts.join(' ')
}

function formatAttr(key: string, value: IRAttrValue): string {
  if (typeof value === 'string') return `${key}="${escapeAttr(value)}"`
  if (typeof value === 'number') return `${key}={${value}}`
  return value ? key : `${key}={false}`
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

const JSX_ENTITY: Record<string, string> = {
  '{': '&#123;',
  '}': '&#125;',
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;'
}

function escapeJSXText(text: string): string {
  return text.replace(/[{}<>&]/g, (c) => JSX_ENTITY[c])
}
