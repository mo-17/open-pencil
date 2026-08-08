/**
 * Phase 1 §7.4 — IR transforms that need adapter context (router mode).
 *
 * The IR layer is framework-neutral; only the React adapter knows whether
 * the current page lives inside a `BrowserRouter` shell. Navigate handlers
 * collected for a single-page compile can't reach `useNavigate`, so we
 * strip them here and surface a warning per dropped handler rather than
 * leaking an undefined-identifier call into the emitted code.
 *
 * Also exposes `pageHasNavigateHandler` so `scaffold.ts` can decide whether
 * to import `useNavigate` and declare the hook.
 */
import type { IREventHandler, IRModule, IRNode, IRTree } from '#compiler/ir/types'
import type { CompileWarning } from '#compiler/types'

/**
 * Does any handler anywhere in `node`'s subtree match `pred`? Descends through
 * IRConditional consequents and IRList templates (Phase 2 §9) so handlers
 * nested inside wrapper kinds are found — missing that descent silently skips
 * the matching import / hook and the emitted JSX references an undefined
 * identifier at runtime. Shared by the navigate + supabase import gates.
 */
function treeHasHandler(node: IRNode, pred: (h: IREventHandler) => boolean): boolean {
  if (node.kind === 'conditional') return treeHasHandler(node.consequent, pred)
  if (node.kind === 'list') return treeHasHandler(node.template, pred)
  if (node.kind !== 'element' && node.kind !== 'componentRef') return false
  if (node.events) {
    for (const handlers of Object.values(node.events)) {
      if (handlers.some(pred)) return true
    }
  }
  return node.kind === 'element' && node.children.some((c) => treeHasHandler(c, pred))
}

/** Whether any node in an arbitrary page/component body contains navigate. */
export function nodesHaveNavigateHandler(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => treeHasHandler(node, (h) => handlerTreeHasKind(h, 'navigate')))
}

export function pageHasNavigateHandler(ir: IRTree): boolean {
  return nodesHaveNavigateHandler(ir.children)
}

/** Page-state ids consumed by continuous Motion drivers reachable from this page. */
export function pageMotionDriverStateIds(ir: IRTree): ReadonlySet<string> {
  const ids = new Set<string>()
  collectDriverStateIds(ir.motionDrivers, ids)
  for (const node of ir.children) collectNodeDriverStateIds(node, ids)
  return ids
}

/** Whether a reachable driver consumes the generated document-state store. */
export function pageHasDocumentStateMotionDriver(ir: IRTree): boolean {
  if (driverSpecHasDocumentState(ir.motionDrivers)) return true
  return ir.children.some(nodeHasDocumentStateDriver)
}

function nodeHasDocumentStateDriver(node: IRNode): boolean {
  if (node.kind === 'conditional') return nodeHasDocumentStateDriver(node.consequent)
  if (node.kind === 'list') return nodeHasDocumentStateDriver(node.template)
  if (node.kind !== 'element' && node.kind !== 'componentRef') return false
  if (driverSpecHasDocumentState(node.motionDrivers)) return true
  return node.kind === 'element' && node.children.some(nodeHasDocumentStateDriver)
}

function driverSpecHasDocumentState(spec: IRTree['motionDrivers']): boolean {
  return spec?.drivers.some((driver) => driver.source.kind === 'documentState') ?? false
}

function collectNodeDriverStateIds(node: IRNode, ids: Set<string>): void {
  if (node.kind === 'conditional') {
    collectNodeDriverStateIds(node.consequent, ids)
    return
  }
  if (node.kind === 'list') {
    collectNodeDriverStateIds(node.template, ids)
    return
  }
  if (node.kind !== 'element' && node.kind !== 'componentRef') return
  collectDriverStateIds(node.motionDrivers, ids)
  if (node.kind === 'element') {
    for (const child of node.children) collectNodeDriverStateIds(child, ids)
  }
}

