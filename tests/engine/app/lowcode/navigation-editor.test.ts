import { afterEach, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  createBreadcrumbModuleFrameOverrides,
  createStepperModuleFrameOverrides,
  resolveBreadcrumbModule,
  resolveStepperModule
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  commitNavigationEditor,
  editNavigationEditor,
  navigationEditorValue,
  validNavigationEditor,
  type NavigationEditorCommit
} from '@/app/lowcode/navigation-editor'
import { useNavigationEditorDraft } from '@/app/lowcode/navigation-editor/use'

const editors: ReturnType<typeof createEditor>[] = []
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture(kind: 'stepper' | 'breadcrumb' = 'stepper') {
  const editor = createEditor()
  editors.push(editor)
  const owner = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    kind === 'stepper'
      ? createStepperModuleFrameOverrides({ currentIndex: 1 })
      : createBreadcrumbModuleFrameOverrides()
  )
  editor.select([owner.id])
  editor.undo.clear()
  const resolved =
    kind === 'stepper'
      ? resolveStepperModule(owner.interactiveProps?.module)
      : resolveBreadcrumbModule(owner.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing navigation module')
  const config = resolved.config
  const value = navigationEditorValue(config)
  const request = (next = value): NavigationEditorCommit => ({
    owner,
    previousModule: structuredClone(owner.interactiveProps?.module),
    value: next
  })
  return { editor, owner, config, value, request }
}

test('moving and removing steps keeps the authored current step attached to its item', () => {
  const { value } = fixture()
  const moved = editNavigationEditor(value, { kind: 'move', index: 1, offset: 1 })
  expect(moved.kind === 'stepper' && moved.currentIndex).toBe(2)
  expect(moved.items[2]).toEqual(value.items[1])
  const removedBefore = editNavigationEditor(moved, { kind: 'remove', index: 0 })
  expect(removedBefore.kind === 'stepper' && removedBefore.currentIndex).toBe(1)
  expect(removedBefore.items[1]).toEqual(value.items[1])
  const removedCurrent = editNavigationEditor(removedBefore, { kind: 'remove', index: 1 })
  expect(removedCurrent.kind === 'stepper' && removedCurrent.currentIndex).toBe(0)
  expect(removedCurrent.items).toHaveLength(1)
  expect(editNavigationEditor(removedCurrent, { kind: 'remove', index: 0 })).toBe(removedCurrent)
})

test('item and dependent index changes form one undoable transaction', () => {
  const { editor, owner, value, request } = fixture()
  const before = structuredClone(owner.interactiveProps)
  const next = editNavigationEditor(value, { kind: 'move', index: 1, offset: -1 })
  expect(commitNavigationEditor(editor, request(next))).toBe(true)
  const saved = resolveStepperModule(owner.interactiveProps?.module)
  expect(saved?.ok && saved.config.currentIndex).toBe(0)
  expect(saved?.ok && saved.config.items[0].title).toBe('Review')
  editor.undo.undo()
  expect(owner.interactiveProps).toEqual(before)
  expect(editor.undo.canUndo).toBe(false)
  editor.undo.redo()
  expect(resolveStepperModule(owner.interactiveProps?.module)?.ok).toBe(true)
})

test('unsafe breadcrumb href remains a local invalid draft without graph mutation', () => {
  const { editor, owner, config, value, request } = fixture('breadcrumb')
  const previous = structuredClone(owner.interactiveProps)
  const invalid = editNavigationEditor(value, {
    kind: 'update',
    index: 0,
    field: 'href',
    value: ['javascript', 'alert(1)'].join(':')
  })
  expect(validNavigationEditor(config, invalid)).toBe(false)
  expect(commitNavigationEditor(editor, request(invalid))).toBe(false)
  expect(owner.interactiveProps).toEqual(previous)
  expect(editor.undo.canUndo).toBe(false)
  const fixed = editNavigationEditor(invalid, {
    kind: 'update',
    index: 0,
    field: 'href',
    value: '/guide'
  })
  expect(commitNavigationEditor(editor, request(fixed))).toBe(true)
  expect(resolveBreadcrumbModule(owner.interactiveProps?.module)?.ok).toBe(true)
})

for (const boundary of [
  'selection',
  'locked',
  'parent-locked',
  'replacement',
  'changed'
] as const) {
  test(`late navigation edits are rejected after ${boundary}`, () => {
    const { editor, owner, value, request } = fixture()
    const pending = request(editNavigationEditor(value, { kind: 'add', title: 'New step' }))
    if (boundary === 'selection') editor.clearSelection()
    if (boundary === 'locked') editor.graph.updateNode(owner.id, { locked: true })
    if (boundary === 'parent-locked') {
      const parent = editor.graph.createNode('FRAME', editor.state.currentPageId, { locked: true })
      editor.graph.reparentNode(owner.id, parent.id)
    }
    if (boundary === 'replacement') editor.replaceGraph(new SceneGraph())
    if (boundary === 'changed')
      editor.graph.updateNode(owner.id, {
        interactiveProps: {
          ...owner.interactiveProps,
          module: { ...(pending.previousModule as object), configVersion: 7 }
        }
      })
    expect(commitNavigationEditor(editor, pending)).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })
}

test('retained draft ignores late input after target change, deactivation or disposal', () => {
  const { owner, config } = fixture('breadcrumb')
  const target = shallowRef(owner)
  const saved = shallowRef(config)
  const active = ref(true)
  const scope = effectScope()
  scopes.push(scope)
  const commits: NavigationEditorCommit[] = []
  const draft = scope.run(() =>
    useNavigationEditorDraft(
      () => target.value,
      () => saved.value,
      (request) => commits.push(request),
      active
    )
  )
  if (!draft) throw new Error('Missing navigation draft')
  draft.beginInput()
  draft.input(0, 'label', 'Pending title')
  target.value = structuredClone(owner)
  draft.input(0, 'label', 'Late title')
  draft.commit()
  expect(commits).toEqual([])
  draft.beginInput()
  draft.input(0, 'label', 'Another draft')
  active.value = false
  draft.commit()
  expect(commits).toEqual([])
  active.value = true
  draft.beginInput()
  draft.input(0, 'label', 'Disposed draft')
  scope.stop()
  draft.commit()
  expect(commits).toEqual([])
})
