import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createComponentTemplate } from '@/app/lowcode/component-templates/build'

describe('component template insertion target boundaries', () => {
  test.each(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'] as const)(
    'rejects a frame beneath %s without sharing template state between instances',
    (type) => {
      const editor = createEditor()
      try {
        const owner = editor.graph.createNode(type, editor.state.currentPageId)
        const frame = editor.graph.createNode('FRAME', owner.id)
        const before = editor.snapshotDocument()
        expect(() =>
          createComponentTemplate(editor, 'search-toolbar', 'en', { parentId: frame.id })
        ).toThrow('invalid-target')
        expect(editor.documentSnapshotChanged(before)).toBe(false)
        expect(editor.undo.canUndo).toBe(false)
      } finally {
        editor.dispose()
      }
    }
  )

  test.each(['validated-form', 'dialog-form', 'tabs-details'])(
    'rejects %s below an existing form before creating nested form markup',
    (id) => {
      const editor = createEditor()
      try {
        const form = editor.graph.createNode('FORM', editor.state.currentPageId)
        const frame = editor.graph.createNode('FRAME', form.id)
        const before = editor.snapshotDocument()
        for (const parentId of [form.id, frame.id]) {
          expect(() => createComponentTemplate(editor, id, 'en', { parentId })).toThrow(
            'invalid-target'
          )
          expect(editor.documentSnapshotChanged(before)).toBe(false)
          expect(editor.undo.canUndo).toBe(false)
        }
      } finally {
        editor.dispose()
      }
    }
  )

  const protectedTargets: readonly [string, Partial<SceneNode>][] = [
    ['locked', { locked: true }],
    ['internal cache', { internalOnly: true }],
    [
      'read-only library',
      {
        librarySource: {
          identity: { libraryId: 'reviewed-library', assetKey: 'master', revisionId: '1' },
          sourceNodeId: 'library-master',
          readOnly: true
        }
      }
    ]
  ]
  test.each(protectedTargets)(
    'rejects a child of a %s ancestor without mutation',
    (_name, props) => {
      const editor = createEditor()
      try {
        const ancestor = editor.graph.createNode('FRAME', editor.state.currentPageId, props)
        const frame = editor.graph.createNode('FRAME', ancestor.id)
        const before = editor.snapshotDocument()
        expect(() =>
          createComponentTemplate(editor, 'input', 'en', { parentId: frame.id })
        ).toThrow('invalid-target')
        expect(editor.documentSnapshotChanged(before)).toBe(false)
        expect(editor.undo.canUndo).toBe(false)
      } finally {
        editor.dispose()
      }
    }
  )

  test.each(['FRAME', 'FORM'] as const)(
    'keeps non-form recipes editable inside an ordinary %s',
    (type) => {
      const editor = createEditor()
      try {
        const parent = editor.graph.createNode(type, editor.state.currentPageId)
        const root = createComponentTemplate(editor, 'input', 'en', { parentId: parent.id })
        expect(editor.graph.getNode(root.rootId)?.parentId).toBe(parent.id)
        expect(root.stateNames).toHaveLength(1)
        editor.undo.undo()
        expect(editor.graph.getNode(root.rootId)).toBeUndefined()
        expect(editor.graph.getNode(parent.id)).toBeDefined()
      } finally {
        editor.dispose()
      }
    }
  )
})
