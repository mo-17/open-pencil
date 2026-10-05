import { describe, expect, test } from 'bun:test'

import {
  auditApplicationRuntime,
  resolveApplicationRuntimeSupabaseConfig
} from '@open-pencil/lowcode/application-runtime'
import { SceneGraph } from '@open-pencil/scene-graph'

const TRIGGER = { kind: 'http', method: 'POST', auth: 'supabase-user' } as const

function configuredGraph(): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: 'app'
    }
  })
  return graph
}

describe('resolveApplicationRuntimeSupabaseConfig', () => {
  for (const scenario of [
    { designProtocol: 'http', runtimeProtocol: 'https', ready: true },
    { designProtocol: 'https', runtimeProtocol: 'http', ready: false }
  ]) {
    test(`audits a ${scenario.designProtocol} to ${scenario.runtimeProtocol} override without table usage`, () => {
      const graph = configuredGraph()
      graph.updateNode(graph.rootId, {
        lowcodeSupabaseConfig: {
          url: `${scenario.designProtocol}://example.supabase.co`,
          anonKey: 'sb_publishable_example',
          schema: 'app'
        }
      })
      const effectiveSupabaseConfig = resolveApplicationRuntimeSupabaseConfig(graph, {
        url: `${scenario.runtimeProtocol}://production.supabase.co`
      })
      expect(effectiveSupabaseConfig).toEqual({
        url: `${scenario.runtimeProtocol}://production.supabase.co`,
        anonKey: 'sb_publishable_example',
        schema: 'app'
      })

      const report = auditApplicationRuntime(graph, {
        environment: 'production',
        effectiveSupabaseConfig
      })
      expect(report.ready).toBe(scenario.ready)
      expect(report.usesSupabase).toBe(false)
      expect(report.rlsRequirements).toEqual([])
      expect(report.issues.map((issue) => issue.code)).toEqual(
        scenario.ready ? [] : ['supabase-production-https-required']
      )
      expect(report.backendDeploymentVerified).toBe(false)
      expect(report.backendDeploymentRequired).toBe(true)
    })
  }

  for (const invalid of [
    { name: 'non-HTTP URL', url: 'file:///supabase', anonKey: 'sb_publishable_example' },
    { name: 'empty public key', url: 'https://example.supabase.co', anonKey: ' ' }
  ]) {
    test(`preserves the invalid design object for audit when overrides replace its ${invalid.name}`, () => {
      const graph = configuredGraph()
      const designConfig = { url: invalid.url, anonKey: invalid.anonKey, schema: 'app' }
      graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: designConfig })
      const storedConfig = graph.getNode(graph.rootId)?.lowcodeSupabaseConfig
      if (!storedConfig) throw new Error('Expected Supabase configuration in the graph fixture')
      const effectiveSupabaseConfig = resolveApplicationRuntimeSupabaseConfig(graph, {
        url: 'https://production.supabase.co',
        anonKey: 'sb_publishable_production',
        schema: 'public'
      })
      expect(effectiveSupabaseConfig).toBe(storedConfig)
      expect(effectiveSupabaseConfig).toEqual(designConfig)

      const report = auditApplicationRuntime(graph, {
        environment: 'production',
        effectiveSupabaseConfig
      })
      expect(report.ready).toBe(false)
      expect(report.issues.map((issue) => issue.code)).toEqual(['supabase-config-invalid'])
      expect(report.backendDeploymentVerified).toBe(false)
      expect(report.backendDeploymentRequired).toBe(true)
    })
  }

  test('preserves omitted schema and public defaults without mutating frozen inputs', () => {
    const graph = configuredGraph()
    const designConfig = Object.freeze({
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example'
    })
    const overrides = Object.freeze({ url: 'https://production.supabase.co' })
    graph.updateNode(graph.rootId, { lowcodeSupabaseConfig: designConfig })

    const effectiveSupabaseConfig = resolveApplicationRuntimeSupabaseConfig(graph, overrides)
    expect(effectiveSupabaseConfig).toEqual({
      url: 'https://production.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: undefined
    })
    expect(effectiveSupabaseConfig).not.toBe(designConfig)
    expect(resolveApplicationRuntimeSupabaseConfig(graph)).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: undefined
    })
    expect(graph.getNode(graph.rootId)?.lowcodeSupabaseConfig).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example'
    })
    expect(overrides).toEqual({ url: 'https://production.supabase.co' })
  })
})

