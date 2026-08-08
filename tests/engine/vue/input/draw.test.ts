import { describe, expect, test } from 'bun:test'

import { createEditor, type Editor } from '@open-pencil/core/editor'
import { MAP_MODULE_DEFAULT_SIZE, resolveMapModule } from '@open-pencil/core/plugins'

import { handleDrawMove, handleDrawUp, startShapeDraw } from '#vue/shared/input/draw'
import type { DragDraw } from '#vue/shared/input/types'

import { getNodeOrThrow } from '#tests/helpers/assert'

function startMapDraw(editor: Editor, x: number, y: number): DragDraw {
  let draw: DragDraw | undefined
  editor.setTool('MAP')
  startShapeDraw(x, y, editor, (next) => {
    if (next.type === 'draw') draw = next
  })
  if (!draw) throw new Error('Expected MAP tool to start a draw interaction')
  return draw
}

function expectValidMap(editor: Editor, id: string): void {
  expect(resolveMapModule(getNodeOrThrow(editor.graph, id).interactiveProps?.module)).toMatchObject(
    {
      ok: true,
      config: { provider: 'openstreetmap', style: 'standard', zoom: 2 }
    }
  )
}

describe('MAP tool drawing', () => {
  test('creates a 360x240 point map, restores SELECT, and supports undo and redo', () => {
    const editor = createEditor()
    const draw = startMapDraw(editor, 40, 56)

    expect(getNodeOrThrow(editor.graph, draw.nodeId)).toMatchObject({
      name: 'Map',
      width: 0,
      height: 0
    })

    handleDrawUp(draw, editor)

    expect(getNodeOrThrow(editor.graph, draw.nodeId)).toMatchObject({
      type: 'FRAME',
      x: 40,
      y: 56,
      width: MAP_MODULE_DEFAULT_SIZE.width,
      height: MAP_MODULE_DEFAULT_SIZE.height
    })
    expectValidMap(editor, draw.nodeId)
    expect(editor.state.activeTool).toBe('SELECT')
    expect(editor.undo.undoLabel).toBe('Create shape')

    editor.undo.undo()
    expect(editor.graph.getNode(draw.nodeId)).toBeUndefined()

    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, draw.nodeId)).toMatchObject({
      width: MAP_MODULE_DEFAULT_SIZE.width,
      height: MAP_MODULE_DEFAULT_SIZE.height
    })
    expectValidMap(editor, draw.nodeId)
  })

  test('uses the dragged bounds while preserving a valid map module and history', () => {
    const editor = createEditor()
    const draw = startMapDraw(editor, 100, 120)

    handleDrawMove(draw, 420, 300, false, editor)
    handleDrawUp(draw, editor)

    expect(getNodeOrThrow(editor.graph, draw.nodeId)).toMatchObject({
      type: 'FRAME',
      x: 100,
      y: 120,
      width: 320,
      height: 180
    })
    expectValidMap(editor, draw.nodeId)
    expect(editor.state.activeTool).toBe('SELECT')

    editor.undo.undo()
    expect(editor.graph.getNode(draw.nodeId)).toBeUndefined()

    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, draw.nodeId)).toMatchObject({
      x: 100,
      y: 120,
      width: 320,
      height: 180
    })
    expectValidMap(editor, draw.nodeId)
  })
})
