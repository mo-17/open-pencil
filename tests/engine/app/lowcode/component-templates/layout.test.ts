import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneGraph } from '@open-pencil/scene-graph'

import { createComponentTemplate, getComponentTemplates } from '@/app/lowcode/component-templates'

function expectStackGeometry(graph: SceneGraph, rootId: string) {
  const root = graph.getNode(rootId)
  if (!root) throw new Error('Missing template root')
  const children = graph.getChildren(rootId).filter((node) => node.visible)
  expect(children.length).toBeGreaterThan(1)
  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    expect(child.x, child.name + ' left inset').toBeGreaterThanOrEqual(root.paddingLeft)
    expect(child.y, child.name + ' top inset').toBeGreaterThanOrEqual(root.paddingTop)
    expect(child.x + child.width, child.name + ' right edge').toBeLessThanOrEqual(
      root.width - root.paddingRight + 0.01
    )
    expect(child.y + child.height, child.name + ' bottom edge').toBeLessThanOrEqual(
      root.height - root.paddingBottom + 0.01
    )
    if (index > 0)
      expect(child.y, child.name + ' stacking').toBeGreaterThanOrEqual(
        children[index - 1].y + children[index - 1].height
      )
  }
}

test.each([...getComponentTemplates('en')])(
  '$id is laid out on first insertion and after undo/redo without an unrelated state write',
  ({ id }) => {
    const editor = createEditor()
    try {
      const template = createComponentTemplate(editor, id, 'en', {
        parentId: editor.state.currentPageId
      })
      expectStackGeometry(editor.graph, template.rootId)
      editor.undo.undo()
      expect(editor.graph.getNode(template.rootId)).toBeUndefined()
      editor.undo.redo()
      expectStackGeometry(editor.graph, template.rootId)
    } finally {
      editor.dispose()
    }
  }
)

test('insertion into auto layout restores the existing sibling position on undo and replay', () => {
  const editor = createEditor()
  try {
    const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      name: 'Existing layout',
      width: 440,
      height: 1000,
      layoutMode: 'VERTICAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED',
      primaryAxisAlign: 'CENTER',
      counterAxisAlign: 'STRETCH',
      paddingTop: 20,
      paddingRight: 20,
      paddingBottom: 20,
      paddingLeft: 20,
      itemSpacing: 16
    })
    const sibling = editor.graph.createNode('RECTANGLE', parent.id, {
      name: 'Existing sibling',
      width: 400,
      height: 44,
      counterAxisSizing: 'FILL'
    })
    editor.runLayoutForNode(parent.id)
    const before = structuredClone(editor.graph.getNode(sibling.id))
    const template = createComponentTemplate(editor, 'validated-form', 'en', {
      parentId: parent.id
    })
    expectStackGeometry(editor.graph, parent.id)
    expectStackGeometry(editor.graph, template.rootId)
    const insertedPosition = editor.graph.getNode(sibling.id)?.y
    expect(insertedPosition).not.toBe(before?.y)
    editor.undo.undo()
    expect(editor.graph.getNode(template.rootId)).toBeUndefined()
    expect(editor.graph.getNode(sibling.id)).toEqual(before)
    expect(editor.graph.getNode(parent.id)?.childIds).toEqual([sibling.id])
    editor.undo.redo()
    expect(editor.graph.getNode(sibling.id)?.y).toBe(insertedPosition)
    expectStackGeometry(editor.graph, parent.id)
    expectStackGeometry(editor.graph, template.rootId)
  } finally {
    editor.dispose()
  }
})
