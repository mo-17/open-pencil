import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

import { parseExpression, PREV_IDENT } from '../expression'
import { tailwindClassName } from '../style'
import type {
  IRAttrValue,
  IRConditional,
  IRDocStateDecl,
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
  const docStates = collectDocStates(graph, warnings)
  const docStatesByName = indexDocStatesByName(docStates)
  const docStateReads = new Set<string>()
  const docStateWrites = new Set<string>()

  if (!page) {
    return {
      pageId,
      pageName: 'Page',
      children: [],
      states,
      docStates,
      docStateReads: [],
      docStateWrites: [],
      warnings
    }
  }

  const ctx: WalkCtx = {
    graph,
    states: stateById,
    docStates: docStatesByName,
    docStateReads,
    docStateWrites,
    warnings,
    inScope: new Set()
  }
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
    docStates,
    docStateReads: [...docStateReads],
    docStateWrites: [...docStateWrites],
    warnings
  }
}

interface WalkCtx {
  graph: SceneGraph
  states: Map<string, IRStateDecl>
  /** Phase 2 §2: document-level state decls keyed by name (the same map for
   *  every page in a compile). */
  docStates: Map<string, IRDocStateDecl>
  /** Phase 2 §2: doc-state names read via `kind: 'docState'` bindings. */
  docStateReads: Set<string>
  /** Phase 2 §2: doc-state names written via setVariable handlers. */
  docStateWrites: Set<string>
  warnings: IRWarning[]
  /** Phase 2 §9: identifiers in scope at the current traversal point, in
   *  addition to declared states. Pushed when descending into a LIST template
   *  (`itemName` / `indexName`), popped when leaving. Used by expression
   *  validation in bindings + renderCondition. */
  inScope: Set<string>
}

/** Phase 2 §2: pull DocumentStateDef[] off the root SceneNode and convert
 *  to the IR shape. Validates names; invalid entries warn and are dropped. */
function collectDocStates(graph: SceneGraph, warnings: IRWarning[]): IRDocStateDecl[] {
  const root = graph.getNode(graph.rootId)
  const decls = root?.lowcodeDocumentState ?? []
  const out: IRDocStateDecl[] = []
  const seen = new Set<string>()
  for (const d of decls) {
    if (typeof d.name !== 'string' || d.name === '') {
      warnings.push({
        code: 'docstate-invalid',
        message: `document state (id=${d.id}) has no name; dropped`
      })
      continue
    }
    if (seen.has(d.name)) {
      warnings.push({
        code: 'docstate-duplicate-name',
        message: `document state name "${d.name}" is declared more than once; the second declaration is dropped`
      })
      continue
    }
    seen.add(d.name)
    out.push({
      id: d.id,
      name: d.name,
      type: d.type,
      defaultValue: d.defaultValue
    })
  }
  return out
}

function indexDocStatesByName(decls: IRDocStateDecl[]): Map<string, IRDocStateDecl> {
  const m = new Map<string, IRDocStateDecl>()
  for (const d of decls) m.set(d.name, d)
  return m
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
    const binding = resolveTextBinding(
      node,
      ctx.states,
      ctx.warnings,
      ctx.inScope,
      ctx.docStates,
      ctx.docStateReads
    )
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

  const events = resolveEvents(
    node,
    ctx.states,
    ctx.warnings,
    ctx.docStates,
    ctx.docStateWrites
  )

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

/** A LIST datasource ref — either a page-scoped array state (Phase 2 §9) or
 *  a document-level array Document State (Phase 2 §3). */
interface ListDataSourceRef {
  kind?: string
  stateId?: string
  docStateName?: string
}

/**
 * Resolve a LIST's `dataSourceRef` to the identifier the emitted `.map()`
 * iterates. A `stateRef` resolves against page state; a `docStateRef`
 * resolves against the document's Document State and registers a read so
 * the page declares `const <name> = useDocState('<name>')`. Either way the
 * source must be array-typed. Returns null (with a warning) on any failure.
 */
function resolveListArrayName(
  node: SceneNode,
  ref: ListDataSourceRef | null | undefined,
  ctx: WalkCtx
): string | null {
  if (ref?.kind === 'stateRef' && typeof ref.stateId === 'string') {
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
    return state.name
  }
  if (ref?.kind === 'docStateRef' && typeof ref.docStateName === 'string') {
    const decl = ctx.docStates.get(ref.docStateName)
    if (!decl) {
      ctx.warnings.push({
        code: 'list-unknown-datasource',
        message: `LIST ${node.id} dataSourceRef points to unknown document state ${ref.docStateName}`,
        nodeId: node.id
      })
      return null
    }
    if (decl.type !== 'array') {
      ctx.warnings.push({
        code: 'list-bad-datasource-type',
        message: `LIST ${node.id} dataSource document state ${decl.name} is type ${decl.type}, expected array`,
        nodeId: node.id
      })
      return null
    }
    ctx.docStateReads.add(decl.name)
    return decl.name
  }
  ctx.warnings.push({
    code: 'list-no-datasource',
    message: `LIST ${node.id} has no array-typed dataSourceRef; nothing will render`,
    nodeId: node.id
  })
  return null
}

/**
 * Phase 2 §9: resolve a LIST node's interactiveProps datasource + template.
 * Returns an `IRList` when datasource is a valid array-typed state ref AND
 * the LIST has at least one visible child to use as the template; otherwise
 * warns and returns null (caller emits an empty LIST container).
 */
function collectListDirective(node: SceneNode, ctx: WalkCtx): IRList | null {
  const ip = (node.interactiveProps ?? {}) as {
    dataSourceRef?: ListDataSourceRef | null
    itemName?: string
    indexName?: string
  }
  const arrayName = resolveListArrayName(node, ip.dataSourceRef, ctx)
  if (arrayName === null) return null

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
    arrayName,
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
  if (parsed.references.has(PREV_IDENT)) {
    ctx.warnings.push({
      code: 'expression-prev-out-of-context',
      message: `node ${node.id} renderCondition references ${PREV_IDENT}; ${PREV_IDENT} is only valid inside setState / setVariable valueExpr`,
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
      const binding = resolveTextBinding(
        node,
        ctx.states,
        ctx.warnings,
        ctx.inScope,
        ctx.docStates,
        ctx.docStateReads
      )
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
