import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { IREventHandler, IRSupabaseFilter } from '@open-pencil/compiler/ir/types'
import type { ExprAst } from '@open-pencil/lowcode'

/**
 * Phase 3 §2 step 2 — `supabaseQuery` handler emit.
 *
 * Like `apiCall`, the handler `await`s a network request and writes the
 * result into a Document State. The arrow becomes `async` and the body is
 * a `try/catch` block — same `getSupabaseClient()...await...setDocState`
 * shape as `_lowcode_state.ts`-backed pages already use.
 */

function ident(name: string): ExprAst {
  return { kind: 'ident', name }
}

function literalString(value: string): ExprAst {
  return { kind: 'string', value }
}

function filter(column: string, op: IRSupabaseFilter['op'], ast: ExprAst): IRSupabaseFilter {
  return { column, op, ast, references: ast.kind === 'ident' ? [ast.name] : [] }
}

const SIMPLE_HANDLER: IREventHandler = {
  kind: 'supabaseQuery',
  table: 'users',
  columns: '*',
  filters: [],
  single: false,
  resultTarget: 'users'
}

describe('emit supabaseQuery handler (Phase 3 §2)', () => {
  test('zero-filter select → from().select(*) + setDocState in async try/catch', () => {
    const out = emitEventHandler([SIMPLE_HANDLER])
    expect(out).toContain('async () => {')
    expect(out).toContain(
      'const { data, error } = await getSupabaseClient().from("users").select("*");'
    )
    expect(out).toContain(
      'if (error) { console.error("supabase request failed:", error) } else { setDocState("users", data) }'
    )
    expect(out).toContain('catch (err) { console.error("supabase request threw:", err) }')
  })

  test('single() chain when handler.single is true', () => {
    const handler: IREventHandler = { ...SIMPLE_HANDLER, single: true }
    expect(emitEventHandler([handler])).toContain('.select("*").single();')
  })

  test('explicit columns list emits as JSON-quoted argument', () => {
    const handler: IREventHandler = { ...SIMPLE_HANDLER, columns: 'id,name,email' }
    expect(emitEventHandler([handler])).toContain('.select("id,name,email")')
  })

  test('filter chain emits one .op(column, value) per filter in order', () => {
    const handler: IREventHandler = {
      ...SIMPLE_HANDLER,
      filters: [
        filter('status', 'eq', literalString('active')),
        filter('age', 'gte', { kind: 'number', value: 18 })
      ]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('.select("*").eq("status", "active").gte("age", 18);')
  })

  test('filter value can reference an in-scope identifier (state / docState)', () => {
    const handler: IREventHandler = {
      ...SIMPLE_HANDLER,
      filters: [filter('id', 'eq', ident('userId'))]
    }
    expect(emitEventHandler([handler])).toContain('.eq("id", userId)')
  })

  test('errorTarget routes the error object through setDocState before logging', () => {
    const handler: IREventHandler = {
      ...SIMPLE_HANDLER,
      errorTarget: 'lastError'
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('if (error) { setDocState("lastError", error); console.error')
    expect(out).toContain('else { setDocState("users", data) }')
  })

  test('every supported filter op survives the chain', () => {
    const ops: IRSupabaseFilter['op'][] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'in']
    const handler: IREventHandler = {
      ...SIMPLE_HANDLER,
      filters: ops.map((op) => filter('col', op, { kind: 'number', value: 1 }))
    }
    const out = emitEventHandler([handler])
    for (const op of ops) expect(out).toContain(`.${op}("col", 1)`)
  })

  test('sole supabaseQuery is brace-wrapped (try/catch is a block statement)', () => {
    expect(emitEventHandler([SIMPLE_HANDLER]).startsWith('async () => { try {')).toBe(true)
  })
})
