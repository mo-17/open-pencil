import { describe, expect, test } from 'bun:test'

import { BrowserPreviewBuildError } from '#compiler/browser-preview/error'
import { prepareBrowserPreviewReactFiles } from '#compiler/browser-preview/routing'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewBridge } from '@open-pencil/compiler/adapters/react/preview-bridge'
import { buildBrowserPreview } from '@open-pencil/compiler/browser-preview'
import { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

import { browserPreviewInput } from './helpers'

const CHANNEL = 'browser_preview_routing_channel_0001'
const REDIRECT = '<Route path="/" element={<Navigate to="/home" replace />} />'

function applicationFiles(
  options: { single?: boolean; legacy?: boolean; target?: 'react' | 'vue' } = {}
) {
  const graph = new SceneGraph()
  const home = expectDefined(graph.getPages()[0], 'Home page')
  graph.updateNode(home.id, { name: 'Home', lowcodeRoutePattern: '/home' })
  const entry = graph.createNode('FRAME', home.id, { width: 360, height: 640 })
  graph.createNode('TEXT', entry.id, { text: 'Application home marker', width: 240, height: 32 })
  graph.updateNode(home.id, {
    lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: entry.id }
  })
  if (!options.single) {
    const details = graph.addPage('Details')
    const detailsEntry = graph.createNode('FRAME', details.id, { width: 360, height: 640 })
    graph.createNode('TEXT', detailsEntry.id, { text: 'Application details marker' })
    graph.updateNode(details.id, {
      lowcodeRoutePattern: '/details',
      lowcodeApplicationPage: { version: 1, role: 'application', entryNodeId: detailsEntry.id }
    })
    // Start selection must override the caller's page order.
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: !options.legacy, startPageId: home.id }
    })
  } else {
    graph.updateNode(graph.rootId, {
      lowcodeApplication: { version: 1, enabled: true, startPageId: home.id }
    })
  }
  const target = options.target ?? 'react'
  const output = compile({
    graph,
    pageIds: graph
      .getPages()
      .map((page) => page.id)
      .reverse(),
    options: withDefaults({
      packageName: 'browser-preview-routing-fixture',
      target,
      router: target === 'vue' ? 'vue-router-v4' : 'react-router-v6',
      devMode: true
    })
  })
  expect(output.warnings).toEqual([])
  return output.files
}

function appSource(files: ReadonlyMap<string, string | Uint8Array>): string {
  const app = files.get('src/App.tsx')
  if (typeof app !== 'string') throw new Error('Expected generated React App')
  return app
}

