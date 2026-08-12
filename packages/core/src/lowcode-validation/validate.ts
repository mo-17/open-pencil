/**
 * Phase 1 §7.3 — single source of truth for lowcode field validation.
 *
 * Mirrors the checks already enforced by the IR collect pass
 * (`collect/state.ts`, `collect/bindings.ts`) so the editor UI can show
 * the same errors inline without round-tripping a full compile. Don't
 * tighten one side without the other or warnings will diverge.
 */
import { parseExpression, parseTemplate } from './expression'
import { isReservedLowcodeStateIdentifier, LOWCODE_IDENTIFIER_RE } from './identifiers'

export interface ValidationResult {
  ok: boolean
  reason?: string
}

/** A state name must be a legal JS identifier — it becomes the `useState`
 *  binding name directly. Empty strings are rejected explicitly so the UI
 *  can show "required" before the user has typed anything.
 *
 *  Phase 3 §2: names starting with `$` are reserved for built-in docStates
 *  (`$currentUser` and future `$sessionTime` / etc.). The `$` check fires
 *  before the IDENT_RE check so the error message can name the reservation
 *  instead of the generic "must start with a letter or _" message. */
export function validateStateName(name: string): ValidationResult {
  if (name === '') return { ok: false, reason: 'name is required' }
  if (name.startsWith('$')) {
    return {
      ok: false,
      reason: 'names starting with $ are reserved for built-in states (e.g. $currentUser)'
    }
  }
  if (!LOWCODE_IDENTIFIER_RE.test(name)) {
    return {
      ok: false,
      reason: 'must start with a letter or _ and contain only letters, digits, _'
    }
  }
  if (isReservedLowcodeStateIdentifier(name)) {
    return {
      ok: false,
      reason: 'name is reserved by JavaScript or the OpenPencil generated runtime'
    }
  }
  return { ok: true }
}

/** An action's `valueExpr` must parse against the Phase 0 expression
 *  sub-language. Whitespace-only / empty inputs are rejected with a
 *  user-friendly reason rather than the parser's internal "empty
 *  expression" message. */
export function validateExpression(src: string): ValidationResult {
  if (src.trim() === '') return { ok: false, reason: 'expression is required' }
  const result = parseExpression(src)
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.error }
}

/** Phase 2 §4 — an apiCall URL is a `${}` template. Mirrors the
 *  `resolveApiCall` URL gates the editor can check without a full compile:
 *  non-empty, and the template parses. Identifier resolution stays a
 *  compile-time warning — the editor cannot see the full handler scope
 *  (page state + docState + LIST item|index). */
export function validateURLTemplate(src: string): ValidationResult {
  if (src.trim() === '') return { ok: false, reason: 'url is required' }
  const result = parseTemplate(src)
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.error }
}

/** Phase 3 §3.v2 — payload normalize footgun fix (§3.8 surprise #6).
 *
 * AI tool calls frequently send `payloadJson: '{}'` or `'[]'` on
 * `supabaseMutation` actions even when the intent is "no payload"
 * (most often on `delete`). The trimmed-non-empty literal made IR
 * collect raise `action-supabase-mutation-unexpected-payload` and
 * silently drop the handler. Strip both at the input boundary (tool +
 * IR collect both call this) so the empty-object / empty-array
 * "deserialised to undefined" intent goes through as `undefined`
 * regardless of the source channel (decision §3.v2.2 #h). */
export function normalizeSupabaseMutationPayloadJSON(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === '{}' || trimmed === '[]') return ''
  return raw
}
