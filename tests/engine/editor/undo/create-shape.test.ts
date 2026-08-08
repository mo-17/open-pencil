import { describe, test, expect } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createMapModuleFrameOverrides,
  MAP_MODULE_DEFAULT_SIZE,
  resolveMapModule
} from '@open-pencil/core/plugins'

import { getNodeOrThrow } from '#tests/helpers/assert'

describe('create shape undo/redo', () => {
  test('preserves a map module instance across create undo and redo', () => {
    const editor = createEditor()

    const id = editor.createShape(
      'FRAME',
      24,
      36,
      0,
      0,
      undefined,
      undefined,
      createMapModuleFrameOverrides({
        center: [121.4737, 31.2304],
        zoom: 11,
        style: 'dark'
      })
    )

    const created = getNodeOrThrow(editor.graph, id)
    expect(created.type).toBe('FRAME')
    expect(created.width).toBe(MAP_MODULE_DEFAULT_SIZE.width)
    expect(created.height).toBe(MAP_MODULE_DEFAULT_SIZE.height)
    expect(resolveMapModule(created.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: {
        center: [121.4737, 31.2304],
        zoom: 11,
        style: 'dark'
      }
    })

    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()

    editor.undo.redo()
    const restored = getNodeOrThrow(editor.graph, id)
    expect(restored.type).toBe('FRAME')
    expect(resolveMapModule(restored.interactiveProps?.module)).toEqual(
      resolveMapModule(created.interactiveProps?.module)
    )
  })

  test('batched create+resize undoes in one step', () => {
    const editor = createEditor()

    // Simulate draw tool: batch(create + resize)
    editor.undo.beginBatch('Create shape')
    const id = editor.createShape('RECTANGLE', 100, 100, 0, 0)
    editor.graph.updateNode(id, { x: 100, y: 100, width: 200, height: 150 })
    editor.commitResize(id, { x: 100, y: 100, width: 0, height: 0 })
    editor.undo.commitBatch()

    expect(getNodeOrThrow(editor.graph, id).width).toBe(200)
    expect(getNodeOrThrow(editor.graph, id).height).toBe(150)

    // Single undo removes the shape entirely
    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()

    // Single redo restores with full dimensions
    editor.undo.redo()
    const restored = getNodeOrThrow(editor.graph, id)
    expect(restored.width).toBe(200)
    expect(restored.height).toBe(150)
    expect(restored.x).toBe(100)
    expect(restored.y).toBe(100)
  })

  test('redo after create+move+duplicate restores correct state', () => {
    const editor = createEditor()

    // Create shape via draw tool (batched)
    editor.undo.beginBatch('Create shape')
    const id = editor.createShape('RECTANGLE', 50, 50, 0, 0)
    editor.graph.updateNode(id, { x: 50, y: 50, width: 120, height: 80 })
    editor.commitResize(id, { x: 50, y: 50, width: 0, height: 0 })
    editor.undo.commitBatch()

    // Move it
    editor.select([id])
    editor.graph.updateNode(id, { x: 200, y: 200 })
    editor.commitMove(new Map([[id, { x: 50, y: 50 }]]))

    // Undo move
    editor.undo.undo()
    expect(getNodeOrThrow(editor.graph, id).x).toBe(50)

    // Undo create (single step)
    editor.undo.undo()
    expect(editor.graph.getNode(id)).toBeUndefined()

    // Redo create (single step, full dimensions)
    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, id).width).toBe(120)

    // Redo move
    editor.undo.redo()
    expect(getNodeOrThrow(editor.graph, id).x).toBe(200)
  })
})
