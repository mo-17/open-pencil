import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'
import type { ActionDef, SupabaseConfig } from '@open-pencil/core/scene-graph'

import { compile, withDefaults } from '@open-pencil/compiler'
import { stripNavigateForSinglePage } from '@open-pencil/compiler/adapters/react/ir-walk'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRNode } from '@open-pencil/compiler/ir/types'

/**
 * Phase 3 §2 step 5 — cross-walker regression (experiences A + G).
 *
 * `supabaseQuery` / `supabaseMutation` are two new `ActionDef` /
 * `IREventHandler` kinds. The risk surface is the same as Phase 2 §3
 * `apiCall`: a naive walker that filters by hardcoded kind list can
 * accidentally drop or mis-render the new kinds. This file pins:
 *
 *   1. `stripNavigateForSinglePage` is surgical — supabase handlers survive
 *   2. Both runtimes (`_lowcode_state.ts` + `_lowcode_supabase.ts`) co-exist
 *      whenever supabaseConfig is set (the supabase runtime imports the state
 *      runtime, so they're inseparable in emit).
 *   3. `$currentUser` auto-registration flows through the full compile so a
 *      user page can `useDocState('$currentUser')` without declaring it.
 *   4. Mixed handler lists (setVariable + supabaseQuery + supabaseMutation +
 *      apiCall) all emit in source order under one async arrow.
 *   5. Zero regression: documents without supabaseConfig are byte-stable
 *      against step 0–4 emit.
 */
