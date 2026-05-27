import { describe, expect, test } from 'bun:test'

import { emitElement } from '@open-pencil/compiler/adapters/react/emit/element'
import type { IRElement, IRNode } from '@open-pencil/compiler/ir/types'

function element(overrides: Partial<IRElement> & { tag: string }): IRElement {
  return {
    kind: 'element',
    sourceId: 'n1',
    tag: overrides.tag,
    className: overrides.className ?? '',
    attrs: overrides.attrs ?? {},
    children: overrides.children ?? [],
    ...(overrides.events ? { events: overrides.events } : {}),
    ...(overrides.controlled ? { controlled: overrides.controlled } : {})
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

  // Phase 3 §3.x: controlled INPUT emission. The `controlled` IR field
  // expands to a two-way bound input — `value={read}` plus a synthesized
  // `onChange` writer. docState writes call the lowcode runtime
  // `setDocState('name', e.target.value)`; page-state writes call the
  // `useState` setter `setName(e.target.value)`.
  test('controlled INPUT (docState string) emits value + setDocState onChange', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { placeholder: 'Enter text' },
        controlled: {
          read: 'formId',
          write: { kind: 'docState', name: 'formId', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input placeholder="Enter text" value={formId} onChange={(e) => setDocState("formId", e.target.value)} />`
    )
  })

  test('controlled INPUT (page-state ref string) emits value + useState setter onChange', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { placeholder: 'Search' },
        controlled: {
          read: 'query',
          write: { kind: 'state', name: 'query', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />`
    )
  })

  test('controlled INPUT (docState number) emits type=number + Number() coercion', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: {},
        controlled: {
          read: 'age',
          write: { kind: 'docState', name: 'age', targetType: 'number' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="number" value={age} onChange={(e) => setDocState("age", Number(e.target.value))} />`
    )
  })

  test('controlled INPUT (page-state ref number) emits type=number + Number() coercion', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: {},
        controlled: {
          read: 'qty',
          write: { kind: 'state', name: 'qty', targetType: 'number' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} />`
    )
  })

  // Phase 3 §3.v4: 6 new controlled component types share the same
  // `controlled` IR field but dispatch on attrs.type / targetType inside
  // formatAttrs. boolean targetType (CHECKBOX/SWITCH) → checked + e.target.checked;
  // type=radio → checked={read === <opt>} + shared onChange;
  // SELECT/TEXTAREA/DATEPICKER all share the string text-like branch.
  test('controlled CHECKBOX (boolean docState) emits checked + e.target.checked', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox' },
        controlled: {
          read: 'agreed',
          write: { kind: 'docState', name: 'agreed', targetType: 'boolean' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="checkbox" checked={agreed} onChange={(e) => setDocState("agreed", e.target.checked)} />`
    )
  })

  test('controlled SWITCH (boolean docState) — role attr preserved, checked + setDocState', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox', role: 'switch' },
        controlled: {
          read: 'dark',
          write: { kind: 'docState', name: 'dark', targetType: 'boolean' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="checkbox" role="switch" checked={dark} onChange={(e) => setDocState("dark", e.target.checked)} />`
    )
  })

  test('controlled CHECKBOX (page-state ref boolean) uses setter not setDocState', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox' },
        controlled: {
          read: 'remember',
          write: { kind: 'state', name: 'remember', targetType: 'boolean' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />`
    )
  })

  test('controlled TEXTAREA (docState string) emits value + e.target.value', () => {
    const out = emitElement(
      element({
        tag: 'textarea',
        attrs: { placeholder: 'Bio' },
        controlled: {
          read: 'bio',
          write: { kind: 'docState', name: 'bio', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<textarea placeholder="Bio" value={bio} onChange={(e) => setDocState("bio", e.target.value)} />`
    )
  })

  test('controlled SELECT (docState string) emits value + setDocState onChange', () => {
    const out = emitElement(
      element({
        tag: 'select',
        attrs: {},
        controlled: {
          read: 'country',
          write: { kind: 'docState', name: 'country', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<select value={country} onChange={(e) => setDocState("country", e.target.value)} />`
    )
  })

  test('controlled DATEPICKER (docState string) preserves type=date (no type=number injection)', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'date' },
        controlled: {
          read: 'dob',
          write: { kind: 'docState', name: 'dob', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="date" value={dob} onChange={(e) => setDocState("dob", e.target.value)} />`
    )
  })

  test('controlled RADIO option emits checked={read === <opt>} + shared setter', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'radio', name: 'g', value: 'M' },
        controlled: {
          read: 'gender',
          write: { kind: 'docState', name: 'gender', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="radio" name="g" value="M" checked={gender === "M"} onChange={(e) => setDocState("gender", e.target.value)} />`
    )
  })

  test('controlled RADIO option with page-state ref uses useState setter', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'radio', name: 'g', value: 'F' },
        controlled: {
          read: 'gender',
          write: { kind: 'state', name: 'gender', targetType: 'string' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="radio" name="g" value="F" checked={gender === "F"} onChange={(e) => setGender(e.target.value)} />`
    )
  })

  // Phase 3 §3.v4 step 8 — CHECKBOX group (multi-select array binding).
  // Each per-option <input type="checkbox"> emits `checked={read.includes(opt)}`
  // and `onChange={(e) => write(e.target.checked ? [...read, opt] : read.filter(...))}`.
  test('controlled CHECKBOX group option (docState array) emits includes + toggle', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox', value: 'Apple' },
        controlled: {
          read: 'fruits',
          write: { kind: 'docState', name: 'fruits', targetType: 'array' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="checkbox" value="Apple" checked={fruits.includes("Apple")} onChange={(e) => setDocState("fruits", e.target.checked ? [...fruits, "Apple"] : fruits.filter((v) => v !== "Apple"))} />`
    )
  })

  test('controlled CHECKBOX group option (page-state array) uses useState setter', () => {
    const out = emitElement(
      element({
        tag: 'input',
        attrs: { type: 'checkbox', value: 'Banana' },
        controlled: {
          read: 'picks',
          write: { kind: 'state', name: 'picks', targetType: 'array' }
        }
      }),
      0
    )
    expect(out).toBe(
      `<input type="checkbox" value="Banana" checked={picks.includes("Banana")} onChange={(e) => setPicks(e.target.checked ? [...picks, "Banana"] : picks.filter((v) => v !== "Banana"))} />`
    )
  })
})
