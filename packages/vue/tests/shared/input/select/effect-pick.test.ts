import { afterEach, describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { createEditor, type Editor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import { initCanvasKit } from '@open-pencil/core/io'
import { getTextMeasurer, setTextMeasurer } from '@open-pencil/core/layout'
import {
  createEffectPickModuleFrameOverrides,
  EFFECT_PICK_CATALOG
} from '@open-pencil/core/plugins'
import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import { createCanvasPointer } from '#vue/canvas/pointer/use'
import { handleMoveMove, handleMoveUp } from '#vue/shared/input/move'
import { handleSelectDown } from '#vue/shared/input/select'
import type { DragMove, DragState } from '#vue/shared/input/types'

const ck = await initCanvasKit()
const editors: Editor[] = []
const renderers: SkiaRenderer[] = []
const previousTextMeasurer = getTextMeasurer()
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  setTextMeasurer(previousTextMeasurer)
  for (const renderer of renderers.splice(0)) renderer.destroy()
})

function fixture(nodeProps: Partial<SceneNode> = {}, parentProps?: Partial<SceneNode>) {
  const editor = createEditor()
  editors.push(editor)
  const surface = ck.MakeSurface(1, 1)
  if (!surface) throw new Error('Expected a headless canvas surface')
  const renderer = new SkiaRenderer(ck, surface)
  renderers.push(renderer)
  editor.setCanvasKit(ck, renderer)
  const parent = parentProps
    ? editor.graph.createNode('FRAME', editor.state.currentPageId, {
        x: 300,
        y: 200,
        width: 700,
        height: 500,
        ...parentProps
      })
    : undefined
  const node = editor.graph.createNode('FRAME', parent?.id ?? editor.state.currentPageId, {
    ...createEffectPickModuleFrameOverrides(),
    x: 40,
    y: 60,
    width: 224,
    height: 101,
    ...nodeProps
  })
  editor.undo.clear()
  return { editor, node, parent }
}

function selectDown(editor: Editor, point: Vector, modifiers: Partial<MouseEvent> = {}) {
  const pointer = createCanvasPointer(
    ref<HTMLCanvasElement | null>(null),
    editor,
    () => null,
    () => null,
    () => null
  )
  const screen = {
    x: point.x * editor.state.zoom + editor.state.panX,
    y: point.y * editor.state.zoom + editor.state.panY
  }
  let drag: DragState | undefined
  handleSelectDown(
    { shiftKey: false, altKey: false, ...modifiers } as MouseEvent,
    point.x,
    point.y,
    screen.x,
    screen.y,
    editor,
    pointer.hitFns,
    () => false,
    () => false,
    (next) => {
      drag = next
    }
  )
  return { drag, screen }
}

function requireMove(drag: DragState | undefined): DragMove {
  expect(drag?.type).toBe('move')
  if (drag?.type !== 'move') throw new Error('Expected a selected EffectPick move drag')
  return drag
}

function expectUnpainted(node: SceneNode) {
  expect(node.fills).toEqual([])
  expect(node.strokes).toEqual([])
}

function nodeCenter(editor: Editor, node: SceneNode): Vector {
  return createSceneGeometry(editor.graph).toWorld(node, {
    x: node.width / 2,
    y: node.height / 2
  })
}

function movePointer(editor: Editor, drag: DragMove, start: Vector, delta: Vector) {
  handleMoveMove(
    drag,
    start.x + delta.x,
    start.y + delta.y,
    drag.startScreenX + delta.x * editor.state.zoom,
    drag.startScreenY + delta.y * editor.state.zoom,
    editor,
    true
  )
}

