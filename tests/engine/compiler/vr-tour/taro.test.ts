import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

import { taroAdapter } from '#compiler/adapters/taro'
import { vrTourHybridKey } from '#compiler/adapters/vr-tour/hybrid'
import type { ComponentDef, IRTree } from '#compiler/ir/types'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  VR_TOUR_SAMPLE_ASSETS,
  createLocalizedVRTourConfig,
  createVRTourModuleInstance,
  createVRTourSampleScenes
} from '@open-pencil/core/plugins'

import { tourFixture } from './helpers'

const options = withDefaults({ target: 'taro', router: 'taro-router', devMode: false })

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string): string {
  const value = files.get(path)
  if (typeof value !== 'string') throw new Error(`Missing generated source: ${path}`)
  return value
}

function authoredPage(files: ReadonlyMap<string, string | Uint8Array>): string {
  const path = [...files.keys()].find((key) => key.startsWith('src/pages/') && key.endsWith('.tsx'))
  if (!path) throw new Error('Missing authored Taro page')
  return textFile(files, path)
}

function outputTour() {
  const fixture = tourFixture()
  fixture.graph.updateNode(fixture.node.id, {
    interactiveProps: { module: createVRTourModuleInstance(createLocalizedVRTourConfig('zh-CN')) }
  })
  return {
    ...fixture,
    output: compile({ graph: fixture.graph, pageIds: [fixture.pageId], options })
  }
}

test('Taro emits a localized launch button and a separate allowlisted WebView page', () => {
  const { output, node } = outputTour()
  const page = authoredPage(output.files)
  const viewer = textFile(output.files, 'src/vr-tour/page/index.tsx')
  const key = vrTourHybridKey(node.id)
  expect(page).toContain(`tourId="${key}" locale="zh-CN" bound={false}`)
  expect(page).toContain("import OpenPencilVRTour from '../../vr-tour/launch'")
  expect(page).not.toContain('<WebView')
  expect(viewer.match(/<WebView/g)).toHaveLength(1)
  expect(viewer).toContain('resolveVRTourRoute(VR_TOUR_BASE_URL, params.tour)')
  expect(viewer).toContain('onError={() => setFailed(true)}')
  expect(viewer).toContain('onClick={() => setFailed(false)}')
  expect(textFile(output.files, 'src/app.config.ts')).toContain('"vr-tour/page/index"')
  expect(textFile(output.files, 'src/vr-tour/config.ts')).toContain("VR_TOUR_BASE_URL: string = ''")
  const launch = textFile(output.files, 'src/vr-tour/launch.tsx')
  expect(launch).toContain("disabled={bound || unsupported || route.status !== 'ready'}")
  expect(launch).toContain('Taro.getEnv() !== Taro.ENV_TYPE.WEAPP')
  expect(viewer).toContain('useDidHide(() => setVisible(false))')
  expect(launch).toContain('Taro.navigateTo')
  expect(launch).not.toContain('url: route.url')
  expect(textFile(output.files, 'src/vr-tour/copy.ts')).toContain('打开全景')
  const pkg = JSON.parse(textFile(output.files, 'package.json'))
  expect(pkg.scripts['build:vr-tour-web']).toBe('npm --prefix vr-tour-web run build')
  expect(pkg.dependencies['@photo-sphere-viewer/core']).toBeUndefined()
  expect(pkg.dependencies.three).toBeUndefined()
  expect(output.files.has('vr-tour-web/build.mjs')).toBe(true)
  expect(output.warnings.some((item) => item.code === 'taro-vr-tour-https-hosting-required')).toBe(
    true
  )
  expect(output.warnings.some((item) => item.code === 'taro-plugin-module-unsupported')).toBe(false)
  for (const [path, source] of output.files) {
    if (!path.startsWith('src/') || typeof source !== 'string') continue
    expect(source).not.toContain("from '@photo-sphere-viewer/")
    if (/\.tsx?$/.test(path)) {
      expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(source)).not.toThrow()
    }
  }
  const readme = textFile(output.files, 'README.md')
  expect(readme).toContain('personal-type mini-programs cannot use WebView')
  expect(readme).toContain('business domain')
  expect(readme).toContain('it does not deploy anything')
})

