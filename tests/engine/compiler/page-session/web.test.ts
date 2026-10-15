import { describe, expect, test } from 'bun:test'

import { APPLICATION_SESSION_FILE } from '#compiler/adapters/application-session/runtime'
import { BrowserPreviewBuildError } from '#compiler/browser-preview/error'
import { prepareBrowserPreviewReactFiles } from '#compiler/browser-preview/routing'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'

import {
  applicationSessionFixture,
  compileApplicationSessionFixture
} from '#tests/helpers/compiler/application-session/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

import { browserPreviewInput } from '../browser-preview/helpers'

for (const target of ['react', 'vue'] as const) {
  describe(`${target} application page sessions`, () => {
    test('retains only declared writable page values and emits type-correct standalone source', () => {
      const output = compileApplicationSessionFixture(target)
      expect(output.warnings).toEqual([])
      const runtime = output.files.get(APPLICATION_SESSION_FILE)
      expect(runtime).toContain('"filter":"string"')
      expect(runtime).toContain('"page":"number"')
      expect(runtime).not.toContain('"summary":"string"')
      expect(runtime).not.toContain('localStorage')
      expect(runtime).not.toContain('querySelector')
      const sources = new Map(
        [...output.files].flatMap(([path, value]) =>
          typeof value === 'string' ? [[path, value]] : []
        )
      )
      typeCheckCompilerFiles(
        sources,
        target,
        target === 'react'
          ? { preserveSymlinks: true, extraDependencies: ['react-router', '@remix-run/router'] }
          : {}
      )
    }, 60000)

    test('an absent policy and application-disabled authored policies preserve output bytes', () => {
      const { graph, home } = applicationSessionFixture()
      const policy = home.lowcodeApplicationPage
      if (!policy) throw new Error('Missing fixture policy')
      graph.updateNode(graph.rootId, { lowcodeApplication: { version: 1, enabled: false } })
      const project = () =>
        compile({
          graph,
          pageIds: graph.getPages().map((page) => page.id),
          options: withDefaults({ target, devMode: false })
        })
      const authored = project()
      const { stateRetention: _removed, ...original } = policy
      graph.updateNode(home.id, { lowcodeApplicationPage: original })
      const absent = project()
      expect([...authored.files]).toEqual([...absent.files])
      expect(authored.warnings).toEqual(absent.warnings)
      expect(absent.files.has(APPLICATION_SESSION_FILE)).toBe(false)
    })

    test('reset is explicit but emits no retained page-state hooks', () => {
      const output = compileApplicationSessionFixture(target, 'reset')
      const page = [...output.files].find(([path]) => path.startsWith('src/pages/index.'))?.[1]
      expect(page).toBeDefined()
      expect(page).not.toContain('__opUseApplicationPageState(')
      const app = output.files.get(target === 'react' ? 'src/App.tsx' : 'src/App.vue')
      expect(app).toContain(target === 'react' ? 'OpenPencilApplicationPage' : 'route.fullPath')
    })
  })
}

function reactSessionFiles(retention: 'reset' | 'preserve' = 'preserve') {
  return compileApplicationSessionFixture('react', retention).files
}

function appSource(files: ReadonlyMap<string, string | Uint8Array>): string {
  const app = files.get('src/App.tsx')
  if (typeof app !== 'string') throw new Error('Missing generated application App')
  return app
}

test.each(['reset', 'preserve'] as const)(
  'bundles the exact %s page session shell and back tracker for Blob preview',
  async (retention) => {
    const files = reactSessionFiles(retention)
    const original = appSource(files)
    const prepared = prepareBrowserPreviewReactFiles(files, 'application_session_blob_preview')
    expect(appSource(prepared.files)).toContain('<HashRouter>')
    expect(appSource(prepared.files)).toContain(`<ApplicationNavigationTracker />`)
    expect(appSource(prepared.files)).toContain(`retention="${retention}"`)
    expect(appSource(files)).toBe(original)
    const built = await buildBrowserPreview(await browserPreviewInput(files))
    expect(built.status).toBe('ready')
    if (built.status === 'ready') expect(built.html).toContain('Filter products')
  },
  60000
)

test('keeps new Vue page session SFCs inside the explicit unsupported Blob-preview boundary', async () => {
  const files = compileApplicationSessionFixture('vue').files
  const built = await buildBrowserPreview(await browserPreviewInput(files, { target: 'vue' }))
  expect(built.status).toBe('unsupported')
  if (built.status === 'unsupported')
    expect(built.reason.code).toBe('browser-preview-vue-unsupported')
}, 60000)

