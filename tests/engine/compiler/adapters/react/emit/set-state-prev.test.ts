import { describe, expect, test } from 'bun:test'

import { emitEventHandler } from '@open-pencil/compiler/adapters/react/emit/event'
import type { IREventHandler } from '@open-pencil/compiler/ir/types'

/**
 * Phase 2 §2 — setState handlers now carry `mode: 'absolute' | 'functional'`.
 * Functional mode emits `setX((prev) => …)` matching React's idiomatic
 * `setState` updater; absolute mode preserves the Phase 1 §7.4 shape so
 * existing demos / .fig files remain byte-stable.
 */
describe('emit setState handler — absolute vs functional (Phase 2 §2)', () => {
  test('absolute mode (Phase 1 regression): setX(<expr>)', () => {
    const handler: IREventHandler = {
      kind: 'setState',
      stateName: 'count',
      ast: {
        kind: 'binary',
        op: '+',
        left: { kind: 'ident', name: 'count' },
        right: { kind: 'number', value: 1 }
      },
      references: ['count'],
      mode: 'absolute'
    }
    expect(emitEventHandler([handler])).toBe('() => setCount(count + 1)')
  })

  test('functional mode: setX((prev) => prev + 1)', () => {
    const handler: IREventHandler = {
      kind: 'setState',
      stateName: 'count',
      ast: {
        kind: 'binary',
        op: '+',
        left: { kind: 'ident', name: 'prev' },
        right: { kind: 'number', value: 1 }
      },
      references: [],
      mode: 'functional'
    }
    expect(emitEventHandler([handler])).toBe('() => setCount((prev) => prev + 1)')
  })

  test('functional mode handles boolean toggle: setX((prev) => !prev)', () => {
    const handler: IREventHandler = {
      kind: 'setState',
      stateName: 'flag',
      ast: {
        kind: 'unary',
        op: '!',
        arg: { kind: 'ident', name: 'prev' }
      },
      references: [],
      mode: 'functional'
    }
    expect(emitEventHandler([handler])).toBe('() => setFlag((prev) => !prev)')
  })

  test('functional mode mixed with a state ref still works', () => {
    const handler: IREventHandler = {
      kind: 'setState',
      stateName: 'count',
      ast: {
        kind: 'binary',
        op: '+',
        left: { kind: 'ident', name: 'prev' },
        right: { kind: 'ident', name: 'step' }
      },
      references: ['step'],
      mode: 'functional'
    }
    expect(emitEventHandler([handler])).toBe('() => setCount((prev) => prev + step)')
  })

  test('multiple statements: absolute setState + functional setVariable in one onClick', () => {
    const handlers: IREventHandler[] = [
      {
        kind: 'setState',
        stateName: 'count',
        ast: {
          kind: 'binary',
          op: '+',
          left: { kind: 'ident', name: 'count' },
          right: { kind: 'number', value: 1 }
        },
        references: ['count'],
        mode: 'absolute'
      },
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
      }
    ]
    expect(emitEventHandler(handlers)).toBe(
      '() => { setCount(count + 1); setDocState("cartCount", (prev) => prev + 1); }'
    )
  })
})
