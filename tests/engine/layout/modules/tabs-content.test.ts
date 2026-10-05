import { expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor/create'
import { computeAllLayouts, computeAllLayoutsAsync, computeLayout } from '#core/layout'
import { createLayoutRunner } from '#core/layout/mutations'
import { createTabsModuleFrameOverrides } from '#core/plugins/tabs'

function fixture(parentId?: string, existingGraph?: SceneGraph) {
  const graph = existingGraph ?? new SceneGraph()
  const tabs = graph.createNode('FRAME', parentId ?? graph.getPages()[0].id, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'overview', label: 'Overview', content: '', contentChildName: 'Overview panel' },
        { id: 'details', label: 'Details', content: '', contentChildName: 'Details panel' }
      ],
      initialTabId: 'overview'
    }),
    width: 320,
    height: 400,
    counterAxisSizing: 'FILL'
  })
  const panel = graph.createNode('FRAME', tabs.id, {
    name: 'Overview panel',
    width: 320,
    height: 44,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    counterAxisAlign: 'STRETCH',
    itemSpacing: 12
  })
  const first = graph.createNode('RECTANGLE', panel.id, { width: 320, height: 30 })
  const second = graph.createNode('RECTANGLE', panel.id, { width: 320, height: 40 })
  const form = graph.createNode('FORM', tabs.id, {
    name: 'Details panel',
    width: 320,
    height: 44,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    counterAxisAlign: 'STRETCH'
  })
  const input = graph.createNode('INPUT', form.id, { width: 320, height: 44 })
  return { graph, tabs, panel, first, second, form, input }
}

function expectPanelLayout(f: ReturnType<typeof fixture>, width = 288) {
  expect(f.panel.x).toBe(16)
  expect(f.panel.y).toBeGreaterThan(32)
  expect(f.panel.width).toBeCloseTo(width)
  expect(f.panel.height).toBe(82)
  expect(f.first.width).toBeCloseTo(width)
  expect(f.second.y).toBe(42)
  expect(f.form.x).toBe(f.panel.x)
  expect(f.form.y).toBe(f.panel.y)
  expect(f.input.width).toBeCloseTo(width - f.form.paddingLeft - f.form.paddingRight)
  expect(f.form.height).toBe(44 + f.form.paddingTop + f.form.paddingBottom)
}

test('standalone tabs give both editable panel roots the bounded content slot geometry', () => {
  const f = fixture()
  computeLayout(f.graph, f.tabs.id)
  expectPanelLayout(f)
  expect(f.panel.counterAxisSizing).toBe('FILL')
  expect(f.panel.primaryAxisSizing).toBe('HUG')
  expect(f.form.visible).toBe(true)
})

test('parent Yoga resize recomputes Tabs content after the host width changes', () => {
  const graph = new SceneGraph()
  const parent = graph.createNode('FRAME', graph.getPages()[0].id, {
    width: 420,
    height: 600,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'STRETCH',
    paddingLeft: 20,
    paddingRight: 20
  })
  const f = fixture(parent.id, graph)
  computeLayout(graph, parent.id)
  expect(f.tabs.width).toBe(380)
  expectPanelLayout(f, 348)
  graph.updateNode(parent.id, { width: 360 })
  computeLayout(graph, parent.id)
  expectPanelLayout(f)
})

test('imported stale geometry cannot pin slotted content to the tab header', () => {
  const f = fixture()
  for (const node of [f.tabs, f.panel, f.first, f.second, f.form, f.input]) {
    node.source = { ...node.source, format: 'fig' }
    node.derivedLayout = { x: 0, y: 0, width: 0, height: 1 }
  }
  const source = structuredClone(f.panel.source)
  const derived = structuredClone(f.panel.derivedLayout)
  computeAllLayouts(f.graph)
  expectPanelLayout(f)
  expect(f.panel.source).toEqual(source)
  expect(f.panel.derivedLayout).toEqual(derived)
})

test('fixed-size panel content stays fixed, while vertical Tabs reserve the sidebar', () => {
  const f = fixture()
  f.graph.updateNode(f.panel.id, { counterAxisSizing: 'FIXED', width: 100 })
  const module = f.tabs.interactiveProps?.module
  if (!module) throw new Error('Missing module')
  f.graph.updateNode(f.tabs.id, {
    interactiveProps: {
      module: { ...module, config: { ...module.config, orientation: 'vertical' } }
    }
  })
  computeAllLayouts(f.graph)
  expect(f.panel.x).toBeGreaterThan(100)
  expect(f.panel.y).toBe(16)
  expect(f.panel.width).toBe(100)
  expect(f.first.width).toBe(100)
})

test('cooperative layout reaches standalone and nested Tabs using the same content geometry', async () => {
  const f = fixture()
  const nested = fixture(f.panel.id, f.graph)
  await computeAllLayoutsAsync(f.graph)
  expect(f.panel.x).toBe(16)
  expect(nested.tabs.width).toBe(288)
  expectPanelLayout(nested, 256)
})

