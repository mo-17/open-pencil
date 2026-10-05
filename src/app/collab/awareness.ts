import { randomIndex } from '@open-pencil/core/random'

import { parsePeer } from '@/app/presence/schema'
import { ROOM_ID_CHARS, ROOM_ID_LENGTH, ROOM_KEY_LENGTH } from '@/constants'

import type { MotionTimelinePresence, RemotePeer } from './types'

type PeerEditing = RemotePeer['editing']
const EDITING_KINDS = new Set([
  'textBinding',
  'valueBinding',
  'interactiveProps',
  'state',
  'events',
  'list',
  'componentProps',
  'responsiveOverrides',
  'stateOverrides',
  'renderCondition',
  'docState',
  'supabaseConfig'
])
function parseEditingTarget(value: unknown): PeerEditing {
  if (!value || typeof value !== 'object') return undefined
  const kind = Reflect.get(value, 'kind')
  const nodeId = Reflect.get(value, 'nodeId')
  if (typeof kind !== 'string' || !EDITING_KINDS.has(kind)) return undefined
  if (nodeId !== undefined && (typeof nodeId !== 'string' || !SAFE_PRESENCE_ID.test(nodeId)))
    return undefined
  return { kind: kind as NonNullable<PeerEditing>['kind'], ...(nodeId ? { nodeId } : {}) }
}

const MAX_TIMELINE_PRESENCE_IDS = 32
const MAX_TIMELINE_PLAYHEAD_MS = 120_000
const SAFE_PRESENCE_ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/

function presenceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter((id): id is string => typeof id === 'string' && SAFE_PRESENCE_ID.test(id))
    )
  ]
    .sort()
    .slice(0, MAX_TIMELINE_PRESENCE_IDS)
}

/** Strict bounded awareness decoder. Malformed peers cannot grow reactive UI state. */
export function parseMotionTimelinePresence(value: unknown): MotionTimelinePresence | undefined {
  if (!value || typeof value !== 'object') return undefined
  const scope = Reflect.get(value, 'scope')
  const ownerId = Reflect.get(value, 'ownerId')
  if (scope !== 'node' && scope !== 'scene') return undefined
  if (typeof ownerId !== 'string' || !SAFE_PRESENCE_ID.test(ownerId)) return undefined
  const rawPlayhead = Reflect.get(value, 'playheadMs')
  const playheadMs =
    typeof rawPlayhead === 'number' && Number.isFinite(rawPlayhead)
      ? Math.min(MAX_TIMELINE_PLAYHEAD_MS, Math.max(0, rawPlayhead))
      : 0
  const rawSequenceId = Reflect.get(value, 'sequenceId')
  const sequenceId =
    typeof rawSequenceId === 'string' && SAFE_PRESENCE_ID.test(rawSequenceId)
      ? rawSequenceId
      : undefined
  return {
    scope,
    ownerId,
    ...(sequenceId ? { sequenceId } : {}),
    trackIds: presenceIds(Reflect.get(value, 'trackIds')),
    keyframeIds: presenceIds(Reflect.get(value, 'keyframeIds')),
    cueIds: presenceIds(Reflect.get(value, 'cueIds')),
    playheadMs,
    playing: Reflect.get(value, 'playing') === true
  }
}

/** People in the room other than us, validated: awareness comes from other browsers. */
export function buildRemotePeers(
  states: Map<number, Record<string, unknown>>,
  localClientId: number
): RemotePeer[] {
  return [...states].flatMap(([clientId, state]) => {
    if (clientId === localClientId) return []
    const peer = parsePeer(clientId, state)
    if (!peer) return []
    return [
      {
        ...peer,
        editing: parseEditingTarget(state.editing),
        motionTimeline: parseMotionTimelinePresence(state.motionTimeline)
      }
    ]
  })
}

export function generateRoomId(): string {
  let result = ''
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    result += ROOM_ID_CHARS[randomIndex(ROOM_ID_CHARS.length)]
  }
  return result
}

/** Phase 3 §4.2 — a long random room key used as the Trystero password.
 *  `randomIndex` is crypto-backed (no Math.random, per repo convention). */
export function generateRoomKey(): string {
  let result = ''
  for (let i = 0; i < ROOM_KEY_LENGTH; i++) {
    result += ROOM_ID_CHARS[randomIndex(ROOM_ID_CHARS.length)]
  }
  return result
}
