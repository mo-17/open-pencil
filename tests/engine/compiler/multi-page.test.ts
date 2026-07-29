import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/core'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

/**
 * Build a fresh graph with the supplied page names, replacing the default
 * 'Page 1' that `new SceneGraph()` always creates. Returns the (renamed)
 * first page plus any explicitly added siblings, in declaration order.
 */
function buildMultiPageGraph(...names: string[]): {
  graph: SceneGraph
  pages: ReturnType<SceneGraph['getPages']>
} {
  const graph = new SceneGraph()
  const [first] = graph.getPages()
  if (names.length > 0) first.name = names[0]
  for (let i = 1; i < names.length; i++) graph.addPage(names[i])
  return { graph, pages: graph.getPages() }
}

/**
 * Phase 1 §11 — multi-page compile + react-router-dom emission.
 */
describe('compile — multi-page emission (Phase 1 §11)', () => {
  test('single-page input keeps the legacy App.tsx shape with no react-router-dom dep', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'one-page' })
    })

    const paths = [...out.files.keys()].sort()
    expect(paths).toEqual(
      [
        '.gitignore',
        'index.html',
        'package.json',
        'src/App.tsx',
        'src/__motion-runtime.ts',
        'src/__preview-bridge.ts',
        'src/index.css',
        'src/main.tsx',
        'tsconfig.json',
        'vite.config.ts'
      ].sort()
    )

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('export default function App')
    expect(app).toContain(`<div className="relative min-h-screen" data-node-id="${pageId}">`)
    expect(app).not.toContain('BrowserRouter')

    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['react-router-dom']).toBeUndefined()
  })

  test('multi-page input emits router shell + one module per page + react-router-dom dep', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About', 'Contact')
    const [home, about, contact] = pages

    graph.createNode('BUTTON', home.id, { interactiveProps: { text: 'home-btn' } })
    graph.createNode('BUTTON', about.id, { interactiveProps: { text: 'about-btn' } })
    graph.createNode('BUTTON', contact.id, { interactiveProps: { text: 'contact-btn' } })

    const out = compile({
      graph,
      pageIds: [home.id, about.id, contact.id],
      options: withDefaults({ packageName: 'three-pages' })
    })

    const paths = [...out.files.keys()].sort()
    expect(paths).toContain('src/App.tsx')
    expect(paths).toContain('src/pages/index.tsx')
    expect(paths).toContain('src/pages/about.tsx')
    expect(paths).toContain('src/pages/contact.tsx')

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import { BrowserRouter, Route, Routes } from 'react-router-dom'")
    expect(app).toContain("import PageIndex from './pages/index'")
    expect(app).toContain("import PageAbout from './pages/about'")
    expect(app).toContain("import PageContact from './pages/contact'")
    expect(app).toContain('<BrowserRouter>')
    expect(app).toContain('<Routes>')
    expect(app).toContain('<Route path="/" element={<PageIndex />} />')
    expect(app).toContain('<Route path="/about" element={<PageAbout />} />')
    expect(app).toContain('<Route path="/contact" element={<PageContact />} />')

    // Each page module emits its own wrapper + scoped function name.
    const indexPage = out.files.get('src/pages/index.tsx') as string
    expect(indexPage).toContain('export default function PageIndex')
    expect(indexPage).toContain(`<div className="relative min-h-screen" data-node-id="${home.id}">`)
    expect(indexPage).toContain('>home-btn</button>')
    // Page modules must NOT import the bridge — App.tsx owns that import.
    expect(indexPage).not.toContain('__preview-bridge')

    const aboutPage = out.files.get('src/pages/about.tsx') as string
    expect(aboutPage).toContain('export default function PageAbout')
    expect(aboutPage).toContain('>about-btn</button>')

    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }
    expect(pkg.dependencies['react-router-dom']).toBe('^6.27.0')
  })

  test('devMode=true: router shell imports the preview bridge once; pages do not', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About')
    const [home, about] = pages

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'two-pages-dev' }) // devMode defaults true
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import './__preview-bridge'")

    for (const slug of ['index', 'about']) {
      const page = out.files.get(`src/pages/${slug}.tsx`) as string
      expect(page).not.toContain('__preview-bridge')
    }
    expect(out.files.has('src/__preview-bridge.ts')).toBe(true)
  })

  test('devMode=false: no bridge import in router shell; no bridge file', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About')
    const [home, about] = pages

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'two-pages-prod', devMode: false })
    })

    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('__preview-bridge')
    expect(out.files.has('src/__preview-bridge.ts')).toBe(false)
  })

  test('duplicate page names → second slug suffixed and a multi-page-duplicate-slug warning is emitted', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About', 'About')
    const [home, aboutA, aboutB] = pages

    const out = compile({
      graph,
      pageIds: [home.id, aboutA.id, aboutB.id],
      options: withDefaults({ packageName: 'dup-names' })
    })

    const paths = [...out.files.keys()]
    expect(paths).toContain('src/pages/about.tsx')
    expect(paths).toContain('src/pages/about-2.tsx')

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('<Route path="/about" element={<PageAbout />} />')
    expect(app).toContain('<Route path="/about-2" element={<PageAbout2 />} />')

    const dupWarning = out.warnings.find((w) => w.code === 'multi-page-duplicate-slug')
    expect(dupWarning).toBeDefined()
    expect(dupWarning?.nodeId).toBe(aboutB.id)
  })

  test('IR warnings from every page surface (not just page 0)', () => {
    const { graph, pages } = buildMultiPageGraph('Home', 'About')
    const [home, about] = pages

    home.state = [{ id: 's-home', name: '1bad-home', type: 'number', defaultValue: 0 }]
    about.state = [{ id: 's-about', name: '1bad-about', type: 'boolean', defaultValue: false }]

    const out = compile({
      graph,
      pageIds: [home.id, about.id],
      options: withDefaults({ packageName: 'state-warnings' })
    })

    const invalidWarnings = out.warnings.filter((w) => w.code === 'state-invalid')
    const nodeIds = invalidWarnings.map((w) => w.nodeId).sort()
    expect(nodeIds).toEqual([home.id, about.id].sort())
  })

  test('empty pageIds keeps returning the no-pages warning', () => {
    const graph = makeSceneGraph()
    const out = compile({
      graph,
      pageIds: [],
      options: withDefaults()
    })
    expect(out.files.size).toBe(0)
    expect(out.warnings.map((w) => w.code)).toContain('no-pages')
  })
})
