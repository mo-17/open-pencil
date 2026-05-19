import { describe, expect, test } from 'bun:test'

import { emitElement } from '@open-pencil/compiler/adapters/react/emit-element'
import type { IRElement, IRNode } from '@open-pencil/compiler/ir/types'

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

describe('emitElement (React adapter)', () => {
  test('self-closes empty element', () => {
    const out = emitElement(element({ tag: 'div', className: 'p-4' }), 0)
    expect(out).toBe('<div className="p-4" />')
  })

  test('self-closes void tag even with children', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox' },
        children: [{ kind: 'text', value: 'ignored' } as IRNode]
      }),
      0
    )
    expect(out).toBe('<input type="checkbox" />')
  })

  test('inlines single text child', () => {
    const out = emitElement(
      element({
        tag: 'button',
        attrs: { type: 'button' },
        children: [{ kind: 'text', value: 'Click me' }]
      }),
      0
    )
    expect(out).toBe('<button type="button">Click me</button>')
  })

  test('block form for multi-child element with two-space indent', () => {
    const out = emitElement(
      element({
        tag: 'div',
        children: [
          element({ tag: 'p', children: [{ kind: 'text', value: 'A' }] }),
          element({ tag: 'p', children: [{ kind: 'text', value: 'B' }] })
        ]
      }),
      0
    )
    expect(out).toBe(['<div>', '  <p>A</p>', '  <p>B</p>', '</div>'].join('\n'))
  })

  test('escapes attribute and text', () => {
    const out = emitElement(
      element({
        tag: 'p',
        attrs: { 'data-q': 'he said "hi" & ran' },
        children: [{ kind: 'text', value: 'a < b > c & {x}' }]
      }),
      0
    )
    expect(out).toContain('data-q="he said &quot;hi&quot; &amp; ran"')
    expect(out).toContain('a &lt; b &gt; c &amp; &#123;x&#125;')
  })

  test('renders numeric and boolean attrs as JSX expressions', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox', defaultChecked: true, tabIndex: -1 }
      }),
      0
    )
    expect(out).toContain('type="checkbox"')
    expect(out).toContain('defaultChecked')
    expect(out).toContain('tabIndex={-1}')
  })

  test('indents nested children correctly', () => {
    const out = emitElement(
      element({
        tag: 'form',
        children: [
          element({ tag: 'input', attrs: { placeholder: 'Name' } }),
          element({
            tag: 'button',
            attrs: { type: 'submit' },
            children: [{ kind: 'text', value: 'OK' }]
          })
        ]
      }),
      2
    )
    expect(out).toBe(
      [
        '    <form>',
        '      <input placeholder="Name" />',
        '      <button type="submit">OK</button>',
        '    </form>'
      ].join('\n')
    )
  })
})
