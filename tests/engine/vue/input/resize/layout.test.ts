import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import { parseFigBuffer } from '@open-pencil/fig'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { collectResizeDescendants, createResizeSnapshot } from '@open-pencil/scene-graph/resize'

import { exportFigFile } from '#core/io/formats/fig/export'
import { applyResize, cancelResizePreview, commitResizePreview } from '#vue/shared/input/resize'
import type { DragResize } from '#vue/shared/input/types'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})

function setup() {
  const editor = createEditor()
  editors.push(editor)
  return editor
}

function start(editor: Editor, node: SceneNode, handle: DragResize['handle'] = 'e'): DragResize {
  editor.select([node.id])
  const snapshot = createResizeSnapshot(node)
  return {
    type: 'resize',
    handle,
    startX: 0,
    startY: 0,
    nodeId: node.id,
    origRect: { x: node.x, y: node.y, width: node.width, height: node.height },
    origVectorNetwork: snapshot.vectorNetwork,
    origFillGeometry: snapshot.fillGeometry,
    origStrokeGeometry: snapshot.strokeGeometry,
    origDerivedTextGlyphs: snapshot.derivedTextGlyphs,
    origStrokes: snapshot.strokes,
    origTextPathData: snapshot.textPathData ?? null,
    origTextPathBox: snapshot.textPathBox,
    origChildren: collectResizeDescendants(editor.graph, node.id),
    preview: editor.beginNodePreview('Resize', { preserveSourceMetadata: true })
  }
}

function vertical(editor: Editor) {
  return editor.graph.createNode('FRAME', editor.state.currentPageId, {
    width: 300,
    height: 200,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'STRETCH'
  })
}

