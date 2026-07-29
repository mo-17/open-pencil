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
        'src/__motion-runtime.ts',
        'src/__preview-bridge.ts',
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

  test('preserves every authored LIST row when no dynamic datasource is configured', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const list = graph.createNode('LIST', pageId, {
      name: 'PackingChecklist',
      layoutMode: 'VERTICAL',
      width: 358,
      height: 88
    })
    const foodRow = graph.createNode('FRAME', list.id, {
      name: 'FoodRow',
      layoutMode: 'HORIZONTAL',
      width: 358,
      height: 44
    })
    graph.createNode('CHECKBOX', foodRow.id, { name: 'FoodCheckbox' })
    graph.createNode('TEXT', foodRow.id, { name: 'FoodLabel', text: '梅子饭团便当' })
    graph.createNode('TEXT', foodRow.id, { name: 'FoodMeta', text: '补充体力' })
    const charmRow = graph.createNode('FRAME', list.id, {
      name: 'CharmRow',
      layoutMode: 'HORIZONTAL',
      width: 358,
      height: 44
    })
    graph.createNode('CHECKBOX', charmRow.id, { name: 'CharmCheckbox' })
    graph.createNode('TEXT', charmRow.id, { name: 'CharmLabel', text: '晴天护身符' })
    graph.createNode('TEXT', charmRow.id, { name: 'CharmMeta', text: '尚未选择' })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults()
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('梅子饭团便当')
    expect(appTsx).toContain('补充体力')
    expect(appTsx).toContain('晴天护身符')
    expect(appTsx).toContain('尚未选择')
    expect(appTsx.match(/<input/g)).toHaveLength(2)
    expect(appTsx).not.toContain('.map((')
    expect(out.warnings.some((warning) => warning.code === 'list-no-datasource')).toBe(false)
  })

  test('preserves 20px corner radius with a valid Tailwind arbitrary class', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, { width: 100, height: 100, cornerRadius: 20 })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults()
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('rounded-[20px]')
    expect(appTsx).not.toContain('rounded-5')
  })

  test('preserves 20px stroke width with a valid Tailwind arbitrary class', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('RECTANGLE', pageId, {
      width: 100,
      height: 100,
      strokes: [
        {
          color: { r: 1, g: 0, b: 0, a: 1 },
          weight: 20,
          opacity: 1,
          visible: true,
          align: 'INSIDE'
        }
      ]
    })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults()
    })

    const appTsx = out.files.get('src/App.tsx') as string
    expect(appTsx).toContain('border-[20px]')
    expect(appTsx).not.toContain('border-5')
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

  test('devMode=true emits the preview bridge and data-node-id', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const btn = graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults() // default devMode is true
    })

    expect(out.files.has('src/__preview-bridge.ts')).toBe(true)
    const bridge = out.files.get('src/__preview-bridge.ts') as string
    expect(bridge).toContain('op-lowcode-editor')
    expect(bridge).toContain('op-lowcode-preview')
    expect(bridge).toContain('data-node-id')

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain("import './__preview-bridge'")
    expect(app).toContain(`data-node-id="${btn.id}"`)
  })

  test('devMode=false omits the bridge file and data-node-id attributes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Go' } })

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ devMode: false })
    })

    expect(out.files.has('src/__preview-bridge.ts')).toBe(false)
    const app = out.files.get('src/App.tsx') as string
    expect(app).not.toContain('__preview-bridge')
    expect(app).not.toContain('data-node-id')
  })
})
