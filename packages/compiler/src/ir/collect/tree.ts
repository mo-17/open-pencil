import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { tailwindClassName } from '../style'
import type {
  IRAttrValue,
  IRElement,
  IRNode,
  IRStateDecl,
  IRTree,
  IRWarning
} from '../types'

import { resolveEvents, resolveTextBinding } from './bindings'
import { collectPageStates, indexStatesById } from './state'

/**
 * Walk a CANVAS (page) node and produce a framework-neutral IRTree.
 *
 * This module belongs to the IR layer — it MUST NOT import from
 * `adapters/**`. Adapters consume IR; IR has no awareness of adapters.
 */
export function collectTree(graph: SceneGraph, pageId: string): IRTree {
  const page = graph.getNode(pageId)
  const warnings: IRWarning[] = []
  const { states, invalid } = collectPageStates(page)
  for (const { id, name, reason } of invalid) {
    warnings.push({
      code: 'state-invalid',
      message: `state ${name} (id=${id}): ${reason}`,
      nodeId: pageId
    })
  }
  const stateById = indexStatesById(states)

  if (!page) {
    return { pageId, pageName: 'Page', children: [], states, warnings }
  }

  const ctx: WalkCtx = { graph, states: stateById, warnings }
  const children: IRNode[] = []
  for (const child of graph.getChildren(pageId)) {
    if (!child.visible) continue
    const ir = nodeToIR(child, ctx)
    if (ir) children.push(ir)
  }

  return {
    pageId,
    pageName: page.name || 'Page',
    children,
    states,
    warnings
  }
}

interface WalkCtx {
  graph: SceneGraph
  states: Map<string, IRStateDecl>
  warnings: IRWarning[]
}

/**
 * Map SceneNode types to the HTML tag the React adapter will emit.
 * Tags that don't have a Phase 0 mapping (CONNECTOR, SHAPE_WITH_TEXT,
 * BOOLEAN_OPERATION, CANVAS) drop out by returning undefined here.
 */
const TAG_BY_TYPE: Partial<Record<NodeType, string>> = {
  FRAME: 'div',
  RECTANGLE: 'div',
  ROUNDED_RECTANGLE: 'div',
  ELLIPSE: 'div',
  STAR: 'div',
  POLYGON: 'div',
  VECTOR: 'div',
  LINE: 'div',
  GROUP: 'div',
  SECTION: 'section',
  COMPONENT: 'div',
  COMPONENT_SET: 'div',
  INSTANCE: 'div',
  TEXT: 'p',
  INPUT: 'input',
  BUTTON: 'button',
  SELECT: 'select',
  CHECKBOX: 'input',
  FORM: 'form',
  LIST: 'div'
}

const CONTAINER_TYPES_FOR_RECURSION: ReadonlySet<NodeType> = new Set([
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'FORM',
  'LIST'
])

function nodeToIR(node: SceneNode, ctx: WalkCtx): IRElement | null {
  const tag = TAG_BY_TYPE[node.type]
  if (!tag) return null

  const className = tailwindClassName(node, ctx.graph)
  const attrs: Record<string, IRAttrValue> = {}
  const children: IRNode[] = []

  applyInteractiveProps(node, attrs, children, ctx)

  if (node.type === 'TEXT') {
    const binding = resolveTextBinding(node, ctx.states, ctx.warnings)
    if (binding) {
      children.push(binding)
    } else if (node.text) {
      children.push({ kind: 'text', value: node.text })
    }
  }

  if (CONTAINER_TYPES_FOR_RECURSION.has(node.type)) {
    for (const child of ctx.graph.getChildren(node.id)) {
      if (!child.visible) continue
      const ir = nodeToIR(child, ctx)
      if (ir) children.push(ir)
    }
  }

  const events = resolveEvents(node, ctx.states, ctx.warnings)

  return {
    kind: 'element',
    sourceId: node.id,
    tag,
    className,
    attrs,
    children,
    ...(events ? { events } : {})
  }
}

function applyInteractiveProps(
  node: SceneNode,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[],
  ctx: WalkCtx
): void {
  const ip = node.interactiveProps ?? {}
  switch (node.type) {
    case 'INPUT': {
      if (typeof ip.placeholder === 'string') attrs.placeholder = ip.placeholder
      if (typeof ip.value === 'string' && ip.value !== '') attrs.defaultValue = ip.value
      return
    }
    case 'CHECKBOX': {
      attrs.type = 'checkbox'
      if (ip.checked === true) attrs.defaultChecked = true
      return
    }
    case 'BUTTON': {
      attrs.type = 'button'
      const binding = resolveTextBinding(node, ctx.states, ctx.warnings)
      if (binding) {
        children.push(binding)
      } else {
        const text = typeof ip.text === 'string' ? ip.text : 'Button'
        children.push({ kind: 'text', value: text })
      }
      return
    }
    case 'SELECT': {
      const options = Array.isArray(ip.options) ? ip.options : []
      for (const opt of options) {
        if (typeof opt !== 'string') continue
        children.push({
          kind: 'element',
          sourceId: node.id,
          tag: 'option',
          className: '',
          attrs: { value: opt },
          children: [{ kind: 'text', value: opt }]
        })
      }
      return
    }
    default:
      return
  }
}
