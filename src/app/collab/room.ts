import type { BaseRoomConfig, RelayConfig, Room } from 'trystero'
import { joinRoom as joinMqttRoom } from 'trystero/mqtt'
import { joinRoom as joinSupabaseRoom } from 'trystero/supabase'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'

import { buildCollabNetworkConfig } from '@/app/collab/network-config'
import type { PreviewDocStatePayload } from '@/app/collab/types'

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

type CollabRoomOptions = {
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
}

export type CollabRoomConnection = {
  room: Room
  sendYjsUpdate: (data: Uint8Array, peerId?: string) => void
  sendAwareness: (data: Uint8Array, peerId?: string) => void
  sendSyncStep1: (data: Uint8Array, peerId?: string) => void
  // Phase 3 §4.6 — broadcast a local runtime docState change to all peers.
  sendPreviewDocState: (payload: PreviewDocStatePayload) => void
}

export function connectCollabRoom({
  roomId,
  ydoc,
  awareness,
  setConnected,
  updatePeersList,
  password,
  onAuthError,
  getPreviewDocStateHandler
}: CollabRoomOptions): CollabRoomConnection {
  // Phase 3 §4.3 — signaling broker(s) + TURN come from the editor's build-time
  // env (VITE_COLLAB_*), falling back to the public broker + openrelay when
  // unset. §4.3-S adds a Supabase Realtime strategy (no public broker).
  const network = buildCollabNetworkConfig(import.meta.env)
  // No-swallow (经验 C): if Supabase signaling was requested but its URL/key
  // were incomplete, buildCollabNetworkConfig falls back to mqtt — surface it.
  if (import.meta.env.VITE_COLLAB_STRATEGY?.toLowerCase() === 'supabase' && network.strategy !== 'supabase') {
    console.warn('[collab] VITE_COLLAB_STRATEGY=supabase but URL/key incomplete — falling back to MQTT.')
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

  const [sendUpdate, getUpdate] = room.makeAction<Uint8Array>('yjs-update')
  const [sendAw, getAw] = room.makeAction<Uint8Array>('awareness')
  const [sendSync, getSync] = room.makeAction<Uint8Array>('sync-step1')
  const [sendSyncReply, getSyncReply] = room.makeAction<Uint8Array>('sync-reply')
  // Phase 3 §4.6 — preview runtime docState (ephemeral P2P broadcast, never
  // persisted; namespace ≤12 bytes per Trystero).
  const [sendDocState, getDocState] = room.makeAction<PreviewDocStatePayload>('doc-state')

  const sendYjsUpdate = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendUpdate(data, peerId) : sendUpdate(data))
  const sendAwareness = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendAw(data, peerId) : sendAw(data))
  const sendSyncStep1 = (data: Uint8Array, peerId?: string) =>
    void (peerId ? sendSync(data, peerId) : sendSync(data))
  const sendPreviewDocState = (payload: PreviewDocStatePayload) => void sendDocState(payload)

  getDocState((payload) => {
    getPreviewDocStateHandler?.()?.(payload)
  })

  getUpdate((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  getAw((data) => {
    awarenessProtocol.applyAwarenessUpdate(awareness, new Uint8Array(data), null)
  })

  getSync((data, peerId) => {
    const sv = new Uint8Array(data)
    const update = Y.encodeStateAsUpdate(ydoc, sv)
    void sendSyncReply(update, peerId)
  })

  getSyncReply((data) => {
    Y.applyUpdate(ydoc, new Uint8Array(data), 'remote')
  })

  ydoc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return
    sendYjsUpdate(update)
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
      const changedClients = [...added, ...updated, ...removed]
      const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      sendAwareness(encodedUpdate)
    }
  )

  room.onPeerJoin((peerId) => {
    setConnected()
    const sv = Y.encodeStateVector(ydoc)
    sendSyncStep1(sv, peerId)

    const encodedUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID])
    sendAwareness(encodedUpdate, peerId)
  })

  room.onPeerLeave(() => {
    const remoteClients = [...awareness.getStates().keys()].filter(
      (id) => id !== awareness.clientID
    )
    awarenessProtocol.removeAwarenessStates(awareness, remoteClients, 'peer-left')
    updatePeersList()
  })

  return { room, sendYjsUpdate, sendAwareness, sendSyncStep1, sendPreviewDocState }
}
