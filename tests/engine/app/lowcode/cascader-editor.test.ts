import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import {
  createCascaderModuleFrameOverrides,
  resolveCascaderModule
} from '@open-pencil/core/plugins'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  commitTreeEditor,
  editTreeEditor,
  treeEditorValue,
  validTreeEditor
} from '@/app/lowcode/tree-editor'

function cascader(node: SceneNode) {
  const result = resolveCascaderModule(node.interactiveProps?.module)
  if (!result?.ok) throw new Error('Missing cascader')
  return result
}

test('Cascader reuses hierarchy editing while atomically preserving a valid selected leaf path', () => {
  const editor = createEditor(),
    graph = editor.graph
  try {
    const node = graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createCascaderModuleFrameOverrides({ initialPath: ['asia', 'china', 'xiamen'] })
    )
    editor.select([node.id])
    const initial = cascader(node)
    let draft = treeEditorValue(initial.config)
    expect(draft.initialSelectedIds).toEqual(['xiamen'])
    draft = editTreeEditor(draft, { kind: 'text', index: 1, field: 'id', value: 'cn' })
    expect(validTreeEditor(initial.config, draft)).toBe(true)
    expect(
      commitTreeEditor(editor, {
        owner: node,
        previousModule: structuredClone(node.interactiveProps?.module),
        value: draft
      })
    ).toBe(true)
    let saved = cascader(node)
    expect(saved.config.initialPath).toEqual(['asia', 'cn', 'xiamen'])
    editor.undo.undo()
    expect(node.interactiveProps?.module).toEqual(initial.instance)
    editor.undo.redo()
    saved = cascader(node)
    draft = editTreeEditor(treeEditorValue(saved.config), { kind: 'remove', index: 1 })
    expect(
      commitTreeEditor(editor, {
        owner: node,
        previousModule: structuredClone(node.interactiveProps?.module),
        value: draft
      })
    ).toBe(true)
    saved = cascader(node)
    expect(saved.config.initialPath).toEqual(['asia', 'xiamen'])
    draft = editTreeEditor(treeEditorValue(saved.config), {
      kind: 'toggle',
      index: 0,
      field: 'disabled',
      value: true,
      multiple: false
    })
    expect(
      commitTreeEditor(editor, {
        owner: node,
        previousModule: structuredClone(node.interactiveProps?.module),
        value: draft
      })
    ).toBe(true)
    saved = cascader(node)
    expect(saved.config.initialPath).toEqual([])
  } finally {
    editor.dispose()
  }
})

test('Cascader hierarchy commits reject cycles and stale selection or module snapshots', () => {
  const editor = createEditor(),
    graph = editor.graph
  try {
    const node = graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createCascaderModuleFrameOverrides()
    )
    editor.select([node.id])
    const current = cascader(node)
    const draft = treeEditorValue(current.config)
    const cyclic = editTreeEditor(draft, {
      kind: 'text',
      index: 0,
      field: 'parentId',
      value: 'xiamen'
    })
    expect(validTreeEditor(current.config, cyclic)).toBe(false)
    const request = {
      owner: node,
      previousModule: structuredClone(node.interactiveProps?.module),
      value: draft
    }
    editor.clearSelection()
    expect(commitTreeEditor(editor, request)).toBe(false)
    editor.select([node.id])
    graph.updateNode(node.id, createCascaderModuleFrameOverrides({ label: 'Changed elsewhere' }))
    expect(commitTreeEditor(editor, request)).toBe(false)
  } finally {
    editor.dispose()
  }
})
