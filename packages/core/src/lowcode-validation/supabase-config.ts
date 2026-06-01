/**
 * Phase 3 §3 — shared Supabase config validators.
 *
 * Lifted from `src/components/properties/Lowcode/SupabaseConfigPanel.vue`
 * so the editor UI and the lowcode AI tool can both refuse a service_role
 * JWT before it reaches `lowcodeSupabaseConfig` pluginData (Phase 3 §2.7
 * risk row 1). Drift between the two paths would be silent on the editor
 * side (banner shows) and dangerous on the tool side (key persists), so
 * one source.
 */
import type { SupabaseConfig } from '#core/scene-graph'
import type { JsonObject } from '#core/types'

import type { ValidationResult } from './validate'

/** Decode a JWT's payload segment to its JSON object form. Returns `null`
 *  on any structural / base64 / JSON parse failure so callers can treat
 *  "not a JWT" identically to "not a service_role JWT" — both are safe.
 *
 *  JWTs are `header.payload.signature`; the payload is base64url-encoded.
 *  We swap base64url alphabet, pad to a multiple of 4, then `atob` +
 *  `JSON.parse`. No signature verification — the editor / tool is just
 *  classifying the role claim, not authenticating the token. */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.')
  if (parts.length !== 3) return null
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return JSON.parse(json) as JsonObject
  } catch {
    return null
  }
}

/** True when `anonKey` decodes to a JWT whose payload has `role: 'service_role'`.
 *  Used as a hard reject in every code path that would otherwise persist the
 *  key — never log, never partially commit. */
export function detectServiceRole(anonKey: string): boolean {
  return decodeJwtPayload(anonKey)?.role === 'service_role'
}

/** Validate a `SupabaseConfig` for persistence. Rejects:
 *  - missing required fields (`url` / `anonKey`)
 *  - `anonKey` that decodes to a service_role JWT
 *  - obviously malformed `url` (non-http(s) protocol)
 *
 *  Whitespace-only fields count as missing — the editor trims them before
 *  calling, but the tool surface might receive raw AI output, so we trim
 *  defensively here too. */
export function validateSupabaseConfig(config: SupabaseConfig): ValidationResult {
  const url = config.url.trim()
  const anonKey = config.anonKey.trim()
  if (url === '') return { ok: false, reason: 'url is required' }
  if (anonKey === '') return { ok: false, reason: 'anonKey is required' }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: 'url must start with http:// or https://' }
  }
  if (detectServiceRole(anonKey)) {
    return {
      ok: false,
      reason: 'anonKey is a service_role JWT; only the anon (public) key is allowed'
    }
  }
  return { ok: true }
}