function expectRoutingRejected(files: Map<string, string | Uint8Array>, source: string): void {
  files.set('src/App.tsx', source)
  let caught: unknown
  try {
    prepareBrowserPreviewReactFiles(files, CHANNEL)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(BrowserPreviewBuildError)
  if (!(caught instanceof BrowserPreviewBuildError)) return
  expect(caught.diagnostics[0]?.code).toBe('browser-preview-routing-contract-unsupported')
}

describe('Blob preview generated application routing', () => {
  test('reads only the internal hash route and adapts both native history replay modes', () => {
    const files = applicationFiles()
    // Exercise the current builder source even when the public compiled adapter is frozen elsewhere.
    files.set('src/__preview-bridge.ts', buildPreviewBridge())
    const bridge = prepareBrowserPreviewReactFiles(files, CHANNEL).files.get(
      'src/__preview-bridge.ts'
    )
    expect(typeof bridge).toBe('string')
    expect(bridge).toContain("location.hash.startsWith('#') ? location.hash.slice(1) : '/'")
    expect(bridge).not.toContain('location.pathname + location.search + location.hash')
    expect(bridge).toContain("nativePushState(null, '', `#${route}`)")
    expect(bridge).toContain("nativeReplaceState(history.state, '', `#${route}`)")
  })

  test('rejects missing or duplicated route/replay instrumentation markers', () => {
    const original = buildPreviewBridge()
    for (const marker of [
      'return location.pathname + location.search + location.hash',
      "nativePushState(null, '', route)",
      "nativeReplaceState(history.state, '', route)"
    ]) {
      for (const replacement of ['', `${marker}\n${marker}`]) {
        const files = applicationFiles()
        files.set('src/__preview-bridge.ts', original.replace(marker, replacement))
        let caught: unknown
        try {
          prepareBrowserPreviewReactFiles(files, CHANNEL)
        } catch (error) {
          caught = error
        }
        expect(caught).toBeInstanceOf(BrowserPreviewBuildError)
        if (caught instanceof BrowserPreviewBuildError)
          expect(caught.diagnostics[0]?.code).toBe('browser-preview-bridge-contract-unsupported')
      }
    }
  })

  test('bundles the selected non-root homepage and preserves its static redirect', async () => {
    const files = applicationFiles()
    const original = appSource(files)
    const prepared = prepareBrowserPreviewReactFiles(files, CHANNEL)
    const app = appSource(prepared.files)
    expect(app).toContain("import { HashRouter, Route, Routes, Navigate } from 'react-router-dom'")
    expect(app).toContain(REDIRECT)
    expect(app).toContain('<Route path="/home" element={<PageIndex />} />')
    expect(appSource(files)).toBe(original)
    const result = await buildBrowserPreview(await browserPreviewInput(files))
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.html).toContain('Application home marker')
    expect(result.html).toContain('Application details marker')
    expect(result.html).toContain('HashRouter')
    expect(result.html).not.toContain('BrowserRouter')
  })

  test('bundles a single application page with a custom initial path', async () => {
    const files = applicationFiles({ single: true })
    const prepared = prepareBrowserPreviewReactFiles(files, CHANNEL)
    expect(appSource(prepared.files)).toContain(REDIRECT)
    const result = await buildBrowserPreview(await browserPreviewInput(files))
    expect(result.status).toBe('ready')
  })

  test('preserves the legacy generated router contract without Navigate', async () => {
    const files = applicationFiles({ legacy: true })
    const app = appSource(prepareBrowserPreviewReactFiles(files, CHANNEL).files)
    expect(app).toContain("import { HashRouter, Route, Routes } from 'react-router-dom'")
    expect(app).not.toContain('Navigate')
    expect((await buildBrowserPreview(await browserPreviewInput(files))).status).toBe('ready')
  })

  test('does not confuse a legacy page named Navigate with a redirect component', () => {
    const files = applicationFiles({ legacy: true })
    files.set('src/App.tsx', appSource(files).replaceAll('PageIndex', 'PageNavigate'))
    expect(appSource(prepareBrowserPreviewReactFiles(files, CHANNEL).files)).toContain(
      'PageNavigate'
    )
  })

  test('keeps Vue Blob preview explicitly unsupported for an application homepage', async () => {
    const files = applicationFiles({ target: 'vue' })
    const result = await buildBrowserPreview(await browserPreviewInput(files, { target: 'vue' }))
    expect(result.status).toBe('unsupported')
    if (result.status !== 'unsupported') return
    expect(result.reason.code).toBe('browser-preview-vue-unsupported')
  })

  const invalidRedirects = [
    { name: 'missing target page', value: REDIRECT.replace('/home', '/missing') },
    { name: 'external target', value: REDIRECT.replace('/home', 'https://example.com') },
    { name: 'protocol-relative target', value: REDIRECT.replace('/home', '//example.com') },
    { name: 'root loop', value: REDIRECT.replace('/home', '/') },
    { name: 'wildcard target', value: REDIRECT.replace('/home', '/home/*') },
    { name: 'dynamic target', value: REDIRECT.replace('to="/home"', 'to={initialRoute}') },
    { name: 'non-root redirect', value: REDIRECT.replace('path="/"', 'path="/old"') },
    { name: 'non-replacing redirect', value: REDIRECT.replace(' replace', '') },
    { name: 'extra redirect prop', value: REDIRECT.replace(' replace', ' replace state={{}}') },
    { name: 'multiple redirects', value: `${REDIRECT}\n        ${REDIRECT}` }
  ]
  for (const { name, value } of invalidRedirects) {
    test(`rejects ${name}`, () => {
      const files = applicationFiles()
      expectRoutingRejected(files, appSource(files).replace(REDIRECT, value))
    })
  }

  test('rejects extra router imports and props in both supported import shapes', () => {
    for (const legacy of [false, true]) {
      const files = applicationFiles({ legacy })
      const app = appSource(files)
      const closingImport = legacy ? 'Routes }' : 'Navigate }'
      expectRoutingRejected(
        files,
        app.replace(closingImport, closingImport.replace(' }', ', Outlet }'))
      )
      expectRoutingRejected(
        files,
        app.replace('<BrowserRouter>', '<BrowserRouter basename="/app">')
      )
    }
  })

  test('rejects a Navigate import without the exact generated homepage redirect', () => {
    const files = applicationFiles()
    expectRoutingRejected(files, appSource(files).replace(`        ${REDIRECT}\n`, ''))
  })

  test('rejects extra double-quoted or spaced router imports and aliased redirects', () => {
    const files = applicationFiles()
    const app = appSource(files)
    for (const importLine of [
      'import { Navigate as N } from "react-router-dom"',
      "import { Navigate as N } from  'react-router-dom'",
      "import * as R from 'react-router-dom'"
    ]) {
      expectRoutingRejected(files, `${importLine}\n${app}`)
    }
    for (const alias of ['N', 'R.Navigate', 'PageAlias']) {
      expectRoutingRejected(
        files,
        app.replace(
          REDIRECT,
          `${REDIRECT}\n        <Route path="/extra" element={<${alias} to={dynamicTarget} />} />`
        )
      )
    }
    expectRoutingRejected(files, app.replace('return (', 'const N = Navigate\n  return ('))
  })

  test('does not accept a redirect target supplied only by a prefix comment or string', () => {
    const files = applicationFiles()
    const app = appSource(files).replace(
      'path="/home" element={<PageIndex',
      'path="/details" element={<PageIndex'
    )
    for (const prefix of [
      '// <Route path="/home" element={<PageHome />} />',
      'const marker = \'<Route path="/home" element={<PageHome />} />\''
    ]) {
      expectRoutingRejected(files, `${prefix}\n${app}`)
    }
  })
})
