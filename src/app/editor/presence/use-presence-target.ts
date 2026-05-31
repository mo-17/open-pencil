import { useCollabInjected } from '@/app/collab/use'
import type { PresenceEditingKind } from '@/app/collab/use'

/**
 * Phase 3 §4.4 — lowcode-aware presence. Wire a property panel's root element so
 * focus within it broadcasts an `editing` awareness target ({ kind, nodeId? }),
 * letting collaborators see which lowcode panel a peer is editing.
 *
 * Usage (in a Lowcode/*.vue panel):
 *   const presence = usePresenceTarget('events', () => selectedNode.value?.id)
 *   // template: <div @focusin="presence.onFocusIn" @focusout="presence.onFocusOut">
 *
 * Document/page-level panels (page state, docState, Supabase config) omit
 * `getNodeId` — their target carries no node id and the label is panel-only.
 *
 * Outside a collab session `useCollabInjected()` is undefined and every handler
 * is a no-op.
 */
export function usePresenceTarget(kind: PresenceEditingKind, getNodeId?: () => string | undefined) {
  const collab = useCollabInjected()

  function onFocusIn() {
    const nodeId = getNodeId?.()
    collab?.updateEditingTarget(nodeId ? { kind, nodeId } : { kind })
  }

  // Clear only when focus actually leaves the panel subtree — moving between
  // inputs inside the same panel keeps `relatedTarget` within the root. A
  // teleported popover (e.g. the variable picker) lands outside the root and
  // will clear the target; that is acceptable for non-critical presence and
  // re-sets the moment focus returns to the panel.
  function onFocusOut(event: FocusEvent) {
    const root = event.currentTarget as HTMLElement | null
    const next = event.relatedTarget as Node | null
    if (root && next && root.contains(next)) return
    collab?.updateEditingTarget(null)
  }

  return { onFocusIn, onFocusOut }
}
