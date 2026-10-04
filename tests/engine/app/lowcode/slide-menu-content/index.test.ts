import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createSlideMenuModuleFrameOverrides,
  resolveSlideMenuModule
} from '@open-pencil/core/plugins'

import { createModalContent, modalContentChild } from '@/app/lowcode/modal-content'

describe('editable drawer content', () => {
  test('creates an isolated body with authored text and reverses the complete mapping', () => {
    const editor = createEditor({ getViewportSize: () => ({ width: 800, height: 600 }) })
    try {
      const id = editor.createShape('FRAME', 20, 30, 180, 48, undefined, 'Drawer', {
        ...createSlideMenuModuleFrameOverrides({
          panelSize: 360,
          description: 'Editable explanation'
        })
      })
      editor.select([id])
      const node = editor.graph.getNode(id)
      if (!node) throw new Error('Missing drawer')
      editor.undo.clear()
      const original = structuredClone(node.interactiveProps)
      const bodyId = createModalContent(editor, id, 'Drawer content')
      if (!bodyId) throw new Error('Missing drawer body')
      expect(modalContentChild(editor.graph, node)).toMatchObject({ id: bodyId, width: 312 })
      expect(editor.graph.getChildren(bodyId)[0]).toMatchObject({
        text: 'Editable explanation',
        width: 280
      })
      expect(resolveSlideMenuModule(node.interactiveProps?.module)).toMatchObject({
        ok: true,
        config: { contentChildName: 'Drawer content' }
      })
      expect(editor.enterContentEdit(bodyId)).toBe(true)
      expect(editor.getContentEditInsertionParent()).toBe(bodyId)
      editor.exitContentEdit()
      expect(node).toMatchObject({ width: 180, height: 48 })
      editor.undo.undo()
      expect(editor.graph.getNode(bodyId)).toBeUndefined()
      expect(node.interactiveProps).toEqual(original)
      editor.undo.redo()
      expect(modalContentChild(editor.graph, node)?.id).toBe(bodyId)
    } finally {
      editor.dispose()
    }
  })

  test.each(['visible', 'locked', 'internalOnly'] as const)(
    'does not create content through invalid %s ancestry or stale selection',
    (field) => {
      const editor = createEditor()
      try {
        const id = editor.createShape(
          'FRAME',
          0,
          0,
          180,
          48,
          undefined,
          'Drawer',
          createSlideMenuModuleFrameOverrides()
        )
        editor.select([id])
        const before = editor.snapshotDocument()
        editor.graph.updateNode(id, { [field]: field !== 'visible' })
        expect(createModalContent(editor, id, 'Content')).toBeNull()
        editor.graph.updateNode(id, { [field]: field === 'visible' })
        editor.clearSelection()
        expect(createModalContent(editor, id, 'Content')).toBeNull()
        expect(editor.documentSnapshotChanged(before)).toBe(false)
      } finally {
        editor.dispose()
      }
    }
  )
  test.each(['left', 'right', 'top', 'bottom'] as const)(
    '%s content uses a stable authoring width and fills the runtime body',
    (direction) => {
      const editor = createEditor()
      try {
        for (const presentation of ['menu', 'dialog'] as const) {
          const id = editor.createShape(
            'FRAME',
            0,
            0,
            180,
            48,
            undefined,
            'Drawer',
            createSlideMenuModuleFrameOverrides({ direction, presentation, panelSize: 360 })
          )
          editor.select([id])
          const bodyId = createModalContent(editor, id, 'Body')
          const horizontalMenu =
            presentation === 'menu' && (direction === 'top' || direction === 'bottom')
          expect(editor.graph.getNode(bodyId ?? '')).toMatchObject({
            width: horizontalMenu ? 320 : 312,
            counterAxisSizing: 'FILL'
          })
        }
      } finally {
        editor.dispose()
      }
    }
  )
})
