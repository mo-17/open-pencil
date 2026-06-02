import {
  parseVariantName,
  type NodeType,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/core/scene-graph'
import { renderNodesToSVG } from '@open-pencil/core/io/formats/svg'
import {
  type DatePickerIssueCode,
  parseExpression,
  PREV_IDENT,
  validateDatePickerProps
} from '@open-pencil/core/lowcode-validation'

import { tailwindClassName } from '../style'
import type {
  ComponentDef,
  ComponentProp,
  ComponentRefProp,
  VariantAxis,
  VariantCase,
  IRAttrValue,
  IRComponentRef,
  IRConditional,
  IRControlledInput,
  IRDocStateDecl,
  IRElement,
  IREventHandler,
  IREventName,
  IRList,
  IRNode,
  IRStateDecl,
  IRText,
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
import { type ComponentRegistry, type ComponentSlot, overrideKind } from './components'
import { collectPageStates, indexStatesById } from './state'

/**
 * Walk a CANVAS (page) node and produce a framework-neutral IRTree.
 *
 * This module belongs to the IR layer — it MUST NOT import from
 * `adapters/**`. Adapters consume IR; IR has no awareness of adapters.
 */
export function collectTree(
  graph: SceneGraph,
  pageId: string,
  components: ComponentRegistry = new Map(),
  i18n = false
): IRTree {
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
    inScope: new Set(),
    components,
    i18n
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

/**
 * Phase 3 §8 — collect a ComponentDef for every registered COMPONENT master.
 * Each master's visible children are walked with the same `nodeToIR` pipeline
 * (so they reuse all element/text/binding emit logic, and nested instances
 * become refs), producing the shared subtree the adapter wraps in a component
 * function. Page-state is out of scope for reusable components (empty `states`);
 * doc-state is global so its index is shared.
 */
export function collectComponents(
  graph: SceneGraph,
  components: ComponentRegistry,
  i18n = false
): { defs: ComponentDef[]; warnings: IRWarning[] } {
  const warnings: IRWarning[] = []
  // Discard doc-state warnings here — they're already surfaced per page.
  const docStates = indexDocStatesByName(collectDocStates(graph, []))
  const defs: ComponentDef[] = []
  for (const [componentId, meta] of components) {
    const master = graph.getNode(componentId)
    if (!master) continue
    const baseCtx: WalkCtx = {
      graph,
      states: new Map(),
      docStates,
      docStateReads: new Set(),
      docStateWrites: new Set(),
      warnings,
      inScope: new Set(),
      components,
      i18n
    }
    const variantMeta = meta.variants
    if (variantMeta) {
      // Phase 3 §8 v4: a COMPONENT_SET — one ComponentDef with per-axis variant
      // props. Phase 3 §8 v5: variant subtrees are now also collected with the
      // SET's `propSlots`, so a `:text` / `:fills` override on a variant
      // instance parameterizes the matching node in every variant subtree (each
      // emitting `{prop ?? ownLiteral}` — see `variantBody`).
      const variantCtx: WalkCtx = {
        ...baseCtx,
        componentPropSlots: meta.propSlots,
        variantBody: true
      }
      const variants: VariantCase[] = variantMeta.cases.map((c) => ({
        key: variantMeta.axes.map((a) => c.values[a.rawName] ?? '').join('|'),
        children: collectChildSubtree(graph, c.childId, variantCtx)
      }))
      defs.push({
        componentId,
        name: meta.name,
        children: [],
        props: dedupeProps(meta.propSlots),
        variantAxes: variantMeta.axes,
        variants
      })
      continue
    }
    // Phase 3 §8 v2/v3: parameterize the master's overridden TEXT/fill children.
    const ctx: WalkCtx = { ...baseCtx, componentPropSlots: meta.propSlots }
    const props = [...meta.propSlots.values()].flatMap((slot) =>
      [slot.text, slot.className].filter((p): p is ComponentProp => p !== undefined)
    )
    defs.push({
      componentId,
      name: meta.name,
      children: collectChildSubtree(graph, componentId, ctx),
      props
    })
  }
  return { defs, warnings }
}

/** Phase 3 §8 v5 — flatten a propSlots map to the component's prop list,
 *  de-duplicated by prop name. A COMPONENT_SET name-merges slots (many variant
 *  descendant ids → one shared slot object), so the same prop appears under
 *  several keys; dedupe so the emitted signature declares it once. */
function dedupeProps(propSlots: Map<string, ComponentSlot>): ComponentProp[] {
  const byName = new Map<string, ComponentProp>()
  for (const slot of propSlots.values()) {
    for (const prop of [slot.text, slot.className]) {
      if (prop && !byName.has(prop.name)) byName.set(prop.name, prop)
    }
  }
  return [...byName.values()]
}

/** Walk a master / variant node's visible children through the shared
 *  `nodeToIR` pipeline into a component-body subtree. */
function collectChildSubtree(graph: SceneGraph, parentId: string, ctx: WalkCtx): IRNode[] {
  const children: IRNode[] = []
  for (const child of graph.getChildren(parentId)) {
    if (!child.visible) continue
    const ir = nodeToIR(child, ctx)
    if (ir) children.push(ir)
  }
  return children
}

/** Phase 3 §8 — emit a `<Name />` ref for a registered COMPONENT master or an
 *  INSTANCE of one; null for everything else (normal inline emit). Phase 3 §8
 *  v6: every instance composes — `:text` overrides pass as content props
 *  (`title=`), every other visual override passes as a className prop
 *  (`badgeClassName=`, the whole recomputed child className). There is no longer
 *  an inline fallback for property overrides (the suffix universe is all
 *  property-level, so nothing is unsupported). */
function resolveComponentRef(node: SceneNode, ctx: WalkCtx): IRComponentRef | null {
  if (node.type === 'COMPONENT') {
    const meta = ctx.components.get(node.id)
    if (!meta) return null
    return refOf(node, meta.name, [], ctx)
  }
  if (node.type !== 'INSTANCE' || !node.componentId) return null
  const meta = ctx.components.get(node.componentId)
  if (meta) {
    return refOf(node, meta.name, resolveInstanceProps(node, meta.propSlots, ctx.graph), ctx)
  }
  // Phase 3 §8 v4: a variant instance — componentId points to a variant child
  // of a registered COMPONENT_SET.
  const variantChild = ctx.graph.getNode(node.componentId)
  const setMeta = variantChild?.parentId ? ctx.components.get(variantChild.parentId) : undefined
  if (!variantChild || !setMeta?.variants) return null
  // Phase 3 §8 v5/v6: a variant instance composes its variant prop with any
  // text/className override props.
  const props = [
    ...variantProps(variantChild, setMeta.variants.axes),
    ...resolveInstanceProps(node, setMeta.propSlots, ctx.graph)
  ]
  return refOf(node, setMeta.name, props, ctx)
}

/** Phase 3 §8 v4 — the per-axis variant props a variant instance passes. The
 *  instance's variant is the parsed name of the variant COMPONENT it points to;
 *  an axis equal to its default is omitted (the component default covers it). */
function variantProps(variantChild: SceneNode, axes: VariantAxis[]): ComponentRefProp[] {
  const values = parseVariantName(variantChild.name)
  const props: ComponentRefProp[] = []
  for (const axis of axes) {
    const value = values[axis.rawName] ?? axis.defaultValue
    if (value !== axis.defaultValue) props.push({ name: axis.name, value, kind: 'variant' })
  }
  return props
}

function refOf(
  node: SceneNode,
  name: string,
  props: ComponentRefProp[],
  ctx: WalkCtx
): IRComponentRef {
  return {
    kind: 'componentRef',
    sourceId: node.id,
    name,
    className: tailwindClassName(node, ctx.graph),
    props
  }
}

/** Phase 3 §8 v2/v3/v6 — the override values an instance passes. For each
 *  override, map the instance child back to the master descendant (its
 *  `componentId`) to find the prop slot, then read the diverged value off the
 *  instance child: text from `instChild.text`, className from
 *  `tailwindClassName(instChild)` (the whole recomputed appearance, so a single
 *  className prop covers fills + font + size + … on that child). Multiple
 *  non-text overrides on one child collapse onto its single className prop, so
 *  it is emitted once (`seen` dedup). Overrides whose target isn't a known slot
 *  are skipped (defensive). */
function resolveInstanceProps(
  node: SceneNode,
  propSlots: Map<string, ComponentSlot>,
  graph: WalkCtx['graph']
): ComponentRefProp[] {
  const props: ComponentRefProp[] = []
  const seen = new Set<string>()
  for (const key of Object.keys(node.overrides)) {
    const colon = key.lastIndexOf(':')
    if (colon === -1) continue
    const instChild = graph.getNode(key.slice(0, colon))
    const slot = instChild?.componentId ? propSlots.get(instChild.componentId) : undefined
    if (!slot || !instChild) continue
    const kind = overrideKind(key)
    if (kind === 'text' && slot.text && !seen.has(slot.text.name)) {
      seen.add(slot.text.name)
      props.push({ name: slot.text.name, value: instChild.text, kind: 'text' })
    } else if (kind === 'className' && slot.className && !seen.has(slot.className.name)) {
      seen.add(slot.className.name)
      props.push({
        name: slot.className.name,
        value: tailwindClassName(instChild, graph),
        kind: 'className'
      })
    }
  }
  return props
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
  /** Phase 3 §8: master-id → component metadata registry. A registered
   *  COMPONENT master, and every clean / text-only INSTANCE of one, emit an
   *  IRComponentRef instead of being inlined. Empty map ≡ no component
   *  extraction. */
  components: ComponentRegistry
  /** Phase 3 §8 v2/v3: when collecting a component body, the master-descendant
   *  node id → prop slot map for that component. A TEXT node whose id is a key
   *  emits `{prop}` instead of its literal (text slot); an element whose id is a
   *  key emits `className={prop}` (className slot). Undefined during page
   *  walks. */
  componentPropSlots?: Map<string, ComponentSlot>
  /** Phase 3 §9: externalize visible display strings into i18n messages. When
   *  true, `displayText` tags each literal with a content-hash `messageId` so
   *  the adapter emits `<FormattedMessage>` + a locale catalog. */
  i18n?: boolean
  /** Phase 3 §8 v5: true while collecting a COMPONENT_SET variant subtree. A
   *  prop here spans multiple variant subtrees with different static defaults,
   *  so a parameterized node emits `{prop ?? ownLiteral}` / `className={prop ??
   *  "ownClasses"}` (per-variant fallback) instead of plain `{prop}`. */
  variantBody?: boolean
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

// Pure-vector shape types whose appearance IS the path geometry. As plain
// `<div>`s they emit only size + fill→bg, i.e. a solid colored box (icons show
// up as squares in the preview). Instead we emit the node's geometry as inline
// SVG (reusing core's headless SVG exporter) inside the layout wrapper.
// RECTANGLE / ELLIPSE / ROUNDED_RECTANGLE / FRAME stay CSS boxes — a div with a
// background / border-radius is the faithful (and lighter) representation.
const SVG_SHAPE_TYPES: ReadonlySet<NodeType> = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'POLYGON',
  'LINE'
])

// Container types that fold into a single inline SVG when their whole visible
// subtree is vectors — i.e. a multi-path icon. `import_svg` wraps a multi-path
// icon in a FRAME of full-size VECTOR children (each path is a separate node at
// 0,0 spanning the frame). Emitting each child as its own SVG div left them
// unpositioned, so they stacked / overlapped (icon paths misaligned). Folding
// the container to one `renderNodesToSVG([containerId])` puts every path in one
// shared viewBox at its true coordinates. RECTANGLE / ELLIPSE / FORM are
// excluded — they carry their own CSS-box / form semantics.
const VECTOR_FOLDABLE_CONTAINERS: ReadonlySet<NodeType> = new Set([
  'FRAME',
  'GROUP',
  'SECTION',
  'COMPONENT',
  'INSTANCE'
])

/**
 * A node is an "icon" emittable as one inline SVG when it is a vector shape, or
 * a foldable container whose every visible child is itself such a node
 * (recursively). Empty containers don't qualify (nothing to render).
 */
function isVectorIcon(node: SceneNode, graph: SceneGraph): boolean {
  if (SVG_SHAPE_TYPES.has(node.type)) return true
  if (!VECTOR_FOLDABLE_CONTAINERS.has(node.type)) return false
  const visibleChildren = graph.getChildren(node.id).filter((c) => c.visible)
  return visibleChildren.length > 0 && visibleChildren.every((c) => isVectorIcon(c, graph))
}

/**
 * Render a vector node (or an all-vector container — `renderNodesToSVG` walks
 * descendants) to a self-contained inline `<svg>` string, or undefined when
 * there's no renderable geometry (falls back to the plain div). It normalizes
 * to a `0 0 w h` viewBox; we drop the `<?xml?>` prelude (`xmlDeclaration:
 * false`) and swap the fixed pixel width/height for 100% so the SVG fills the
 * layout wrapper (whose Tailwind size classes already carry the node's
 * dimensions) while the viewBox preserves the aspect ratio.
 */
function buildVectorSvg(node: SceneNode, graph: SceneGraph): string | undefined {
  const svg = renderNodesToSVG(graph, '', [node.id], { xmlDeclaration: false })
  if (!svg) return undefined
  return svg.replace(/(<svg\b[^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, '$1 width="100%" height="100%"')
}

/**
 * Drop paint-derived Tailwind classes (fill→`bg-*`, stroke→`border*`, plus
 * `ring-*`/`shadow-*`) from a vector-shape wrapper. The fill/stroke/effects now
 * live in the inline SVG; leaving `bg-[<fill>]` on the wrapper would paint a
 * solid box of the icon's own color behind it — i.e. the square would persist.
 * Layout/size/position/opacity/`rounded-*` classes are kept.
 */
function stripPaintClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((c) => c !== '' && !/^(bg-|border(-|$)|ring(-|$)|shadow(-|$))/.test(c))
    .join(' ')
}

/**
 * For an icon node (a vector shape or an all-vector container, see
 * isVectorIcon), build its inline SVG and strip paint classes from the wrapper;
 * for everything else (or a node with no renderable geometry) pass the className
 * through unchanged. Returns `extra` to spread onto the IRElement (`{ rawHtml }`
 * or `{}`) so the caller adds no extra branches.
 */
function resolveVectorSvg(
  node: SceneNode,
  graph: SceneGraph,
  className: string
): { className: string; extra: { rawHtml?: string } } {
  if (!isVectorIcon(node, graph)) return { className, extra: {} }
  const svg = buildVectorSvg(node, graph)
  if (svg === undefined) return { className, extra: {} }
  return { className: stripPaintClasses(className), extra: { rawHtml: svg } }
}

/** Phase 3 §9 — build a text IR node, tagged with a content-hash `messageId`
 *  when i18n is enabled so the adapter externalizes it into a locale message
 *  (`<FormattedMessage>`). Off → a plain literal `{kind:'text', value}`. */
function displayText(value: string, ctx: WalkCtx): IRText {
  if (!ctx.i18n) return { kind: 'text', value }
  return { kind: 'text', value, messageId: messageKey(value) }
}

/** Stable, deterministic message id for a source string: fnv-1a hash → base36.
 *  Same string → same id (dedupes identical copy + keeps keys churn-free across
 *  re-compiles). No `Math.random` (CLAUDE.md). */
function messageKey(value: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `m${(h >>> 0).toString(36)}`
}

function nodeToIR(node: SceneNode, ctx: WalkCtx): IRNode | null {
  // Phase 3 §8 — a registered COMPONENT master, or a clean INSTANCE of one,
  // renders as `<Name className="..." />` (the shared subtree lives in the
  // emitted component file). Dirty instances (with overrides) and unregistered
  // components fall through to normal inline emission.
  const componentRef = resolveComponentRef(node, ctx)
  if (componentRef) return componentRef

  // Phase 3 §3.v4 step 8 — CHECKBOX with options[] becomes a multi-select
  // group: render as a <div> wrapper with N child <input type="checkbox">
  // (mirrors RADIO). Without options it stays the single-input boolean
  // toggle from §3.x / §3.v4.
  const tag = isCheckboxGroup(node) ? 'div' : TAG_BY_TYPE[node.type]
  if (!tag) return null

  let className = tailwindClassName(node, ctx.graph)
  // Phase 3 §3.v5 — give RADIO / CHECKBOX-group wrappers a sane vertical
  // stack with spacing when the SceneNode itself isn't an auto-layout
  // (FREE-positioned wrappers would otherwise let the option <label>s run
  // together inline with no gaps). Auto-layout wrappers already carry a
  // flex/grid layout from the canvas — respect the direction the user set.
  if (
    (node.type === 'RADIO' || isCheckboxGroup(node)) &&
    !/(^|\s)(flex|inline-flex|grid|inline-grid)(\s|$)/.test(className)
  ) {
    className = className === '' ? OPTION_GROUP_WRAPPER_CLASSES : `${className} ${OPTION_GROUP_WRAPPER_CLASSES}`
  }
  const attrs: Record<string, IRAttrValue> = {}
  const children: IRNode[] = []

  applyInteractiveProps(node, attrs, children, ctx)

  // Icon nodes (a vector shape, or an all-vector container — see isVectorIcon)
  // emit their geometry as one inline SVG; the wrapper keeps layout/size classes
  // but sheds paint classes, and no children are collected (a folded container
  // is rendered whole by renderNodesToSVG). The branching lives in
  // resolveVectorSvg / collectChildNodes so nodeToIR stays under the complexity
  // gate.
  const vector = resolveVectorSvg(node, ctx.graph, className)
  className = vector.className
  if (vector.extra.rawHtml === undefined) collectChildNodes(node, ctx, children)

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

  // Phase 3 §8 v3: inside a component body, a child with a `:fills` override
  // slot emits `className={prop}` so an instance can re-style it; the static
  // `className` above is the prop default (and what Tailwind safelists).
  const classNameProp = ctx.componentPropSlots?.get(node.id)?.className?.name

  const element: IRElement = {
    kind: 'element',
    sourceId: node.id,
    tag,
    className,
    ...(classNameProp ? { classNameProp } : {}),
    // Phase 3 §8 v5: in a variant subtree the prop spans variants with
    // different static defaults → emit `className={prop ?? "ownClasses"}`.
    ...(classNameProp && ctx.variantBody ? { classNamePropFallback: true } : {}),
    attrs,
    children,
    ...(events && Object.keys(events).length > 0 ? { events } : {}),
    ...(controlled ? { controlled } : {}),
    ...vector.extra
  }
  return wrapConditional(node, element, ctx)
}

/**
 * Collect an element's children: TEXT bindings/literals, a LIST directive, or
 * the recursive container children. Extracted from nodeToIR so the icon-fold
 * path can skip it (a folded icon renders its whole subtree as one SVG) and to
 * keep nodeToIR under the cyclomatic-complexity gate.
 */
function collectChildNodes(node: SceneNode, ctx: WalkCtx, children: IRNode[]): void {
  if (node.type === 'TEXT') {
    const binding = resolveTextBinding(
      node,
      ctx.states,
      ctx.warnings,
      ctx.inScope,
      ctx.docStates,
      ctx.docStateReads
    )
    // Phase 3 §8 v2: inside a component body, a TEXT node that an instance
    // overrides becomes a `{prop}` slot instead of a literal, so each usage
    // can pass its own text. A real binding still wins (component bodies have
    // empty page-state, so this only matters if a docState binding exists).
    const textProp = ctx.componentPropSlots?.get(node.id)?.text
    if (binding) {
      children.push(binding)
    } else if (textProp) {
      // Phase 3 §8 v5: in a COMPONENT_SET variant subtree, emit
      // `{prop ?? "thisVariantsOwnText"}` so an un-passed prop keeps each
      // variant's own default; a plain component (single body) emits `{prop}`
      // and defaults via the signature.
      children.push({
        kind: 'expression',
        ast: { kind: 'ident', name: textProp.name },
        references: [textProp.name],
        ...(ctx.variantBody ? { fallback: node.text } : {})
      })
    } else if (node.text) {
      children.push(displayText(node.text, ctx))
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

// Phase 3 §3.v7 — human-readable IRWarning suffix per DATEPICKER issue
// (no-swallow, 经验 C). Keyed by code so the union stays exhaustive.
const DATEPICKER_WARNING: Record<DatePickerIssueCode, string> = {
  'datepicker-invalid-value':
    'interactiveProps.value is not a valid YYYY-MM-DD date; default date dropped',
  'datepicker-invalid-min': 'interactiveProps.min is not a valid YYYY-MM-DD date; min dropped',
  'datepicker-invalid-max': 'interactiveProps.max is not a valid YYYY-MM-DD date; max dropped',
  'datepicker-range-inverted':
    'interactiveProps.min is after max; the date input will allow no selection',
  'datepicker-value-out-of-range':
    'interactiveProps.value is outside [min, max]; kept but the browser will flag it invalid'
}

/** DATEPICKER — a native `<input type="date">` (Phase 2 §8). Phase 3 §3.v7
 *  adds `min`/`max` range attrs + ISO format validation: a format-invalid
 *  value/min/max is dropped from emit (decision §3.v7.2 e); range-inverted
 *  and out-of-range are warn-and-keep (decision §3.v7.2 h — the browser
 *  disables the invalid selection). Every issue surfaces an IRWarning. */
function applyDatePickerProps(
  node: SceneNode,
  ip: InteractiveProps,
  attrs: Record<string, IRAttrValue>,
  ctx: WalkCtx
): void {
  attrs.type = 'date'
  const badFormat = new Set<'value' | 'min' | 'max'>()
  for (const issue of validateDatePickerProps(ip)) {
    ctx.warnings.push({
      code: issue.code,
      message: `DATEPICKER ${node.id} ${DATEPICKER_WARNING[issue.code]}`,
      nodeId: node.id
    })
    if (issue.key && issue.code.startsWith('datepicker-invalid')) badFormat.add(issue.key)
  }
  if (typeof ip.value === 'string' && ip.value !== '' && !badFormat.has('value')) {
    attrs.defaultValue = ip.value
  }
  if (typeof ip.min === 'string' && ip.min !== '' && !badFormat.has('min')) attrs.min = ip.min
  if (typeof ip.max === 'string' && ip.max !== '' && !badFormat.has('max')) attrs.max = ip.max
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
    children.push(displayText(text, ctx))
  }
}

/** The string entries of `interactiveProps.options`, used by both SELECT and
 *  RADIO (Phase 2 §8). Non-string entries are dropped. */
function optionStrings(ip: InteractiveProps): string[] {
  const raw = Array.isArray(ip.options) ? ip.options : []
  return raw.filter((o): o is string => typeof o === 'string')
}

/** SELECT — one `<option>` child per string in `interactiveProps.options`. The
 *  option's display label is translatable (§9); its `value=` attr stays the
 *  literal form value. */
function applySelectOptions(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[],
  ctx: WalkCtx
): void {
  for (const opt of optionStrings(ip)) {
    children.push({
      kind: 'element',
      sourceId: node.id,
      tag: 'option',
      className: '',
      attrs: { value: opt },
      children: [displayText(opt, ctx)]
    })
  }
}

// Phase 3 §3.v5 — option-list visual polish for RADIO + CHECKBOX-group.
// The wrapper fallback only applies to FREE-positioned wrappers (auto-layout
// keeps the user's direction); the label/input classes always apply so the
// control + its text align with a small gap instead of butting together.
const OPTION_GROUP_WRAPPER_CLASSES = 'flex flex-col gap-2'
const OPTION_LABEL_CLASSES = 'inline-flex items-center gap-2 cursor-pointer'
const OPTION_INPUT_CLASSES = 'shrink-0 accent-blue-500 dark:accent-blue-400'

/** Shared per-option emit for RADIO + CHECKBOX-group wrappers. Each option
 *  becomes a `<label><input ...> opt</label>` child of the wrapper div.
 *  `makeInputAttrs(opt)` lets the caller specialize the input attrs
 *  (type, name, value, defaultChecked). */
function appendOptionInputs(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[],
  makeInputAttrs: (opt: string) => Record<string, IRAttrValue>,
  ctx: WalkCtx
): void {
  for (const opt of optionStrings(ip)) {
    children.push({
      kind: 'element',
      sourceId: node.id,
      tag: 'label',
      className: OPTION_LABEL_CLASSES,
      attrs: {},
      children: [
        {
          kind: 'element',
          sourceId: node.id,
          tag: 'input',
          className: OPTION_INPUT_CLASSES,
          attrs: makeInputAttrs(opt),
          children: []
        },
        displayText(opt, ctx)
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
  children: IRNode[],
  ctx: WalkCtx
): void {
  appendOptionInputs(node, ip, children, (opt) => ({ type: 'checkbox', value: opt }), ctx)
}

/** RADIO — a radio-group div (Phase 2 §8). Each option becomes a
 *  `<label><input type="radio" name={groupName} value={opt}/> opt</label>`;
 *  the option matching `interactiveProps.value` is `defaultChecked`. */
function applyRadioOptions(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[],
  ctx: WalkCtx
): void {
  const groupName = typeof ip.groupName === 'string' ? ip.groupName : ''
  const selected = typeof ip.value === 'string' ? ip.value : ''
  appendOptionInputs(
    node,
    ip,
    children,
    (opt) => {
      const inputAttrs: Record<string, IRAttrValue> = { type: 'radio', value: opt }
      if (groupName !== '') inputAttrs.name = groupName
      if (opt === selected) inputAttrs.defaultChecked = true
      return inputAttrs
    },
    ctx
  )
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
      if (isCheckboxGroup(node)) applyCheckboxGroupOptions(node, ip, children, ctx)
      else applyToggleProps(ip, attrs)
      return
    case 'SWITCH':
      applyToggleProps(ip, attrs, 'switch')
      return
    case 'DATEPICKER':
      applyDatePickerProps(node, ip, attrs, ctx)
      return
    case 'BUTTON':
      applyButtonProps(node, ip, attrs, children, ctx)
      return
    case 'SELECT':
      applySelectOptions(node, ip, children, ctx)
      return
    case 'RADIO':
      applyRadioOptions(node, ip, children, ctx)
      break
  }
}
