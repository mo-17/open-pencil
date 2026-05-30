import type { Color } from '@open-pencil/core/types'

/** Phase 3 §4.4 — the lowcode property panel a peer is actively editing.
 *  One per Lowcode/*.vue panel. Drives "who's editing what" presence. */
export type PresenceEditingKind =
  | 'textBinding'
  | 'valueBinding'
  | 'interactiveProps'
  | 'state'
  | 'events'
  | 'list'
  | 'renderCondition'
  | 'docState'
  | 'supabaseConfig'

/** Phase 3 §4.4 — broadcast over awareness as the `editing` field. Carries only
 *  structural identifiers (which panel + which node); never field values. The
 *  human label is derived on the render side from the local graph. */
export interface PresenceEditingTarget {
  kind: PresenceEditingKind
  /** Node-scoped panels carry the selected node id; document-level panels omit. */
  nodeId?: string
}

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  cursor?: { x: number; y: number; pageId: string }
  selection?: string[]
  /** Phase 3 §4.4 — the lowcode panel this peer is editing, if any. */
  editing?: PresenceEditingTarget
}

export interface CollabState {
  connected: boolean
  roomId: string | null
  /** Phase 3 §4.2 — room auth key (Trystero password). Runtime-only: lives in
   *  the share-link URL fragment, never persisted to .fig / docState and never
   *  broadcast via awareness. */
  roomKey: string | null
  peers: RemotePeer[]
  localName: string
  localColor: Color
}

export const DEFAULT_COLLAB_STATE: CollabState = {
  connected: false,
  roomId: null,
  roomKey: null,
  peers: [],
  localName: '',
  localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 }
}
