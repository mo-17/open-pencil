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

export function pageHasNavigateHandler(ir: IRTree): boolean {
  return ir.children.some(nodeHasNavigate)
}

function nodeHasNavigate(node: IRNode): boolean {
  if (node.kind !== 'element') return false
  if (node.events) {
    for (const handlers of Object.values(node.events)) {
      if (handlers.some((h) => h.kind === 'navigate')) return true
    }
  }
  return node.children.some(nodeHasNavigate)
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
