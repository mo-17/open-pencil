import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'
import type { ExprAst } from '@open-pencil/core/lowcode-validation'

/**
 * Phase 3 §10 v9 — result-branch sub-workflows on the API actions
 * (apiCall / supabaseQuery / supabaseMutation). This closes the
 * "button → call API → branch on the result → toast" loop that was impossible
 * before (apiCall had no failure signal; a following `condition` read a stale
 * render snapshot of docState). `onSuccess` / `onError` run inside the try
 * success path / catch arm where `data` / `error` are fresh locals.
 *
 * Branch-less + capture-less calls stay byte-identical to the §2 output —
 * covered by the existing api-call / supabase emit suites.
 */
function staticUrl(s: string): ExprAst {
  return { kind: 'template', quasis: [s], expressions: [] }
}

function toast(value: string, variant: 'info' | 'success' | 'error'): IREventHandler {
  return { kind: 'toast', ast: { kind: 'string', value }, references: [], variant }
}

describe('emit API result branches (Phase 3 §10 v9)', () => {
  test('apiCall with onSuccess/onError → res.ok guard + success toast + catch toast', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: staticUrl('https://x.test/save'),
      body: undefined,
      docStateName: 'result',
      onSuccess: [toast('Saved', 'success')],
      onError: [toast('Failed', 'error')]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('const data = await res.json();')
    // non-2xx is now a failure → routes to catch.
    expect(out).toContain('if (!res.ok) throw data;')
    // success branch: store then toast.
    expect(out).toContain('setDocState("result", data); __opToast("Saved", "success");')
    // error branch: console.error then toast, inside the catch.
    expect(out).toContain('console.error("apiCall failed:", err); __opToast("Failed", "error");')
  })

  test('apiCall errorTarget → setDocState(err) in the catch (parity with supabase)', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: staticUrl('https://x.test/save'),
      body: undefined,
      docStateName: 'result',
      errorTarget: 'lastError',
      onError: [toast('Failed', 'error')]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'catch (err) { const error = err; setDocState("lastError", err); console.error("apiCall failed:", err); __opToast("Failed", "error"); }'
    )
  })

  test('apiCall onSuccess only → still adds res.ok guard, no error tail', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: staticUrl('https://x.test/save'),
      body: undefined,
      docStateName: 'result',
      onSuccess: [toast('OK', 'info')]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('if (!res.ok) throw data;')
    expect(out).toContain('setDocState("result", data); __opToast("OK");')
    // catch has no error tail (no onError), just the logged failure.
    expect(out).toContain(
      'catch (err) { const error = err; console.error("apiCall failed:", err); }'
    )
  })

  test('supabaseMutation with onSuccess/onError → toast in else / if(error) arms', () => {
    const handler: IREventHandler = {
      kind: 'supabaseMutation',
      operation: 'insert',
      table: 'users',
      payload: '{"name":"Alice"}',
      filters: [],
      resultTarget: 'created',
      onSuccess: [toast('Created', 'success')],
      onError: [toast('Oops', 'error')]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'if (error) { console.error("supabase request failed:", error); __opToast("Oops", "error"); }'
    )
    expect(out).toContain('else { setDocState("created", data); __opToast("Created", "success"); }')
  })

  test('supabaseQuery onSuccess with no resultTarget still gets an else arm', () => {
    const handler: IREventHandler = {
      kind: 'supabaseQuery',
      table: 'users',
      columns: '*',
      filters: [],
      single: false,
      resultTarget: 'rows',
      onSuccess: [toast('Loaded', 'info')]
    }
    const out = emitEventHandler([handler])
    expect(out).toContain('else { setDocState("rows", data); __opToast("Loaded"); }')
  })

  test('nested apiCall inside onSuccess → both awaited in the single async arrow', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: staticUrl('https://x.test/a'),
      body: undefined,
      docStateName: 'a',
      onSuccess: [
        {
          kind: 'apiCall',
          method: 'GET',
          url: staticUrl('https://x.test/b'),
          body: undefined,
          docStateName: 'b'
        }
      ]
    }
    const out = emitEventHandler([handler])
    expect(out.startsWith('async () =>')).toBe(true)
    // the nested call's own try/catch is spliced into the outer success path.
    expect(out).toContain(
      'setDocState("a", data); try { const res = await fetch("https://x.test/b")'
    )
  })
})
