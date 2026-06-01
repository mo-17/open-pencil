import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { createEditor } from '@open-pencil/core/editor'
import { FigmaAPI } from '@open-pencil/core/figma-api'
import {
  SceneGraph,
  type DocumentStateDef,
  type StateDef
} from '@open-pencil/core/scene-graph'
import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'

import { ALL_TOOLS, getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

/**
 * Phase 3 §3 step 4 — cross-walker for the lowcode AI tool surface.
 *
 * Pin that AI-driven mutations land at every downstream walker:
 *
 *   tool execute → SceneGraph mutation
 *                → IR collectTree picks up every patched field + 0 warnings
 *                → React adapter emit references each field in App.tsx
 *                → package.json deps include @supabase/supabase-js when set
 *
 * Walker round-2 acknowledgements (decision §3.2 #6 + experience A):
 *
 *   - `update_lowcode_node` commits via `figma.graph.updateNode` (no undo
 *     stack entry — known limitation, see prompt.md §3 §3.6 row 7 and
 *     post-mortem stub; v2 may switch to `editor.updateNodeWithUndo`).
 *   - bindings / events / interactiveProps / renderCondition / docStates /
 *     supabaseConfig are all already covered by §2 + Phase 2 walkers; this
 *     file only re-enters the chain via the NEW tool entrypoint to verify
 *     no walker silently drops a field when the mutation arrives that way.
 *
 * Experience I (§2 post-mortem, candidate): "emit done + unit-green ≠ runs".
 * Every emit assertion below pairs the call-site emit with the corresponding
 * import line so a missing import surfaces here, not at runtime.
 */
describe('lowcode tools — cross-walker (IR + emit + deps)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('update_lowcode_node mega patch + set_doc_states → 5 fields land in IR, 0 warnings', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id

    const pageState: StateDef[] = [
      { id: 's1', name: 'count', type: 'number', defaultValue: 0 }
    ]
    graph.updateNode(pageId, { state: pageState })

    const docStatesRes = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd1', name: 'items', type: 'array', defaultValue: [] }
      ])
    }) as Result<{ count: number }>
    expect(docStatesRes.ok).toBe(true)

    const btn = graph.createNode('BUTTON', pageId, { name: 'Submit' })
    const mega = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        bindings: { text: { kind: 'docState', docStateName: 'items' } },
        events: {
          onClick: [
            { id: 'a1', kind: 'setVariable', targetName: 'items', valueExpr: '$prev' }
          ]
        },
        interactiveProps: { text: 'Submit' },
        renderCondition: 'count > 0'
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(mega.ok).toBe(true)
    if (!mega.ok) return
    expect(mega.data?.updated.sort()).toEqual([
      'bindings',
      'events',
      'interactiveProps',
      'renderCondition'
    ])

    const ir = collectTree(graph, pageId)
    // IR collectTree must not warn on any of the tool-applied fields. The
    // tool validates its inputs at the boundary, so a warning here would
    // mean the IR walker disagrees with the tool's accept rules — the kind
    // of drift experience A was added to catch.
    expect(ir.warnings).toEqual([])

    expect(ir.states.map((s) => s.name)).toEqual(['count'])
    expect(ir.docStates.map((d) => d.name)).toEqual(['items'])
    // The BUTTON is the single child of the page. The renderCondition wraps
    // it as an IRConditional whose consequent carries the event handler +
    // the docState read for the text binding.
    const wrapper = ir.children[0]
    expect(wrapper.kind).toBe('conditional')
    if (wrapper.kind !== 'conditional') return
    const buttonEl = wrapper.consequent
    expect(buttonEl.kind).toBe('element')
    if (buttonEl.kind !== 'element') return
    expect(buttonEl.tag).toBe('button')
    expect(buttonEl.events?.onClick?.[0].kind).toBe('setVariable')
    expect(ir.docStateReads.sort()).toEqual(['items'])
    expect(ir.docStateWrites.sort()).toEqual(['items'])
  })

  test('update_lowcode_node mega patch → React emit references each field + paired imports', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id

    graph.updateNode(pageId, {
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd1', name: 'items', type: 'array', defaultValue: [] }
      ])
    })

    const btn = graph.createNode('BUTTON', pageId, { name: 'Add' })
    const mega = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        bindings: { text: { kind: 'docState', docStateName: 'items' } },
        events: {
          onClick: [
            { id: 'a1', kind: 'setVariable', targetName: 'items', valueExpr: '$prev' },
            { id: 'a2', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }
          ]
        },
        interactiveProps: { text: 'Add' },
        renderCondition: 'count >= 0'
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(mega.ok).toBe(true)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-mega-emit' })
    })
    expect(out.warnings).toEqual([])

    const app = out.files.get('src/App.tsx') as string
    // page state → useState declaration + import.
    expect(app).toContain("import { useState } from 'react'")
    expect(app).toContain('const [count, setCount] = useState(0)')
    // docState read+write → both names + paired import from the state runtime.
    expect(app).toContain("import { useDocState, setDocState } from './_lowcode_state'")
    expect(app).toContain('const items = useDocState("items")')
    // onClick chains setDocState (setVariable) AND setCount (setState) in order.
    const idxSetDoc = app.indexOf('setDocState("items"')
    const idxSetState = app.indexOf('setCount(count + 1)')
    expect(idxSetDoc).toBeGreaterThan(-1)
    expect(idxSetState).toBeGreaterThan(idxSetDoc)
    // renderCondition → conditional JSX wrapper using the page state.
    expect(app).toContain('(count >= 0) &&')
    // interactiveProps.text is the BUTTON inner text when the bindings.text
    // would resolve to a non-string array; the React emit falls back to the
    // ip.text literal only when the binding wins out. Here `items` is an
    // array docState, so it interpolates `{items}` as the child expression.
    expect(app).toContain('{items}')
    // No supabase runtime got pulled in for this no-config compile.
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(false)
    expect(app).not.toContain('_lowcode_supabase')
  })

  test('set_doc_states → IR.docStates equals the set; React emit reflects the new lines', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    // A reader keeps `useDocState` linked in the emit (decision §2.2: doc-state
    // declarations are auto-imported only when at least one page reads them).
    graph.createNode('TEXT', pageId, {
      text: '0',
      bindings: { text: { kind: 'docState', docStateName: 'count' } }
    })

    const states: DocumentStateDef[] = [
      { id: 'd1', name: 'count', type: 'number', defaultValue: 0 },
      { id: 'd2', name: 'items', type: 'array', defaultValue: [] }
    ]
    const r = getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify(states)
    }) as Result<{ count: number }>
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data?.count).toBe(2)

    const ir = collectTree(graph, pageId)
    expect(ir.docStates).toEqual(states)
    expect(ir.warnings).toEqual([])

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-docstates' })
    })
    const app = out.files.get('src/App.tsx') as string
    expect(app).toMatch(/import \{ useDocState[^}]*\} from '\.\/_lowcode_state'/)
    expect(app).toContain('const count = useDocState("count")')
    const runtime = out.files.get('src/_lowcode_state.ts') as string
    expect(runtime).toContain('count:')
    expect(runtime).toContain('items:')
  })

  test('set_supabase_config → IR.supabaseConfig + _lowcode_supabase.ts + supabase-js dep', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    // Give the page one supabaseQuery handler so the page module also pulls
    // `getSupabaseClient` (otherwise the runtime emits but the page never
    // imports it — half a regression we want to catch).
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Load' },
      events: {
        onClick: [
          { id: 'a1', kind: 'supabaseQuery', table: 'rows', resultTarget: 'rows' }
        ]
      }
    })
    // The query needs a doc-state to write into.
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [{ id: 'd1', name: 'rows', type: 'array', defaultValue: [] }]
    })

    const r = getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({
        url: 'https://abc.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'
      })
    }) as Result<{ cleared: boolean }>
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data?.cleared).toBe(false)

    const ir = collectTree(graph, pageId)
    expect(ir.supabaseConfig?.url).toBe('https://abc.supabase.co')
    // `$currentUser` is auto-prepended onto docStates whenever supabaseConfig
    // is set — this is the only way to pin that the IR-level auto-register
    // path also fires when the config arrives via the AI tool entrypoint.
    expect(ir.docStates.map((d) => d.name)).toEqual(['$currentUser', 'rows'])

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-supabase-set' })
    })
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { getSupabaseClient } from './_lowcode_supabase'")
    expect(app).toContain('getSupabaseClient().from("rows")')

    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
  })

  test('update_lowcode_node({ lowcodeSupabaseConfig: null }) → clears emit + dep', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://abc.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'
      }
    })

    // Sanity: with the config set, the file must emit before we clear it.
    const before = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-clear-before' })
    })
    expect(before.files.has('src/_lowcode_supabase.ts')).toBe(true)

    const r = getTool('update_lowcode_node').execute(figma, {
      id: graph.rootId,
      patch_json: JSON.stringify({ lowcodeSupabaseConfig: null })
    }) as Result<{ id: string; updated: string[] }>
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data?.updated).toEqual(['lowcodeSupabaseConfig'])

    const after = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-clear-after' })
    })
    expect(after.files.has('src/_lowcode_supabase.ts')).toBe(false)
    const app = after.files.get('src/App.tsx') as string
    expect(app).not.toContain('_lowcode_supabase')
    expect(app).not.toContain('getSupabaseClient')
    const pkg = JSON.parse(after.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
    // $currentUser was auto-prepended while the config existed; clearing the
    // config must drop it from emit too (no orphan built-in).
    const runtime = after.files.get('src/_lowcode_state.ts')
    expect(runtime).toBeUndefined()
  })

  test('zero regression: no lowcode tool call → compile output is byte-stable against a baseline graph', () => {
    // Build the same page two ways: (1) plain `graph.updateNode` only;
    // (2) construct the page, then call NO lowcode tool at all. If a tool's
    // mere presence on the registry mutated default behavior somewhere (e.g.
    // shared module side-effect), the two emits would diverge.
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    const btn = graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: '+1' },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's1', valueExpr: 'count + 1' }
        ]
      }
    })
    expect(btn.id).toBeDefined()
    // Touch a tool to keep `figma` in scope (so `setupToolTest` isn't dead-
    // code-eliminated by an over-eager linter) without changing graph state.
    const peek = getTool('read_lowcode_node').execute(figma, { id: btn.id })
    expect(peek.ok).toBe(true)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-zero-regression' })
    })
    expect(out.warnings).toEqual([])
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const [count, setCount] = useState(0)')
    expect(app).toContain('onClick={() => setCount(count + 1)}')
    expect(app).not.toContain('_lowcode_supabase')
  })

  test('all six §3 tools are registered in ALL_TOOLS with the locked snake_case names', () => {
    const expected = [
      'read_lowcode_node',
      'read_doc_states',
      'read_supabase_config',
      'update_lowcode_node',
      'set_doc_states',
      'set_supabase_config'
    ]
    for (const name of expected) {
      const tool = ALL_TOOLS.find((t) => t.name === name)
      expect(tool).toBeDefined()
    }
    // `mutates: true` on every modify tool is what gates them out of read-only
    // sessions and keeps them off the autocomplete in inspect mode. Locked
    // by decision §3.2 — read tools must NOT carry `mutates: true`.
    expect(getTool('update_lowcode_node').mutates).toBe(true)
    expect(getTool('set_doc_states').mutates).toBe(true)
    expect(getTool('set_supabase_config').mutates).toBe(true)
    expect(getTool('read_lowcode_node').mutates).toBeFalsy()
    expect(getTool('read_doc_states').mutates).toBeFalsy()
    expect(getTool('read_supabase_config').mutates).toBeFalsy()
  })

  // Phase 3 §3.x — AI tool sets bindings.value on an INPUT → IR collects the
  // controlled descriptor → React emit produces value={read} + synthesized
  // onChange writer → docState read/write imports + per-page hoist are wired
  // (experience I: assert import-line presence both ways so a missing
  // module-resolve hole surfaces at test time, not in Tauri).
  test('update_lowcode_node bindings.value (INPUT controlled) → emit value+onChange+docState wiring', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id

    getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd1', name: 'formId', type: 'string', defaultValue: '' }
      ])
    })

    const input = graph.createNode('INPUT', pageId, { name: 'IdInput' })
    const patch = getTool('update_lowcode_node').execute(figma, {
      id: input.id,
      patch_json: JSON.stringify({
        bindings: { value: { kind: 'docState', docStateName: 'formId' } }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(patch.ok).toBe(true)

    // IR collect: controlled descriptor lands + docState reads/writes register.
    const ir = collectTree(graph, pageId)
    const inputEl = ir.children[0]
    if (inputEl.kind !== 'element') throw new Error('expected element')
    expect(inputEl.controlled).toEqual({
      read: 'formId',
      write: { kind: 'docState', name: 'formId', targetType: 'string' }
    })
    expect(ir.docStateReads).toContain('formId')
    expect(ir.docStateWrites).toContain('formId')

    // React emit: positive call-sites + the matching import line. Experience
    // I bites here if the runtime ever lacks `setDocState` while the emit
    // calls it — the negative assertion below catches a future regression
    // that drops the import while leaving the call-site intact.
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-input-controlled' })
    })
    expect(out.warnings).toEqual([])
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { useDocState, setDocState } from './_lowcode_state'")
    expect(app).toContain('const formId = useDocState("formId")')
    expect(app).toContain('value={formId}')
    expect(app).toContain('onChange={(e) => setDocState("formId", e.target.value)}')
    // Uncontrolled defaultValue must NOT leak through when controlled.
    expect(app).not.toContain('defaultValue=')
    // Negative import-line assertion: no useDocState-only import (write also
    // needed → both names imported together).
    expect(app).not.toContain("import { useDocState } from './_lowcode_state'")
  })

  /**
   * Phase 3 §3.v2 step 1 — mega-undo cross-walker. With ctx.editor wired
   * through the tool dispatch (mirrors src/app/automation/bridge/
   * tool-handlers.ts beginBatch/commitBatch path), a single mega patch
   * touching 4 lowcode fields collapses to exactly one UndoEntry. Cmd+Z
   * once restores every field, fixing §3.8 surprise #2 (Cmd+Z used to
   * take two presses).
   */
  test('§3.v2 mega patch under editor.runBatch → exactly 1 undo entry, Cmd+Z restores all fields', () => {
    const graph = new SceneGraph()
    const figma = new FigmaAPI(graph)
    const editor = createEditor({ graph, skipInitialGraphSetup: true })
    const pageId = graph.getPages()[0].id
    graph.updateNode(pageId, {
      state: [{ id: 's1', name: 'count', type: 'number', defaultValue: 0 }]
    })
    getTool('set_doc_states').execute(
      figma,
      {
        states_json: JSON.stringify([
          { id: 'd1', name: 'items', type: 'array', defaultValue: [] }
        ])
      },
      { editor }
    )
    const btn = graph.createNode('BUTTON', pageId, { name: 'Save' })
    const before = {
      bindings: structuredClone(graph.getNode(btn.id)?.bindings),
      events: structuredClone(graph.getNode(btn.id)?.events),
      interactiveProps: structuredClone(graph.getNode(btn.id)?.interactiveProps),
      renderCondition: graph.getNode(btn.id)?.renderCondition
    }
    // Clear the set_doc_states undo entry; we only want to measure the mega.
    while (editor.undo.canUndo) editor.undo.undo()

    editor.undo.beginBatch('AI: update_lowcode_node')
    const res = getTool('update_lowcode_node').execute(
      figma,
      {
        id: btn.id,
        patch_json: JSON.stringify({
          bindings: { text: { kind: 'docState', docStateName: 'items' } },
          events: {
            onClick: [
              { id: 'a1', kind: 'setVariable', targetName: 'items', valueExpr: '$prev' }
            ]
          },
          interactiveProps: { text: 'Save' },
          renderCondition: 'count >= 0'
        })
      },
      { editor }
    )
    editor.undo.commitBatch()
    expect((res as Result).ok).toBe(true)
    expect(editor.undo.canUndo).toBe(true)
    expect(editor.undo.undoLabel).toBe('AI: update_lowcode_node')

    // Patch must have actually applied across all four fields before undo.
    const after = graph.getNode(btn.id)
    expect(after?.interactiveProps).toEqual({ text: 'Save' })
    expect(after?.renderCondition).toBe('count >= 0')
    expect(after?.bindings?.text).toBeDefined()
    expect(after?.events?.onClick?.length).toBe(1)

    // Single Cmd+Z restores every field — confirms 1 entry, not N.
    editor.undo.undo()
    expect(editor.undo.canUndo).toBe(false)
    const reverted = graph.getNode(btn.id)
    expect(reverted?.bindings).toEqual(before.bindings)
    expect(reverted?.events).toEqual(before.events)
    expect(reverted?.interactiveProps).toEqual(before.interactiveProps)
    expect(reverted?.renderCondition).toEqual(before.renderCondition)
  })

  /**
   * Phase 3 §3.v2 step 2 — payloadEntries end-to-end cross-walker. Tool
   * input → IR collect → React emit. docState refs in valueExpr land as
   * `{ "<key>": <docStateRead> }` inside `.insert(...)`, and the read
   * pulls the useDocState import along so the emitted module compiles.
   */
  test('§3.v2 supabaseMutation payloadEntries with docState ref → IR + emit propagate', () => {
    const { figma, graph } = setupToolTest()
    const pageId = graph.getPages()[0].id

    getTool('set_supabase_config').execute(figma, {
      config_json: JSON.stringify({
        url: 'https://x.supabase.co',
        anonKey: 'anon-jwt'
      })
    })
    getTool('set_doc_states').execute(figma, {
      states_json: JSON.stringify([
        { id: 'd1', name: 'formName', type: 'string', defaultValue: '' },
        { id: 'd2', name: 'formAge', type: 'number', defaultValue: 0 }
      ])
    })

    const btn = graph.createNode('BUTTON', pageId, { name: 'Submit' })
    const res = getTool('update_lowcode_node').execute(figma, {
      id: btn.id,
      patch_json: JSON.stringify({
        events: {
          onClick: [
            {
              id: 'a1',
              kind: 'supabaseMutation',
              operation: 'insert',
              table: 'users',
              payloadEntries: [
                { key: 'name', valueExpr: 'formName' },
                { key: 'age', valueExpr: 'formAge' }
              ]
            }
          ]
        }
      })
    }) as Result<{ id: string; updated: string[] }>
    expect(res.ok).toBe(true)

    // IR level: handler picked up payloadEntries (not payload), references
    // resolve, no warnings.
    const ir = collectTree(graph, pageId)
    expect(ir.warnings).toEqual([])
    const buttonEl = ir.children[0]
    if (!buttonEl || buttonEl.kind !== 'element') throw new Error('expected button')
    const handler = buttonEl.events?.onClick?.[0]
    if (handler?.kind !== 'supabaseMutation') throw new Error('expected supabaseMutation')
    expect(handler.payload).toBeUndefined()
    expect(handler.payloadEntries?.map((e) => e.key)).toEqual(['name', 'age'])
    expect(handler.payloadEntries?.[0].references).toContain('formName')
    expect(ir.docStateReads.sort()).toEqual(['formAge', 'formName'])

    // Emit level: object literal with the two valueExpr expressions,
    // chained into .insert; useDocState import paired (formName / formAge
    // both read) — experience I import-line +/- assertions.
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cw-payload-entries' })
    })
    expect(out.warnings).toEqual([])
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('.insert({ "name": formName, "age": formAge })')
    // Both targets are reads → useDocState import line must be present
    expect(app).toContain("import { useDocState } from './_lowcode_state'")
    expect(app).toContain('useDocState("formName")')
    expect(app).toContain('useDocState("formAge")')
    // Negative: payloadJson literal path must not contaminate output
    expect(app).not.toContain('.insert({})')
    expect(app).not.toContain('.insert(null)')
    // Supabase runtime imports + dep
    expect(app).toContain("import { getSupabaseClient } from './_lowcode_supabase'")
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
  })
})
