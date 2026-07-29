import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'

import { generatedEffect } from '#tests/helpers/generated-effect'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('compiler generated-effect fallback', () => {
  test('emits a strict marker, on-demand Canvas2D runtime, and main import', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const spec = generatedEffect('particles')
    const node = graph.createNode('RECTANGLE', pageId, {
      name: 'Generated layer',
      width: 200,
      height: 120,
      generatedEffect: spec
    })
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'generated-effect-app', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    const runtime = output.files.get('src/__generated-effect-runtime.ts') as string
    const main = output.files.get('src/main.tsx') as string

    expect(app).toContain('data-op-generated-effect=')
    expect(app).toContain(`data-op-generated-effect-node="${node.id}"`)
    expect(app).toContain('&quot;preset&quot;:&quot;particles&quot;')
    expect(main).toContain("import './__generated-effect-runtime'")
    expect(runtime).toContain('MAX_PRIMITIVES = 128')
    expect(runtime).toContain('MAX_RASTER_PIXELS = 262144')
    expect(runtime).toContain('MAX_FREQUENCY_HZ = 12')
    expect(runtime).not.toMatch(/WGSL|GLSL|new Function|\beval\s*\(/)
    expect(output.warnings).toEqual([])
  })

  test('emits no runtime for absent, malformed, future, or void-element layers', () => {
    const clean = makeSceneGraph()
    const cleanPage = firstPageId(clean)
    clean.createNode('RECTANGLE', cleanPage)
    const cleanOutput = compile({ graph: clean, pageIds: [cleanPage], options: withDefaults() })
    expect(cleanOutput.files.has('src/__generated-effect-runtime.ts')).toBe(false)
    expect(cleanOutput.files.get('src/main.tsx') as string).not.toContain('__generated-effect')

    const malformed = makeSceneGraph()
    const malformedPage = firstPageId(malformed)
    const node = malformed.createNode('RECTANGLE', malformedPage)
    Reflect.set(node, 'generatedEffect', {
      ...generatedEffect(),
      version: 2,
      shader: 'main() {}'
    })
    const malformedOutput = compile({
      graph: malformed,
      pageIds: [malformedPage],
      options: withDefaults()
    })
    expect(malformedOutput.files.has('src/__generated-effect-runtime.ts')).toBe(false)
    expect(malformedOutput.warnings.map(({ code }) => code)).toContain('generated-effect-invalid')

    const voidGraph = makeSceneGraph()
    const voidPage = firstPageId(voidGraph)
    voidGraph.createNode('INPUT', voidPage, { generatedEffect: generatedEffect('noise') })
    const voidOutput = compile({
      graph: voidGraph,
      pageIds: [voidPage],
      options: withDefaults()
    })
    expect(voidOutput.files.has('src/__generated-effect-runtime.ts')).toBe(false)
    expect(voidOutput.warnings.map(({ code }) => code)).toContain(
      'generated-effect-unsupported-element'
    )
  })

  test('inlines generated component roots and produces a runnable static bundle', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const componentsPage = graph.addPage('Components')
    const component = graph.createNode('COMPONENT', componentsPage.id, {
      name: 'Generated Card',
      width: 160,
      height: 100,
      generatedEffect: generatedEffect('shimmer')
    })
    graph.createNode('TEXT', component.id, { text: 'Safe layer', width: 100, height: 24 })
    const instance = graph.createInstance(component.id, pageId)
    if (!instance) throw new Error('Expected instance')
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'generated-component', devMode: false })
    })
    const app = output.files.get('src/App.tsx') as string
    expect(app).toContain('data-op-generated-effect=')
    expect(app).not.toContain('<GeneratedCard')

    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-generated-effect-'))
    temporaryDirectories.push(buildDirectory)
    const built = await buildPreviewProject({ files: output.files, outDir: buildDirectory })
    expect(built.files.some((file) => file.endsWith('.js'))).toBe(true)
    expect(built.files).toContain('index.html')
  }, 30_000)
})
