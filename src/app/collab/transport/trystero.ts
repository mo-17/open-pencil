import { getRelaySockets, joinRoom as joinTrysteroRoom, type Room } from '@trystero-p2p/mqtt'
import type { Room as LegacyRoom } from 'trystero'
import { joinRoom as joinSupabaseRoom } from 'trystero/supabase'

import { buildCollabNetworkConfig } from '@/app/collab/network-config'

import type { CollabAction, CollabMediaTransport, JoinCollabRoom } from './types'

/**
 * Trystero announces a newcomer to the room's brokers four times in its first 7.5 seconds, so
 * after those and a WebRTC handshake everyone already in the room has met it.
 */
const TRYSTERO_DISCOVERY_MS = 12_000

function trysteroMedia(room: Room): CollabMediaTransport {
  return {
    addTrack(track, stream, peerId) {
      void Promise.allSettled(room.addTrack(track, stream, { target: peerId }))
    },
    removeTrack(track, peerId) {
      room.removeTrack(track, { target: peerId })
    },
    replaceTrack(previous, next, peerId) {
      void Promise.allSettled(room.replaceTrack(previous, next, { target: peerId }))
    },
    onPeerTrack(handler) {
      room.onPeerTrack = (track, _stream, peerId) => handler(track, peerId)
    },
    connection: (peerId) => room.getPeers()[peerId]
  }
}

/**
 * Whether any relay socket Trystero shares between this window's rooms is open. Its types leave
 * the sockets untyped, and MQTT's may wrap a WebSocket rather than be one.
 */
function relayOpen(): boolean {
  const sockets: unknown = getRelaySockets()
  if (!sockets || typeof sockets !== 'object') return false
  return Object.values(sockets).some(
    (socket: unknown) =>
      typeof socket === 'object' &&
      socket !== null &&
      'readyState' in socket &&
      socket.readyState === WebSocket.OPEN
  )
}

function adaptSupabaseRoom(room: LegacyRoom): ReturnType<JoinCollabRoom> {
  return {
    makeAction(namespace) {
      const [send, receive] = room.makeAction<Uint8Array>(namespace)
      return [
        (data, peerId) => void send(data, peerId),
        (handler) => receive((data, peerId) => handler(new Uint8Array(data), peerId))
      ]
    },
    onPeerJoin: (handler) => room.onPeerJoin(handler),
    onPeerLeave: (handler) => room.onPeerLeave(handler),
    signalingConnected: () => true,
    discoveryMs: TRYSTERO_DISCOVERY_MS,
    media: {
      addTrack(track, stream, peerId) {
        void Promise.allSettled(room.addTrack(track, stream, peerId))
      },
      removeTrack(track, peerId) {
        room.removeTrack(track, peerId)
      },
      replaceTrack(previous, next, peerId) {
        void Promise.allSettled(room.replaceTrack(previous, next, peerId))
      },
      onPeerTrack(handler) {
        room.onPeerTrack((track, _stream, peerId) => handler(track, peerId))
      },
      connection: (peerId) => room.getPeers()[peerId]
    },
    leave: () => room.leave()
  }
}

export const joinTrysteroCollabRoom: JoinCollabRoom = (roomId, options) => {
  const network = buildCollabNetworkConfig(import.meta.env)
  if (network.strategy === 'supabase' && network.supabaseKey) {
    return adaptSupabaseRoom(
      joinSupabaseRoom(
        {
          appId: network.appId,
          supabaseKey: network.supabaseKey,
          password: options?.password,
          rtcConfig: { iceServers: network.iceServers }
        },
        roomId
      )
    )
  }
  const room = joinTrysteroRoom(
    {
      appId: network.appId,
      ...(network.relayUrls ? { relayConfig: { urls: network.relayUrls } } : {}),
      ...(options?.password ? { password: options.password } : {}),
      rtcConfig: { iceServers: network.iceServers }
    },
    roomId,
    { onJoinError: () => options?.onAuthError?.() }
  )

  return {
    makeAction(namespace): CollabAction {
      const action = room.makeAction<Uint8Array>(namespace)
      return [
        (data, peerId) => void action.send(data, peerId ? { target: peerId } : {}),
        (handler) => {
          action.onMessage = (data, { peerId }) => handler(new Uint8Array(data), peerId)
        }
      ]
    },
    onPeerJoin(handler) {
      room.onPeerJoin = handler
    },
    onPeerLeave(handler) {
      room.onPeerLeave = handler
    },
    // Brokers are shared by every room this window joins; any one of them carries announcements.
    signalingConnected: relayOpen,
    discoveryMs: TRYSTERO_DISCOVERY_MS,
    media: trysteroMedia(room),
    leave: async () => {
      await room.leave()
    }
  }
}
