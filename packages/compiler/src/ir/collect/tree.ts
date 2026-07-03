import { designTokenCssVariableName } from '#compiler/theme-css'
import lucideIcons from '@iconify-json/lucide/icons.json' with { type: 'json' }

import { colorToHex8 } from '@open-pencil/core/color'
import { gradientFillCss } from '@open-pencil/core/io/formats/jsx'
import { renderNodesToSVG } from '@open-pencil/core/io/formats/svg'
import {
  type DatePickerIssueCode,
  emitExpression,
  type ExprAst,
  parseExpression,
  parseTemplate,
  PREV_IDENT,
  validateDatePickerProps
} from '@open-pencil/core/lowcode-validation'
import {
  parseVariantName,
  type Effect,
  type Fill,
  type AnalyticsConfig,
  type NodeType,
  type SceneGraph,
  type SceneNode,
  type Stroke,
  type WorkflowDef
} from '@open-pencil/core/scene-graph'

import { tailwindClassName, type CompilerStyleOptions } from '../style'
import type {
  ComponentDef,
  ComponentProp,
  ComponentRefProp,
  VariantAxis,
  VariantCase,
  IRAsset,
  IRAttrValue,
  IRComponentRef,
  IRConditional,
  IRControlledInput,
  IRDocStateDecl,
  IRElement,
  IRExpression,
  IRFieldValidation,
  IRValidationAsync,
  IRFormValidationSummary,
  IRImage,
  IRLink,
  IRList,
  IRListOrder,
  IRListQuery,
  IROverlay,
  IRValidationCustom,
  IRValidationMessages,
  IRValidationRules,
  IRUpload,
  IRMessageValue,
  IRNode,
  IRStateDecl,
  IRText,
  IRTree,
  IRWarning
} from '../types'
import {
  registerDocStateReads,
  resolveEvents,
  resolveSupabaseFilters,
  resolveTextBinding,
  resolveValueBinding,
  QUERY_PARAMS_IDENT,
  ROUTE_PARAMS_IDENT,
  unknownIdentifiers
} from './bindings'
import {
  type ComponentRegistry,
  type ComponentSlot,
  instanceHasDeepOverride,
  overrideKind
} from './components'
import { collectPageStates, indexStatesById, resolveComputedStates } from './state'

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
  i18n = false,
  styleOptions: CompilerStyleOptions = {}
): IRTree {
  const page = graph.getNode(pageId)
  const warnings: IRWarning[] = []
  const collected = collectPageStates(page)
  let states = collected.states
  const { invalid } = collected
  for (const { id, name, reason } of invalid) {
    warnings.push({
      code: 'state-invalid',
      message: `state ${name} (id=${id}): ${reason}`,
      nodeId: pageId
    })
  }
  const docStates = collectDocStates(graph, warnings)
  const docStatesByName = indexDocStatesByName(docStates)
  const docStateReads = new Set<string>()
  const docStateWrites = new Set<string>()
  states = resolveComputedStates(states, warnings, pageId, docStatesByName, docStateReads)
  const stateById = indexStatesById(states)
  // Phase 3 §2: lift root-level supabaseConfig onto the tree so the React
  // adapter can decide to emit `_lowcode_supabase.ts` without re-reading
  // the SceneGraph (which it doesn't have access to from `emit(irs, opts)`).
  const supabaseConfig = graph.getNode(graph.rootId)?.lowcodeSupabaseConfig
  const analyticsConfig = compactAnalyticsConfig(
    graph.getNode(graph.rootId)?.lowcodeAnalyticsConfig
  )
  // Phase 3 §9 v7: lift root-level translation catalog onto the tree so the
  // adapter pre-fills `locales/<code>.json` from authored translations.
  const translations = graph.getNode(graph.rootId)?.lowcodeTranslations
  // Phase 3 §10 v4: index root-level named workflows by id for inline
  // `callWorkflow` expansion in the bindings pass.
  const workflows = liftWorkflows(graph)

  if (!page) {
    return {
      pageId,
      pageName: 'Page',
      usesRouteParams: false,
      children: [],
      states,
      docStates,
      docStateReads: [],
      docStateWrites: [],
      supabaseConfig,
      analyticsConfig,
      translations,
      warnings
    }
  }
  // Phase 4 §16.1: page-level dynamic route pattern (`/product/:id`), validated.
  const routePattern = liftRoutePattern(page, pageId, warnings)

  const listQueries: IRListQuery[] = []
  const validatedFields: IRFieldValidation[] = []
  const assets = new Map<string, IRAsset>()
  const ctx: WalkCtx = {
    graph,
    states: stateById,
    docStates: docStatesByName,
    docStateReads,
    docStateWrites,
    warnings,
    inScope: new Set(),
    components,
    workflows,
    i18n,
    styleOptions,
    listQueries,
    validatedFields,
    assets
  }
  const children: IRNode[] = []
  for (const child of graph.getChildren(pageId)) {
    if (!shouldEmitChild(child, ctx)) continue
    const ir = nodeToIR(child, ctx)
    if (ir) children.push(ir)
  }

  // Phase 4 §16.1: `$params` rode `docStateReads` during the walk (the single
  // expression chokepoint). Extract it out into a flag so `docStateReads` stays
  // pure doc-states for the emit consumers. `Set.delete` returns whether it was
  // present.
  const usesRouteParams = docStateReads.delete(ROUTE_PARAMS_IDENT)
  // Phase 4 §16.4: `$query` rode the same chokepoint; extract it into its own
  // flag so docStateReads stays pure doc-states for the emit consumers.
  const usesQueryParams = docStateReads.delete(QUERY_PARAMS_IDENT)

  // Phase 4 §16.3: auth guard. Lifted after the walk so it can register a
  // `$currentUser` read into the (now-finalized) docStateReads set.
  const { requiresAuth, authRedirect } = liftRequiresAuth(
    graph,
    page,
    pageId,
    docStatesByName,
    docStateReads,
    warnings
  )

  return {
    pageId,
    pageName: page.name || 'Page',
    routePattern,
    usesRouteParams,
    usesQueryParams,
    requiresAuth,
    authRedirect,
    children,
    states,
    docStates,
    docStateReads: [...docStateReads],
    docStateWrites: [...docStateWrites],
    listQueries: listQueries.length > 0 ? listQueries : undefined,
    validatedFields: validatedFields.length > 0 ? validatedFields : undefined,
    supabaseConfig,
    analyticsConfig,
    translations,
    warnings,
    ...(assets.size > 0 ? { assets: [...assets.values()] } : {})
  }
}

function compactAnalyticsConfig(value: AnalyticsConfig | undefined): AnalyticsConfig | undefined {
  if (!value || value.enabled === false) return undefined
  const id = value.id.trim()
  if (id === '') return undefined
  const endpoint = value.endpoint?.trim()
  return {
    provider: value.provider,
    id,
    ...(value.enabled === true ? { enabled: true } : {}),
    ...(value.pageViews === false ? { pageViews: false } : {}),
    ...(value.respectDoNotTrack === true ? { respectDoNotTrack: true } : {}),
    ...(value.consentRegionPreset ? { consentRegionPreset: value.consentRegionPreset } : {}),
    ...(value.consentRequired === true ||
    (value.consentRegionPreset && value.consentRequired === false)
      ? { consentRequired: value.consentRequired }
      : {}),
    ...(value.consentAnalyticsDefault === false ||
    (value.consentRegionPreset && value.consentAnalyticsDefault === true)
      ? { consentAnalyticsDefault: value.consentAnalyticsDefault }
      : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(value.consentCopy ? { consentCopy: compactAnalyticsConsentCopy(value.consentCopy) } : {})
  }
}

function compactAnalyticsConsentCopy(
  value: AnalyticsConfig['consentCopy']
): AnalyticsConfig['consentCopy'] {
  if (!value) return undefined
  const bannerText = value.bannerText?.trim()
  const analyticsDescription = value.analyticsDescription?.trim()
  const privacyPolicyUrl = value.privacyPolicyUrl?.trim()
  const privacyPolicyLabel = value.privacyPolicyLabel?.trim()
  const copy = {
    ...(bannerText ? { bannerText } : {}),
    ...(analyticsDescription ? { analyticsDescription } : {}),
    ...(privacyPolicyUrl ? { privacyPolicyUrl } : {}),
    ...(privacyPolicyLabel ? { privacyPolicyLabel } : {})
  }
  return Object.keys(copy).length > 0 ? copy : undefined
}

/** Phase 4 §16.1: lift + validate a page's dynamic route pattern. Returns the
 *  pattern verbatim when it's a non-empty string starting with `/`; warns and
 *  returns undefined (→ slug-derived route) otherwise. */
function liftRoutePattern(
  page: SceneNode,
  pageId: string,
  warnings: IRWarning[]
): string | undefined {
  const raw = page.lowcodeRoutePattern
  if (typeof raw !== 'string' || raw === '') return undefined
  if (!raw.startsWith('/')) {
    warnings.push({
      code: 'route-pattern-invalid',
      message: `page route pattern "${raw}" must start with "/"; falling back to the slug-derived route`,
      nodeId: pageId
    })
    return undefined
  }
  return raw
}

/** Phase 4 §16.3: the built-in auth doc-state + the default login redirect. */
const CURRENT_USER_IDENT = '$currentUser'
const DEFAULT_AUTH_REDIRECT = '/login'

/** Phase 4 §16.3: lift the page's auth-guard flag. Guarding needs the
 *  `$currentUser` doc-state (Supabase configured); a page asking for a guard
 *  without it warns + stays public. When guarded, register a `$currentUser` read
 *  so the page emits the `useDocState('$currentUser')` hook, and resolve the
 *  login redirect from the root's `lowcodeAuthRedirect` (default `/login`). */
function liftRequiresAuth(
  graph: SceneGraph,
  page: SceneNode,
  pageId: string,
  docStates: ReadonlyMap<string, IRDocStateDecl>,
  docStateReads: Set<string>,
  warnings: IRWarning[]
): { requiresAuth?: boolean; authRedirect?: string } {
  if (page.lowcodeRequiresAuth !== true) return {}
  if (!docStates.has(CURRENT_USER_IDENT)) {
    warnings.push({
      code: 'auth-guard-no-supabase',
      message: `page ${page.name || pageId} requiresAuth but has no Supabase config (no ${CURRENT_USER_IDENT} doc-state); guard skipped`,
      nodeId: pageId
    })
    return {}
  }
  docStateReads.add(CURRENT_USER_IDENT)
  const raw = graph.getNode(graph.rootId)?.lowcodeAuthRedirect
  const authRedirect = typeof raw === 'string' && raw !== '' ? raw : DEFAULT_AUTH_REDIRECT
  return { requiresAuth: true, authRedirect }
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
  i18n = false,
  styleOptions: CompilerStyleOptions = {}
): { defs: ComponentDef[]; warnings: IRWarning[] } {
  const warnings: IRWarning[] = []
  // Discard doc-state warnings here — they're already surfaced per page.
  const docStates = indexDocStatesByName(collectDocStates(graph, []))
  const workflows = liftWorkflows(graph)
  const defs: ComponentDef[] = []
  for (const [componentId, meta] of components) {
    const master = graph.getNode(componentId)
    if (!master) continue
    const assets = new Map<string, IRAsset>()
    const docStateReads = new Set<string>()
    const docStateWrites = new Set<string>()
    const validatedFields: IRFieldValidation[] = []
    const baseCtx: WalkCtx = {
      graph,
      states: new Map(),
      docStates,
      docStateReads,
      docStateWrites,
      warnings,
      inScope: new Set(),
      components,
      workflows,
      i18n,
      styleOptions,
      assets,
      validatedFields
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
        variants,
        ...(assets.size > 0 ? { assets: [...assets.values()] } : {}),
        ...componentLowcodeUsage(docStateReads, docStateWrites, validatedFields)
      })
      continue
    }
    // Phase 3 §8 v2/v3: parameterize the master's overridden TEXT/fill children.
    const ctx: WalkCtx = { ...baseCtx, componentPropSlots: meta.propSlots }
    const props = [...meta.propSlots.values()].flatMap(slotProps)
    defs.push({
      componentId,
      name: meta.name,
      children: collectChildSubtree(graph, componentId, ctx),
      props,
      ...(assets.size > 0 ? { assets: [...assets.values()] } : {}),
      ...componentLowcodeUsage(docStateReads, docStateWrites, validatedFields)
    })
  }
  return { defs, warnings }
}

function componentLowcodeUsage(
  docStateReads: ReadonlySet<string>,
  docStateWrites: ReadonlySet<string>,
  validatedFields: readonly IRFieldValidation[]
): Pick<ComponentDef, 'docStateReads' | 'docStateWrites' | 'validatedFields'> {
  return {
    ...(docStateReads.size > 0 ? { docStateReads: [...docStateReads] } : {}),
    ...(docStateWrites.size > 0 ? { docStateWrites: [...docStateWrites] } : {}),
    ...(validatedFields.length > 0 ? { validatedFields: [...validatedFields] } : {})
  }
}

/** Phase 3 §8 v5 — flatten a propSlots map to the component's prop list,
 *  de-duplicated by prop name. A COMPONENT_SET name-merges slots (many variant
 *  descendant ids → one shared slot object), so the same prop appears under
 *  several keys; dedupe so the emitted signature declares it once. */
function dedupeProps(propSlots: Map<string, ComponentSlot>): ComponentProp[] {
  const byName = new Map<string, ComponentProp>()
  for (const slot of propSlots.values()) {
    for (const prop of slotProps(slot)) {
      if (!byName.has(prop.name)) byName.set(prop.name, prop)
    }
  }
  return [...byName.values()]
}

function slotProps(slot: ComponentSlot): ComponentProp[] {
  return [slot.text, slot.className, slot.style].filter((p): p is ComponentProp => p !== undefined)
}

/** Phase 3 §8 v8 / §7 v2 — whether a child reaches emit. Visible children
 *  always do. An invisible child is kept when EITHER (a) it carries a component
 *  prop slot — some instance overrides it (a `:visible=true` reverse override,
 *  or any other override on a base-hidden child, §8 v8); OR (b) it carries a
 *  responsive re-show (a breakpoint override sets `visible:true`, §7 v2). Such a
 *  child emits with `hidden` in its base className (§8 v7a) so it stays hidden
 *  at base, while the instance className prop / `${bp}:<display>` re-show class
 *  un-hides it. */
