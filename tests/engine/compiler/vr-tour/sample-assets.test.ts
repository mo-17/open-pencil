import { expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import {
  VR_TOUR_SAMPLE_ASSETS,
  createLocalizedVRTourConfig,
  createVRTourModuleInstance,
  createVRTourSampleScenes
} from '@open-pencil/core/plugins'

import { tourFixture } from './helpers'

const samples = VR_TOUR_SAMPLE_ASSETS.map((sample) => ({
  ...sample,
  bytes: new Uint8Array(
    readFileSync(new URL(`../../../../packages/demos/vr-tour/${sample.fileName}`, import.meta.url))
  )
}))

function savedSampleFixture() {
  const fixture = tourFixture()
  const config = createLocalizedVRTourConfig('zh-CN')
  config.scenes = createVRTourSampleScenes('zh-CN')
  fixture.graph.updateNode(fixture.node.id, {
    interactiveProps: { module: createVRTourModuleInstance(config) }
  })
  for (const sample of samples) fixture.graph.images.set(sample.graphImageHash, sample.bytes)
  return { ...fixture, config }
}

for (const target of ['react', 'vue'] as const) {
  test(`${target} exports the referenced 8K samples byte-for-byte without fetching`, () => {
    const { graph, pageId } = savedSampleFixture()
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Compilation must use persisted sample images')
    })
    try {
      const output = compile({ graph, pageIds: [pageId], options: withDefaults({ target }) })
      expect(output.warnings.filter((warning) => warning.code.startsWith('vr-tour-'))).toEqual([])
      for (const sample of samples) {
        expect(output.files.get('public' + sample.panoramaUrl)).toEqual(sample.bytes)
      }
      const sources = output.files.get('public/assets/vr-tour/SOURCES.json')
      if (!(sources instanceof Uint8Array)) throw new Error('Expected exported sample sources')
      const source = JSON.parse(new TextDecoder().decode(sources))
      expect(source.description).toContain('independent residential samples')
      expect(source.samples).toEqual(
        samples.map((sample) =>
          expect.objectContaining({
            fileName: sample.fileName,
            sha256: sample.sha256,
            author: sample.author,
            sourceUrl: sample.sourceUrl,
            license: sample.license,
            licenseUrl: sample.licenseUrl
          })
        )
      )
      expect(sources.byteLength).toBeLessThan(4096)
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      fetch.mockRestore()
    }
  })
}

test('only referenced samples are collected and duplicate module references share an asset', () => {
  const { graph, pageId, node, config } = savedSampleFixture()
  config.scenes = [{ ...config.scenes[0], hotspots: [] }]
  const module = createVRTourModuleInstance(config)
  graph.updateNode(node.id, { interactiveProps: { module } })
  graph.createNode('FRAME', pageId, { width: 640, height: 400, interactiveProps: { module } })
  graph.images.set('unreferenced', new Uint8Array([1, 2, 3]))
  const ir = collectTree(graph, pageId)
  expect(ir.assets?.map((asset) => asset.path)).toEqual(['public' + samples[0].panoramaUrl])
  const output = compile({ graph, pageIds: [pageId], options: withDefaults({ devMode: false }) })
  const sources = output.files.get('public/assets/vr-tour/SOURCES.json')
  if (!(sources instanceof Uint8Array))
    throw new Error('Expected sources for the single exported sample')
  expect(
    JSON.parse(new TextDecoder().decode(sources)).samples.map((sample: { id: string }) => sample.id)
  ).toEqual([samples[0].id])
  expect(ir.warnings).toEqual([])
})

test('missing or modified sample bytes produce actionable warnings and no invalid asset', () => {
  const { graph, pageId } = savedSampleFixture()
  graph.images.delete(samples[0].graphImageHash)
  const corrupted = samples[1].bytes.slice()
  corrupted[corrupted.length - 1] ^= 1
  graph.images.set(samples[1].graphImageHash, corrupted)
  const ir = collectTree(graph, pageId)
  expect(ir.assets).toBeUndefined()
  expect(ir.warnings.map((warning) => warning.code)).toEqual([
    'vr-tour-sample-missing',
    'vr-tour-sample-integrity-invalid'
  ])
  expect(ir.warnings.every((warning) => warning.message.includes('before exporting'))).toBe(true)
  graph.images.set(samples[1].graphImageHash, samples[1].bytes.subarray(1))
  expect(collectTree(graph, pageId).assets).toBeUndefined()
})

test('documents without sample references emit no sample files or attribution document', () => {
  const { graph, pageId } = tourFixture()
  for (const sample of samples) graph.images.set(sample.graphImageHash, sample.bytes)
  expect(collectTree(graph, pageId).assets).toBeUndefined()
  const output = compile({ graph, pageIds: [pageId], options: withDefaults({ devMode: false }) })
  expect(output.files.has('public/assets/vr-tour/SOURCES.json')).toBe(false)
})

test('source attribution combines successful samples from all exported pages', () => {
  const { graph, pageId, node, config } = savedSampleFixture()
  const second = graph.addPage('Second residence')
  graph.updateNode(node.id, {
    interactiveProps: {
      module: createVRTourModuleInstance({
        ...config,
        scenes: [{ ...config.scenes[0], hotspots: [] }]
      })
    }
  })
  graph.createNode('FRAME', second.id, {
    width: 640,
    height: 400,
    interactiveProps: {
      module: createVRTourModuleInstance({
        ...config,
        initialSceneId: 'bedroom',
        scenes: [{ ...config.scenes[1], hotspots: [] }]
      })
    }
  })
  const output = compile({
    graph,
    pageIds: [pageId, second.id],
    options: withDefaults({ devMode: false })
  })
  const sources = output.files.get('public/assets/vr-tour/SOURCES.json')
  if (!(sources instanceof Uint8Array)) throw new Error('Expected sources for both pages')
  expect(
    JSON.parse(new TextDecoder().decode(sources)).samples.map((sample: { id: string }) => sample.id)
  ).toEqual(samples.map((sample) => sample.id))
})
