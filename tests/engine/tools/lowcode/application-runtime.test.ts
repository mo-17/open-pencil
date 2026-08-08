import { describe, expect, test } from 'bun:test'

import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS, CORE_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

function tool() {
  const found = ALL_TOOLS.find((candidate) => candidate.name === 'audit_application_runtime')
  if (!found) throw new Error('audit_application_runtime tool is not registered')
  return found
}

describe('audit_application_runtime tool', () => {
  test('is available to built-in AI and MCP and reports a secret-free readiness audit', () => {
    const graph = new SceneGraph()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://project.supabase.co',
        anonKey: 'sb_publishable_example',
        schema: 'app'
      },
      lowcodeServerWorkflows: [
        {
          id: 'list-orders',
          name: 'List orders',
          trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
          actions: [
            {
              id: 'query-orders',
              kind: 'supabaseQuery',
              table: 'orders',
              resultName: 'orders'
            },
            { id: 'return-orders', kind: 'return', valueExpr: 'orders' }
          ]
        }
      ]
    })
    const result = tool().execute(new FigmaAPI(graph), {
      environment: 'production',
      known_tables: ['orders']
    }) as { ok: true; data: { ready: boolean; issues: { code: string }[] } }

    expect(CORE_TOOLS.some((candidate) => candidate.name === 'audit_application_runtime')).toBe(
      true
    )
    expect(result.ok).toBe(true)
    expect(result.data.ready).toBe(true)
    expect(result.data.issues.map((issue) => issue.code)).toEqual([
      'rls-verification-required',
      'server-workflows-deploy-required'
    ])
    expect(JSON.stringify(result)).not.toContain('sb_publishable_example')
  })

  test('rejects an unknown target environment when called without schema coercion', () => {
    const result = tool().execute(new FigmaAPI(new SceneGraph()), { environment: 'qa' })
    expect(result).toEqual({
      ok: false,
      error: 'Unknown application runtime environment "qa"'
    })
  })
})
