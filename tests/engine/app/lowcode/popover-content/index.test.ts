import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createPopoverModuleFrameOverrides, resolvePopoverModule } from '@open-pencil/core/plugins'

import { createModalContent, modalContentChild } from '@/app/lowcode/modal-content'

test('Popover content reuses isolated editing, stays outside trigger hit testing and creates one reversible mapping', () => {
  const editor = createEditor({ getViewportSize: () => ({ width: 800, height: 600 }) })
  try {
    const id = editor.createShape(
      'FRAME',
      20,
      30,
      200,
      44,
      undefined,
      'Popover',
      createPopoverModuleFrameOverrides({ panelWidth: 240, content: '可编辑说明' })
    )
    editor.select([id])
    const node = editor.graph.getNode(id)
    if (!node) throw new Error('Missing popover')
    editor.undo.clear()
    const original = structuredClone(node.interactiveProps)
    const rootId = createModalContent(editor, id, '浮层内容')
    if (!rootId) throw new Error('Missing editable content')
    const body = modalContentChild(editor.graph, node)
    expect(body).toMatchObject({ id: rootId, width: 208, type: 'FRAME', visible: true })
    const label = editor.graph.getChildren(rootId)[0]
    expect(label).toMatchObject({ text: '可编辑说明', width: 176 })
    expect(resolvePopoverModule(node.interactiveProps?.module)).toMatchObject({
      ok: true,
      config: { contentChildName: '浮层内容' }
    })
    expect(editor.enterContentEdit(rootId)).toBe(true)
    expect(editor.getContentEditInsertionParent()).toBe(rootId)
    editor.exitContentEdit()
    expect(node).toMatchObject({ width: 200, height: 44 })
    editor.undo.undo()
    expect(editor.graph.getNode(rootId)).toBeUndefined()
    expect(node.interactiveProps).toEqual(original)
    editor.undo.redo()
    expect(modalContentChild(editor.graph, node)?.id).toBe(rootId)
    editor.clearSelection()
    expect(createModalContent(editor, id, 'Late content')).toBeNull()
    editor.select([id])
    editor.graph.updateNode(id, { locked: true })
    expect(createModalContent(editor, id, 'Locked content')).toBeNull()
  } finally {
    editor.dispose()
  }
})

test('Popover ambiguous mapping cannot enter editing and an invalidated mapping exits the old content scope', () => {
  const editor = createEditor()
  try {
    const host = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createPopoverModuleFrameOverrides({ contentChildName: 'Body' })
    )
    const body = editor.graph.createNode('FRAME', host.id, {
      name: 'Body',
      width: 220,
      height: 120
    })
    expect(editor.enterContentEdit(body.id)).toBe(true)
    editor.graph.createNode('FRAME', host.id, { name: 'Body', width: 20, height: 20 })
    expect(editor.state.contentEdit).toBeNull()
    expect(modalContentChild(editor.graph, host)).toBeUndefined()
    expect(editor.enterContentEdit(body.id)).toBe(false)
  } finally {
    editor.dispose()
  }
})