test('the generated route resolver runs without DOM URL APIs and rejects arbitrary navigation', () => {
  const { output, node } = outputTour()
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    textFile(output.files, 'src/vr-tour/route.ts')
  )
  const resolve = runInNewContext(
    source.replace(/^export /gm, '') + '\nresolveVRTourRoute',
    {},
    { timeout: 1000 }
  ) as (base: string, key: unknown) => { status: string; url?: string }
  const key = vrTourHybridKey(node.id)
  expect(source).not.toContain('new URL(')
  expect(resolve('', key)).toEqual({ status: 'setup' })
  expect(resolve('https://panorama.example.com/tours', key)).toEqual({
    status: 'ready',
    url: `https://panorama.example.com/tours/${key}.html`
  })
  expect(resolve('https://panorama.example.com/tours/', key)).toEqual({
    status: 'ready',
    url: `https://panorama.example.com/tours/${key}.html`
  })
  for (const id of [
    undefined,
    ['tour'],
    '../other',
    'https://evil.example',
    key + '.html',
    'tour-' + '0'.repeat(32)
  ]) {
    expect(resolve('https://panorama.example.com/tours/', id)).toEqual({ status: 'invalid-tour' })
  }
  for (const base of [
    'http://panorama.example.com',
    'https://user:password@panorama.example.com',
    'https://panorama.example.com/?token=value',
    'https://panorama.example.com/#fragment',
    'https://panorama.example.com:443/',
    'https://Panorama.example.com/',
    'https://127.0.0.1/',
    'https://localhost/',
    'https://bad-.example.com/',
    'https://panorama.example.com/a/../b/',
    'https://panorama.example.com/a/./b/',
    'https://panorama.example.com//b/',
    'https://panorama.example.com/%2e%2e/',
    'https://panorama.example.com/\\evil',
    ' https://panorama.example.com/',
    'https://panorama.example.com/' + 'a'.repeat(1800)
  ])
    expect(resolve(base, key)).toEqual({ status: 'invalid-config' })
})

test('Taro disables bound listing panoramas rather than emitting a static substitute', () => {
  const { graph, pageId } = tourFixture({ kind: 'expr', expr: 'selectedProperty.panorama_url' })
  const output = compile({ graph, pageIds: [pageId], options })
  const page = authoredPage(output.files)
  expect(page).toContain('bound={true}')
  expect(output.warnings.some((item) => item.code === 'taro-vr-tour-binding-unsupported')).toBe(
    true
  )
  expect([...output.files.keys()].some((path) => path.startsWith('vr-tour-web/'))).toBe(false)
  expect(output.files.has('src/vr-tour/page/index.tsx')).toBe(false)
  expect(textFile(output.files, 'src/vr-tour/copy.ts')).toContain('不会使用静态全景替代所选房源')
  expect(textFile(output.files, 'src/vr-tour/launch.tsx')).toContain(
    "if (bound || unsupported || route.status !== 'ready') return"
  )
})

test('persisted 8K media remains in the web sidecar and passes the unchanged mini-program budget', () => {
  const { graph, pageId, node } = tourFixture()
  const config = createLocalizedVRTourConfig('zh-CN')
  config.scenes = createVRTourSampleScenes('zh-CN')
  graph.updateNode(node.id, { interactiveProps: { module: createVRTourModuleInstance(config) } })
  const bytesByURL = new Map<string, Uint8Array>()
  for (const sample of VR_TOUR_SAMPLE_ASSETS) {
    const bytes = new Uint8Array(
      readFileSync(
        new URL(`../../../../packages/demos/vr-tour/${sample.fileName}`, import.meta.url)
      )
    )
    graph.images.set(sample.graphImageHash, bytes)
    bytesByURL.set(sample.panoramaUrl, bytes)
  }
  const output = compile({ graph, pageIds: [pageId], options })
  expect([...output.files.keys()].some((path) => path.startsWith('public/'))).toBe(false)
  expect(
    [...output.files].some(
      ([path, content]) => path.startsWith('src/') && content instanceof Uint8Array
    )
  ).toBe(false)
  const manifest = JSON.parse(textFile(output.files, 'vr-tour-web/manifest.json')) as {
    assets: Array<{ url: string; chunks: string[]; byteLength: number }>
  }
  expect(manifest.assets).toHaveLength(2)
  for (const asset of manifest.assets) {
    const parts = asset.chunks.map((path) => {
      const bytes = output.files.get('vr-tour-web/' + path)
      if (!(bytes instanceof Uint8Array)) throw new Error('Missing sidecar image chunk')
      expect(bytes.byteLength).toBeLessThanOrEqual(1024 * 1024)
      return bytes
    })
    expect(new Uint8Array(Buffer.concat(parts))).toEqual(bytesByURL.get(asset.url))
  }
  expect(textFile(output.files, 'vr-tour-web/SOURCES.json')).toContain('CC0')
})

test('reusable component VR modules import the same launcher and reserve a page budget slot', () => {
  const { graph, pageId } = tourFixture()
  const ir = collectTree(graph, pageId)
  const empty: IRTree = { ...ir, children: [] }
  const component: ComponentDef = {
    componentId: 'tour-card',
    name: 'TourCard',
    props: [],
    children: ir.children
  }
  const output = taroAdapter.emit([empty], options, [component])
  const componentPath = [...output.files.keys()].find(
    (path) => path.startsWith('src/components/') && path.endsWith('.tsx')
  )
  if (!componentPath) throw new Error('Missing reusable component')
  expect(textFile(output.files, componentPath)).toContain(
    "import OpenPencilVRTour from '../vr-tour/launch'"
  )
  const pages = Array.from({ length: 100 }, (_, index) => ({
    ...empty,
    pageId: `page-${index}`,
    pageName: `Page ${index}`
  }))
  expect(() => taroAdapter.emit(pages, options, [component])).toThrow('one additional page')
  const plain = taroAdapter.emit([empty], options)
  expect(
    [...plain.files.keys()].some(
      (path) => path.startsWith('vr-tour-web/') || path.startsWith('src/vr-tour/')
    )
  ).toBe(false)
})