describe('auditApplicationRuntime', () => {
  test('blocks a Supabase-bound list when no effective public config exists', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('LIST', page.id, {
      interactiveProps: {
        dataSourceRef: {
          kind: 'supabaseQuery',
          query: { table: 'products' }
        }
      }
    })

    const effectiveSupabaseConfig = resolveApplicationRuntimeSupabaseConfig(graph, {
      url: 'https://production.supabase.co',
      anonKey: 'sb_publishable_production'
    })
    expect(effectiveSupabaseConfig).toBeNull()
    const report = auditApplicationRuntime(graph, { effectiveSupabaseConfig })
    expect(report.ready).toBe(false)
    expect(report.usesSupabase).toBe(true)
    expect(report.backendDeploymentVerified).toBe(false)
    expect(report.backendDeploymentRequired).toBe(true)
    expect(report.issues.map((issue) => issue.code)).toContain('supabase-config-required')
    expect(report.rlsRequirements).toEqual([
      {
        schema: 'public',
        table: 'products',
        commands: ['SELECT'],
        needsWriteWarning: false
      }
    ])
  })

  test('treats a client server-workflow invocation as Supabase runtime usage', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('BUTTON', page.id, {
      events: {
        onClick: [
          {
            id: 'invoke-missing-workflow',
            kind: 'invokeServerWorkflow',
            workflowId: 'missing-workflow',
            args: {},
            resultName: 'result'
          }
        ]
      }
    })

    const report = auditApplicationRuntime(graph)
    expect(report.usesSupabase).toBe(true)
    expect(report.ready).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('supabase-config-required')
  })

  test('reports server environment, deployment, schema, and production RLS prerequisites', () => {
    const graph = configuredGraph()
    graph.updateNode(graph.rootId, {
      lowcodeServerWorkflows: [
        {
          id: 'sync-order',
          name: 'Sync order',
          trigger: TRIGGER,
          params: ['orderId'],
          actions: [
            {
              id: 'load-order',
              kind: 'supabaseQuery',
              table: 'orders',
              filters: [{ column: 'id', op: 'eq', valueExpr: 'orderId' }],
              resultName: 'order'
            },
            {
              id: 'notify',
              kind: 'httpRequest',
              method: 'POST',
              url: { kind: 'env', name: 'ORDER_WEBHOOK_URL' },
              headers: [{ name: 'Authorization', value: { kind: 'env', name: 'ORDER_TOKEN' } }],
              body: { kind: 'expr', expr: 'order' }
            },
            { id: 'done', kind: 'return', valueExpr: 'order' }
          ]
        }
      ]
    })

    const report = auditApplicationRuntime(graph, {
      environment: 'production',
      knownTables: ['orders']
    })
    expect(report.ready).toBe(true)
    expect(report.serverWorkflowCount).toBe(1)
    expect(report.backendDeploymentVerified).toBe(false)
    expect(report.backendDeploymentRequired).toBe(true)
    expect(report.requiredServerEnvironment).toEqual(['ORDER_TOKEN', 'ORDER_WEBHOOK_URL'])
    expect(report.rlsRequirements).toEqual([
      {
        schema: 'app',
        table: 'orders',
        commands: ['SELECT'],
        needsWriteWarning: false
      }
    ])
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'rls-verification-required',
      'server-workflows-deploy-required',
      'server-environment-required'
    ])

    const deployedReport = auditApplicationRuntime(graph, {
      environment: 'production',
      knownTables: ['orders'],
      serverWorkflowsDeployed: true
    })
    expect(deployedReport.backendDeploymentVerified).toBe(false)
    expect(deployedReport.backendDeploymentRequired).toBe(true)
    expect(deployedReport.issues.map((issue) => issue.code)).not.toContain(
      'server-workflows-deploy-required'
    )

    const verifiedReport = auditApplicationRuntime(graph, {
      environment: 'production',
      knownTables: ['orders'],
      backendDeploymentVerified: true
    })
    expect(verifiedReport.backendDeploymentVerified).toBe(true)
    expect(verifiedReport.backendDeploymentRequired).toBe(false)
    expect(verifiedReport.issues.map((issue) => issue.code)).not.toContain(
      'server-workflows-deploy-required'
    )
  })

  test('requires exact backend verification for declared schema, data, RLS, and storage without workflows', () => {
    const schemaOnly = auditApplicationRuntime(configuredGraph())
    expect(schemaOnly.usesSupabase).toBe(false)
    expect(schemaOnly.serverWorkflowCount).toBe(0)
    expect(schemaOnly.backendDeploymentVerified).toBe(false)
    expect(schemaOnly.backendDeploymentRequired).toBe(true)

    const graph = configuredGraph()
    const page = graph.getPages()[0]
    graph.createNode('LIST', page.id, {
      interactiveProps: {
        dataSourceRef: {
          kind: 'supabaseQuery',
          query: { table: 'products' }
        }
      }
    })
    graph.createNode('INPUT', page.id, {
      interactiveProps: { upload: { bucket: 'attachments' } }
    })

    const unverified = auditApplicationRuntime(graph, {
      environment: 'production',
      knownTables: ['products'],
      rlsVerified: true
    })
    expect(unverified.ready).toBe(true)
    expect(unverified.usesSupabase).toBe(true)
    expect(unverified.serverWorkflowCount).toBe(0)
    expect(unverified.backendDeploymentVerified).toBe(false)
    expect(unverified.backendDeploymentRequired).toBe(true)
    expect(unverified.rlsRequirements).toEqual([
      {
        schema: 'app',
        table: 'products',
        commands: ['SELECT'],
        needsWriteWarning: false
      },
      {
        schema: 'storage',
        table: 'objects',
        commands: ['SELECT', 'INSERT', 'UPDATE'],
        needsWriteWarning: true,
        storageBucket: 'attachments'
      }
    ])

    const verified = auditApplicationRuntime(graph, {
      environment: 'production',
      knownTables: ['products'],
      rlsVerified: true,
      backendDeploymentVerified: true
    })
    expect(verified.backendDeploymentVerified).toBe(true)
    expect(verified.backendDeploymentRequired).toBe(false)
  })

  test('requires backend verification for a provider-neutral declaration without legacy Supabase usage', () => {
    const graph = new SceneGraph()
    const unverified = auditApplicationRuntime(graph, { backendProviderDeclared: true })

    expect(unverified.ready).toBe(true)
    expect(unverified.usesSupabase).toBe(false)
    expect(unverified.serverWorkflowCount).toBe(0)
    expect(unverified.backendDeploymentVerified).toBe(false)
    expect(unverified.backendDeploymentRequired).toBe(true)

    const verified = auditApplicationRuntime(graph, {
      backendProviderDeclared: true,
      backendDeploymentVerified: true
    })
    expect(verified.backendDeploymentVerified).toBe(true)
    expect(verified.backendDeploymentRequired).toBe(false)
  })

  test('fails closed on invalid server workflow data without echoing a secret', () => {
    const graph = configuredGraph()
    const secret = ['sb_', 'secret_NEVER_REPORT_123'].join('')
    graph.updateNode(graph.rootId, {
      lowcodeServerWorkflows: [
        {
          id: 'invalid',
          name: 'Invalid',
          trigger: TRIGGER,
          actions: [{ id: 'return', kind: 'return', valueExpr: JSON.stringify(secret) }]
        }
      ]
    })

    const report = auditApplicationRuntime(graph)
    expect(report.ready).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('server-workflows-invalid')
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  test('rejects unsafe production config and flags catalog table mismatches', () => {
    const graph = configuredGraph()
    const page = graph.getPages()[0]
    graph.createNode('LIST', page.id, {
      interactiveProps: {
        dataSourceRef: {
          kind: 'supabaseQuery',
          query: { table: 'missing_table' }
        }
      }
    })

    const report = auditApplicationRuntime(graph, {
      environment: 'production',
      effectiveSupabaseConfig: {
        url: 'http://user:password@example.supabase.co',
        anonKey: 'sb_publishable_example',
        schema: 'bad schema'
      },
      knownTables: ['products'],
      rlsVerified: true
    })
    expect(report.ready).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'supabase-config-invalid',
      'supabase-production-https-required',
      'supabase-schema-invalid',
      'supabase-table-unverified'
    ])
  })
})
