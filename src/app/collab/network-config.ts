// Phase 3 §4.3 — configurable collab signaling relays + TURN.
//
// The collab transport stays trystero/mqtt; this only decides WHICH MQTT
// broker(s) and TURN server the room connects through. Values come from the
// editor's build-time env (import.meta.env.VITE_COLLAB_*, mirroring §5.3's
// Supabase env injection), with the current public services as the fallback —
// so an unconfigured editor behaves exactly as before and self-hosting is
// opt-in. Pure + env-as-argument so it's unit-testable.

import { TRYSTERO_APP_ID } from '@/constants'

/** Signaling transport. `mqtt` = public/self-hosted MQTT broker (default);
 *  `supabase` = Supabase Realtime (no public broker), §4.3-S. */
export type CollabStrategy = 'mqtt' | 'supabase'

export interface CollabNetworkEnv {
  /** `mqtt` (default) | `supabase`. */
  VITE_COLLAB_STRATEGY?: string
  VITE_COLLAB_APP_ID?: string
  /** Comma-separated `wss://…` MQTT broker URLs. */
  VITE_COLLAB_RELAY_URLS?: string
  /** Supabase project URL — required for the `supabase` strategy. */
  VITE_COLLAB_SUPABASE_URL?: string
  /** Supabase anon key — required for the `supabase` strategy. */
  VITE_COLLAB_SUPABASE_KEY?: string
  VITE_COLLAB_TURN_URL?: string
  VITE_COLLAB_TURN_USERNAME?: string
  VITE_COLLAB_TURN_CREDENTIAL?: string
}

export interface CollabNetworkConfig {
  /** The *effective* strategy — `supabase` only when explicitly selected AND
   *  both URL+key are present; otherwise `mqtt` (transport stays usable). */
  strategy: CollabStrategy
  /** mqtt: the namespace appId; supabase: the Supabase project URL. */
  appId: string
  /** Supabase anon key — present only for the `supabase` strategy. */
  supabaseKey?: string
  /** Custom MQTT brokers; omitted → Trystero's public defaults (mqtt only). */
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
  const iceServers = [...STUN_SERVERS, ...resolveTurnServers(env)]

  // Supabase signaling (§4.3-S) only when explicitly selected AND fully
  // configured; an incomplete selection falls back to mqtt so collab still
  // works (transport, not auth — room.ts warns about the mismatch).
  const wantsSupabase = nonEmpty(env.VITE_COLLAB_STRATEGY)?.toLowerCase() === 'supabase'
  const supabaseUrl = nonEmpty(env.VITE_COLLAB_SUPABASE_URL)
  const supabaseKey = nonEmpty(env.VITE_COLLAB_SUPABASE_KEY)
  if (wantsSupabase && supabaseUrl && supabaseKey) {
    return { strategy: 'supabase', appId: supabaseUrl, supabaseKey, iceServers }
  }

  const appId = nonEmpty(env.VITE_COLLAB_APP_ID) ?? TRYSTERO_APP_ID
  const relayUrls = parseRelayUrls(env.VITE_COLLAB_RELAY_URLS)
  return relayUrls
    ? { strategy: 'mqtt', appId, relayUrls, iceServers }
    : { strategy: 'mqtt', appId, iceServers }
}
