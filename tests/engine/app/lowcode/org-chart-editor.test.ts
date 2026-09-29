import { expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createOrgChartModuleFrameOverrides,
  createOrgChartModuleInstance,
  resolveOrgChartModule
} from '@open-pencil/core/plugins'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import type { ModuleScalarCommit } from '@/app/lowcode/module-editor/scalar'
import {
  commitOrgChartItems,
  editOrgChartDraft,
  orgChartDraft,
  orgChartDraftConfig,
  orgChartDraftValid,
  orgChartParentChoices
} from '@/app/lowcode/org-chart-editor'
import { useOrgChartDraft } from '@/app/lowcode/org-chart-editor/use'

const items = [
  { id: 'team', parentId: '', label: 'Team', description: 'Local text' },
  { id: 'design', parentId: 'team', label: 'Design', description: '' },
  { id: 'engineering', parentId: 'team', label: 'Engineering', description: '' },
  { id: 'frontend', parentId: 'engineering', label: 'Frontend', description: '' }
]
function fixture() {
  const editor = createEditor()
  const owner = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createOrgChartModuleFrameOverrides({ items, initialCollapsedIds: ['team', 'engineering'] })
  )
  const module = resolveOrgChartModule(owner.interactiveProps?.module)
  if (!module?.ok) throw new Error('Missing chart')
  editor.select([owner.id])
  editor.undo.clear()
  return { editor, owner, config: module.config }
}

test('org chart promotes children, removes obsolete folded IDs, preserves stable IDs and orders siblings', () => {
  const { editor, config } = fixture()
  try {
    const original = orgChartDraft(config)
    const promoted = editOrgChartDraft(original, { kind: 'remove', id: 'engineering' })
    expect(promoted.items.find((item) => item.id === 'frontend')?.parentId).toBe('team')
    expect(promoted.initialCollapsedIds).toEqual(['team'])
    expect(orgChartDraftValid(config, promoted)).toBe(true)
    const moved = editOrgChartDraft(promoted, { kind: 'move', id: 'frontend', offset: -1 })
    expect(moved.items.map((item) => item.id)).toEqual(['team', 'frontend', 'design'])
    const newRoot = editOrgChartDraft(moved, { kind: 'parent', id: 'frontend', parentId: '' })
    expect(newRoot.items.find((item) => item.id === 'frontend')?.parentId).toBe('')
    expect(original.items).toEqual(items)
    expect(orgChartParentChoices(original, 'team', 'Root')).toEqual([
      { value: 'root', label: 'Root' }
    ])
    expect(
      editOrgChartDraft(original, { kind: 'parent', id: 'team', parentId: 'frontend' })
    ).toEqual(original)
  } finally {
    editor.dispose()
  }
})

test('org chart applies a whole valid hierarchy once and undo restores items and folded IDs', () => {
  const { editor, owner, config } = fixture()
  try {
    const before = structuredClone(owner.interactiveProps)
    const draft = editOrgChartDraft(orgChartDraft(config), { kind: 'remove', id: 'engineering' })
    const request: ModuleScalarCommit = {
      owner,
      previousModule: before?.module,
      value: { kind: 'value', value: orgChartDraftConfig(config, draft) }
    }
    expect(commitOrgChartItems(editor, request)).toBe(true)
    expect(owner.interactiveProps?.module?.config.initialCollapsedIds).toEqual(['team'])
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
    editor.select([])
    expect(commitOrgChartItems(editor, request)).toBe(false)
    editor.select([owner.id])
    expect(commitOrgChartItems(editor, { ...request, owner: structuredClone(owner) })).toBe(false)
    expect(
      commitOrgChartItems(editor, {
        ...request,
        value: { kind: 'value', value: { ...config, items: [] } }
      })
    ).toBe(false)
  } finally {
    editor.dispose()
  }
})

for (const boundary of ['owner', 'config', 'retained', 'dispose'] as const)
  test(`org chart rejects late input/apply across ${boundary}, even after a fresh field takes focus`, () => {
    const f = fixture(),
      scope = effectScope(),
      target = shallowRef(f.owner),
      saved = shallowRef<JSONObject>(f.config),
      active = ref(true),
      requests: ModuleScalarCommit[] = []
    const draft = scope.run(() =>
      useOrgChartDraft(
        () => target.value,
        () => saved.value,
        (request) => requests.push(request),
        active
      )
    )
    if (!draft) throw new Error('Missing chart draft')
    try {
      const old = draft.generation.value
      draft.begin('team', 'label', old)
      draft.input('team', 'label', 'Old draft', old)
      if (boundary === 'owner') target.value = structuredClone(f.owner)
      if (boundary === 'config') saved.value = { ...f.config, label: 'New label' }
      if (boundary === 'retained') {
        active.value = false
        active.value = true
      }
      if (boundary === 'dispose') scope.stop()
      const current = draft.generation.value
      draft.begin('team', 'label', current)
      draft.input('team', 'label', 'Fresh', current)
      draft.input('team', 'label', 'Late draft', old)
      draft.apply(old)
      expect(requests).toEqual([])
      if (boundary !== 'dispose') {
        expect(draft.rows.value[0].label).toBe('Fresh')
        draft.apply(current)
        expect(requests).toHaveLength(1)
      }
    } finally {
      scope.stop()
      f.editor.dispose()
    }
  })

test('org chart invalid name stays in the draft and external module change cannot inherit draft authority', () => {
  const f = fixture(),
    scope = effectScope(),
    requests: ModuleScalarCommit[] = []
  const draft = scope.run(() =>
    useOrgChartDraft(
      () => f.owner,
      () => f.config,
      (request) => requests.push(request)
    )
  )
  if (!draft) throw new Error('Missing chart draft')
  try {
    const version = draft.generation.value
    draft.begin('team', 'label', version)
    draft.input('team', 'label', '', version)
    draft.apply(version)
    expect(draft.invalid.value).toBe(true)
    expect(draft.rows.value[0].label).toBe('')
    expect(requests).toEqual([])
    draft.input('team', 'label', 'Draft', version)
    f.owner.interactiveProps.module = createOrgChartModuleInstance({ items, label: 'External' })
    draft.apply(version)
    expect(requests).toEqual([])
  } finally {
    scope.stop()
    f.editor.dispose()
  }
})
