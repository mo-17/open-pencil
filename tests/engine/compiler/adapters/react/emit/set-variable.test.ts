import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'

/**
 * Phase 2 §2 — `setVariable` handlers emit `setDocState('name', value)` for
 * absolute mode and `setDocState('name', (prev) => …)` for functional mode.
 * The collector substitutes `$prev` → `prev` in the AST, so the emit step
 * just splices the AST verbatim into the callback body.
 */
describe('emit setVariable handler (Phase 2 §2)', () => {
  test('absolute mode: literal value', () => {
    const handler: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'cartCount',
      ast: { kind: 'number', value: 5 },
      references: [],
      mode: 'absolute'
    }
    expect(emitEventHandler([handler])).toBe('() => setDocState("cartCount", 5)')
  })

  test('absolute mode: identifier value (e.g. another state ref)', () => {
    const handler: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'cartCount',
      ast: { kind: 'ident', name: 'pageStep' },
      references: ['pageStep'],
      mode: 'absolute'
    }
    expect(emitEventHandler([handler])).toBe('() => setDocState("cartCount", pageStep)')
  })

  test('functional mode: `prev + 1`', () => {
    const handler: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'cartCount',
      ast: {
        kind: 'binary',
        op: '+',
        left: { kind: 'ident', name: 'prev' },
        right: { kind: 'number', value: 1 }
      },
      references: [],
      mode: 'functional'
    }
    expect(emitEventHandler([handler])).toBe('() => setDocState("cartCount", (prev) => prev + 1)')
  })

  test('functional mode mixed with state ref: `prev + step`', () => {
    const handler: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'cartCount',
      ast: {
        kind: 'binary',
        op: '+',
        left: { kind: 'ident', name: 'prev' },
        right: { kind: 'ident', name: 'step' }
      },
      references: ['step'],
      mode: 'functional'
    }
    expect(emitEventHandler([handler])).toBe(
      '() => setDocState("cartCount", (prev) => prev + step)'
    )
  })

  test('docStateName is JSON-escaped (quotes / backslashes safe)', () => {
    // Names always pass `validateStateName` upstream so a real quote is
    // unreachable, but JSON.stringify guarantees the escape is correct if
    // the validator ever loosens.
    const handler: IREventHandler = {
      kind: 'setVariable',
      docStateName: 'has"quote',
      ast: { kind: 'number', value: 1 },
      references: [],
      mode: 'absolute'
    }
    expect(emitEventHandler([handler])).toBe('() => setDocState("has\\"quote", 1)')
  })

  test('multiple handlers in one onClick — block form', () => {
    const handlers: IREventHandler[] = [
      {
        kind: 'setVariable',
        docStateName: 'cartCount',
        ast: {
          kind: 'binary',
          op: '+',
          left: { kind: 'ident', name: 'prev' },
          right: { kind: 'number', value: 1 }
        },
        references: [],
        mode: 'functional'
      },
      {
        kind: 'setVariable',
        docStateName: 'isLoggedIn',
        ast: { kind: 'ident', name: 'true' }, // identifier "true"
        references: ['true'],
        mode: 'absolute'
      }
    ]
    const out = emitEventHandler(handlers)
    expect(out).toBe(
      '() => { setDocState("cartCount", (prev) => prev + 1); setDocState("isLoggedIn", true); }'
    )
  })
})
