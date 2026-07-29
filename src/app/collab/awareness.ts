import { ref } from 'vue'
import type * as awarenessProtocol from 'y-protocols/awareness'

import { randomIndex } from '@open-pencil/core/random'
import type { Color } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/active-store'
import { PEER_COLORS, ROOM_ID_CHARS, ROOM_ID_LENGTH, ROOM_KEY_LENGTH } from '@/constants'

import type { MotionTimelinePresence, RemotePeer } from './types'

type PeerEditing = RemotePeer['editing']

type Awareness = awarenessProtocol.Awareness

type CursorState = {
  x: number
  y: number
  pageId: string
  zoom?: number
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

export function buildRemotePeers(
  states: Map<number, Record<string, unknown>>,
  localClientId: number
): RemotePeer[] {
  const peers: RemotePeer[] = []

  states.forEach((peerState, clientId) => {
    if (clientId === localClientId) return
    const user = peerState.user as { name?: string; color?: Color } | undefined
    if (!user) return
    peers.push({
      clientId,
      name: user.name || 'Anonymous',
      color: user.color || PEER_COLORS[clientId % PEER_COLORS.length],
      cursor: peerState.cursor as RemotePeer['cursor'],
      selection: peerState.selection as string[],
      editing: peerState.editing as PeerEditing,
      motionTimeline: parseMotionTimelinePresence(peerState.motionTimeline)
    })
  })

  return peers
}

export function remotePeersToCursors(peers: RemotePeer[], currentPageId: string) {
  return peers
    .filter((p) => p.cursor && p.cursor.pageId === currentPageId)
    .map((p) => {
      const cursor = p.cursor as NonNullable<RemotePeer['cursor']>
      return {
        name: p.name,
        color: p.color,
        x: cursor.x,
        y: cursor.y,
        selection: p.selection
      }
    })
}

export function createFollowActions(
  getStore: () => EditorStore,
  getAwareness: () => Awareness | null
) {
  const followingPeer = ref<number | null>(null)

  function followPeer(clientId: number | null) {
    followingPeer.value = clientId
  }

  function resetFollow() {
    followingPeer.value = null
  }

  function tickFollow() {
    const store = getStore()
    const awareness = getAwareness()
    if (!followingPeer.value || !awareness) return
    const peerState = awareness.getStates().get(followingPeer.value)
    if (!peerState?.cursor) {
      followingPeer.value = null
      return
    }
    const cursor = peerState.cursor as CursorState
    if (cursor.pageId !== store.state.currentPageId) {
      void store.switchPage(cursor.pageId)
    }
    const canvas = document.querySelector('canvas')
    if (!canvas) return
    if (cursor.zoom) store.state.zoom = cursor.zoom
    const cw = canvas.width / devicePixelRatio
    const ch = canvas.height / devicePixelRatio
    store.state.panX = cw / 2 - cursor.x * store.state.zoom
    store.state.panY = ch / 2 - cursor.y * store.state.zoom
    store.requestRender()
  }

  return { followingPeer, followPeer, resetFollow, tickFollow }
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
