import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('compile (public API, end-to-end)', () => {
  test('emits a runnable Vite + React + TS project', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'demo-app' })
    })

    const paths = [...out.files.keys()].sort()
    expect(paths).toEqual(
      [
        '.gitignore',
        'index.html',
        'package.json',
        'src/App.tsx',
        'src/index.css',
        'src/main.tsx',
        'tsconfig.json',
        'vite.config.ts'
      ].sort()
    )

    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      name: string
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.name).toBe('demo-app')
    expect(pkg.dependencies.react).toBeDefined()
    expect(pkg.dependencies['react-dom']).toBeDefined()
    expect(pkg.devDependencies['@tailwindcss/vite']).toBeDefined()

    const indexHtml = out.files.get('index.html') as string
    expect(indexHtml).toContain('<title>demo-app</title>')
    expect(indexHtml).toContain('/src/main.tsx')

    const mainTsx = out.files.get('src/main.tsx') as string
    expect(mainTsx).toContain("import App from './App'")
    expect(mainTsx).toContain("import './index.css'")
    expect(mainTsx).toContain('createRoot')

    const indexCss = out.files.get('src/index.css') as string
    expect(indexCss).toContain('@import "tailwindcss"')

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('export default function App')

    const viteConfig = out.files.get('vite.config.ts') as string
    expect(viteConfig).toContain('@tailwindcss/vite')
  })

  test('translates a BUTTON + TEXT page into JSX', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId)
    graph.createNode('TEXT', pageId, { text: 'Hello world' })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults()
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('<button')
    expect(appTsx).toContain('>Button</button>')
    expect(appTsx).toContain('<p')
    expect(appTsx).toContain('>Hello world</p>')
  })

  test("target='vue' returns target-not-implemented warning, no files", () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'vue', router: 'vue-router-v4' })
    })

    expect(out.files.size).toBe(0)
    expect(out.warnings.map((w) => w.code)).toContain('target-not-implemented')
  })

  test('returns no-pages warning when pageIds is empty', () => {
    const graph = makeSceneGraph()
    const out = compile({
      graph,
      pageIds: [],
      options: withDefaults()
    })
    expect(out.files.size).toBe(0)
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0].code).toBe('no-pages')
  })

  test('html-escapes packageName in the title', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'a&b<c>' })
    })
    const indexHtml = out.files.get('index.html') as string
    expect(indexHtml).toContain('<title>a&amp;b&lt;c&gt;</title>')
  })
})