describe('canvas resize within layout', () => {
  test('keeps Shift aspect ratio and center anchoring when a dimension reaches its limit', () => {
    const editor = setup()
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      width: 100,
      height: 100,
      maxWidth: 120
    })
    const drag = start(editor, node)
    applyResize(drag, 100, 0, true, editor, true)
    expect([node.x, node.y, node.width, node.height]).toEqual([0, -10, 120, 120])
    commitResizePreview(drag, editor)
    expect([node.width, node.height]).toEqual([120, 120])
  })

  test('accepts a fast handle crossing even when the final dimensions equal the starting dimensions', () => {
    const editor = setup()
    const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
      width: 100,
      height: 100
    })
    const drag = start(editor, node)
    applyResize(drag, -200, 0, false, editor, true)
    expect([node.x, node.width]).toEqual([-100, 100])
    commitResizePreview(drag, editor)
    editor.undoAction()
    expect([node.x, node.width]).toEqual([0, 100])
  })

  test('exports the resized Hug ancestor and repositioned sibling and restores their source on undo', async () => {
    const editor = setup()
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Hug parent',
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      itemSpacing: 10
    })
    const node = editor.graph.createNode('RECTANGLE', parent.id, { width: 100, height: 40 })
    const sibling = editor.graph.createNode('RECTANGLE', parent.id, {
      name: 'Moved sibling',
      width: 60,
      height: 40
    })
    editor.runLayoutForNode(parent.id)
    for (const item of [parent, sibling]) {
      item.source.format = 'fig'
      item.source.fig.rawSize = { x: item.width, y: item.height }
      item.source.fig.rawTransform = { m00: 1, m01: 0, m02: item.x, m10: 0, m11: 1, m12: item.y }
    }
    const sources = [structuredClone(parent.source), structuredClone(sibling.source)]
    const drag = start(editor, node)
    applyResize(drag, 80, 0, false, editor, true)
    commitResizePreview(drag, editor)
    expect([parent.width, sibling.x]).toEqual([250, 190])
    const parsed = parseFigBuffer(await exportFigFile(editor.graph))
    expect(parsed.nodeChanges.find((entry) => entry.name === parent.name)?.size?.x).toBe(250)
    expect(parsed.nodeChanges.find((entry) => entry.name === sibling.name)?.transform?.m02).toBe(
      190
    )
    editor.undoAction()
    expect([parent.source, sibling.source]).toEqual(sources)
    expect([parent.width, sibling.x]).toEqual([170, 110])
  })

  test('resizes imported derived geometry without discarding the untouched axis, and cancels exactly', () => {
    const editor = setup()
    const parent = vertical(editor)
    const node = editor.graph.createNode('INPUT', parent.id, {
      width: 300,
      height: 44,
      derivedLayout: { x: 0, y: 0, width: 300, height: 44 }
    })
    node.source.format = 'fig'
    const derived = structuredClone(node.derivedLayout)
    const drag = start(editor, node)
    applyResize(drag, -100, 0, false, editor, true)
    expect(node.width).toBe(200)
    expect(node.derivedLayout).toEqual({ x: 0, y: 0, height: 44 })
    cancelResizePreview(drag)
    expect(node.width).toBe(300)
    expect(node.derivedLayout).toEqual(derived)
  })

  test('exports changed imported sizing and restores exact source metadata through undo/redo', async () => {
    const editor = setup()
    const parent = vertical(editor)
    const node = editor.graph.createNode('FRAME', parent.id, {
      name: 'Imported child',
      width: 80,
      height: 44,
      layoutGrow: 1,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    editor.graph.createNode('RECTANGLE', node.id, { width: 80, height: 44 })
    editor.runLayoutForNode(parent.id)
    node.source.format = 'fig'
    node.source.fig.layout = {
      stackMode: 'HORIZONTAL',
      stackPrimarySizing: 'RESIZE_TO_FIT',
      stackCounterSizing: 'FIXED',
      stackChildPrimaryGrow: 1,
      stackChildAlignSelf: 'STRETCH'
    }
    node.source.fig.rawSize = { x: node.width, y: node.height }
    const source = structuredClone(node.source)
    const drag = start(editor, node, 'se')
    applyResize(drag, -100, -50, false, editor, true)
    commitResizePreview(drag, editor)
    const committed = structuredClone(node.source)
    const parsed = parseFigBuffer(await exportFigFile(editor.graph))
    const exported = parsed.nodeChanges.find((entry) => entry.name === node.name)
    expect(exported).toMatchObject({
      size: { x: 200, y: 150 },
      stackPrimarySizing: 'FIXED',
      stackChildPrimaryGrow: 0,
      stackChildAlignSelf: 'MIN'
    })
    editor.undoAction()
    expect(node.source).toEqual(source)
    expect([node.width, node.height]).toEqual([300, 200])
    editor.redoAction()
    expect(node.source).toEqual(committed)
    expect([node.width, node.height]).toEqual([200, 150])
  })

  test('fixes stretched width during preview and keeps vertical Grow through undo/redo', () => {
    const editor = setup()
    const parent = vertical(editor)
    const node = editor.graph.createNode('INPUT', parent.id, {
      width: 80,
      height: 44,
      layoutGrow: 1
    })
    editor.runLayoutForNode(parent.id)
    expect([node.width, node.height]).toEqual([300, 200])
    const drag = start(editor, node)
    applyResize(drag, -100, 0, false, editor, true)
    expect([node.width, node.height, node.layoutAlignSelf, node.layoutGrow]).toEqual([
      200,
      200,
      'MIN',
      1
    ])
    commitResizePreview(drag, editor)
    expect(node.width).toBe(200)
    editor.undoAction()
    expect([node.width, node.height, node.layoutAlignSelf, node.layoutGrow]).toEqual([
      300,
      200,
      'AUTO',
      1
    ])
    expect(editor.undo.canUndo).toBe(false)
    editor.redoAction()
    expect(node.width).toBe(200)
    editor.updateNode(parent.id, { width: 400, height: 260 })
    expect([node.width, node.height]).toEqual([200, 260])
  })

  test('captures Hug ancestors and siblings and restores them on cancel', () => {
    const editor = setup()
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      itemSpacing: 10
    })
    const node = editor.graph.createNode('RECTANGLE', parent.id, { width: 80, height: 40 })
    const sibling = editor.graph.createNode('RECTANGLE', parent.id, { width: 50, height: 30 })
    editor.runLayoutForNode(parent.id)
    const drag = start(editor, node)
    const before = [parent.width, sibling.x, node.width]
    applyResize(drag, 40, 0, false, editor, true)
    expect([parent.width, sibling.x, node.width]).toEqual([180, 130, 120])
    cancelResizePreview(drag)
    expect([parent.width, sibling.x, node.width]).toEqual(before)
    applyResize(drag, 90, 0, false, editor, true)
    commitResizePreview(drag, editor)
    expect([parent.width, sibling.x, node.width]).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('fixes only the resized Hug axis, including moving back to the initial size', () => {
    const editor = setup()
    const node = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG'
    })
    editor.graph.createNode('RECTANGLE', node.id, { width: 100, height: 40 })
    editor.runLayoutForNode(node.id)
    const drag = start(editor, node)
    applyResize(drag, 80, 0, false, editor, true)
    expect([node.width, node.height, node.primaryAxisSizing, node.counterAxisSizing]).toEqual([
      180,
      40,
      'FIXED',
      'HUG'
    ])
    applyResize(drag, 0, 0, false, editor, true)
    commitResizePreview(drag, editor)
    expect([node.width, node.height, node.primaryAxisSizing, node.counterAxisSizing]).toEqual([
      100,
      40,
      'HUG',
      'HUG'
    ])
    expect(editor.undo.canUndo).toBe(false)
  })

  test('clamps before preview and scales geometry against the limited size with a stationary edge', () => {
    const editor = setup()
    const node = editor.graph.createNode('VECTOR', editor.state.currentPageId, {
      x: 30,
      y: 20,
      width: 100,
      height: 80,
      minWidth: 50,
      maxWidth: 120,
      vectorNetwork: { vertices: [{ x: 100, y: 80 }], segments: [], regions: [] }
    })
    const drag = start(editor, node, 'w')
    applyResize(drag, -100, 0, false, editor, true)
    expect([node.x, node.width, node.vectorNetwork?.vertices[0].x]).toEqual([10, 120, 120])
    applyResize(drag, 90, 0, false, editor, true)
    expect([node.x, node.width, node.vectorNetwork?.vertices[0].x]).toEqual([80, 50, 50])
    commitResizePreview(drag, editor)
    expect([node.x, node.width, node.minWidth, node.maxWidth]).toEqual([80, 50, 50, 120])
    editor.undoAction()
    expect([node.x, node.width, node.vectorNetwork?.vertices[0].x]).toEqual([30, 100, 100])
  })

  test('explicit text height becomes fixed and restores auto-height on undo', () => {
    const editor = setup()
    const node = editor.graph.createNode('TEXT', editor.state.currentPageId, {
      width: 100,
      height: 24,
      text: 'Text',
      textAutoResize: 'HEIGHT'
    })
    const drag = start(editor, node, 's')
    applyResize(drag, 0, 50, false, editor, true)
    expect([node.height, node.textAutoResize]).toEqual([74, 'NONE'])
    commitResizePreview(drag, editor)
    expect(node.height).toBe(74)
    editor.undoAction()
    expect([node.height, node.textAutoResize]).toEqual([24, 'HEIGHT'])
  })

  for (const change of ['selection', 'page', 'graph', 'delete'] as const) {
    test(`${change} invalidates resize and ignores late move/up`, () => {
      const editor = setup()
      const node = editor.graph.createNode('RECTANGLE', editor.state.currentPageId, {
        width: 100,
        height: 40
      })
      const drag = start(editor, node)
      const previousGraph = editor.graph
      applyResize(drag, 80, 0, false, editor, true)
      if (change === 'selection') editor.clearSelection()
      if (change === 'page') editor.addPage('Another page')
      if (change === 'graph') editor.replaceGraph(new SceneGraph())
      if (change === 'delete') editor.graph.deleteNode(node.id)
      expect(drag.preview?.closed).toBe(true)
      applyResize(drag, 160, 0, false, editor, true)
      commitResizePreview(drag, editor)
      if (change !== 'delete') expect(previousGraph.getNode(node.id)?.width).toBe(100)
      expect(editor.isInteractiveEditing()).toBe(false)
    })
  }

  test('no-movement handle click preserves policies, imported metadata, and history', () => {
    const editor = setup()
    const parent = vertical(editor)
    const node = editor.graph.createNode('INPUT', parent.id, { height: 44 })
    editor.runLayoutForNode(parent.id)
    const source = structuredClone(node.source)
    const drag = start(editor, node)
    applyResize(drag, 0, 0, false, editor)
    commitResizePreview(drag, editor)
    expect(node.width).toBe(300)
    expect(node.layoutAlignSelf).toBe('AUTO')
    expect(node.source).toEqual(source)
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.isInteractiveEditing()).toBe(false)
  })
})
