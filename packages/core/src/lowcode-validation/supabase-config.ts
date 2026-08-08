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
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

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

/** True when `anonKey` decodes to a JWT whose payload has `role: 'service_role'`. */
export function detectServiceRole(anonKey: string): boolean {
  return decodeJwtPayload(anonKey)?.role === 'service_role'
}

/** True when a value is any Supabase server-side key that must never be
 * persisted in a design or emitted client bundle. Covers both the legacy
 * service_role JWT and the current opaque `sb_secret_*` format. Keep this as
 * the single persistence-boundary classifier used by editor and app profiles;
 * unknown/non-JWT values are not classified as secret merely because they are
 * malformed, while the known elevated formats always fail closed. */
export function detectSupabaseSecretKey(key: string): boolean {
  const trimmed = key.trim()
  return /^sb_secret_/i.test(trimmed) || detectServiceRole(trimmed)
}

/** Validate a `SupabaseConfig` for persistence. Rejects:
 *  - missing required fields (`url` / `anonKey`)
 *  - a current `sb_secret_*` key or legacy service_role JWT
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
  if (detectSupabaseSecretKey(anonKey)) {
    return {
      ok: false,
      reason:
        'anonKey is a Supabase secret/service_role key; only a publishable or legacy anon key is allowed'
    }
  }
  return { ok: true }
}
