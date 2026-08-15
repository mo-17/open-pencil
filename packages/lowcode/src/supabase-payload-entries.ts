/**
 * Phase 3 §3.v2 — `SupabaseMutationAction.payloadEntries[]` shared validators.
 *
 * Originally lived inline in `packages/core/src/tools/modify/lowcode.ts`
 * (private `validateSupabasePayloadEntries`) with the same regex mirrored
 * in `packages/compiler/src/ir/collect/bindings.ts`. Lifted here in §3.v3
 * (decision §3.v3.2 #f) so all three consumers — AI tool input, IR
 * collect, and the EventsPanel UI — share one source of truth (经验 I).
 *
 * Return shape `{ ok: true } | { ok: false; error: string }` (not the
 * standard `ValidationResult` `{ reason }`) is preserved verbatim from
 * the original tool-side implementation: the tool boundary prepends a
 * `where` path to every error string for AI-facing diagnostics, and
 * the tool dispatcher consumes `.error`. UI does its own per-row
 * validation using `PAYLOAD_ENTRY_KEY_RE` + `validateExpression` and
 * does NOT need to call the full function.
 */
import { validateExpression } from './validate'

/** JS-identifier rule for `payloadEntries[].key` (column names). Mirrors
 *  the same constraint applied to page-state / docState names so an AI
 *  tool can't smuggle `e.target.value` or other expression syntax through
 *  the key channel. */
export const PAYLOAD_ENTRY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function failAt(where: string, msg: string): { ok: false; error: string } {
  return { ok: false, error: `${where}${msg}` }
}

export function validateSupabasePayloadEntries(
  where: string,
  raw: unknown
): { ok: true } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true }
  if (!Array.isArray(raw)) return failAt(where, '.payloadEntries must be an array')
  const seenKeys = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i]
    if (!isPlainObject(entry)) {
      return failAt(where, `.payloadEntries[${i}] must be an object`)
    }
    if (typeof entry.key !== 'string' || entry.key === '') {
      return failAt(where, `.payloadEntries[${i}].key must be a non-empty string`)
    }
    if (!PAYLOAD_ENTRY_KEY_RE.test(entry.key)) {
      return failAt(
        where,
        `.payloadEntries[${i}].key "${entry.key}" must be a JS identifier (column name)`
      )
    }
    if (seenKeys.has(entry.key)) {
      return failAt(where, `.payloadEntries[${i}] duplicates key "${entry.key}"`)
    }
    seenKeys.add(entry.key)
    if (typeof entry.valueExpr !== 'string') {
      return failAt(where, `.payloadEntries[${i}].valueExpr must be a string`)
    }
    const r = validateExpression(entry.valueExpr)
    if (!r.ok) {
      return failAt(where, `.payloadEntries[${i}] "${entry.key}".valueExpr — ${r.reason}`)
    }
  }
  return { ok: true }
}