test('cancelled cooperative module layout never leaves temporary sizing or source changes', async () => {
  const f = fixture()
  const before = new Map<
    string,
    Pick<SceneNode, 'source' | 'primaryAxisSizing' | 'counterAxisSizing' | 'visible'>
  >()
  for (const node of f.graph.getAllNodes()) {
    before.set(
      node.id,
      structuredClone({
        source: node.source,
        primaryAxisSizing: node.primaryAxisSizing,
        counterAxisSizing: node.counterAxisSizing,
        visible: node.visible
      })
    )
  }
  const controller = new AbortController()
  let checkpoints = 0
  await expect(
    computeAllLayoutsAsync(f.graph, undefined, {
      signal: controller.signal,
      timeSliceMs: 0.1,
      now: () => ++checkpoints,
      hostYield: async () => {
        if (checkpoints > 20) controller.abort()
      }
    })
  ).rejects.toThrow('Layout cancelled')
  for (const node of f.graph.getAllNodes()) {
    expect({
      source: node.source,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      visible: node.visible
    }).toEqual(before.get(node.id))
  }
})

test('editing an imported slot descendant cannot restore stale geometry before its module layout', () => {
  const f = fixture()
  computeAllLayouts(f.graph)
  for (const node of [f.panel, f.first, f.second]) {
    node.source = { ...node.source, format: 'fig' }
    node.derivedLayout = { x: 0, y: 0, width: 0, height: 1 }
  }
  f.graph.updateNode(f.first.id, { height: 50 })
  createLayoutRunner(() => f.graph).runLayoutForNode(f.first.id)
  expect(f.first.height).toBe(50)
  expect(f.second.height).toBe(40)
  expect(f.second.y).toBe(62)
  expect(f.panel.height).toBe(102)
  expect(f.panel.x).toBe(16)
  expect(f.panel.width).toBe(288)
})

test('Tabs without explicit slots retain ordinary child geometry', () => {
  const graph = new SceneGraph()
  const tabs = graph.createNode('FRAME', graph.getPages()[0].id, createTabsModuleFrameOverrides())
  const child = graph.createNode('RECTANGLE', tabs.id, { x: 23, y: 28, width: 110, height: 42 })
  computeAllLayouts(graph)
  expect({ x: child.x, y: child.y, width: child.width, height: child.height }).toEqual({
    x: 23,
    y: 28,
    width: 110,
    height: 42
  })
})

test('editor module and slot edits reflow consistently through undo and redo', () => {
  const f = fixture()
  const editor = createEditor()
  try {
    editor.replaceGraph(f.graph)
    editor.runLayoutForNode(f.tabs.id)
    const horizontalY = f.panel.y
    const module = f.tabs.interactiveProps?.module
    if (!module) throw new Error('Missing module')
    editor.updateNodeWithUndo(f.tabs.id, {
      interactiveProps: {
        module: { ...module, config: { ...module.config, orientation: 'vertical' } }
      }
    })
    expect(f.panel.x).toBeGreaterThan(100)
    expect(f.panel.y).toBe(16)
    editor.undo.undo()
    expect(f.panel.x).toBe(16)
    expect(f.panel.y).toBe(horizontalY)
    editor.undo.redo()
    expect(f.panel.x).toBeGreaterThan(100)
    expect(f.panel.y).toBe(16)
    editor.updateNodeWithUndo(f.first.id, { height: 50 })
    expect(f.panel.height).toBe(102)
    editor.undo.undo()
    expect(f.panel.height).toBe(82)
    editor.undo.redo()
    expect(f.panel.height).toBe(102)
  } finally {
    editor.dispose()
  }
})

test.each(['slot root', 'nested'] as const)(
  'Tabs preserve imported instance internals when the instance is a %s',
  (placement) => {
    const f = fixture()
    const instance =
      placement === 'slot root'
        ? f.panel
        : f.graph.createNode('INSTANCE', f.panel.id, {
            width: 140,
            height: 110,
            layoutMode: 'VERTICAL'
          })
    f.graph.updateNode(instance.id, { type: 'INSTANCE' })
    instance.source = { ...instance.source, format: 'fig' }
    instance.derivedLayout = { width: instance.width, height: instance.height }
    const inside = f.graph.createNode('FRAME', instance.id, {
      x: 31,
      y: 47,
      width: 89,
      height: 53,
      layoutMode: 'VERTICAL'
    })
    const grandchild = f.graph.createNode('RECTANGLE', inside.id, {
      x: 13,
      y: 19,
      width: 29,
      height: 23
    })
    const before = [inside, grandchild].map((node) => ({
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      source: structuredClone(node.source),
      derivedLayout: structuredClone(node.derivedLayout)
    }))
    const instanceSource = structuredClone(instance.source)
    const instanceDerived = structuredClone(instance.derivedLayout)
    computeLayout(f.graph, f.tabs.id)
    expect(
      [inside, grandchild].map((node) => ({
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        source: node.source,
        derivedLayout: node.derivedLayout
      }))
    ).toEqual(before)
    expect(instance.source).toEqual(instanceSource)
    expect(instance.derivedLayout).toEqual(instanceDerived)
    expect(f.panel.x).toBe(16)
    expect(f.panel.y).toBeGreaterThan(32)
  }
)
