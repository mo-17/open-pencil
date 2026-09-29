import { afterEach, describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { createModalModuleFrameOverrides, resolveModalModule } from '@open-pencil/core/plugins'

import { createModalContent, modalContentChild } from '@/app/lowcode/modal-content'

const editors: ReturnType<typeof createEditor>[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
})
function fixture() {
  const editor = createEditor()
  editors.push(editor)
  const id = editor.createShape(
    'FRAME',
    20,
    30,
    320,
    52,
    undefined,
    'Dialog',
    createModalModuleFrameOverrides({ content: 'Editable body' })
  )
  editor.select([id])
  const node = editor.graph.getNode(id)
  if (!node) throw new Error('Missing modal')
  editor.undo.clear()
  return { editor, node }
}

describe('custom modal content', () => {
  test('creates editable content and its mapping in one undoable operation', () => {
    const { editor, node } = fixture()
    const original = structuredClone(node.interactiveProps)
    const id = createModalContent(editor, node.id, '弹窗内容')
    expect(id).toBeTruthy()
    const content = modalContentChild(editor.graph, node)
    expect(content?.id).toBe(id)
    expect(content?.type).toBe('FRAME')
    expect(content?.visible).toBe(true)
    expect(editor.graph.getChildren(id ?? '')[0]?.text).toBe('Editable body')
    const children = structuredClone(editor.graph.getChildren(id ?? ''))
    editor.undo.undo()
    expect(editor.graph.getNode(id ?? '')).toBeUndefined()
    expect(node.interactiveProps).toEqual(original)
    editor.undo.redo()
    expect(modalContentChild(editor.graph, node)?.id).toBe(id)
    expect(editor.graph.getChildren(id ?? '')).toEqual(children)
  })

  test('preserves previous content while creating independently named alternatives', () => {
    const { editor, node } = fixture()
    const first = createModalContent(editor, node.id, 'Content')
    const previous = structuredClone(editor.graph.getNode(first ?? ''))
    const second = createModalContent(editor, node.id, 'Content')
    expect(second).not.toBe(first)
    expect(editor.graph.getNode(first ?? '')).toEqual(previous)
    expect(editor.graph.getNode(second ?? '')?.name).toBe('Content 2')
    expect(modalContentChild(editor.graph, node)?.id).toBe(second)
    editor.undo.undo()
    expect(modalContentChild(editor.graph, node)?.id).toBe(first)
  })

  test.each(['locked', 'internalOnly'] as const)(
    'rejects %s ancestry and stale selection',
    (field) => {
      const { editor, node } = fixture()
      editor.graph.updateNode(node.id, { [field]: true })
      expect(createModalContent(editor, node.id, 'Content')).toBeNull()
      editor.graph.updateNode(node.id, { [field]: false })
      editor.clearSelection()
      expect(createModalContent(editor, node.id, 'Content')).toBeNull()
      expect(node.childIds).toHaveLength(0)
    }
  )

  test('rejects hidden ancestry, multiple selections and a stale page target', () => {
    const { editor, node } = fixture()
    editor.graph.updateNode(node.id, { visible: false })
    expect(createModalContent(editor, node.id, 'Content')).toBeNull()
    editor.graph.updateNode(node.id, { visible: true })
    const other = editor.createShape('FRAME', 0, 0, 100, 100)
    editor.select([node.id, other])
    expect(createModalContent(editor, node.id, 'Content')).toBeNull()
    editor.select([node.id])
    const page = editor.graph.addPage('Another page')
    editor.graph.reparentNode(node.id, page.id)
    expect(createModalContent(editor, node.id, 'Content')).toBeNull()
    expect(node.childIds).toHaveLength(0)
  })

  test('ambiguous or hidden content never becomes an editing target', () => {
    const { editor, node } = fixture()
    const id = createModalContent(editor, node.id, 'Content')
    if (!id) throw new Error('Missing content')
    editor.graph.updateNode(id, { visible: false })
    expect(modalContentChild(editor.graph, node)).toBeUndefined()
    editor.graph.updateNode(id, { visible: true })
    editor.createShape('FRAME', 0, 0, 10, 10, node.id, 'Content')
    expect(modalContentChild(editor.graph, node)).toBeUndefined()
    expect(resolveModalModule(node.interactiveProps?.module)?.ok).toBe(true)
  })
})
