import { describe, expect, test } from 'bun:test'

import { populateAndApplyOverrides } from '@open-pencil/fig/instance-overrides'
import {
  getLazyFigImportContext,
  populateAllLazyFigImportRoots,
  populateLazyFigImportRoots,
  setLazyFigImportContext
} from '@open-pencil/core/kiwi/fig/lazy-import'
import { SceneGraph } from '@open-pencil/scene-graph'

import { reapplyInstanceOverrides } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

function createLazyGraph(pageCount: 2 | 3 = 2) {
  const graph = new SceneGraph()
  const [page1] = graph.getPages()
  const page2 = graph.addPage('Page 2')
  const page3 = pageCount === 3 ? graph.addPage('Page 3') : undefined
  const component = graph.createNode('COMPONENT', page1.id, {
    name: 'Button',
    width: 100,
    height: 40
  })
  graph.createNode('RECTANGLE', component.id, {
    name: 'Background',
    width: 100,
    height: 40
  })
  const page1Instance = graph.createNode('INSTANCE', page1.id, {
    name: 'Button instance 1',
    componentId: component.id,
    width: 100,
    height: 40
  })
  const page2Instance = graph.createNode('INSTANCE', page2.id, {
    name: 'Button instance 2',
    componentId: component.id,
    width: 100,
    height: 40
  })
  const page3Instance = page3
    ? graph.createNode('INSTANCE', page3.id, {
        name: 'Button instance 3',
        componentId: component.id,
        width: 100,
        height: 40
      })
    : undefined

  setLazyFigImportContext(graph, {
    changeMap: new Map(),
    guidToNodeId: new Map(),
    blobs: [],
    populatedRootIds: new Set([page1.id])
  })

  return { graph, page1, page2, page3, page1Instance, page2Instance, page3Instance }
}

describe('lazy .fig page population', () => {
  test('populates pages incrementally and releases context after the final page', () => {
    const { graph, page2, page3, page1Instance, page2Instance, page3Instance } = createLazyGraph(3)
    if (!page3 || !page3Instance) throw new Error('Expected a third lazy page')

    expect(graph.getChildren(page1Instance.id)).toHaveLength(0)
    expect(graph.getChildren(page2Instance.id)).toHaveLength(0)
    expect(graph.getChildren(page3Instance.id)).toHaveLength(0)
    expect(getLazyFigImportContext(graph)).toBeDefined()

    expect(populateLazyFigImportRoots(graph, [page2.id])).toBe(true)
    expect(graph.getChildren(page1Instance.id)).toHaveLength(0)
    expect(graph.getChildren(page2Instance.id)).toHaveLength(1)
    expect(graph.getChildren(page3Instance.id)).toHaveLength(0)
    expect(getLazyFigImportContext(graph)).toBeDefined()

    const nodeCount = graph.nodes.size
    expect(populateLazyFigImportRoots(graph, [page2.id])).toBe(false)
    expect(graph.nodes.size).toBe(nodeCount)

    expect(populateLazyFigImportRoots(graph, [page3.id])).toBe(true)
    expect(graph.getChildren(page1Instance.id)).toHaveLength(1)
    expect(graph.getChildren(page2Instance.id)).toHaveLength(1)
    expect(graph.getChildren(page3Instance.id)).toHaveLength(1)
    expect(getLazyFigImportContext(graph)).toBeUndefined()

    const completedNodeCount = graph.nodes.size
    expect(populateLazyFigImportRoots(graph, [page3.id])).toBe(false)
    expect(graph.nodes.size).toBe(completedNodeCount)
  })

  test('can populate all remaining pages before full-document operations', () => {
    const { graph, page1Instance, page2Instance } = createLazyGraph()

    expect(populateAllLazyFigImportRoots(graph)).toBe(true)
    expect(graph.getChildren(page1Instance.id)).toHaveLength(1)
    expect(graph.getChildren(page2Instance.id)).toHaveLength(1)
    expect(getLazyFigImportContext(graph)).toBeUndefined()
    expect(populateAllLazyFigImportRoots(graph)).toBe(false)
  })

  test('finishes internal pages when the last accessible page is populated', () => {
    const { graph, page2, page1Instance, page2Instance } = createLazyGraph()
    const internalPage = graph.addPage('Internal assets')
    graph.updateNode(internalPage.id, { internalOnly: true })
    const internalInstance = graph.createNode('INSTANCE', internalPage.id, {
      name: 'Internal button instance',
      componentId: page1Instance.componentId,
      width: 100,
      height: 40
    })

    expect(graph.getPages()).toHaveLength(2)
    expect(graph.getPages(true)).toHaveLength(3)
    expect(populateLazyFigImportRoots(graph, [page2.id])).toBe(true)
    expect(graph.getChildren(page1Instance.id)).toHaveLength(1)
    expect(graph.getChildren(page2Instance.id)).toHaveLength(1)
    expect(graph.getChildren(internalInstance.id)).toHaveLength(1)
    expect(getLazyFigImportContext(graph)).toBeUndefined()
  })

  test('does not retain a context with no unpopulated pages', () => {
    const graph = new SceneGraph()
    const pageIds = graph.getPages(true).map((page) => page.id)

    setLazyFigImportContext(graph, {
      changeMap: new Map(),
      guidToNodeId: new Map(),
      blobs: [new Uint8Array(1024)],
      populatedRootIds: new Set(pageIds)
    })

    expect(getLazyFigImportContext(graph)).toBeUndefined()
    expect(populateAllLazyFigImportRoots(graph)).toBe(false)
  })

  test('retains and replays legacy overrides when a later page instance is populated', () => {
    const { graph, page1, page2, page1Instance, page2Instance } = createLazyGraph()
    graph.updateNode(page1Instance.id, {
      pendingInstanceOverrides: { '0:opacity': 0.7 }
    })
    graph.updateNode(page2Instance.id, {
      pendingInstanceOverrides: { '0:opacity': 0.35 }
    })

    // Match first-page import: only the visible page has real cloned descendants
    // when the legacy snapshot is replayed for the first time.
    populateAndApplyOverrides(graph, new Map(), new Map(), [], [page1.id])
    reapplyInstanceOverrides(graph)

    const populatedFirstChild = graph.getChildren(page1Instance.id)[0]
    expect(populatedFirstChild?.opacity).toBe(0.7)
    expect(page1Instance.pendingInstanceOverrides).toBeUndefined()
    expect(graph.getChildren(page2Instance.id)).toHaveLength(0)
    expect(page2Instance.pendingInstanceOverrides).toEqual({ '0:opacity': 0.35 })
    expect(page2Instance.overrides).toEqual({})

    page2Instance.instanceOverrides.self.set('structured-sentinel', true)
    expect(populateLazyFigImportRoots(graph, [page2.id])).toBe(true)

    const populatedLaterChild = graph.getChildren(page2Instance.id)[0]
    expect(populatedLaterChild?.opacity).toBe(0.35)
    expect(page2Instance.overrides).toEqual({ [`${populatedLaterChild.id}:opacity`]: 0.35 })
    expect(page2Instance.pendingInstanceOverrides).toBeUndefined()
    expect(page2Instance.instanceOverrides.self.get('structured-sentinel')).toBe(true)
    const stillPopulatedFirstChild = graph.getChildren(page1Instance.id)[0]
    expect(stillPopulatedFirstChild?.opacity).toBe(0.7)
    expect(page1Instance.overrides).toEqual({ [`${stillPopulatedFirstChild.id}:opacity`]: 0.7 })
    expect(getLazyFigImportContext(graph)).toBeUndefined()
  })
})