describe('cross-walker — supabase handlers + config survive every walker', () => {
  beforeAll(async () => {
    await initCodec()
  })

  const SAMPLE_CONFIG: SupabaseConfig = {
    url: 'https://example.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'
  }

  /** Single-page document: root carries supabaseConfig + a `users` docState.
   *  A BUTTON's onClick mixes navigate (single-page strip target), a
   *  supabaseQuery (must survive), and a setVariable (sync sibling). */
  function makeGraph(): { graph: SceneGraph; pageId: string } {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: SAMPLE_CONFIG,
      lowcodeDocumentState: [
        { id: 'd-users', name: 'users', type: 'array', defaultValue: [] },
        { id: 'd-err', name: 'lastError', type: 'object', defaultValue: {} },
        { id: 'd-tick', name: 'tick', type: 'number', defaultValue: 0 }
      ]
    })
    const page = graph.getPages()[0]
    graph.updateNode(page.id, { name: 'Home' })
    const onClick: ActionDef[] = [
      { id: 'a-nav', kind: 'navigate', to: '/about' },
      {
        id: 'a-q',
        kind: 'supabaseQuery',
        table: 'users',
        columns: 'id, name',
        resultTarget: 'users',
        errorTarget: 'lastError'
      },
      { id: 'a-set', kind: 'setVariable', targetName: 'tick', valueExpr: '$prev + 1' }
    ]
    graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Load' },
      events: { onClick }
    })
    return { graph, pageId: page.id }
  }

  test('stripNavigateForSinglePage drops navigate but keeps supabase + setVariable', () => {
    const { graph, pageId } = makeGraph()
    const ir = collectTree(graph, pageId)
    const { ir: cleaned, warnings } = stripNavigateForSinglePage(ir)

    expect(warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
    // `supabaseConfig` is a top-level IRTree field carried through the
    // `{ ...ir }` spread inside the strip — single-page should still see it.
    expect(cleaned.supabaseConfig?.url).toBe(SAMPLE_CONFIG.url)
    // docStateWrites must include both supabaseQuery targets and the
    // setVariable target (no duplicates from the Set).
    expect(cleaned.docStateWrites.sort()).toEqual(['lastError', 'tick', 'users'])

    const handlerKinds: string[] = []
    function walk(node: IRNode): void {
      if (node.kind === 'conditional') return walk(node.consequent)
      if (node.kind === 'list') return walk(node.template)
      if (node.kind !== 'element') return
      if (node.events) {
        for (const list of Object.values(node.events)) {
          for (const h of list ?? []) handlerKinds.push(h.kind)
        }
      }
      for (const c of node.children) walk(c)
    }
    cleaned.children.forEach(walk)
    expect(handlerKinds).toEqual(['supabaseQuery', 'setVariable'])
  })

  test('single-page compile: navigate stripped; supabase runtime + state runtime + deps all emit', () => {
    const { graph, pageId } = makeGraph()
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-supabase-single' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('navigate(')
    expect(app).toContain('async () => {')
    // step 5b regression — the call site emit predates the import wiring;
    // without this assertion the page module ReferenceError'd at runtime
    // even though every emit-level test passed.
    expect(app).toContain("import { getSupabaseClient } from './_lowcode_supabase'")
    expect(app).toContain('getSupabaseClient().from("users")')
    expect(app).toContain('.select("id, name")')
    expect(app).toContain('setDocState("users", data)')
    expect(app).toContain('setDocState("lastError", error)')

    // Both runtime files MUST appear together: the supabase runtime imports
    // setDocState / useDocState from _lowcode_state, so one without the other
    // is a broken emit.
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)

    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeDefined()
    expect(pkg.dependencies.zustand).toBeDefined()
  })

  test('multi-page compile: supabase handlers survive on the page, both runtimes emit once', () => {
    const { graph, pageId } = makeGraph()
    const about = graph.addPage('About')
    graph.createNode('TEXT', about.id, { text: 'about' })

    const out = compile({
      graph,
      pageIds: [pageId, about.id],
      options: withDefaults({ packageName: 'cross-walker-supabase-multi' })
    })

    const home = out.files.get('src/pages/index.tsx') as string
    expect(home).toContain('navigate("/about")')
    // Page modules sit one level deeper than the runtime files; the import
    // path must climb out of `pages/` to reach `src/_lowcode_supabase.ts`.
    expect(home).toContain("import { getSupabaseClient } from '../_lowcode_supabase'")
    expect(home).toContain('getSupabaseClient().from("users")')
    expect(home).toContain('setDocState("users", data)')
    // Runtime files live at `src/` (project root), not inside `pages/`.
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    expect(out.files.has('src/_lowcode_state.ts')).toBe(true)
  })

  test('$currentUser auto-registers when supabaseConfig is set; user page can read it', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SAMPLE_CONFIG })
    const pageId = graph.getPages()[0].id
    // Bind a TEXT to `$currentUser.email` via the docState binding channel.
    // collectDocStates auto-prepends $currentUser when supabaseConfig is set,
    // so this binding resolves without the user declaring anything.
    graph.createNode('TEXT', pageId, {
      text: 'who?',
      bindings: { text: { kind: 'docState', docStateName: '$currentUser' } }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-supabase-currentuser' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('const $currentUser = useDocState("$currentUser")')
    expect(app).toContain('{$currentUser}')
    // The page reads $currentUser but never calls getSupabaseClient itself —
    // the named import is gated on actual handler usage, not just config
    // presence, so this page should not import it.
    expect(app).not.toContain('getSupabaseClient')

    const stateRuntime = out.files.get('src/_lowcode_state.ts') as string
    expect(stateRuntime).toContain('$currentUser:')
  })

  test('mixed handler list: setVariable + supabaseQuery + supabaseMutation + apiCall all emit under one async arrow', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: SAMPLE_CONFIG,
      lowcodeDocumentState: [
        { id: 'd1', name: 'rows', type: 'array', defaultValue: [] },
        { id: 'd2', name: 'last', type: 'object', defaultValue: {} },
        { id: 'd3', name: 'count', type: 'number', defaultValue: 0 }
      ]
    })
    const pageId = graph.getPages()[0].id
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Mix' },
      events: {
        onClick: [
          { id: '1', kind: 'setVariable', targetName: 'count', valueExpr: '$prev + 1' },
          { id: '2', kind: 'supabaseQuery', table: 'rows', resultTarget: 'rows' },
          {
            id: '3',
            kind: 'supabaseMutation',
            operation: 'insert',
            table: 'rows',
            payloadJson: '{"a":1}'
          },
          {
            id: '4',
            kind: 'apiCall',
            method: 'GET',
            url: 'https://x.test/last',
            targetName: 'last'
          }
        ]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-supabase-mix' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('async () => {')
    expect(app).toContain("import { getSupabaseClient } from './_lowcode_supabase'")
    // Order is preserved by the emit walker.
    const idxSet = app.indexOf('setDocState("count"')
    const idxQuery = app.indexOf('getSupabaseClient().from("rows").select("*")')
    const idxMut = app.indexOf('.insert({"a":1})')
    const idxApi = app.indexOf('await fetch("https://x.test/last")')
    expect(idxSet).toBeGreaterThan(-1)
    expect(idxQuery).toBeGreaterThan(idxSet)
    expect(idxMut).toBeGreaterThan(idxQuery)
    expect(idxApi).toBeGreaterThan(idxMut)
  })

  test('zero regression: document without supabaseConfig emits no supabase runtime + no dep', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'd1', name: 'count', type: 'number', defaultValue: 0 }
      ]
    })
    const pageId = graph.getPages()[0].id
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Inc' },
      events: {
        onClick: [
          { id: '1', kind: 'setVariable', targetName: 'count', valueExpr: '$prev + 1' }
        ]
      }
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'cross-walker-supabase-none' })
    })

    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(false)
    const pkg = JSON.parse(out.files.get('package.json') as string)
    expect(pkg.dependencies['@supabase/supabase-js']).toBeUndefined()
    // No supabase config → no import in the page either.
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('_lowcode_supabase')
    // $currentUser must NOT slip into the docState shape when supabaseConfig
    // is absent — the auto-register gate keys on that flag.
    const stateRuntime = out.files.get('src/_lowcode_state.ts') as string
    expect(stateRuntime).not.toContain('$currentUser')
  })
})
