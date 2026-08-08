import { describe, expect, test } from 'bun:test'

import type { SceneNode, WorkflowDef } from '@open-pencil/scene-graph'

import { analyzeWorkflowGraph, collectWorkflowEntrypoints } from '@/app/lowcode/workflow-graph'

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
      actionId: 'call-b',
      actionPath: '[0]/consequent[0]',
      actionKind: 'callWorkflow'
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

  test('traverses invokeServerWorkflow success and error branches', () => {
    const summary = analyzeWorkflowGraph([
      {
        id: 'wf-source',
        name: 'Source',
        actions: [
          {
            id: 'invoke-server',
            kind: 'invokeServerWorkflow',
            workflowId: 'server-checkout',
            resultName: 'checkout',
            onSuccess: [
              { id: 'call-client', kind: 'callWorkflow', workflowId: 'wf-client-success' }
            ],
            onError: [{ id: 'toast-error', kind: 'toast', messageExpr: '"Failed"' }]
          }
        ]
      },
      {
        id: 'wf-client-success',
        name: 'Client success',
        actions: [{ id: 'stop', kind: 'stop' }]
      }
    ])

    expect(summary).toMatchObject({ actionCount: 4, callCount: 1, issues: [] })
    expect(summary.edges[0]).toMatchObject({
      fromId: 'wf-source',
      toId: 'wf-client-success',
      actionId: 'call-client',
      actionPath: '[0]/onSuccess[0]'
    })
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
        workflowIds: ['wf-a', 'wf-missing'],
        targetWorkflowId: 'wf-a',
        actionId: 'call-missing',
        actionPath: '[0]'
      }
    ])
    expect(summary.issues[0]?.i18n).toEqual({
      code: 'missing-workflow-call',
      sourceName: 'Save',
      workflowId: 'wf-missing'
    })
    expect(Object.keys(summary.issues[0] ?? {})).not.toContain('i18n')
  })

  test('collects workflow entrypoints from node events', () => {
    const workflows: WorkflowDef[] = [
      { id: 'wf-save', name: 'Save', actions: [] },
      { id: 'wf-notify', name: 'Notify', actions: [] }
    ]
    const node = {
      id: 'button-1',
      name: 'Submit',
      events: {
        onClick: [
          {
            id: 'condition',
            kind: 'condition',
            condExpr: 'true',
            consequent: [{ id: 'call-save', kind: 'callWorkflow', workflowId: 'wf-save' }],
            alternate: [{ id: 'call-missing', kind: 'callWorkflow', workflowId: 'wf-missing' }]
          }
        ]
      }
    } as SceneNode

    const entrypoints = collectWorkflowEntrypoints([node], workflows)
    const summary = analyzeWorkflowGraph(workflows, { entrypoints })

    expect(entrypoints).toEqual([
      {
        workflowId: 'wf-save',
        workflowName: 'Save',
        nodeId: 'button-1',
        nodeName: 'Submit',
        eventName: 'onClick',
        actionId: 'call-save',
        actionPath: 'onClick[0]/consequent[0]'
      },
      {
        workflowId: 'wf-missing',
        workflowName: undefined,
        nodeId: 'button-1',
        nodeName: 'Submit',
        eventName: 'onClick',
        actionId: 'call-missing',
        actionPath: 'onClick[0]/alternate[0]'
      }
    ])
    expect(summary.entrypointCount).toBe(1)
    expect(summary.workflowsWithoutEntrypoints).toEqual(['wf-notify'])
    expect(summary.nodes).toMatchObject([
      { id: 'wf-save', entrypoints: [{ nodeName: 'Submit', eventName: 'onClick' }] },
      { id: 'wf-notify', entrypoints: [] }
    ])
    expect(summary.issues).toEqual([
      {
        type: 'missing-workflow',
        message: 'Submit onClick calls a missing workflow (wf-missing)',
        workflowIds: ['wf-missing']
      }
    ])
    expect(summary.issues[0]?.i18n).toEqual({
      code: 'missing-workflow-entrypoint',
      nodeName: 'Submit',
      eventName: 'onClick',
      workflowId: 'wf-missing'
    })
  })

  test('reports workflows without event entrypoints', () => {
    const workflows: WorkflowDef[] = [
      { id: 'wf-a', name: 'A', actions: [] },
      { id: 'wf-b', name: 'B', actions: [] }
    ]

    const summary = analyzeWorkflowGraph(workflows, { entrypoints: [] })

    expect(summary.entrypointCount).toBe(0)
    expect(summary.workflowsWithoutEntrypoints).toEqual(['wf-a', 'wf-b'])
    expect(summary.nodes.map((node) => node.entrypoints)).toEqual([[], []])
  })

  test('reports callWorkflow argument contract issues', () => {
    const workflows: WorkflowDef[] = [
      {
        id: 'wf-source',
        name: 'Source',
        actions: [
          {
            id: 'call-target',
            kind: 'callWorkflow',
            workflowId: 'wf-target',
            args: {
              badExtra: '"unused"',
              message: ''
            }
          },
          {
            id: 'call-invalid',
            kind: 'callWorkflow',
            workflowId: 'wf-invalid',
            args: { count: '1 +' }
          }
        ]
      },
      {
        id: 'wf-target',
        name: 'Target',
        params: ['message', 'optionalNote'],
        optionalParams: ['optionalNote'],
        actions: []
      },
      {
        id: 'wf-invalid',
        name: 'Invalid',
        params: ['count'],
        actions: []
      }
    ]

    const summary = analyzeWorkflowGraph(workflows)

    expect(summary.issues).toContainEqual({
      type: 'call-args',
      message: 'Source calls Target with invalid arguments: extra "badExtra", missing "message"',
      workflowIds: ['wf-source', 'wf-target'],
      targetWorkflowId: 'wf-source',
      actionId: 'call-target',
      actionPath: '[0]'
    })
    expect(summary.issues).toContainEqual({
      type: 'call-args',
      message: 'Source calls Invalid with invalid arguments: invalid "count"',
      workflowIds: ['wf-source', 'wf-invalid'],
      targetWorkflowId: 'wf-source',
      actionId: 'call-invalid',
      actionPath: '[1]'
    })
    expect(summary.issues.find((issue) => issue.actionId === 'call-target')?.i18n).toEqual({
      code: 'call-args',
      sourceName: 'Source',
      targetName: 'Target',
      problems: [
        { kind: 'extra', param: 'badExtra', message: 'extra "badExtra"' },
        { kind: 'missing', param: 'message', message: 'missing "message"' }
      ]
    })
    expect(summary.nodes.find((node) => node.id === 'wf-source')?.issues).toHaveLength(2)
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
        workflowIds: ['wf-a', 'wf-b', 'wf-c', 'wf-a'],
        targetWorkflowId: 'wf-a'
      },
      {
        type: 'cycle',
        message: 'Workflow cycle: Self -> Self',
        workflowIds: ['wf-d', 'wf-d'],
        targetWorkflowId: 'wf-d'
      }
    ])
    expect(summary.issues.map((issue) => issue.i18n)).toEqual([
      { code: 'cycle', names: ['A', 'B', 'C', 'A'] },
      { code: 'cycle', names: ['Self', 'Self'] }
    ])
  })
})
