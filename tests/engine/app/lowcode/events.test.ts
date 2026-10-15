import { expect, test } from 'bun:test'

import { effectScope, shallowReactive, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core/editor'
import type { ActionDef, SceneNode } from '@open-pencil/scene-graph'
import { createSelectedNodeState } from '@open-pencil/vue'

import { clearLowcodeActionFocus, requestLowcodeActionFocus } from '@/app/lowcode/action/focus'
import { useLowcodeEventEditor } from '@/app/lowcode/events/use'

function fixture() {
  const editor = shallowReactive(createEditor())
  const field = editor.graph.createNode('INPUT', editor.state.currentPageId, {
    events: { onFocus: [{ id: 'focus', kind: 'toast', messageExpr: '"Focused"' }] }
  })
  const selected = shallowRef<SceneNode | undefined>(field)
  const scope = effectScope()
  const events = scope.run(() => useLowcodeEventEditor(editor, selected))
  if (!events) throw new Error('Event scope failed to initialize')
  return { editor, field, selected, scope, events }
}

const changed: ActionDef[] = [{ id: 'changed', kind: 'toast', messageExpr: '"Changed"' }]

test('editing a selected-node snapshot preserves the chosen event and draft identity', () => {
  const editor = shallowReactive(createEditor())
  const field = editor.graph.createNode('INPUT', editor.state.currentPageId, {
    events: { onChange: changed, onBlur: [{ id: 'blur', kind: 'toast', messageExpr: '"Blur"' }] }
  })
  editor.select([field.id])
  const selection = createSelectedNodeState(editor)
  const scope = effectScope()
  const events = scope.run(() => useLowcodeEventEditor(editor, selection.node))
  if (!events) throw new Error('Event scope failed to initialize')
  try {
    events.eventName.value = 'onBlur'
    const key = events.target.value?.key
    const snapshot = selection.node.value
    events.target.value?.commit([{ id: 'blur', kind: 'toast', messageExpr: '"Edited"' }])
    expect(selection.node.value).not.toBe(snapshot)
    expect(events.eventName.value).toBe('onBlur')
    expect(events.target.value?.key).toBe(key)
    expect(field.events?.onBlur).toEqual([{ id: 'blur', kind: 'toast', messageExpr: '"Edited"' }])
    expect(field.events?.onChange).toEqual(changed)
  } finally {
    selection.dispose()
    scope.stop()
  }
})

test('field event editing keeps independent action chains and restores them with undo', () => {
  const { editor, field, scope, events } = fixture()
  try {
    expect(events.eventName.value).toBe('onFocus')
    events.eventName.value = 'onChange'
    events.target.value?.commit(changed)
    expect(editor.graph.getNode(field.id)?.events).toEqual({
      onChange: changed,
      onFocus: [{ id: 'focus', kind: 'toast', messageExpr: '"Focused"' }]
    })
    events.target.value?.commit([])
    expect(editor.graph.getNode(field.id)?.events?.onChange).toBeUndefined()
    editor.undo.undo()
    expect(editor.graph.getNode(field.id)?.events?.onChange).toEqual(changed)
  } finally {
    scope.stop()
  }
})

test('late editor updates cannot cross event, node, document or disposed scope boundaries', () => {
  const { editor, field, selected, scope, events } = fixture()
  const oldGraph = editor.graph
  const oldTarget = events.target.value
  events.eventName.value = 'onChange'
  oldTarget?.commit(changed)
  expect(field.events?.onFocus?.[0]?.id).toBe('focus')
  events.eventName.value = 'onFocus'
  oldTarget?.commit(changed)
  expect(field.events?.onFocus?.[0]?.id).toBe('focus')
  events.eventName.value = 'onChange'
  const changedTarget = events.target.value
  const nextField = editor.graph.createNode('INPUT', editor.state.currentPageId)
  selected.value = nextField
  changedTarget?.commit(changed)
  expect(nextField.events).toBeUndefined()
  selected.value = field
  events.eventName.value = 'onChange'
  changedTarget?.commit(changed)
  expect(field.events?.onChange).toBeUndefined()
  const documentTarget = events.target.value
  editor.replaceGraph(createEditor().graph)
  documentTarget?.commit(changed)
  expect(oldGraph.getNode(field.id)?.events?.onFocus?.[0]?.id).toBe('focus')
  const currentField = editor.graph.createNode('INPUT', editor.state.currentPageId)
  selected.value = currentField
  const disposedTarget = events.target.value
  scope.stop()
  disposedTarget?.commit(changed)
  expect(currentField.events).toBeUndefined()
})

test('navigation selects the requested event and keeps it after the focus request is consumed', () => {
  const { editor, field, scope, events } = fixture()
  const request = { nodeId: field.id, actionId: 'changed', actionPath: 'onChange[0]/onError[1]' }
  try {
    expect(events.eventName.value).toBe('onFocus')
    requestLowcodeActionFocus(editor.graph, request)
    expect(events.eventName.value).toBe('onChange')
    clearLowcodeActionFocus(request)
    expect(events.eventName.value).toBe('onChange')
    events.eventName.value = 'onSubmit'
    expect<unknown>(events.eventName.value).toBe('onChange')
  } finally {
    clearLowcodeActionFocus(request)
    scope.stop()
  }
})
