import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import type { ActionDef, ServerWorkflowDef } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

const SUPABASE = {
  url: 'https://example.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiJ9.anon.sig'
}

const WORKFLOWS: ServerWorkflowDef[] = [
  {
    id: 'send-message',
    name: 'Send message',
    trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
    params: ['message'],
    actions: [
      {
        id: 'http',
        kind: 'httpRequest',
        method: 'POST',
        url: { kind: 'expr', expr: '"https://api.example.com/messages"' },
        headers: [{ name: 'Authorization', value: { kind: 'env', name: 'MESSAGES_API_TOKEN' } }],
        body: { kind: 'expr', expr: 'message' },
        resultName: 'remote'
      },
      { id: 'return', kind: 'return', valueExpr: 'remote', status: 201 }
    ]
  }
]

function compileServer(action: ActionDef, workflows = WORKFLOWS, withSupabase = true) {
  const graph = makeSceneGraph('Server')
  graph.updateNode(graph.rootId, {
    ...(withSupabase ? { lowcodeSupabaseConfig: SUPABASE } : {}),
    lowcodeServerWorkflows: workflows
  })
  const pageId = firstPageId(graph)
  graph.createNode('BUTTON', pageId, {
    interactiveProps: { text: 'Run' },
    events: { onClick: [action] }
  })
  return {
    graph,
    pageId,
    output: compile({ graph, pageIds: [pageId], options: withDefaults() })
  }
}

describe('compiler server workflows', () => {
  test('lifts validated server IR and emits client + separately deployable secure artifacts', () => {
    const { graph, pageId, output } = compileServer({
      id: 'invoke',
      kind: 'invokeServerWorkflow',
      workflowId: 'send-message',
      args: { message: '"hello"' },
      resultName: 'serverResult',
      onSuccess: [{ id: 'toast', kind: 'toast', messageExpr: 'serverResult.message' }]
    })

    const ir = collectTree(graph, pageId)
    expect(ir.serverWorkflows?.[0]?.actions[0]?.kind).toBe('httpRequest')
    const app = output.files.get('src/App.tsx') as string
    expect(app).toContain("import { invokeServerWorkflow } from './_lowcode_server'")
    expect(app).toContain('const serverResult = await invokeServerWorkflow("send-message"')
    expect(app).toContain('__opToast(serverResult.message)')
    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(app)).not.toThrow()

    const client = output.files.get('src/_lowcode_server.ts') as string
    expect(client).toContain("getSupabaseClient().functions.invoke('openpencil-runtime'")
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(client)).not.toThrow()
    const edge = output.files.get('supabase/functions/openpencil-runtime/index.ts') as string
    expect(edge).toContain("request.method !== 'POST'")
    expect(edge).toContain("request.method === 'OPTIONS'")
    expect(edge).toContain(
      "'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type'"
    )
    expect(edge).toContain('supabase.auth.getUser(token)')
    expect(edge).toContain("redirect: 'manual'")
    expect(edge).toContain('MAX_REQUEST_BYTES')
    expect(edge).toContain('MAX_RESPONSE_BYTES')
    expect(edge).not.toContain('service_role')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(edge)).not.toThrow()
    expect(output.files.get('.env.server.example') as string).toContain('MESSAGES_API_TOKEN=')
    expect(output.files.has('openpencil-server.manifest.json')).toBe(true)
    expect(output.files.has('SERVER_DEPLOYMENT.md')).toBe(true)
  })

  test('invalid root data is omitted with one generic, secret-free warning', () => {
    const secret = ['sk_', 'live_51EXAMPLE_REDACTED_VALUE'].join('')
    const invalid: ServerWorkflowDef[] = [
      {
        ...WORKFLOWS[0],
        actions: [
          {
            id: 'http',
            kind: 'httpRequest',
            method: 'GET',
            url: { kind: 'expr', expr: `"https://example.com/${secret}"` }
          }
        ]
      }
    ]
    const { output } = compileServer(
      {
        id: 'invoke',
        kind: 'invokeServerWorkflow',
        workflowId: 'send-message',
        args: { message: '"hello"' }
      },
      invalid
    )
    expect(output.files.has('supabase/functions/openpencil-runtime/index.ts')).toBe(false)
    const warning = output.warnings.find((item) => item.code === 'server-workflows-invalid')
    expect(warning?.message).toBe(
      'Server workflows are invalid and were omitted from generated output.'
    )
    expect(JSON.stringify(output.warnings)).not.toContain(secret)
  })

  test('requires valid client Supabase configuration before emitting runtime artifacts', () => {
    const { output } = compileServer(
      {
        id: 'invoke',
        kind: 'invokeServerWorkflow',
        workflowId: 'send-message',
        args: { message: '"hello"' }
      },
      WORKFLOWS,
      false
    )
    expect(output.files.has('src/_lowcode_server.ts')).toBe(false)
    expect(
      output.warnings.some((item) => item.code === 'server-workflows-supabase-config-required')
    ).toBe(true)
  })

  test('drops a client invocation unless argument names exactly match the target workflow', () => {
    const { output } = compileServer({
      id: 'invoke',
      kind: 'invokeServerWorkflow',
      workflowId: 'send-message',
      args: { wrong: '"hello"' }
    })
    expect(output.files.get('src/App.tsx') as string).not.toContain('invokeServerWorkflow(')
    expect(
      output.warnings.some((item) => item.code === 'action-invoke-server-workflow-args-mismatch')
    ).toBe(true)
  })
})
