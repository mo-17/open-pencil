import { expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

import { editRadioOptions, selectRadioDefault } from '@/app/lowcode/controls/radio-options'

import { expectDefined } from '#tests/helpers/assert'

test('renaming the selected option moves its default in the same undo entry', () => {
  const editor = createEditor()
  const node = editor.graph.createNode('RADIO', editor.state.currentPageId, {
    interactiveProps: { options: ['个人', '团队'], value: '团队', groupName: 'plan' }
  })
  const next = editRadioOptions(expectDefined(node.interactiveProps), {
    kind: 'rename',
    index: 1,
    value: '企业'
  })
  editor.updateNodeWithUndo(node.id, { interactiveProps: next as JSONObject }, 'Rename option')
  expect(node.interactiveProps).toEqual({
    options: ['个人', '企业'],
    value: '企业',
    groupName: 'plan'
  })
  editor.undo.undo()
  expect(node.interactiveProps).toEqual({
    options: ['个人', '团队'],
    value: '团队',
    groupName: 'plan'
  })
  editor.undo.redo()
  expect(expectDefined(node.interactiveProps).value).toBe('企业')
})

test('removing or clearing the selected option leaves no dangling default', () => {
  const props = { options: ['Personal', 'Team'], value: 'Team', disabled: true }
  expect(editRadioOptions(props, { kind: 'remove', index: 1 })).toEqual({
    options: ['Personal'],
    disabled: true
  })
  expect(editRadioOptions(props, { kind: 'rename', index: 1, value: '' })).toEqual({
    options: ['Personal', ''],
    disabled: true
  })
  expect(props.value).toBe('Team')
})

test('editing another option preserves a valid default and adding a draft never selects it', () => {
  const props = { options: ['Personal', 'Team'], value: 'Team' }
  expect(editRadioOptions(props, { kind: 'rename', index: 0, value: 'Individual' })).toEqual({
    options: ['Individual', 'Team'],
    value: 'Team'
  })
  expect(editRadioOptions(props, { kind: 'add' })).toEqual({
    options: ['Personal', 'Team', ''],
    value: 'Team'
  })
  expect(editRadioOptions({ options: [] }, { kind: 'add' })).toEqual({ options: [''] })
})

test('removing one legacy duplicate retains a default that still has an option', () => {
  expect(
    editRadioOptions({ options: ['Team', 'Team'], value: 'Team' }, { kind: 'remove', index: 0 })
  ).toEqual({ options: ['Team'], value: 'Team' })
})

test('option edits do not change bound state, bindings, events or validation', () => {
  const editor = createEditor()
  const page = editor.graph.getNode(editor.state.currentPageId)
  if (!page) throw new Error('Missing fixture page')
  editor.graph.updateNode(page.id, {
    state: [{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'Team' }]
  })
  const node = editor.graph.createNode('RADIO', page.id, {
    bindings: { value: { kind: 'ref', stateId: 'plan' } },
    events: { onChange: [{ id: 'action', kind: 'toast', messageExpr: '"changed"' }] },
    interactiveProps: {
      options: ['Personal', 'Team'],
      value: 'Team',
      validation: { required: true }
    }
  })
  const next = editRadioOptions(expectDefined(node.interactiveProps), { kind: 'remove', index: 1 })
  editor.updateNodeWithUndo(node.id, { interactiveProps: next as JSONObject }, 'Remove option')
  expect(node.interactiveProps).toEqual({ options: ['Personal'], validation: { required: true } })
  expect(node.bindings).toEqual({ value: { kind: 'ref', stateId: 'plan' } })
  expect(node.events?.onChange).toEqual([{ id: 'action', kind: 'toast', messageExpr: '"changed"' }])
  expect(page.state).toEqual([{ id: 'plan', name: 'plan', type: 'string', defaultValue: 'Team' }])
})

test('literal sentinel-like option strings can be selected and cleared without collision', () => {
  const props = { options: ['__openpencil_default__', 'none', ''], groupName: 'plan' }
  const selected = selectRadioDefault(props, 0)
  expect(selected.value).toBe('__openpencil_default__')
  expect(selectRadioDefault(selected, -1)).toEqual(props)
  expect(selectRadioDefault(selected, 2)).toEqual(props)
})

test('stale row indexes do not modify props, and repairing options clears a dangling old default', () => {
  const props = { options: ['Personal'], value: 'Removed' }
  expect(editRadioOptions(props, { kind: 'remove', index: 3 })).toBe(props)
  expect(editRadioOptions(props, { kind: 'rename', index: 0.5, value: 'Team' })).toBe(props)
  expect(editRadioOptions(props, { kind: 'add' })).toEqual({ options: ['Personal', ''] })
})
