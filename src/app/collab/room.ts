import * as decoding from 'lib0/decoding'
import type { BaseRoomConfig, RelayConfig, Room } from 'trystero'
import { joinRoom as joinMqttRoom } from 'trystero/mqtt'
import { joinRoom as joinSupabaseRoom } from 'trystero/supabase'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import { buildCollabNetworkConfig } from '@/app/collab/network-config'
import {
  joinCollabRoom,
  type CollabRoomTransport,
  type JoinCollabRoom
} from '@/app/collab/transport'
import { adaptTrysteroRoom } from '@/app/collab/transport/trystero'
import type { PreviewDocStatePayload } from '@/app/collab/types'
import { IS_BROWSER } from '@/constants'

const MAX_PREVIEW_DOC_STATE_BYTES = 1024 * 1024
const previewDocStateEncoder = new TextEncoder()
const previewDocStateDecoder = new TextDecoder('utf-8', { fatal: true })

// `trystero/mqtt`'s .d.ts omits the optional 3rd `onJoinError` arg that the
// underlying strategy (and the root `trystero` types) support. A two-arg
// function is assignable to this three-arg type, so this is a plain typed
// alias (no cast) that lets us pass the incorrect-password callback (§4.2 f).
type JoinRoomWithError = (
  config: BaseRoomConfig & RelayConfig,
  roomId: string,
  onJoinError?: (details: { error: string; appId: string; roomId: string; peerId: string }) => void
) => Room
const joinMqtt: JoinRoomWithError = joinMqttRoom

export type CollabRoomOptions = {
  roomId: string
  ydoc: Y.Doc
  awareness: awarenessProtocol.Awareness
  setConnected: () => void
  updatePeersList: () => void
  // Phase 3 §4.2 — room auth. `password` becomes the Trystero room key
  // (encrypts signaling SDP); `onAuthError` fires when a peer can't join
  // because the key is wrong/missing (joinRoom's onJoinError callback).
  password?: string
  onAuthError?: () => void
  // Phase 3 §4.6 — preview runtime docState. The receiver is resolved lazily so
  // the PreviewPane can register its handler after the room is already up.
  getPreviewDocStateHandler?: () => ((payload: PreviewDocStatePayload) => void) | undefined
  // Tests and alternate hosts can supply a deterministic byte transport.
  joinRoom?: JoinCollabRoom
}

export type CollabRoomConnection = {
  room: CollabRoomTransport
  sendYjsUpdate: (data: Uint8Array, peerId?: string) => void
  sendAwareness: (data: Uint8Array, peerId?: string) => void
  sendSyncStep1: (data: Uint8Array, peerId?: string) => void
  // Phase 3 §4.6 — broadcast a local runtime docState change to all peers.
  sendPreviewDocState: (payload: PreviewDocStatePayload) => void
}

function awarenessClientIds(data: Uint8Array): number[] {
  try {
    const decoder = decoding.createDecoder(data)
    const count = decoding.readVarUint(decoder)
    const clients: number[] = []
    for (let index = 0; index < count; index++) {
      clients.push(decoding.readVarUint(decoder))
      decoding.readVarUint(decoder)
      decoding.readVarString(decoder)
    }
    return clients
  } catch {
    return []
  }
}

function encodePreviewDocState(payload: PreviewDocStatePayload): Uint8Array | null {
  try {
    const bytes = previewDocStateEncoder.encode(JSON.stringify(payload))
    return bytes.byteLength <= MAX_PREVIEW_DOC_STATE_BYTES ? bytes : null
  } catch {
    return null
  }
}

function isPreviewDocStateValue(value: unknown): value is PreviewDocStatePayload['value'] {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isPreviewDocStateValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isPreviewDocStateValue)
}

function isPreviewDocStatePayload(value: unknown): value is PreviewDocStatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return (
    keys.length === 2 &&
    keys.includes('name') &&
    keys.includes('value') &&
    'name' in value &&
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    value.name.length <= 256 &&
    'value' in value &&
    isPreviewDocStateValue(value.value)
  )
}

function decodePreviewDocState(data: Uint8Array): PreviewDocStatePayload | null {
  if (data.byteLength > MAX_PREVIEW_DOC_STATE_BYTES) return null
  try {
    const value: unknown = JSON.parse(previewDocStateDecoder.decode(data))
    return isPreviewDocStatePayload(value) ? value : null
  } catch {
    return null
  }
}

function usesTestTransport(): boolean {
  return (
    IS_BROWSER &&
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('collabTransport') === 'test'
  )
}

