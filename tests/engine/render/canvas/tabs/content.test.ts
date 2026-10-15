import { expect, mock, test } from 'bun:test'

import type { TypefaceFontProvider } from 'canvaskit-wasm'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { renderTabsModulePreview } from '#core/canvas/modules/tabs'
import { RenderChunkIndex } from '#core/canvas/renderer/chunks'
import { resolveTabsContent } from '#core/plugins/content/tabs'
import { createTabsModuleFrameOverrides } from '#core/plugins/tabs'

import { asDouble, asCanvas, textLayoutDouble } from '#tests/engine/render/canvas/helpers'

import { createMockCanvas, createMockRenderer } from '../effects/helpers'

function fixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const tabs = graph.createNode(
    'FRAME',
    page.id,
    createTabsModuleFrameOverrides({
      tabs: [
        { id: 'one', label: '概览', content: '', contentChildName: 'Overview' },
        { id: 'two', label: '详情', content: '', contentChildName: 'Details' }
      ],
      initialTabId: 'one'
    })
  )
  const overview = graph.createNode('FRAME', tabs.id, { name: 'Overview' })
  const details = graph.createNode('FORM', tabs.id, { name: 'Details' })
  return { graph, page, tabs, overview, details }
}

test('explicit Tabs content resolves only unique direct children without changing authored visibility', () => {
  const { graph, tabs, overview, details } = fixture()
  const unused = graph.createNode('FRAME', tabs.id, { name: 'Unused' })
  expect(resolveTabsContent(graph, tabs)?.activeChildId).toBe(overview.id)
  expect(resolveTabsContent(graph, tabs)?.panels.map((panel) => panel.id)).toEqual([
    overview.id,
    details.id
  ])
  graph.createNode('FRAME', tabs.id, { name: 'Overview' })
  expect(resolveTabsContent(graph, tabs)?.activeChildId).toBeNull()
  expect(resolveTabsContent(graph, tabs)?.panels.map((panel) => panel.id)).toEqual([details.id])
  expect([overview.visible, details.visible, unused.visible]).toEqual([true, true, true])
  expect(resolveTabsContent(graph, unused)).toBeNull()
})

test('missing, reused and hidden content never falls through to unassigned layers', () => {
  const { graph, tabs, overview } = fixture()
  graph.updateNode(overview.id, { visible: false })
  expect(resolveTabsContent(graph, tabs)?.activeChildId).toBeNull()
  graph.updateNode(
    tabs.id,
    createTabsModuleFrameOverrides({
      tabs: [
        { id: 'one', label: 'One', content: 'Fallback', contentChildName: 'Details' },
        { id: 'two', label: 'Two', content: '', contentChildName: 'Details' }
      ],
      initialTabId: 'one'
    })
  )
  expect(resolveTabsContent(graph, tabs)?.panels).toEqual([])
  graph.updateNode(tabs.id, createTabsModuleFrameOverrides())
  expect(resolveTabsContent(graph, tabs)).toBeNull()
})

test('large Tabs stay atomic so tiled rendering cannot expose inactive descendants', () => {
  const { graph, page, tabs, details } = fixture()
  for (let index = 0; index < 40; index++) graph.createNode('RECTANGLE', details.id)
  const { index } = RenderChunkIndex.build(graph, page.id)
  try {
    expect(index.size()).toBe(1)
    expect(index.getChunksForNode(tabs.id)[0]?.kind).toBe('subtree')
    expect(index.getChunksForNode(tabs.id)[0]?.interruptible).toBe(false)
    expect(index.getChunksForNode(details.id)).toEqual([])
    expect(index.getChunksDependingOnNode(details.id).map((chunk) => chunk.nodeId)).toEqual([
      tabs.id
    ])
  } finally {
    index.dispose()
  }
})

test('Tabs labels use the shared paragraph fallback with the real host identity', () => {
  const { tabs } = fixture()
  const labels: SceneNode[] = []
  let size = 11
  const dispose = mock(() => undefined)
  const renderer = createMockRenderer({
    labelFont: {
      getSize: () => size,
      setSize: (value: number) => {
        size = value
      }
    } as never,
    fontProvider: asDouble<TypefaceFontProvider>({}),
    fontsLoaded: true,
    nodeFontReadiness: () => 'ready',
    buildParagraph: (node) => {
      labels.push(node)
      return textLayoutDouble({
        getAlphabeticBaseline: () => 12,
        getLongestLine: () => 28,
        getHeight: () => 18,
        layout: () => undefined,
        delete: dispose
      })
    }
  })
  const drawParagraph = mock(() => undefined)
  const canvas = asCanvas({ ...createMockCanvas(), drawParagraph })
  expect(renderTabsModulePreview(renderer, canvas, tabs)).toBe(true)
  expect(labels.map((node) => [node.id, node.text])).toEqual([
    [tabs.id, '概览'],
    [tabs.id, '详情']
  ])
  expect(drawParagraph).toHaveBeenCalledTimes(2)
  expect(dispose).toHaveBeenCalledTimes(2)
  expect(size).toBe(11)
})
