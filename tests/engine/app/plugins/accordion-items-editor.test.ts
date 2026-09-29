import { afterEach, describe, expect, test } from 'bun:test'

import { effectScope, ref, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import {
  ACCORDION_MODULE_LIMITS,
  createAccordionModuleFrameOverrides,
  createAccordionModuleInstance,
  resolveAccordionModule
} from '@open-pencil/core/plugins'

import {
  accordionEditorValue,
  accordionPropertyVisible,
  commitAccordionEditor,
  editAccordionEditor,
  validAccordionEditor,
  type AccordionEditorCommit
} from '@/app/lowcode/accordion-editor'
import { useAccordionEditorDraft } from '@/app/lowcode/accordion-editor/use'

const editors: ReturnType<typeof createEditor>[] = []
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  for (const editor of editors.splice(0)) editor.dispose()
})

function fixture() {
  const editor = createEditor()
  editors.push(editor)
  const owner = editor.graph.createNode(
    'FRAME',
    editor.state.currentPageId,
    createAccordionModuleFrameOverrides({
      items: [
        { id: 'first', title: 'First', content: 'First content' },
        { id: 'second', title: 'Second', content: 'Second content' },
        { id: 'third', title: 'Third', content: 'Third content' }
      ],
      allowMultiple: true,
      initialOpenIds: ['first', 'third'],
      accentColor: '#123456'
    })
  )
  editor.select([owner.id])
  editor.undo.clear()
  const resolved = resolveAccordionModule(owner.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing accordion')
  const config = resolved.config
  const value = accordionEditorValue(config)
  function request(next = value): AccordionEditorCommit {
    return { owner, previousModule: structuredClone(owner.interactiveProps?.module), value: next }
  }
  return { editor, owner, config, value, request }
}

function savedOpen(owner: ReturnType<typeof fixture>['owner']): string[] {
  const resolved = resolveAccordionModule(owner.interactiveProps?.module)
  if (!resolved?.ok) throw new Error('Missing saved accordion')
  return resolved.config.initialOpenIds
}

describe('accordion structured item editing', () => {
  test('dedicated editor owns initial and multiple-open settings, retaining generic style controls', () => {
    expect(accordionPropertyVisible('initialOpenIds')).toBe(false)
    expect(accordionPropertyVisible('allowMultiple')).toBe(false)
    for (const key of ['items', 'label', 'backgroundColor', 'showDividers', 'fontSize'])
      expect(accordionPropertyVisible(key)).toBe(true)
  })

  test('reading an existing v1 configuration leaves its saved envelope and history untouched', () => {
    const { editor, owner, config, value, request } = fixture()
    const before = structuredClone(owner.interactiveProps)
    expect(value.initialOpenIndexes).toEqual([0, 2])
    expect(validAccordionEditor(config, value)).toBe(true)
    expect(commitAccordionEditor(editor, request())).toBe(true)
    expect(owner.interactiveProps).toEqual(before)
    expect(editor.undo.canUndo).toBe(false)
  })

  test('renaming an initially open item migrates its reference atomically and preserves styles', () => {
    const { editor, owner, value, request } = fixture()
    const before = structuredClone(owner.interactiveProps)
    expect(
      commitAccordionEditor(
        editor,
        request(
          editAccordionEditor(value, { kind: 'update', index: 0, field: 'id', value: 'intro' })
        )
      )
    ).toBe(true)
    expect(savedOpen(owner)).toEqual(['intro', 'third'])
    const resolved = resolveAccordionModule(owner.interactiveProps?.module)
    expect(resolved?.ok && resolved.instance.configVersion).toBe(1)
    expect(resolved?.ok && resolved.config.accentColor).toBe('#123456')
    editor.undo.undo()
    expect(owner.interactiveProps).toEqual(before)
    editor.undo.redo()
    expect(savedOpen(owner)).toEqual(['intro', 'third'])
  })

  test('temporary duplicate identifiers can be corrected without transferring initial-open identity', () => {
    const { editor, owner, config, value, request } = fixture()
    const duplicate = editAccordionEditor(value, {
      kind: 'update',
      index: 1,
      field: 'id',
      value: 'first'
    })
    expect(validAccordionEditor(config, duplicate)).toBe(false)
    expect(commitAccordionEditor(editor, request(duplicate))).toBe(false)
    const fixed = editAccordionEditor(duplicate, {
      kind: 'update',
      index: 1,
      field: 'id',
      value: 'renamed'
    })
    expect(commitAccordionEditor(editor, request(fixed))).toBe(true)
    expect(savedOpen(owner)).toEqual(['first', 'third'])
  })

  test('move preserves item identity, remove clears references, and new items start collapsed', () => {
    const { value } = fixture()
    const moved = editAccordionEditor(value, { kind: 'move', index: 2, offset: -1 })
    expect(moved.items.map((item) => item.id)).toEqual(['first', 'third', 'second'])
    expect(moved.initialOpenIndexes).toEqual([0, 1])
    const removed = editAccordionEditor(moved, { kind: 'remove', index: 0 })
    expect(removed.initialOpenIndexes).toEqual([0])
    const added = editAccordionEditor(removed, { kind: 'add', title: 'Extra' })
    expect(added.initialOpenIndexes).toEqual([0])
    expect(new Set(added.items.map((item) => item.id)).size).toBe(added.items.length)
    expect(value.items.map((item) => item.id)).toEqual(['first', 'second', 'third'])
  })

  test('multiple to single keeps first open in current list order; picking another replaces it', () => {
    const { editor, owner, value, request } = fixture()
    const moved = editAccordionEditor(value, { kind: 'move', index: 2, offset: -1 })
    const single = editAccordionEditor(moved, { kind: 'multiple', value: false })
    expect(single.initialOpenIndexes).toEqual([0])
    const picked = editAccordionEditor(single, { kind: 'open', index: 1, value: true })
    expect(picked.initialOpenIndexes).toEqual([1])
    expect(commitAccordionEditor(editor, request(picked))).toBe(true)
    expect(savedOpen(owner)).toEqual(['third'])
    expect(
      editAccordionEditor(picked, { kind: 'open', index: 1, value: false }).initialOpenIndexes
    ).toEqual([])
    editor.undo.undo()
    expect(savedOpen(owner)).toEqual(['first', 'third'])
  })

  test('boundaries preserve at least one item and reject invalid identifiers and initial indexes', () => {
    const { config } = fixture()
    let { value } = fixture()
    for (let i = 0; i < 20; i++) value = editAccordionEditor(value, { kind: 'add', title: 'Extra' })
    expect(value.items).toHaveLength(ACCORDION_MODULE_LIMITS.itemsMax)
    for (let i = 0; i < 20; i++) value = editAccordionEditor(value, { kind: 'remove', index: 0 })
    expect(value.items).toHaveLength(1)
    expect(value.initialOpenIndexes).toEqual([])
    expect(editAccordionEditor(value, { kind: 'remove', index: -1 })).toBe(value)
    expect(editAccordionEditor(value, { kind: 'move', index: 0, offset: 1 })).toBe(value)
    for (const id of ['', '1bad', 'with space']) {
      expect(
        validAccordionEditor(
          config,
          editAccordionEditor(value, {
            kind: 'update',
            index: 0,
            field: 'id',
            value: id
          })
        )
      ).toBe(false)
    }
    for (const initialOpenIndexes of [[1], [-1], [0, 0], [0.5]])
      expect(validAccordionEditor(config, { ...value, initialOpenIndexes })).toBe(false)
  })

  test('stale snapshots, changed selection, replaced graph nodes and locks reject late commits', () => {
    const { editor, owner, value, request } = fixture()
    const pending = request(editAccordionEditor(value, { kind: 'add', title: 'Extra' }))
    editor.clearSelection()
    expect(commitAccordionEditor(editor, pending)).toBe(false)
    editor.select([owner.id])
    expect(commitAccordionEditor(editor, { ...pending, owner: structuredClone(owner) })).toBe(false)
    editor.graph.updateNode(owner.id, {
      interactiveProps: { module: createAccordionModuleInstance() }
    })
    expect(commitAccordionEditor(editor, pending)).toBe(false)
    editor.graph.updateNode(owner.id, { locked: true })
    expect(commitAccordionEditor(editor, request(pending.value))).toBe(false)
    expect(editor.undo.canUndo).toBe(false)
  })
})

describe('accordion draft lifecycle', () => {
  function draftFixture() {
    const { editor, owner, config } = fixture()
    const target = shallowRef(owner)
    const saved = shallowRef(config)
    const active = ref(true)
    const scope = effectScope()
    scopes.push(scope)
    const commits: AccordionEditorCommit[] = []
    const state = scope.run(() =>
      useAccordionEditorDraft(
        () => target.value,
        () => saved.value,
        (request) => commits.push(request),
        active
      )
    )
    if (!state) throw new Error('Missing accordion draft')
    return { editor, target, saved, active, scope, commits, state }
  }

  test('invalid edits remain local, then commit exact inert text with corrected identifiers', () => {
    const { state, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'id', 'second')
    state.commit()
    expect(state.invalid.value).toBe(true)
    expect(commits).toHaveLength(0)
    state.input(0, 'id', 'intro')
    state.input(0, 'content', '<script>inert text</script>')
    state.commit()
    expect(state.invalid.value).toBe(false)
    expect(commits).toHaveLength(1)
    expect(commits[0].value.items[0]).toMatchObject({
      id: 'intro',
      content: '<script>inert text</script>'
    })
    expect(commits[0].value.initialOpenIndexes).toEqual([0, 2])
    state.input(0, 'content', 'Later')
    expect(commits[0].value.items[0].content).toBe('<script>inert text</script>')
  })

  test('retained deactivation, restore and disposal discard drafts before late change or blur', () => {
    const { state, saved, active, scope, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'title', 'Unsaved')
    active.value = false
    state.commit()
    expect(state.draft.value).toEqual(accordionEditorValue(saved.value))
    active.value = true
    state.input(0, 'title', 'Late input')
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Discard')
    state.restore()
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Unmounted')
    scope.stop()
    state.commit()
    expect(commits).toHaveLength(0)
  })

  test('switching owner or undo/external configuration cancels pending text changes synchronously', () => {
    const { editor, state, target, saved, commits } = draftFixture()
    state.beginInput()
    state.input(0, 'title', 'Old node')
    target.value = editor.graph.createNode(
      'FRAME',
      editor.state.currentPageId,
      createAccordionModuleFrameOverrides()
    )
    state.input(0, 'title', 'Late old-node input')
    state.commit()
    expect(commits).toHaveLength(0)
    state.beginInput()
    state.input(0, 'title', 'Before undo')
    saved.value = { ...saved.value, initialOpenIds: ['second'] }
    state.input(0, 'title', 'Late input after undo')
    state.commit()
    expect(commits).toHaveLength(0)
    expect(state.draft.value.initialOpenIndexes).toEqual([1])
  })
})
