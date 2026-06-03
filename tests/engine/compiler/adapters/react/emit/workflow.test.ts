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

/**
 * Phase 3 §10 v2 — toast emit. `__opToast(<message>, <variant?>)`; the variant
 * arg is omitted for the default `info`. A lone toast is a simple statement
 * (brace-less arrow); toast is synchronous (never forces async).
 */
describe('emit toast handlers (Phase 3 §10 v2)', () => {
  test('a lone info toast is a brace-less, synchronous arrow with no variant arg', () => {
    const out = emitEventHandler([
      { kind: 'toast', ast: { kind: 'string', value: 'Saved' }, references: [], variant: 'info' }
    ])
    expect(out).toBe('() => __opToast("Saved")')
  })

  test('a non-info toast passes the variant as the second arg', () => {
    const out = emitEventHandler([
      { kind: 'toast', ast: { kind: 'string', value: 'Saved' }, references: [], variant: 'success' }
    ])
    expect(out).toBe('() => __opToast("Saved", "success")')
  })

  test('the toast message can interpolate a state/docState expression', () => {
    const out = emitEventHandler([
      { kind: 'toast', ast: member('currentUser', 'name'), references: ['currentUser'], variant: 'error' }
    ])
    expect(out).toBe('() => __opToast(currentUser.name, "error")')
  })

  test('a toast in a block gets a trailing semicolon and stays sync', () => {
    const out = emitEventHandler([
      { kind: 'setVariable', docStateName: 'saved', ast: { kind: 'string', value: 'yes' }, references: [], mode: 'absolute' },
      { kind: 'toast', ast: { kind: 'string', value: 'Done' }, references: [], variant: 'info' }
    ])
    expect(out).toBe('() => { setDocState("saved", "yes"); __opToast("Done"); }')
    expect(out.startsWith('async')).toBe(false)
  })

  test('a toast nested in a condition branch still emits', () => {
    const out = emitEventHandler([
      {
        kind: 'condition',
        condAst: member('res', 'ok'),
        references: ['res'],
        consequent: [
          { kind: 'toast', ast: { kind: 'string', value: 'OK' }, references: [], variant: 'success' }
        ]
      }
    ])
    expect(out).toContain('if (res.ok) { __opToast("OK", "success"); }')
  })
})

/**
 * Phase 3 §10 v3 — confirm + clipboard emit. `confirm` is a `condition` whose
 * predicate is `await __opConfirm(<msg>)`, so it always forces `async` and
 * lowers its branches like condition. `clipboard` is a synchronous,
 * fire-and-forget `navigator.clipboard.writeText(<value>)`.
 */
describe('emit confirm + clipboard handlers (Phase 3 §10 v3)', () => {
  test('confirm emits an awaited __opConfirm guard with both branches and forces async', () => {
    const out = emitEventHandler([
      {
        kind: 'confirm',
        ast: { kind: 'string', value: 'Delete?' },
        references: [],
        consequent: [{ kind: 'navigate', to: '/gone' }],
        alternate: [{ kind: 'toast', ast: { kind: 'string', value: 'Kept' }, references: [], variant: 'info' }]
      }
    ])
    expect(out).toBe(
      'async () => { if (await __opConfirm("Delete?")) { navigate("/gone"); } else { __opToast("Kept"); } }'
    )
  })

  test('confirm with no cancel branch omits the else arm', () => {
    const out = emitEventHandler([
      {
        kind: 'confirm',
        ast: { kind: 'string', value: 'Sure?' },
        references: [],
        consequent: [{ kind: 'stop' }]
      }
    ])
    expect(out).toBe('async () => { if (await __opConfirm("Sure?")) { return; } }')
    expect(out).not.toContain('else')
  })

  test('confirm message can interpolate a state/docState expression', () => {
    const out = emitEventHandler([
      {
        kind: 'confirm',
        ast: member('row', 'name'),
        references: ['row'],
        consequent: [{ kind: 'navigate', to: '/x' }]
      }
    ])
    expect(out).toContain('if (await __opConfirm(row.name)) {')
  })

  test('a lone clipboard copy is a brace-less, synchronous arrow', () => {
    const out = emitEventHandler([
      { kind: 'clipboard', ast: { kind: 'string', value: 'hello' }, references: [] }
    ])
    expect(out).toBe('() => navigator.clipboard.writeText("hello")')
  })

  test('clipboard value can interpolate an expression and stays sync in a block', () => {
    const out = emitEventHandler([
      { kind: 'clipboard', ast: member('currentUser', 'email'), references: ['currentUser'] },
      { kind: 'toast', ast: { kind: 'string', value: 'Copied' }, references: [], variant: 'success' }
    ])
    expect(out).toBe(
      '() => { navigator.clipboard.writeText(currentUser.email); __opToast("Copied", "success"); }'
    )
    expect(out.startsWith('async')).toBe(false)
  })

  test('a clipboard nested in a confirm branch still emits and forces async', () => {
    const out = emitEventHandler([
      {
        kind: 'confirm',
        ast: { kind: 'string', value: 'Copy?' },
        references: [],
        consequent: [{ kind: 'clipboard', ast: { kind: 'string', value: 'x' }, references: [] }]
      }
    ])
    expect(out).toBe(
      'async () => { if (await __opConfirm("Copy?")) { navigator.clipboard.writeText("x"); } }'
    )
  })
})
