import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import {
  editSelectOptions,
  selectDefaultOption,
  selectOptionIssues
} from '@/app/lowcode/controls/select-options'

test('changing a submitted value keeps its default atomic without editing bound business state', () => {
  const editor = createEditor()
  const page = editor.graph.getNode(editor.state.currentPageId)
  if (!page) throw new Error('Missing page')
  editor.graph.updateNode(page.id, {
    state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'team' }]
  })
  const properties = {
    options: [
      { label: '个人', value: 'personal' },
      { label: '团队', value: 'team' }
    ],
    value: 'team',
    validation: { required: true },
    allowClear: true
  }
  const node = editor.graph.createNode('SELECT', page.id, {
    bindings: { value: { kind: 'ref', stateId: 'plan' } },
    interactiveProps: properties
  })
  const next = editSelectOptions(properties, {
    kind: 'update',
    index: 1,
    patch: { value: 'company' }
  })
  editor.updateNodeWithUndo(node.id, { interactiveProps: next as JSONObject }, 'Edit option')
  expect(node.interactiveProps.value).toBe('company')
  expect(node.interactiveProps.validation).toEqual({ required: true })
  expect(page.state?.[0].defaultValue).toBe('team')
  expect(node.bindings).toEqual({ value: { kind: 'ref', stateId: 'plan' } })
  editor.undo.undo()
  expect(node.interactiveProps).toEqual(properties)
  editor.undo.redo()
  expect(node.interactiveProps.value).toBe('company')
})

test('reordering or relabeling leaves the submitted value and disabled state intact', () => {
  const props = {
    options: ['First', { label: 'Last', value: 'last', disabled: true }],
    value: 'last'
  }
  const moved = editSelectOptions(props, { kind: 'move', index: 1, offset: -1 })
  expect(moved).toEqual({
    options: [
      { label: 'Last', value: 'last', disabled: true },
      { label: 'First', value: 'First' }
    ],
    value: 'last'
  })
  expect(
    editSelectOptions(moved, { kind: 'update', index: 0, patch: { label: 'Renamed' } })
  ).toMatchObject({ value: 'last' })
  expect(editSelectOptions(moved, { kind: 'move', index: 0, offset: -1 })).toBe(moved)
})

test('removing the selected option clears only its default and adding never reuses a submitted value', () => {
  const props = { options: ['option-1', 'option-3'], value: 'option-3', ariaLabel: 'Plan' }
  const added = editSelectOptions(props, { kind: 'add', label: 'New' })
  expect(added.options).toContainEqual({ label: 'New', value: 'option-2' })
  expect(added.value).toBe('option-3')
  expect(editSelectOptions(props, { kind: 'remove', index: 1 })).toEqual({
    options: [{ label: 'option-1', value: 'option-1' }],
    ariaLabel: 'Plan'
  })
  expect(
    editSelectOptions({ options: ['same', 'same'], value: 'same' }, { kind: 'remove', index: 0 })
      .value
  ).toBe('same')
})

test('empty and sentinel-like submitted values remain actual selectable values', () => {
  const props = { options: [{ label: 'None', value: '' }, '__openpencil_default__'] }
  expect(selectDefaultOption(props, 0).value).toBe('')
  expect(selectDefaultOption(props, 1).value).toBe('__openpencil_default__')
  expect(selectDefaultOption(selectDefaultOption(props, 1), -1)).toEqual(props)
  expect(selectDefaultOption(props, -2)).toEqual(props)
})

test('issues explain ambiguous or stale options without silently rewriting data', () => {
  const props = { options: [{ label: '', value: 'x' }, 'x'], value: 'removed' }
  expect(selectOptionIssues(props)).toEqual(['duplicate', 'label', 'missing'])
  expect(
    editSelectOptions(props, { kind: 'update', index: 0, patch: { label: 'Readable' } }).value
  ).toBe('removed')
  expect(selectOptionIssues({ options: ['x'], value: '', placeholder: 'Choose' })).toEqual([])
  expect(editSelectOptions(props, { kind: 'remove', index: 5 })).toBe(props)
})
