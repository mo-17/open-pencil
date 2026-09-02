import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { DeployCLIResult } from '@/app/lowcode/preview-pane/deploy/command'
import { auditDeployRuntime } from '@/app/lowcode/preview-pane/deploy/runtime-preflight'
import {
  BACKEND_DEPLOYMENT_REQUIRED_NOTICE,
  deployCompletionStatus
} from '@/app/lowcode/preview-pane/deploy/use'

const STATIC_RESULT: DeployCLIResult = {
  provider: 'vercel',
  environment: 'preview',
  url: 'https://static.example.test',
  deployId: 'deploy-static',
  fileCount: 4
}

function dataBackendGraph(): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: 'public'
    }
  })
  graph.createNode('LIST', graph.getPages()[0].id, {
    interactiveProps: {
      dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
    }
  })
  return graph
}

describe('legacy desktop deploy completion', () => {
  test('preserves the static URL but reports partial until backend evidence is verified', () => {
    const graph = dataBackendGraph()
    const unverified = auditDeployRuntime({
      graph,
      environment: 'preview',
      knownTables: ['products']
    })
    const partial = deployCompletionStatus(STATIC_RESULT, unverified)

    expect(partial).toMatchObject({
      kind: 'frontend-deployed',
      url: STATIC_RESULT.url,
      result: STATIC_RESULT,
      backendDeploymentRequired: true,
      notice: BACKEND_DEPLOYMENT_REQUIRED_NOTICE
    })

    const verified = auditDeployRuntime({
      graph,
      environment: 'preview',
      knownTables: ['products'],
      backendDeploymentVerified: true
    })
    expect(deployCompletionStatus(STATIC_RESULT, verified)).toEqual({
      kind: 'done',
      url: STATIC_RESULT.url,
      result: STATIC_RESULT
    })
  })

  test('keeps frontend-only documents compatible with the existing done status', () => {
    const audit = auditDeployRuntime({ graph: new SceneGraph(), environment: 'preview' })
    expect(audit.backendDeploymentRequired).toBe(false)
    expect(deployCompletionStatus(STATIC_RESULT, audit).kind).toBe('done')
  })

  test('renders partial deployment separately from complete application success', async () => {
    const source = await Bun.file('src/app/lowcode/preview-pane/DeployControls.vue').text()
    expect(source).toContain("status.kind === 'frontend-deployed'")
    expect(source).toContain('data-test-id="lowcode-deploy-frontend-only"')
    expect(source).toContain('Static frontend deployed — backend verification required.')
    expect(source).toContain('✓ Application deployed —')
  })

  test('wires the legacy Desktop path through live Backend Provider build checks', async () => {
    const source = await Bun.file('src/app/lowcode/preview-pane/deploy/use.ts').text()
    expect(source).toContain('prepareAppBackendProviderDocumentBuild')
    expect(source).toContain('backendProviderDeclared: backendBuild !== null')
    expect(source).toContain('sameBackendBuild(backendBuild, dispatchBackendBuild)')
    expect(source.indexOf('dispatchBackendBuild')).toBeLessThan(
      source.indexOf('const result = await runDeployCLI')
    )
  })
})
