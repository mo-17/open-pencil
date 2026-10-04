import { expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { renderChartModulePreview } from '#core/canvas/modules/chart'
import { chartDataProjection } from '#core/canvas/modules/chart/data'
import { chartTextNode } from '#core/canvas/modules/chart/text'
import { createChartModuleFrameOverrides, CHART_MODULE_DEFAULT_CONFIG } from '#core/plugins/chart'
import { collectGraphFontRequirements } from '#core/text/requirements'

import { createMockCanvas, createMockRenderer } from '../effects/helpers'

function fixture() {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      {
        id: 'chart-data',
        name: 'chartData',
        type: 'object',
        defaultValue: { values: [15, 45], labels: ['绑定收入', '绑定支出'] }
      }
    ]
  })
  const node = graph.createNode('FRAME', page.id, {
    ...createChartModuleFrameOverrides({ values: [99], labels: ['Authored fallback'] }),
    bindings: { data: { kind: 'ref', stateId: 'chart-data' } },
    textLanguage: 'zh-CN'
  })
  return { graph, page, node }
}

test('Canvas projects bound object data and preflights its Chinese labels', () => {
  const { graph, node } = fixture()
  const projection = chartDataProjection(node, graph, CHART_MODULE_DEFAULT_CONFIG, 320, 200)
  expect(projection.config.values).toEqual([15, 45])
  expect(projection.config.labels).toEqual(['绑定收入', '绑定支出'])
  expect(projection.layout.rects).toHaveLength(2)
  expect(projection.invalid).toBe(false)
  expect(chartTextNode(node, graph)?.text).toContain('绑定收入')
  expect(chartTextNode(node, graph)?.text).not.toContain('Authored fallback')
  expect(collectGraphFontRequirements(graph, [node.id]).scripts).toContain('cjk-sc')
})

test('unavailable Canvas data never falls back for expression, computed, missing or wrong-type state', () => {
  const { graph, page, node } = fixture()
  expect(chartTextNode(node)?.text).toContain('图表数据不可用')
  graph.updateNode(node.id, { bindings: { data: { kind: 'expr', expr: 'chartData' } } })
  expect(chartTextNode(node, graph)?.text).toContain('图表数据不可用')
  graph.updateNode(node.id, { bindings: { data: { kind: 'ref', stateId: 'chart-data' } } })
  for (const state of [
    [
      {
        id: 'chart-data',
        name: 'chartData',
        type: 'object' as const,
        defaultValue: { values: [15], labels: ['Hidden'] },
        computedExpr: '({values:[15],labels:["Hidden"]})'
      }
    ],
    [{ id: 'chart-data', name: 'chartData', type: 'string' as const, defaultValue: 'bad' }],
    []
  ]) {
    graph.updateNode(page.id, { state })
    const text = chartTextNode(node, graph)?.text
    expect(text).toContain('图表数据不可用')
    expect(text).not.toContain('Authored fallback')
    expect(text).not.toContain('Hidden')
  }
})

test('Canvas document defaults distinguish valid empty from invalid and recover after data changes', () => {
  const { graph, node } = fixture()
  graph.updateNode(node.id, { bindings: { data: { kind: 'docState', docStateName: 'chartData' } } })
  const cases: [JSONObject, string][] = [
    [{ values: [], labels: [] }, '暂无数据'],
    [{ values: [1], labels: [] }, '图表数据不可用'],
    [{ values: [12], labels: ['修复'] }, '修复']
  ]
  for (const [value, expected] of cases) {
    graph.updateNode(graph.rootId, {
      lowcodeDocumentState: [
        { id: 'doc-chart', name: 'chartData', type: 'object', defaultValue: value }
      ]
    })
    expect(chartTextNode(node, graph)?.text).toContain(expected)
    expect(chartTextNode(node, graph)?.text).not.toContain('Authored fallback')
  }
})

test('Chart painter uses bound geometry and removes authored marks for invalid bound data', () => {
  const { graph, page, node } = fixture()
  const canvas = createMockCanvas(),
    renderer = createMockRenderer({ zoom: 1 })
  renderer.ck.Path.MakeFromSVGString = mock(() => new renderer.ck.PathBuilder().detachAndDelete())
  expect(renderChartModulePreview(renderer, canvas as Canvas, node, graph)).toBe(true)
  expect(canvas.drawRect).toHaveBeenCalledTimes(3)
  expect(canvas.drawPath).toHaveBeenCalledTimes(1)
  canvas.drawRect.mockClear()
  canvas.drawPath.mockClear()
  graph.updateNode(page.id, {
    state: [
      {
        id: 'chart-data',
        name: 'chartData',
        type: 'object',
        defaultValue: { values: [1], labels: [] }
      }
    ]
  })
  expect(renderChartModulePreview(renderer, canvas as Canvas, node, graph)).toBe(true)
  expect(canvas.drawRect).toHaveBeenCalledTimes(1)
  expect(canvas.drawPath).not.toHaveBeenCalled()
})
