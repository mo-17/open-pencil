import { emitExpression } from '#compiler/ir/expression'
import type { IRAttrValue, IREventHandler, IREventName, IRNode } from '#compiler/ir/types'

import { emitEventHandler } from './event'

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

  if (node.kind === 'expression') {
    return `${pad}{${emitExpression(node.ast)}}`
  }

  const attrsStr = formatAttrs(node.className, node.attrs, node.events)
  const opening = attrsStr ? `<${node.tag} ${attrsStr}` : `<${node.tag}`

  if (VOID_TAGS.has(node.tag) || node.children.length === 0) {
    return `${pad}${opening} />`
  }

  // Inline single-child expressions for compactness: <p>{count}</p>.
  if (node.children.length === 1) {
    const only = node.children[0]
    if (only.kind === 'text' && !only.value.includes('\n')) {
      return `${pad}${opening}>${escapeJSXText(only.value)}</${node.tag}>`
    }
    if (only.kind === 'expression') {
      return `${pad}${opening}>{${emitExpression(only.ast)}}</${node.tag}>`
    }
  }

  const lines = [`${pad}${opening}>`]
  for (const child of node.children) lines.push(emitElement(child, indent + 1))
  lines.push(`${pad}</${node.tag}>`)
  return lines.join('\n')
}

function formatAttrs(
  className: string,
  attrs: Record<string, IRAttrValue>,
  events: Partial<Record<IREventName, IREventHandler[]>> | undefined
): string {
  const parts: string[] = []
  if (className) parts.push(`className="${escapeAttr(className)}"`)
  for (const [key, value] of Object.entries(attrs)) {
    parts.push(formatAttr(key, value))
  }
  if (events) {
    for (const [name, handlers] of Object.entries(events) as [
      IREventName,
      IREventHandler[]
    ][]) {
      if (handlers.length === 0) continue
      parts.push(`${name}={${emitEventHandler(handlers)}}`)
    }
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
