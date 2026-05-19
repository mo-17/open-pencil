import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Phase 1 §11 step 1 — IR-collection pipeline changes:
 *
 *  - `compile()` collects one IRTree per pageId (was: only `pageIds[0]`).
 *  - Warnings from every page surface in the output (was: page-0 only).
 *  - The React adapter accepts `irs[]` but step 1 only fully implements the
 *    single-page shape; multi-page emits a `multi-page-emit-pending` warning
 *    and falls back to first-page output. Step 2 replaces that branch with
 *    real `react-router-dom` emission.
 *
 * Tests in this file that assert the transient `multi-page-emit-pending`
 * warning will be **rewritten** in step 2 once the multi-page branch lands.
 */
describe('compile — multi-page pipeline (Phase 1 §11 step 1)', () => {
  test('single-page input produces the legacy App.tsx shape with no multi-page warnings', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'one-page' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('export default function App')
    expect(app).toContain('<div className="relative min-h-screen">')

    // No multi-page warning surfaces on a single-page compile.
    const codes = out.warnings.map((w) => w.code)
    expect(codes).not.toContain('multi-page-emit-pending')
  })

  test('multi-page input emits the step-1 placeholder warning + falls back to first-page output', () => {
    const graph = makeSceneGraph('Home')
    graph.addPage('About')
    const [home, about] = graph.getPages()

    graph.createNode('BUTTON', home.id, { interactiveProps: { text: 'Home button' } })
    graph.createNode('BUTTON', about.id, { interactiveProps: { text: 'About button' } })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'two-pages' })
    })

    // Step 1 surfaces the placeholder warning; step 2 will drop it.
    expect(out.warnings.map((w) => w.code)).toContain('multi-page-emit-pending')

    // Fallback: first-page content still lands in App.tsx so production callers
    // (preview-pane, CLI single-page mode) keep working between steps.
    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('>Home button</button>')
    expect(app).not.toContain('>About button</button>')
  })

  test('IR warnings from every page surface (not just page 0)', () => {
    const graph = makeSceneGraph('Home')
    graph.addPage('About')
    const [home, about] = graph.getPages()

    // Each page declares a state with a non-identifier name; the IR collector
    // raises a `state-invalid` warning per offending page. Before step 1,
    // only page 0's warning would surface — `compile()` collected one IR.
    home.state = [
      { id: 's-home', name: '1bad-home', type: 'number', defaultValue: 0 }
    ]
    about.state = [
      { id: 's-about', name: '1bad-about', type: 'boolean', defaultValue: false }
    ]

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'state-warnings' })
    })

    const invalidWarnings = out.warnings.filter((w) => w.code === 'state-invalid')
    const nodeIds = invalidWarnings.map((w) => w.nodeId).sort()
    expect(nodeIds).toEqual([home.id, about.id].sort())
  })
})