function shouldEmitChild(child: SceneNode, ctx: WalkCtx): boolean {
  return (
    child.visible || (ctx.componentPropSlots?.has(child.id) ?? false) || hasResponsiveReshow(child)
  )
}

/** Phase 3 §7 v2 — true when a base-hidden node is re-shown at some breakpoint
 *  (a `responsiveOverrides[bp].visible === true`), so the tree walk keeps it. */
function hasResponsiveReshow(node: SceneNode): boolean {
  const overrides = node.responsiveOverrides
  if (!overrides) return false
  return Object.values(overrides).some((o) => o.visible === true)
}

/** Walk a master / variant node's visible children through the shared
 *  `nodeToIR` pipeline into a component-body subtree. */
function collectChildSubtree(graph: SceneGraph, parentId: string, ctx: WalkCtx): IRNode[] {
  const children: IRNode[] = []
  for (const child of graph.getChildren(parentId)) {
    if (!shouldEmitChild(child, ctx)) continue
    const ir = nodeToIR(child, ctx)
    if (ir) children.push(ir)
  }
  return children
}

/** Phase 3 §8 — emit a `<Name />` ref for a registered COMPONENT master or an
 *  INSTANCE of one; null for everything else (normal inline emit). Phase 3 §8
 *  v6: every instance composes — `:text` overrides pass as content props
 *  (`title=`), every other visual override passes as a className prop
 *  (`badgeClassName=`, the whole recomputed child className). Phase 5 §5 follow-up:
 *  token-bound inline styles on an overridden child additionally pass through a
 *  sibling style prop (`badgeStyle=`). */
