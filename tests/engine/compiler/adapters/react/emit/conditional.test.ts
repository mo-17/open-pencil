import { describe, expect, test } from 'bun:test'

import { emitElement } from '@open-pencil/compiler/adapters/react/emit/element'
import type { IRConditional, IRElement, IRNode } from '@open-pencil/compiler/ir/types'

function element(overrides: Partial<IRElement> & { tag: string }): IRElement {
  return {
    kind: 'element',
    sourceId: 'n1',
    tag: overrides.tag,
    className: overrides.className ?? '',
    attrs: overrides.attrs ?? {},
    children: overrides.children ?? []
  }
}

function conditional(astSource: 'ident' | 'binaryGt', consequent: IRNode): IRConditional {
  if (astSource === 'ident') {
    return {
      kind: 'conditional',
      ast: { kind: 'ident', name: 'flag' },
      references: ['flag'],
      consequent
    }
  }
  return {
    kind: 'conditional',
    ast: {
      kind: 'binary',
      op: '>',
      left: { kind: 'ident', name: 'count' },
      right: { kind: 'number', value: 0 }
    },
    references: ['count'],
    consequent
  }
}

/**
 * Phase 2 §9 — emit form for IRConditional. Decision §9.2 #9 fixes the
 * shape as `{(<expr>) && (<consequent>)}` with the consequent on its own
 * line so multi-line subtrees stay readable.
 */
describe('emitElement — IRConditional (Phase 2 §9)', () => {
  test('simple ident condition wraps the consequent with `&& (...)`', () => {
    const out = emitElement(
      conditional('ident', element({ tag: 'div', children: [{ kind: 'text', value: 'shown' }] })),
      0
    )
    expect(out).toBe('{(flag) && (\n  <div>shown</div>\n)}')
  })

  test('binary condition emits the parsed expression verbatim', () => {
    const out = emitElement(
      conditional('binaryGt', element({ tag: 'p', children: [{ kind: 'text', value: 'big' }] })),
      0
    )
    expect(out).toContain('{(count > 0) && (')
    expect(out).toContain('<p>big</p>')
  })

  test('nested conditional: parent wraps consequent that itself is a conditional', () => {
    const inner = conditional(
      'ident',
      element({ tag: 'span', children: [{ kind: 'text', value: 'inner' }] })
    )
    const outer = conditional('binaryGt', element({ tag: 'div', children: [inner] }))
    const out = emitElement(outer, 0)
    // Outer `&&` shell present.
    expect(out).toContain('{(count > 0) && (')
    // Inner `&&` shell nested inside the outer's consequent.
    expect(out).toContain('{(flag) && (')
    // Inner element survives.
    expect(out).toContain('<span>inner</span>')
  })

  test('respects indent so the nested form lands inside the parent', () => {
    const out = emitElement(
      conditional('ident', element({ tag: 'div', children: [{ kind: 'text', value: 'shown' }] })),
      2
    )
    expect(out.startsWith('    {(flag) && (')).toBe(true)
  })
})
