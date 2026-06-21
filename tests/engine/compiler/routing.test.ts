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

/**
 * Phase 4 §16.2 — navigate with route params: a `navigate` action may carry
 * `params: { name: exprString }` so a dynamic target's `:segments` are filled
 * from caller-scope expressions, emitted as
 * `navigate(generatePath("/product/:id", { id: <expr> }))`.
 */
describe('Phase 4 §16.2 — collect: navigate route params', () => {
  function navHandler(params?: Record<string, string>, opts?: { state?: boolean }) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (opts?.state) {
      graph.updateNode(page.id, {
        state: [{ id: 's1', name: 'pid', type: 'string', defaultValue: '' }]
      })
    }
    graph.createNode('BUTTON', page.id, {
      interactiveProps: { text: 'Go' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/product/:id', params }] }
    })
    const ir = collectTree(graph, page.id)
    const btn = ir.children[0]
    if (btn.kind !== 'element') throw new Error('expected element')
    return { ir, h: btn.events?.onClick?.[0] }
  }

  test('navigate params are parsed into IRNavigateHandler.params', () => {
    const { h } = navHandler({ id: 'pid' }, { state: true })
    if (h?.kind !== 'navigate') throw new Error('expected navigate handler')
    expect(h.params?.[0]?.name).toBe('id')
    expect(h.params?.[0]?.references).toContain('pid')
  })

  test('a navigate param reading $params sets usesRouteParams (sentinel-ride, no docStateReads pollution)', () => {
    const { ir, h } = navHandler({ id: '$params.slug' })
    if (h?.kind !== 'navigate') throw new Error('expected navigate handler')
    expect(ir.usesRouteParams).toBe(true)
    expect(ir.docStateReads).not.toContain('$params')
    expect(ir.warnings).toEqual([])
  })

  test('navigate with no params carries no params field (zero-regression)', () => {
    const { h } = navHandler()
    if (h?.kind !== 'navigate') throw new Error('expected navigate handler')
    expect(h.params).toBeUndefined()
  })

  test('an unknown identifier in a navigate param drops the handler with a warning', () => {
    const { ir, h } = navHandler({ id: 'nope' })
    expect(h).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-navigate-param-unknown-identifier')).toBe(true)
  })

  test('an unparseable navigate param expression drops the handler with a warning', () => {
    const { ir, h } = navHandler({ id: '1 +' })
    expect(h).toBeUndefined()
    expect(ir.warnings.some((w) => w.code === 'action-navigate-param-invalid-value')).toBe(true)
  })
})

describe('Phase 4 §16.2 — emit: navigate(generatePath(...))', () => {
  test('navigate with params emits generatePath + the merged react-router-dom import', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, {
      state: [{ id: 's1', name: 'pid', type: 'string', defaultValue: '' }]
    })
    graph.createNode('TEXT', home.id, { text: 'Home' })
    graph.createNode('BUTTON', product.id, {
      interactiveProps: { text: 'Open' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/product/:id', params: { id: 'pid' } }] }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'nav-params' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain("import { useNavigate, generatePath } from 'react-router-dom'")
    expect(productPage).toContain('const navigate = useNavigate()')
    expect(productPage).toContain('navigate(generatePath("/product/:id", { id: pid }))')
  })

  test('navigate without params stays a literal navigate (no generatePath import)', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About')
    const [home, about] = pages
    graph.createNode('BUTTON', home.id, {
      interactiveProps: { text: 'About' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/about' }] }
    })
    graph.createNode('TEXT', about.id, { text: 'About' })

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'nav-plain' })
    })

    const homePage = out.files.get('src/pages/index.tsx') as string
    expect(homePage).toContain('navigate("/about")')
    expect(homePage).toContain("import { useNavigate } from 'react-router-dom'")
    expect(homePage).not.toContain('generatePath')
  })

  test('a navigate param passing $params through emits generatePath with the $params read', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('BUTTON', product.id, {
      interactiveProps: { text: 'Reopen' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/product/:id', params: { id: '$params.id' } }] }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'nav-params-passthrough' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain('const $params = useParams()')
    expect(productPage).toContain('navigate(generatePath("/product/:id", { id: $params.id }))')
  })

  test('navigate params nested inside a condition branch still import generatePath (经验 A branch descent)', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, {
      state: [
        { id: 's1', name: 'ok', type: 'boolean', defaultValue: false },
        { id: 's2', name: 'pid', type: 'string', defaultValue: '' }
      ]
    })
    graph.createNode('BUTTON', product.id, {
      interactiveProps: { text: 'Maybe' },
      events: {
        onClick: [
          {
            id: 'c1',
            kind: 'condition',
            condExpr: 'ok',
            consequent: [{ id: 'n1', kind: 'navigate', to: '/product/:id', params: { id: 'pid' } }]
          }
        ]
      }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'nav-cond' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain('generatePath')
    expect(productPage).toContain('navigate(generatePath("/product/:id", { id: pid }))')
  })
})

