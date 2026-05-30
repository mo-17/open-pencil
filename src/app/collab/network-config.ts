// Phase 3 §4.3 — configurable collab signaling relays + TURN.
//
// The collab transport stays trystero/mqtt; this only decides WHICH MQTT
// broker(s) and TURN server the room connects through. Values come from the
// editor's build-time env (import.meta.env.VITE_COLLAB_*, mirroring §5.3's
// Supabase env injection), with the current public services as the fallback —
// so an unconfigured editor behaves exactly as before and self-hosting is
// opt-in. Pure + env-as-argument so it's unit-testable.

import { TRYSTERO_APP_ID } from '@/constants'

export interface CollabNetworkEnv {
  VITE_COLLAB_APP_ID?: string
  /** Comma-separated `wss://…` MQTT broker URLs. */
  VITE_COLLAB_RELAY_URLS?: string
  VITE_COLLAB_TURN_URL?: string
  VITE_COLLAB_TURN_USERNAME?: string
  VITE_COLLAB_TURN_CREDENTIAL?: string
}

export interface CollabNetworkConfig {
  appId: string
  /** Custom MQTT brokers; omitted → Trystero's public defaults. */
  relayUrls?: string[]
  iceServers: RTCIceServer[]
}

// Free STUN — NAT discovery, always included (not a reliability/privacy risk).
const STUN_SERVERS: readonly RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
]

// openrelay free TURN — the no-SLA default, used unless a custom TURN is set.
const OPENRELAY_TURN: readonly RTCIceServer[] = [
  {
    urls: 'turn:openrelay.metered.ca:443',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  },
  {
    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

/** Trim, returning undefined for missing/blank — blank env counts as unset. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Split a comma-separated list into trimmed, non-empty entries (or undefined). */
function parseRelayUrls(value: string | undefined): string[] | undefined {
  const urls = (value ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
  return urls.length > 0 ? urls : undefined
}

/** A custom TURN server when configured, else the openrelay fallback. */
function resolveTurnServers(env: CollabNetworkEnv): readonly RTCIceServer[] {
  const url = nonEmpty(env.VITE_COLLAB_TURN_URL)
  if (!url) return OPENRELAY_TURN
  const server: RTCIceServer = { urls: url }
  const username = nonEmpty(env.VITE_COLLAB_TURN_USERNAME)
  const credential = nonEmpty(env.VITE_COLLAB_TURN_CREDENTIAL)
  if (username !== undefined) server.username = username
  if (credential !== undefined) server.credential = credential
  return [server]
}

export function buildCollabNetworkConfig(env: CollabNetworkEnv): CollabNetworkConfig {
  const appId = nonEmpty(env.VITE_COLLAB_APP_ID) ?? TRYSTERO_APP_ID
  const relayUrls = parseRelayUrls(env.VITE_COLLAB_RELAY_URLS)
  const iceServers = [...STUN_SERVERS, ...resolveTurnServers(env)]
  return relayUrls ? { appId, relayUrls, iceServers } : { appId, iceServers }
}
