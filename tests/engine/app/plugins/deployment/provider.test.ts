import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import {
  CLOUDFLARE_DEPLOYMENT_PLUGIN,
  VERCEL_DEPLOYMENT_PLUGIN
} from '@/app/plugins/host/deployment/contract'
import {
  buildDeploymentPluginPlan,
  createDesktopDeploymentPluginHostAdapter,
  createDeploymentPluginHostAdapter,
  DEPLOYMENT_PLUGIN_DOCUMENT_LIMITS,
  DeploymentPluginError,
  parseDeploymentPluginParameters,
  type DeploymentPluginHostAdapter,
  type DeploymentPluginReview,
  type DeploymentPluginRunner
} from '@/app/plugins/host/deployment/provider'
import type { CredentialResolver } from '@/app/settings/credentials'

function editor(path = '/tmp/design.fig', graph = new SceneGraph()): EditorStore {
  return {
    graph,
    getDocumentPath: () => path,
    getSourceIdentity: () => ({ handle: null, path: path || null }),
    getStorageBinding: () => null
  } as EditorStore
}

function mutableEditor(initialPath: string): Readonly<{
  store: EditorStore
  setPath: (path: string) => void
}> {
  let path = initialPath
  return {
    store: {
      graph: new SceneGraph(),
      getDocumentPath: () => path,
      getSourceIdentity: () => ({ handle: null, path: path || null }),
      getStorageBinding: () => null
    } as EditorStore,
    setPath(value) {
      path = value
    }
  }
}

function expectedReview(
  adapter: DeploymentPluginHostAdapter,
  store: EditorStore,
  parameters: unknown = {}
): DeploymentPluginReview {
  return adapter.review(store, parameters)
}

function resolver(value: string | null, calls: string[] = []): CredentialResolver {
  return {
    async resolve(reference) {
      calls.push(`${reference.integrationId}/${reference.profileId}/${reference.field}`)
      return value
    }
  }
}

function successfulRunner(calls: unknown[][]): DeploymentPluginRunner {
  return async (...args) => {
    calls.push(args)
    return {
      provider: args[2],
      environment: args[3],
      url: `https://${args[2]}.example/deploy`,
      deployId: 'deploy_123',
      fileCount: 4
    }
  }
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (error) {
    return error instanceof DeploymentPluginError ? error.code : undefined
  }
}

