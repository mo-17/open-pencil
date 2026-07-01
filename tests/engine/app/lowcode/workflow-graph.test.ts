import { describe, expect, test } from 'bun:test'

import type { WorkflowDef } from '@open-pencil/core/scene-graph'

import { analyzeWorkflowGraph } from '@/app/lowcode/workflow-graph'

describe('lowcode workflow graph analysis', () => {
  test('counts nested actions and callWorkflow edges', () => {
    const workflows: WorkflowDef[] = [
      {
        id: 'wf-a',
        name: 'Save',
        actions: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: 'true',
            consequent: [{ id: 'call-b', kind: 'callWorkflow', workflowId: 'wf-b' }],
            alternate: [{ id: 'toast', kind: 'toast', messageExpr: '"Skip"' }]
          }
        ]
      },
      { id: 'wf-b', name: 'Notify', actions: [{ id: 'stop', kind: 'stop' }] }
    ]

    const summary = analyzeWorkflowGraph(workflows)

    expect(summary).toMatchObject({
      workflowCount: 2,
      actionCount: 4,
      callCount: 1,
      issues: []
    })
    expect(summary.edges[0]).toMatchObject({
      fromId: 'wf-a',
      fromName: 'Save',
      toId: 'wf-b',
      toName: 'Notify',
      actionId: 'call-b'
    })
    expect(summary.nodes).toMatchObject([
      {
        id: 'wf-a',
        actionCount: 3,
        incoming: [],
        outgoing: [{ toId: 'wf-b' }],
        issues: []
      },
      {
        id: 'wf-b',
        actionCount: 1,
        incoming: [{ fromId: 'wf-a' }],
        outgoing: [],
        issues: []
      }
    ])
  })

  test('reports missing workflow references', () => {
    const summary = analyzeWorkflowGraph([
      {
        id: 'wf-a',
        name: 'Save',
        actions: [{ id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }]
      }
    ])

    expect(summary.issues).toEqual([
      {
        type: 'missing-workflow',
        message: 'Save calls a missing workflow (wf-missing)',
        workflowIds: ['wf-a', 'wf-missing']
      }
    ])
  })

  test('reports direct and indirect workflow cycles once', () => {
    const workflows: WorkflowDef[] = [
      {
        id: 'wf-a',
        name: 'A',
        actions: [{ id: 'call-b', kind: 'callWorkflow', workflowId: 'wf-b' }]
      },
      {
        id: 'wf-b',
        name: 'B',
        actions: [{ id: 'call-c', kind: 'callWorkflow', workflowId: 'wf-c' }]
      },
      {
        id: 'wf-c',
        name: 'C',
        actions: [{ id: 'call-a', kind: 'callWorkflow', workflowId: 'wf-a' }]
      },
      {
        id: 'wf-d',
        name: 'Self',
        actions: [{ id: 'call-d', kind: 'callWorkflow', workflowId: 'wf-d' }]
      }
    ]

    const summary = analyzeWorkflowGraph(workflows)

    expect(summary.issues).toEqual([
      {
        type: 'cycle',
        message: 'Workflow cycle: A -> B -> C -> A',
        workflowIds: ['wf-a', 'wf-b', 'wf-c', 'wf-a']
      },
      {
        type: 'cycle',
        message: 'Workflow cycle: Self -> Self',
        workflowIds: ['wf-d', 'wf-d']
      }
    ])
  })
})
