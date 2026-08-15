import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'
import type { ExprAst } from '@open-pencil/lowcode'

/**
 * Phase 2 §3 step 2 — `apiCall` handler emit. Phase 2 §4 — the `url` field
 * is a template AST: a static URL emits as a double-quoted string
 * (byte-identical to §3), an interpolated one as a backtick template.
 *
 * An apiCall `await`s `fetch`, so the arrow becomes `async` and its body is
 * a `try/catch` block. The handler is never given a trailing `;` and always
 * forces the brace-wrapped form, even as the sole handler.
 */

/** A static URL — a degenerate zero-expression template (Phase 2 §4). */
function staticURL(s: string): ExprAst {
  return { kind: 'template', quasis: [s], expressions: [] }
}

const GET_HANDLER: IREventHandler = {
  kind: 'apiCall',
  method: 'GET',
  url: staticURL('https://x.test/users'),
  body: undefined,
  docStateName: 'users'
}

describe('emit apiCall handler (Phase 2 §3)', () => {
  test('GET → async arrow, fetch + json + setDocState in try/catch', () => {
    expect(emitEventHandler([GET_HANDLER])).toBe(
      'async () => { try { ' +
        'const res = await fetch("https://x.test/users"); ' +
        'const data = await res.json(); ' +
        'setDocState("users", data) ' +
        '} catch (err) { console.error("apiCall failed:", err) } }'
    )
  })

  test('POST with body → fetch init carries method, headers, JSON.stringify body', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'POST',
      url: staticURL('https://x.test/users'),
      body: '{"name":"Alice"}',
      docStateName: 'users'
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'await fetch("https://x.test/users", { method: "POST", ' +
        'headers: { "Content-Type": "application/json" }, ' +
        'body: JSON.stringify({"name":"Alice"}) })'
    )
    expect(out.startsWith('async () => {')).toBe(true)
  })

  test('POST with no body → fetch init has method + headers, no body field', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'POST',
      url: staticURL('https://x.test'),
      body: undefined,
      docStateName: 'users'
    }
    const out = emitEventHandler([handler])
    expect(out).toContain(
      'await fetch("https://x.test", { method: "POST", ' +
        'headers: { "Content-Type": "application/json" } })'
    )
    expect(out).not.toContain('body:')
  })

  test('Phase 2 §4 — interpolated GET url emits a backtick template', () => {
    const handler: IREventHandler = {
      kind: 'apiCall',
      method: 'GET',
      url: {
        kind: 'template',
        quasis: ['https://x.test/users/', ''],
        expressions: [{ kind: 'ident', name: 'userId' }]
      },
      body: undefined,
      docStateName: 'user'
    }
    expect(emitEventHandler([handler])).toContain(
      'const res = await fetch(`https://x.test/users/${userId}`);'
    )
  })

  test('Phase 2 §4 — static url stays a double-quoted string (§3 byte-identical)', () => {
    expect(emitEventHandler([GET_HANDLER])).toContain('await fetch("https://x.test/users");')
  })

  test('sole apiCall is still brace-wrapped (try/catch is a block statement)', () => {
    expect(emitEventHandler([GET_HANDLER]).startsWith('async () => { try {')).toBe(true)
  })

  test('apiCall mixed with a sync setState → async arrow, both statements kept in order', () => {
    const setState: IREventHandler = {
      kind: 'setState',
      stateName: 'count',
      ast: { kind: 'number', value: 0 },
      references: [],
      mode: 'absolute'
    }
    const out = emitEventHandler([setState, GET_HANDLER])
    expect(out.startsWith('async () => {')).toBe(true)
    // setState is an expression statement → trailing `;`; apiCall is a block.
    expect(out).toContain('setCount(0); try {')
    expect(out).toContain('console.error("apiCall failed:", err) } }')
  })

  test('a pure-sync handler list stays a plain (non-async) arrow', () => {
    const setState: IREventHandler = {
      kind: 'setState',
      stateName: 'count',
      ast: { kind: 'number', value: 1 },
      references: [],
      mode: 'absolute'
    }
    expect(emitEventHandler([setState])).toBe('() => setCount(1)')
  })
})
