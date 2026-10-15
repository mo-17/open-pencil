import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createSceneGeometry } from '@open-pencil/core/geometry'
import { createModalModuleInstance } from '@open-pencil/core/plugins'
import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import { handleMoveMove, handleMoveUp } from '#vue/shared/input/move'
import { createSelectionMoveDrag } from '#vue/shared/input/select/move'

function fixture(hostTransform: Partial<SceneNode>, multipleParents: boolean) {
  const editor = createEditor()
  const host = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    x: 300,
    y: 200,
    width: 320,
    height: 52,
    ...hostTransform,
    interactiveProps: { module: createModalModuleInstance({ contentChildName: 'Body' }) }
  })
  const root = editor.graph.createNode('FRAME', host.id, {
    name: 'Body',
    width: 600,
    height: 500,
    x: 10,
    y: 20
  })
  const first = editor.graph.createNode('RECTANGLE', root.id, {
    x: 50,
    y: 60,
    width: 30,
    height: 40
  })
  const nodes = [first]
  if (multipleParents) {
    const nested = editor.graph.createNode('FRAME', root.id, {
      x: 270,
      y: 220,
      width: 200,
      height: 180,
      rotation: -27,
      flipY: true
    })
    nodes.push(
      editor.graph.createNode('RECTANGLE', nested.id, {
        x: 70,
        y: 60,
        width: 30,
        height: 40
      })
    )
  }
  editor.enterContentEdit(root.id)
  editor.select(nodes.map((node) => node.id))
  editor.undo.clear()
  return { editor, nodes }
}

function expectWorldDelta(actual: Vector, original: Vector, delta: Vector) {
  expect(actual.x - original.x).toBeCloseTo(delta.x, 5)
  expect(actual.y - original.y).toBeCloseTo(delta.y, 5)
}

describe('content view world-space dragging', () => {
  test('pixel snapping stays in world coordinates before converting the mirrored parent displacement', () => {
    const { editor, nodes } = fixture({ rotation: 33, flipY: true }, false)
    try {
      editor.state.snappingPreferences = { geometry: true, objects: false, pixelGrid: true }
      const geometry = createSceneGeometry(editor.graph)
      const node = nodes[0]
      const before = geometry.bounds(node)
      const origin = geometry.toWorld(node, { x: 0, y: 0 })
      const drag = createSelectionMoveDrag(origin.x, origin.y, 0, 0, editor, false)
      if (drag.type !== 'move') throw new Error('Expected movement')
      handleMoveMove(drag, origin.x + 42.35, origin.y + 21.65, 42, 22, editor)
      const preview = geometry.bounds(node)
      expect(preview.x).toBeCloseTo(Math.round(before.x + 42.35), 5)
      expect(preview.y).toBeCloseTo(Math.round(before.y + 21.65), 5)
      handleMoveUp(drag, editor)
      expect(geometry.bounds(node).x).toBeCloseTo(preview.x, 5)
      expect(geometry.bounds(node).y).toBeCloseTo(preview.y, 5)
    } finally {
      editor.dispose()
    }
  })

  test.each([{ rotation: 90 }, { rotation: 31, flipX: true }, { rotation: -48, flipY: true }])(
    'preview, commit and undo follow the pointer through host %j',
    (transform) => {
      const { editor, nodes } = fixture(transform, false)
      try {
        const geometry = createSceneGeometry(editor.graph)
        const node = nodes[0]
        const original = geometry.toWorld(node, { x: 0, y: 0 })
        const delta = { x: 40.25, y: 17.75 }
        const drag = createSelectionMoveDrag(original.x, original.y, 0, 0, editor, false)
        if (drag.type !== 'move') throw new Error('Expected movement')
        handleMoveMove(drag, original.x + delta.x, original.y + delta.y, 40, 18, editor, {
          ctrlKey: true
        })
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), original, delta)
        handleMoveUp(drag, editor)
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), original, delta)
        editor.undo.undo()
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), original, { x: 0, y: 0 })
        editor.undo.redo()
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), original, delta)
      } finally {
        editor.dispose()
      }
    }
  )

  test('different transformed parents receive the same world displacement', () => {
    const { editor, nodes } = fixture({ rotation: 38, flipX: true }, true)
    try {
      const geometry = createSceneGeometry(editor.graph)
      const originals = nodes.map((node) => geometry.toWorld(node, { x: 0, y: 0 }))
      const start = originals[0]
      const delta = { x: -23.5, y: 31.25 }
      const drag = createSelectionMoveDrag(start.x, start.y, 0, 0, editor, false)
      if (drag.type !== 'move') throw new Error('Expected movement')
      handleMoveMove(drag, start.x + delta.x, start.y + delta.y, -24, 31, editor, { ctrlKey: true })
      for (const [index, node] of nodes.entries())
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), originals[index], delta)
      handleMoveUp(drag, editor)
      for (const [index, node] of nodes.entries())
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), originals[index], delta)
      editor.undo.undo()
      for (const [index, node] of nodes.entries())
        expectWorldDelta(geometry.toWorld(node, { x: 0, y: 0 }), originals[index], { x: 0, y: 0 })
    } finally {
      editor.dispose()
    }
  })
})
