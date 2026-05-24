import { emitExpression } from '@open-pencil/core/lowcode-validation'
import type { IRAttrValue, IREventHandler, IREventName, IRNode } from '#compiler/ir/types'

import { emitEventHandler } from './event'

/** Tags that must self-close in JSX (no children). */
const VOID_TAGS: ReadonlySet<string> = new Set(['input', 'br', 'hr', 'img', 'meta', 'link'])

/**
 * IR → JSX source string. Pure, single-pass, no scene-graph access — the
 * adapter layer's contract.
 *
 * Indent is in two-space units, matching the surrounding `App.tsx` template.
 *
 * `devMode` toggles the canvas↔preview bridge hook: when true, every element
 * is tagged with `data-node-id="<sceneId>"` so the bridge runtime can map a
 * DOM click back to a SceneNode. Off for production / CLI export.
 */
export function emitElement(node: IRNode, indent: number, devMode = false): string {
  const pad = '  '.repeat(indent)

  if (node.kind === 'text') {
    return `${pad}${escapeJSXText(node.value)}`
  }

  if (node.kind === 'expression') {
    return `${pad}{${emitExpression(node.ast)}}`
  }

  if (node.kind === 'conditional') {
    // Phase 2 §9: `{(<expr>) && (<consequent>)}`. Trailing parens around the
    // consequent let it span multiple lines without confusing the `&&`.
    const inner = emitElement(node.consequent, indent + 1, devMode)
    return `${pad}{(${emitExpression(node.ast)}) && (\n${inner}\n${pad})}`
  }

  if (node.kind === 'list') {
    // Phase 2 §9: `{(<arr>).map((item, index) => (<template/>))}`. The
    // template inherits the adapter's data-node-id when devMode is on.
    // React needs `key=` on the iterated element; we inject it into the
    // template's first JSX opening tag so even an IRConditional template
    // ends up with the key on the inner element rather than the `&&`.
    const tpl = injectKey(emitElement(node.template, indent + 1, devMode), node.indexName)
    return (
      `${pad}{(${node.arrayName}).map((${node.itemName}, ${node.indexName}) => (\n` +
      `${tpl}\n` +
      `${pad}))}`
    )
  }

  const attrsStr = formatAttrs(
    node.className,
    node.attrs,
    node.events,
    devMode ? node.sourceId : undefined
  )
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
  for (const child of node.children) lines.push(emitElement(child, indent + 1, devMode))
  lines.push(`${pad}</${node.tag}>`)
  return lines.join('\n')
}

function formatAttrs(
  className: string,
  attrs: Record<string, IRAttrValue>,
  events: Partial<Record<IREventName, IREventHandler[]>> | undefined,
  nodeId: string | undefined
): string {
  const parts: string[] = []
  if (className) parts.push(`className="${escapeAttr(className)}"`)
  if (nodeId !== undefined) parts.push(`data-node-id="${escapeAttr(nodeId)}"`)
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

/**
 * Phase 2 §9 LIST emit: insert `key={<expr>}` right after the tag name of the
 * first JSX opening element in `emitted`. Matches `<tag ` or `<tag>` or
 * `<tag/>`. No-ops if no JSX tag is found (e.g. the template emits to an
 * expression block only).
 */
function injectKey(emitted: string, indexExpr: string): string {
  return emitted.replace(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/, `<$1 key={${indexExpr}}`)
}
