import { describe, expect, test } from 'bun:test'

import type { BackendApplicationSpecV1, BackendReleaseStateV1 } from '@open-pencil/lowcode/backend'
import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBackendProviderDescriptor,
  type AppBackendProviderHostStore,
  type AppBundlePluginCatalogEntry,
  type InstalledPluginBackendProvider
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  appBackendProviderDocumentValue,
  listAppBackendProviderDescriptors
} from '@/app/plugins/host/backend-provider'
import { VERCEL_DEPLOYMENT_PLUGIN } from '@/app/plugins/host/deployment/contract'
import {
  createDesktopDeploymentPluginHostAdapter,
  createDeploymentPluginHostAdapter,
  DeploymentPluginError,
  type DeploymentPluginRunner
} from '@/app/plugins/host/deployment/provider'
import {
  clearDeploymentPluginSession,
  deploymentPluginSessionSnapshot,
  runDeploymentPluginSession
} from '@/app/plugins/host/deployment/session'

const ENGINE_VERSION = '0.13.2'

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') {
    throw new Error('Missing bundled Supabase backend provider')
  }
  return entry
}

async function activeProviderStore() {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: ENGINE_VERSION
  })
  const snapshot = await store.load()
  if (snapshot.error) throw snapshot.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  const installed = store.installedBackendProviders()[0]
  if (!descriptor || !installed) throw new Error('Expected active Backend Provider')
  return { descriptor, installed, store }
}

function backendApplication(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'provider-deployment',
    dataModel: {
      version: 1,
      entities: [
        {
          id: 'notes',
          name: 'notes',
          management: 'managed',
          fields: [
            { id: 'id', name: 'id', type: 'uuid', nullable: false },
            { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
            { id: 'title', name: 'title', type: 'string', nullable: true }
          ],
          primaryKey: { fields: ['id'] }
        }
      ],
      enums: [],
      relations: []
    },
    auth: {
      version: 1,
      identities: [{ id: 'user', kind: 'user' }],
      roles: [],
      ownership: [{ id: 'note-owner', entityId: 'notes', identityFieldId: 'owner_id' }],
      tenants: [],
      rowAccess: [
        {
          id: 'owner-access',
          entityId: 'notes',
          effect: 'allow',
          operations: ['select', 'insert', 'update', 'delete'],
          principal: { kind: 'owner', ownershipId: 'note-owner' }
        }
      ]
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [
      { capability: 'auth.identity', required: true },
      { capability: 'data.read', required: true },
      { capability: 'data.write', required: true },
      { capability: 'migrations.schema', required: true },
      { capability: 'policy.row-level', required: true }
    ],
    secrets: []
  }
}

function graphWithRequest(
  selection: AppBackendProviderDescriptor,
  application: unknown = backendApplication()
): SceneGraph {
  const graph = new SceneGraph()
  const request = {
    format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
    selection,
    application
  }
  graph.updateNode(graph.rootId, {
    pluginData: [
      {
        pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
        key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
        value: JSON.stringify(request)
      }
    ]
  })
  return graph
}

function validGraph(selection: AppBackendProviderDescriptor): SceneGraph {
  const graph = new SceneGraph()
  graph.updateNode(graph.rootId, {
    pluginData: [
      {
        pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
        key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
        value: appBackendProviderDocumentValue({
          format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
          selection,
          application: backendApplication()
        })
      }
    ]
  })
  return graph
}

function editor(graph: SceneGraph): EditorStore {
  const path = '/tmp/provider-deployment.fig'
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
      url: 'https://vercel.example/provider-deployment',
      deployId: 'deploy_provider',
      fileCount: 4
    }
  }
}

function changedInstalled(
  installed: InstalledPluginBackendProvider,
  change: (value: InstalledPluginBackendProvider) => void
): InstalledPluginBackendProvider {
  const value = structuredClone(installed)
  change(value)
  return value
}

function hostStore(installed: InstalledPluginBackendProvider): AppBackendProviderHostStore {
  return { installedBackendProviders: () => [structuredClone(installed)] }
}

function mutableHostStore(installed: InstalledPluginBackendProvider) {
  let current = structuredClone(installed)
  return {
    store: {
      installedBackendProviders: () => [structuredClone(current)]
    } satisfies AppBackendProviderHostStore,
    change(mutator: (value: InstalledPluginBackendProvider) => void) {
      current = changedInstalled(current, mutator)
    }
  }
}

function syncErrorCode(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (cause) {
    return cause instanceof DeploymentPluginError ? cause.code : undefined
  }
}

