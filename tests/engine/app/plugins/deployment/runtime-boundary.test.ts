import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { VERCEL_DEPLOYMENT_PLUGIN } from '@/app/plugins/host/deployment/contract'
import {
  createDeploymentPluginHostAdapter,
  DeploymentPluginError,
  type DeploymentPluginRunner
} from '@/app/plugins/host/deployment/provider'
import {
  clearDeploymentPluginSession,
  deploymentPluginSessionSnapshot,
  runDeploymentPluginSession
} from '@/app/plugins/host/deployment/session'

function editor(graph: SceneGraph, path: string): EditorStore {
  return {
    graph,
    getDocumentPath: () => path,
    getSourceIdentity: () => ({ handle: null, path }),
    getStorageBinding: () => null
  } as EditorStore
}

function successfulRunner(calls: unknown[][]): DeploymentPluginRunner {
  return async (...args) => {
    calls.push(args)
    return {
      provider: args[2],
      environment: args[3],
      url: 'https://vercel.example/deploy',
      deployId: 'deploy_123',
      fileCount: 4
    }
  }
}

function graphWithUnconfiguredSupabaseList(): SceneGraph {
  const graph = new SceneGraph()
  graph.createNode('LIST', graph.getPages()[0].id, {
    interactiveProps: {
      dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
    }
  })
  return graph
}

function graphWithServerWorkflow(): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: 'public'
    },
    lowcodeServerWorkflows: [
      {
        id: 'sync-order',
        name: 'Sync order',
        trigger: { kind: 'http', method: 'POST', auth: 'supabase-user' },
        params: [],
        actions: [{ id: 'done', kind: 'return', valueExpr: 'true' }]
      }
    ]
  })
  return graph
}

function graphWithDataOnlyBackend(): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    lowcodeSupabaseConfig: {
      url: 'https://example.supabase.co',
      anonKey: 'sb_publishable_example',
      schema: 'app'
    }
  })
  graph.createNode('LIST', graph.getPages()[0].id, {
    interactiveProps: {
      dataSourceRef: { kind: 'supabaseQuery', query: { table: 'products' } }
    }
  })
  return graph
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof DeploymentPluginError ? error.code : undefined
  }
}

describe('desktop deployment application-runtime boundary', () => {
  test('runs the shared preflight before reading credentials or dispatching', async () => {
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'secret-token'
        }
      },
      successfulRunner(runnerCalls)
    )
    const store = editor(graphWithUnconfiguredSupabaseList(), '/tmp/invalid-runtime.fig')

    expect(
      await errorCode(
        adapter.execute(
          store,
          {},
          {
            confirm: async () => true,
            expectedReview: adapter.review(store, {})
          }
        )
      )
    ).toBe('runtime-preflight-failed')
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
  })

  test('returns backendDeploymentRequired without relying on a CLI server notice', async () => {
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      { resolve: async () => 'token' },
      successfulRunner(runnerCalls)
    )
    const store = editor(graphWithServerWorkflow(), '/tmp/server-workflow.fig')

    const result = await adapter.execute(
      store,
      {},
      {
        confirm: async () => true,
        expectedReview: adapter.review(store, {})
      }
    )

    expect(runnerCalls).toHaveLength(1)
    expect(result).toMatchObject({
      url: 'https://vercel.example/deploy',
      backendDeploymentRequired: true
    })
    expect(result).not.toHaveProperty('serverDeploymentRequired')
  })

  test('keeps a data-only Supabase frontend deploy partial without backend evidence', async () => {
    const pluginId = 'test.deployment.data-only'
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      { resolve: async () => 'token' },
      successfulRunner(runnerCalls)
    )
    const store = editor(graphWithDataOnlyBackend(), '/tmp/data-only.fig')

    const completion = await runDeploymentPluginSession({
      pluginId,
      documentScope: 'data-only-scope',
      documentLabel: 'data-only.fig',
      operation: async () => ({
        result: await adapter.execute(
          store,
          {},
          {
            confirm: async () => true,
            expectedReview: adapter.review(store, {})
          }
        )
      })
    })

    expect(runnerCalls).toHaveLength(1)
    expect(completion.result.backendDeploymentRequired).toBe(true)
    expect(deploymentPluginSessionSnapshot.value[pluginId]).toMatchObject({
      status: 'frontend-deployed',
      result: { backendDeploymentRequired: true }
    })
    expect(deploymentPluginSessionSnapshot.value[pluginId]?.status).not.toBe('succeeded')
    clearDeploymentPluginSession(pluginId)
  })
})
