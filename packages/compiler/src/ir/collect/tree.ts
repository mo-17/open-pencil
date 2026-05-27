import type { NodeType, SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'
import { parseExpression, PREV_IDENT } from '@open-pencil/core/lowcode-validation'

import { tailwindClassName } from '../style'
import type {
  IRAttrValue,
  IRConditional,
  IRControlledInput,
  IRDocStateDecl,
  IRElement,
  IREventHandler,
  IREventName,
  IRList,
  IRNode,
  IRStateDecl,
  IRTree,
  IRWarning
} from '../types'

import {
  registerDocStateReads,
  resolveEvents,
  resolveTextBinding,
  resolveValueBinding,
  unknownIdentifiers
} from './bindings'
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
  // Phase 3 §2: lift root-level supabaseConfig onto the tree so the React
  // adapter can decide to emit `_lowcode_supabase.ts` without re-reading
  // the SceneGraph (which it doesn't have access to from `emit(irs, opts)`).
  const supabaseConfig = graph.getNode(graph.rootId)?.lowcodeSupabaseConfig

  if (!page) {
    return {
      pageId,
      pageName: 'Page',
      children: [],
      states,
      docStates,
      docStateReads: [],
      docStateWrites: [],
      supabaseConfig,
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
    supabaseConfig,
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
 *  to the IR shape. Validates names; invalid entries warn and are dropped.
 *
 *  Phase 3 §2: when the root carries `lowcodeSupabaseConfig`, auto-prepend a
 *  built-in `$currentUser` doc-state so user pages can bind to auth session
 *  values. `$` is a reserved name prefix (rejected by `validateStateName`),
 *  so collisions with user-declared docStates aren't possible. */
function collectDocStates(graph: SceneGraph, warnings: IRWarning[]): IRDocStateDecl[] {
  const root = graph.getNode(graph.rootId)
  const decls = root?.lowcodeDocumentState ?? []
  const out: IRDocStateDecl[] = []
  const seen = new Set<string>()
  if (root?.lowcodeSupabaseConfig) {
    const builtIn = currentUserBuiltIn()
    seen.add(builtIn.name)
    out.push(builtIn)
  }
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

/** Phase 3 §2: shape of the auto-registered `$currentUser` doc-state. The
 *  runtime in `_lowcode_supabase.ts` writes into it via `setDocState` on
 *  `auth.getSession()` + `onAuthStateChange`; user pages read it via the
 *  usual `useDocState('$currentUser')` channel. */
function currentUserBuiltIn(): IRDocStateDecl {
  return {
    id: '$currentUser',
    name: '$currentUser',
    type: 'object',
    defaultValue: { id: null, email: null, signedIn: false }
  }
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
  LIST: 'div',
  // Phase 2 §8
  RADIO: 'div',
  TEXTAREA: 'textarea',
  DATEPICKER: 'input',
  SWITCH: 'input'
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

function isCheckboxGroup(node: SceneNode): boolean {
  if (node.type !== 'CHECKBOX') return false
  const raw = node.interactiveProps?.options
  return Array.isArray(raw) && raw.length > 0
}

function nodeToIR(node: SceneNode, ctx: WalkCtx): IRNode | null {
  // Phase 3 §3.v4 step 8 — CHECKBOX with options[] becomes a multi-select
  // group: render as a <div> wrapper with N child <input type="checkbox">
  // (mirrors RADIO). Without options it stays the single-input boolean
  // toggle from §3.x / §3.v4.
  const tag = isCheckboxGroup(node) ? 'div' : TAG_BY_TYPE[node.type]
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
    ctx.docStateWrites,
    ctx.inScope,
    ctx.docStateReads
  )

  const controlled = applyControlledInput(node, ctx, attrs, children, events)

  const element: IRElement = {
    kind: 'element',
    sourceId: node.id,
    tag,
    className,
    attrs,
    children,
    ...(events && Object.keys(events).length > 0 ? { events } : {}),
    ...(controlled ? { controlled } : {})
  }
  return wrapConditional(node, element, ctx)
}

// Phase 3 §3.v4: form-control types eligible for `bindings.value` controlled
// wiring. Per-type allowed targetType (string / number / boolean) is enforced
// inside `resolveValueBinding`.
const CONTROLLED_NODE_TYPES: ReadonlySet<SceneNode['type']> = new Set([
  'INPUT',
  'TEXTAREA',
  'CHECKBOX',
  'SWITCH',
  'SELECT',
  'RADIO',
  'DATEPICKER'
])

function applyControlledInput(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[],
  events: Partial<Record<IREventName, IREventHandler[]>> | undefined
): IRControlledInput | undefined {
  if (!CONTROLLED_NODE_TYPES.has(node.type)) return undefined
  const controlled = resolveValueBinding(node, ctx.states, ctx.warnings, ctx.docStates, ctx.docStateReads, ctx.docStateWrites)
  if (!controlled) return undefined
  if (events?.onChange) {
    // Same code as §3.x (locked) — message generalized to cover the new
    // node types added in §3.v4.
    ctx.warnings.push({
      code: 'input-controlled-onchange-conflict',
      message: `controlled ${node.type} ${node.id} has user-defined onChange; dropped (binding.value owns onChange)`,
      nodeId: node.id
    })
    delete events.onChange
  }
  // Drop uncontrolled fallback attrs per node type — text-like writes through
  // `value=`, boolean through `checked=`; either way the uncontrolled
  // counterpart on the same control would race with React's value reconciler.
  delete attrs.defaultValue
  delete attrs.defaultChecked
  // RADIO: the parent <div> wrapper isn't the interactive element — each
  // child <input type="radio"> is. Copy the controlled descriptor onto every
  // radio leaf so the emit pass picks up `checked={read === <opt>}` +
  // shared onChange at the leaf, drop the per-radio uncontrolled
  // `defaultChecked`, and return undefined so the wrapper itself doesn't
  // emit `value=` / `onChange=` (div has no such semantics). docState
  // reads/writes were already registered as a side effect inside
  // `resolveValueBinding` so the page scaffold imports are unaffected.
  if (node.type === 'RADIO') {
    patchOptionLeafControlled(children, 'radio', controlled)
    return undefined
  }
  // CHECKBOX group (§3.v4 step 8): same wrapper-vs-leaf split as RADIO.
  // Per-child checkbox gets the controlled descriptor; emit branches on
  // `attrs.type === 'checkbox' && targetType === 'array'` to produce the
  // array-includes/toggle pair.
  if (isCheckboxGroup(node)) {
    patchOptionLeafControlled(children, 'checkbox', controlled)
    return undefined
  }
  return controlled
}

/** Shared: walk a wrapper's `<label><input.../></label>` children, find the
 *  per-option <input> leaves matching `inputType`, drop their uncontrolled
 *  `defaultChecked` fallback, and attach the parent's controlled descriptor.
 *  Used by both RADIO (inputType='radio') and CHECKBOX group (='checkbox'). */
function patchOptionLeafControlled(
  children: IRNode[],
  inputType: 'radio' | 'checkbox',
  controlled: IRControlledInput
): void {
  for (const child of children) {
    if (child.kind !== 'element' || child.tag !== 'label') continue
    for (const inner of child.children) {
      if (
        inner.kind === 'element' &&
        inner.tag === 'input' &&
        inner.attrs.type === inputType
      ) {
        delete inner.attrs.defaultChecked
        inner.controlled = controlled
      }
    }
  }
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
  const unknown = unknownIdentifiers(parsed.references, ctx.states, ctx.inScope, ctx.docStates)
  if (unknown.length > 0) {
    ctx.warnings.push({
      code: 'condition-unknown-identifier',
      message: `node ${node.id} renderCondition references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: node.id
    })
    return element
  }
  // Phase 2 §4: a docState referenced by the condition needs a `useDocState`
  // local on the page.
  registerDocStateReads(parsed.references, ctx.docStates, ctx.docStateReads)
  const conditional: IRConditional = {
    kind: 'conditional',
    ast: parsed.ast,
    references: [...parsed.references],
    consequent: element
  }
  return conditional
}

type InteractiveProps = Record<string, unknown>

/** INPUT / TEXTAREA — a text-entry field carrying placeholder + value. */
function applyTextInputProps(ip: InteractiveProps, attrs: Record<string, IRAttrValue>): void {
  if (typeof ip.placeholder === 'string') attrs.placeholder = ip.placeholder
  if (typeof ip.value === 'string' && ip.value !== '') attrs.defaultValue = ip.value
}

/** CHECKBOX / SWITCH — a checkbox input; SWITCH adds the `switch` ARIA role
 *  (Phase 2 §8 — the visual styling is the only difference). */
function applyToggleProps(
  ip: InteractiveProps,
  attrs: Record<string, IRAttrValue>,
  role?: string
): void {
  attrs.type = 'checkbox'
  if (role !== undefined) attrs.role = role
  if (ip.checked === true) attrs.defaultChecked = true
}

/** DATEPICKER — a native `<input type="date">` (Phase 2 §8). */
function applyDatePickerProps(ip: InteractiveProps, attrs: Record<string, IRAttrValue>): void {
  attrs.type = 'date'
  if (typeof ip.value === 'string' && ip.value !== '') attrs.defaultValue = ip.value
}

/** BUTTON — `type="button"` plus a text child from a binding or the literal. */
function applyButtonProps(
  node: SceneNode,
  ip: InteractiveProps,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[],
  ctx: WalkCtx
): void {
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
}

/** The string entries of `interactiveProps.options`, used by both SELECT and
 *  RADIO (Phase 2 §8). Non-string entries are dropped. */
function optionStrings(ip: InteractiveProps): string[] {
  const raw = Array.isArray(ip.options) ? ip.options : []
  return raw.filter((o): o is string => typeof o === 'string')
}

/** SELECT — one `<option>` child per string in `interactiveProps.options`. */
function applySelectOptions(node: SceneNode, ip: InteractiveProps, children: IRNode[]): void {
  for (const opt of optionStrings(ip)) {
    children.push({
      kind: 'element',
      sourceId: node.id,
      tag: 'option',
      className: '',
      attrs: { value: opt },
      children: [{ kind: 'text', value: opt }]
    })
  }
}

/** Shared per-option emit for RADIO + CHECKBOX-group wrappers. Each option
 *  becomes a `<label><input ...> opt</label>` child of the wrapper div.
 *  `makeInputAttrs(opt)` lets the caller specialize the input attrs
 *  (type, name, value, defaultChecked). */
function appendOptionInputs(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[],
  makeInputAttrs: (opt: string) => Record<string, IRAttrValue>
): void {
  for (const opt of optionStrings(ip)) {
    children.push({
      kind: 'element',
      sourceId: node.id,
      tag: 'label',
      className: '',
      attrs: {},
      children: [
        {
          kind: 'element',
          sourceId: node.id,
          tag: 'input',
          className: '',
          attrs: makeInputAttrs(opt),
          children: []
        },
        { kind: 'text', value: opt }
      ]
    })
  }
}

/** CHECKBOX group (Phase 3 §3.v4 step 8) — when `interactiveProps.options`
 *  is set, the CHECKBOX node renders as a wrapper div with one
 *  `<label><input type="checkbox" value={opt}/> opt</label>` per option,
 *  bound to an array<string> state (each option toggles in/out). Mirrors
 *  RADIO's option emit; the uncontrolled fallback path doesn't pre-check
 *  any option (multi-select has no single "selected" concept). */
function applyCheckboxGroupOptions(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[]
): void {
  appendOptionInputs(node, ip, children, (opt) => ({ type: 'checkbox', value: opt }))
}

/** RADIO — a radio-group div (Phase 2 §8). Each option becomes a
 *  `<label><input type="radio" name={groupName} value={opt}/> opt</label>`;
 *  the option matching `interactiveProps.value` is `defaultChecked`. */
function applyRadioOptions(node: SceneNode, ip: InteractiveProps, children: IRNode[]): void {
  const groupName = typeof ip.groupName === 'string' ? ip.groupName : ''
  const selected = typeof ip.value === 'string' ? ip.value : ''
  appendOptionInputs(node, ip, children, (opt) => {
    const inputAttrs: Record<string, IRAttrValue> = { type: 'radio', value: opt }
    if (groupName !== '') inputAttrs.name = groupName
    if (opt === selected) inputAttrs.defaultChecked = true
    return inputAttrs
  })
}

function applyInteractiveProps(
  node: SceneNode,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[],
  ctx: WalkCtx
): void {
  const ip = node.interactiveProps ?? {}
  switch (node.type) {
    case 'INPUT':
    case 'TEXTAREA':
      applyTextInputProps(ip, attrs)
      return
    case 'CHECKBOX':
      // Phase 3 §3.v4 step 8 — options[] → multi-select group (mirrors
      // RADIO); no options → single boolean toggle (back-compat).
      if (isCheckboxGroup(node)) applyCheckboxGroupOptions(node, ip, children)
      else applyToggleProps(ip, attrs)
      return
    case 'SWITCH':
      applyToggleProps(ip, attrs, 'switch')
      return
    case 'DATEPICKER':
      applyDatePickerProps(ip, attrs)
      return
    case 'BUTTON':
      applyButtonProps(node, ip, attrs, children, ctx)
      return
    case 'SELECT':
      applySelectOptions(node, ip, children)
      return
    case 'RADIO':
      applyRadioOptions(node, ip, children)
      return
    default:
      return
  }
}