function collectDriverStateIds(spec: IRTree['motionDrivers'], ids: Set<string>): void {
  for (const driver of spec?.drivers ?? []) {
    if (driver.source.kind === 'pageState') ids.add(driver.source.stateId)
  }
}

/** Phase 4 §18: does any element in the tree carry a file-upload config? Drives
 *  the `getSupabaseClient` import (the upload onChange calls storage). */
function treeHasUpload(node: IRNode): boolean {
  if (node.kind === 'conditional') return treeHasUpload(node.consequent)
  if (node.kind === 'list') return treeHasUpload(node.template)
  if (node.kind !== 'element') return false
  if (node.upload) return true
  return node.children.some(treeHasUpload)
}

/**
 * Phase 4 §16.2 — does any navigate handler in the page (including one nested
 * inside a `condition` / `confirm` branch) carry route params? Drives the
 * `generatePath` import — emitted alongside `useNavigate` only when a dynamic
 * `navigate(generatePath(...))` is actually produced.
 */
export function pageHasNavigateParams(ir: IRTree): boolean {
  return nodesHaveNavigateParams(ir.children)
}

/** Whether navigate in an arbitrary page/component body supplies route params. */
export function nodesHaveNavigateParams(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) =>
    treeHasHandler(node, (h) =>
      handlerTreeMatches(h, (x) => x.kind === 'navigate' && (x.params?.length ?? 0) > 0)
    )
  )
}

/**
 * Phase 3 §8 — the distinct component names referenced (as IRComponentRef)
 * anywhere in `nodes`. Descends conditional/list wrappers and element children
 * so a ref nested in a conditional still gets imported. The scaffold uses this
 * to emit `import Name from '.../components/Name'` per page/component file.
 */
export function referencedComponentNames(nodes: readonly IRNode[]): string[] {
  const acc = new Set<string>()
  for (const node of nodes) collectRefNames(node, acc)
  return [...acc]
}

function collectRefNames(node: IRNode, acc: Set<string>): void {
  if (node.kind === 'componentRef') {
    acc.add(node.name)
    return
  }
  if (node.kind === 'conditional') {
    collectRefNames(node.consequent, acc)
    return
  }
  if (node.kind === 'list') {
    collectRefNames(node.template, acc)
    return
  }
  if (node.kind !== 'element') return
  for (const child of node.children) collectRefNames(child, acc)
}

/** Phase 4 §23 — the distinct lucide-react component names referenced anywhere
 *  in a subtree. Drives both page/component imports and package.json deps. */
export function referencedLucideIconNames(nodes: readonly IRNode[]): string[] {
  const acc = new Set<string>()
  for (const node of nodes) collectLucideIconNames(node, acc)
  return [...acc].sort()
}

/** Distinct trusted modules referenced in a page or reusable-component body. */
export function referencedModules(nodes: readonly IRNode[]): IRModule[] {
  const modules = new Map<string, IRModule>()
  for (const node of nodes) collectReferencedModules(node, modules)
  return [...modules.values()].sort((a, b) =>
    `${a.pluginId}/${a.moduleType}`.localeCompare(`${b.pluginId}/${b.moduleType}`)
  )
}

function collectReferencedModules(node: IRNode, modules: Map<string, IRModule>): void {
  if (node.kind === 'conditional') {
    collectReferencedModules(node.consequent, modules)
    return
  }
  if (node.kind === 'list') {
    collectReferencedModules(node.template, modules)
    return
  }
  if (node.kind !== 'element') return
  if (node.module) modules.set(`${node.module.pluginId}/${node.module.moduleType}`, node.module)
  for (const child of node.children) collectReferencedModules(child, modules)
}

function collectLucideIconNames(node: IRNode, acc: Set<string>): void {
  if (node.kind === 'conditional') {
    collectLucideIconNames(node.consequent, acc)
    return
  }
  if (node.kind === 'list') {
    collectLucideIconNames(node.template, acc)
    return
  }
  if (node.kind !== 'element') return
  if (node.icon && !node.module) acc.add(node.icon.name)
  for (const child of node.children) collectLucideIconNames(child, acc)
}

