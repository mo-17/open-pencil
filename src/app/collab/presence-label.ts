import type { PresenceEditingKind, RemotePeer } from '@/app/collab/types'

/**
 * Phase 3 §4.4 — render a human label for which lowcode panel a remote peer is
 * editing ("Editing events of Button1" / "Editing document state").
 *
 * Shared by the desktop CollabPanel and the mobile presence popover so the two
 * surfaces never drift. The payload carries only { kind, nodeId? }; the node
 * name is resolved here from the local graph (peers share node ids via Yjs),
 * falling back to a generic word when the node hasn't synced yet.
 */

/** Subset of the dialogs i18n bundle this helper consumes. Node-scoped entries
 *  interpolate the node name; document/page-level entries stand alone. */
type NodeLabel = (params: { node: string }) => string
export interface PresenceDialogs {
  presenceEditingTextBinding: NodeLabel
  presenceEditingValueBinding: NodeLabel
  presenceEditingInteractiveProps: NodeLabel
  presenceEditingEvents: NodeLabel
  presenceEditingList: NodeLabel
  presenceEditingRenderCondition: NodeLabel
  presenceEditingState: string
  presenceEditingDocState: string
  presenceEditingSupabaseConfig: string
  presenceEditingNodeFallback: string
}

export function presenceEditingLabel(
  peer: RemotePeer,
  dialogs: PresenceDialogs,
  getNodeName: (id: string) => string | undefined
): string | null {
  const editing = peer.editing
  if (!editing) return null

  const node =
    (editing.nodeId ? getNodeName(editing.nodeId) : undefined) ?? dialogs.presenceEditingNodeFallback

  // Exhaustive over PresenceEditingKind — a new panel kind without a label here
  // is a compile error.
  const labels: Record<PresenceEditingKind, string> = {
    textBinding: dialogs.presenceEditingTextBinding({ node }),
    valueBinding: dialogs.presenceEditingValueBinding({ node }),
    interactiveProps: dialogs.presenceEditingInteractiveProps({ node }),
    events: dialogs.presenceEditingEvents({ node }),
    list: dialogs.presenceEditingList({ node }),
    renderCondition: dialogs.presenceEditingRenderCondition({ node }),
    state: dialogs.presenceEditingState,
    docState: dialogs.presenceEditingDocState,
    supabaseConfig: dialogs.presenceEditingSupabaseConfig
  }
  return labels[editing.kind]
}
