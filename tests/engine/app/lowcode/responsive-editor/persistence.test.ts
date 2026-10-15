import { beforeAll, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec, parseFigFile } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  responsiveClearBreakpoint,
  responsiveSetField
} from '@/app/lowcode/responsive-editor/model'
import { responsiveNodeEditable } from '@/app/lowcode/responsive-editor/use'

beforeAll(initCodec)

test('editing, restoring and clearing a branch preserve base geometry, undo and fig metadata', async () => {
  const graph = new SceneGraph()
  const node = graph.createNode('FRAME', graph.getPages()[0].id, {
    name: 'Responsive editing persistence',
    x: 24,
    y: 32,
    width: 1200,
    height: 800,
    responsiveOverrides: {
      sm: { width: 640 },
      md: {
        maxWidth: 900,
        gridTemplateColumns: [
          { sizing: 'FIXED', value: 180 },
          { sizing: 'FR', value: 2 }
        ]
      }
    }
  })
  const editor = createEditor({ graph, skipInitialGraphSetup: true })
  try {
    const previous = structuredClone(node.responsiveOverrides)
    const changed = responsiveSetField(node.responsiveOverrides, 'md', 'maxWidth', null)
    editor.updateNodeWithUndo(node.id, { responsiveOverrides: changed }, 'Clear responsive limit')
    expect(node.responsiveOverrides).toEqual(changed)
    editor.undo.undo()
    expect(node.responsiveOverrides).toEqual(previous)
    editor.undo.redo()
    expect(node.responsiveOverrides?.md?.maxWidth).toBeNull()
    const restored = responsiveSetField(node.responsiveOverrides, 'md', 'maxWidth', undefined)
    editor.updateNodeWithUndo(
      node.id,
      { responsiveOverrides: restored },
      'Restore responsive field'
    )
    expect(node.responsiveOverrides?.md).not.toHaveProperty('maxWidth')
    expect(node.responsiveOverrides?.md?.gridTemplateColumns).toEqual(
      previous?.md?.gridTemplateColumns
    )
    editor.updateNodeWithUndo(
      node.id,
      { responsiveOverrides: responsiveClearBreakpoint(node.responsiveOverrides, 'md') },
      'Clear responsive branch'
    )
    expect(node.responsiveOverrides).toEqual({ sm: { width: 640 } })
    editor.undo.undo()
    expect(node.responsiveOverrides).toEqual(restored)
    expect(node).toMatchObject({ x: 24, y: 32, width: 1200, height: 800 })
    const reopened = await parseFigFile((await exportFigFile(graph)).slice().buffer)
    const frame = [...reopened.getAllNodes()].find((current) => current.name === node.name)
    expect(frame?.responsiveOverrides).toEqual(restored)
    expect(frame).toMatchObject({ x: 24, y: 32, width: 1200, height: 800 })
  } finally {
    editor.dispose()
  }
})

test('responsive editing rejects a protected node or ancestor without granting authority through selection', () => {
  const graph = new SceneGraph()
  const parent = graph.createNode('FRAME', graph.getPages()[0].id)
  const child = graph.createNode('RECTANGLE', parent.id)
  expect(responsiveNodeEditable(graph, child)).toBe(true)
  for (const protection of ['locked', 'internalOnly', 'libraryReadonly'] as const) {
    graph.updateNode(parent.id, { [protection]: true })
    expect(responsiveNodeEditable(graph, child)).toBe(false)
    graph.updateNode(parent.id, { [protection]: false })
    graph.updateNode(child.id, { [protection]: true })
    expect(responsiveNodeEditable(graph, child)).toBe(false)
    graph.updateNode(child.id, { [protection]: false })
  }
  const source = { ...parent.librarySource, readOnly: true } as NonNullable<
    typeof parent.librarySource
  >
  graph.updateNode(parent.id, { librarySource: source })
  expect(responsiveNodeEditable(graph, child)).toBe(false)
  graph.updateNode(parent.id, { librarySource: null })
  graph.updateNode(child.id, { librarySource: source })
  expect(responsiveNodeEditable(graph, child)).toBe(false)
})