/**
 * Phase 4 §16.3 — auth guard: a page may declare `lowcodeRequiresAuth` so the
 * multi-page compile emits a redirect-if-unauthenticated guard
 * (`if (!$currentUser.signedIn) return <Navigate to="/login" replace />`).
 * Needs Supabase (the `$currentUser` doc-state); the redirect route comes from
 * the root's `lowcodeAuthRedirect` (default `/login`).
 */
const SUPA_CONFIG = { url: 'https://x.supabase.co', anonKey: 'eyJ.anon.sig' }

describe('Phase 4 §16.3 — collect: auth guard', () => {
  function collectGuarded(opts: { supabase?: boolean; authRedirect?: string; requiresAuth?: boolean } = {}) {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (opts.supabase) graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SUPA_CONFIG })
    if (opts.authRedirect !== undefined) graph.updateNode(graph.rootId, { lowcodeAuthRedirect: opts.authRedirect })
    if (opts.requiresAuth) graph.updateNode(page.id, { lowcodeRequiresAuth: true })
    graph.createNode('TEXT', page.id, { text: 'secret' })
    return collectTree(graph, page.id)
  }

  test('requiresAuth + Supabase → requiresAuth flag, default /login redirect, $currentUser read', () => {
    const ir = collectGuarded({ supabase: true, requiresAuth: true })
    expect(ir.requiresAuth).toBe(true)
    expect(ir.authRedirect).toBe('/login')
    expect(ir.docStateReads).toContain('$currentUser')
    expect(ir.warnings).toEqual([])
  })

  test('root lowcodeAuthRedirect overrides the default redirect route', () => {
    const ir = collectGuarded({ supabase: true, requiresAuth: true, authRedirect: '/signin' })
    expect(ir.authRedirect).toBe('/signin')
  })

  test('requiresAuth without Supabase → warns and stays public (no guard)', () => {
    const ir = collectGuarded({ requiresAuth: true })
    expect(ir.requiresAuth).toBeUndefined()
    expect(ir.docStateReads).not.toContain('$currentUser')
    expect(ir.warnings.some((w) => w.code === 'auth-guard-no-supabase')).toBe(true)
  })

  test('no requiresAuth → no guard fields (zero-regression)', () => {
    const ir = collectGuarded({ supabase: true })
    expect(ir.requiresAuth).toBeUndefined()
    expect(ir.authRedirect).toBeUndefined()
  })
})

describe('Phase 4 §16.3 — emit: <Navigate> redirect guard', () => {
  function buildGuardedMultiPage(authRedirect?: string) {
    const { graph, pages } = buildMultiPageGraph('Home', 'Dashboard')
    const [home, dashboard] = pages
    const rootPatch = authRedirect !== undefined
      ? { lowcodeSupabaseConfig: SUPA_CONFIG, lowcodeAuthRedirect: authRedirect }
      : { lowcodeSupabaseConfig: SUPA_CONFIG }
    graph.updateNode(graph.rootId, rootPatch)
    graph.updateNode(dashboard.id, { lowcodeRequiresAuth: true })
    graph.createNode('TEXT', home.id, { text: 'Home' })
    graph.createNode('TEXT', dashboard.id, { text: 'Secret' })
    return compile({
      graph,
      pageIds: [home.id, dashboard.id],
      options: withDefaults({ packageName: 'guarded' })
    })
  }

  test('guarded page emits Navigate import + $currentUser read + the redirect guard', () => {
    const out = buildGuardedMultiPage()
    const dash = out.files.get('src/pages/dashboard.tsx') as string
    expect(dash).toContain("import { Navigate } from 'react-router-dom'")
    expect(dash).toContain('const $currentUser = useDocState("$currentUser")')
    expect(dash).toContain('if (!$currentUser.signedIn) return <Navigate to="/login" replace />')
    // The public Home page carries no guard.
    const home = out.files.get('src/pages/index.tsx') as string
    expect(home).not.toContain('<Navigate')
  })

  test('custom root authRedirect drives the Navigate target', () => {
    const out = buildGuardedMultiPage('/signin')
    const dash = out.files.get('src/pages/dashboard.tsx') as string
    expect(dash).toContain('<Navigate to="/signin" replace />')
  })

  test('single-page compile drops the guard with a warning (no router to redirect)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: SUPA_CONFIG })
    graph.updateNode(page.id, { lowcodeRequiresAuth: true })
    graph.createNode('TEXT', page.id, { text: 'Secret' })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'guarded-single' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('<Navigate')
    expect(out.warnings.some((w) => w.code === 'auth-guard-no-router')).toBe(true)
  })
})

