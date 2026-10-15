import { describe, expect, test } from 'bun:test'
import { dirname } from 'node:path'

import { APPLICATION_GUARDS_FILE } from '#compiler/adapters/application-guards/emit'
import { BrowserPreviewBuildError } from '#compiler/browser-preview/error'
import { buildBrowserPreview } from '#compiler/browser-preview/index'
import { prepareBrowserPreviewReactFiles } from '#compiler/browser-preview/routing'
import { compile, withDefaults } from '#compiler/index'

import { applicationGuardsFixture } from '#tests/helpers/compiler/application-guards/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
import { repoPath } from '#tests/helpers/paths'

import { browserPreviewInput } from '../browser-preview/helpers'

function routerDirectories(): Record<string, string> {
  const compiler = repoPath('packages/compiler/')
  const dom = Bun.resolveSync('react-router-dom/package.json', compiler)
  const router = Bun.resolveSync('react-router/package.json', dirname(dom))
  return { 'react-router-dom': dirname(dom), 'react-router': dirname(router) }
}

function project(target: 'react' | 'vue', rootStart = false) {
  const { graph, home } = applicationGuardsFixture()
  if (rootStart) {
    graph.updateNode(home.id, { lowcodeRoutePattern: '/' })
    for (const node of graph.getAllNodes()) {
      if (!node.events) continue
      const events = Object.fromEntries(
        Object.entries(node.events).map(([key, actions]) => [
          key,
          actions.map((action) => {
            if (action.kind === 'navigate' && action.to)
              return { ...action, to: action.to.replace(/^\/home(?=[?#]|$)/, '/') }
            if (action.kind === 'back')
              return { ...action, fallback: action.fallback.replace(/^\/home(?=[?#]|$)/, '/') }
            return action
          })
        ])
      )
      graph.updateNode(node.id, { events })
    }
    const products = graph.getPages().find((page) => page.lowcodeApplicationPage?.enterGuard)
    if (!products?.lowcodeApplicationPage?.enterGuard) throw new Error('Missing enter guard')
    graph.updateNode(products.id, {
      lowcodeApplicationPage: {
        ...products.lowcodeApplicationPage,
        enterGuard: { ...products.lowcodeApplicationPage.enterGuard, fallback: '/' }
      }
    })
  }
  return compile({
    graph,
    pageIds: graph.getPages().map(({ id }) => id),
    options: withDefaults({
      target,
      devMode: true,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6'
    })
  })
}
function source(files: ReadonlyMap<string, string | Uint8Array>, path: string) {
  const content = files.get(path)
  if (typeof content !== 'string') throw new Error('Missing generated source: ' + path)
  return content
}
for (const target of ['react', 'vue'] as const) {
  describe(`${target} authored application guards`, () => {
    test('generates type-correct guarded application source', () => {
      const output = project(target)
      expect(output.warnings).toEqual([])
      expect(output.files.has(APPLICATION_GUARDS_FILE)).toBe(true)
      const files = new Map(
        [...output.files].flatMap(([path, content]) =>
          typeof content === 'string' ? [[path, content]] : []
        )
      )
      typeCheckCompilerFiles(
        files,
        target,
        target === 'react'
          ? {
              preserveSymlinks: true,
              extraDependencies: ['react-router'],
              dependencyDirectories: routerDirectories()
            }
          : {}
      )
    }, 60000)
    test('disabled application authored guards remain byte-compatible', () => {
      const { graph, products } = applicationGuardsFixture()
      const policy = products.lowcodeApplicationPage
      if (!policy) throw new Error('Missing guard fixture policy')
      graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
      const build = () =>
        compile({
          graph,
          pageIds: graph.getPages().map(({ id }) => id),
          options: withDefaults({ target, devMode: true })
        })
      const authored = build()
      const { enterGuard: _enter, leaveConfirm: _leave, ...absent } = policy
      graph.updateNode(products.id, { lowcodeApplicationPage: absent })
      const legacy = build()
      expect([...authored.files]).toEqual([...legacy.files])
      expect(authored.warnings).toEqual(legacy.warnings)
      expect(legacy.files.has(APPLICATION_GUARDS_FILE)).toBe(false)
    })
    test('page references cannot authorize entry', () => {
      const { graph, products } = applicationGuardsFixture()
      const policy = products.lowcodeApplicationPage
      if (!policy) throw new Error('Missing guard fixture policy')
      graph.updateNode(products.id, {
        lowcodeApplicationPage: {
          ...policy,
          enterGuard: { conditionExpr: 'detailDraft === ""', fallback: '/home' }
        }
      })
      const output = compile({
        graph,
        pageIds: graph.getPages().map(({ id }) => id),
        options: withDefaults({ target })
      })
      expect(output.files.size).toBe(0)
      expect(
        output.warnings.some((warning) => warning.code === 'application-page-guard-invalid')
      ).toBe(true)
    })
    for (const rootStart of [false, true])
      test(`bundles guarded ${rootStart ? 'root' : 'homepage redirect'} route for Blob preview`, async () => {
        const output = project(target, rootStart)
        const built = await buildBrowserPreview(await browserPreviewInput(output.files, { target }))
        if (target === 'vue') {
          expect(built.status).toBe('unsupported')
          if (built.status === 'unsupported')
            expect(built.reason.code).toBe('browser-preview-vue-unsupported')
          return
        }
        expect(built.status).toBe('ready')
        if (built.status === 'ready') {
          expect(built.html).toContain('Leave this page?')
          expect(built.html).toContain('hasAccess')
        }
      }, 60000)
  })
}
for (const rootStart of [false, true]) {
  test(`rejects modified guarded React ${rootStart ? 'root' : 'redirect'} shell`, () => {
    const files = project('react', rootStart).files
    const app = source(files, 'src/App.tsx')
    expect(
      source(prepareBrowserPreviewReactFiles(files, 'guard_test').files, 'src/App.tsx')
    ).toContain('createHashRouter')
    for (const modify of [
      (text: string) =>
        text.replace('<ApplicationGuardLayout />', '<><ApplicationGuardLayout /><Extra /></>'),
      (text: string) => text.replace('retention="preserve"', 'retention="unknown"'),
      (text: string) =>
        text.replace(
          /<ApplicationGuardPage pageId="[^"]+"/,
          '<ApplicationGuardPage pageId="unknown"'
        ),
      (text: string) => text.replace('createBrowserRouter([', 'createBrowserRouter(dynamic || ['),
      (text: string) =>
        text.replace('  ] }', '    { path: "/injected", element: <Extra /> }\n  ] }')
    ]) {
      const modified = new Map(files)
      modified.set('src/App.tsx', modify(app))
      expect(() => prepareBrowserPreviewReactFiles(modified, 'guard_test')).toThrow(
        BrowserPreviewBuildError
      )
    }
  })
}