/**
 * Phase 3 §9 — does any node in `nodes` carry an i18n-tagged text (a
 * `<FormattedMessage>`)? The scaffold uses this to decide whether a page /
 * component file imports `FormattedMessage` from react-intl. ComponentRefs are
 * leaves here — a referenced component's translatable text lives in that
 * component's own file, which imports FormattedMessage independently.
 */
export function hasTranslatableText(nodes: readonly IRNode[]): boolean {
  return nodes.some(nodeHasTranslatableText)
}

function nodeHasTranslatableText(node: IRNode): boolean {
  if (node.kind === 'text') return node.messageId !== undefined
  if (node.kind === 'conditional') return nodeHasTranslatableText(node.consequent)
  if (node.kind === 'list') return nodeHasTranslatableText(node.template)
  if (node.kind === 'element') return node.children.some(nodeHasTranslatableText)
  return false
}

/**
 * Phase 3 §9 v3 — does any element in `nodes` carry an i18n-externalized
 * attribute (an `intlMessage` attr value, e.g. a translated placeholder)? Drives
 * the `useIntl` import + the `const intl = useIntl()` hook in the enclosing
 * page / component function. ComponentRefs are leaves — a referenced component's
 * own file imports useIntl independently.
 */
export function hasIntlAttr(nodes: readonly IRNode[]): boolean {
  return nodes.some(nodeHasIntlAttr)
}

function nodeHasIntlAttr(node: IRNode): boolean {
  if (node.kind === 'conditional') return nodeHasIntlAttr(node.consequent)
  if (node.kind === 'list') return nodeHasIntlAttr(node.template)
  if (node.kind !== 'element') return false
  for (const value of Object.values(node.attrs)) {
    if (typeof value === 'object' && value.kind === 'intlMessage') return true
  }
  return node.children.some(nodeHasIntlAttr)
}

/**
 * Phase 3 §2: a page uses supabase when any handler in its tree is a
 * `supabaseQuery`, `supabaseMutation`, or `supabaseAuth`. The scaffolder
 * consults this to decide whether to emit
 * `import { getSupabaseClient } from '<path>'` — step 3's runtime template
 * exports the symbol, but step 3 forgot the page-side import wiring, so
 * emitted pages threw ReferenceError at runtime even though every
 * emit-level test passed (they checked the call site string, not module
 * resolution).
 *
 * Phase 3 §2.v3: `supabaseAuth` was missing from this check — §2.v2 added
 * the auth handler (which also calls `getSupabaseClient().auth.*` inline)
 * but never widened the import gate, so an auth-only page (no query /
 * mutation) threw `ReferenceError: getSupabaseClient is not defined` at
 * runtime. Tauri surfaced this on the first signUp-only page (the §2.v2
 * test pages happened to also carry a query, masking the hole). The
 * emit-level auth tests asserted the call string, repeating the exact trap
 * this comment warns about.
 */
export function pageUsesSupabase(ir: IRTree): boolean {
  // §17: a LIST bound to a Supabase query datasource calls getSupabaseClient()
  // in its fetch hook, so it needs the import + runtime just like an action does.
  if ((ir.listQueries?.length ?? 0) > 0) return true
  // §18: a file-upload INPUT calls getSupabaseClient().storage in its onChange.
  if (ir.children.some(treeHasUpload)) return true
  return ir.children.some((c) =>
    treeHasHandler(
      c,
      (h) =>
        h.kind === 'supabaseQuery' ||
        h.kind === 'supabaseMutation' ||
        h.kind === 'supabaseAuth' ||
        ((h.kind === 'stripeCheckout' || h.kind === 'stripeCustomerPortal') &&
          h.includeAuthToken === true)
    )
  )
}

