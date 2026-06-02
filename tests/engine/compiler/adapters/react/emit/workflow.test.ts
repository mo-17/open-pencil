import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'

/**
 * Phase 3 §10 — workflow-orchestration emit: `condition` (if/else over nested
 * branches), `delay` (timed await), `stop` (early return). Verifies async
 * propagation (an awaiting handler at any nesting depth forces `async`),
 * statement vs block shaping, and trailing-semicolon rules.
 */
function ident(name: string): ExprAst {
  return { kind: 'ident', name }
}

function member(object: string, property: string): ExprAst {
  return { kind: 'member', object: ident(object), property }
}

describe('emit workflow handlers (Phase 3 §10)', () => {
  test('condition emits if/else with both branches; sync branches stay non-async', () => {
    const handler: IREventHandler = {
      kind: 'condition',
      condAst: ident('isOpen'),
      references: ['isOpen'],
      consequent: [{ kind: 'navigate', to: '/open' }],
      alternate: [{ kind: 'navigate', to: '/closed' }]
    }
    const out = emitEventHandler([handler])
    expect(out).toBe('() => { if (isOpen) { navigate("/open"); } else { navigate("/closed"); } }')
    expect(out.startsWith('async')).toBe(false)
  })

  test('condition with no else omits the else arm', () => {
    const handler: IREventHandler = {
      kind: 'condition',
      condAst: member('res', 'error'),
      references: ['res'],
      consequent: [{ kind: 'stop' }]
    }
    const out = emitEventHandler([handler])
    expect(out).toBe('() => { if (res.error) { return; } }')
    expect(out).not.toContain('else')
  })

  test('condition is async when a nested branch awaits', () => {
    const handler: IREventHandler = {
      kind: 'condition',
      condAst: ident('go'),
      references: ['go'],
      consequent: [{ kind: 'delay', ms: 250 }]
    }
    const out = emitEventHandler([handler])
    expect(out.startsWith('async () =>')).toBe(true)
    expect(out).toContain('if (go) { await new Promise((resolve) => setTimeout(resolve, 250)); }')
  })

  test('delay emits an awaited setTimeout promise and forces async', () => {
    const out = emitEventHandler([{ kind: 'delay', ms: 500 }])
    expect(out).toBe('async () => { await new Promise((resolve) => setTimeout(resolve, 500)); }')
  })

  test('stop alone emits a returning arrow (brace-wrapped, never bare)', () => {
    const out = emitEventHandler([{ kind: 'stop' }])
    expect(out).toBe('() => { return; }')
  })

  test('multi-step workflow: query → condition(stop / setState+delay)', () => {
    const handlers: IREventHandler[] = [
      {
        kind: 'supabaseQuery',
        table: 'profiles',
        columns: '*',
        filters: [],
        single: true,
        resultTarget: 'profile'
      },
      {
        kind: 'condition',
        condAst: member('profile', 'error'),
        references: ['profile'],
        consequent: [{ kind: 'stop' }],
        alternate: [
          {
            kind: 'setVariable',
            docStateName: 'loaded',
            ast: { kind: 'string', value: 'yes' },
            references: [],
            mode: 'absolute'
          },
          { kind: 'delay', ms: 100 }
        ]
      }
    ]
    const out = emitEventHandler(handlers)
    expect(out.startsWith('async () => {')).toBe(true)
    // supabase block is a complete statement (no trailing ; added)
    expect(out).toContain('const { data, error } = await getSupabaseClient().from("profiles")')
    // condition block follows, then-branch stops, else-branch sets + delays
    expect(out).toContain('if (profile.error) { return; } else {')
    expect(out).toContain('setDocState("loaded", "yes");')
    expect(out).toContain('await new Promise((resolve) => setTimeout(resolve, 100));')
  })
})
