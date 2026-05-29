import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'

/**
 * Phase 3 §2.v2 step 2 — `supabaseAuth` handler emit. signIn emits
 * `signInWithPassword({ email, password })` from credential ASTs; signOut
 * emits `signOut()`. Both destructure only `{ error }` (no result target —
 * `$currentUser` syncs via the runtime onAuthStateChange). errorTarget, when
 * set, routes the auth error to setDocState.
 *
 * Phase 3 §2.v3 step 2 — signUp emits `signUp({ email, password })` from the
 * same credential ASTs (decision §2.v3.2 c), also destructuring only
 * `{ error }`.
 */
function ident(name: string): ExprAst {
  return { kind: 'ident', name }
}

describe('emit supabaseAuth handler (Phase 3 §2.v2)', () => {
  test('signIn emits signInWithPassword with email/password exprs in async try/catch', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'signIn',
      emailAst: ident('emailInput'),
      passwordAst: ident('passwordInput'),
      references: ['emailInput', 'passwordInput']
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'const { error } = await getSupabaseClient().auth.signInWithPassword({ email: emailInput, password: passwordInput });'
    )
    expect(out).toContain('console.error("signIn failed:", error)')
    expect(out.startsWith('async () =>')).toBe(true)
  })

  test('signOut emits signOut() and no email/password', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'signOut',
      references: []
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('const { error } = await getSupabaseClient().auth.signOut();')
    expect(out).toContain('console.error("signOut failed:", error)')
    expect(out).not.toContain('signInWithPassword')
  })

  test('signUp emits signUp() with email/password exprs (not signInWithPassword)', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'signUp',
      emailAst: ident('emailInput'),
      passwordAst: ident('passwordInput'),
      references: ['emailInput', 'passwordInput']
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'const { error } = await getSupabaseClient().auth.signUp({ email: emailInput, password: passwordInput });'
    )
    expect(out).toContain('console.error("signUp failed:", error)')
    expect(out).not.toContain('signInWithPassword')
    expect(out.startsWith('async () =>')).toBe(true)
  })

  test('errorTarget routes the auth error to setDocState', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'signIn',
      emailAst: ident('emailInput'),
      passwordAst: ident('pw'),
      references: ['emailInput', 'pw'],
      errorTarget: 'authError'
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('setDocState("authError", error);')
  })

  test('no errorTarget → no setDocState for the error', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'signOut',
      references: []
    }
    const out = emitEventHandler([handler])
    expect(out).not.toContain('setDocState')
  })
})
