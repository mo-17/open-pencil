import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/core'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'

/**
 * Phase 4 §16.1 — dynamic routing: a page may declare a `lowcodeRoutePattern`
 * (`/product/:id`) that overrides the slug-derived route, and any page
 * expression may read a route parameter via `$params.<name>` (compiled to a
 * `const $params = useParams()` hook). Route params only resolve inside the
 * multi-page router; single-page App.tsx has no router context.
 */

/** A page with a TEXT node whose text binding reads `expr`. */
function makeTextExprTree(expr: string, routePattern?: string) {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  if (routePattern !== undefined) graph.updateNode(page.id, { lowcodeRoutePattern: routePattern })
  graph.createNode('TEXT', page.id, {
    text: 'fallback',
    bindings: { text: { kind: 'expr', expr } }
  })
  return collectTree(graph, page.id)
}

describe('Phase 4 §16.1 — collect: routePattern + $params read-context', () => {
  test('page lowcodeRoutePattern is lifted onto IRTree.routePattern', () => {
    const ir = makeTextExprTree('"x"', '/product/:id')
    expect(ir.routePattern).toBe('/product/:id')
    // No `$params` read → flag stays false.
    expect(ir.usesRouteParams).toBe(false)
  })

  test('$params.<name> read sets usesRouteParams without polluting docStateReads', () => {
    const ir = makeTextExprTree('$params.id', '/product/:id')
    expect(ir.usesRouteParams).toBe(true)
    // `$params` rode docStateReads during the walk but is extracted out.
    expect(ir.docStateReads).not.toContain('$params')
    expect(ir.warnings).toEqual([])
    // The expression survives (not dropped to the fallback literal).
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    expect(child.references).toContain('$params')
  })

  test('$params is accepted even without a route pattern (degenerate but valid)', () => {
    const ir = makeTextExprTree('$params.id')
    expect(ir.routePattern).toBeUndefined()
    expect(ir.usesRouteParams).toBe(true)
    expect(ir.warnings).toEqual([])
  })

  test('a route pattern missing the leading slash warns and falls back to the slug route', () => {
    const ir = makeTextExprTree('"x"', 'product/:id')
    expect(ir.routePattern).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'route-pattern-invalid')).toBe(true)
  })

  test('no routePattern + no $params → IRTree carries the defaults (zero-regression)', () => {
    const ir = makeTextExprTree('"x"')
    expect(ir.routePattern).toBeUndefined()
    expect(ir.usesRouteParams).toBe(false)
  })
})

/** Build a multi-page graph with the given page names. */
function buildMultiPageGraph(...names: string[]) {
  const graph = new SceneGraph()
  const [first] = graph.getPages()
  if (names.length > 0) first.name = names[0]
  for (let i = 1; i < names.length; i++) graph.addPage(names[i])
  return { graph, pages: graph.getPages() }
}

describe('Phase 4 §16.1 — emit: dynamic Route path + useParams hook', () => {
  test('a page route pattern overrides the slug route in the router shell', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('TEXT', home.id, { text: 'Home' })
    graph.createNode('TEXT', product.id, { text: 'Product' })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'routed' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Route path="/" element={<PageIndex />} />')
    // The slug page file is still `product.tsx`; only the <Route path> is dynamic.
    expect(app).toContain('<Route path="/product/:id" element={<PageProduct />} />')
    expect([...out.files.keys()]).toContain('src/pages/product.tsx')
  })

  test('a page reading $params emits the useParams hook + import in its module', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('TEXT', product.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'route-params' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain("import { useParams } from 'react-router-dom'")
    expect(productPage).toContain('const $params = useParams()')
    expect(productPage).toContain('$params.id')
  })

  test('a page using both navigate and $params shares one react-router-dom import', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('BUTTON', product.id, {
      interactiveProps: { text: 'Home' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/' }] }
    })
    graph.createNode('TEXT', product.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'nav-and-params' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain("import { useNavigate, useParams } from 'react-router-dom'")
    expect(productPage).toContain('const navigate = useNavigate()')
    expect(productPage).toContain('const $params = useParams()')
  })

  test('single-page: $params is not emitted (no router context)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$params.id' } }
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'single-page' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('useParams')
    expect(app).not.toContain('react-router-dom')
  })

  test('no routePattern + no $params → router shell keeps the slug routes (byte-identical)', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About')
    const [home, about] = pages
    graph.createNode('TEXT', home.id, { text: 'Home' })
    graph.createNode('TEXT', about.id, { text: 'About' })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'no-routing' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Route path="/about" element={<PageAbout />} />')
    const aboutPage = out.files.get('src/pages/about.tsx') as string
    expect(aboutPage).not.toContain('useParams')
  })
})
