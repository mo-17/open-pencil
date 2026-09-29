import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  clearLowcodeActionFocus,
  peekLowcodeActionFocus,
  requestLowcodeActionFocus
} from '@/app/lowcode/action/focus'

test('pending action navigation stays with its document when node IDs match', () => {
  const document = new SceneGraph()
  const anotherDocument = new SceneGraph()
  const target = { nodeId: 'field', actionId: 'focus', actionPath: 'onFocus[0]' }
  try {
    requestLowcodeActionFocus(document, target)
    expect(peekLowcodeActionFocus(document, 'field')).toBe(target)
    expect(peekLowcodeActionFocus(anotherDocument, 'field')).toBeNull()
    expect(peekLowcodeActionFocus(document, 'another-field')).toBeNull()
    expect(peekLowcodeActionFocus(document, undefined)).toBeNull()
  } finally {
    clearLowcodeActionFocus(target)
  }
})

test('finishing an older navigation does not consume a newer document request', () => {
  const document = new SceneGraph()
  const anotherDocument = new SceneGraph()
  const first = { nodeId: 'field', actionId: 'focus', actionPath: 'onFocus[0]' }
  const latest = { nodeId: 'field', actionId: 'change', actionPath: 'onChange[0]' }
  try {
    requestLowcodeActionFocus(document, first)
    requestLowcodeActionFocus(anotherDocument, latest)
    clearLowcodeActionFocus(first)
    expect(peekLowcodeActionFocus(document, 'field')).toBeNull()
    expect(peekLowcodeActionFocus(anotherDocument, 'field')).toBe(latest)
    clearLowcodeActionFocus(latest)
    expect(peekLowcodeActionFocus(anotherDocument, 'field')).toBeNull()
  } finally {
    clearLowcodeActionFocus(latest)
  }
})