describe('EffectPick canvas selection and dragging', () => {
  test('selects and moves every expansion effect without adding paints or changing its identity', () => {
    const entries = EFFECT_PICK_CATALOG.filter((entry) => entry.collectionVersion === '0.7.0')
    expect(entries).toHaveLength(20)
    for (const entry of entries) {
      const { editor, node } = fixture(createEffectPickModuleFrameOverrides(entry.defaultConfig))
      const before = structuredClone(node)
      const start = nodeCenter(editor, node)
      const move = requireMove(selectDown(editor, start).drag)
      movePointer(editor, move, start, { x: 23, y: 14 })
      handleMoveUp(move, editor)
      expect(node).toMatchObject({ x: before.x + 23, y: before.y + 14 })
      expect(node.interactiveProps).toEqual(before.interactiveProps)
      expect(node.childIds).toEqual([])
      expectUnpainted(node)
      expect(editor.undo.undo()).toBe('Move')
      expect(node).toMatchObject({ x: before.x, y: before.y })
      expect(node.interactiveProps).toEqual(before.interactiveProps)
      expectUnpainted(node)
    }
  })

  test('selects an unpainted reviewed module by its interior and commits one undoable move', () => {
    const { editor, node } = fixture()
    const before = structuredClone(node)
    const start = { x: node.x + node.width / 2, y: node.y + node.height / 2 }
    expect(editor.state.selectedIds.size).toBe(0)
    expectUnpainted(node)
    const { drag, screen } = selectDown(editor, start)
    const move = requireMove(drag)
    expect([...editor.state.selectedIds]).toEqual([node.id])
    handleMoveMove(move, start.x + 31, start.y + 17, screen.x + 31, screen.y + 17, editor, true)
    expect(node).toMatchObject({ x: before.x + 31, y: before.y + 17 })
    expectUnpainted(node)
    handleMoveUp(move, editor)
    expect(node).toMatchObject({ x: before.x + 31, y: before.y + 17 })
    expectUnpainted(node)
    expect(node.interactiveProps).toEqual(before.interactiveProps)
    expect(editor.undo.undo()).toBe('Move')
    expect(node).toMatchObject({ x: before.x, y: before.y })
    expect(editor.undo.canUndo).toBe(false)
    expect(editor.undo.redo()).toBe('Move')
    expect(node).toMatchObject({ x: before.x + 31, y: before.y + 17 })
    expectUnpainted(node)
  })

  test('ordinary empty frames above the module still let its visible content be selected', () => {
    const { editor, node } = fixture()
    const emptyFrame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      fills: [],
      strokes: []
    })
    const { drag } = selectDown(editor, nodeCenter(editor, node))
    expect(requireMove(drag).originals.has(node.id)).toBe(true)
    expect([...editor.state.selectedIds]).toEqual([node.id])
    expectUnpainted(emptyFrame)
    expectUnpainted(node)
    expect(editor.undo.canUndo).toBe(false)
  })

  for (const lockedOwner of ['module', 'ancestor'] as const) {
    test(`selects the locked ${lockedOwner} without starting a move`, () => {
      const { editor, node, parent } = fixture(
        { locked: lockedOwner === 'module' },
        lockedOwner === 'ancestor' ? { locked: true } : undefined
      )
      const before = structuredClone(node)
      const { drag } = selectDown(editor, nodeCenter(editor, node))
      expect(drag).toBeUndefined()
      expect([...editor.state.selectedIds]).toEqual([parent?.id ?? node.id])
      expect(node).toEqual(before)
      expectUnpainted(node)
      expect(editor.undo.canUndo).toBe(false)
    })
  }

  for (const zoom of [0.5, 2]) {
    test(`selects and moves a rotated module inside a nested rotated frame at zoom ${zoom}`, () => {
      const { editor, node, parent } = fixture({ rotation: -17 }, { rotation: 31 })
      if (!parent) throw new Error('Expected a nested frame')
      editor.enterContainer(parent.id)
      editor.setZoomAroundPoint(zoom, 0, 0)
      editor.pan(27, -14)
      const geometry = createSceneGeometry(editor.graph)
      const original = geometry.toWorld(node, { x: 0, y: 0 })
      const start = nodeCenter(editor, node)
      const { drag } = selectDown(editor, start)
      const move = requireMove(drag)
      const delta = { x: 24.5, y: -11.25 }
      movePointer(editor, move, start, delta)
      handleMoveUp(move, editor)
      const moved = geometry.toWorld(node, { x: 0, y: 0 })
      expect(moved.x - original.x).toBeCloseTo(delta.x, 5)
      expect(moved.y - original.y).toBeCloseTo(delta.y, 5)
      expect(node.parentId).toBe(parent.id)
      expect(node.rotation).toBe(-17)
      expectUnpainted(node)
      expect(editor.undo.undo()).toBe('Move')
      const restored = geometry.toWorld(node, { x: 0, y: 0 })
      expect(restored.x).toBeCloseTo(original.x, 5)
      expect(restored.y).toBeCloseTo(original.y, 5)
    })
  }

  test('uses the existing auto-layout reorder gesture instead of assigning arbitrary coordinates', () => {
    const { editor, node, parent } = fixture(
      {},
      {
        layoutMode: 'HORIZONTAL',
        primaryAxisSizing: 'FIXED',
        counterAxisSizing: 'FIXED',
        width: 600,
        height: 160,
        itemSpacing: 20
      }
    )
    if (!parent) throw new Error('Expected an auto-layout frame')
    const sibling = editor.graph.createNode('RECTANGLE', parent.id, { width: 100, height: 80 })
    editor.runLayoutForNode(parent.id)
    editor.undo.clear()
    const before = { x: node.x, y: node.y }
    const start = nodeCenter(editor, node)
    const { drag } = selectDown(editor, start)
    const move = requireMove(drag)
    expect(move.autoLayoutParentId).toBe(parent.id)
    const destination = { x: parent.x + parent.width - 10, y: start.y }
    movePointer(editor, move, start, {
      x: destination.x - start.x,
      y: destination.y - start.y
    })
    expect(editor.state.layoutInsertIndicator?.parentId).toBe(parent.id)
    expect(node).toMatchObject(before)
    handleMoveUp(move, editor)
    expect(parent.childIds).toEqual([sibling.id, node.id])
    expect(node.parentId).toBe(parent.id)
    expectUnpainted(node)
    expect(editor.undo.undo()).toBe('Reorder')
    expect(parent.childIds).toEqual([node.id, sibling.id])
    expect(node).toMatchObject(before)
    expectUnpainted(node)
  })

  test('adds another unpainted module by Shift-click and moves the selected modules together', () => {
    const { editor, node } = fixture()
    const second = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      ...createEffectPickModuleFrameOverrides({ effectId: 'water-text' }),
      x: 350,
      y: 70,
      width: 224,
      height: 101
    })
    const firstStart = nodeCenter(editor, node)
    handleMoveUp(requireMove(selectDown(editor, firstStart).drag), editor)
    const start = nodeCenter(editor, second)
    const move = requireMove(selectDown(editor, start, { shiftKey: true }).drag)
    expect([...editor.state.selectedIds]).toEqual([node.id, second.id])
    const originals = [node, second].map((current) => ({ x: current.x, y: current.y }))
    movePointer(editor, move, start, { x: 25, y: 19 })
    handleMoveUp(move, editor)
    for (const [index, current] of [node, second].entries()) {
      expect(current).toMatchObject({ x: originals[index].x + 25, y: originals[index].y + 19 })
      expectUnpainted(current)
    }
    expect(editor.undo.undo()).toBe('Move')
    for (const [index, current] of [node, second].entries()) {
      expect(current).toMatchObject(originals[index])
      expectUnpainted(current)
    }
    expect(editor.undo.canUndo).toBe(false)
  })

  test('canvas selection and dragging retain authored click actions and document state', () => {
    const { editor, node } = fixture({
      events: {
        onClick: [
          {
            id: 'business-click',
            kind: 'setVariable',
            targetName: 'clicks',
            valueExpr: '$prev + 1'
          }
        ]
      }
    })
    editor.graph.updateNode(editor.graph.rootId, {
      lowcodeDocumentState: [{ id: 'clicks', name: 'clicks', type: 'number', defaultValue: 0 }]
    })
    const root = editor.graph.getNode(editor.graph.rootId)
    if (!root) throw new Error('Expected a document root')
    const events = structuredClone(node.events)
    const state = structuredClone(root.lowcodeDocumentState)
    const start = nodeCenter(editor, node)
    const move = requireMove(selectDown(editor, start).drag)
    movePointer(editor, move, start, { x: 20, y: 12 })
    handleMoveUp(move, editor)
    expect(node.events).toEqual(events)
    expect(root.lowcodeDocumentState).toEqual(state)
    expectUnpainted(node)
    editor.undo.undo()
    expect(node.events).toEqual(events)
    expect(root.lowcodeDocumentState).toEqual(state)
  })
})
