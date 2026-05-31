import { describe, expect, test } from 'bun:test'

import {
  PAYLOAD_ENTRY_KEY_RE,
  validateSupabasePayloadEntries
} from '@open-pencil/core/lowcode-validation'

/**
 * Phase 3 §3.v3 step 1 — direct unit coverage at the new shared
 * location. Tool-side end-to-end coverage (via `update_lowcode_node`)
 * stays in `tests/engine/tools/lowcode/modify.test.ts`; these tests
 * exercise the validator in isolation so the EventsPanel UI (the
 * third consumer added in §3.v3 step 3) inherits the same contract.
 */
describe('PAYLOAD_ENTRY_KEY_RE', () => {
  test('accepts JS identifiers', () => {
    expect(PAYLOAD_ENTRY_KEY_RE.test('name')).toBe(true)
    expect(PAYLOAD_ENTRY_KEY_RE.test('_internal')).toBe(true)
    expect(PAYLOAD_ENTRY_KEY_RE.test('col_42')).toBe(true)
  })

  test('rejects leading digit / punctuation / spaces / empty', () => {
    expect(PAYLOAD_ENTRY_KEY_RE.test('1bad')).toBe(false)
    expect(PAYLOAD_ENTRY_KEY_RE.test('col-1')).toBe(false)
    expect(PAYLOAD_ENTRY_KEY_RE.test('col 1')).toBe(false)
    expect(PAYLOAD_ENTRY_KEY_RE.test('')).toBe(false)
  })
})

describe('validateSupabasePayloadEntries', () => {
  const where = 'events.onClick[0]'

  test('accepts undefined (entries are optional)', () => {
    expect(validateSupabasePayloadEntries(where, undefined).ok).toBe(true)
  })

  test('accepts empty array', () => {
    expect(validateSupabasePayloadEntries(where, []).ok).toBe(true)
  })

  test('accepts valid entries with literal + identifier valueExpr', () => {
    const r = validateSupabasePayloadEntries(where, [
      { key: 'name', valueExpr: '"Alice"' },
      { key: 'age', valueExpr: 'formAge' }
    ])
    expect(r.ok).toBe(true)
  })

  test('rejects non-array raw', () => {
    const r = validateSupabasePayloadEntries(where, { name: 'x' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('events.onClick[0].payloadEntries must be an array')
  })

  test('rejects non-object entry', () => {
    const r = validateSupabasePayloadEntries(where, ['not-an-object'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('[0] must be an object')
  })

  test('rejects missing / empty key', () => {
    const r1 = validateSupabasePayloadEntries(where, [{ valueExpr: '"x"' }])
    expect(r1.ok).toBe(false)
    if (r1.ok) return
    expect(r1.error).toContain('.key must be a non-empty string')

    const r2 = validateSupabasePayloadEntries(where, [{ key: '', valueExpr: '"x"' }])
    expect(r2.ok).toBe(false)
    if (r2.ok) return
    expect(r2.error).toContain('.key must be a non-empty string')
  })

  test('rejects non-identifier key', () => {
    const r = validateSupabasePayloadEntries(where, [{ key: '1bad', valueExpr: '"x"' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('"1bad" must be a JS identifier')
  })

  test('rejects duplicate key', () => {
    const r = validateSupabasePayloadEntries(where, [
      { key: 'name', valueExpr: '"a"' },
      { key: 'name', valueExpr: '"b"' }
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('duplicates key "name"')
  })

  test('rejects non-string valueExpr', () => {
    const r = validateSupabasePayloadEntries(where, [{ key: 'name', valueExpr: 42 }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('.valueExpr must be a string')
  })

  test('rejects unparseable valueExpr (delegates to validateExpression)', () => {
    const r = validateSupabasePayloadEntries(where, [{ key: 'name', valueExpr: 'a + ' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('"name".valueExpr —')
  })

  test('prepends the where path to every error', () => {
    const r = validateSupabasePayloadEntries('events.onSubmit[2]', 'not-an-array')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.startsWith('events.onSubmit[2]')).toBe(true)
  })
})
