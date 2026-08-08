import { describe, expect, test } from 'bun:test'

import { CORE_TOOLS } from '@open-pencil/core/tools'
import type { ServerWorkflowDef } from '@open-pencil/scene-graph'

import { serializeLowcodeFields } from '#core/kiwi/fig/node-change/lowcode-plugin-data'

import { getTool, setupToolTest } from '#tests/helpers/tools'

type Result<T> = { ok: true; data?: T } | { ok: false; error: string }

const TRIGGER = { kind: 'http', method: 'POST', auth: 'supabase-user' } as const

function setServerWorkflows(
  figma: ReturnType<typeof setupToolTest>['figma'],
  workflows: unknown
): Result<{ workflows: number; actions: number }> {
  return getTool('set_server_workflows').execute(figma, {
    server_workflows_json: JSON.stringify(workflows)
  }) as Result<{ workflows: number; actions: number }>
}

describe('server workflow MCP tools', () => {
  test('accepts native structured arrays and enforces exactly one input channel', () => {
    const { figma, graph } = setupToolTest()
    const workflows: ServerWorkflowDef[] = [
      { id: 'native', name: 'Native', trigger: TRIGGER, actions: [] }
    ]
    const native = getTool('set_server_workflows').execute(figma, {
      server_workflows: workflows
    }) as Result<{ workflows: number; actions: number }>
    expect(native).toEqual({ ok: true, data: { workflows: 1, actions: 0 } })
    expect(graph.getNode(graph.rootId)?.lowcodeServerWorkflows).toEqual(workflows)

    const both = getTool('set_server_workflows').execute(figma, {
      server_workflows: workflows,
      server_workflows_json: JSON.stringify(workflows)
    }) as Result<unknown>
    expect(both).toEqual({
      ok: false,
      error: 'Provide exactly one of server_workflows or server_workflows_json, not both'
    })
  })

  test('register, persist, recursively count, and read server workflows', () => {
    const names = new Set(CORE_TOOLS.map((tool) => tool.name))
    expect(names.has('read_server_workflows')).toBe(true)
    expect(names.has('set_server_workflows')).toBe(true)

    const { figma, graph } = setupToolTest()
    const workflows: ServerWorkflowDef[] = [
      {
        id: 'notify-user',
        name: 'Notify user',
        trigger: TRIGGER,
        params: ['userId'],
        actions: [
          {
            id: 'fetch-hook',
            kind: 'httpRequest',
            method: 'POST',
            url: { kind: 'expr', expr: '"https://hooks.example.com/notify"' },
            headers: [{ name: 'Authorization', value: { kind: 'env', name: 'HOOK_TOKEN' } }],
            body: { kind: 'expr', expr: 'userId' },
            resultName: 'hookResult'
          },
          {
            id: 'response-branch',
            kind: 'condition',
            condExpr: 'hookResult.ok',
            consequent: [{ id: 'done', kind: 'return', valueExpr: 'hookResult', status: 200 }],
            alternate: [{ id: 'failed', kind: 'return', status: 502 }]
          }
        ]
      }
    ]

    const set = setServerWorkflows(figma, workflows)
    expect(set).toEqual({ ok: true, data: { workflows: 1, actions: 4 } })
    expect(graph.getNode(graph.rootId)?.lowcodeServerWorkflows).toEqual(workflows)

    const read = getTool('read_server_workflows').execute(figma, {}) as Result<ServerWorkflowDef[]>
    expect(read).toEqual({ ok: true, data: workflows })
  })

  test('accepts the server Supabase action vocabulary', () => {
    const { figma } = setupToolTest()
    const result = setServerWorkflows(figma, [
      {
        id: 'save-order',
        name: 'Save order',
        trigger: TRIGGER,
        params: ['orderId'],
        actions: [
          {
            id: 'find-order',
            kind: 'supabaseQuery',
            table: 'orders',
            columns: 'id,status',
            filters: [{ column: 'id', op: 'eq', valueExpr: 'orderId' }],
            single: true,
            resultName: 'order'
          },
          {
            id: 'update-order',
            kind: 'supabaseMutation',
            operation: 'update',
            table: 'orders',
            payloadEntries: [{ key: 'status', valueExpr: '"processed"' }],
            filters: [{ column: 'id', op: 'eq', valueExpr: 'orderId' }],
            resultName: 'updatedOrder'
          },
          { id: 'respond', kind: 'return', valueExpr: 'updatedOrder' }
        ]
      }
    ])

    expect(result.ok).toBe(true)
  })

  test('fails closed on stored secret values, credential fields, and invalid env names', () => {
    const { figma, graph } = setupToolTest()
    const original: ServerWorkflowDef[] = [
      { id: 'original', name: 'Original', trigger: TRIGGER, actions: [] }
    ]
    expect(setServerWorkflows(figma, original).ok).toBe(true)

    for (const value of [
      { kind: 'env', name: 'API_TOKEN', value: 'plaintext' },
      { kind: 'env', name: 'API_TOKEN', credential: 'saved-profile' },
      { kind: 'env', name: 'api_token' }
    ]) {
      const result = setServerWorkflows(figma, [
        {
          id: 'bad-secret',
          name: 'Bad secret',
          trigger: TRIGGER,
          actions: [
            {
              id: 'request',
              kind: 'httpRequest',
              method: 'POST',
              url: { kind: 'expr', expr: '"https://example.com"' },
              headers: [{ name: 'Authorization', value }]
            }
          ]
        }
      ])
      expect(result.ok).toBe(false)
      expect(graph.getNode(graph.rootId)?.lowcodeServerWorkflows).toEqual(original)
    }
  })

  test('does not echo or persist a secret literal hidden in an expression', () => {
    const { figma, graph } = setupToolTest()
    const secret = ['sk_', 'live_DO_NOT_PERSIST_123456'].join('')
    const result = setServerWorkflows(figma, [
      {
        id: 'bad-secret-expression',
        name: 'Bad secret expression',
        trigger: TRIGGER,
        actions: [{ id: 'leak', kind: 'return', valueExpr: JSON.stringify(secret) }]
      }
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('server_workflows_json[0].actions[0].valueExpr')
      expect(result.error).toContain('environment-variable reference')
      expect(result.error).not.toContain(secret)
    }
    const root = graph.getNode(graph.rootId)
    expect(root?.lowcodeServerWorkflows).toBeUndefined()
    expect(JSON.stringify(root ? serializeLowcodeFields(root) : [])).not.toContain(secret)
  })

  test('rejects unsupported triggers, unknown references, bad args, and call cycles', () => {
    const { figma } = setupToolTest()
    const getTrigger = setServerWorkflows(figma, [
      {
        id: 'bad-trigger',
        name: 'Bad trigger',
        trigger: { kind: 'http', method: 'GET', auth: 'supabase-user' },
        actions: []
      }
    ])
    expect(getTrigger.ok).toBe(false)
    if (!getTrigger.ok) expect(getTrigger.error).toContain('.trigger.method')

    const missing = setServerWorkflows(figma, [
      {
        id: 'caller',
        name: 'Caller',
        trigger: TRIGGER,
        actions: [{ id: 'call', kind: 'callServerWorkflow', workflowId: 'missing' }]
      }
    ])
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('references an unknown workflow')

    const badArgs = setServerWorkflows(figma, [
      {
        id: 'caller',
        name: 'Caller',
        trigger: TRIGGER,
        actions: [{ id: 'call', kind: 'callServerWorkflow', workflowId: 'target' }]
      },
      {
        id: 'target',
        name: 'Target',
        trigger: TRIGGER,
        params: ['requiredValue'],
        actions: []
      }
    ])
    expect(badArgs.ok).toBe(false)
    if (!badArgs.ok) expect(badArgs.error).toContain('missing required argument')

    const cycle = setServerWorkflows(figma, [
      {
        id: 'a',
        name: 'A',
        trigger: TRIGGER,
        actions: [{ id: 'a-call', kind: 'callServerWorkflow', workflowId: 'b' }]
      },
      {
        id: 'b',
        name: 'B',
        trigger: TRIGGER,
        actions: [{ id: 'b-call', kind: 'callServerWorkflow', workflowId: 'a' }]
      }
    ])
    expect(cycle.ok).toBe(false)
    if (!cycle.ok) expect(cycle.error).toContain('a -> b -> a')
  })

  test('null and [] clear the field', () => {
    const { figma, graph } = setupToolTest()
    expect(
      setServerWorkflows(figma, [{ id: 'one', name: 'One', trigger: TRIGGER, actions: [] }]).ok
    ).toBe(true)

    const clearNull = getTool('set_server_workflows').execute(figma, {
      server_workflows_json: 'null'
    }) as Result<{ workflows: number; actions: number }>
    expect(clearNull).toEqual({ ok: true, data: { workflows: 0, actions: 0 } })
    expect(graph.getNode(graph.rootId)?.lowcodeServerWorkflows).toBeUndefined()

    expect(setServerWorkflows(figma, []).ok).toBe(true)
    expect(graph.getNode(graph.rootId)?.lowcodeServerWorkflows).toBeUndefined()
  })

  test('read tool refuses an invalid root field injected outside the authoring boundary', () => {
    const { figma, graph } = setupToolTest()
    const secret = ['rk_', 'live_NEVER_ECHO_123'].join('')
    graph.updateNode(graph.rootId, {
      lowcodeServerWorkflows: [
        {
          id: 'invalid',
          name: 'Invalid',
          trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
          actions: [{ id: 'leak', kind: 'return', valueExpr: JSON.stringify(secret) }]
        }
      ]
    })

    const result = getTool('read_server_workflows').execute(figma, {}) as Result<unknown>
    expect(result).toEqual({
      ok: false,
      error: 'Stored server workflows are invalid and were not returned'
    })
    expect(JSON.stringify(result)).not.toContain(secret)
    const root = graph.getNode(graph.rootId)
    expect(JSON.stringify(root ? serializeLowcodeFields(root) : [])).not.toContain(secret)
  })
})
