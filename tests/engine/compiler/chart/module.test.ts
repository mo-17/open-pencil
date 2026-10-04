import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compile, withDefaults } from '@open-pencil/compiler'
import { buildPreviewProject } from '@open-pencil/compiler/build'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { IRElement } from '@open-pencil/compiler/ir/types'
import { buildChartLayout, createChartModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { chartFixture } from '#tests/helpers/compiler/modules/chart/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'
import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

describe('compiler trusted chart module adapter', () => {
  test('lowers chart data to generic module IR and emits a dependency-free local runtime', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      ...createChartModuleFrameOverrides({
        values: [12, 40, 28],
        labels: ['Alpha', 'Beta', 'Gamma'],
        color: '#EF4444',
        showValues: true
      }),
      width: 480,
      height: 280
    })
    graph.createNode('TEXT', frame.id, { text: 'Chart overlay', x: 12, y: 12 })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toEqual({
      pluginId: 'open-pencil.chart',
      moduleType: 'chart',
      configVersion: 1,
      payload: {
        chartType: 'bar',
        values: [12, 40, 28],
        labels: ['Alpha', 'Beta', 'Gamma'],
        color: '#EF4444',
        showValues: true,
        layout: buildChartLayout(
          {
            chartType: 'bar',
            values: [12, 40, 28],
            labels: ['Alpha', 'Beta', 'Gamma'],
            color: '#EF4444',
            showValues: true
          },
          480,
          280
        )
      }
    })
    expect(JSON.stringify(element.children)).toContain('Chart overlay')

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'chart-demo' })
    })
    const app = out.files.get('src/App.tsx') as string
    const runtime = out.files.get('src/__openpencil_chart.tsx') as string
    const pkg = JSON.parse(out.files.get('package.json') as string) as {
      dependencies: Record<string, string>
    }

    expect(app).toContain("import OpenPencilChart from './__openpencil_chart'")
    expect(app).toContain('<OpenPencilChart config={{')
    expect(app).toContain('Chart overlay')
    expect(app).toContain('</OpenPencilChart>')
    expect(runtime).toContain('<svg')
    expect(runtime).toContain('<rect')
    expect(runtime).toContain('config.values.map')
    expect(pkg.dependencies['recharts']).toBeUndefined()
    expect(pkg.dependencies['chart.js']).toBeUndefined()
    expect(pkg.dependencies['maplibre-gl']).toBeUndefined()
  })

  test('keeps the authored FRAME fallback when chart config is invalid', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      width: 320,
      height: 180,
      interactiveProps: {
        module: {
          version: 1,
          pluginId: 'open-pencil.chart',
          moduleType: 'chart',
          configVersion: 1,
          config: {
            chartType: 'bar',
            values: [],
            labels: [],
            color: '#2563EB',
            showValues: false
          }
        }
      }
    })
    graph.createNode('TEXT', frame.id, { text: 'Chart unavailable' })

    const ir = collectTree(graph, pageId)
    const element = ir.children[0] as IRElement
    expect(element.module).toBeUndefined()
    expect(JSON.stringify(element.children)).toContain('Chart unavailable')
    expect(ir.warnings.map((warning) => warning.code)).toContain('chart-module-invalid')
  })

  test('finds chart modules inside reachable reusable components', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const master = graph.createNode('COMPONENT', pageId, {
      name: 'ChartCard',
      width: 360,
      height: 240
    })
    graph.createNode('FRAME', master.id, createChartModuleFrameOverrides())
    graph.createInstance(master.id, pageId)

    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'chart-component' })
    })
    const component = out.files.get('src/components/ChartCard.tsx') as string

    expect(component).toContain("import OpenPencilChart from '../__openpencil_chart'")
    expect(component).toContain('<OpenPencilChart config={{')
    expect(out.files.has('src/__openpencil_chart.tsx')).toBe(true)
  })

  test('bundles the dependency-free chart runtime into a static preview project', async () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    graph.createNode(
      'FRAME',
      pageId,
      createChartModuleFrameOverrides({
        values: [-12, 30, 18],
        labels: ['Loss', 'Growth', 'Plan']
      })
    )
    const out = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'chart-static', devMode: false })
    })
    const buildDirectory = mkdtempSync(join(tmpdir(), 'openpencil-chart-build-'))

    try {
      const built = await buildPreviewProject({ files: out.files, outDir: buildDirectory })

      expect(built.files).toContain('index.html')
      expect(built.files.some((path) => path.endsWith('.js'))).toBe(true)
      expect(out.warnings).toEqual([])
    } finally {
      rmSync(buildDirectory, { recursive: true, force: true })
    }
  }, 15_000)
})

for (const target of ['react', 'vue'] as const) {
  for (const updates of [false, true])
    test(`${target} charts compile all static types, dense and empty data with complete typed runtime (updates ${updates})`, () => {
      const result = chartFixture(target, updates)
      expect(result.warnings).toEqual([])
      expect(result.files.has(`src/__openpencil_chart.${target === 'react' ? 'tsx' : 'vue'}`)).toBe(
        true
      )
      const files = new Map<string, string>()
      for (const [path, content] of result.files)
        if (typeof content === 'string') files.set(path, content)
      expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
    }, 35000)
  test(`${target} rejects negative circular data without hiding authored fallback`, () => {
    const graph = new SceneGraph(),
      page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, createChartModuleFrameOverrides())
    const module = frame.interactiveProps?.module
    if (!module) throw new Error('Missing chart module')
    graph.updateNode(frame.id, {
      interactiveProps: {
        module: {
          ...module,
          config: { ...module.config, chartType: 'pie', values: [-1, 2], labels: ['Loss', 'Gain'] }
        }
      }
    })
    graph.createNode('TEXT', frame.id, { text: 'Invalid circular chart' })
    const result = compile({
      graph,
      pageIds: [page.id],
      options: withDefaults({ target, router: 'none', devMode: false })
    })
    expect(result.warnings.map((warning) => warning.code)).toContain('chart-module-invalid')
    expect([...result.files.keys()].some((path) => path.includes('__openpencil_chart'))).toBe(false)
    expect(
      [...result.files.values()].filter((value) => typeof value === 'string').join('\n')
    ).toContain('Invalid circular chart')
  })
}
