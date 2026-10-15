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
import type { RoomStatus } from '@/app/collab/room/status'
import type { AgentPresence, PersonPoint } from '@/app/presence/types'

export interface RemotePeer {
  clientId: number
  name: string
  color: Color
  cursor?: PersonPoint
  selection?: string[]
  /** Agents this person runs, as they publish them. */
  agents: AgentPresence[]
  editing?: PresenceEditingTarget
  motionTimeline?: MotionTimelinePresence
  treeFormat?: number
  hasFile?: boolean
  voice?: VoiceMembership
}

export type JSONValue = string | number | boolean | null | JSONValue[] | { [k: string]: JSONValue }
export type PreviewDocStatePayload = {
  name: string
  value: JSONValue
}

/** What a person in a room's voice call publishes about it. */
export interface VoiceMembership {
  muted: boolean
}

/** The active tab's room, as the collaboration UI shows it. */
export interface CollabState {
  /** Whether the active tab is in a room. */
  inRoom: boolean
  connected: boolean
  roomId: string | null
  roomKey: string | null
  motionConflicts: MotionTimelineConflict[]
  status: RoomStatus | null
  peers: RemotePeer[]
  localName: string
  localColor: Color
  hasChosenName: boolean
}

export const DEFAULT_COLLAB_STATE: CollabState = {
  inRoom: false,
  connected: false,
  roomId: null,
  roomKey: null,
  motionConflicts: [],
  status: null,
  peers: [],
  localName: '',
  localColor: { r: 0.5, g: 0.5, b: 0.5, a: 1 },
  hasChosenName: false
}
