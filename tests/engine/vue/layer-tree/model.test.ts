import { describe, expect, test } from 'bun:test'

import type { ModuleInstanceV1 } from '@open-pencil/scene-graph'
import {
  buildLayerTreeModel,
  layerSelectionForTarget,
  patchLayerNode,
  visibleLayerRows
} from '@open-pencil/vue'

import { createRect, firstPageId, makeSceneGraph } from '#tests/helpers/scene'

function moduleInstance(overrides: Partial<ModuleInstanceV1> = {}): ModuleInstanceV1 {
  return {
    version: 1,
    pluginId: 'open-pencil.tabs',
    moduleType: 'tabs',
    configVersion: 1,
    config: { initialTabId: 'overview' },
    ...overrides
  }
}

describe('layer tree model', () => {
  test('builds indexed nested items in scene order', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { name: 'Frame' })
    const child = createRect(graph, frame.id, { name: 'Child' })
    const sibling = createRect(graph, pageId, { name: 'Sibling' })
    const internal = graph.createNode('RECTANGLE', pageId, {
      name: 'Internal style',
      internalOnly: true
    })

    const model = buildLayerTreeModel(graph, pageId)

    expect(model.items.map((node) => node.id)).toEqual([frame.id, sibling.id])
    expect(model.items[0]?.children?.map((node) => node.id)).toEqual([child.id])
    expect(model.byId.get(child.id)?.name).toBe('Child')
    expect(model.byId.has(internal.id)).toBe(false)
  })

  test('derives only rows made visible by expansion', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { name: 'Frame' })
    const nested = graph.createNode('FRAME', frame.id, { name: 'Nested' })
    const child = createRect(graph, nested.id, { name: 'Child' })
    const model = buildLayerTreeModel(graph, pageId)

    expect(visibleLayerRows(model.items, new Set()).map((row) => row.node.id)).toEqual([frame.id])
    expect(
      visibleLayerRows(model.items, new Set([frame.id, nested.id])).map((row) => [
        row.node.id,
        row.level
      ])
    ).toEqual([
      [frame.id, 1],
      [nested.id, 2],
      [child.id, 3]
    ])
  })

  test('patches an indexed node without replacing its identity', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const sceneNode = createRect(graph, pageId, { name: 'Before' })
    const model = buildLayerTreeModel(graph, pageId)
    const layerNode = model.byId.get(sceneNode.id)
    expect(layerNode).toBeDefined()
    if (!layerNode) return

    graph.updateNode(sceneNode.id, { name: 'After', visible: false })
    const updated = graph.getNode(sceneNode.id)
    expect(updated).toBeDefined()
    if (!updated) return

    expect(patchLayerNode(layerNode, updated)).toBe(true)
    expect(model.items[0]).toBe(layerNode)
    expect(layerNode).toMatchObject({ name: 'After', visible: false })
    expect(patchLayerNode(layerNode, updated)).toBe(false)
  })

  test('projects only a frame module identity without changing scene data or its parent', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const parent = graph.createNode('FRAME', pageId, { name: 'Template container' })
    const tabs = graph.createNode('FRAME', parent.id, {
      interactiveProps: { module: moduleInstance() }
    })
    const ordinaryControl = graph.createNode('INPUT', parent.id, {
      interactiveProps: { module: moduleInstance() }
    })
    const before = structuredClone(tabs)

    const model = buildLayerTreeModel(graph, pageId)
    const identity = model.byId.get(tabs.id)?.moduleIdentity

    expect(identity).toEqual({ pluginId: 'open-pencil.tabs', moduleType: 'tabs' })
    expect(model.byId.get(parent.id)?.moduleIdentity).toBeUndefined()
    expect(model.byId.get(ordinaryControl.id)?.moduleIdentity).toBeUndefined()
    expect(graph.getNode(tabs.id)).toEqual(before)
    if (!identity) throw new Error('Expected the Tabs module identity')
    identity.moduleType = 'changed-in-view'
    expect(graph.getNode(tabs.id)).toEqual(before)
  })

  test.each([
    null,
    { pluginId: 'open-pencil.tabs', moduleType: 'tabs' },
    moduleInstance({ pluginId: 'Invalid plugin' }),
    moduleInstance({ config: { unsupported: undefined } })
  ])('does not project an invalid module envelope %p', (module) => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, { interactiveProps: { module } })

    expect(buildLayerTreeModel(graph, pageId).byId.get(frame.id)?.moduleIdentity).toBeUndefined()
  })

  test('updates module identity in place and ignores config-only changes', () => {
    const graph = makeSceneGraph()
    const pageId = firstPageId(graph)
    const frame = graph.createNode('FRAME', pageId, {
      interactiveProps: { module: moduleInstance() }
    })
    const model = buildLayerTreeModel(graph, pageId)
    const row = model.byId.get(frame.id)
    if (!row) throw new Error('Expected the module layer')
    const identity = row.moduleIdentity

    graph.updateNode(frame.id, {
      interactiveProps: { module: moduleInstance({ config: { initialTabId: 'details' } }) }
    })
    expect(patchLayerNode(row, frame)).toBe(false)
    expect(row.moduleIdentity).toBe(identity)

    graph.updateNode(frame.id, {
      interactiveProps: { module: moduleInstance({ pluginId: 'custom.tabs' }) }
    })
    expect(patchLayerNode(row, frame)).toBe(true)
    expect(row.moduleIdentity).toEqual({ pluginId: 'custom.tabs', moduleType: 'tabs' })

    graph.updateNode(frame.id, {
      interactiveProps: {
        module: moduleInstance({ pluginId: 'custom.tabs', moduleType: 'alternate-tabs' })
      }
    })
    expect(patchLayerNode(row, frame)).toBe(true)
    expect(row.moduleIdentity).toEqual({
      pluginId: 'custom.tabs',
      moduleType: 'alternate-tabs'
    })
    expect(model.items[0]).toBe(row)
    expect(patchLayerNode(row, frame)).toBe(false)
  })

  test.each(['removed', 'invalid', 'non-frame'])(
    'clears stale module identity when the source becomes %s',
    (change) => {
      const graph = makeSceneGraph()
      const pageId = firstPageId(graph)
      const frame = graph.createNode('FRAME', pageId, {
        interactiveProps: { module: moduleInstance() }
      })
      const model = buildLayerTreeModel(graph, pageId)
      const row = model.byId.get(frame.id)
      if (!row) throw new Error('Expected the module layer')

      graph.updateNode(
        frame.id,
        change === 'non-frame'
          ? { type: 'RECTANGLE' }
          : { interactiveProps: change === 'removed' ? {} : { module: { pluginId: 'invalid' } } }
      )

      expect(patchLayerNode(row, frame)).toBe(true)
      expect(row.moduleIdentity).toBeUndefined()
      expect(model.items[0]).toBe(row)
      expect(patchLayerNode(row, frame)).toBe(false)
    }
  )
})

describe('layer tree selection', () => {
  const rows = ['a', 'b', 'c', 'd']

  test('replaces, toggles, and ranges from the anchor', () => {
    expect(
      layerSelectionForTarget(rows, new Set(['a']), 'a', 'c', {
        additive: false,
        range: true
      })
    ).toEqual(new Set(['a', 'b', 'c']))
    expect(
      layerSelectionForTarget(rows, new Set(['a']), 'a', 'c', {
        additive: true,
        range: true
      })
    ).toEqual(new Set(['a', 'b', 'c']))
    expect(
      layerSelectionForTarget(rows, new Set(['a', 'b']), 'a', 'b', {
        additive: true,
        range: false
      })
    ).toEqual(new Set(['a']))
  })

  test('falls back to the target when the anchor is not visible', () => {
    expect(
      layerSelectionForTarget(rows, new Set(['a']), 'missing', 'd', {
        additive: true,
        range: true
      })
    ).toEqual(new Set(['d']))
  })
})
