import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, initCodec } from '@open-pencil/core'

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

  function addReusableNav(
    graph: SceneGraph,
    pageId: string,
    event: { to: string; params?: Record<string, string> }
  ): void {
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'Menu Nav',
      width: 160,
      height: 48,
      layoutMode: 'HORIZONTAL'
    })
    graph.createNode('BUTTON', master.id, {
      interactiveProps: { text: 'Open' },
      events: {
        onClick: [{ id: 'component-nav', kind: 'navigate', ...event }]
      }
    })
    graph.createInstance(master.id, pageId)
  }

  test('multi-page compile: awaits bounded pageExit before navigate()', () => {
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
    expect(indexTsx).toContain(
      'onClick={async () => { await window.__OPENPENCIL_MOTION_RUNTIME__?.pageExit?.(); navigate("/about"); }}'
    )
    expect(out.files.get('src/__motion-runtime.ts')).toContain(
      'const PAGE_EXIT_MAX_WAIT_MS = 4_000'
    )

    // The About page has no navigate handlers, so it must not pay the
    // useNavigate import cost.
    const aboutTsx = out.files.get('src/pages/about.tsx') as string
    expect(aboutTsx).not.toContain('useNavigate')
    expect(aboutTsx).not.toContain('navigate(')
  })

  test('multi-page compile reports a navigate target missing from the emitted router', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    addButtonWithNavigate(graph, home.id, '/not-emitted')
    const about = graph.addPage('About')
    const excluded = graph.addPage('Not Emitted')
    graph.updateNode(excluded.id, { lowcodeRoutePattern: '/not-emitted' })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'nav-missing-target' })
    })

    expect(out.warnings).toContainEqual(
      expect.objectContaining({ code: 'navigate-target-missing' })
    )
  })

  test('multi-page reusable component owns its useNavigate import and hook', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, { name: 'Home' })
    addReusableNav(graph, home.id, { to: '/about' })
    graph.addPage('About')

    const out = compile({
      graph,
      pageIds: graph.getPages().map((page) => page.id),
      options: withDefaults({ packageName: 'nav-component' })
    })

    const component = out.files.get('src/components/MenuNav.tsx') as string
    expect(component).toContain("import { useNavigate } from 'react-router-dom'")
    expect(component).toContain('const navigate = useNavigate()')
    expect(component).toContain('navigate("/about")')
  })

  test('reusable component navigate params import generatePath', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'ds-product', name: 'productId', type: 'string', defaultValue: 'one' }
      ]
    })
    addReusableNav(graph, home.id, {
      to: '/product/:id',
      params: { id: 'productId' }
    })
    const product = graph.addPage('Product')
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })

    const out = compile({
      graph,
      pageIds: graph.getPages().map((page) => page.id),
      options: withDefaults({ packageName: 'nav-component-params' })
    })

    const component = out.files.get('src/components/MenuNav.tsx') as string
    expect(component).toContain("import { useNavigate, generatePath } from 'react-router-dom'")
    expect(component).toContain('navigate(generatePath("/product/:id", { id: productId }))')
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

  test('single-page reusable component strips navigate with a warning', () => {
    const graph = makeGraph()
    const page = graph.getPages()[0]
    addReusableNav(graph, page.id, { to: '/about' })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'nav-component-singlepage' })
    })

    const component = out.files.get('src/components/MenuNav.tsx') as string
    expect(component).toContain('<button')
    expect(component).not.toContain('useNavigate')
    expect(component).not.toContain('navigate(')
    expect(component).not.toContain('onClick')
    expect(out.warnings.some((warning) => warning.code === 'action-navigate-no-router')).toBe(true)
  })

  test('component-ref root navigate makes the containing page declare useNavigate', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    const master = graph.createNode('COMPONENT', home.id, {
      name: 'Root Nav',
      width: 120,
      height: 40,
      events: { onClick: [{ id: 'root-nav', kind: 'navigate', to: '/about' }] }
    })
    graph.createNode('TEXT', master.id, { text: 'About' })
    graph.createInstance(master.id, home.id)
    graph.addPage('About')

    const out = compile({
      graph,
      pageIds: graph.getPages().map((page) => page.id),
      options: withDefaults({ packageName: 'nav-component-root' })
    })

    const page = out.files.get('src/pages/index.tsx') as string
    expect(page).toContain("import { useNavigate } from 'react-router-dom'")
    expect(page).toContain('const navigate = useNavigate()')
    expect(page).toContain('navigate("/about")')
  })

  test('navigate inside an IRConditional consequent still imports useNavigate (Phase 2 §9 regression)', () => {
    // Before the ir-walk fix, `nodeHasNavigate` early-returned on
    // IRConditional, so a BUTTON with onClick=navigate wrapped in a
    // `renderCondition` produced JSX that called `navigate(...)` against an
    // undefined identifier at runtime.
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, {
      name: 'Home',
      state: [{ id: 's-flag', name: 'flag', type: 'boolean', defaultValue: true }]
    })
    graph.createNode('BUTTON', home.id, {
      interactiveProps: { text: 'Go' },
      events: { onClick: [{ id: 'a1', kind: 'navigate', to: '/about' }] },
      renderCondition: 'flag'
    })
    graph.addPage('About')

    const pages = graph.getPages()
    const out = compile({
      graph,
      pageIds: pages.map((p) => p.id),
      options: withDefaults({ packageName: 'nav-cond' })
    })

    const indexTsx = out.files.get('src/pages/index.tsx') as string
    expect(indexTsx).toContain("import { useNavigate } from 'react-router-dom'")
    expect(indexTsx).toContain('const navigate = useNavigate()')
    expect(indexTsx).toContain('navigate("/about")')
  })

  test('navigate inside a LIST template still imports useNavigate (Phase 2 §9 regression)', () => {
    const graph = makeGraph()
    const home = graph.getPages()[0]
    graph.updateNode(home.id, {
      name: 'Home',
      state: [{ id: 's-users', name: 'users', type: 'array', defaultValue: [] }]
    })
    const list = graph.createNode('LIST', home.id, {
      interactiveProps: { dataSourceRef: { kind: 'stateRef', stateId: 's-users' } }
    })
    graph.createNode('BUTTON', list.id, {
      interactiveProps: { text: 'Go' },
      events: { onClick: [{ id: 'a1', kind: 'navigate', to: '/about' }] }
    })
    graph.addPage('About')

    const pages = graph.getPages()
    const out = compile({
      graph,
      pageIds: pages.map((p) => p.id),
      options: withDefaults({ packageName: 'nav-list' })
    })

    const indexTsx = out.files.get('src/pages/index.tsx') as string
    expect(indexTsx).toContain("import { useNavigate } from 'react-router-dom'")
    expect(indexTsx).toContain('const navigate = useNavigate()')
  })

  test('single-page compile strips navigate even when wrapped in IRConditional', () => {
    const graph = makeGraph()
    const page = graph.getPages()[0]
    graph.updateNode(page.id, {
      state: [{ id: 's-flag', name: 'flag', type: 'boolean', defaultValue: true }]
    })
    graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Go' },
      events: { onClick: [{ id: 'a1', kind: 'navigate', to: '/about' }] },
      renderCondition: 'flag'
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'nav-cond-single' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('useNavigate')
    expect(app).not.toContain('navigate(')
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
