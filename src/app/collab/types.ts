import type { Color } from '@open-pencil/scene-graph/primitives'

import type { MotionTimelineConflict } from '@/app/collab/motion-timeline-yjs'

/** Phase 3 §4.4 — the lowcode property panel a peer is actively editing.
 *  One per Lowcode/*.vue panel. Drives "who's editing what" presence. */
export type PresenceEditingKind =
  | 'textBinding'
  | 'valueBinding'
  | 'interactiveProps'
  | 'state'
  | 'events'
  | 'list'
  | 'componentProps'
  | 'responsiveOverrides'
  | 'stateOverrides'
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

export interface MotionTimelinePresence {
  scope: 'node' | 'scene'
  ownerId: string
  sequenceId?: string
  trackIds: string[]
  keyframeIds: string[]
  cueIds: string[]
  playheadMs: number
  playing: boolean
}

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  cursor?: { x: number; y: number; pageId: string }
  selection?: string[]
  /** Phase 3 §4.4 — the lowcode panel this peer is editing, if any. */
  editing?: PresenceEditingTarget
  /** Ephemeral timeline selection/playhead; never persisted into the document. */
  motionTimeline?: MotionTimelinePresence
}

/** Phase 3 §4.6 — preview runtime-state collaboration. JSON-serializable so it
 *  rides a Trystero room action (DataPayload). docState values are always JSON
 *  (string/number/boolean/array/object). */
export type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }

/** A single runtime docState key change mirrored across a preview session.
 *  A type literal (not an interface) so it satisfies Trystero's DataPayload
 *  index-signature constraint. */
export type PreviewDocStatePayload = {
  name: string
  value: JSONValue
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
  /** Bounded, deduplicated deterministic-resolution notices for Motion CRDT merges. */
  motionConflicts: MotionTimelineConflict[]
}

export const DEFAULT_COLLAB_STATE: CollabState = {
  connected: false,
  roomId: null,
  roomKey: null,
  peers: [],
  localName: '',
  localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
  motionConflicts: []
}