describe('reviewed deployment plugin wrappers', () => {
  test('keeps tokens DOM-owned and executes the immutable reviewed UI snapshot', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginDeploymentControls.vue'
    ).text()
    expect(source).toContain('name="deployment-token"')
    expect(source).toContain('type="password"')
    expect(source).not.toContain('v-model="token"')
    expect(source).toContain("input.value = ''")
    expect(source.indexOf("input.value = ''")).toBeLessThan(
      source.indexOf('await appCredentialServices.manager.set')
    )
    expect(source).toContain('pendingParameters.value = reviewedParameters')
    expect(source).toContain('adapter.execute(editor, reviewedParameters')
    expect(source).toContain('hostReview = adapter.review(editor, reviewedParameters)')
    expect(source).toContain('expectedReview: reviewedDocument')
    expect(source).toContain('!pendingPlan?.documentSaved ||')
    expect(source).toContain('!pendingReview ||')
    expect(source).toContain(':disabled="unavailable || controlsBusy"')
    expect(source).toContain(':required="definition.ui.targetRequired"')
    expect(source).toContain("deploymentSession.value?.status === 'deploying'")
    expect(source).toContain("deploymentSession.value?.status === 'succeeded'")
    expect(source).toContain('runDeploymentPluginSession')
    expect(source).toContain('createDesktopDeploymentPluginHostAdapter')
    expect(source).toContain('appPluginStore')
    expect(source).toContain(':aria-busy="deploymentActive"')
    expect(source).not.toContain(':disabled="unavailable || !configured || controlsBusy"')
    expect(source).toContain('AI can create the plan, but cannot deploy directly.')
    expect(source).toContain('readDeployHistory')
  })

  test('declare opt-in, confirmation-gated authority without placing tokens in parameters', () => {
    for (const definition of [VERCEL_DEPLOYMENT_PLUGIN, CLOUDFLARE_DEPLOYMENT_PLUGIN]) {
      expect(definition.installation).toEqual({
        installedByDefault: false,
        enabledByDefault: false,
        mcpVisibility: 'installed-enabled-only'
      })
      expect(definition.authority.confirmation).toBe('every-invocation')
      expect(definition.authority.sideEffect).toBe('remote-deployment')
      expect(definition.authority.cancellation).toBe('before-dispatch-only')
      expect(definition.parameters.schema.properties).not.toHaveProperty('token')
      expect(definition.result.schema.properties).not.toHaveProperty('token')
      expect(definition.result.schema.properties).toHaveProperty('backendDeploymentRequired')
      expect(definition.result.schema.properties).not.toHaveProperty('serverDeploymentRequired')
      expect(definition.mcpSafePlan.permissions).toEqual(['document.read'])
      expect(definition.mcpSafePlan.description).toContain('without reading credentials')
    }
  })

  test('offers an MCP-safe, side-effect-free deployment plan', () => {
    const plan = buildDeploymentPluginPlan(
      editor('/Users/alice/private/design.fig'),
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        environment: 'staging',
        target: 'my-project'
      }
    )
    expect(plan).toMatchObject({
      provider: 'vercel',
      environment: 'staging',
      target: 'my-project',
      documentSaved: true,
      requiresConfirmation: true
    })
    expect(plan.sideEffects).toContain(
      'Create a new remote deployment that may become publicly reachable.'
    )
    expect(Object.keys(plan).sort()).toEqual(
      [
        'provider',
        'environment',
        'target',
        'documentSaved',
        'requiresConfirmation',
        'environmentNotice',
        'sideEffects'
      ].sort()
    )
    expect(plan).not.toHaveProperty('documentLabel')
    expect(plan).not.toHaveProperty('documentIdentity')
    expect(JSON.stringify(plan)).not.toContain('/Users/alice')
  })

  test('keeps the production adapter reviewable but blocks Browser execution before credentials', async () => {
    const credentialCalls: string[] = []
    const adapter = createDesktopDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('unused', credentialCalls),
      { installedBackendProviders: () => [] }
    )
    const store = editor()
    const review = adapter.review(store, {})

    expect(
      await errorCode(adapter.execute(store, {}, { confirm: () => true, expectedReview: review }))
    ).toBe('desktop-required')
    expect(credentialCalls).toEqual([])
  })

  test('returns a bounded host-private document review without exposing the absolute path', () => {
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('unused'),
      successfulRunner([])
    )
    const review = adapter.review(editor('/Users/alice/private/project.fig'), {
      environment: 'staging'
    })

    expect(review.documentLabel).toBe('project.fig')
    expect(Array.from(review.documentLabel)).toHaveLength(11)
    expect(review.documentIdentity.split('\0')).toHaveLength(2)
    for (const scope of review.documentIdentity.split('\0')) {
      expect(scope).toMatch(/^doc-sha256-[0-9a-f]{64}$/)
    }
    expect(review.documentLabel.length).toBeLessThanOrEqual(
      DEPLOYMENT_PLUGIN_DOCUMENT_LIMITS.maxLabelLength
    )
    expect(review.documentIdentity.length).toBeLessThanOrEqual(
      DEPLOYMENT_PLUGIN_DOCUMENT_LIMITS.maxIdentityLength
    )
    expect(JSON.stringify(review)).not.toContain('/Users/alice')

    const remoteReview = adapter.review(
      {
        getDocumentPath: () => '/Users/alice/private/project.fig',
        getSourceIdentity: () => ({
          handle: null,
          path: '/Users/alice/private/project.fig'
        }),
        getStorageBinding: () => ({
          providerId: 'google-drive',
          profileId: 'default',
          documentId: 'drive-file-123'
        })
      } as EditorStore,
      {}
    )
    expect(remoteReview.documentLabel).toBe('drive-file-123')
    expect(remoteReview.documentIdentity).not.toBe(review.documentIdentity)
    expect(JSON.stringify(remoteReview)).not.toContain('/Users/alice')

    const longLabel = adapter.review(editor(`/tmp/${'a'.repeat(200)}\u202e.fig`), {}).documentLabel
    expect(Array.from(longLabel).length).toBe(DEPLOYMENT_PLUGIN_DOCUMENT_LIMITS.maxLabelLength)
    expect(longLabel).not.toContain('\u202e')
  })

  test('normalizes useful defaults and validates provider-specific targets', () => {
    expect(parseDeploymentPluginParameters(VERCEL_DEPLOYMENT_PLUGIN, {})).toEqual({
      environment: 'preview',
      uiKit: 'none',
      locales: [],
      runtimeConfig: undefined
    })
    expect(
      parseDeploymentPluginParameters(CLOUDFLARE_DEPLOYMENT_PLUGIN, {
        environment: 'production',
        target: 'abc123/my-pages',
        uiKit: 'shadcn',
        locales: ['zh-CN', 'en']
      })
    ).toEqual({
      environment: 'production',
      target: 'abc123/my-pages',
      uiKit: 'shadcn',
      locales: ['zh-CN', 'en'],
      runtimeConfig: undefined
    })
    expect(
      parseDeploymentPluginParameters(VERCEL_DEPLOYMENT_PLUGIN, {
        runtimeConfig: {
          supabaseUrl: 'https://staging.supabase.co',
          supabasePublishableKey: 'sb_publishable_staging',
          supabaseSchema: 'app'
        }
      })
    ).toMatchObject({
      runtimeConfig: {
        supabaseUrl: 'https://staging.supabase.co',
        supabasePublishableKey: 'sb_publishable_staging',
        supabaseSchema: 'app'
      }
    })
    expect(
      parseDeploymentPluginParameters(VERCEL_DEPLOYMENT_PLUGIN, {
        runtimeConfig: {
          supabaseUrl: 'https://legacy.supabase.co',
          supabaseAnonKey: 'legacy-anon-jwt'
        }
      })
    ).toMatchObject({
      runtimeConfig: {
        supabaseUrl: 'https://legacy.supabase.co',
        supabasePublishableKey: 'legacy-anon-jwt'
      }
    })
    expect(() =>
      parseDeploymentPluginParameters(VERCEL_DEPLOYMENT_PLUGIN, {
        runtimeConfig: {
          supabaseUrl: 'https://conflict.supabase.co',
          supabasePublishableKey: 'sb_publishable_current',
          supabaseAnonKey: 'legacy-anon-stale'
        }
      })
    ).toThrow('conflict')
    expect(() => parseDeploymentPluginParameters(CLOUDFLARE_DEPLOYMENT_PLUGIN, {})).toThrow(
      'requires a target'
    )
    expect(() =>
      parseDeploymentPluginParameters(CLOUDFLARE_DEPLOYMENT_PLUGIN, {
        target: 'missing-project/'
      })
    ).toThrow('account-id/project-name')
    expect(() =>
      parseDeploymentPluginParameters(VERCEL_DEPLOYMENT_PLUGIN, { target: 'Upper Case' })
    ).toThrow('lowercase project name')
  })

  test('fails closed before credential resolution when confirmation is absent or denied', async () => {
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('secret-token', credentialCalls),
      successfulRunner(runnerCalls)
    )
    const store = editor()

    expect(await errorCode(adapter.execute(store, {}))).toBe('confirmation-required')
    expect(await errorCode(adapter.execute(store, {}, { confirm: async () => true }))).toBe(
      'review-required'
    )
    expect(
      await errorCode(
        adapter.execute(
          store,
          {},
          {
            confirm: async () => false,
            expectedReview: expectedReview(adapter, store)
          }
        )
      )
    ).toBe('confirmation-denied')
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
  })

  test('resolves the credential only after review and reuses the existing deploy runner', async () => {
    const order: string[] = []
    const runnerCalls: unknown[][] = []
    const credentials: CredentialResolver = {
      async resolve() {
        order.push('credential')
        return 'ephemeral-token'
      }
    }
    const runner: DeploymentPluginRunner = async (...args) => {
      order.push('runner')
      return successfulRunner(runnerCalls)(...args)
    }
    const adapter = createDeploymentPluginHostAdapter(
      CLOUDFLARE_DEPLOYMENT_PLUGIN,
      credentials,
      runner
    )
    const store = editor('/tmp/current.fig')
    const reviewedParameters = {
      environment: 'production',
      target: 'account_1/project-one',
      locales: ['en-US']
    }
    const result = await adapter.execute(store, reviewedParameters, {
      async confirm(review) {
        order.push('confirm')
        expect(review).toMatchObject({
          provider: 'cloudflare',
          environment: 'production',
          target: 'account_1/project-one',
          uiKit: 'none',
          locales: ['en-US'],
          hasRuntimeOverrides: false,
          documentLabel: 'current.fig'
        })
        expect(review.documentIdentity.split('\0')).toHaveLength(2)
        expect(JSON.stringify(review)).not.toContain('ephemeral-token')
        expect(JSON.stringify(review)).not.toContain('/tmp/current.fig')
        return true
      },
      expectedReview: expectedReview(adapter, store, reviewedParameters)
    })

    expect(order).toEqual(['confirm', 'credential', 'runner'])
    expect(runnerCalls[0]).toEqual([
      '/tmp/current.fig',
      'ephemeral-token',
      'cloudflare',
      'production',
      'account_1/project-one',
      'none',
      { enabled: true, locales: ['en-US'] },
      undefined
    ])
    expect(result).toEqual({
      provider: 'cloudflare',
      environment: 'production',
      url: 'https://cloudflare.example/deploy',
      deployId: 'deploy_123',
      fileCount: 4,
      backendDeploymentRequired: false
    })
    expect(JSON.stringify(result)).not.toContain('ephemeral-token')
  })

  test('requires a saved document and a configured credential', async () => {
    const runnerCalls: unknown[][] = []
    const missingPath = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token'),
      successfulRunner(runnerCalls)
    )
    expect(
      await errorCode(missingPath.execute(editor(''), {}, { confirm: async () => true }))
    ).toBe('saved-document-required')

    const missingCredential = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver(null),
      successfulRunner(runnerCalls)
    )
    const savedStore = editor()
    expect(
      await errorCode(
        missingCredential.execute(
          savedStore,
          {},
          {
            confirm: async () => true,
            expectedReview: expectedReview(missingCredential, savedStore)
          }
        )
      )
    ).toBe('credential-missing')
    expect(runnerCalls).toEqual([])
  })

  test('fails closed when Save As changes the document after host review', async () => {
    const credentialCalls: string[] = []
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token', credentialCalls),
      successfulRunner(runnerCalls)
    )
    const document = mutableEditor('/tmp/original.fig')
    const reviewed = adapter.review(document.store, {})

    document.setPath('/tmp/save-as.fig')
    expect(
      await errorCode(
        adapter.execute(
          document.store,
          {},
          {
            confirm: async () => true,
            expectedReview: reviewed
          }
        )
      )
    ).toBe('review-changed')
    expect(credentialCalls).toEqual([])
    expect(runnerCalls).toEqual([])
  })

  test('revalidates the reviewed document across confirmation and credential awaits', async () => {
    const confirmationCredentialCalls: string[] = []
    const confirmationRunnerCalls: unknown[][] = []
    const confirmationDocument = mutableEditor('/tmp/original.fig')
    const confirmationAdapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token', confirmationCredentialCalls),
      successfulRunner(confirmationRunnerCalls)
    )
    const confirmationReview = confirmationAdapter.review(confirmationDocument.store, {})
    expect(
      await errorCode(
        confirmationAdapter.execute(
          confirmationDocument.store,
          {},
          {
            confirm: async () => {
              confirmationDocument.setPath('/tmp/changed-during-confirmation.fig')
              return true
            },
            expectedReview: confirmationReview
          }
        )
      )
    ).toBe('review-changed')
    expect(confirmationCredentialCalls).toEqual([])
    expect(confirmationRunnerCalls).toEqual([])

    const credentialRunnerCalls: unknown[][] = []
    const credentialDocument = mutableEditor('/tmp/original.fig')
    const credentialAdapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      {
        async resolve() {
          credentialDocument.setPath('/tmp/changed-during-credential-read.fig')
          return 'token'
        }
      },
      successfulRunner(credentialRunnerCalls)
    )
    const credentialReview = credentialAdapter.review(credentialDocument.store, {})
    expect(
      await errorCode(
        credentialAdapter.execute(
          credentialDocument.store,
          {},
          {
            confirm: async () => true,
            expectedReview: credentialReview
          }
        )
      )
    ).toBe('review-changed')
    expect(credentialRunnerCalls).toEqual([])
  })

  test('distinguishes safe pre-dispatch aborts from unknown post-dispatch outcomes', async () => {
    const before = new AbortController()
    before.abort()
    const runnerCalls: unknown[][] = []
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token'),
      successfulRunner(runnerCalls)
    )
    const beforeStore = editor()
    expect(
      await errorCode(
        adapter.execute(
          beforeStore,
          {},
          {
            confirm: async () => true,
            expectedReview: expectedReview(adapter, beforeStore),
            signal: before.signal
          }
        )
      )
    ).toBe('aborted')
    expect(runnerCalls).toEqual([])

    const after = new AbortController()
    const failingRunner: DeploymentPluginRunner = async () => {
      after.abort()
      throw new Error('transport closed')
    }
    const afterAdapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token'),
      failingRunner
    )
    const afterStore = editor()
    expect(
      await errorCode(
        afterAdapter.execute(
          afterStore,
          {},
          {
            confirm: async () => true,
            expectedReview: expectedReview(afterAdapter, afterStore),
            signal: after.signal
          }
        )
      )
    ).toBe('outcome-unknown')

    for (const message of ['request timed out', 'transport connection closed']) {
      const uncertainRunner: DeploymentPluginRunner = async () => {
        throw new Error(message)
      }
      const uncertainAdapter = createDeploymentPluginHostAdapter(
        VERCEL_DEPLOYMENT_PLUGIN,
        resolver('token'),
        uncertainRunner
      )
      const uncertainStore = editor()
      expect(
        await errorCode(
          uncertainAdapter.execute(
            uncertainStore,
            {},
            {
              confirm: async () => true,
              expectedReview: expectedReview(uncertainAdapter, uncertainStore)
            }
          )
        )
      ).toBe('outcome-unknown')
    }
  })

  test('rejects a runner result outside the reviewed provider authority', async () => {
    const forged: DeploymentPluginRunner = async () => ({
      provider: 'cloudflare',
      environment: 'preview',
      url: 'https://example.com',
      deployId: 'dep',
      fileCount: 1
    })
    const adapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token'),
      forged
    )
    const forgedStore = editor()
    expect(
      await errorCode(
        adapter.execute(
          forgedStore,
          {},
          {
            confirm: async () => true,
            expectedReview: expectedReview(adapter, forgedStore)
          }
        )
      )
    ).toBe('result-mismatch')

    const unsafeURL: DeploymentPluginRunner = async () => ({
      provider: 'vercel',
      environment: 'preview',
      url: 'http://example.com',
      deployId: 'dep',
      fileCount: 1
    })
    const unsafeURLAdapter = createDeploymentPluginHostAdapter(
      VERCEL_DEPLOYMENT_PLUGIN,
      resolver('token'),
      unsafeURL
    )
    const unsafeURLStore = editor()
    expect(
      await errorCode(
        unsafeURLAdapter.execute(
          unsafeURLStore,
          {},
          {
            confirm: async () => true,
            expectedReview: expectedReview(unsafeURLAdapter, unsafeURLStore)
          }
        )
      )
    ).toBe('result-mismatch')
  })
})