function resolveComponentRef(node: SceneNode, ctx: WalkCtx): IRComponentRef | null {
  if (node.type === 'COMPONENT') {
    const meta = ctx.components.get(node.id)
    if (!meta) return null
    return refOf(node, meta.name, [], ctx)
  }
  if (node.type !== 'INSTANCE' || !node.componentId) return null
  // Phase 3 §8 v9: an instance that overrides a node inside a nested instance
  // can't thread that override through the `<Nested/>` ref, so it falls back to
  // inlining (return null) — its own clone subtree carries the override values.
  if (instanceHasDeepOverride(ctx.graph, node)) return null
  const meta = ctx.components.get(node.componentId)
  if (meta) {
    return refOf(node, meta.name, resolveInstanceProps(node, meta.propSlots, ctx), ctx)
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
    ...resolveInstanceProps(node, setMeta.propSlots, ctx)
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
  const styleDeclarations = boundVariableStyleDeclarations(node, ctx)
  return {
    kind: 'componentRef',
    sourceId: node.id,
    name,
    className: tailwindClassName(node, ctx.graph, ctx.styleOptions),
    ...(hasStyleDeclarations(styleDeclarations)
      ? { styleAttr: { kind: 'styleAttr', declarations: styleDeclarations } }
      : {}),
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
  ctx: WalkCtx
): ComponentRefProp[] {
  const props: ComponentRefProp[] = []
  const seen = new Set<string>()
  for (const key of Object.keys(node.overrides)) {
    const colon = key.lastIndexOf(':')
    if (colon === -1) continue
    const instChild = ctx.graph.getNode(key.slice(0, colon))
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
        value: tailwindClassName(instChild, ctx.graph, ctx.styleOptions),
        kind: 'className'
      })
      const declarations = boundVariableStyleDeclarations(instChild, ctx)
      if (slot.style && hasStyleDeclarations(declarations) && !seen.has(slot.style.name)) {
        seen.add(slot.style.name)
        props.push({ name: slot.style.name, value: declarations, kind: 'style' })
      }
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
  /** Phase 3 §10 v4: document-level named workflows keyed by id, for inline
   *  `callWorkflow` expansion (the same map for every page / component in a
   *  compile). Empty map ≡ no workflows authored. */
  workflows: ReadonlyMap<string, WorkflowDef>
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
  /** Phase 4 §9 v15: compiler-only CSS emission options, such as gated RTL
   *  logical padding utilities. */
  styleOptions?: CompilerStyleOptions
  /** Phase 3 §8 v5: true while collecting a COMPONENT_SET variant subtree. A
   *  prop here spans multiple variant subtrees with different static defaults,
   *  so a parameterized node emits `{prop ?? ownLiteral}` / `className={prop ??
   *  "ownClasses"}` (per-variant fallback) instead of plain `{prop}`. */
  variantBody?: boolean
  /** Phase 4 §17: accumulator for LIST nodes bound to a Supabase query
   *  datasource — present only during a PAGE walk (the adapter emits the fetch
   *  hooks at the page-component level). Undefined during a component-body walk,
   *  which signals `collectListDirective` to reject a supabase-backed LIST there
   *  (a component has no page-level hook slot). */
  listQueries?: IRListQuery[]
  /** Phase 4 §19: accumulator for controlled form fields carrying validation
   *  rules. Page walks emit this glue in the page module; component walks emit
   *  component-local glue so each component instance owns its error state. */
  validatedFields?: IRFieldValidation[]
  /** Phase 4 §24 v2: binary assets referenced by image fills while walking this
   *  page or component body. */
  assets: Map<string, IRAsset>
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
      defaultValue: d.defaultValue,
      ...(d.persist === true ? { persist: true } : {}),
      ...(typeof d.storageKey === 'string' ? { storageKey: d.storageKey } : {}),
      ...(typeof d.storageVersion === 'string' ? { storageVersion: d.storageVersion } : {})
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

/** Phase 3 §10 v4: index the root node's named workflows by id for inline
 *  `callWorkflow` expansion. A later duplicate id wins (the write path
 *  `set_workflows` rejects duplicates, so this only matters for hand-edited
 *  .fig files). Empty map when no workflows are authored. */
function liftWorkflows(graph: SceneGraph): ReadonlyMap<string, WorkflowDef> {
  const m = new Map<string, WorkflowDef>()
  for (const wf of graph.getNode(graph.rootId)?.lowcodeWorkflows ?? []) {
    if (typeof wf.id === 'string' && wf.id !== '') m.set(wf.id, wf)
  }
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
  if (Array.isArray(raw) && raw.length > 0) return true
  return (
    typeof node.interactiveProps?.optionsSource === 'object' &&
    node.interactiveProps.optionsSource !== null
  )
}

const LUCIDE_ICON_NAMES: ReadonlySet<string> = new Set(Object.keys(lucideIcons.icons))

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
  return svg.replace(
    /(<svg\b[^>]*?)\swidth="[^"]*"\sheight="[^"]*"/,
    '$1 width="100%" height="100%"'
  )
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
 *  (`<FormattedMessage>`). Off → a plain literal `{kind:'text', value}`.
 *
 *  §9 v4/v5 — when the literal carries `${expr}` interpolations, externalize
 *  them: with i18n on → an ICU message with `values` (`Welcome, {name}!`); with
 *  i18n off → a JSX template expression (`{`Welcome, ${name}!`}`). A parse
 *  failure or unknown reference falls back to the plain literal.
 *
 *  §9 v6 — with i18n on, raw ICU plural/select blocks (`{count, plural, …}`)
 *  pass their argument through `values` so react-intl can resolve the form. */
function displayText(value: string, ctx: WalkCtx): IRText | IRExpression {
  if (ctx.i18n) return buildI18nText(value, ctx)
  // §9 v5 — non-i18n interpolation becomes a JSX template expression; emit wraps
  // it as `{`…`}` (emitExpression renders a `template` AST as a JS template
  // literal). No interpolation / invalid → plain literal text.
  if (scanPluralSelectArgs(value).length > 0) {
    ctx.warnings.push({
      code: 'text-plural-requires-i18n',
      message: `text "${value}" uses ICU plural/select but i18n is off; rendering as a literal`,
      nodeId: ''
    })
  }
  const tpl = resolveTextTemplate(value, ctx, 'text-interpolation-unknown-identifier')
  if (!tpl) return { kind: 'text', value }
  return {
    kind: 'expression',
    ast: { kind: 'template', quasis: tpl.quasis, expressions: tpl.expressions },
    references: tpl.references
  }
}

/** §9 v4/v6 — externalize a visible text literal into an i18n message: `${expr}`
 *  interpolations become `{name}` placeholders + values (v4), and raw ICU
 *  plural/select blocks pass their argument through values (v6). */
function buildI18nText(value: string, ctx: WalkCtx): IRText {
  const tpl = resolveTextTemplate(value, ctx, 'i18n-interpolation-unknown-identifier')
  const base: IRText = tpl
    ? buildIcuMessage(tpl)
    : { kind: 'text', value, messageId: messageKey(value) }
  return augmentWithPluralArgs(base, value, ctx)
}

/** §9 v6 — a raw ICU `{arg, plural|select|selectordinal, …}` block in the
 *  message references `arg` (a state / docState identifier), which react-intl
 *  needs in `values`. Detect each such argument, validate it is in scope, and
 *  append it as an identifier value. An unknown argument can't be satisfied (a
 *  missing react-intl value throws at runtime), so the message degrades to a
 *  plain literal with a warning — consistent with `${}` unknown-ref fallback. */
function augmentWithPluralArgs(node: IRText, sourceValue: string, ctx: WalkCtx): IRText {
  const existing = new Set((node.values ?? []).map((v) => v.name))
  const args = scanPluralSelectArgs(node.value).filter((a) => !existing.has(a))
  if (args.length === 0) return node
  const unknown = unknownIdentifiers(new Set(args), ctx.states, ctx.inScope, ctx.docStates)
  if (unknown.length > 0) {
    ctx.warnings.push({
      code: 'i18n-plural-unknown-identifier',
      message: `text "${sourceValue}" plural/select references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: ''
    })
    return { kind: 'text', value: sourceValue }
  }
  registerDocStateReads(args, ctx.docStates, ctx.docStateReads)
  const values: IRMessageValue[] = [
    ...(node.values ?? []),
    ...args.map((name) => ({ name, ast: { kind: 'ident', name } as ExprAst }))
  ]
  return { ...node, values }
}

/** §9 v6 — the distinct argument names of every top-level ICU plural / select /
 *  selectordinal block in a message (`{count, plural, …}` → `count`), in
 *  first-seen order. Nested blocks match too (the regex finds every `{ident,
 *  plural,` regardless of depth), so each referenced argument is collected. */
function scanPluralSelectArgs(message: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of message.matchAll(PLURAL_SELECT_RE)) {
    const arg = match[1]
    if (!seen.has(arg)) {
      seen.add(arg)
      out.push(arg)
    }
  }
  return out
}

const PLURAL_SELECT_RE = /\{\s*([A-Za-z_$][\w$]*)\s*,\s*(?:plural|selectordinal|select)\s*,/g

/** §9 v4/v5 — parse a visible text literal's `${expr}` interpolations, validate
 *  every reference is in scope (state / docState / list item) and register
 *  reachable docStates as reads. Returns the template parts, or null when there
 *  is no interpolation, the template is unparseable, or a reference is unknown
 *  (caller falls back to a plain literal; `warnCode` labels the warning). */
function resolveTextTemplate(
  value: string,
  ctx: WalkCtx,
  warnCode: string
): { quasis: string[]; expressions: ExprAst[]; references: string[] } | null {
  if (!value.includes('${')) return null
  const parsed = parseTemplate(value)
  if (!parsed.ok || parsed.ast.kind !== 'template' || parsed.ast.expressions.length === 0) {
    return null
  }
  const unknown = unknownIdentifiers(parsed.references, ctx.states, ctx.inScope, ctx.docStates)
  if (unknown.length > 0) {
    ctx.warnings.push({
      code: warnCode,
      message: `text "${value}" interpolates unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: ''
    })
    return null
  }
  registerDocStateReads(parsed.references, ctx.docStates, ctx.docStateReads)
  return {
    quasis: parsed.ast.quasis,
    expressions: parsed.ast.expressions,
    references: [...parsed.references]
  }
}

/** §9 v4/v9 — build an ICU `<FormattedMessage>` text node from parsed template
 *  parts: literal quasis interleaved with `{name}` placeholders (invariant
 *  `quasis.length === expressions.length + 1`), each backed by its expression in
 *  `values`. The hash key is the ICU form so identical messages dedupe.
 *
 *  §9 v9 — placeholders dedupe by expression: every occurrence of the *same*
 *  interpolation (`emitExpression(ast)` equal) maps to one placeholder name and
 *  one `values` entry, so `${name} … ${name}` (and the repeated variable in
 *  every branch of a plural body) emits `{name} … {name}` not `{name} {name2}`.
 *  `uniquePlaceholderName`'s numeric suffix still separates *different*
 *  expressions whose leaf names collide (`${a.name} ${b.name}` → `{name}`/`{name2}`). */
function buildIcuMessage(tpl: { quasis: string[]; expressions: ExprAst[] }): IRText {
  const usedNames = new Set<string>()
  const byExpr = new Map<string, IRMessageValue>()
  const names: string[] = []
  for (const ast of tpl.expressions) {
    const key = emitExpression(ast)
    let value = byExpr.get(key)
    if (!value) {
      value = { name: uniquePlaceholderName(ast, usedNames), ast }
      byExpr.set(key, value)
    }
    names.push(value.name)
  }
  const defaultMessage = tpl.quasis
    .map((q, i) => (i < names.length ? `${q}{${names[i]}}` : q))
    .join('')
  return {
    kind: 'text',
    value: defaultMessage,
    messageId: messageKey(defaultMessage),
    values: [...byExpr.values()]
  }
}

/** §9 v4 — a stable, readable ICU placeholder name for an interpolation
 *  expression: an identifier / member's leaf name (`$currentUser.email` → `email`),
 *  else `value`. Sanitized to a legal ICU argument name and de-duplicated with a
 *  numeric suffix so two placeholders in one message never collide. */
function uniquePlaceholderName(ast: ExprAst, used: Set<string>): string {
  let base = 'value'
  if (ast.kind === 'ident') base = ast.name
  else if (ast.kind === 'member') base = ast.property
  base = base.replace(/[^A-Za-z0-9_]/g, '').replace(/^[0-9]+/, '')
  if (base === '') base = 'value'
  let name = base
  let n = 2
  while (used.has(name)) {
    name = `${base}${n}`
    n++
  }
  used.add(name)
  return name
}

/** Phase 3 §9 v3 — externalize a user-facing *attribute* string (an INPUT's
 *  `placeholder`). Unlike `displayText` (visible JSX children → `<FormattedMessage>`),
 *  an attribute can't hold a JSX element, so this returns an `intlMessage`
 *  attr-value the adapter emits via `intl.formatMessage(...)`. i18n off, or an
 *  empty string (nothing to translate), → the plain literal. */
function displayAttr(value: string, ctx: WalkCtx): IRAttrValue {
  if (!ctx.i18n || value === '') return value
  return { kind: 'intlMessage', messageId: messageKey(value), defaultMessage: value }
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

  warnUnsupportedVisualSemantics(node, ctx)

  let className = tailwindClassName(node, ctx.graph, ctx.styleOptions)
  // Phase 4 §24.3: an `interactiveProps.aspectRatio` adds `aspect-[w/h]` to any
  // node (most useful on image / media containers, but not limited to them).
  className = appendAspectRatio(className, node, ctx)
  // Phase 4 §24 v2/v7: Figma visual fills become background classes. Single
  // fills keep the old compact utilities; multiple fills are collapsed into
  // one CSS multi-background so layers don't overwrite each other.
  className = appendVisualFillClasses(className, node, ctx)
  // Phase 4 §24.1: a node carrying `interactiveProps.image` renders as a void
  // `<img>` leaf — resolved + returned here so it skips the control / vector /
  // child-recursion path (an image has none). Events (e.g. onClick) still apply.
  const image = resolveImageNode(node, ctx)
  if (image) return wrapConditional(node, buildImageElement(node, ctx, className, image), ctx)
  // Phase 3 §3.v5 — RADIO / CHECKBOX-group wrappers get a vertical option-stack.
  className = applyOptionGroupWrapper(className, node)
  const attrs: Record<string, IRAttrValue> = {}
  const children: IRNode[] = []

  applyInteractiveProps(node, attrs, children, ctx)
  applyBoundVariableStyles(node, ctx, attrs)

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
    ctx.docStateReads,
    ctx.workflows
  )

  // §18/§3.x/§15: the mutually-exclusive interactive control descriptors —
  // file upload > controlled value > UI-kit control hint. Folded into one helper
  // (with its own side effects) to keep nodeToIR under the complexity gate.
  const controls = resolveControlDescriptors(node, ctx, attrs, children)

  // Phase 3 §8 v3: inside a component body, a child with a `:fills` override
  // slot emits `className={prop}` so an instance can re-style it; the static
  // `className` above is the prop default (and what Tailwind safelists).
  const propOverrides = componentBodyPropOverrides(node, ctx, attrs)

  // Phase 4 §15.1: tag a card-like container FRAME so a UI-kit adapter can wrap
  // it in `<Card>`. Kit-agnostic — the plain emit ignores it (byte-identical).
  const semantics = resolveElementSemantics(node, ctx)

  const element: IRElement = {
    kind: 'element',
    sourceId: node.id,
    tag: semantics.link ? 'a' : tag,
    className,
    ...propOverrides,
    attrs,
    children,
    ...(events && Object.keys(events).length > 0 ? { events } : {}),
    ...controls,
    ...semantics,
    ...vector.extra
  }
  // §19: a <form> with validated descendant fields validates them at submit —
  // the adapter wraps onSubmit to preventDefault + abort when any is invalid.
  if (node.type === 'FORM') {
    const validationKeys = collectValidationKeys(element.children)
    if (validationKeys.length > 0) {
      element.formValidationKeys = validationKeys
      const summary = resolveFormValidationSummary(node)
      if (summary) element.formValidationSummary = summary
    }
  }
  return wrapConditional(node, element, ctx)
}

function componentBodyPropOverrides(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>
): Pick<IRElement, 'classNameProp' | 'classNamePropFallback' | 'styleProp' | 'stylePropFallback'> {
  const slot = ctx.componentPropSlots?.get(node.id)
  const classNameProp = slot?.className?.name
  const styleProp = slot?.style?.name
  return {
    ...(classNameProp ? { classNameProp } : {}),
    // Phase 3 §8 v5: in a variant subtree the prop spans variants with
    // different static defaults → emit `className={prop ?? "ownClasses"}`.
    ...(classNameProp && ctx.variantBody ? { classNamePropFallback: true } : {}),
    ...(styleProp ? { styleProp } : {}),
    ...(styleProp && (ctx.variantBody || attrs.style) ? { stylePropFallback: true } : {})
  }
}

function applyBoundVariableStyles(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>
): void {
  const declarations = boundVariableStyleDeclarations(node, ctx)
  if (!hasStyleDeclarations(declarations)) return
  attrs.style = mergeStyleAttr(attrs.style, declarations)
}

function boundVariableStyleDeclarations(node: SceneNode, ctx: WalkCtx): Record<string, string> {
  const declarations: Record<string, string> = {}
  applyBoundOpacityStyle(node, ctx, declarations)
  applyBoundFillStyle(node, ctx, declarations)
  applyBoundStrokeStyle(node, ctx, declarations)
  return declarations
}

function hasStyleDeclarations(declarations: Record<string, string>): boolean {
  return Object.keys(declarations).length > 0
}

function applyBoundOpacityStyle(
  node: SceneNode,
  ctx: WalkCtx,
  declarations: Record<string, string>
): void {
  const cssVar = cssVarForBinding(node, ctx, 'opacity')
  if (cssVar) declarations.opacity = `var(${cssVar})`
}

function applyBoundFillStyle(
  node: SceneNode,
  ctx: WalkCtx,
  declarations: Record<string, string>
): void {
  if (node.type === 'TEXT') {
    const color = firstBoundTextColor(node, ctx)
    if (color) declarations.color = color
    return
  }

  const background = boundBackgroundDeclarations(node, ctx)
  Object.assign(declarations, background)
}

function firstBoundTextColor(node: SceneNode, ctx: WalkCtx): string | undefined {
  for (let index = 0; index < node.fills.length; index++) {
    const fill = node.fills[index]
    if (!isVisibleSolidPaint(fill)) continue
    const color = cssColorForPaintBinding(node, ctx, `fills/${index}/color`, fill)
    if (color) return color
  }
  return undefined
}

function boundBackgroundDeclarations(node: SceneNode, ctx: WalkCtx): Record<string, string> {
  if (!hasBoundBackgroundFill(node)) return {}
  const visibleBackgrounds = node.fills
    .map((fill, index) => ({ fill, index }))
    .filter(({ fill }) => fill.visible && fill.opacity > 0 && isBackgroundFill(fill))
  if (visibleBackgrounds.length === 0) return {}

  if (visibleBackgrounds.length === 1) {
    const { fill, index } = visibleBackgrounds[0]
    if (fill.type === 'SOLID') {
      const color = cssColorForPaintBinding(node, ctx, `fills/${index}/color`, fill)
      return color ? { backgroundColor: color } : {}
    }
    const layer = backgroundFillLayerWithTokens(fill, index, node, ctx)
    return layer ? backgroundDeclarations([layer]) : {}
  }

  const layers: BackgroundLayer[] = []
  for (const { fill, index } of visibleBackgrounds) {
    const layer = backgroundFillLayerWithTokens(fill, index, node, ctx)
    if (layer) layers.push(layer)
  }
  return layers.length > 0 ? backgroundDeclarations(layers.reverse()) : {}
}

function hasBoundBackgroundFill(node: SceneNode): boolean {
  return node.fills.some((fill, index) => {
    if (!fill.visible || fill.opacity <= 0 || !isBackgroundFill(fill)) return false
    if (node.boundVariables[`fills/${index}/color`]) return true
    return fill.gradientStops?.some((_, stopIndex) =>
      Boolean(node.boundVariables[`fills/${index}/gradientStops/${stopIndex}/color`])
    )
  })
}

function backgroundFillLayerWithTokens(
  fill: Fill,
  index: number,
  node: SceneNode,
  ctx: WalkCtx
): BackgroundLayer | undefined {
  if (fill.type === 'SOLID') return solidFillLayerWithColor(cssColorForFill(node, ctx, index, fill))
  if (fill.type === 'IMAGE') return imageFillLayer(fill, node, ctx)
  const css = gradientFillCssWithTokens(fill, index, node, ctx)
  if (css === null) return undefined
  return { image: css, size: 'auto', position: '0%_0%', repeat: 'no-repeat' }
}

function solidFillLayerWithColor(color: string): BackgroundLayer {
  return {
    image: `linear-gradient(${color}, ${color})`,
    size: 'auto',
    position: '0%_0%',
    repeat: 'no-repeat'
  }
}

function cssColorForFill(node: SceneNode, ctx: WalkCtx, index: number, fill: Fill): string {
  return (
    cssColorForPaintBinding(node, ctx, `fills/${index}/color`, fill) ??
    colorToHex8(fill.color, fill.opacity)
  )
}

function gradientFillCssWithTokens(
  fill: Fill,
  index: number,
  node: SceneNode,
  ctx: WalkCtx
): string | null {
  let css = gradientFillCss(fill, node.width, node.height)
  if (css === null) return null
  const fillCssVar = cssVarForBinding(node, ctx, `fills/${index}/color`)
  if (!fill.gradientStops) return css
  for (let stopIndex = 0; stopIndex < fill.gradientStops.length; stopIndex++) {
    const stop = fill.gradientStops[stopIndex]
    const stopCssVar = cssVarForBinding(
      node,
      ctx,
      `fills/${index}/gradientStops/${stopIndex}/color`
    )
    const cssVar = stopCssVar ?? fillCssVar
    if (cssVar) {
      css = replaceFirst(
        css,
        colorToHex8(stop.color, stop.color.a),
        tokenColor(cssVar, stop.color.a)
      )
    }
  }
  return css
}

function replaceFirst(value: string, search: string, replacement: string): string {
  const index = value.indexOf(search)
  if (index === -1) return value
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`
}

function backgroundDeclarations(layers: BackgroundLayer[]): Record<string, string> {
  return {
    backgroundImage: layers.map((layer) => layer.image).join(', '),
    backgroundSize: layers.map((layer) => cssBackgroundListValue(layer.size)).join(', '),
    backgroundPosition: layers.map((layer) => cssBackgroundListValue(layer.position)).join(', '),
    backgroundRepeat: layers.map((layer) => layer.repeat).join(', ')
  }
}

function cssBackgroundListValue(value: string): string {
  return value.replace(/_/g, ' ')
}

function applyBoundStrokeStyle(
  node: SceneNode,
  ctx: WalkCtx,
  declarations: Record<string, string>
): void {
  const layers = boundStrokeLayers(node, ctx)
  if (layers.length === 0) return

  if (layers.length === 1) {
    const color = layers[0].boundColor
    if (!color) return
    declarations.borderColor = color
    return
  }

  if (hasIndependentStrokeWeights(node)) {
    applyUnsupportedStrokeGeometryFallback(node, ctx, declarations, layers, {
      reason: 'independent stroke weights',
      detail: 'side-specific layered shadows'
    })
    return
  }

  if (hasDashPattern(node)) {
    applyUnsupportedStrokeGeometryFallback(node, ctx, declarations, layers, {
      reason: 'dash pattern strokes',
      detail: 'dashed layered shadows'
    })
    return
  }

  declarations.boxShadow = [...layersToBoxShadow(layers), ...effectShadows(node.effects)].join(', ')
}

interface BoundStrokeLayer {
  stroke: Stroke
  color: string
  boundColor?: string
}

function boundStrokeLayers(node: SceneNode, ctx: WalkCtx): BoundStrokeLayer[] {
  const layers: BoundStrokeLayer[] = []
  let hasBoundLayer = false
  for (let index = 0; index < node.strokes.length; index++) {
    const stroke = node.strokes[index]
    if (!stroke.visible || stroke.opacity <= 0 || stroke.weight <= 0) continue
    const boundColor = cssColorForPaintBinding(node, ctx, `strokes/${index}/color`, stroke)
    if (boundColor) hasBoundLayer = true
    layers.push({
      stroke,
      color: boundColor ?? colorToHex8(stroke.color, stroke.opacity),
      ...(boundColor ? { boundColor } : {})
    })
  }
  return hasBoundLayer ? layers : []
}

function hasIndependentStrokeWeights(node: SceneNode): boolean {
  if (!node.independentStrokeWeights) return false
  const weights = [
    node.borderTopWeight,
    node.borderRightWeight,
    node.borderBottomWeight,
    node.borderLeftWeight
  ]
  return weights.some((weight) => weight !== weights[0])
}

function hasDashPattern(node: SceneNode): boolean {
  return node.dashPattern.some((value) => value > 0)
}

function applyUnsupportedStrokeGeometryFallback(
  node: SceneNode,
  ctx: WalkCtx,
  declarations: Record<string, string>,
  layers: BoundStrokeLayer[],
  { reason, detail }: { reason: string; detail: string }
): void {
  const color = layers.find((layer) => layer.boundColor)?.boundColor
  if (!color) return
  ctx.warnings.push({
    code: 'design-token-stroke-geometry-unsupported',
    message: `${node.type} ${node.id} uses ${reason}; multi-stroke token fallback is reduced to borderColor because ${detail} are not supported yet`,
    nodeId: node.id
  })
  declarations.borderColor = color
}

function layersToBoxShadow(layers: BoundStrokeLayer[]): string[] {
  let insetWidth = 0
  let outsetWidth = 0
  const shadows: string[] = []
  for (const layer of layers) {
    const placement = strokeShadowPlacement(layer.stroke)
    if (placement === 'outset') {
      outsetWidth += layer.stroke.weight
      shadows.push(`0 0 0 ${cssPx(outsetWidth)} ${layer.color}`)
    } else {
      insetWidth += layer.stroke.weight
      shadows.push(`inset 0 0 0 ${cssPx(insetWidth)} ${layer.color}`)
    }
  }
  return shadows
}

function strokeShadowPlacement(stroke: Stroke): 'inset' | 'outset' {
  return stroke.align === 'OUTSIDE' ? 'outset' : 'inset'
}

function cssPx(value: number): string {
  return `${Number(value.toFixed(3))}px`
}

function effectShadows(effects: Effect[]): string[] {
  return effects.flatMap((effect) => {
    if (!effect.visible || (effect.type !== 'DROP_SHADOW' && effect.type !== 'INNER_SHADOW')) {
      return []
    }
    const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : ''
    const spread = effect.spread !== 0 ? ` ${cssPx(effect.spread)}` : ''
    return `${inset}${cssPx(effect.offset.x)} ${cssPx(effect.offset.y)} ${cssPx(effect.radius)}${spread} ${colorToHex8(effect.color, effect.color.a)}`
  })
}

function cssColorForPaintBinding(
  node: SceneNode,
  ctx: WalkCtx,
  path: string,
  paint: { opacity: number }
): string | undefined {
  const cssVar = cssVarForBinding(node, ctx, path)
  return cssVar ? tokenColor(cssVar, paint.opacity) : undefined
}

function cssVarForBinding(node: SceneNode, ctx: WalkCtx, path: string): string | undefined {
  const variableId = node.boundVariables[path]
  if (!variableId) return undefined
  const variable = ctx.graph.variables.get(variableId)
  if (variable?.hiddenFromPublishing) {
    ctx.warnings.push({
      code: 'design-token-binding-hidden',
      message: `${node.type} ${node.id} binding ${path} references hidden design token ${variableId}; static style fallback used`,
      nodeId: node.id
    })
    return undefined
  }
  const cssVar = designTokenCssVariableName(ctx.graph, variableId)
  if (cssVar) return cssVar
  ctx.warnings.push({
    code: 'design-token-binding-missing',
    message: `${node.type} ${node.id} binding ${path} references missing design token ${variableId}; style variable skipped`,
    nodeId: node.id
  })
  return undefined
}

function tokenColor(cssVar: string, opacity: number): string {
  if (opacity >= 1) return `var(${cssVar})`
  const percent = Number(Math.max(0, opacity * 100).toFixed(3))
  return `color-mix(in srgb, var(${cssVar}) ${percent}%, transparent)`
}

function isVisibleSolidPaint(
  paint: { type?: string; visible: boolean; opacity: number } | undefined
): paint is { type: 'SOLID'; visible: true; opacity: number } {
  return !!paint && paint.type === 'SOLID' && paint.visible && paint.opacity > 0
}

function mergeStyleAttr(
  value: IRAttrValue | undefined,
  declarations: Record<string, string>
): IRAttrValue {
  if (typeof value === 'object' && value.kind === 'styleAttr') {
    return { kind: 'styleAttr', declarations: { ...value.declarations, ...declarations } }
  }
  return { kind: 'styleAttr', declarations }
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
      if (!shouldEmitChild(child, ctx)) continue
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

/** Phase 3 §15 Phase B / Phase 4 §15 Phase C — map a form-control SceneNode to
 *  its `controlKind` hint (consumed only by a UI-kit adapter; null = no hint).
 *  SWITCH and single CHECKBOX both emit `<input type=checkbox>` but a SWITCH
 *  carries `role=switch` (applyToggleProps) — here we split them by node type
 *  directly. The array multi-select CHECKBOX group (options[] → `checkbox-group`)
 *  is marked since §15 Phase C; the adapter emits N `<Checkbox>` rows + manual
 *  array toggle (no native shadcn group component). */
function controlKindFor(node: SceneNode): IRElement['controlKind'] {
  switch (node.type) {
    case 'SELECT':
      return 'select'
    case 'SWITCH':
      return 'switch'
    case 'RADIO':
      return 'radio-group'
    case 'CHECKBOX':
      return isCheckboxGroup(node) ? 'checkbox-group' : 'checkbox'
    default:
      return undefined
  }
}

/** Phase 4 §15.1 — heuristic: a container FRAME that looks like a card surface
 *  (visible background fill + rounded corners) gets the `card` container hint so
 *  a UI-kit adapter can wrap it in `<Card>`. Restricted to FRAME (GROUP has no
 *  surface; a bare rounded RECTANGLE is decorative, not a content container).
 *  Consumed only by a UI-kit adapter — the plain emit ignores it. */
function containerKindFor(node: SceneNode): IRElement['containerKind'] {
  if (node.type !== 'FRAME') return undefined
  const hasVisibleFill = node.fills.some((f) => f.visible && f.opacity > 0)
  if (hasVisibleFill && node.cornerRadius > 0) return 'card'
  return undefined
}

function resolveElementSemantics(
  node: SceneNode,
  ctx: WalkCtx
): Pick<IRElement, 'containerKind' | 'displayKind' | 'display' | 'overlay' | 'link' | 'icon'> {
  const containerKind = containerKindFor(node)
  const display = resolveDisplayPrimitive(node, ctx)
  const overlay = resolveOverlay(node, ctx)
  const link = resolveLink(node, ctx)
  const icon = resolveLucideIcon(node, ctx)
  return {
    ...(containerKind ? { containerKind } : {}),
    ...(display ? { displayKind: display.kind, display: display.config } : {}),
    ...(overlay ? { overlay } : {}),
    ...(link ? { link } : {}),
    ...(icon ? { icon } : {})
  }
}

interface UiKitPrimitiveConfig {
  primitive?: unknown
  kind?: unknown
  component?: unknown
  variant?: unknown
  value?: unknown
  src?: unknown
  alt?: unknown
  fallback?: unknown
  defaultValue?: unknown
  valueBinding?: unknown
  type?: unknown
  collapsible?: unknown
  items?: unknown
}

interface UiKitValueBindingConfig {
  kind?: unknown
  stateId?: unknown
  docStateName?: unknown
}

const DISPLAY_PRIMITIVES: ReadonlySet<NonNullable<IRElement['displayKind']>> = new Set([
  'badge',
  'alert',
  'separator',
  'skeleton',
  'progress',
  'avatar',
  'tabs',
  'accordion'
])

/** Phase 4 §22: display-only shadcn primitives are authorized through
 *  `interactiveProps.uiKit = { primitive: "badge" | ... }`. This keeps the
 *  design model unchanged and lets plain HTML emit ignore the hint entirely. */
function resolveDisplayPrimitive(
  node: SceneNode,
  ctx: WalkCtx
):
  | { kind: NonNullable<IRElement['displayKind']>; config: NonNullable<IRElement['display']> }
  | undefined {
  const ip = node.interactiveProps as { uiKit?: UiKitPrimitiveConfig } | undefined
  const raw = ip?.uiKit
  if (!raw || typeof raw !== 'object') return undefined
  const kind = displayPrimitiveKind(raw.primitive ?? raw.kind ?? raw.component)
  if (!kind) {
    const label = displayPrimitiveLabel(raw.primitive ?? raw.kind ?? raw.component)
    if (label !== '') {
      ctx.warnings.push({
        code: 'ui-kit-primitive-unknown',
        message: `node ${node.id} references unknown UI-kit primitive ${label}`,
        nodeId: node.id
      })
    }
    return undefined
  }
  const itemConfig = displayItemsProp(raw.items, kind, node, ctx)
  if ((kind === 'tabs' || kind === 'accordion') && itemConfig.items === undefined) return undefined
  const type = typeof raw.type === 'string' ? raw.type : undefined
  const valueBinding = resolveDisplayValueBinding(raw.valueBinding, kind, type, node, ctx)
  return {
    kind,
    config: {
      ...stringProp(raw.variant, 'variant'),
      ...finiteNumberProp(raw.value, 'value'),
      ...stringProp(raw.src, 'src'),
      ...stringProp(raw.alt, 'alt'),
      ...stringProp(raw.fallback, 'fallback'),
      ...stringProp(raw.defaultValue, 'defaultValue'),
      ...stringProp(type, 'type'),
      ...(valueBinding ? { valueBinding } : {}),
      ...(typeof raw.collapsible === 'boolean' ? { collapsible: raw.collapsible } : {}),
      ...itemConfig
    }
  }
}

function resolveDisplayValueBinding(
  raw: unknown,
  kind: NonNullable<IRElement['displayKind']>,
  type: string | undefined,
  node: SceneNode,
  ctx: WalkCtx
): IRControlledInput | undefined {
  if (raw === undefined) return undefined
  if (kind !== 'tabs' && kind !== 'accordion') {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-unsupported',
      message: `${node.type} ${node.id} ${kind} primitive does not support valueBinding`,
      nodeId: node.id
    })
    return undefined
  }
  if (!raw || typeof raw !== 'object') {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-invalid',
      message: `${node.type} ${node.id} ${kind} primitive valueBinding must be an object`,
      nodeId: node.id
    })
    return undefined
  }
  const binding = raw as UiKitValueBindingConfig
  const targetType = kind === 'accordion' && type === 'multiple' ? 'array' : 'string'
  if (binding.kind === 'docState') {
    const name = typeof binding.docStateName === 'string' ? binding.docStateName : ''
    if (name === '') {
      ctx.warnings.push({
        code: 'ui-kit-primitive-binding-missing-target',
        message: `${node.type} ${node.id} ${kind} primitive docState valueBinding has no docStateName`,
        nodeId: node.id
      })
      return undefined
    }
    const decl = ctx.docStates.get(name)
    if (!decl) {
      ctx.warnings.push({
        code: 'ui-kit-primitive-binding-unknown-target',
        message: `${node.type} ${node.id} ${kind} primitive valueBinding references unknown document state "${name}"`,
        nodeId: node.id
      })
      return undefined
    }
    if (decl.type !== targetType) {
      ctx.warnings.push({
        code: 'ui-kit-primitive-binding-bad-state-type',
        message: `${node.type} ${node.id} ${kind} primitive valueBinding docState "${name}" is type ${decl.type}; expected ${targetType}`,
        nodeId: node.id
      })
      return undefined
    }
    ctx.docStateReads.add(name)
    ctx.docStateWrites.add(name)
    return { read: name, write: { kind: 'docState', name, targetType } }
  }
  if (binding.kind !== 'ref') {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-unsupported-kind',
      message: `${node.type} ${node.id} ${kind} primitive valueBinding kind must be docState or ref`,
      nodeId: node.id
    })
    return undefined
  }
  const stateId = typeof binding.stateId === 'string' ? binding.stateId : ''
  if (stateId === '') {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-missing-target',
      message: `${node.type} ${node.id} ${kind} primitive ref valueBinding has no stateId`,
      nodeId: node.id
    })
    return undefined
  }
  const state = ctx.states.get(stateId)
  if (!state) {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-unknown-target',
      message: `${node.type} ${node.id} ${kind} primitive valueBinding references unknown state ${stateId}`,
      nodeId: node.id
    })
    return undefined
  }
  if (state.computed !== undefined || state.computedInvalid === true) {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-computed-state',
      message: `${node.type} ${node.id} ${kind} primitive valueBinding state "${state.name}" is computed and read-only`,
      nodeId: node.id
    })
    return undefined
  }
  if (state.type !== targetType) {
    ctx.warnings.push({
      code: 'ui-kit-primitive-binding-bad-state-type',
      message: `${node.type} ${node.id} ${kind} primitive valueBinding state "${state.name}" is type ${state.type}; expected ${targetType}`,
      nodeId: node.id
    })
    return undefined
  }
  return { read: state.name, write: { kind: 'state', name: state.name, targetType } }
}

function displayItemsProp(
  raw: unknown,
  kind: NonNullable<IRElement['displayKind']>,
  node: SceneNode,
  ctx: WalkCtx
): Pick<NonNullable<IRElement['display']>, 'items'> {
  if (kind !== 'tabs' && kind !== 'accordion') return {}
  if (!Array.isArray(raw) || raw.length === 0) {
    ctx.warnings.push({
      code: 'ui-kit-primitive-items-invalid',
      message: `${node.type} ${node.id} ${kind} primitive requires a non-empty items array`,
      nodeId: node.id
    })
    return {}
  }
  const items: NonNullable<IRElement['display']>['items'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as { value?: unknown; label?: unknown; title?: unknown; content?: unknown }
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (value === '') continue
    const labelRaw = record.label ?? record.title
    const label = typeof labelRaw === 'string' && labelRaw.trim() !== '' ? labelRaw.trim() : value
    const content = typeof record.content === 'string' ? record.content : ''
    items.push({ value, label, content })
  }
  if (items.length === 0) {
    ctx.warnings.push({
      code: 'ui-kit-primitive-items-invalid',
      message: `${node.type} ${node.id} ${kind} primitive has no valid items`,
      nodeId: node.id
    })
    return {}
  }
  return { items }
}

function displayPrimitiveLabel(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return JSON.stringify(raw)
  return ''
}

function displayPrimitiveKind(raw: unknown): NonNullable<IRElement['displayKind']> | undefined {
  if (typeof raw !== 'string') return undefined
  const normalized = raw.trim().toLowerCase().replaceAll('_', '-')
  return DISPLAY_PRIMITIVES.has(normalized as NonNullable<IRElement['displayKind']>)
    ? (normalized as NonNullable<IRElement['displayKind']>)
    : undefined
}

interface OverlayConfig {
  kind?: unknown
  openRef?: unknown
  closeOnBackdrop?: unknown
}

const OVERLAY_KINDS: ReadonlySet<IROverlay['kind']> = new Set([
  'modal',
  'drawer',
  'popover',
  'tooltip'
])

/** Phase 4 §21: FRAME `interactiveProps.overlay` turns a container into a
 *  conditional overlay panel. `openRef` must name a boolean doc-state so the
 *  runtime can read it and optionally close it from the backdrop. */
function resolveOverlay(node: SceneNode, ctx: WalkCtx): IROverlay | undefined {
  const ip = node.interactiveProps as { overlay?: OverlayConfig } | undefined
  const cfg = ip?.overlay
  if (!cfg || typeof cfg !== 'object') return undefined
  if (node.type !== 'FRAME') {
    ctx.warnings.push({
      code: 'overlay-not-frame',
      message: `${node.type} ${node.id} has interactiveProps.overlay but overlays must be FRAME containers; overlay skipped`,
      nodeId: node.id
    })
    return undefined
  }
  const kind =
    typeof cfg.kind === 'string' && OVERLAY_KINDS.has(cfg.kind as IROverlay['kind'])
      ? (cfg.kind as IROverlay['kind'])
      : 'modal'
  const openRef = typeof cfg.openRef === 'string' ? cfg.openRef.trim() : ''
  const decl = ctx.docStates.get(openRef)
  if (!decl) {
    ctx.warnings.push({
      code: 'overlay-open-ref-unknown',
      message: `FRAME ${node.id} overlay.openRef points to unknown document state ${openRef || '(empty)'}`,
      nodeId: node.id
    })
    return undefined
  }
  if (decl.type !== 'boolean') {
    ctx.warnings.push({
      code: 'overlay-open-ref-not-boolean',
      message: `FRAME ${node.id} overlay.openRef ${openRef} must be a boolean document state`,
      nodeId: node.id
    })
    return undefined
  }
  ctx.docStateReads.add(openRef)
  const closeOnBackdrop = cfg.closeOnBackdrop !== false
  if (closeOnBackdrop) ctx.docStateWrites.add(openRef)
  return { kind, openRef, closeOnBackdrop }
}

interface LinkConfig {
  href?: unknown
  hrefExpr?: unknown
  target?: unknown
}

const LINK_TARGETS: ReadonlySet<IRLink['target']> = new Set(['_self', '_blank', '_parent', '_top'])

/** Phase 4 §25: an external link rides `interactiveProps` (either
 *  `interactiveProps.link` or direct `href`/`target`). Static hrefs and bound
 *  href expressions both stay separate from internal navigate actions. */
function resolveLink(node: SceneNode, ctx: WalkCtx): IRLink | undefined {
  const ip = node.interactiveProps as (LinkConfig & { link?: LinkConfig }) | undefined
  if (!ip) return undefined
  const cfg = ip.link && typeof ip.link === 'object' ? ip.link : ip
  const hrefExprSrc = typeof cfg.hrefExpr === 'string' ? cfg.hrefExpr.trim() : ''
  const hrefLiteral = typeof cfg.href === 'string' ? cfg.href.trim() : ''
  if (hrefExprSrc === '' && hrefLiteral === '') return undefined
  const rawTarget = typeof cfg.target === 'string' ? cfg.target : '_blank'
  const target = LINK_TARGETS.has(rawTarget as IRLink['target'])
    ? (rawTarget as IRLink['target'])
    : '_blank'
  if (hrefExprSrc !== '') {
    const resolved = resolveReactiveExpr(node, hrefExprSrc, 'link-href', ctx)
    if (resolved === null) return undefined
    return { hrefExpr: resolved.ast, target }
  }
  return { hrefLiteral, target }
}

interface IconConfig {
  name?: unknown
  icon?: unknown
  size?: unknown
  color?: unknown
  strokeWidth?: unknown
  ariaLabel?: unknown
  label?: unknown
}

/** Phase 4 §23: `interactiveProps.icon` turns a node into a named lucide-react
 *  icon. The authored name can be `camera`, `lucide:camera`, or `Camera`; the
 *  IR stores the validated React export name (`Camera`). Unknown names warn and
 *  fall back to normal node emission so generated projects never import a
 *  missing lucide symbol. */
function resolveLucideIcon(node: SceneNode, ctx: WalkCtx): IRElement['icon'] {
  const ip = node.interactiveProps as IconConfig | undefined
  if (!ip) return undefined
  const cfg = ip.icon && typeof ip.icon === 'object' ? (ip.icon as IconConfig) : ip
  const rawName = typeof ip.icon === 'string' ? ip.icon : cfg.name
  if (typeof rawName !== 'string' || rawName.trim() === '') return undefined
  const normalized = normalizeLucideIconName(rawName)
  if (!normalized || !LUCIDE_ICON_NAMES.has(normalized.kebab)) {
    ctx.warnings.push({
      code: 'lucide-icon-unknown',
      message: `node ${node.id} references unknown lucide icon ${rawName}`,
      nodeId: node.id
    })
    return undefined
  }
  return {
    name: normalized.component,
    ...finitePositiveNumberProp(cfg.size, 'size'),
    ...stringProp(cfg.color, 'color'),
    ...finitePositiveNumberProp(cfg.strokeWidth, 'strokeWidth'),
    ...stringProp(cfg.ariaLabel ?? cfg.label, 'ariaLabel')
  }
}

function normalizeLucideIconName(raw: string): { kebab: string; component: string } | undefined {
  const trimmed = raw.trim()
  const hasPrefix = trimmed.includes(':')
  if (hasPrefix && !trimmed.startsWith('lucide:')) return undefined
  const base = hasPrefix ? trimmed.slice('lucide:'.length) : trimmed
  const kebab = toKebabIconName(base)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(kebab)) return undefined
  return { kebab, component: kebabToPascal(kebab) }
}

function toKebabIconName(raw: string): string {
  return raw
    .trim()
    .replace(/_/g, '-')
    .replace(/\s+/g, '-')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}

function kebabToPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function finitePositiveNumberProp<K extends 'size' | 'strokeWidth'>(
  raw: unknown,
  key: K
): Partial<Record<K, number>> {
  if (raw === undefined) return {}
  let n = Number.NaN
  if (typeof raw === 'number') n = raw
  if (typeof raw === 'string') n = Number(raw.trim())
  return Number.isFinite(n) && n > 0 ? ({ [key]: n } as Partial<Record<K, number>>) : {}
}

function finiteNumberProp<K extends 'value'>(raw: unknown, key: K): Partial<Record<K, number>> {
  if (raw === undefined) return {}
  let n = Number.NaN
  if (typeof raw === 'number') n = raw
  if (typeof raw === 'string') n = Number(raw.trim())
  return Number.isFinite(n) ? ({ [key]: n } as Partial<Record<K, number>>) : {}
}

function stringProp<K extends string>(raw: unknown, key: K): Partial<Record<K, string>> {
  return typeof raw === 'string' && raw.trim() !== ''
    ? ({ [key]: raw.trim() } as Partial<Record<K, string>>)
    : {}
}

/** Join two class strings, skipping empties (no leading/trailing space). */
function joinClass(base: string, extra: string): string {
  if (extra === '') return base
  return base === '' ? extra : `${base} ${extra}`
}

/** Phase 3 §3.v5 — a RADIO / CHECKBOX-group wrapper that isn't already a
 *  flex/grid auto-layout gets a vertical option-stack class so the option
 *  `<label>`s don't run together inline. Extracted to keep nodeToIR under the
 *  complexity gate. */
function applyOptionGroupWrapper(className: string, node: SceneNode): string {
  if (node.type !== 'RADIO' && !isCheckboxGroup(node)) return className
  if (/(^|\s)(flex|inline-flex|grid|inline-grid)(\s|$)/.test(className)) return className
  return joinClass(className, OPTION_GROUP_WRAPPER_CLASSES)
}

/** Phase 4 §24.1: the raw `interactiveProps.image` config a node may carry to
 *  render as an `<img>` (rides the interactiveProps blob round-trip, zero codec). */
interface ImageConfig {
  src?: unknown
  srcExpr?: unknown
  alt?: unknown
  objectFit?: unknown
  loading?: unknown
  sources?: unknown
}

interface ImageSourceConfig {
  src?: unknown
  srcSet?: unknown
  srcExpr?: unknown
  srcSetExpr?: unknown
  media?: unknown
  type?: unknown
  sizes?: unknown
}

/** object-fit value → Tailwind utility. `Partial` so the index access is
 *  `string | undefined` (the `?? ''` stays necessary under type-aware lint). */
const OBJECT_FIT_CLASS: Partial<Record<string, string>> = {
  cover: 'object-cover',
  contain: 'object-contain',
  fill: 'object-fill',
  none: 'object-none',
  'scale-down': 'object-scale-down'
}

/** "16/9", "4/3", or a bare number like "1.5". */
const ASPECT_RATIO_RE = /^\d+(\.\d+)?(\/\d+(\.\d+)?)?$/

/** Phase 4 §24.3: append `aspect-[<ratio>]` when the node carries a valid
 *  `interactiveProps.aspectRatio`. Applies to any node; a malformed ratio warns
 *  and is dropped. The class rides `className` → auto-safelisted by
 *  `collectClassNames`. */
function appendAspectRatio(className: string, node: SceneNode, ctx: WalkCtx): string {
  const ip = node.interactiveProps as { aspectRatio?: unknown } | undefined
  const raw = typeof ip?.aspectRatio === 'string' ? ip.aspectRatio.trim() : ''
  if (raw === '') return className
  if (!ASPECT_RATIO_RE.test(raw)) {
    ctx.warnings.push({
      code: 'aspect-ratio-invalid',
      message: `${node.type} ${node.id} interactiveProps.aspectRatio "${raw}" is not a valid ratio (e.g. "16/9" or "1.5")`,
      nodeId: node.id
    })
    return className
  }
  return joinClass(className, `aspect-[${raw}]`)
}

function appendVisualFillClasses(className: string, node: SceneNode, ctx: WalkCtx): string {
  if (potentialBackgroundFillCount(node) <= 1) return appendImageFillClasses(className, node, ctx)
  const layers = backgroundFillLayers(node, ctx)
  if (layers.length === 0) return stripSingleBackgroundClasses(className)
  if (layers.length === 1) {
    return joinClass(stripSingleBackgroundClasses(className), backgroundLayerClasses(layers[0]))
  }
  return joinClass(stripSingleBackgroundClasses(className), multiBackgroundClasses(layers))
}

function appendImageFillClasses(className: string, node: SceneNode, ctx: WalkCtx): string {
  const fill = node.fills.find(
    (candidate) => candidate.visible && candidate.opacity > 0 && candidate.type === 'IMAGE'
  )
  if (!fill) return className
  const asset = registerImageFillAsset(fill, node, ctx)
  if (!asset) return className
  return joinClass(className, imageFillClasses(fill, asset.path))
}

interface BackgroundLayer {
  image: string
  size: string
  position: string
  repeat: string
}

function potentialBackgroundFillCount(node: SceneNode): number {
  if (node.type === 'TEXT') return 0
  return node.fills.filter((fill) => fill.visible && fill.opacity > 0 && isBackgroundFill(fill))
    .length
}

function isBackgroundFill(fill: Fill): boolean {
  return (
    fill.type === 'SOLID' ||
    fill.type === 'IMAGE' ||
    fill.type === 'GRADIENT_LINEAR' ||
    fill.type === 'GRADIENT_RADIAL' ||
    fill.type === 'GRADIENT_ANGULAR' ||
    fill.type === 'GRADIENT_DIAMOND'
  )
}

function warnUnsupportedVisualSemantics(node: SceneNode, ctx: WalkCtx): void {
  if (node.isMask) {
    ctx.warnings.push({
      code: 'visual-mask-unsupported',
      message: `${node.type} ${node.id} is a ${node.maskType} mask; lowcode compile renders it as a normal node because CSS mask semantics are not emitted yet`,
      nodeId: node.id
    })
  }

  if (
    node.blendMode !== 'PASS_THROUGH' &&
    node.blendMode !== 'NORMAL' &&
    !isCssBlendMode(node.blendMode)
  ) {
    ctx.warnings.push({
      code: 'visual-blend-mode-unsupported',
      message: `${node.type} ${node.id} uses blendMode ${node.blendMode}; lowcode compile does not emit mix-blend-mode yet`,
      nodeId: node.id
    })
  }

  for (const fill of node.fills) {
    if (!fill.visible || fill.opacity <= 0) continue
    warnUnsupportedFill(node, fill, ctx)
  }
}

function isCssBlendMode(mode: string): boolean {
  return (
    mode === 'DARKEN' ||
    mode === 'MULTIPLY' ||
    mode === 'COLOR_BURN' ||
    mode === 'LIGHTEN' ||
    mode === 'SCREEN' ||
    mode === 'COLOR_DODGE' ||
    mode === 'OVERLAY' ||
    mode === 'SOFT_LIGHT' ||
    mode === 'HARD_LIGHT' ||
    mode === 'DIFFERENCE' ||
    mode === 'EXCLUSION' ||
    mode === 'HUE' ||
    mode === 'SATURATION' ||
    mode === 'COLOR' ||
    mode === 'LUMINOSITY'
  )
}

function warnUnsupportedFill(node: SceneNode, fill: Fill, ctx: WalkCtx): void {
  if (fill.blendMode && fill.blendMode !== 'NORMAL' && fill.blendMode !== 'PASS_THROUGH') {
    ctx.warnings.push({
      code: 'visual-fill-blend-mode-unsupported',
      message: `${node.type} ${node.id} has a ${fill.type} fill with blendMode ${fill.blendMode}; lowcode compile emits the fill without per-fill blend semantics`,
      nodeId: node.id
    })
  }

  if (isBackgroundFill(fill)) return
  ctx.warnings.push({
    code: 'visual-fill-type-unsupported',
    message: `${node.type} ${node.id} has unsupported ${fill.type} fill; lowcode compile skips this visual layer`,
    nodeId: node.id
  })
}

function backgroundFillLayers(node: SceneNode, ctx: WalkCtx): BackgroundLayer[] {
  const layers: BackgroundLayer[] = []
  for (const fill of node.fills) {
    if (!fill.visible || fill.opacity <= 0 || !isBackgroundFill(fill)) continue
    const layer = backgroundFillLayer(fill, node, ctx)
    if (layer) layers.push(layer)
  }
  return layers.reverse()
}

function backgroundFillLayer(
  fill: Fill,
  node: SceneNode,
  ctx: WalkCtx
): BackgroundLayer | undefined {
  if (fill.type === 'SOLID') return solidFillLayer(fill)
  if (fill.type === 'IMAGE') return imageFillLayer(fill, node, ctx)
  const css = gradientFillCss(fill, node.width, node.height)
  if (css === null) return undefined
  return { image: css, size: 'auto', position: '0%_0%', repeat: 'no-repeat' }
}

function solidFillLayer(fill: Fill): BackgroundLayer {
  const color = colorToHex8(fill.color, fill.opacity)
  return {
    image: `linear-gradient(${color}, ${color})`,
    size: 'auto',
    position: '0%_0%',
    repeat: 'no-repeat'
  }
}

function imageFillLayer(fill: Fill, node: SceneNode, ctx: WalkCtx): BackgroundLayer | undefined {
  const asset = registerImageFillAsset(fill, node, ctx)
  if (!asset) return undefined
  const image = `url(${assetCssUrl(asset.path)})`
  if (fill.imageScaleMode === 'FIT') {
    return { image, size: 'contain', position: 'center', repeat: 'no-repeat' }
  }
  if (fill.imageScaleMode === 'TILE') {
    return { image, size: 'auto', position: 'center', repeat: 'repeat' }
  }
  if (fill.imageScaleMode === 'CROP' && fill.imageTransform) {
    return cropImageTransformLayer(image, fill.imageTransform)
  }
  return { image, size: 'cover', position: 'center', repeat: 'no-repeat' }
}

function cropImageTransformLayer(
  image: string,
  transform: NonNullable<Fill['imageTransform']>
): BackgroundLayer {
  if (!isCssRepresentableImageTransform(transform)) {
    return { image, size: 'cover', position: 'center', repeat: 'no-repeat' }
  }
  const width = cssPercent(transform.m00 * 100)
  const height = cssPercent(transform.m11 * 100)
  const left = cssPercent(transform.m02 * 100)
  const top = cssPercent(transform.m12 * 100)
  return {
    image,
    size: `${width}%_${height}%`,
    position: `left_${left}%_top_${top}%`,
    repeat: 'no-repeat'
  }
}

function backgroundLayerClasses(layer: BackgroundLayer): string {
  return multiBackgroundClasses([layer])
}

function multiBackgroundClasses(layers: BackgroundLayer[]): string {
  return [
    arbitraryPropertyClass('background-image', layers.map((layer) => layer.image).join(',')),
    arbitraryPropertyClass('background-size', layers.map((layer) => layer.size).join(',')),
    arbitraryPropertyClass('background-position', layers.map((layer) => layer.position).join(',')),
    arbitraryPropertyClass('background-repeat', layers.map((layer) => layer.repeat).join(','))
  ].join(' ')
}

function arbitraryPropertyClass(property: string, value: string): string {
  return `[${property}:${value.replace(/ /g, '_')}]`
}

function stripSingleBackgroundClasses(className: string): string {
  return className
    .split(/\s+/)
    .filter((c) => c !== '' && !isSingleBackgroundClass(c))
    .join(' ')
}

function isSingleBackgroundClass(className: string): boolean {
  return (
    className.startsWith('bg-') ||
    className.startsWith('[background-image:') ||
    className.startsWith('[background-size:') ||
    className.startsWith('[background-position:') ||
    className.startsWith('[background-repeat:')
  )
}

function registerImageFillAsset(fill: Fill, node: SceneNode, ctx: WalkCtx): IRAsset | undefined {
  if (!fill.imageHash) {
    ctx.warnings.push({
      code: 'image-fill-missing-hash',
      message: `${node.type} ${node.id} has an IMAGE fill without imageHash; background image skipped`,
      nodeId: node.id
    })
    return undefined
  }
  const bytes = ctx.graph.images.get(fill.imageHash)
  if (!bytes) {
    ctx.warnings.push({
      code: 'image-fill-missing-asset',
      message: `${node.type} ${node.id} references IMAGE fill ${fill.imageHash}, but the graph has no matching bytes; background image skipped`,
      nodeId: node.id
    })
    return undefined
  }
  const path = imageAssetPath(fill.imageHash, bytes)
  let asset = ctx.assets.get(path)
  if (!asset) {
    asset = { path, bytes }
    ctx.assets.set(path, asset)
  }
  return asset
}

function imageFillClasses(fill: Fill, assetPath: string): string {
  const cssUrl = assetCssUrl(assetPath)
  const classes = [`bg-[url(${cssUrl})]`, 'bg-center']
  if (fill.imageScaleMode === 'FIT') {
    classes.push('bg-contain', 'bg-no-repeat')
  } else if (fill.imageScaleMode === 'TILE') {
    classes.push('bg-auto', 'bg-repeat')
  } else if (fill.imageScaleMode === 'CROP' && fill.imageTransform) {
    classes.push(...cropImageTransformClasses(fill.imageTransform))
  } else {
    classes.push('bg-cover', 'bg-no-repeat')
  }
  return classes.join(' ')
}

function assetCssUrl(assetPath: string): string {
  return `./assets/${assetPath.split('/').at(-1) ?? assetPath}`
}

function cropImageTransformClasses(transform: NonNullable<Fill['imageTransform']>): string[] {
  if (!isCssRepresentableImageTransform(transform)) return ['bg-cover', 'bg-no-repeat']
  const width = cssPercent(transform.m00 * 100)
  const height = cssPercent(transform.m11 * 100)
  const left = cssPercent(transform.m02 * 100)
  const top = cssPercent(transform.m12 * 100)
  return [
    `[background-size:${width}%_${height}%]`,
    `[background-position:left_${left}%_top_${top}%]`,
    'bg-no-repeat'
  ]
}

function isCssRepresentableImageTransform(transform: NonNullable<Fill['imageTransform']>): boolean {
  return (
    transform.m00 > 0 &&
    transform.m11 > 0 &&
    transform.m01 === 0 &&
    transform.m10 === 0 &&
    imageTransformValues(transform).every(Number.isFinite)
  )
}

function imageTransformValues(transform: NonNullable<Fill['imageTransform']>): number[] {
  return [transform.m00, transform.m01, transform.m02, transform.m10, transform.m11, transform.m12]
}

function cssPercent(value: number): string {
  return Number(value.toFixed(3)).toString()
}

function imageAssetPath(hash: string, bytes: Uint8Array): string {
  const safeHash =
    hash.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || `bytes-${bytes.length.toString(36)}`
  return `src/assets/openpencil-image-${safeHash}.${imageExtension(bytes)}`
}

function imageExtension(bytes: Uint8Array): string {
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46])) return 'gif'
  if (
    startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWithBytes(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
  )
    return 'webp'
  const ascii = new TextDecoder().decode(bytes.slice(0, 128)).trimStart()
  if (ascii.startsWith('<svg') || ascii.startsWith('<?xml')) return 'svg'
  return 'bin'
}

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

/** Phase 4 §24.1: resolve a node's `interactiveProps.image` into an IRImage +
 *  its object-fit utility. `srcExpr` (an expression, e.g. a doc-state binding to
 *  a §18 upload result) wins over a literal `src` URL; a bad expression or a
 *  missing src warns and returns undefined (the node stays a normal element). */
function resolveImageNode(
  node: SceneNode,
  ctx: WalkCtx
): { descriptor: IRImage; objectFitClass: string } | undefined {
  const ip = node.interactiveProps as { image?: ImageConfig } | undefined
  const cfg = ip?.image
  if (!cfg || typeof cfg !== 'object') return undefined
  const srcExprSrc = typeof cfg.srcExpr === 'string' ? cfg.srcExpr.trim() : ''
  const srcLiteral = typeof cfg.src === 'string' ? cfg.src.trim() : ''
  const alt = typeof cfg.alt === 'string' ? cfg.alt : ''
  let descriptor: IRImage
  if (srcExprSrc !== '') {
    const resolved = resolveReactiveExpr(node, srcExprSrc, 'image-src', ctx)
    if (resolved === null) return undefined
    descriptor = { srcExpr: resolved.ast, alt }
  } else if (srcLiteral !== '') {
    descriptor = { srcLiteral, alt }
  } else {
    ctx.warnings.push({
      code: 'image-missing-src',
      message: `${node.type} ${node.id} interactiveProps.image has no src or srcExpr`,
      nodeId: node.id
    })
    return undefined
  }
  const objectFit = typeof cfg.objectFit === 'string' ? cfg.objectFit : ''
  const loading = imageLoading(cfg.loading)
  if (loading) descriptor.loading = loading
  const sources = imageSources(node, cfg.sources, ctx)
  if (sources.length > 0) descriptor.sources = sources
  return { descriptor, objectFitClass: OBJECT_FIT_CLASS[objectFit] ?? '' }
}

function imageLoading(value: unknown): IRImage['loading'] | undefined {
  return value === 'lazy' || value === 'eager' ? value : undefined
}

function imageSources(
  node: SceneNode,
  value: unknown,
  ctx: WalkCtx
): NonNullable<IRImage['sources']> {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const source = imageSource(node, entry as ImageSourceConfig, ctx)
    return source ? [source] : []
  })
}

function imageSource(
  node: SceneNode,
  cfg: ImageSourceConfig,
  ctx: WalkCtx
): NonNullable<IRImage['sources']>[number] | undefined {
  const srcExpr = firstString(cfg.srcSetExpr, cfg.srcExpr)
  const srcLiteral = firstString(cfg.srcSet, cfg.src)
  const media = firstString(cfg.media)
  const type = firstString(cfg.type)
  const sizes = firstString(cfg.sizes)
  if (srcExpr !== '') {
    const resolved = resolveReactiveExpr(node, srcExpr, 'image-source', ctx)
    if (resolved === null) return undefined
    return {
      srcExpr: resolved.ast,
      ...(media ? { media } : {}),
      ...(type ? { type } : {}),
      ...(sizes ? { sizes } : {})
    }
  }
  if (srcLiteral === '') return undefined
  return {
    srcLiteral,
    ...(media ? { media } : {}),
    ...(type ? { type } : {}),
    ...(sizes ? { sizes } : {})
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed !== '') return trimmed
  }
  return ''
}

/** Phase 4 §24.1: build the void `<img>` element for an image node — its src/alt
 *  ride `IRElement.image`, object-fit joins `className`. Events (e.g. onClick)
 *  still resolve so an image can be interactive. */
function buildImageElement(
  node: SceneNode,
  ctx: WalkCtx,
  className: string,
  image: { descriptor: IRImage; objectFitClass: string }
): IRElement {
  const events = resolveEvents(
    node,
    ctx.states,
    ctx.warnings,
    ctx.docStates,
    ctx.docStateWrites,
    ctx.inScope,
    ctx.docStateReads,
    ctx.workflows
  )
  return {
    kind: 'element',
    sourceId: node.id,
    tag: 'img',
    className: joinClass(className, image.objectFitClass),
    attrs: {},
    children: [],
    ...(events && Object.keys(events).length > 0 ? { events } : {}),
    image: image.descriptor
  }
}

/** §18/§3.x/§15: resolve an element's mutually-exclusive interactive control
 *  descriptors. A file-upload INPUT (§18) is uncontrolled and not a UI-kit
 *  control, so its presence suppresses the controlled-value wiring and the
 *  control-kind hint. Returns only the present keys (each helper has its own
 *  collect side effects). Extracted to keep `nodeToIR` under the complexity gate. */
function resolveControlDescriptors(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[]
): Pick<IRElement, 'controlled' | 'upload' | 'controlKind' | 'validation'> {
  const upload = applyUploadInput(node, ctx, attrs)
  if (upload) return { upload }
  const out: Pick<IRElement, 'controlled' | 'controlKind' | 'validation'> = {}
  const controlled = applyControlledInput(node, ctx, attrs, children)
  if (controlled) {
    out.controlled = controlled
    // §19: a controlled field may carry validation rules — its value is read
    // fresh from `controlled.write.name` at validate time.
    const validation = applyValidation(node, ctx, controlled)
    if (validation) out.validation = validation
  } else if (hasValidationConfig(node)) {
    // §19: validation needs a controlled value source (the field's doc-state);
    // an uncontrolled input (or a radio/checkbox group, whose value lives on
    // the leaves) has none → skip with a warning. v1 boundary.
    ctx.warnings.push({
      code: 'validation-not-controlled',
      message: `${node.type} ${node.id} has a validation config but is not a single controlled field (no bindings.value); validation skipped`,
      nodeId: node.id
    })
  }
  const controlKind = controlKindFor(node)
  if (controlKind) out.controlKind = controlKind
  return out
}

function applyControlledInput(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>,
  children: IRNode[]
): IRControlledInput | undefined {
  if (!CONTROLLED_NODE_TYPES.has(node.type)) return undefined
  const controlled = resolveValueBinding(
    node,
    ctx.states,
    ctx.warnings,
    ctx.docStates,
    ctx.docStateReads,
    ctx.docStateWrites
  )
  if (!controlled) return undefined
  // §28: preserve user-defined onChange. The React adapter composes the
  // synthesized controlled writer first, then runs the user action chain in
  // the same event handler.
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

/** Phase 4 §18: resolve an INPUT's file-upload config (`interactiveProps.upload`)
 *  into an IRUpload. Requires Supabase configured (`$currentUser` proxy, same as
 *  §16.3/§17), a non-empty bucket, and a valid `resultTarget` doc-state (the
 *  public URL lands there — registered as a write so the page imports
 *  setDocState). The optional `pathExpr` resolves through the shared reactive
 *  resolver. Returns undefined when the INPUT isn't an upload; null on a config
 *  error (caller leaves it a plain input). */
function applyUploadInput(
  node: SceneNode,
  ctx: WalkCtx,
  attrs: Record<string, IRAttrValue>
): IRUpload | undefined {
  if (node.type !== 'INPUT') return undefined
  const ip = node.interactiveProps as { upload?: UploadConfig } | undefined
  const upload = ip?.upload
  if (!upload || typeof upload !== 'object') return undefined
  if (!ctx.docStates.has(CURRENT_USER_IDENT)) {
    ctx.warnings.push({
      code: 'upload-no-supabase',
      message: `INPUT ${node.id} has an upload config but the document has no Supabase config; upload disabled`,
      nodeId: node.id
    })
    return undefined
  }
  const bucket = typeof upload.bucket === 'string' ? upload.bucket.trim() : ''
  if (bucket === '') {
    ctx.warnings.push({
      code: 'upload-missing-bucket',
      message: `INPUT ${node.id} upload config has no bucket`,
      nodeId: node.id
    })
    return undefined
  }
  const resultTarget = typeof upload.resultTarget === 'string' ? upload.resultTarget.trim() : ''
  if (resultTarget === '' || !ctx.docStates.has(resultTarget)) {
    ctx.warnings.push({
      code: 'upload-bad-result-target',
      message: `INPUT ${node.id} upload resultTarget "${resultTarget}" is not a known document state`,
      nodeId: node.id
    })
    return undefined
  }
  ctx.docStateWrites.add(resultTarget)
  // A file input is uncontrolled and types itself — drop any text-input
  // fallback attrs so it doesn't carry a stray placeholder / value / type.
  delete attrs.placeholder
  delete attrs.value
  delete attrs.defaultValue
  delete attrs.type
  let pathAst: ExprAst | undefined
  const pathSrc = typeof upload.pathExpr === 'string' ? upload.pathExpr.trim() : ''
  if (pathSrc !== '') {
    const resolved = resolveReactiveExpr(node, pathSrc, 'upload-path', ctx)
    if (resolved === null) return undefined
    pathAst = resolved.ast
  }
  return {
    bucket,
    resultTarget,
    pathAst,
    accept:
      typeof upload.accept === 'string' && upload.accept.trim() !== ''
        ? upload.accept.trim()
        : undefined
  }
}

/** Phase 4 §19: the raw validation config a controlled input may carry on its
 *  `interactiveProps.validation` (rides round-trip in the JSON blob, zero
 *  codec). Values are untyped — parsed/validated by `resolveValidationRules`. */
interface ValidationConfig {
  required?: unknown
  pattern?: unknown
  minLength?: unknown
  maxLength?: unknown
  min?: unknown
  max?: unknown
  customExpr?: unknown
  async?: unknown
  messages?: Record<string, unknown>
}

interface ValidationAsyncConfig {
  url?: unknown
  urlExpr?: unknown
  method?: unknown
  message?: unknown
}

interface ValidationSummaryConfig {
  enabled?: unknown
  title?: unknown
}

/** §19 follow-up: a FORM may opt into a top-level error summary via
 *  `interactiveProps.validationSummary`. `true` uses the default title; an
 *  object may set `{ enabled, title }`. */
function resolveFormValidationSummary(node: SceneNode): IRFormValidationSummary | undefined {
  const ip = node.interactiveProps as { validationSummary?: unknown } | undefined
  const raw = ip?.validationSummary
  if (raw === true) return { title: 'Please fix the highlighted fields.' }
  if (!raw || typeof raw !== 'object') return undefined
  const cfg = raw as ValidationSummaryConfig
  if (cfg.enabled === false) return undefined
  const title =
    typeof cfg.title === 'string' && cfg.title.trim() !== ''
      ? cfg.title
      : 'Please fix the highlighted fields.'
  return { title }
}

/** Phase 4 §19: true when a node declares any validation config — used to warn
 *  when it sits on an input with no controlled value source to validate. */
function hasValidationConfig(node: SceneNode): boolean {
  const ip = node.interactiveProps as { validation?: unknown } | undefined
  return ip?.validation != null && typeof ip.validation === 'object'
}

const NUMERIC_RULE_KEYS = ['minLength', 'maxLength', 'min', 'max'] as const
type NumericRuleKey = (typeof NUMERIC_RULE_KEYS)[number]
const MESSAGE_KEYS: (keyof IRValidationMessages)[] = [
  'required',
  'pattern',
  'minLength',
  'maxLength',
  'min',
  'max'
]

/** Phase 4 §19: resolve a controlled field's `interactiveProps.validation` into
 *  an IRFieldValidation. The field's value is read fresh from its controlled
 *  doc-/page-state at validate time; core rules JSON-serialize into the page
 *  validators map, the optional `customExpr` parses through the shared reactive
 *  resolver (a boolean expression over doc-state; true ≡ valid). §28 lets a
 *  user-defined onBlur coexist: emit validates first, then runs the user chain.
 *  Returns undefined when there's no usable rule. Pushes onto the page's
 *  `validatedFields` accumulator as a side effect. */
function applyValidation(
  node: SceneNode,
  ctx: WalkCtx,
  controlled: IRControlledInput
): IRFieldValidation | undefined {
  const ip = node.interactiveProps as { validation?: ValidationConfig } | undefined
  const cfg = ip?.validation
  if (!cfg || typeof cfg !== 'object') return undefined
  const rules = resolveValidationRules(node, cfg, ctx)
  const custom = resolveValidationCustom(node, cfg, ctx)
  const async = resolveValidationAsync(node, cfg, ctx)
  if (!hasAnyRule(rules) && !custom && !async) return undefined
  const validation: IRFieldValidation = {
    key: node.id,
    stateName: controlled.write.name,
    stateKind: controlled.write.kind,
    rules,
    ...(custom ? { custom } : {}),
    ...(async ? { async } : {})
  }
  ctx.validatedFields?.push(validation)
  return validation
}

/** §19: parse the data-driven core rules — `required`, a compiling `pattern`,
 *  finite numeric length/range bounds, and per-rule custom messages. Each
 *  malformed rule is warned + dropped (the rest survive). */
function resolveValidationRules(
  node: SceneNode,
  cfg: ValidationConfig,
  ctx: WalkCtx
): IRValidationRules {
  const rules: IRValidationRules = {}
  if (cfg.required === true) rules.required = true
  const pattern = typeof cfg.pattern === 'string' ? cfg.pattern : ''
  if (pattern !== '') {
    if (isValidRegex(pattern)) rules.pattern = pattern
    else
      ctx.warnings.push({
        code: 'validation-invalid-pattern',
        message: `${node.type} ${node.id} validation pattern "${pattern}" is not a valid regular expression; dropped`,
        nodeId: node.id
      })
  }
  for (const key of NUMERIC_RULE_KEYS) assignNumericRule(rules, key, cfg[key], node, ctx)
  const messages = resolveValidationMessages(cfg.messages)
  if (messages) rules.messages = messages
  return rules
}

/** §19: assign a finite-number rule, warning + dropping a non-finite value. */
function assignNumericRule(
  rules: IRValidationRules,
  key: NumericRuleKey,
  raw: unknown,
  node: SceneNode,
  ctx: WalkCtx
): void {
  if (raw == null) return
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    rules[key] = raw
    return
  }
  ctx.warnings.push({
    code: 'validation-invalid-number',
    message: `${node.type} ${node.id} validation ${key} must be a finite number; dropped`,
    nodeId: node.id
  })
}

/** §19: pick the per-rule custom messages (non-empty strings) for the core
 *  rules. The `custom` rule's message lives on IRValidationCustom, not here. */
function resolveValidationMessages(
  raw: Record<string, unknown> | undefined
): IRValidationMessages | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: IRValidationMessages = {}
  for (const key of MESSAGE_KEYS) {
    const value = raw[key]
    if (typeof value === 'string' && value.trim() !== '') out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** §19: resolve the optional custom rule — a boolean expression over doc-state
 *  (true ≡ valid) plus its message. Reuses the shared reactive resolver
 *  (rejects `$prev` / unknown idents; registers doc-state reads). */
function resolveValidationCustom(
  node: SceneNode,
  cfg: ValidationConfig,
  ctx: WalkCtx
): IRValidationCustom | undefined {
  const src = typeof cfg.customExpr === 'string' ? cfg.customExpr.trim() : ''
  if (src === '') return undefined
  const resolved = resolveReactiveExpr(node, src, 'validation-custom', ctx)
  if (resolved === null) return undefined
  const raw = cfg.messages?.custom
  const message = typeof raw === 'string' && raw.trim() !== '' ? raw : 'Invalid value'
  return { ast: resolved.ast, references: resolved.references, message }
}

/** §19 follow-up: resolve an optional async custom validation endpoint. This is
 *  the safe generated-app form of custom async functions: the endpoint owns the
 *  function body and returns `{ valid, message? }`. */
function resolveValidationAsync(
  node: SceneNode,
  cfg: ValidationConfig,
  ctx: WalkCtx
): IRValidationAsync | undefined {
  const raw = cfg.async
  if (!raw || typeof raw !== 'object') return undefined
  const asyncCfg = raw as ValidationAsyncConfig
  const url = typeof asyncCfg.url === 'string' ? asyncCfg.url.trim() : ''
  const urlExpr = typeof asyncCfg.urlExpr === 'string' ? asyncCfg.urlExpr.trim() : ''
  if (url !== '' && urlExpr !== '') {
    ctx.warnings.push({
      code: 'validation-async-url-conflict',
      message: `${node.type} ${node.id} validation async config must use either url or urlExpr, not both; async rule dropped`,
      nodeId: node.id
    })
    return undefined
  }
  let urlAst: ExprAst | undefined
  if (urlExpr !== '') {
    const resolved = resolveReactiveExpr(node, urlExpr, 'validation-async-url', ctx)
    if (resolved === null) return undefined
    urlAst = resolved.ast
  }
  if (url === '' && urlAst === undefined) {
    ctx.warnings.push({
      code: 'validation-async-missing-url',
      message: `${node.type} ${node.id} validation async config has no url or urlExpr; async rule dropped`,
      nodeId: node.id
    })
    return undefined
  }
  const method = validationAsyncMethod(asyncCfg.method, node, ctx)
  if (!method) return undefined
  const message =
    typeof asyncCfg.message === 'string' && asyncCfg.message.trim() !== ''
      ? asyncCfg.message
      : 'Invalid value'
  return {
    ...(url !== '' ? { urlLiteral: url } : {}),
    ...(urlAst ? { urlAst } : {}),
    method,
    message
  }
}

function validationAsyncMethod(
  raw: unknown,
  node: SceneNode,
  ctx: WalkCtx
): IRValidationAsync['method'] | undefined {
  if (raw === undefined) return 'POST'
  if (typeof raw === 'string') {
    const method = raw.trim().toUpperCase()
    if (method === 'GET' || method === 'POST') return method
  }
  ctx.warnings.push({
    code: 'validation-async-invalid-method',
    message: `${node.type} ${node.id} validation async method must be GET or POST; async rule dropped`,
    nodeId: node.id
  })
  return undefined
}

/** §19: true when a rule set has at least one checkable rule. */
function hasAnyRule(rules: IRValidationRules): boolean {
  return (
    rules.required === true ||
    rules.pattern !== undefined ||
    rules.minLength !== undefined ||
    rules.maxLength !== undefined ||
    rules.min !== undefined ||
    rules.max !== undefined
  )
}

/** §19: does `src` compile as a RegExp? (Pattern rules feed `new RegExp` at
 *  runtime, so reject an invalid one at collect time.) */
function isValidRegex(src: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new RegExp(src)
    return true
  } catch {
    return false
  }
}

/** §19: collect the validation keys of every validated field in an IR subtree,
 *  for a `<form>`'s submit-time validation. Descends element children,
 *  conditional consequents, and list templates. ComponentRefs remain leaves
 *  because referenced component bodies validate inside their own module. */
function collectValidationKeys(nodes: readonly IRNode[]): string[] {
  const keys: string[] = []
  for (const n of nodes) {
    if (n.kind === 'element') {
      if (n.validation) keys.push(n.validation.key)
      keys.push(...collectValidationKeys(n.children))
    } else if (n.kind === 'conditional') {
      keys.push(...collectValidationKeys([n.consequent]))
    } else if (n.kind === 'list') {
      keys.push(...collectValidationKeys([n.template]))
    }
  }
  return keys
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
    if (child.kind === 'list') {
      patchOptionLeafControlled([child.template], inputType, controlled)
      continue
    }
    if (child.kind !== 'element' || child.tag !== 'label') continue
    for (const inner of child.children) {
      if (inner.kind === 'element' && inner.tag === 'input' && inner.attrs.type === inputType) {
        delete inner.attrs.defaultChecked
        inner.controlled = controlled
      }
    }
  }
}

/** Phase 4 §17: an inline Supabase query config a LIST may carry as its
 *  datasource (`kind: 'supabaseQuery'`). Lives in the interactiveProps JSON blob
 *  (rides round-trip, zero codec). Filter `valueExpr` / order columns reuse the
 *  §2 expression sub-language, so filters can reference reactive doc-state. */
interface ListSupabaseQueryConfig {
  table?: string
  columns?: string
  filters?: { column: string; op: string; valueExpr: string }[]
  orderBy?: {
    column?: string
    ascending?: boolean
    /** Phase 4 §17.3: reactive column / direction expressions (dynamic sort). */
    columnExpr?: string
    ascendingExpr?: string
  }[]
  limit?: number
  /** Phase 4 §17.2: reactive offset expression for pagination (e.g.
   *  `$page * 20`). Requires `limit` (the page size); references a page-index
   *  doc-state driven by prev/next setState handlers. */
  offsetExpr?: string
}

/** Phase 4 §17.4: dynamic option source for SELECT/RADIO/CHECKBOX controls.
 *  It reads an existing array-typed page state (`kind: 'ref'`) or document
 *  state (`kind: 'docStateRef'`). `valueExpr` / `labelExpr` run in the option
 *  item scope; omitted expressions fall back to the item itself. */
interface OptionsSourceConfig {
  kind?: string
  stateId?: string
  docStateName?: string
  itemName?: string
  indexName?: string
  valueExpr?: string
  labelExpr?: string
}

/** Phase 4 §18: an INPUT's file-upload config, carried on its interactiveProps
 *  blob (rides round-trip, zero codec). `bucket` + `resultTarget` are required;
 *  `pathExpr` is an optional reactive folder-prefix expression. */
interface UploadConfig {
  bucket?: string
  resultTarget?: string
  pathExpr?: string
  accept?: string
}

/** A LIST datasource ref — a page-scoped array state (Phase 2 §9), a
 *  document-level array Document State (Phase 2 §3), or an inline Supabase query
 *  (Phase 4 §17, `kind: 'supabaseQuery'` + `query`). */
interface ListDataSourceRef {
  kind?: string
  stateId?: string
  docStateName?: string
  query?: ListSupabaseQueryConfig
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
  // Phase 4 §17: a Supabase query datasource emits its own fetch hook and the
  // `.map()` iterates the hook's rows; everything else resolves a named array.
  const arrayName =
    ip.dataSourceRef?.kind === 'supabaseQuery'
      ? resolveListSupabaseQuery(node, ip.dataSourceRef.query, ctx)
      : resolveListArrayName(node, ip.dataSourceRef, ctx)
  if (arrayName === null) return null

  const itemName = typeof ip.itemName === 'string' && ip.itemName !== '' ? ip.itemName : 'item'
  const indexName = typeof ip.indexName === 'string' && ip.indexName !== '' ? ip.indexName : 'index'

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
 * Phase 4 §17: resolve a LIST's inline Supabase query datasource into an
 * `IRListQuery` (pushed onto the page's `listQueries`) and return the rows
 * variable the emitted `.map()` iterates. Requires Supabase to be configured
 * (the `$currentUser` doc-state — same proxy the §16.3 auth guard uses) and a
 * non-empty table. Filters reuse the §2 resolver, so their `valueExpr` may
 * reference reactive doc-state (live filtering). Returns null (with a warning)
 * on any failure → the caller emits no list.
 */
function resolveListSupabaseQuery(
  node: SceneNode,
  query: ListSupabaseQueryConfig | undefined,
  ctx: WalkCtx
): string | null {
  if (!ctx.listQueries) {
    ctx.warnings.push({
      code: 'list-query-unsupported-here',
      message: `LIST ${node.id} Supabase query datasource is only supported on a page, not inside a reusable component`,
      nodeId: node.id
    })
    return null
  }
  if (!ctx.docStates.has(CURRENT_USER_IDENT)) {
    ctx.warnings.push({
      code: 'list-query-no-supabase',
      message: `LIST ${node.id} has a Supabase query datasource but the document has no Supabase config; nothing will render`,
      nodeId: node.id
    })
    return null
  }
  const table = typeof query?.table === 'string' ? query.table.trim() : ''
  if (table === '') {
    ctx.warnings.push({
      code: 'list-query-missing-table',
      message: `LIST ${node.id} Supabase query datasource has no table`,
      nodeId: node.id
    })
    return null
  }
  const filters = resolveSupabaseFilters(
    node,
    'list-datasource',
    query,
    'list-query',
    ctx.states,
    ctx.inScope,
    ctx.docStates,
    ctx.docStateReads,
    ctx.warnings
  )
  if (filters === null) return null
  const order = resolveListOrder(node, query?.orderBy, ctx)
  if (order === null) return null
  const limit =
    typeof query?.limit === 'number' && Number.isFinite(query.limit) && query.limit > 0
      ? Math.floor(query.limit)
      : undefined
  // §17.2/§17.3: offset + filter + dynamic-sort value-exprs all contribute their
  // reactive refs to the effect deps. Offset pagination requires a page size.
  const references: string[] = [...filters.flatMap((f) => f.references), ...order.references]
  const offsetAst = resolveListOffset(node, query?.offsetExpr, limit, ctx, references)
  if (offsetAst === null) return null
  const rowsName = uniqueListRowsName(node, ctx.listQueries)
  ctx.listQueries.push({
    rowsName,
    setterName: `set${rowsName[0].toUpperCase()}${rowsName.slice(1)}`,
    table,
    columns:
      typeof query?.columns === 'string' && query.columns.trim() !== ''
        ? query.columns.trim()
        : '*',
    filters,
    orderBy: order.orders,
    limit,
    offsetAst,
    deps: listQueryDeps(references)
  })
  return rowsName
}

/** Phase 4 §17.2: resolve the optional pagination offset. Returns `undefined`
 *  (no offset — incl. an offset with no page-size limit, which warns) so the
 *  query still fetches, an `ExprAst` when valid (refs pushed to `references`),
 *  or `null` on a malformed expression (drops the whole list, like filters).
 *  Extracted to keep `resolveListSupabaseQuery` under the complexity gate. */
function resolveListOffset(
  node: SceneNode,
  rawOffsetExpr: string | undefined,
  limit: number | undefined,
  ctx: WalkCtx,
  references: string[]
): ExprAst | null | undefined {
  const src = typeof rawOffsetExpr === 'string' ? rawOffsetExpr.trim() : ''
  if (src === '') return undefined
  if (limit === undefined) {
    ctx.warnings.push({
      code: 'list-query-offset-needs-limit',
      message: `LIST ${node.id} Supabase query has an offset but no limit (page size); pagination ignored`,
      nodeId: node.id
    })
    return undefined
  }
  const resolved = resolveReactiveExpr(node, src, 'list-query-offset', ctx)
  if (resolved === null) return null
  references.push(...resolved.references)
  return resolved.ast
}

/** Phase 4 §17/§18: resolve one reactive expression (list offset / dynamic
 *  sort / upload path) through the same read-context checks as a filter — reject
 *  `$prev`, reject unknown identifiers, register doc-state reads. Returns the
 *  parsed AST + its references, or null (with a warning) on failure. */
function resolveReactiveExpr(
  node: SceneNode,
  src: string,
  code: string,
  ctx: WalkCtx
): { ast: ExprAst; references: string[] } | null {
  const parsed = parseExpression(src)
  if (!parsed.ok) {
    ctx.warnings.push({
      code: `${code}-invalid`,
      message: `LIST ${node.id} ${code} "${src}" → ${parsed.error}`,
      nodeId: node.id
    })
    return null
  }
  if (parsed.references.has(PREV_IDENT)) {
    ctx.warnings.push({
      code: `${code}-prev`,
      message: `LIST ${node.id} ${code} references ${PREV_IDENT}, which is only valid inside setState/setVariable`,
      nodeId: node.id
    })
    return null
  }
  const unknown = unknownIdentifiers(parsed.references, ctx.states, ctx.inScope, ctx.docStates)
  if (unknown.length > 0) {
    ctx.warnings.push({
      code: `${code}-unknown`,
      message: `LIST ${node.id} ${code} references unknown identifier(s): ${unknown.join(', ')}`,
      nodeId: node.id
    })
    return null
  }
  registerDocStateReads(parsed.references, ctx.docStates, ctx.docStateReads)
  return { ast: parsed.ast, references: [...parsed.references] }
}

/** Phase 4 §17: resolve the ORDER BY clauses. A clause is static (`column` +
 *  `ascending`, §17.1) or reactive (`columnExpr` / `ascendingExpr` expressions,
 *  §17.3 dynamic sort — binding a control to the referenced doc-state re-sorts
 *  the list). Direction defaults ascending; only an explicit `false` flips it.
 *  A clause with neither static nor reactive column is skipped; a malformed
 *  reactive expression drops the whole list (consistent with the filter posture).
 *  Returns the clauses + every reactive ref they contribute to the effect deps. */
function resolveListOrder(
  node: SceneNode,
  raw: ListSupabaseQueryConfig['orderBy'],
  ctx: WalkCtx
): { orders: IRListOrder[]; references: string[] } | null {
  const orders: IRListOrder[] = []
  const references: string[] = []
  for (const o of raw ?? []) {
    const columnExpr = typeof o.columnExpr === 'string' ? o.columnExpr.trim() : ''
    const column = typeof o.column === 'string' ? o.column.trim() : ''
    let columnAst: ExprAst | undefined
    if (columnExpr !== '') {
      const resolved = resolveReactiveExpr(node, columnExpr, 'list-query-order', ctx)
      if (resolved === null) return null
      columnAst = resolved.ast
      references.push(...resolved.references)
    } else if (column === '') {
      continue
    }
    const ascendingExpr = typeof o.ascendingExpr === 'string' ? o.ascendingExpr.trim() : ''
    let ascendingAst: ExprAst | undefined
    if (ascendingExpr !== '') {
      const resolved = resolveReactiveExpr(node, ascendingExpr, 'list-query-order', ctx)
      if (resolved === null) return null
      ascendingAst = resolved.ast
      references.push(...resolved.references)
    }
    orders.push({ column, columnAst, ascending: o.ascending !== false, ascendingAst })
  }
  return { orders, references }
}

/** Phase 4 §17: the reactive identifiers a list query references (across its
 *  filters + offset), mapped to `useEffect` dep expressions. A `$`-prefixed
 *  built-in (`$params` / `$query`) is an object whose identity changes each
 *  render, so it enters stringified — otherwise the effect re-runs forever. */
function listQueryDeps(references: Iterable<string>): string[] {
  const seen = new Set<string>()
  const deps: string[] = []
  for (const ref of references) {
    if (seen.has(ref)) continue
    seen.add(ref)
    deps.push(ref.startsWith('$') ? `JSON.stringify(${ref})` : ref)
  }
  return deps
}

/** Phase 4 §17: a unique camelCase rows variable for a list query, derived from
 *  the LIST node name (`Products` → `productsRows`), de-duplicated against the
 *  page's other list queries. */
function uniqueListRowsName(node: SceneNode, existing: readonly IRListQuery[]): string {
  const words = (node.name || 'list')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const camel = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  const ident = /^[a-zA-Z]/.test(camel) ? camel : `list${camel}`
  const base = `${ident || 'list'}Rows`
  const used = new Set(existing.map((q) => q.rowsName))
  if (!used.has(base)) return base
  let i = 2
  while (used.has(`${base}${i}`)) i++
  return `${base}${i}`
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

/** INPUT / TEXTAREA — a text-entry field carrying placeholder + value. Phase 3
 *  §9 v3: the placeholder is a user-facing label → externalized to i18n when
 *  enabled (the `value`/defaultValue is user data, kept literal). */
function applyTextInputProps(
  ip: InteractiveProps,
  attrs: Record<string, IRAttrValue>,
  ctx: WalkCtx
): void {
  if (typeof ip.placeholder === 'string') attrs.placeholder = displayAttr(ip.placeholder, ctx)
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

function optionSource(ip: InteractiveProps): OptionsSourceConfig | null {
  return typeof ip.optionsSource === 'object' && ip.optionsSource !== null
    ? (ip.optionsSource as OptionsSourceConfig)
    : null
}

function resolveOptionsArrayName(
  node: SceneNode,
  src: OptionsSourceConfig,
  ctx: WalkCtx
): string | null {
  if ((src.kind === 'ref' || src.kind === 'stateRef') && typeof src.stateId === 'string') {
    const state = ctx.states.get(src.stateId)
    if (!state) {
      ctx.warnings.push({
        code: 'options-source-unknown-state',
        message: `${node.type} ${node.id} optionsSource points to unknown state ${src.stateId}`,
        nodeId: node.id
      })
      return null
    }
    if (state.type !== 'array') {
      ctx.warnings.push({
        code: 'options-source-bad-state-type',
        message: `${node.type} ${node.id} optionsSource state ${state.name} is type ${state.type}, expected array`,
        nodeId: node.id
      })
      return null
    }
    return state.name
  }
  if (src.kind === 'docStateRef' && typeof src.docStateName === 'string') {
    const decl = ctx.docStates.get(src.docStateName)
    if (!decl) {
      ctx.warnings.push({
        code: 'options-source-unknown-docstate',
        message: `${node.type} ${node.id} optionsSource points to unknown document state ${src.docStateName}`,
        nodeId: node.id
      })
      return null
    }
    if (decl.type !== 'array') {
      ctx.warnings.push({
        code: 'options-source-bad-docstate-type',
        message: `${node.type} ${node.id} optionsSource document state ${decl.name} is type ${decl.type}, expected array`,
        nodeId: node.id
      })
      return null
    }
    ctx.docStateReads.add(decl.name)
    return decl.name
  }
  ctx.warnings.push({
    code: 'options-source-invalid',
    message: `${node.type} ${node.id} optionsSource must be kind "ref", "stateRef", or "docStateRef"`,
    nodeId: node.id
  })
  return null
}

function withOptionScope<T>(ctx: WalkCtx, itemName: string, indexName: string, run: () => T): T {
  const hadItem = ctx.inScope.has(itemName)
  const hadIndex = ctx.inScope.has(indexName)
  ctx.inScope.add(itemName)
  ctx.inScope.add(indexName)
  const result = run()
  if (!hadItem) ctx.inScope.delete(itemName)
  if (!hadIndex) ctx.inScope.delete(indexName)
  return result
}

function resolveOptionExpr(
  node: SceneNode,
  src: string,
  code: string,
  ctx: WalkCtx
): { kind: 'expression'; ast: ExprAst; references: string[] } | null {
  const resolved = resolveReactiveExpr(node, src, code, ctx)
  if (resolved === null) return null
  return { kind: 'expression', ast: resolved.ast, references: resolved.references }
}

function optionSourceExpressions(
  node: SceneNode,
  src: OptionsSourceConfig,
  itemName: string,
  ctx: WalkCtx
): { value: IRAttrValue; label: IRNode } | null {
  const valueSrc =
    typeof src.valueExpr === 'string' && src.valueExpr.trim() !== ''
      ? src.valueExpr.trim()
      : itemName
  const labelSrc =
    typeof src.labelExpr === 'string' && src.labelExpr.trim() !== ''
      ? src.labelExpr.trim()
      : valueSrc
  const valueResolved = resolveReactiveExpr(node, valueSrc, 'options-source-value', ctx)
  if (valueResolved === null) return null
  const label = resolveOptionExpr(node, labelSrc, 'options-source-label', ctx)
  if (label === null) return null
  return { value: { kind: 'exprAttr', ast: valueResolved.ast }, label }
}

function dynamicOptionsList(
  node: SceneNode,
  src: OptionsSourceConfig,
  ctx: WalkCtx,
  makeTemplate: (value: IRAttrValue, label: IRNode) => IRNode
): IRList | null {
  const arrayName = resolveOptionsArrayName(node, src, ctx)
  if (arrayName === null) return null
  const itemName = typeof src.itemName === 'string' && src.itemName !== '' ? src.itemName : 'item'
  const indexName =
    typeof src.indexName === 'string' && src.indexName !== '' ? src.indexName : 'index'
  return withOptionScope(ctx, itemName, indexName, () => {
    const expressions = optionSourceExpressions(node, src, itemName, ctx)
    if (expressions === null) return null
    return {
      kind: 'list',
      arrayName,
      itemName,
      indexName,
      template: makeTemplate(expressions.value, expressions.label)
    }
  })
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
  const src = optionSource(ip)
  if (src) {
    const list = dynamicOptionsList(node, src, ctx, (value, label) => ({
      kind: 'element',
      sourceId: node.id,
      tag: 'option',
      className: '',
      attrs: { value },
      children: [label]
    }))
    if (list) children.push(list)
    return
  }
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
const OPTION_INPUT_CLASSES = 'shrink-0 accent-primary'

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

function appendDynamicOptionInputs(
  node: SceneNode,
  ip: InteractiveProps,
  children: IRNode[],
  makeInputAttrs: (value: IRAttrValue) => Record<string, IRAttrValue>,
  ctx: WalkCtx
): boolean {
  const src = optionSource(ip)
  if (!src) return false
  const list = dynamicOptionsList(node, src, ctx, (value, label) => ({
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
        attrs: makeInputAttrs(value),
        children: []
      },
      label
    ]
  }))
  if (list) children.push(list)
  return true
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
  if (
    appendDynamicOptionInputs(node, ip, children, (value) => ({ type: 'checkbox', value }), ctx)
  ) {
    return
  }
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
  if (
    appendDynamicOptionInputs(
      node,
      ip,
      children,
      (value) => {
        const inputAttrs: Record<string, IRAttrValue> = { type: 'radio', value }
        if (groupName !== '') inputAttrs.name = groupName
        return inputAttrs
      },
      ctx
    )
  ) {
    return
  }
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
      applyTextInputProps(ip, attrs, ctx)
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
