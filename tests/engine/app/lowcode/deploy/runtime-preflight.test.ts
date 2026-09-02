import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  auditDeployRuntime,
  preflightDeployRuntime,
  resolveEffectiveDeploySupabaseConfig
} from '@/app/lowcode/preview-pane/deploy/runtime-preflight'

function graphWithSupabaseList(config = true): SceneGraph {
  const graph = new SceneGraph()
  if (config) {
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://design.supabase.co',
        anonKey: 'sb_publishable_design',
        schema: 'public'
      }
    })
  }
  graph.createNode('LIST', graph.getPages()[0].id, {
    interactiveProps: {
      dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
    }
  })
  return graph
}

describe('deploy runtime preflight', () => {
  test('merges a complete public environment override through the shared preflight', async () => {
    const graph = graphWithSupabaseList()
    expect(
      resolveEffectiveDeploySupabaseConfig(graph, {
        supabaseUrl: 'https://staging.supabase.co',
        supabasePublishableKey: 'sb_publishable_staging',
        supabaseSchema: 'app'
      })
    ).toEqual({
      url: 'https://staging.supabase.co',
      anonKey: 'sb_publishable_staging',
      schema: 'app'
    })

    const report = auditDeployRuntime({
      graph,
      environment: 'staging',
      runtimeConfig: {
        supabaseUrl: 'https://staging.supabase.co',
        supabasePublishableKey: 'sb_publishable_staging',
        supabaseSchema: 'app'
      },
      knownTables: ['products']
    })
    expect(report.ready).toBe(true)
    expect(report.backendDeploymentVerified).toBe(false)
    expect(report.backendDeploymentRequired).toBe(true)
    expect(report.issues).toEqual([])
    expect(report.rlsRequirements[0]?.schema).toBe('app')

    const sharedReport = await preflightDeployRuntime({
      graph,
      environment: 'staging',
      runtimeConfig: {
        supabaseUrl: 'https://staging.supabase.co',
        supabasePublishableKey: 'sb_publishable_staging',
        supabaseSchema: 'app'
      },
      knownTables: ['products']
    })
    expect(sharedReport).toEqual(report)

    const verifiedReport = auditDeployRuntime({
      graph,
      environment: 'staging',
      runtimeConfig: {
        supabaseUrl: 'https://staging.supabase.co',
        supabasePublishableKey: 'sb_publishable_staging',
        supabaseSchema: 'app'
      },
      knownTables: ['products'],
      backendDeploymentVerified: true
    })
    expect(verifiedReport.backendDeploymentVerified).toBe(true)
    expect(verifiedReport.backendDeploymentRequired).toBe(false)
  })

  test('does not let overrides pretend an omitted compiler runtime exists', () => {
    const graph = graphWithSupabaseList(false)
    const report = auditDeployRuntime({
      graph,
      environment: 'production',
      runtimeConfig: {
        supabaseUrl: 'https://production.supabase.co',
        supabaseAnonKey: 'sb_publishable_production'
      }
    })

    expect(resolveEffectiveDeploySupabaseConfig(graph)).toBeNull()
    expect(report.ready).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('supabase-config-required')
  })

  test('marks a host-resolved provider-neutral backend as deployment-required', () => {
    const report = auditDeployRuntime({
      graph: new SceneGraph(),
      environment: 'staging',
      backendProviderDeclared: true
    })

    expect(report.ready).toBe(true)
    expect(report.usesSupabase).toBe(false)
    expect(report.backendDeploymentVerified).toBe(false)
    expect(report.backendDeploymentRequired).toBe(true)
  })

  test('blocks invalid design configuration even when an override looks valid', () => {
    const graph = graphWithSupabaseList()
    graph.updateNode(graph.rootId, {
      lowcodeSupabaseConfig: {
        url: 'https://design.supabase.co',
        anonKey: 'sb_secret_never_emit'
      }
    })

    const report = auditDeployRuntime({
      graph,
      environment: 'preview',
      runtimeConfig: {
        supabaseUrl: 'https://preview.supabase.co',
        supabaseAnonKey: 'sb_publishable_preview'
      }
    })
    expect(report.ready).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('supabase-config-invalid')
    expect(JSON.stringify(report)).not.toContain('sb_secret_never_emit')
  })

  test('surfaces production RLS and schema verification as explicit warnings', () => {
    const report = auditDeployRuntime({
      graph: graphWithSupabaseList(),
      environment: 'production'
    })
    expect(report.ready).toBe(true)
    expect(report.issues.map((issue) => issue.code)).toEqual([
      'supabase-schema-unverified',
      'rls-verification-required'
    ])
  })
})
