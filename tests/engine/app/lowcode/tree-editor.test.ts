import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import { createTreeModuleFrameOverrides, resolveTreeModule } from '@open-pencil/core/plugins'

import {
  commitTreeEditor,
  editTreeEditor,
  treeEditorValue,
  validTreeEditor,
  type TreeEditorCommit
} from '@/app/lowcode/tree-editor'
import { treeParentChoices, treeParentId, treeParentValue } from '@/app/lowcode/tree-editor/parents'
import { useTreeEditorDraft } from '@/app/lowcode/tree-editor/use'
function fixture() {
  const editor = createEditor(),
    owner = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createTreeModuleFrameOverrides({ initialSelectedIds: ['design'] })
    )
  editor.select([owner.id])
  editor.undo.clear()
  const resolved = resolveTreeModule(owner.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing tree')
  return { editor, owner, config: resolved.config, value: treeEditorValue(resolved.config) }
}
test('Tree parent choices never pass empty Select values and preserve root-like real IDs', () => {
  const items = [
    { id: 'root', label: 'Real root ID', parentId: '', disabled: false },
    { id: 'child', label: 'Child', parentId: 'root', disabled: false },
    { id: 'other', label: 'Other', parentId: '', disabled: false }
  ]
  const choices = treeParentChoices(items, 'child', 'Root level')
  expect(choices.map((choice) => choice.value)).toEqual(['root', 'node:root', 'node:other'])
  expect(treeParentId(choices[0].value)).toBe('')
  expect(treeParentId(choices[1].value)).toBe('root')
  expect(treeParentChoices(items, 'root', 'Root level').map((choice) => choice.value)).toEqual([
    'root',
    'node:other'
  ])
  for (const id of ['', 'root', 'node', 'node:root', '__root__'])
    expect(treeParentId(treeParentValue(id))).toBe(id)
  expect(treeParentId('')).toBeUndefined()
  expect(treeParentId('node:')).toBeUndefined()
  expect(
    treeParentChoices([...items, { ...items[0], id: '' }, items[0]], 'child', 'Root level')
  ).toEqual(choices)
})
test('Tree ID rename updates parent links, selection and expansion in one undoable transaction', () => {
  const { editor, owner, config, value } = fixture()
  try {
    const next = editTreeEditor(value, { kind: 'text', index: 0, field: 'id', value: 'renamed' })
    expect(next.items[1].parentId).toBe('renamed')
    expect(next.initialExpandedIds).toEqual(['renamed'])
    expect(validTreeEditor(config, next)).toBe(true)
    const previous = structuredClone(owner.interactiveProps)
    expect(commitTreeEditor(editor, { owner, previousModule: previous?.module, value: next })).toBe(
      true
    )
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(previous)
    expect(editor.undo.canUndo).toBe(false)
    editor.undo.redo()
    expect(resolveTreeModule(owner.interactiveProps?.module)?.ok).toBe(true)
  } finally {
    editor.dispose()
  }
})
test('Tree remove lifts children, disable clears inherited selected values and invalid hierarchy remains a draft', () => {
  const { editor, config, value } = fixture()
  try {
    const removed = editTreeEditor(value, { kind: 'remove', index: 0 })
    expect(removed.items[0].parentId).toBe('')
    expect(removed.initialSelectedIds).toEqual(['design'])
    expect(removed.initialExpandedIds).toEqual([])
    const disabled = editTreeEditor(value, {
      kind: 'toggle',
      index: 0,
      field: 'disabled',
      value: true,
      multiple: false
    })
    expect(disabled.initialSelectedIds).toEqual([])
    expect(
      validTreeEditor(
        config,
        editTreeEditor(value, { kind: 'text', index: 0, field: 'parentId', value: 'design' })
      )
    ).toBe(false)
    expect(
      validTreeEditor(
        config,
        editTreeEditor(value, { kind: 'text', index: 1, field: 'id', value: 'project' })
      )
    ).toBe(false)
  } finally {
    editor.dispose()
  }
})
test('Tree draft rejects stale input/apply after target replacement, config update, retention and disposal', () => {
  const { editor, owner, config } = fixture(),
    target = shallowRef(owner),
    saved = shallowRef(config),
    active = ref(true),
    scope = effectScope(),
    commits: TreeEditorCommit[] = []
  const draft = scope.run(() =>
    useTreeEditorDraft(
      () => target.value,
      () => saved.value,
      (request) => commits.push(request),
      active
    )
  )
  if (!draft) throw new Error('Missing draft')
  try {
    const generation = draft.generation.value
    draft.begin(generation)
    draft.input(0, 'label', 'Uncommitted', generation)
    target.value = structuredClone(owner)
    draft.input(0, 'label', 'Late', generation)
    draft.apply(generation)
    expect(commits).toEqual([])
    expect(draft.draft.value.items[0].label).toBe('Project')
    let current = draft.generation.value
    draft.begin(current)
    draft.input(0, 'label', 'Invalidated', current)
    saved.value = { ...config, label: 'Changed' }
    draft.begin(current)
    draft.input(0, 'label', 'Late again', current)
    draft.apply(current)
    expect(commits).toEqual([])
    current = draft.generation.value
    draft.begin(current)
    draft.input(0, 'label', 'Hidden', current)
    active.value = false
    draft.apply(current)
    expect(commits).toEqual([])
    active.value = true
    current = draft.generation.value
    draft.begin(current)
    draft.input(0, 'label', 'Disposed', current)
    scope.stop()
    draft.apply(current)
    expect(commits).toEqual([])
  } finally {
    scope.stop()
    editor.dispose()
  }
})
