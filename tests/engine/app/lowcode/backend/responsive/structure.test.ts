import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { groupTemplateFormFields } from '@/app/lowcode/backend/responsive/content'
import { createTemplateMobileNavigation } from '@/app/lowcode/backend/responsive/navigation'
import {
  groupTemplateNodes,
  orderTemplateChildren
} from '@/app/lowcode/backend/responsive/structure'

describe('template semantic structure', () => {
  test('grouping preserves desktop geometry, form ancestry, sibling order and complete undo', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const form = editor.createShape('FORM', 80, 90, 500, 300, page.id, 'Edit', {
      layoutMode: 'NONE'
    })
    const label = editor.createShape('TEXT', 20, 10, 280, 32, form, 'Title')
    const toggle = editor.createShape('BUTTON', 320, 10, 160, 28, form, 'Set empty')
    const input = editor.createShape('INPUT', 20, 44, 460, 42, form, 'Title')
    const save = editor.createShape('BUTTON', 20, 120, 160, 44, form, 'Save')
    editor.updateNodeWithUndo(label, { text: 'Authored title' }, 'Edit field label')
    const before = editor.graph.getChildren(form).map((node) => node.id)
    const beforeGraph = canonicalManifestJSON([...editor.graph.nodes.values()])
    const positions = [label, toggle, input, save].map((id) => editor.graph.getAbsolutePosition(id))
    editor.undo.runBatch('Group fields', () => {
      groupTemplateFormFields(editor, form)
      editor.updateNodeWithUndo(
        input,
        { responsiveOverrides: { compact: { minWidth: 0, fontSize: 16 } } },
        'Adapt field'
      )
    })
    const afterGraph = canonicalManifestJSON([...editor.graph.nodes.values()])
    const field = editor.graph.getNode(editor.graph.getNode(input)?.parentId ?? '')
    expect(field?.type).toBe('FRAME')
    expect(field?.parentId).toBe(form)
    expect(field?.childIds).toEqual([label, toggle, input])
    expect(editor.graph.getNode(save)?.parentId).toBe(form)
    expect([label, toggle, input, save].map((id) => editor.graph.getAbsolutePosition(id))).toEqual(
      positions
    )
    editor.undo.undo()
    expect(editor.graph.getChildren(form).map((node) => node.id)).toEqual(before)
    expect(editor.graph.getNode(field?.id ?? '')).toBeUndefined()
    expect(canonicalManifestJSON([...editor.graph.nodes.values()])).toBe(beforeGraph)
    editor.undo.redo()
    expect(editor.graph.getNode(input)?.parentId).toBe(field?.id)
    expect([label, toggle, input, save].map((id) => editor.graph.getAbsolutePosition(id))).toEqual(
      positions
    )
    expect(canonicalManifestJSON([...editor.graph.nodes.values()])).toBe(afterGraph)
    editor.undo.undo()
    expect(canonicalManifestJSON([...editor.graph.nodes.values()])).toBe(beforeGraph)
    editor.undo.redo()
    expect(canonicalManifestJSON([...editor.graph.nodes.values()])).toBe(afterGraph)
  })

  test('reordering is undoable and rejects incomplete or cross-form groups before writing', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const first = editor.createShape('FRAME', 0, 0, 200, 200, page.id, 'First')
    const second = editor.createShape('FRAME', 220, 0, 200, 200, page.id, 'Second')
    const control = editor.createShape('INPUT', 0, 0, 160, 44, first, 'Field')
    const before = editor.graph.getChildren(page.id).map((node) => node.id)
    expect(() => groupTemplateNodes(editor, first, [control, second], 'Invalid')).toThrow(
      'cannot cross'
    )
    expect(() => orderTemplateChildren(editor, page.id, [second])).toThrow('every existing child')
    orderTemplateChildren(editor, page.id, [second, first])
    expect(editor.graph.getChildren(page.id).map((node) => node.id)).toEqual([second, first])
    editor.undo.undo()
    expect(editor.graph.getChildren(page.id).map((node) => node.id)).toEqual(before)
  })

  test('mobile navigation uses the current input value and retains cleanup before route changes', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const frame = editor.createShape('FRAME', 0, 0, 1000, 600, page.id, 'Page')
    const actions = [
      { id: 'clear', kind: 'setVariable' as const, targetName: 'selection', valueExpr: '""' },
      { id: 'route', kind: 'navigate' as const, to: '/orders' }
    ]
    const { nodeId, state } = createTemplateMobileNavigation(
      editor,
      frame,
      page.id,
      [{ label: 'Orders', path: '/orders', actions }],
      '/shop',
      'Page navigation'
    )
    const select = editor.graph.getNode(nodeId)
    expect(select?.visible).toBe(false)
    expect(select?.responsiveOverrides?.compact?.visible).toBe(true)
    expect(select?.bindings?.value).toEqual({ kind: 'ref', stateId: state.id })
    expect(select?.interactiveProps?.options).toEqual([page.name, 'Orders'])
    const change = select?.events?.onChange?.[0]
    expect(change?.kind).toBe('condition')
    if (change?.kind !== 'condition') throw new Error('Missing navigation condition')
    expect(change.condExpr).toBe('$value === "Orders"')
    expect(change.consequent).toEqual(actions)
    expect(change.consequent).not.toBe(actions)
  })

  test('same-title routes remain independently selectable with an unambiguous current label', () => {
    const editor = createEditor()
    const page = editor.graph.getPages()[0]
    const frame = editor.createShape('FRAME', 0, 0, 1000, 600, page.id, 'Page')
    const entries = ['/notes', '/notes-2'].map((path) => ({
      label: 'Notes',
      path,
      actions: [{ id: path, kind: 'navigate' as const, to: path }]
    }))
    const { nodeId, state } = createTemplateMobileNavigation(
      editor,
      frame,
      page.id,
      entries,
      '/notes-2'
    )
    const select = editor.graph.getNode(nodeId)
    expect(state.defaultValue).toBe('Notes (/notes-2)')
    expect(select?.interactiveProps?.options).toEqual(['Notes (/notes-2)', 'Notes (/notes)'])
    for (const entry of entries) {
      const action = select?.events?.onChange?.find(
        (item) =>
          item.kind === 'condition' && item.condExpr === `$value === "Notes (${entry.path})"`
      )
      expect(action?.kind).toBe('condition')
      if (action?.kind !== 'condition') throw new Error('Missing route choice')
      expect(action.consequent).toEqual(entry.actions)
    }
  })
})