describe('Desktop Backend Provider deployment integration', () => {
  test('runs live host resolution and trusted plan/emit before a partial frontend session', async () => {
    const { descriptor, store } = await activeProviderStore()
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'frontend-token'
        }
      },
      successfulRunner(runnerCalls),
      undefined,
      store
    )
    const document = editor(validGraph(descriptor))
    const review = adapter.review(document, {})
    const releaseTransitions: BackendReleaseStateV1[] = []

    expect(review.backendProvider).toMatchObject({
      pluginId: descriptor.pluginId,
      providerId: descriptor.providerId,
      adapterId: descriptor.adapterId,
      packageDigest: descriptor.packageAuthority.packageDigest
    })
    expect(review.backendProvider?.applicationDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(review.backendProvider?.planDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(review.backendProvider?.manifestDigest).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])

    const pluginId = 'test.backend-provider.deployment'
    const completion = await runDeploymentPluginSession({
      pluginId,
      documentScope: 'provider-document',
      documentLabel: 'provider-deployment.fig',
      operation: async () => {
        let backendRelease: BackendReleaseStateV1 | undefined
        const result = await adapter.execute(
          document,
          {},
          {
            confirm: () => true,
            expectedReview: review,
            onBackendReleaseState: (state) => {
              releaseTransitions.push(state)
              backendRelease = state
            }
          }
        )
        return { result, ...(backendRelease ? { backendRelease } : {}) }
      }
    })

    expect(credentialCalls).toEqual(['resolve'])
    expect(runnerCalls).toHaveLength(1)
    expect(completion.result.backendDeploymentRequired).toBe(true)
    expect(deploymentPluginSessionSnapshot.value[pluginId]).toMatchObject({
      status: 'frontend-deployed',
      result: { backendDeploymentRequired: true },
      backendRelease: {
        phase: 'confirm',
        outcome: 'pending',
        dispatch: 'not-dispatched',
        applyReinspectionAccepted: false,
        backendDeploymentRequired: true,
        receipt: null
      }
    })
    expect(releaseTransitions.map(({ phase }) => phase)).toEqual([
      'inspect',
      'plan',
      'emit',
      'review',
      'confirm'
    ])
    expect(completion.backendRelease).toMatchObject({
      phase: 'confirm',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: true,
      reconcileRequired: false
    })
    expect(deploymentPluginSessionSnapshot.value[pluginId]?.status).not.toBe('succeeded')
    clearDeploymentPluginSession(pluginId)
  })

  test('limits Browser production wiring to trusted review plan/emit before credentials', async () => {
    const { descriptor, store } = await activeProviderStore()
    const credentialCalls: string[] = []
    const adapter = createDesktopDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'frontend-token'
        }
      },
      store
    )
    const document = editor(validGraph(descriptor))
    const review = adapter.review(document, {})

    expect(review.backendProvider).toMatchObject({
      providerId: descriptor.providerId,
      packageDigest: descriptor.packageAuthority.packageDigest
    })
    let error: unknown
    try {
      await adapter.execute(document, {}, { confirm: () => true, expectedReview: review })
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(DeploymentPluginError)
    expect((error as DeploymentPluginError).code).toBe('desktop-required')
    expect(credentialCalls).toEqual([])
  })

  test('records a secret-free cancellation receipt when Backend Release confirmation is denied', async () => {
    const { descriptor, store } = await activeProviderStore()
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'frontend-token'
        }
      },
      successfulRunner(runnerCalls),
      undefined,
      store
    )
    const document = editor(validGraph(descriptor))
    const review = adapter.review(document, {})
    const releaseTransitions: BackendReleaseStateV1[] = []

    let error: unknown
    try {
      await adapter.execute(
        document,
        {},
        {
          confirm: () => false,
          expectedReview: review,
          onBackendReleaseState: (state) => releaseTransitions.push(state)
        }
      )
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(DeploymentPluginError)
    expect((error as DeploymentPluginError).code).toBe('confirmation-denied')
    expect(releaseTransitions.at(-1)).toMatchObject({
      phase: 'receipt',
      outcome: 'cancelled',
      dispatch: 'not-dispatched',
      automaticRetryAllowed: false,
      reconcileRequired: false,
      receipt: {
        outcome: 'cancelled',
        backendDeploymentRequired: true,
        failure: { code: 'confirmation-denied', outcomeUnknown: false }
      }
    })
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
    expect(JSON.stringify(releaseTransitions.at(-1))).not.toContain('frontend-token')
  })

  test('fails a reviewed session when the provider is disabled before dispatch', async () => {
    const { descriptor, store } = await activeProviderStore()
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'frontend-token'
        }
      },
      successfulRunner(runnerCalls),
      undefined,
      store
    )
    const document = editor(validGraph(descriptor))
    const review = adapter.review(document, {})
    await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)

    const pluginId = 'test.backend-provider.disabled'
    let error: unknown
    try {
      await runDeploymentPluginSession({
        pluginId,
        documentScope: 'provider-document',
        documentLabel: 'provider-deployment.fig',
        operation: async () => ({
          result: await adapter.execute(
            document,
            {},
            {
              confirm: () => true,
              expectedReview: review
            }
          )
        })
      })
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(DeploymentPluginError)
    expect((error as DeploymentPluginError).code).toBe('backend-provider-unavailable')
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
    expect(deploymentPluginSessionSnapshot.value[pluginId]?.status).toBe('failed')
    clearDeploymentPluginSession(pluginId)
  })

  test('re-resolves lifecycle after credential await and blocks a late disable before network', async () => {
    const { descriptor, store } = await activeProviderStore()
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          await store.setEnabled(SUPABASE_BACKEND_PROVIDER_PLUGIN_ID, false)
          return 'frontend-token'
        }
      },
      successfulRunner(runnerCalls),
      undefined,
      store
    )
    const document = editor(validGraph(descriptor))
    const review = adapter.review(document, {})

    let error: unknown
    try {
      await adapter.execute(document, {}, { confirm: () => true, expectedReview: review })
    } catch (cause) {
      error = cause
    }

    expect(error).toBeInstanceOf(DeploymentPluginError)
    expect((error as DeploymentPluginError).code).toBe('backend-provider-unavailable')
    expect(credentialCalls).toEqual(['resolve'])
    expect(runnerCalls).toEqual([])
  })

  test('blocks package digest and exact declaration changes after credential await', async () => {
    const { descriptor, installed } = await activeProviderStore()
    const changes: Array<(value: InstalledPluginBackendProvider) => void> = [
      (value) => {
        ;(value.plugin.package as { digest: string }).digest =
          'app-bundle-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      },
      (value) => {
        ;(value.plugin.package.manifest.publisher as { keyId: string }).keyId = 'app-bundle-rotated'
      },
      (value) => {
        ;(value.contribution.configuration as { maxBytes: number }).maxBytes = 3
        if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
        const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
        if (!declared) throw new Error('Expected bundled Backend Provider declaration')
        ;(declared.configuration as { maxBytes: number }).maxBytes = 3
      }
    ]

    for (const change of changes) {
      const host = mutableHostStore(installed)
      const runnerCalls: unknown[][] = []
      const adapter = createDeploymentPluginHostAdapter(
        VERCEL_DEPLOYMENT_PLUGIN,
        {
          async resolve() {
            host.change(change)
            return 'frontend-token'
          }
        },
        successfulRunner(runnerCalls),
        undefined,
        host.store
      )
      const document = editor(validGraph(descriptor))
      const review = adapter.review(document, {})

      let error: unknown
      try {
        await adapter.execute(document, {}, { confirm: () => true, expectedReview: review })
      } catch (cause) {
        error = cause
      }

      expect(error).toBeInstanceOf(DeploymentPluginError)
      expect((error as DeploymentPluginError).code).toBe('backend-provider-unavailable')
      expect(runnerCalls).toEqual([])
    }
  })

  test('rejects blocked, digest-substituted, and unreviewed manifest adapters before credentials', async () => {
    const { descriptor, installed } = await activeProviderStore()
    const cases = [
      changedInstalled(installed, (value) => {
        ;(value.plugin as { blockedReason: string | null }).blockedReason = 'blocked by policy'
      }),
      changedInstalled(installed, (value) => {
        ;(value.plugin.package as { digest: string }).digest =
          'app-bundle-sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      }),
      changedInstalled(installed, (value) => {
        const adapterId = 'open-pencil.backend.unreviewed'
        ;(value.contribution as { adapterId: string }).adapterId = adapterId
        if (value.plugin.package.manifest.schemaVersion !== 2) throw new Error('Expected v2')
        const declared = value.plugin.package.manifest.contributions.backendProviders?.[0]
        ;(declared as { adapterId: string }).adapterId = adapterId
      })
    ]

    for (const installedCase of cases) {
      const credentialCalls: string[] = []
      const runnerCalls: unknown[][] = []
      const adapter = createDeploymentPluginHostAdapter(
        VERCEL_DEPLOYMENT_PLUGIN,
        {
          async resolve() {
            credentialCalls.push('resolve')
            return 'frontend-token'
          }
        },
        successfulRunner(runnerCalls),
        undefined,
        hostStore(installedCase)
      )

      expect(syncErrorCode(() => adapter.review(editor(validGraph(descriptor)), {}))).toBe(
        'backend-provider-unavailable'
      )
      expect(credentialCalls).toEqual([])
      expect(runnerCalls).toEqual([])
    }
  })

  test('rejects an invalid BackendApplicationSpec before credentials or network dispatch', async () => {
    const { descriptor, store } = await activeProviderStore()
    const invalidApplication = { ...backendApplication(), version: 2 }
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialCalls.push('resolve')
          return 'frontend-token'
        }
      },
      successfulRunner(runnerCalls),
      undefined,
      store
    )

    expect(
      syncErrorCode(() =>
        adapter.review(editor(graphWithRequest(descriptor, invalidApplication)), {})
      )
    ).toBe('backend-provider-request-invalid')
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
  })
})