test('fails closed for unknown session shell JSX, dynamic/unknown IDs or modes, props and aliases', () => {
  const files = reactSessionFiles()
  const original = appSource(files)
  const changes = [
    original.replace(
      '<ApplicationNavigationTracker />',
      '<ApplicationNavigationTracker /><UnknownTracker />'
    ),
    original.replace(
      '<ApplicationNavigationTracker />',
      '<ApplicationNavigationTracker /><ApplicationNavigationTracker />'
    ),
    original.replace(
      '<ApplicationNavigationTracker />',
      '<ApplicationNavigationTracker enabled />'
    ),
    original.replace(
      'import { ApplicationNavigationTracker }',
      'import { OtherTracker as ApplicationNavigationTracker }'
    ),
    original.replace(
      'import { OpenPencilApplicationPage }',
      'import { OtherWrapper as OpenPencilApplicationPage }'
    ),
    original.replace('retention="preserve"', 'retention="sticky"'),
    original.replace('retention="preserve"', 'retention="reset"'),
    original.replace('retention="preserve"', 'retention={mode}'),
    original.replace(/pageId="[^"\r\n]+"/, 'pageId="not-declared"'),
    original.replace(/pageId="[^"\r\n]+"/, 'pageId={currentPageId}'),
    original.replace('retention="preserve"', 'retention="preserve" onClick={run}'),
    original.replace('<Routes>', '<Routes><UnknownPage />')
  ]
  for (const app of changes) {
    const tampered = new Map(files)
    tampered.set('src/App.tsx', app)
    let caught: unknown
    try {
      prepareBrowserPreviewReactFiles(tampered, 'application_session_blob_preview')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BrowserPreviewBuildError)
    if (caught instanceof BrowserPreviewBuildError)
      expect(caught.diagnostics[0]?.code).toBe('browser-preview-routing-contract-unsupported')
  }
})

function rootSessionFiles(retention: 'reset' | 'preserve' | 'absent') {
  const fixture = applicationSessionFixture(retention === 'absent' ? 'preserve' : retention)
  fixture.graph.updateNode(fixture.home.id, { lowcodeRoutePattern: '/' })
  for (const node of fixture.graph.getAllNodes()) {
    const actions = node.events?.onClick
    if (!actions) continue
    fixture.graph.updateNode(node.id, {
      events: {
        ...node.events,
        onClick: actions.map((action) => {
          if (action.kind === 'navigate' && action.to)
            return { ...action, to: action.to.replace(/^\/home(?=[?#]|$)/, '/') }
          if (action.kind === 'back')
            return { ...action, fallback: action.fallback.replace(/^\/home(?=[?#]|$)/, '/') }
          return action
        })
      }
    })
  }
  if (retention === 'absent') {
    for (const page of [fixture.home, fixture.products]) {
      const policy = page.lowcodeApplicationPage
      if (!policy) throw new Error('Missing fixture policy')
      const { stateRetention: _removed, ...original } = policy
      fixture.graph.updateNode(page.id, { lowcodeApplicationPage: original })
    }
  }
  const output = compile({
    graph: fixture.graph,
    pageIds: fixture.graph.getPages().map((page) => page.id),
    options: withDefaults({
      devMode: true,
      target: 'react',
      router: 'react-router-v6',
      packageName: 'root_application_session_fixture'
    })
  })
  expect(output.warnings).toEqual([])
  return output.files
}

test.each(['reset', 'preserve', 'absent'] as const)(
  'bundles a root-start %s application with the trusted back tracker',
  async (retention) => {
    const files = rootSessionFiles(retention)
    const source = appSource(files)
    expect(source).not.toContain('<Navigate')
    expect(source).toContain('<ApplicationNavigationTracker />')
    const prepared = prepareBrowserPreviewReactFiles(files, 'root_application_session_blob_preview')
    expect(appSource(prepared.files)).toContain('<HashRouter>')
    expect(appSource(files)).toBe(source)
    const built = await buildBrowserPreview(await browserPreviewInput(files))
    expect(built.status).toBe('ready')
  },
  60000
)

test('root-start page sessions and tracker-only projects reject additional JSX and untrusted feature wiring', () => {
  for (const retention of ['preserve', 'reset', 'absent'] as const) {
    const files = rootSessionFiles(retention)
    const original = appSource(files)
    const changes = [
      original.replace('<Routes>', '<Routes><UnknownPage />'),
      original.replace(
        '<ApplicationNavigationTracker />',
        '<ApplicationNavigationTracker /><UnknownTracker />'
      ),
      original.replace(
        '<ApplicationNavigationTracker />',
        '<ApplicationNavigationTracker /><ApplicationNavigationTracker />'
      ),
      original.replace(
        'import { ApplicationNavigationTracker }',
        'import { OtherTracker as ApplicationNavigationTracker }'
      ),
      original.replace(
        '<ApplicationNavigationTracker />',
        '<ApplicationNavigationTracker enabled />'
      )
    ]
    if (retention !== 'absent')
      changes.push(
        original.replace(
          'import { OpenPencilApplicationPage }',
          'import { OtherWrapper as OpenPencilApplicationPage }'
        ),
        original.replace(`retention="${retention}"`, 'retention="sticky"'),
        original.replace(`retention="${retention}"`, 'retention={mode}'),
        original.replace(/pageId="[^"\r\n]+"/, 'pageId="not-declared"'),
        original.replace(/pageId="[^"\r\n]+"/, 'pageId={currentPageId}'),
        original.replace(`retention="${retention}"`, `retention="${retention}" onClick={run}`)
      )
    for (const app of changes) {
      const tampered = new Map(files)
      tampered.set('src/App.tsx', app)
      let caught: unknown
      try {
        prepareBrowserPreviewReactFiles(tampered, 'root_application_session_blob_preview')
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(BrowserPreviewBuildError)
      if (caught instanceof BrowserPreviewBuildError)
        expect(caught.diagnostics[0]?.code).toBe('browser-preview-routing-contract-unsupported')
    }
  }
})
