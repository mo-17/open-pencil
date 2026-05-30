import { describe, expect, test } from 'bun:test'

import { buildCollabNetworkConfig } from '@/app/collab/network-config'
import { TRYSTERO_APP_ID } from '@/constants'

/**
 * Phase 3 §4.3 — collab signaling relays + TURN are configurable via the
 * editor's VITE_COLLAB_* env, falling back to the public broker + openrelay.
 * The config builder is a pure function (the real broker/TURN round-trip is the
 * two-machine ACK, 经验 K).
 */
describe('buildCollabNetworkConfig (Phase 3 §4.3)', () => {
  test('empty env → public defaults (no custom relays, openrelay TURN, default appId)', () => {
    const c = buildCollabNetworkConfig({})
    expect(c.strategy).toBe('mqtt')
    expect(c.appId).toBe(TRYSTERO_APP_ID)
    expect(c.relayUrls).toBeUndefined()
    // 2 STUN + 2 openrelay TURN entries.
    expect(c.iceServers).toHaveLength(4)
    expect(c.iceServers.some((s) => String(s.urls).includes('openrelay'))).toBe(true)
    expect(c.iceServers.some((s) => String(s.urls).startsWith('stun:'))).toBe(true)
  })

  test('VITE_COLLAB_RELAY_URLS → parsed, trimmed, blanks dropped', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_RELAY_URLS: 'wss://a.example/mqtt , , wss://b.example/mqtt '
    })
    expect(c.relayUrls).toEqual(['wss://a.example/mqtt', 'wss://b.example/mqtt'])
  })

  test('blank relay URLs string → treated as unset (public defaults)', () => {
    expect(buildCollabNetworkConfig({ VITE_COLLAB_RELAY_URLS: '   ,  ' }).relayUrls).toBeUndefined()
  })

  test('VITE_COLLAB_TURN_URL → replaces openrelay, keeps STUN, carries creds', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_TURN_URL: 'turn:turn.example:3478',
      VITE_COLLAB_TURN_USERNAME: 'user',
      VITE_COLLAB_TURN_CREDENTIAL: 'secret'
    })
    expect(c.iceServers.some((s) => String(s.urls).includes('openrelay'))).toBe(false)
    expect(c.iceServers.some((s) => String(s.urls).startsWith('stun:'))).toBe(true)
    const turn = c.iceServers.find((s) => String(s.urls) === 'turn:turn.example:3478')
    expect(turn?.username).toBe('user')
    expect(turn?.credential).toBe('secret')
  })

  test('custom TURN without creds → open TURN server, no username/credential keys', () => {
    const c = buildCollabNetworkConfig({ VITE_COLLAB_TURN_URL: 'turn:open.example:3478' })
    const turn = c.iceServers.find((s) => String(s.urls) === 'turn:open.example:3478')
    expect(turn).toBeDefined()
    expect(turn?.username).toBeUndefined()
    expect(turn?.credential).toBeUndefined()
  })

  test('VITE_COLLAB_APP_ID overrides the default app id', () => {
    expect(buildCollabNetworkConfig({ VITE_COLLAB_APP_ID: 'acme-private' }).appId).toBe('acme-private')
  })

  test('blank app id → falls back to the default', () => {
    expect(buildCollabNetworkConfig({ VITE_COLLAB_APP_ID: '  ' }).appId).toBe(TRYSTERO_APP_ID)
  })

  test('§4.3-S: strategy=supabase with URL+key → supabase, appId=URL, key carried, TURN kept', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_STRATEGY: 'supabase',
      VITE_COLLAB_SUPABASE_URL: 'https://proj.supabase.co',
      VITE_COLLAB_SUPABASE_KEY: 'anon-key'
    })
    expect(c.strategy).toBe('supabase')
    expect(c.appId).toBe('https://proj.supabase.co')
    expect(c.supabaseKey).toBe('anon-key')
    // WebRTC data-plane still uses STUN/TURN regardless of strategy.
    expect(c.iceServers.some((s) => String(s.urls).startsWith('stun:'))).toBe(true)
    // relayUrls is mqtt-only.
    expect(c.relayUrls).toBeUndefined()
  })

  test('§4.3-S: strategy=supabase but key missing → falls back to mqtt', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_STRATEGY: 'supabase',
      VITE_COLLAB_SUPABASE_URL: 'https://proj.supabase.co'
    })
    expect(c.strategy).toBe('mqtt')
    expect(c.appId).toBe(TRYSTERO_APP_ID)
    expect(c.supabaseKey).toBeUndefined()
  })

  test('§4.3-S: strategy is case-insensitive', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_STRATEGY: 'SUPABASE',
      VITE_COLLAB_SUPABASE_URL: 'https://proj.supabase.co',
      VITE_COLLAB_SUPABASE_KEY: 'k'
    })
    expect(c.strategy).toBe('supabase')
  })

  test('§4.3-S: no strategy set → mqtt even if supabase creds present', () => {
    const c = buildCollabNetworkConfig({
      VITE_COLLAB_SUPABASE_URL: 'https://proj.supabase.co',
      VITE_COLLAB_SUPABASE_KEY: 'k'
    })
    expect(c.strategy).toBe('mqtt')
  })
})