/**
 * Phase 3 §10 v2: a page fires a toast when any handler in its tree is a
 * `toast` — including one nested inside a `condition` / `confirm` branch (the
 * predicate descends consequent/alternate, so a toast buried in an if/else
 * still gates the `__opToast` import; missing that descent is the §10
 * "compiles but the import is silently absent" trap). Drives the page's
 * `__opToast` import + the `_lowcode_toast` runtime emission.
 */
export function pageUsesToast(ir: IRTree): boolean {
  return ir.children.some((c) => treeHasHandler(c, (h) => handlerTreeHasKind(h, 'toast')))
}

/**
 * Phase 3 §10 v3: a page shows a confirm modal when any handler in its tree is
 * a `confirm` (descending `condition` / `confirm` branches identically). Drives
 * the page's `__opConfirm` import + the `_lowcode_confirm` runtime emission.
 */
export function pageUsesConfirm(ir: IRTree): boolean {
  return ir.children.some((c) => treeHasHandler(c, (h) => handlerTreeHasKind(h, 'confirm')))
}

/** Phase 5 §10: a page uses analytics when any event chain contains
 *  `trackEvent`, including nested condition/confirm branches. */
export function pageUsesAnalytics(ir: IRTree): boolean {
  return ir.children.some((c) => treeHasHandler(c, (h) => handlerTreeHasKind(h, 'trackEvent')))
}

export function nodesUseServerWorkflow(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) =>
    treeHasHandler(node, (handler) => handlerTreeHasKind(handler, 'invokeServerWorkflow'))
  )
}

export function pageUsesServerWorkflow(ir: IRTree): boolean {
  return nodesUseServerWorkflow(ir.children)
}

/** The nested handler chains of a branch-carrying handler, or null for leaf
 *  handlers. Result branches must participate too: a navigate/toast/etc. that
 *  runs after an API/Supabase action still needs its module-level dependency. */
function handlerBranches(h: IREventHandler): IREventHandler[] | null {
  if (h.kind === 'condition' || h.kind === 'confirm') {
    return [...h.consequent, ...(h.alternate ?? [])]
  }
  if (
    h.kind === 'apiCall' ||
    h.kind === 'supabaseQuery' ||
    h.kind === 'supabaseMutation' ||
    h.kind === 'invokeServerWorkflow'
  ) {
    return [...(h.onSuccess ?? []), ...(h.onError ?? [])]
  }
  return null
}

/** True when `h` matches `pred`, or contains a matching handler in a nested
 *  `condition` / `confirm` branch. The branch descent is what closes the §10
 *  "compiles but the import is silently absent" gap for actions buried inside an
 *  if/else. */
function handlerTreeMatches(h: IREventHandler, pred: (h: IREventHandler) => boolean): boolean {
  if (pred(h)) return true
  const branches = handlerBranches(h)
  return branches ? branches.some((b) => handlerTreeMatches(b, pred)) : false
}

function handlerTreeHasKind(h: IREventHandler, kind: IREventHandler['kind']): boolean {
  return handlerTreeMatches(h, (x) => x.kind === kind)
}

/**
 * Return a copy of `ir` with every `navigate` handler removed and a
 * `action-navigate-no-router` warning pushed per drop. The input tree is
 * not mutated. When the page has no navigate handlers the original tree
 * is returned by reference (zero-cost no-op).
 */
export function stripNavigateForSinglePage(ir: IRTree): {
  ir: IRTree
  warnings: CompileWarning[]
} {
  const { nodes, warnings } = stripNavigateFromNodesForSinglePage(ir.children)
  return nodes === ir.children ? { ir, warnings } : { ir: { ...ir, children: nodes }, warnings }
}

/** Strip navigate from an arbitrary page/component body for routerless output. */
export function stripNavigateFromNodesForSinglePage(nodes: IRNode[]): {
  nodes: IRNode[]
  warnings: CompileWarning[]
} {
  if (!nodesHaveNavigateHandler(nodes)) return { nodes, warnings: [] }
  const warnings: CompileWarning[] = []
  return { nodes: nodes.map((node) => stripNode(node, warnings)), warnings }
}

