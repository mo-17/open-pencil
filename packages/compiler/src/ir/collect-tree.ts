import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { tailwindClassName } from './style'
import type { IRAttrValue, IRElement, IRNode, IRTree } from './types'

/**
 * Walk a CANVAS (page) node and produce a framework-neutral IRTree.
 *
 * This module belongs to the IR layer — it MUST NOT import from
 * `adapters/**`. Adapters consume IR; IR has no awareness of adapters.
 */
export function collectTree(graph: SceneGraph, pageId: string): IRTree {
  const page = graph.getNode(pageId)
  if (!page) {
    return { pageId, pageName: 'Page', children: [] }
  }

  const children: IRNode[] = []
  for (const child of graph.getChildren(pageId)) {
    if (!child.visible) continue
    const ir = nodeToIR(child, graph)
    if (ir) children.push(ir)
  }

  return {
    pageId,
    pageName: page.name || 'Page',
    children
  }
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

function nodeToIR(node: SceneNode, graph: SceneGraph): IRElement | null {
  const tag = TAG_BY_TYPE[node.type]
  if (!tag) return null

  const className = tailwindClassName(node, graph)
  const attrs: Record<string, IRAttrValue> = {}
  const children: IRNode[] = []

  applyInteractiveProps(node, attrs, children)

  if (node.type === 'TEXT') {
    if (node.text) children.push({ kind: 'text', value: node.text })
  }

  if (CONTAINER_TYPES_FOR_RECURSION.has(node.type)) {
    for (const child of graph.getChildren(node.id)) {
      if (!child.visible) continue
      const ir = nodeToIR(child, graph)
      if (ir) children.push(ir)
    }
  }

  return {
    kind: 'element',
    sourceId: node.id,
    tag,
    className,
    attrs,
    children
  }
}

function applyInteractiveProps(
  node: SceneNode,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[]
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
      const text = typeof ip.text === 'string' ? ip.text : 'Button'
      children.push({ kind: 'text', value: text })
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
