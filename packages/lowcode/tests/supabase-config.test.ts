import { describe, expect, test } from 'bun:test'

import {
  decodeJwtPayload,
  detectServiceRole,
  detectSupabaseSecretKey,
  validateSupabaseConfig
} from '@open-pencil/lowcode'

/**
 * Phase 3 §3 step 1 — supabase-config validators were lifted from
 * `SupabaseConfigPanel.vue` so editor + lowcode AI tool share one path.
 * The detector was previously tested via Tauri only (`§2 Tauri #2`);
 * pin its behavior in unit form here so drift between the two consumers
 * can't ship undetected.
 */

// A synthetic anon JWT (`{"role":"anon"}` payload). Signature is bogus —
// the detector never validates signatures, only classifies the `role`
// claim, so a syntactically-valid JWT shape with an `anon` payload is
// the correct positive control for "key passes the gate".
const FAKE_ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.fake'
// Same shape, but the payload encodes `{"role":"service_role"}`.
const FAKE_SERVICE_ROLE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake'

describe('decodeJwtPayload', () => {
  test('returns null for strings that are not three dot-separated segments', () => {
    expect(decodeJwtPayload('')).toBeNull()
    expect(decodeJwtPayload('foo')).toBeNull()
    expect(decodeJwtPayload('foo.bar')).toBeNull()
    expect(decodeJwtPayload('a.b.c.d')).toBeNull()
  })

  test('returns null when the payload segment is not valid base64url JSON', () => {
    expect(decodeJwtPayload('a.!!.c')).toBeNull()
  })

  test('decodes a well-formed JWT payload to its JSON object', () => {
    const payload = decodeJwtPayload(FAKE_ANON_JWT)
    expect(payload).toEqual({ role: 'anon' })
  })
})

describe('detectServiceRole', () => {
  test('returns false for an anon JWT', () => {
    expect(detectServiceRole(FAKE_ANON_JWT)).toBe(false)
  })

  test('returns true for a service_role JWT', () => {
    expect(detectServiceRole(FAKE_SERVICE_ROLE_JWT)).toBe(true)
  })

  test('returns false for a non-JWT string so typos do not block real keys', () => {
    expect(detectServiceRole('not a jwt at all')).toBe(false)
    expect(detectServiceRole('')).toBe(false)
  })
})

describe('detectSupabaseSecretKey', () => {
  test('rejects current opaque secret keys and legacy service_role JWTs', () => {
    expect(detectSupabaseSecretKey('sb_secret_example')).toBe(true)
    expect(detectSupabaseSecretKey('  SB_SECRET_example  ')).toBe(true)
    expect(detectSupabaseSecretKey(FAKE_SERVICE_ROLE_JWT)).toBe(true)
  })

  test('allows current publishable keys and legacy anon JWTs', () => {
    expect(detectSupabaseSecretKey('sb_publishable_example')).toBe(false)
    expect(detectSupabaseSecretKey(FAKE_ANON_JWT)).toBe(false)
  })
})

describe('validateSupabaseConfig', () => {
  test('rejects missing url', () => {
    const r = validateSupabaseConfig({ url: '', anonKey: FAKE_ANON_JWT })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('url')
  })

  test('rejects whitespace-only url', () => {
    const r = validateSupabaseConfig({ url: '   ', anonKey: FAKE_ANON_JWT })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('url')
  })

  test('rejects missing anonKey', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: ''
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('anonKey')
  })

  test('rejects url without http(s) scheme', () => {
    const r = validateSupabaseConfig({ url: 'x.supabase.co', anonKey: FAKE_ANON_JWT })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/http/i)
  })

  test('rejects a service_role JWT in anonKey', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: FAKE_SERVICE_ROLE_JWT
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('service_role')
  })

  test('rejects a current sb_secret key in anonKey', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: 'sb_secret_example'
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('secret')
  })

  test('accepts a current sb_publishable key', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: 'sb_publishable_example'
    })
    expect(r.ok).toBe(true)
  })

  test('accepts a well-formed anon config', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: FAKE_ANON_JWT
    })
    expect(r.ok).toBe(true)
  })

  test('accepts http:// for local dev (not just https://)', () => {
    const r = validateSupabaseConfig({
      url: 'http://localhost:54321',
      anonKey: FAKE_ANON_JWT
    })
    expect(r.ok).toBe(true)
  })

  test('preserves an optional schema field passing through (validator does not consume it)', () => {
    const r = validateSupabaseConfig({
      url: 'https://x.supabase.co',
      anonKey: FAKE_ANON_JWT,
      schema: 'public'
    })
    expect(r.ok).toBe(true)
  })
})
