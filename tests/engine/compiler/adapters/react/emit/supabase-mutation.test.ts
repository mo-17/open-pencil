import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { ExprAst } from '@open-pencil/compiler/ir/expression'
import type { IREventHandler, IRSupabaseFilter } from '@open-pencil/compiler/ir/types'

/**
 * Phase 3 §2 step 2 — `supabaseMutation` handler emit. Insert / upsert /
 * update / delete each emit a distinct chain shape; payload is the IR's
 * compact JSON (already validated by collect) spliced verbatim as a JS
 * literal; update / delete carry filters as where-clause.
 */

function ident(name: string): ExprAst {
  return { kind: 'ident', name }
}

function filter(column: string, op: IRSupabaseFilter['op'], ast: ExprAst): IRSupabaseFilter {
  return { column, op, ast, references: ast.kind === 'ident' ? [ast.name] : [] }
}

const BASE = (operation: 'insert' | 'update' | 'delete' | 'upsert'): IREventHandler => ({
  kind: 'supabaseMutation',
  operation,
  table: 'users',
  payload: undefined,
  filters: []
})

describe('emit supabaseMutation handler (Phase 3 §2)', () => {
  test('insert payload → from(t).insert(<payload>) in async try/catch', () => {
    const handler: IREventHandler = {
      ...BASE('insert'),
      payload: '{"name":"Alice"}'
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'const { data, error } = await getSupabaseClient().from("users").insert({"name":"Alice"});'
    )
    expect(out).toContain('console.error("supabase request failed:", error)')
  })

  test('insert with resultTarget routes result to setDocState', () => {
    const handler: IREventHandler = {
      ...BASE('insert'),
      payload: '{"name":"Alice"}',
      resultTarget: 'newUser'
    }
    expect(emitEventHandler([handler])).toContain('setDocState("newUser", data)')
  })

  test('upsert emits .upsert(payload) instead of .insert', () => {
    const handler: IREventHandler = {
      ...BASE('upsert'),
      payload: '{"id":1,"name":"Bob"}'
    }
    expect(emitEventHandler([handler])).toContain('.upsert({"id":1,"name":"Bob"})')
  })

  test('update emits .update(payload) followed by the filter chain', () => {
    const handler: IREventHandler = {
      ...BASE('update'),
      payload: '{"name":"Carol"}',
      filters: [filter('id', 'eq', { kind: 'number', value: 1 })]
    }
    expect(emitEventHandler([handler])).toContain('.update({"name":"Carol"}).eq("id", 1)')
  })

  test('delete emits .delete() followed by the filter chain (no payload)', () => {
    const handler: IREventHandler = {
      ...BASE('delete'),
      filters: [filter('id', 'eq', ident('targetId'))]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('.delete().eq("id", targetId)')
    // No `.insert` / `.update` / `.upsert` slipped in.
    expect(out).not.toContain('.insert(')
    expect(out).not.toContain('.update(')
    expect(out).not.toContain('.upsert(')
  })

  test('without resultTarget the success path is just the error guard', () => {
    const handler: IREventHandler = {
      ...BASE('delete'),
      filters: [filter('id', 'eq', { kind: 'number', value: 1 })]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('if (error) { console.error("supabase request failed:", error) }')
    // No `else { setDocState(... } ` block — there's no resultTarget.
    expect(out).not.toContain('else {')
  })

  test('errorTarget set without resultTarget still writes error to the docState', () => {
    const handler: IREventHandler = {
      ...BASE('delete'),
      filters: [filter('id', 'eq', { kind: 'number', value: 1 })],
      errorTarget: 'mutationError'
    }
    expect(emitEventHandler([handler])).toContain(
      'if (error) { setDocState("mutationError", error); console.error'
    )
  })

  test('mixed with sync setVariable → async arrow, both kept in order', () => {
    const setVar: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'requestCount',
      ast: { kind: 'number', value: 1 },
      references: [],
      mode: 'absolute'
    }
    const mut: IREventHandler = {
      ...BASE('insert'),
      payload: '{"name":"A"}'
    }
    const out = emitEventHandler([setVar, mut])
    expect(out.startsWith('async () => {')).toBe(true)
    expect(out).toContain('setDocState("requestCount", 1); try {')
  })
})
