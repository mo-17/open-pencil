import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, initCodec } from '@open-pencil/core'

import { compile, withDefaults } from '@open-pencil/compiler'

/**
 * Phase 1 §7.4 — navigate handler end-to-end through the React adapter.
 * Pins both the multi-page emit (useNavigate + navigate('/...')) and the
 * single-page strip with warning.
 */
describe('navigate action — React adapter emit', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function makeGraph(): SceneGraph {
    const graph = new SceneGraph()
    return graph
  }

  function addButtonWithNavigate(graph: SceneGraph, pageId: string, to: string): void {
    graph.createNode('BUTTON', pageId, {
      interactiveProps: { text: 'Go' },
      events: { onClick: [{ id: 'a1', kind: 'navigate', to }] }
    })
  }

  test('multi-page compile: emits useNavigate import + hook + navigate() call', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    addButtonWithNavigate(graph, home.id, '/about')

    const about = graph.addPage('About')
    graph.createNode('TEXT', about.id, { text: 'about page' })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'nav-multipage' })
    })

    const indexTsx = out.files.get('src/pages/index.tsx') as string
    expect(indexTsx).toContain("import { useNavigate } from 'react-router-dom'")
    expect(indexTsx).toContain('const navigate = useNavigate()')
    expect(indexTsx).toContain('onClick={() => navigate("/about")}')

    // The About page has no navigate handlers, so it must not pay the
    // useNavigate import cost.
    const aboutTsx = out.files.get('src/pages/about.tsx') as string
    expect(aboutTsx).not.toContain('useNavigate')
    expect(aboutTsx).not.toContain('navigate(')
  })

  test('single-page compile: navigate handler is stripped with a warning', () => {
    const graph = makeGraph()
    const page = graph.getPages()[0]
    addButtonWithNavigate(graph, page.id, '/about')

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'nav-singlepage' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('useNavigate')
    expect(app).not.toContain('navigate(')
    // The <button> is still rendered, just without onClick.
    expect(app).toContain('<button')
    expect(app).not.toContain('onClick')

    expect(out.warnings.some((w) => w.code === 'action-navigate-no-router')).toBe(true)
  })

  test('multi-page compile mixing setState + navigate: both emit cleanly', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, {
      name: 'Home',
      state: [{ id: 's-c', name: 'count', type: 'number', defaultValue: 0 }]
    })
    graph.createNode('BUTTON', home.id, {
      interactiveProps: { text: 'Mixed' },
      events: {
        onClick: [
          { id: 'a1', kind: 'setState', targetStateId: 's-c', valueExpr: 'count + 1' },
          { id: 'a2', kind: 'navigate', to: '/about' }
        ]
      }
    })
    graph.addPage('About')

    const pages = graph.getPages()
    const out = compile({
      graph,
      pageIds: pages.map((p) => p.id),
      options: withDefaults({ packageName: 'nav-mixed' })
    })

    const indexTsx = out.files.get('src/pages/index.tsx') as string
    expect(indexTsx).toContain('useNavigate')
    expect(indexTsx).toContain('useState')
    // Two-statement arrow body: both calls present.
    expect(indexTsx).toContain('setCount(count + 1)')
    expect(indexTsx).toContain('navigate("/about")')
  })
})
