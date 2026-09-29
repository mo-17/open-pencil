import { describe, expect, test } from 'bun:test'

import type { ActionKind } from '@open-pencil/scene-graph'

import { ACTION_KINDS, makeAction } from '@/app/lowcode/action/factory'

const emptyContext = {
  pageStates: [],
  docStates: [],
  motionTargets: []
}

describe('lowcode action factory', () => {
  test('offers every ActionKind exactly once', () => {
    expect(new Set<ActionKind>(ACTION_KINDS).size).toBe(ACTION_KINDS.length)
    expect(ACTION_KINDS).toContain('invokeServerWorkflow')
  })

  test('creates an editable invokeServerWorkflow action without stale fields', () => {
    expect(makeAction('invokeServerWorkflow', 'invoke-1', emptyContext)).toEqual({
      id: 'invoke-1',
      kind: 'invokeServerWorkflow',
      workflowId: ''
    })
  })
})
