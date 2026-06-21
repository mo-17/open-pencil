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
import type { IREventHandler, IRNode, IRTree } from '#compiler/ir/types'
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
  if (node.kind !== 'element') return false
  if (node.events) {
    for (const handlers of Object.values(node.events)) {
      if (handlers.some(pred)) return true
    }
  }
  return node.children.some((c) => treeHasHandler(c, pred))
}

export function pageHasNavigateHandler(ir: IRTree): boolean {
  return ir.children.some((c) => treeHasHandler(c, (h) => handlerTreeHasKind(h, 'navigate')))
}

/**
 * Phase 4 §16.2 — does any navigate handler in the page (including one nested
 * inside a `condition` / `confirm` branch) carry route params? Drives the
 * `generatePath` import — emitted alongside `useNavigate` only when a dynamic
 * `navigate(generatePath(...))` is actually produced.
 */
export function pageHasNavigateParams(ir: IRTree): boolean {
  return ir.children.some((c) =>
    treeHasHandler(c, (h) => handlerTreeMatches(h, (x) => x.kind === 'navigate' && (x.params?.length ?? 0) > 0))
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
    if (typeof value === 'object') return true
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
  return ir.children.some((c) =>
    treeHasHandler(
      c,
      (h) =>
        h.kind === 'supabaseQuery' ||
        h.kind === 'supabaseMutation' ||
        h.kind === 'supabaseAuth'
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

/** The nested handler chains of a branch-carrying handler (`condition` /
 *  `confirm`), or null for leaf handlers — lets predicates descend both
 *  branch kinds uniformly. */
function handlerBranches(h: IREventHandler): IREventHandler[] | null {
  if (h.kind === 'condition' || h.kind === 'confirm') {
    return [...h.consequent, ...(h.alternate ?? [])]
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
  if (!pageHasNavigateHandler(ir)) return { ir, warnings: [] }
  const warnings: CompileWarning[] = []
  const children = ir.children.map((c) => stripNode(c, ir.pageId, warnings))
  return { ir: { ...ir, children }, warnings }
}

function stripNode(node: IRNode, pageId: string, warnings: CompileWarning[]): IRNode {
  // Phase 2 §9: descend through the new wrapper kinds so navigate handlers
  // inside conditional / list subtrees get the same single-page treatment
  // (drop + warn) as anywhere else.
  if (node.kind === 'conditional') {
    const consequent = stripNode(node.consequent, pageId, warnings)
    return consequent === node.consequent ? node : { ...node, consequent }
  }
  if (node.kind === 'list') {
    const template = stripNode(node.template, pageId, warnings)
    return template === node.template ? node : { ...node, template }
  }
  if (node.kind !== 'element') return node
  const events = stripEvents(node, pageId, warnings)
  const children = node.children.map((c) => stripNode(c, pageId, warnings))
  if (events === node.events && children === node.children) return node
  return { ...node, events, children }
}

function stripEvents(
  node: Extract<IRNode, { kind: 'element' }>,
  pageId: string,
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
      if (h.kind === 'navigate') {
        warnings.push({
          code: 'action-navigate-no-router',
          message:
            `node ${node.sourceId} ${eventName} navigate('${h.to}') dropped — ` +
            'single-page compile has no router. Compile the document with all ' +
            'pages (default) to use react-router-dom.',
          nodeId: node.sourceId
        })
        changed = true
        continue
      }
      kept.push(h)
    }
    if (kept.length > 0) out[eventName] = kept
    else changed = true
  }
  if (!changed) return node.events
  // pageId not used for warnings (per-node already), but accepted for symmetry
  // with future per-page transforms.
  void pageId
  return Object.keys(out).length > 0 ? out : undefined
}
