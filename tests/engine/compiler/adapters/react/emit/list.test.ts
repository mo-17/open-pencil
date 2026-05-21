import { describe, expect, test } from 'bun:test'

import { emitElement } from '@open-pencil/compiler/adapters/react/emit/element'
import type {
  IRConditional,
  IRElement,
  IRList,
  IRNode
} from '@open-pencil/compiler/ir/types'

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

function list(overrides: Partial<IRList> & { template: IRNode }): IRList {
  return {
    kind: 'list',
    arrayName: overrides.arrayName ?? 'users',
    itemName: overrides.itemName ?? 'item',
    indexName: overrides.indexName ?? 'index',
    template: overrides.template
  }
}

/**
 * Phase 2 §9 — emit form for IRList. Decision §9.2 #9 fixes the shape as
 * `{(<arr>).map((<item>, <index>) => (<template>))}`; decision #5 fixes
 * the per-iteration key to `key={<indexName>}`, injected into the
 * template's first JSX opening tag so it lands on the outermost element
 * React sees per iteration.
 */
describe('emitElement — IRList (Phase 2 §9)', () => {
  test('emits .map with `key={index}` injected into the template root tag', () => {
    const tpl = element({
      tag: 'div',
      children: [
        element({
          tag: 'p',
          children: [
            {
              kind: 'expression',
              ast: { kind: 'member', object: { kind: 'ident', name: 'item' }, property: 'name' },
              references: ['item']
            }
          ]
        })
      ]
    })
    const out = emitElement(list({ template: tpl }), 0)
    expect(out).toContain('(users).map((item, index) => (')
    expect(out).toContain('<div key={index}>')
    expect(out).toContain('<p>{item.name}</p>')
    // Only the outer tag receives the injected key; inner tags stay clean.
    expect(out.match(/key=\{index\}/g)?.length).toBe(1)
  })

  test('custom itemName / indexName flow into the .map signature and key expr', () => {
    const tpl = element({
      tag: 'div',
      children: [
        {
          kind: 'expression',
          ast: { kind: 'ident', name: 'user' },
          references: ['user']
        }
      ]
    })
    const out = emitElement(
      list({ arrayName: 'people', itemName: 'user', indexName: 'i', template: tpl }),
      0
    )
    expect(out).toContain('(people).map((user, i) => (')
    expect(out).toContain('<div key={i}>')
  })

  test('IRList wrapped by an IRConditional emits `&&` outside the `.map`', () => {
    const tpl = element({ tag: 'div', children: [{ kind: 'text', value: 'row' }] })
    const wrapped: IRConditional = {
      kind: 'conditional',
      ast: { kind: 'ident', name: 'flag' },
      references: ['flag'],
      consequent: list({ template: tpl })
    }
    const out = emitElement(wrapped, 0)
    // Outer && wrapper.
    expect(out).toContain('{(flag) && (')
    // Inner .map.
    expect(out).toContain('(users).map((item, index) => (')
    // Key still on the template element.
    expect(out).toContain('<div key={index}>')
  })

  test('IRList whose template is itself an IRConditional puts key on the inner element', () => {
    const inner = element({
      tag: 'p',
      children: [
        {
          kind: 'expression',
          ast: { kind: 'member', object: { kind: 'ident', name: 'item' }, property: 'name' },
          references: ['item']
        }
      ]
    })
    const conditionalTemplate: IRConditional = {
      kind: 'conditional',
      ast: {
        kind: 'member',
        object: { kind: 'ident', name: 'item' },
        property: 'active'
      },
      references: ['item'],
      consequent: inner
    }
    const out = emitElement(list({ template: conditionalTemplate }), 0)
    expect(out).toContain('(users).map((item, index) => (')
    // `&&` lives inside the .map callback.
    expect(out).toContain('{(item.active) && (')
    // Key on the inner element, not the outer conditional shell.
    expect(out).toContain('<p key={index}>')
  })

  test('respects indent: leading pad matches the requested level', () => {
    const tpl = element({ tag: 'div', children: [] })
    const out = emitElement(list({ template: tpl }), 3)
    expect(out.startsWith('      {(users).map((item, index) => (')).toBe(true)
  })
})
