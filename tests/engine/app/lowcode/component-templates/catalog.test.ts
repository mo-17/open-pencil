import { describe, expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { getComponentTemplates } from '@/app/lowcode/component-templates'
import { createComponentTemplate } from '@/app/lowcode/component-templates/build'

import { componentTemplateFixture } from '#tests/helpers/compiler/components/templates/fixture'

describe('built-in component template catalogue', () => {
  test('offers stable bilingual basic and composition entries without changing an editor', () => {
    const editor = createEditor()
    const before = editor.snapshotDocument()
    const english = getComponentTemplates('en')
    const chinese = getComponentTemplates('zh-CN')
    expect(english.filter((entry) => entry.kind === 'basic')).toHaveLength(54)
    expect(english.filter((entry) => entry.kind === 'combination')).toHaveLength(12)
    expect(new Set(english.map((entry) => entry.id)).size).toBe(english.length)
    expect(chinese.map((entry) => entry.id)).toEqual(english.map((entry) => entry.id))
    for (let index = 0; index < english.length; index++) {
      expect(english[index].name.trim().length).toBeGreaterThan(0)
      expect(chinese[index].name).not.toBe(english[index].name)
      expect(english[index].targets).toEqual(['react', 'vue'])
      expect(english[index].description.trim().length).toBeGreaterThan(0)
      expect(chinese[index].description.trim().length).toBeGreaterThan(0)
    }
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
    editor.dispose()
  })

  test.each(getComponentTemplates('en'))(
    '$id inserts independent editable instances while preserving existing content',
    ({ id }) => {
      const { editor, graph, pageId } = componentTemplateFixture([])
      const original = graph.createNode('TEXT', pageId, { name: 'Existing note', text: 'Keep me' })
      graph.updateNode(graph.rootId, {
        lowcodeDocumentState: [
          { id: 'existing-state', name: 'existing', type: 'string', defaultValue: 'keep' }
        ]
      })
      const previousNode = structuredClone(original)
      const previousState = structuredClone(graph.getNode(graph.rootId)?.lowcodeDocumentState)
      const first = createComponentTemplate(editor, id, 'en', { parentId: pageId })
      const second = createComponentTemplate(editor, id, 'en', { parentId: pageId })
      expect(first.rootId).not.toBe(second.rootId)
      expect(first.nodeIds.length).toBeGreaterThan(0)
      expect(new Set([...first.nodeIds, ...second.nodeIds]).size).toBe(
        first.nodeIds.length + second.nodeIds.length
      )
      expect(new Set([...first.stateNames, ...second.stateNames]).size).toBe(
        first.stateNames.length + second.stateNames.length
      )
      expect(graph.getNode(original.id)).toEqual(previousNode)
      expect(graph.getNode(graph.rootId)?.lowcodeDocumentState?.slice(0, 1)).toEqual(previousState)
      expect(graph.getNode(first.rootId)?.childIds.length).toBeGreaterThan(0)
      editor.undo.undo()
      expect(graph.getNode(second.rootId)).toBeUndefined()
      expect(graph.getNode(first.rootId)).toBeDefined()
      const remainingStateNames = [...graph.getAllNodes()].flatMap((node) =>
        [...(node.state ?? []), ...(node.lowcodeDocumentState ?? [])].map((state) => state.name)
      )
      for (const stateName of second.stateNames)
        expect(remainingStateNames).not.toContain(stateName)
      editor.undo.redo()
      expect(graph.getNode(second.rootId)).toBeDefined()
      expect(graph.getNode(original.id)).toEqual(previousNode)
      editor.dispose()
    }
  )

  test('a failed build removes partial nodes and state without discarding earlier history', () => {
    const { editor, graph, pageId } = componentTemplateFixture([])
    const existing = createComponentTemplate(editor, 'input', 'en', { parentId: pageId })
    const before = editor.snapshotDocument()
    const createShape = editor.createShape.bind(editor)
    let calls = 0
    const failure = spyOn(editor, 'createShape').mockImplementation((...args) => {
      if (++calls === 3) throw new Error('Interrupted template creation')
      return createShape(...args)
    })
    try {
      expect(() =>
        createComponentTemplate(editor, 'validated-form', 'en', { parentId: pageId })
      ).toThrow('Interrupted template creation')
      expect(editor.documentSnapshotChanged(before)).toBe(false)
      expect(editor.undo.isBatching).toBe(false)
      editor.undo.undo()
      expect(graph.getNode(existing.rootId)).toBeUndefined()
      expect(editor.undo.canUndo).toBe(false)
    } finally {
      failure.mockRestore()
      editor.dispose()
    }
  })

  test('rejects a vanished parent before creating nodes or state', () => {
    const { editor } = componentTemplateFixture([])
    const before = editor.snapshotDocument()
    expect(() =>
      createComponentTemplate(editor, 'input', 'en', { parentId: 'vanished-parent' })
    ).toThrow()
    expect(editor.documentSnapshotChanged(before)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
    editor.dispose()
  })
})
