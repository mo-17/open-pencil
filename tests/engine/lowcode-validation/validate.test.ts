import { describe, expect, test } from 'bun:test'

import {
  normalizeSupabaseMutationPayloadJson,
  validateStateName,
  validateExpression
} from '@open-pencil/core/lowcode-validation'

/**
 * Phase 1 §7.3 — these helpers back the StatePanel / EventsPanel inline
 * error UI. They must stay aligned with what the IR collect pass rejects
 * (see `packages/compiler/src/ir/collect/state.ts` and `bindings.ts`).
 */
describe('validateStateName', () => {
  test('rejects empty', () => {
    const r = validateStateName('')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('required')
  })

  test('rejects leading digit', () => {
    const r = validateStateName('1count')
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/letter or _/)
  })

  test('rejects spaces and punctuation', () => {
    expect(validateStateName('my count').ok).toBe(false)
    expect(validateStateName('count!').ok).toBe(false)
    expect(validateStateName('count-1').ok).toBe(false)
  })

  test('accepts legal identifiers', () => {
    expect(validateStateName('count').ok).toBe(true)
    expect(validateStateName('_hidden').ok).toBe(true)
    expect(validateStateName('myCount2').ok).toBe(true)
    expect(validateStateName('UPPER').ok).toBe(true)
  })

  test('rejects $ prefix (reserved for built-in states, Phase 3 §2)', () => {
    for (const reserved of ['$currentUser', '$sessionTime', '$', '$x']) {
      const r = validateStateName(reserved)
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/reserved/)
    }
  })
})

describe('validateExpression', () => {
  test('rejects empty / whitespace', () => {
    expect(validateExpression('').ok).toBe(false)
    expect(validateExpression('   ').ok).toBe(false)
    expect(validateExpression('\n\t').ok).toBe(false)
  })

  test('accepts the Phase 0 sub-language', () => {
    expect(validateExpression('count + 1').ok).toBe(true)
    expect(validateExpression('!flag').ok).toBe(true)
    expect(validateExpression('count > 0 ? "yes" : "no"').ok).toBe(true)
    expect(validateExpression('user.name').ok).toBe(true)
  })

  test('rejects illegal syntax with the parser reason', () => {
    const r = validateExpression('count +')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  test('rejects forbidden tokens (function calls / assignment)', () => {
    expect(validateExpression('foo()').ok).toBe(false)
    expect(validateExpression('x = 1').ok).toBe(false)
  })
})

/**
 * Phase 3 §3.v2 §3 — payloadJson `{}` / `[]` normalize footgun fix
 * (§3.8 surprise #6). AI tool calls leave `payloadJson: '{}'` on
 * actions where the intent is "no payload", which silently dropped
 * the handler at IR collect. The shared validator strips both braces
 * and brackets so the downstream pipeline sees `''`.
 */
describe('normalizeSupabaseMutationPayloadJson', () => {
  test('preserves undefined as undefined', () => {
    expect(normalizeSupabaseMutationPayloadJson(undefined)).toBeUndefined()
  })

  test('empty string stays empty (no-op)', () => {
    expect(normalizeSupabaseMutationPayloadJson('')).toBe('')
    expect(normalizeSupabaseMutationPayloadJson('   ')).toBe('')
  })

  test('`{}` (and whitespace-padded variants) normalises to empty', () => {
    expect(normalizeSupabaseMutationPayloadJson('{}')).toBe('')
    expect(normalizeSupabaseMutationPayloadJson('  {}  ')).toBe('')
    expect(normalizeSupabaseMutationPayloadJson('\n{}\t')).toBe('')
  })

  test('`[]` normalises to empty (delete + empty array footgun)', () => {
    expect(normalizeSupabaseMutationPayloadJson('[]')).toBe('')
    expect(normalizeSupabaseMutationPayloadJson(' [] ')).toBe('')
  })

  test('real JSON literal payloads pass through unchanged', () => {
    expect(normalizeSupabaseMutationPayloadJson('{"name":"Alice"}')).toBe(
      '{"name":"Alice"}'
    )
    expect(normalizeSupabaseMutationPayloadJson('[{"id":1}]')).toBe('[{"id":1}]')
  })

  test('does NOT normalise `{ }` with inner whitespace — only exact `{}` / `[]`', () => {
    // `{ }` is still a valid empty JSON object that JSON.parse accepts;
    // the AI footgun pattern was literal `{}` / `[]`, so the helper stays
    // narrow. If we ever see this in real Tauri data, widen + retest.
    expect(normalizeSupabaseMutationPayloadJson('{ }')).toBe('{ }')
  })
})
