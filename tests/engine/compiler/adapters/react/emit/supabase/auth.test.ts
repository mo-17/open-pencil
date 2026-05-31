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
 *
 * Phase 3 §2.v4 step 2 — resetPassword emits `resetPasswordForEmail(email,
 * { redirectTo: window.location.origin })` (email-only); updatePassword emits
 * `updateUser({ password })` (password-only). Both destructure `{ error }`.
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

  test('resetPassword emits resetPasswordForEmail with redirectTo origin (email-only)', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'resetPassword',
      emailAst: ident('emailInput'),
      references: ['emailInput']
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'const { error } = await getSupabaseClient().auth.resetPasswordForEmail(emailInput, { redirectTo: window.location.origin });'
    )
    expect(out).toContain('console.error("resetPassword failed:", error)')
    expect(out).not.toContain('password')
  })

  test('updatePassword emits updateUser with the new password (password-only)', () => {
    const handler: IREventHandler = {
      kind: 'supabaseAuth',
      operation: 'updatePassword',
      passwordAst: ident('newPasswordInput'),
      references: ['newPasswordInput']
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'const { error } = await getSupabaseClient().auth.updateUser({ password: newPasswordInput });'
    )
    expect(out).toContain('console.error("updatePassword failed:", error)')
    expect(out).not.toContain('resetPasswordForEmail')
    expect(out).not.toContain('email')
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
