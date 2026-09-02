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

const PUBLIC_KEY_WORKFLOWS: ServerWorkflowDef[] = [
  {
    id: 'public-key-check',
    name: 'Public key check',
    trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
    params: [],
    actions: [{ id: 'return', kind: 'return', valueExpr: '"ok"', status: 200 }]
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
    output: compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ backendCompilationMode: 'source-only-prototype' })
    })
  }
}

async function executeGeneratedEdgePublicKey(
  edge: string,
  environment: Readonly<Record<string, string | undefined>>
): Promise<{ status: number; body: string; key: string | undefined }> {
  type EdgeHandler = (request: Request) => Promise<Response>
  let handler: EdgeHandler | undefined
  let key: string | undefined
  const source = edge.replace(/^import .*\n\n/u, '')
  const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source)
  const execute = new Function('Deno', 'createClient', javascript) as (
    deno: unknown,
    createClient: (url: string, publicKey: string) => unknown
  ) => void
  execute(
    {
      env: { get: (name: string) => environment[name] },
      serve: (candidate: EdgeHandler) => {
        handler = candidate
      }
    },
    (_url, publicKey) => {
      key = publicKey
      return {
        auth: {
          getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null })
        }
      }
    }
  )
  if (!handler) throw new Error('Generated Edge handler was not registered')
  const response = await handler(
    new Request('https://example.supabase.co/functions/v1/openpencil-runtime', {
      method: 'POST',
      headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({ workflowId: 'public-key-check', args: {} })
    })
  )
  return { status: response.status, body: await response.text(), key }
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
    expect(edge).toContain("Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')")
    expect(edge).toContain('parsed.default')
    expect(edge).toContain('requiredSupabasePublicKey()')
    expect(edge).toContain("requiredEnvironment('SUPABASE_ANON_KEY')")
    expect(edge).toContain("redirect: 'manual'")
    expect(edge).toContain('MAX_REQUEST_BYTES')
    expect(edge).toContain('MAX_RESPONSE_BYTES')
    expect(edge).not.toContain('service_role')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(edge)).not.toThrow()
    const serverEnv = output.files.get('.env.server.example') as string
    expect(serverEnv).toContain('# SUPABASE_PUBLISHABLE_KEYS={"default":"sb_publishable_..."}')
    expect(serverEnv).not.toContain('\nSUPABASE_PUBLISHABLE_KEYS=')
    expect(serverEnv).toContain('# SUPABASE_ANON_KEY=')
    expect(serverEnv).toContain('MESSAGES_API_TOKEN=')
    const manifest = JSON.parse(output.files.get('openpencil-server.manifest.json') as string)
    expect(manifest.environment).toContain('SUPABASE_PUBLISHABLE_KEYS')
    expect(manifest.environment).not.toContain('SUPABASE_ANON_KEY')
    expect(manifest.legacyEnvironmentFallbacks).toEqual({
      SUPABASE_PUBLISHABLE_KEYS: 'SUPABASE_ANON_KEY'
    })
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

  test('executes the generated publishable-key resolver with strict new-first fallback rules', async () => {
    const { output } = compileServer(
      { id: 'invoke', kind: 'invokeServerWorkflow', workflowId: 'public-key-check', args: {} },
      PUBLIC_KEY_WORKFLOWS
    )
    const edge = output.files.get('supabase/functions/openpencil-runtime/index.ts') as string
    const legacyAnon = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature'

    await expect(
      executeGeneratedEdgePublicKey(edge, {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_current' }),
        SUPABASE_ANON_KEY: legacyAnon
      })
    ).resolves.toEqual({ status: 200, body: '"ok"', key: 'sb_publishable_current' })
    await expect(
      executeGeneratedEdgePublicKey(edge, {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: legacyAnon
      })
    ).resolves.toEqual({ status: 200, body: '"ok"', key: legacyAnon })

    for (const [publishableKeys, legacyKey] of [
      ['', legacyAnon],
      ['not-json', legacyAnon],
      ['[]', legacyAnon],
      [JSON.stringify({}), legacyAnon],
      [JSON.stringify({ default: 'sb_secret_never_use' }), legacyAnon],
      [JSON.stringify({ default: 'sb_publishable_current' }), 'sb_secret_stale']
    ] as const) {
      const result = await executeGeneratedEdgePublicKey(edge, {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_PUBLISHABLE_KEYS: publishableKeys,
        SUPABASE_ANON_KEY: legacyKey
      })
      expect(result.status).toBe(500)
      expect(result.body).toBe('{"error":"Server workflow failed."}')
      if (publishableKeys) expect(result.body).not.toContain(publishableKeys)
      expect(result.body).not.toContain(legacyKey)
    }
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
