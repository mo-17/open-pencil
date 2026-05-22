/**
 * Phase 1 §7.3 — single source of truth for lowcode field validation.
 *
 * Mirrors the checks already enforced by the IR collect pass
 * (`collect/state.ts`, `collect/bindings.ts`) so the editor UI can show
 * the same errors inline without round-tripping a full compile. Don't
 * tighten one side without the other or warnings will diverge.
 */
import { parseExpression, parseTemplate } from './expression'

export interface ValidationResult {
  ok: boolean
  reason?: string
}

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** A state name must be a legal JS identifier — it becomes the `useState`
 *  binding name directly. Empty strings are rejected explicitly so the UI
 *  can show "required" before the user has typed anything. */
export function validateStateName(name: string): ValidationResult {
  if (name === '') return { ok: false, reason: 'name is required' }
  if (!IDENT_RE.test(name)) {
    return {
      ok: false,
      reason: 'must start with a letter or _ and contain only letters, digits, _'
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
export function validateUrlTemplate(src: string): ValidationResult {
  if (src.trim() === '') return { ok: false, reason: 'url is required' }
  const result = parseTemplate(src)
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.error }
}
