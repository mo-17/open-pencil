import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { parseExpression } from '../expression'
import { tailwindClassName } from '../style'
import type {
  IRAttrValue,
  IRConditional,
  IRElement,
  IRList,
  IRNode,
  IRStateDecl,
  IRTree,
  IRWarning
} from '../types'

import { resolveEvents, resolveTextBinding, unknownIdentifiers } from './bindings'
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

  const ctx: WalkCtx = { graph, states: stateById, warnings, inScope: new Set() }
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
  /** Phase 2 §9: identifiers in scope at the current traversal point, in
   *  addition to declared states. Pushed when descending into a LIST template
   *  (`itemName` / `indexName`), popped when leaving. Used by expression
   *  validation in bindings + renderCondition. */
  inScope: Set<string>
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
  'FORM'
  // 'LIST' deliberately excluded: Phase 2 §9 routes LIST through
  // collectListDirective so its children become an IRList template rather
  // than statically emitted siblings.
])

function nodeToIR(node: SceneNode, ctx: WalkCtx): IRNode | null {
  const tag = TAG_BY_TYPE[node.type]
  if (!tag) return null

  const className = tailwindClassName(node, ctx.graph)
  const attrs: Record<string, IRAttrValue> = {}
  const children: IRNode[] = []

  applyInteractiveProps(node, attrs, children, ctx)

  if (node.type === 'TEXT') {
    const binding = resolveTextBinding(node, ctx.states, ctx.warnings, ctx.inScope)
    if (binding) {
      children.push(binding)
    } else if (node.text) {
      children.push({ kind: 'text', value: node.text })
    }
  }

  if (node.type === 'LIST') {
    const irList = collectListDirective(node, ctx)
    if (irList) children.push(irList)
  } else if (CONTAINER_TYPES_FOR_RECURSION.has(node.type)) {
    for (const child of ctx.graph.getChildren(node.id)) {
      if (!child.visible) continue
      const ir = nodeToIR(child, ctx)
      if (ir) children.push(ir)
    }
  }

  const events = resolveEvents(node, ctx.states, ctx.warnings)

  const element: IRElement = {
    kind: 'element',
    sourceId: node.id,
    tag,
    className,
    attrs,
    children,
    ...(events ? { events } : {})
  }
  return wrapConditional(node, element, ctx)
}

/**
 * Phase 2 §9: resolve a LIST node's interactiveProps datasource + template.
 * Returns an `IRList` when datasource is a valid array-typed state ref AND
 * the LIST has at least one visible child to use as the template; otherwise
 * warns and returns null (caller emits an empty LIST container).
 */
function collectListDirective(node: SceneNode, ctx: WalkCtx): IRList | null {
  const ip = (node.interactiveProps ?? {}) as {
    dataSourceRef?: { kind?: string; stateId?: string } | null
    itemName?: string
    indexName?: string
  }
  const ref = ip.dataSourceRef
  if (ref?.kind !== 'stateRef' || typeof ref.stateId !== 'string') {
    ctx.warnings.push({
      code: 'list-no-datasource',
      message: `LIST ${node.id} has no array-typed dataSourceRef; nothing will render`,
      nodeId: node.id
    })
    return null
  }
  const state = ctx.states.get(ref.stateId)
  if (!state) {
    ctx.warnings.push({
      code: 'list-unknown-datasource',
      message: `LIST ${node.id} dataSourceRef points to unknown state ${ref.stateId}`,
      nodeId: node.id
    })
    return null
  }
  if (state.type !== 'array') {
    ctx.warnings.push({
      code: 'list-bad-datasource-type',
      message: `LIST ${node.id} dataSource state ${state.name} is type ${state.type}, expected array`,
      nodeId: node.id
    })
    return null
  }

  const itemName = typeof ip.itemName === 'string' && ip.itemName !== '' ? ip.itemName : 'item'
  const indexName =
    typeof ip.indexName === 'string' && ip.indexName !== '' ? ip.indexName : 'index'

  const visibleChildren = ctx.graph.getChildren(node.id).filter((c) => c.visible)
  if (visibleChildren.length === 0) {
    ctx.warnings.push({
      code: 'list-no-template',
      message: `LIST ${node.id} has no visible child to use as the item template`,
      nodeId: node.id
    })
    return null
  }
  if (visibleChildren.length > 1) {
    ctx.warnings.push({
      code: 'list-multiple-templates',
      message: `LIST ${node.id} has ${visibleChildren.length} visible children; only the first is rendered as the item template`,
      nodeId: node.id
    })
  }

  // Push item / index onto inScope while collecting the template subtree so
  // expressions like `item.name` and `index + 1` resolve cleanly.
  ctx.inScope.add(itemName)
  ctx.inScope.add(indexName)
  const template = nodeToIR(visibleChildren[0], ctx)
  ctx.inScope.delete(itemName)
  ctx.inScope.delete(indexName)

  if (!template) return null
  return {
    kind: 'list',
    arrayName: state.name,
    itemName,
    indexName,
    template
  }
}

/**
 * Phase 2 §9: wrap an IRElement in an IRConditional when the source node
 * carries a non-empty `renderCondition`. Parse failures and unknown
 * identifiers degrade to the unwrapped element with a warning (decision
 * §9.2 #8 — keep the node visible so users can fix it in place).
 */
function wrapConditional(node: SceneNode, element: IRElement, ctx: WalkCtx): IRNode {
  const src = node.renderCondition
  if (typeof src !== 'string' || src === '') return element
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    ctx.warnings.push({
      code: 'condition-invalid-expression',
      message: `node ${node.id} renderCondition "${src}" → ${parsed.error}`,
      nodeId: node.id
    })
    return element
  }
  const unknown = unknownIdentifiers(parsed.references, ctx.states, ctx.inScope)
  if (unknown.length > 0) {
    ctx.warnings.push({
      code: 'condition-unknown-identifier',
      message: `node ${node.id} renderCondition references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: node.id
    })
    return element
  }
  const conditional: IRConditional = {
    kind: 'conditional',
    ast: parsed.ast,
    references: [...parsed.references],
    consequent: element
  }
  return conditional
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
