import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, initCodec } from '@open-pencil/core'

/**
 * Phase 3 §3.v4 step 3 — cross-walker regression for the 6 new controlled
 * component types. Each test pins both halves of the end-to-end chain:
 *  - emit produces `value={read}` / `checked={read}` + the correct
 *    `setDocState(...)` / setter onChange writer body per targetType
 *  - the page's import line includes `useDocState, setDocState` exactly
 *    once when the binding is wired, NONE when the binding is dropped
 *    (经验 I — module-resolve dimension).
 *
 * boolean writer uses `e.target.checked`; string uses `e.target.value`;
 * RADIO emits `checked={read === <opt>}` per option + shared onChange.
 */
describe('cross-walker — §3.v4 6 controlled component types (Phase 3)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('CHECKBOX + boolean docState → emit checked + setDocState(e.target.checked)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('CHECKBOX', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'agreed' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-checkbox' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('checked={agreed}')
    expect(app).toContain('onChange={(e) => setDocState("agreed", e.target.checked)}')
    expect(app).toContain('useDocState("agreed")')
    expect(app).not.toContain('defaultChecked')
    expect(out.warnings).toEqual([])
  })

  test('SWITCH + boolean docState → emit role="switch" + checked + setDocState', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'dark', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('SWITCH', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'dark' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-switch' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('role="switch"')
    expect(app).toContain('checked={dark}')
    expect(app).toContain('onChange={(e) => setDocState("dark", e.target.checked)}')
    expect(out.warnings).toEqual([])
  })

  test('TEXTAREA + string docState → emit value + setDocState(e.target.value)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'bio', type: 'string', defaultValue: '' }]
    })
    graph.createNode('TEXTAREA', page.id, {
      interactiveProps: { placeholder: 'Bio' },
      bindings: { value: { kind: 'docState', docStateName: 'bio' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-textarea' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<textarea')
    expect(app).toContain('value={bio}')
    expect(app).toContain('onChange={(e) => setDocState("bio", e.target.value)}')
    expect(app).not.toContain('defaultValue=')
    expect(out.warnings).toEqual([])
  })

  test('SELECT + string docState → <select value=...> + options preserved', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'country', type: 'string', defaultValue: '' }]
    })
    graph.createNode('SELECT', page.id, {
      interactiveProps: { options: ['US', 'CN', 'JP'] },
      bindings: { value: { kind: 'docState', docStateName: 'country' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-select' })
    })
    const app = out.files.get('src/App.tsx') as string
    // Tag, value binding, and onChange writer all on the <select> wrapper
    // (className / data-node-id may sit between them in the emitted source).
    expect(app).toContain('<select')
    expect(app).toContain('value={country}')
    expect(app).toContain('onChange={(e) => setDocState("country", e.target.value)}')
    // Options preserved (value + visible label); data-node-id may sit
    // between `<option` and `value=`.
    expect(app).toMatch(/<option [^>]*value="US"[^>]*>US<\/option>/)
    expect(app).toMatch(/<option [^>]*value="JP"[^>]*>JP<\/option>/)
    expect(out.warnings).toEqual([])
  })

  test('RADIO + string page-state → per-option checked={state === opt} + shared setter', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's1', name: 'gender', type: 'string', defaultValue: '' }]
    })
    graph.createNode('RADIO', page.id, {
      interactiveProps: { options: ['M', 'F'], groupName: 'g' },
      bindings: { value: { kind: 'ref', stateId: 's1' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-radio' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('checked={gender === "M"}')
    expect(app).toContain('checked={gender === "F"}')
    // Shared setter on each radio.
    const setterMatches = app.match(/setGender\(e\.target\.value\)/g) ?? []
    expect(setterMatches.length).toBe(2)
    // defaultChecked must NOT leak through on controlled radios.
    expect(app).not.toContain('defaultChecked')
    expect(out.warnings).toEqual([])
  })

  test('DATEPICKER + string docState → preserves type="date" + value + setDocState', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'dob', type: 'string', defaultValue: '' }]
    })
    graph.createNode('DATEPICKER', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'dob' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-date' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('type="date"')
    expect(app).toContain('value={dob}')
    expect(app).toContain('onChange={(e) => setDocState("dob", e.target.value)}')
    // Number-type INPUT injection must not apply to DATEPICKER.
    expect(app).not.toContain('type="number"')
    expect(out.warnings).toEqual([])
  })

  test('type mismatch (CHECKBOX + string docState) → fallback uncontrolled + warn', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'name', type: 'string', defaultValue: '' }]
    })
    graph.createNode('CHECKBOX', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'name' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-bad' })
    })
    const app = out.files.get('src/App.tsx') as string
    // Falls back to uncontrolled — no `checked={name}` JSX expr should appear.
    expect(app).not.toContain('checked={name}')
    // No setDocState writer either — the binding was rejected.
    expect(app).not.toContain('setDocState("name"')
    // Warning surfaces the type mismatch.
    expect(
      out.warnings.some(
        (w) => w.code === 'binding-value-bad-state-type' && w.message.includes('CHECKBOX')
      )
    ).toBe(true)
  })

  test('CHECKBOX group (options[] + array docState) → wrapper div + N inputs + per-option includes/toggle', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'fruits', type: 'array', defaultValue: [] }]
    })
    graph.createNode('CHECKBOX', page.id, {
      interactiveProps: { options: ['Apple', 'Banana', 'Cherry'] },
      bindings: { value: { kind: 'docState', docStateName: 'fruits' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-checkbox-group' })
    })
    const app = out.files.get('src/App.tsx') as string
    // Wrapper is a div (CHECKBOX with options renders as group), not <input>.
    // Three checkbox children with per-option includes + toggle writer.
    expect(app).toContain('checked={fruits.includes("Apple")}')
    expect(app).toContain('checked={fruits.includes("Banana")}')
    expect(app).toContain('checked={fruits.includes("Cherry")}')
    expect(app).toContain(
      'setDocState("fruits", e.target.checked ? [...fruits, "Apple"] : fruits.filter((v) => v !== "Apple"))'
    )
    // Single-mode boolean writer must NOT appear (we're in group mode).
    expect(app).not.toContain('setDocState("fruits", e.target.checked)')
    // Wrapper div should NOT carry `value=` / `onChange=` (those belong to leaves).
    expect(app).not.toMatch(/<div [^>]*value=\{fruits\}/)
    expect(out.warnings).toEqual([])
  })

  test('CHECKBOX single (no options) + boolean docState still works (back-compat)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false }]
    })
    graph.createNode('CHECKBOX', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'agreed' } }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-checkbox-single-backcompat' })
    })
    const app = out.files.get('src/App.tsx') as string
    // Boolean branch unchanged.
    expect(app).toContain('checked={agreed}')
    expect(app).toContain('onChange={(e) => setDocState("agreed", e.target.checked)}')
    // No group-mode array helpers.
    expect(app).not.toContain('.includes')
    expect(app).not.toContain('.filter((v) =>')
  })

  test('user onChange + controlled value → writer first, user handler second', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'agreed', type: 'boolean', defaultValue: false },
        { id: 'd2', name: 'other', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('CHECKBOX', page.id, {
      bindings: { value: { kind: 'docState', docStateName: 'agreed' } },
      events: {
        onChange: [{ id: 'a1', kind: 'setVariable', targetName: 'other', valueExpr: "'x'" }]
      }
    })
    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'cw-conflict' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(out.warnings.map((w) => w.code)).not.toContain('input-controlled-onchange-conflict')
    expect(app).toContain('setDocState("agreed", e.target.checked);')
    expect(app).toContain('setDocState("other", "x")')
  })
})
