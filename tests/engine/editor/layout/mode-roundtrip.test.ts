import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph, type LayoutMode, type SceneNode } from '@open-pencil/scene-graph'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

const preferences = {
  itemSpacing: 17,
  counterAxisSpacing: 9,
  paddingTop: 11,
  paddingRight: 22,
  paddingBottom: 33,
  paddingLeft: 44,
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'HUG',
  primaryAxisAlign: 'CENTER',
  counterAxisAlign: 'MAX',
  layoutWrap: 'WRAP',
  counterAxisAlignContent: 'SPACE_BETWEEN',
  gridTemplateColumns: [
    { sizing: 'FIXED', value: 80 },
    { sizing: 'FR', value: 2 }
  ],
  gridTemplateRows: [{ sizing: 'FIXED', value: 60 }],
  gridColumnGap: 13,
  gridRowGap: 19
} satisfies Partial<SceneNode>

function fixture(layoutMode: LayoutMode) {
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    name: 'Layout preferences',
    width: 400,
    height: 200,
    layoutMode,
    ...preferences
  })
  graph.createNode('RECTANGLE', node.id, { name: 'First', x: 20, y: 30, width: 40, height: 25 })
  graph.createNode('RECTANGLE', node.id, { name: 'Second', x: 120, y: 80, width: 60, height: 35 })
  return { graph, node }
}

function findFrame(graph: SceneGraph) {
  const node = [...graph.getAllNodes()].find((entry) => entry.name === 'Layout preferences')
  if (!node) throw new Error('Missing reopened layout frame')
  return node
}

async function reopen(graph: SceneGraph) {
  const bytes = await exportFigFile(graph)
  return parseFigFile(bytes.slice().buffer)
}

function editorFor(graph: SceneGraph) {
  const editor = createEditor()
  editor.replaceGraph(graph)
  editors.push(editor)
  return editor
}