function stripNode(node: IRNode, warnings: CompileWarning[]): IRNode {
  // Phase 2 §9: descend through the new wrapper kinds so navigate handlers
  // inside conditional / list subtrees get the same single-page treatment
  // (drop + warn) as anywhere else.
  if (node.kind === 'conditional') {
    const consequent = stripNode(node.consequent, warnings)
    return consequent === node.consequent ? node : { ...node, consequent }
  }
  if (node.kind === 'list') {
    const template = stripNode(node.template, warnings)
    return template === node.template ? node : { ...node, template }
  }
  if (node.kind !== 'element' && node.kind !== 'componentRef') return node
  const events = stripEvents(node, warnings)
  if (node.kind === 'componentRef') {
    return events === node.events ? node : { ...node, events }
  }
  const children = node.children.map((child) => stripNode(child, warnings))
  if (events === node.events && children === node.children) return node
  return { ...node, events, children }
}

function stripEvents(
  node: Extract<IRNode, { kind: 'element' | 'componentRef' }>,
  warnings: CompileWarning[]
): typeof node.events {
  if (!node.events) return node.events
  let changed = false
  const out: NonNullable<typeof node.events> = {}
  for (const [eventName, handlers] of Object.entries(node.events) as [
    keyof NonNullable<typeof node.events>,
    IREventHandler[] | undefined
  ][]) {
    if (!handlers || handlers.length === 0) continue
    const kept: IREventHandler[] = []
    for (const h of handlers) {
      const next = stripNavigateHandler(h, node.sourceId, eventName, warnings)
      if (next) kept.push(next)
      if (next !== h) changed = true
    }
    if (kept.length > 0) out[eventName] = kept
    else changed = true
  }
  if (!changed) return node.events
  return Object.keys(out).length > 0 ? out : undefined
}

function stripNavigateHandler(
  handler: IREventHandler,
  nodeId: string,
  eventName: string,
  warnings: CompileWarning[]
): IREventHandler | undefined {
  if (handler.kind === 'navigate') {
    warnings.push({
      code: 'action-navigate-no-router',
      message:
        `node ${nodeId} ${eventName} navigate('${handler.to}') dropped — ` +
        'single-page compile has no router. Compile the document with all ' +
        'pages (default) to use react-router-dom.',
      nodeId
    })
    return undefined
  }
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    const consequent = stripNavigateHandlerList(handler.consequent, nodeId, eventName, warnings)
    const alternate = handler.alternate
      ? stripNavigateHandlerList(handler.alternate, nodeId, eventName, warnings)
      : undefined
    if (consequent.length === 0 && (alternate?.length ?? 0) === 0) return undefined
    if (consequent === handler.consequent && alternate === handler.alternate) return handler
    return { ...handler, consequent, alternate }
  }
  if (
    handler.kind === 'apiCall' ||
    handler.kind === 'supabaseQuery' ||
    handler.kind === 'supabaseMutation' ||
    handler.kind === 'invokeServerWorkflow'
  ) {
    const onSuccess = handler.onSuccess
      ? stripNavigateHandlerList(handler.onSuccess, nodeId, eventName, warnings)
      : undefined
    const onError = handler.onError
      ? stripNavigateHandlerList(handler.onError, nodeId, eventName, warnings)
      : undefined
    if (onSuccess === handler.onSuccess && onError === handler.onError) return handler
    return { ...handler, onSuccess, onError }
  }
  return handler
}

function stripNavigateHandlerList(
  handlers: IREventHandler[],
  nodeId: string,
  eventName: string,
  warnings: CompileWarning[]
): IREventHandler[] {
  const next = handlers.flatMap((handler) => {
    const stripped = stripNavigateHandler(handler, nodeId, eventName, warnings)
    return stripped ? [stripped] : []
  })
  return next.length === handlers.length &&
    next.every((handler, index) => handler === handlers[index])
    ? handlers
    : next
}