function joinConfiguredRoom(
  roomId: string,
  password: string | undefined,
  onAuthError: (() => void) | undefined
): CollabRoomTransport {
  // Phase 3 §4.3 — signaling broker(s) + TURN come from the editor's build-time
  // env (VITE_COLLAB_*), falling back to the public broker + openrelay when
  // unset. §4.3-S adds a Supabase Realtime strategy (no public broker).
  const network = buildCollabNetworkConfig(import.meta.env)
  // No-swallow (经验 C): if Supabase signaling was requested but its URL/key
  // were incomplete, buildCollabNetworkConfig falls back to mqtt — surface it.
  if (
    import.meta.env.VITE_COLLAB_STRATEGY?.toLowerCase() === 'supabase' &&
    network.strategy !== 'supabase'
  ) {
    console.warn(
      '[collab] VITE_COLLAB_STRATEGY=supabase but URL/key incomplete — falling back to MQTT.'
    )
  }

  // Phase 3 §4.2 — `password` is the room key (encrypts SDP) regardless of
  // strategy. The Supabase strategy's joinRoom is 2-arg (no onJoinError), so
  // §4.2's wrong-key toast is mqtt-only; a wrong key there just fails to connect.
  const room =
    network.strategy === 'supabase' && network.supabaseKey
      ? joinSupabaseRoom(
          {
            appId: network.appId,
            supabaseKey: network.supabaseKey,
            password,
            rtcConfig: { iceServers: network.iceServers }
          },
          roomId
        )
      : joinMqtt(
          {
            appId: network.appId,
            password,
            relayUrls: network.relayUrls,
            rtcConfig: { iceServers: network.iceServers }
          },
          roomId,
          onAuthError ? () => onAuthError() : undefined
        )
  return adaptTrysteroRoom(room)
}

export function connectCollabRoom({
  roomId,
  ydoc,
  awareness,
  setConnected,
  updatePeersList,
  password,
  onAuthError,
  getPreviewDocStateHandler,
  joinRoom
}: CollabRoomOptions): CollabRoomConnection {
  let room: CollabRoomTransport
  if (joinRoom) {
    room = joinRoom(roomId)
  } else if (usesTestTransport()) {
    room = joinCollabRoom(roomId)
  } else {
    room = joinConfiguredRoom(roomId, password, onAuthError)
  }
  const [sendYjsUpdate, getUpdate] = room.makeAction('yjs-update')
  const [sendAwareness, getAwareness] = room.makeAction('awareness')
  const [sendSyncStep1, getSyncStep1] = room.makeAction('sync-step1')
  const [sendSyncReply, getSyncReply] = room.makeAction('sync-reply')
  // Phase 3 §4.6 — preview runtime docState is encoded into the transport's
  // bounded byte channel and remains ephemeral (never persisted into Yjs).
  const [sendDocState, getDocState] = room.makeAction('doc-state')

  const awarenessClientsByPeer = new Map<string, Set<number>>()

  getDocState((data) => {
    const payload = decodePreviewDocState(data)
    if (payload) getPreviewDocStateHandler?.()?.(payload)
  })

  getUpdate((data) => {
    Y.applyUpdate(ydoc, data, 'remote')
  })

  getAwareness((data, peerId) => {
    awarenessClientsByPeer.set(peerId, new Set(awarenessClientIds(data)))
    awarenessProtocol.applyAwarenessUpdate(awareness, data, 'remote')
  })

  getSyncStep1((stateVector, peerId) => {
    const update = Y.encodeStateAsUpdate(ydoc, stateVector)
    sendSyncReply(update, peerId)
  })

  getSyncReply((data) => {
    Y.applyUpdate(ydoc, data, 'remote')
  })

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    sendYjsUpdate(update)
  })

  awareness.on(
    'update',
    (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown
    ) => {
      if (origin === 'remote' || origin === 'peer-left') return
      const changedClients = [...added, ...updated, ...removed]
      const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      sendAwareness(encodedUpdate)
    }
  )

  room.onPeerJoin((peerId) => {
    setConnected()
    sendSyncStep1(Y.encodeStateVector(ydoc), peerId)
    sendAwareness(awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]), peerId)
  })

  room.onPeerLeave((peerId) => {
    const remoteClients = [...(awarenessClientsByPeer.get(peerId) ?? [])]
    awarenessClientsByPeer.delete(peerId)
    awarenessProtocol.removeAwarenessStates(awareness, remoteClients, 'peer-left')
    updatePeersList()
  })

  const sendPreviewDocState = (payload: PreviewDocStatePayload) => {
    const data = encodePreviewDocState(payload)
    if (data) sendDocState(data)
  }

  return { room, sendYjsUpdate, sendAwareness, sendSyncStep1, sendPreviewDocState }
}
