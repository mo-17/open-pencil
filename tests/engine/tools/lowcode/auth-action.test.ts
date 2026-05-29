import { describe, expect, test } from 'bun:test'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Ok<T = undefined> = { ok: true; data?: T }
type Err = { ok: false; error: string }
type Result<T = undefined> = Ok<T> | Err

/**
 * Phase 3 §2.v2 step 3 — `supabaseAuth` action tool-boundary validation.
 * Phase 3 §2.v3 step 3 — adds the `signUp` operation, validated exactly like
 * signIn (email/password expr parse).
 *
 * The 7th ActionDef kind. signIn / signOut / signUp persist through
 * update_lowcode_node; a malformed email/password expression is rejected
 * (decision §2.v2.2 g), while a missing credential is accepted here and left
 * for IR collect to warn on (mirrors the §3.v2 "malformed = reject, missing =
 * warn" split).
 */
function update(
  id: string,
  events: Record<string, unknown>,
  figma: ReturnType<typeof setupToolTest>['figma']
): Result<{ id: string; updated: string[] }> {
  return getTool('update_lowcode_node').execute(figma, {
    id,
    patch_json: JSON.stringify({ events })
  }) as Result<{ id: string; updated: string[] }>
}

describe('update_lowcode_node — supabaseAuth (Phase 3 §2.v2)', () => {
  test('persists a signIn action with email/password exprs', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 'a-1',
      kind: 'supabaseAuth',
      operation: 'signIn',
      emailExpr: 'emailInput',
      passwordExpr: 'passwordInput'
    }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('persists a signOut action with no credentials', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = { id: 'a-1', kind: 'supabaseAuth', operation: 'signOut' }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('persists a signUp action with email/password exprs (Phase 3 §2.v3)', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const action = {
      id: 'a-1',
      kind: 'supabaseAuth',
      operation: 'signUp',
      emailExpr: 'emailInput',
      passwordExpr: 'passwordInput'
    }
    const result = update(btn.id, { onClick: [action] }, figma)
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toEqual(action)
  })

  test('rejects a malformed signUp password expression (decision g, Phase 3 §2.v3)', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      {
        onClick: [
          {
            id: 'a-1',
            kind: 'supabaseAuth',
            operation: 'signUp',
            emailExpr: 'emailInput',
            passwordExpr: 'a@b.co' // unquoted string → tokenizer error
          }
        ]
      },
      figma
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('passwordExpr')
  })

  test('rejects an invalid operation', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'a-1', kind: 'supabaseAuth', operation: 'register' }] },
      figma
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('operation')
  })

  test('rejects a malformed email expression (decision g)', () => {
    const { figma } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      {
        onClick: [
          {
            id: 'a-1',
            kind: 'supabaseAuth',
            operation: 'signIn',
            emailExpr: 'a@b.co', // unquoted string → tokenizer error
            passwordExpr: 'pw'
          }
        ]
      },
      figma
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('emailExpr')
  })

  test('accepts a signIn with a missing credential (IR warns, tool does not reject)', () => {
    const { figma, graph } = setupToolTest()
    const btn = figma.createRectangle()
    const result = update(
      btn.id,
      { onClick: [{ id: 'a-1', kind: 'supabaseAuth', operation: 'signIn', emailExpr: 'emailInput' }] },
      figma
    )
    expect(result.ok).toBe(true)
    expect(graph.getNode(btn.id)?.events?.onClick?.[0]).toMatchObject({ operation: 'signIn' })
  })
})
