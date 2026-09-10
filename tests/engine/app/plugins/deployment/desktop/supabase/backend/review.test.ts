import { describe, expect, test } from 'bun:test'

import type {
  BackendApplicationSpecV1,
  BackendReleaseProviderAuthorityV1,
  StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'
import {
  STAGED_MIGRATION_EXECUTION_FORMAT,
  digestStagedMigrationExecutionPlan
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createAppPluginStore,
  createBundledPluginCatalog,
  createMemoryAppPluginStateStorage,
  type AppBundlePluginCatalogEntry
} from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  listAppBackendProviderDescriptors,
  prepareAppBackendProviderBuild,
  type AppBackendProviderDocumentGraph,
  type PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import {
  normalizedConfig,
  sameAuthority,
  sameBuild
} from '@/app/plugins/host/deployment/desktop/supabase/backend/binding'
import {
  createDesktopSupabaseBackendReviewService,
  DesktopSupabaseBackendReviewError,
  type DesktopSupabaseBackendReviewDependencies,
  type DesktopSupabaseStrictReviewInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import type { SupabaseBackendReleaseReviewArtifactV1 } from '@/app/plugins/host/deployment/supabase/backend-release'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_review_secret_canary_1234567890'
const AUTHORITY: BackendReleaseProviderAuthorityV1 = Object.freeze({
  publisherId: 'open-pencil',
  packageDigest: 'package-digest',
  pluginId: 'open-pencil.supabase-backend',
  contributionId: 'supabase.backend',
  providerId: 'supabase',
  adapterId: 'open-pencil.compiler.backend.supabase',
  adapterVersion: '1.0.0',
  contractVersion: 1,
  supportedModelVersions: Object.freeze([1]),
  capabilities: Object.freeze(['data.read']),
  permissions: Object.freeze([]),
  outputKinds: Object.freeze(['schema'])
})

function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') throw new Error('Missing bundled Supabase provider')
  return entry
}

function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'review-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

async function preparedBuild(): Promise<PreparedAppBackendProviderBuild> {
  const store = createAppPluginStore({
    storage: createMemoryAppPluginStateStorage(),
    catalog: [bundledBackendProvider()],
    activationCompatibilityPolicy: () => ({ ok: true }),
    engineVersion: '0.15.0'
  })
  const loaded = await store.load()
  if (loaded.error) throw loaded.error
  const descriptor = listAppBackendProviderDescriptors(store)[0]
  if (!descriptor) throw new Error('Missing active Supabase provider')
  return prepareAppBackendProviderBuild(
    store,
    {
      format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
      selection: descriptor,
      application: application()
    },
    { target: 'react', mode: 'production' }
  )
}

const BUILD = await preparedBuild()

const GRAPH: AppBackendProviderDocumentGraph = Object.freeze({
  rootId: 'root-1',
  getNode: () => undefined
})

async function artifactFor(
  input: DesktopSupabaseStrictReviewInput,
  overrides: Readonly<{
    projectRef?: string
    grantGeneration?: string
    applyAllowed?: boolean
    sql?: string
  }> = {}
): Promise<SupabaseBackendReleaseReviewArtifactV1> {
  const inspectedSchemaDigest = 'inspected-schema-digest'
  const inspectedManifest = {
    inspectedSchemaDigest,
    stagedExecutionPlanDigest: input.stagedExecutionPlan
      ? await digestStagedMigrationExecutionPlan(input.stagedExecutionPlan)
      : null,
    reviewReady: true,
    applyAllowed: false,
    releaseReady: false,
    blockers: []
  }
  const inspectedReview = {
    manifest: inspectedManifest,
    manifestDigest: 'inspected-review-manifest-digest',
    sql: overrides.sql ?? '-- Review only.\n'
  }
  const manifest = {
    format: 'openpencil.supabase-backend-host-review.v1',
    version: 1,
    documentDigest: input.documentDigest,
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    compiler: {
      applicationDigest: input.build.plan.applicationDigest,
      planDigest: input.build.plan.planDigest,
      emissionManifestDigest: input.build.emission.manifestDigest
    },
    backendProvider: input.backendProvider,
    remoteAuthority: {
      projectRef: overrides.projectRef ?? input.projectRef,
      accountId: 'organization-1',
      grantGeneration: overrides.grantGeneration ?? input.grantGeneration,
      inspectedSchemaDigest
    },
    inspectedReview: {
      manifestDigest: inspectedReview.manifestDigest,
      migrationPlanDigest: 'migration-plan-digest',
      targetModelDigest: 'target-model-digest',
      reviewReady: true,
      applyAllowed: overrides.applyAllowed ?? false,
      releaseReady: false
    }
  }
  const artifact: SupabaseBackendReleaseReviewArtifactV1 = {
    format: 'openpencil.supabase-backend-review-artifact.v1',
    version: 1,
    manifest,
    manifestDigest: await digestCanonicalManifest(manifest),
    inspectedReview
  }
  return artifact
}

async function stagedPlan(): Promise<StagedMigrationExecutionPlanV1> {
  return {
    format: STAGED_MIGRATION_EXECUTION_FORMAT,
    version: 1,
    executionId: 'execution:expand-title',
    changeId: 'change:title',
    sourceMigrationPlan: {
      version: 1,
      planId: 'migration:title',
      planDigest: await digestCanonicalManifest({ plan: 'title' }),
      fromModelDigest: await digestCanonicalManifest({ model: 'before' }),
      targetModelDigest: await digestCanonicalManifest({ model: 'after' })
    },
    phase: 'expand',
    predecessor: null,
    operations: [
      {
        operation: {
          id: 'staged:add-title',
          kind: 'add-nullable-field',
          sourceOperationIds: ['op-0001'],
          entityId: 'notes',
          field: { id: 'title', name: 'title', type: 'string', nullable: true }
        },
        risk: 'low'
      }
    ],
    highestRisk: 'low',
    requiresHumanApproval: false
  }
}

function dependencies(
  overrides: Partial<DesktopSupabaseBackendReviewDependencies> = {}
): DesktopSupabaseBackendReviewDependencies {
  return {
    prepareBuild: () => BUILD,
    resolveBackendProviderAuthority: () => AUTHORITY,
    resolveCredential: async () => PAT,
    resolveGrantGeneration: async () => GRANT_GENERATION,
    prepareStrictReview: artifactFor,
    ...overrides
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof DesktopSupabaseBackendReviewError ? cause.code : undefined
  }
  return undefined
}

describe('Desktop Supabase Backend Provider review service', () => {
  test('preserves exact authority and build binding comparisons', () => {
    const { publisherId, ...authorityFields } = AUTHORITY
    expect(sameAuthority(AUTHORITY, structuredClone(AUTHORITY))).toBe(true)
    expect(sameAuthority(AUTHORITY, { ...AUTHORITY, packageDigest: 'changed' })).toBe(false)
    expect(sameAuthority(AUTHORITY, { ...authorityFields, publisherId })).toBe(false)
    expect(sameBuild(BUILD, structuredClone(BUILD))).toBe(true)
    const changedBuilds: PreparedAppBackendProviderBuild[] = [
      {
        ...BUILD,
        request: {
          ...BUILD.request,
          application: { ...BUILD.request.application, applicationId: 'changed' }
        }
      },
      { ...BUILD, plan: { ...BUILD.plan, applicationDigest: 'changed' } },
      { ...BUILD, plan: { ...BUILD.plan, planDigest: 'changed' } },
      { ...BUILD, emission: { ...BUILD.emission, manifestDigest: 'changed' } }
    ]
    for (const changed of changedBuilds) expect(sameBuild(BUILD, changed)).toBe(false)
  })

  test('normalizes the public project without reading a publishable key', () => {
    const config = {
      url: PROJECT_URL,
      get anonKey(): string {
        throw new Error('Review and Apply must not read the publishable key')
      }
    }
    const normalized = normalizedConfig(config)
    expect(normalized).toEqual({ projectRef: PROJECT_REF, schema: 'public' })
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(normalizedConfig({ url: PROJECT_URL, anonKey: '', schema: 'private' })).toBeNull()
    expect(normalizedConfig(undefined)).toBeNull()
  })

  test('validates, snapshots, and binds an explicit staged plan before credential use', async () => {
    const plan = await stagedPlan()
    let captured: StagedMigrationExecutionPlanV1 | undefined
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        async prepareStrictReview(input) {
          captured = input.stagedExecutionPlan
          return artifactFor(input)
        }
      })
    )

    const operation = service.review({
      config: { url: PROJECT_URL, anonKey: '' },
      graph: GRAPH,
      stagedExecutionPlan: plan
    })
    const firstOperation = plan.operations[0]
    if (!firstOperation) throw new Error('Missing staged migration operation')
    firstOperation.operation.sourceOperationIds[0] = 'tampered-after-call'
    const result = await operation

    expect(captured).toBeDefined()
    expect(captured).not.toBe(plan)
    expect(captured?.operations[0]?.operation.sourceOperationIds).toEqual(['op-0001'])
    expect(result.artifact.inspectedReview.manifest.stagedExecutionPlanDigest).toBe(
      await digestStagedMigrationExecutionPlan(captured)
    )
  })

  test('rejects an invalid staged plan before resolving credentials', async () => {
    let credentialCalls = 0
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        async resolveCredential() {
          credentialCalls += 1
          return PAT
        }
      })
    )

    expect(
      await errorCode(
        service.review({
          config: { url: PROJECT_URL, anonKey: '' },
          graph: GRAPH,
          stagedExecutionPlan: { format: 'untrusted-plan', secretValue: PAT }
        })
      )
    ).toBe('staged-plan-invalid')
    expect(credentialCalls).toBe(0)
  })

  test('binds a secret-free review artifact to stable grant and Provider authority', async () => {
    const calls: string[] = []
    let grantReads = 0
    let capturedDocumentDigest = ''
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        prepareBuild(graph) {
          calls.push(`build:${graph.rootId}`)
          return BUILD
        },
        resolveBackendProviderAuthority() {
          calls.push('authority')
          return AUTHORITY
        },
        async resolveGrantGeneration() {
          grantReads += 1
          calls.push('grant')
          return GRANT_GENERATION
        },
        async resolveCredential() {
          calls.push('credential')
          return PAT
        },
        async prepareStrictReview(input) {
          calls.push('strict-review')
          expect(input.personalAccessToken).toBe(PAT)
          expect(input.environment).toBe('staging')
          capturedDocumentDigest = input.documentDigest
          return artifactFor(input)
        }
      })
    )

    const result = await service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH })

    expect(calls).toEqual([
      'build:root-1',
      'authority',
      'grant',
      'credential',
      'grant',
      'strict-review',
      'grant',
      'build:root-1',
      'authority'
    ])
    expect(grantReads).toBe(3)
    expect(capturedDocumentDigest).toBe('pO6bgzyY_pbOxfX-ld9S3PDiLrfuP1NPigecapJwFKc')
    expect(capturedDocumentDigest).toBe(
      await digestCanonicalManifest({
        format: 'openpencil.desktop-supabase-backend-review-document.v1',
        rootId: GRAPH.rootId,
        projectRef: PROJECT_REF,
        schema: 'public',
        backendProviderRequest: BUILD.request
      })
    )
    expect(result).toMatchObject({
      projectRef: PROJECT_REF,
      accountId: 'organization-1',
      grantGeneration: GRANT_GENERATION,
      reviewReady: true,
      blockerCount: 0,
      applyAvailable: false,
      applyPerformed: false
    })
    expect(JSON.stringify(result)).not.toContain(PAT)
  })

  test('uses native-vault credential status without resolving the PAT into the renderer', async () => {
    let capturedCredential: string | null | undefined
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        resolveCredential: undefined,
        resolveCredentialStatus: async () => 'configured',
        async prepareStrictReview(input) {
          capturedCredential = input.personalAccessToken
          return artifactFor(input)
        }
      })
    )

    await expect(
      service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH })
    ).resolves.toBeDefined()
    expect(capturedCredential).toBeNull()
  })

  test('fails before credential resolution when the document has no declaration', async () => {
    let credentialCalls = 0
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        prepareBuild: () => null,
        async resolveCredential() {
          credentialCalls += 1
          return PAT
        }
      })
    )

    expect(
      await errorCode(service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH }))
    ).toBe('backend-provider-missing')
    expect(credentialCalls).toBe(0)
  })

  test('rejects a custom schema before build or credential resolution', async () => {
    let buildCalls = 0
    let credentialCalls = 0
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        prepareBuild() {
          buildCalls += 1
          return BUILD
        },
        async resolveCredential() {
          credentialCalls += 1
          return PAT
        }
      })
    )

    expect(
      await errorCode(
        service.review({
          config: { url: PROJECT_URL, anonKey: '', schema: 'private' },
          graph: GRAPH
        })
      )
    ).toBe('invalid-config')
    expect(buildCalls).toBe(0)
    expect(credentialCalls).toBe(0)
  })

  test('rejects credential generation rotation before network inspection', async () => {
    let generation = 0
    let reviewCalls = 0
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        async resolveGrantGeneration() {
          generation += 1
          return generation === 1 ? GRANT_GENERATION : '223e4567-e89b-42d3-a456-426614174000'
        },
        async prepareStrictReview(input) {
          reviewCalls += 1
          return artifactFor(input)
        }
      })
    )

    expect(
      await errorCode(service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH }))
    ).toBe('grant-changed')
    expect(reviewCalls).toBe(0)
  })

  test('discards an artifact when live Provider authority changes during inspection', async () => {
    let authorityReads = 0
    const changedAuthority = { ...AUTHORITY, packageDigest: 'changed-package' }
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        resolveBackendProviderAuthority() {
          authorityReads += 1
          return authorityReads === 1 ? AUTHORITY : changedAuthority
        }
      })
    )

    expect(
      await errorCode(service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH }))
    ).toBe('backend-provider-unavailable')
  })

  test('discards an artifact when the live graph build or Supabase config changes', async () => {
    const changedBuild = {
      ...BUILD,
      plan: { ...BUILD.plan, planDigest: 'changed-plan-digest' }
    } as PreparedAppBackendProviderBuild
    for (const mutate of [
      (state: {
        build: PreparedAppBackendProviderBuild
        config: { url: string; anonKey: string }
      }) => {
        state.build = changedBuild
      },
      (state: {
        build: PreparedAppBackendProviderBuild
        config: { url: string; anonKey: string }
      }) => {
        state.config = { url: 'https://differentprojectref1.supabase.co', anonKey: '' }
      }
    ]) {
      const state = {
        build: BUILD,
        config: { url: PROJECT_URL, anonKey: '' }
      }
      const service = createDesktopSupabaseBackendReviewService(
        dependencies({
          prepareBuild: () => state.build,
          async prepareStrictReview(input) {
            const artifact = await artifactFor(input)
            mutate(state)
            return artifact
          }
        })
      )

      expect(
        await errorCode(
          service.review({
            config: state.config,
            readConfig: () => state.config,
            graph: GRAPH
          })
        )
      ).toBe('review-stale')
    }
  })

  test('rejects an Apply-capable or authority-mismatched artifact', async () => {
    for (const prepareStrictReview of [
      (input: DesktopSupabaseStrictReviewInput) => artifactFor(input, { applyAllowed: true }),
      (input: DesktopSupabaseStrictReviewInput) =>
        artifactFor(input, { projectRef: 'differentprojectref01' })
    ]) {
      const service = createDesktopSupabaseBackendReviewService(
        dependencies({ prepareStrictReview })
      )
      expect(
        await errorCode(service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH }))
      ).toBe('artifact-invalid')
    }
  })

  test('does not echo a PAT from an internal failure and prevents concurrent runs', async () => {
    let releaseReview: (() => void) | undefined
    const wait = new Promise<void>((resolve) => {
      releaseReview = resolve
    })
    const service = createDesktopSupabaseBackendReviewService(
      dependencies({
        async prepareStrictReview(input) {
          await wait
          throw new Error(`transport rejected ${input.personalAccessToken}`)
        }
      })
    )
    const first = service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH })
    await Promise.resolve()
    const secondCode = await errorCode(
      service.review({ config: { url: PROJECT_URL, anonKey: '' }, graph: GRAPH })
    )
    releaseReview?.()
    let firstError: Error | undefined
    try {
      await first
    } catch (cause) {
      if (cause instanceof Error) firstError = cause
    }

    expect(secondCode).toBe('already-running')
    expect(firstError).toBeInstanceOf(DesktopSupabaseBackendReviewError)
    expect((firstError as DesktopSupabaseBackendReviewError).code).toBe('review-failed')
    expect(firstError?.message).not.toContain(PAT)
  })
})