/**
 * Phase 4 §16.4 — query string: a page expression may read a URL query param via
 * `$query.<name>` (parallel to §16.1 `$params`), compiled to a
 * `const $query = Object.fromEntries(useSearchParams()[0])` hook. Query params
 * only resolve inside the multi-page router; single-page App.tsx has none.
 */
describe('Phase 4 §16.4 — collect: $query read-context', () => {
  test('$query.<name> read sets usesQueryParams without polluting docStateReads', () => {
    const ir = makeTextExprTree('$query.sort')
    expect(ir.usesQueryParams).toBe(true)
    expect(ir.docStateReads).not.toContain('$query')
    expect(ir.warnings).toEqual([])
    const text = ir.children[0]
    if (text.kind !== 'element') throw new Error('expected element')
    const child = text.children[0]
    if (child.kind !== 'expression') throw new Error('expected expression child')
    expect(child.references).toContain('$query')
  })

  test('$params and $query can be read together on one page', () => {
    const ir = makeTextExprTree('$params.id + $query.sort', '/product/:id')
    expect(ir.usesRouteParams).toBe(true)
    expect(ir.usesQueryParams).toBe(true)
    expect(ir.docStateReads).not.toContain('$params')
    expect(ir.docStateReads).not.toContain('$query')
    expect(ir.warnings).toEqual([])
  })

  test('no $query → usesQueryParams false (zero-regression)', () => {
    const ir = makeTextExprTree('"x"')
    expect(ir.usesQueryParams).toBe(false)
  })
})

describe('Phase 4 §16.4 — emit: useSearchParams hook', () => {
  test('a page reading $query emits the useSearchParams hook + import + $query read', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Products')
    const [home, products] = pages
    graph.createNode('TEXT', products.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$query.sort' } }
    })

    const out = compile({
      graph,
      pageIds: [home.id, products.id],
      options: withDefaults({ packageName: 'query-read' })
    })

    const productsPage = out.files.get('src/pages/products.tsx') as string
    expect(productsPage).toContain("import { useSearchParams } from 'react-router-dom'")
    expect(productsPage).toContain('const $query = Object.fromEntries(useSearchParams()[0])')
    expect(productsPage).toContain('$query.sort')
  })

  test('a page using navigate + $params + $query shares one react-router-dom import', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'Product')
    const [home, product] = pages
    graph.updateNode(product.id, { lowcodeRoutePattern: '/product/:id' })
    graph.createNode('BUTTON', product.id, {
      interactiveProps: { text: 'Home' },
      events: { onClick: [{ id: 'n1', kind: 'navigate', to: '/' }] }
    })
    graph.createNode('TEXT', product.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$params.id + $query.tab' } }
    })

    const out = compile({
      graph,
      pageIds: [home.id, product.id],
      options: withDefaults({ packageName: 'nav-params-query' })
    })

    const productPage = out.files.get('src/pages/product.tsx') as string
    expect(productPage).toContain(
      "import { useNavigate, useParams, useSearchParams } from 'react-router-dom'"
    )
    expect(productPage).toContain('const navigate = useNavigate()')
    expect(productPage).toContain('const $params = useParams()')
    expect(productPage).toContain('const $query = Object.fromEntries(useSearchParams()[0])')
  })

  test('single-page: $query is not emitted (no router context)', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('TEXT', page.id, {
      text: 'fallback',
      bindings: { text: { kind: 'expr', expr: '$query.sort' } }
    })

    const out = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ packageName: 'query-single' })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('useSearchParams')
    expect(app).not.toContain('react-router-dom')
  })
})