describe('layout mode preferences through binary FIG files', () => {
  beforeAll(initCodec)

  test.each(['NONE', 'FREE'] as const)(
    '%s preserves dormant flex and grid settings without moving children',
    async (mode) => {
      const { graph, node } = fixture(mode)
      const reopened = await reopen(graph)
      const restored = findFrame(reopened)
      expect(restored.layoutMode).toBe(mode)
      expect(restored).toMatchObject(preferences)
      expect(
        reopened
          .getChildren(restored.id)
          .map(({ x, y, width, height }) => ({ x, y, width, height }))
      ).toEqual(
        graph.getChildren(node.id).map(({ x, y, width, height }) => ({ x, y, width, height }))
      )
    }
  )

  test.each(['HORIZONTAL', 'VERTICAL'] as const)(
    '%s preserves dormant grid tracks across repeated saves',
    async (mode) => {
      const { graph } = fixture(mode)
      const reopened = await reopen(await reopen(graph))
      expect(findFrame(reopened)).toMatchObject(preferences)
    }
  )

  test.each(['NONE', 'FREE'] as const)(
    'imported flex can be disabled to %s, reopened and re-enabled with its authored settings',
    async (mode) => {
      const { graph } = fixture('HORIZONTAL')
      const editor = editorFor(await reopen(graph))
      const node = findFrame(editor.graph)
      editor.setLayoutMode(node.id, mode)
      const bytes = await exportFigFile(editor.graph)
      const binary = parseFigBuffer(bytes)
      expect(binary.nodeChanges.find((entry) => entry.name === node.name)?.stackMode).not.toBe(
        'HORIZONTAL'
      )
      const reopened = await parseFigFile(bytes.slice().buffer)
      expect(findFrame(reopened)).toMatchObject({ layoutMode: mode, ...preferences })
      const restoredEditor = editorFor(reopened)
      const restored = findFrame(restoredEditor.graph)
      restoredEditor.setLayoutMode(restored.id, 'HORIZONTAL')
      expect(restored).toMatchObject({ layoutMode: 'HORIZONTAL', ...preferences })
      expect(findFrame(await reopen(restoredEditor.graph))).toMatchObject({
        layoutMode: 'HORIZONTAL',
        ...preferences
      })
    }
  )

  test('imported grid retains tracks after disabling, saving and re-enabling', async () => {
    const { graph } = fixture('GRID')
    const editor = editorFor(await reopen(graph))
    editor.setLayoutMode(findFrame(editor.graph).id, 'NONE')
    const restoredEditor = editorFor(await reopen(editor.graph))
    const restored = findFrame(restoredEditor.graph)
    expect(restored).toMatchObject({ layoutMode: 'NONE', ...preferences })
    restoredEditor.setLayoutMode(restored.id, 'GRID')
    expect(restored).toMatchObject({ layoutMode: 'GRID', ...preferences })
    expect(findFrame(await reopen(restoredEditor.graph))).toMatchObject({
      layoutMode: 'GRID',
      ...preferences
    })
  })

  test.each(['NONE', 'FREE', 'HORIZONTAL', 'VERTICAL', 'GRID'] as const)(
    '%s retains inherited STRETCH alignment after two binary saves',
    async (mode) => {
      const { graph, node } = fixture(mode)
      graph.updateNode(node.id, { counterAxisAlign: 'STRETCH' })
      expect(findFrame(await reopen(await reopen(graph))).counterAxisAlign).toBe('STRETCH')
    }
  )

  test('explicit direction change releases imported painted Hug dimensions and is undoable', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Layout preferences',
      layoutMode: 'HORIZONTAL',
      width: 170,
      height: 40,
      itemSpacing: 10,
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('RECTANGLE', node.id, { width: 100, height: 40 })
    graph.createNode('RECTANGLE', node.id, { x: 110, width: 60, height: 40 })
    const editor = editorFor(await reopen(graph))
    const restored = findFrame(editor.graph)
    const derived = structuredClone(restored.derivedLayout)
    expect(derived).toMatchObject({ width: 170, height: 40 })
    editor.setLayoutMode(restored.id, 'VERTICAL')
    expect([restored.width, restored.height]).toEqual([100, 90])
    const exported = findFrame(await reopen(editor.graph))
    expect([exported.width, exported.height]).toEqual([100, 90])
    editor.undoAction()
    expect(restored.derivedLayout).toEqual(derived)
    expect([restored.width, restored.height]).toEqual([170, 40])
    editor.redoAction()
    expect([restored.width, restored.height]).toEqual([100, 90])
  })

  const gridPayload = {
    version: 1,
    gridTemplateColumns: [{ sizing: 'FR', value: 1 }],
    gridTemplateRows: [],
    gridColumnGap: 3,
    gridRowGap: 7
  }

  test('explicit direction change reflows imported FRAME children and persists their new positions', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Layout preferences',
      layoutMode: 'HORIZONTAL',
      width: 250,
      height: 200,
      itemSpacing: 10
    })
    graph.createNode('FRAME', node.id, { name: 'First', width: 50, height: 50 })
    graph.createNode('FRAME', node.id, { name: 'Second', x: 60, width: 50, height: 50 })
    const editor = editorFor(await reopen(graph))
    const restored = findFrame(editor.graph)
    const second = editor.graph.getChildren(restored.id)[1]
    const source = structuredClone(second.source)
    editor.setLayoutMode(restored.id, 'VERTICAL')
    expect([second.x, second.y]).toEqual([0, 60])
    const reopened = await reopen(editor.graph)
    expect(reopened.getChildren(findFrame(reopened).id)[1]).toMatchObject({ x: 0, y: 60 })
    editor.undoAction()
    expect([second.x, second.y]).toEqual([60, 0])
    expect(second.source).toEqual(source)
    editor.redoAction()
    expect([second.x, second.y]).toEqual([0, 60])
  })

  test('imported vertical layout retains its geometry through an unchanged freeform round trip', async () => {
    const graph = new SceneGraph()
    const node = graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Layout preferences',
      layoutMode: 'VERTICAL',
      width: 100,
      height: 114,
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      itemSpacing: 10,
      paddingTop: 12,
      paddingBottom: 12,
      paddingLeft: 10,
      paddingRight: 10,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    graph.createNode('FRAME', node.id, { x: 10, y: 12, width: 80, height: 40 })
    graph.createNode('FRAME', node.id, { x: 10, y: 62, width: 80, height: 40 })
    const editor = editorFor(await reopen(graph))
    const restored = findFrame(editor.graph)
    const geometry = () =>
      [restored, ...editor.graph.getChildren(restored.id)].map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height
      }))
    const before = geometry()
    editor.setLayoutMode(restored.id, 'NONE')
    expect(geometry()).toEqual(before)
    editor.setLayoutMode(restored.id, 'VERTICAL')
    expect(geometry()).toEqual(before)
    const reopened = await reopen(editor.graph)
    const reopenedRoot = findFrame(reopened)
    expect(
      [reopenedRoot, ...reopened.getChildren(reopenedRoot.id)].map(({ x, y, width, height }) => ({
        x,
        y,
        width,
        height
      }))
    ).toEqual(before)
  })

  test.each([
    ['malformed JSON', '{'],
    ['future version', JSON.stringify({ ...gridPayload, version: 2 })],
    ['unknown mode key', JSON.stringify({ ...gridPayload, layoutMode: 'GRID' })],
    ['partial grid data', JSON.stringify({ version: 1, gridRowGap: 3 })],
    [
      'negative track',
      JSON.stringify({ ...gridPayload, gridTemplateRows: [{ sizing: 'FIXED', value: -1 }] })
    ],
    [
      'track extra key',
      JSON.stringify({
        ...gridPayload,
        gridTemplateRows: [{ sizing: 'FR', value: 1, extra: true }]
      })
    ],
    [
      'excessive tracks',
      JSON.stringify({
        ...gridPayload,
        gridTemplateRows: Array.from({ length: 4097 }, () => ({ sizing: 'AUTO', value: 0 }))
      })
    ],
    ['non-finite gap', JSON.stringify({ ...gridPayload, gridColumnGap: Infinity })],
    ['unknown alignment', JSON.stringify({ version: 1, counterAxisAlign: 'FILL' })],
    ['oversized payload', JSON.stringify(gridPayload) + ' '.repeat(524288)]
  ])('keeps invalid %s preferences inert without enabling layout', async (_name, value) => {
    const graph = new SceneGraph()
    const entry = { pluginId: 'open-pencil', key: 'layoutPreferences', value }
    graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Layout preferences',
      pluginData: [entry]
    })
    const restored = findFrame(await reopen(await reopen(graph)))
    expect(restored.layoutMode).toBe('NONE')
    expect(restored.gridTemplateColumns).toEqual([])
    expect(restored.counterAxisAlign).toBe('MIN')
    expect(restored.pluginData).toContainEqual(entry)
  })

  test('accepts the bounded track limit without enabling inactive Grid mode', async () => {
    const graph = new SceneGraph()
    const tracks = Array.from({ length: 4096 }, () => ({ sizing: 'AUTO' as const, value: 0 }))
    graph.createNode('FRAME', graph.getPages()[0].id, {
      name: 'Layout preferences',
      gridTemplateColumns: tracks
    })
    const restored = findFrame(await reopen(graph))
    expect(restored.gridTemplateColumns).toEqual(tracks)
    expect(restored.layoutMode).toBe('NONE')
  })
})
