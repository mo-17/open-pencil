import { describe, expect, test } from 'bun:test'

import type {
  BackendApplicationSpecV1,
  BackendReleaseProviderAuthorityV1,
  BackendReleaseStateV1
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
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  createDesktopSupabaseBackendStagingReleaseService,
  DesktopSupabaseBackendStagingReleaseError,
  type DesktopSupabaseBackendStagingReleaseDependencies
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/release'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'
import type { SupabaseBackendReleaseReviewArtifactV1 } from '@/app/plugins/host/deployment/supabase/backend-release'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const READ_PAT = 'sbp_read_secret_canary_1234567890'
const WRITE_PAT = 'sbp_write_secret_canary_1234567890'
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

function asFixture<T>(value: object): T {
  return value as T
}

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
    applicationId: 'staging-release-test',
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

async function preparedBuild(
  target: DesktopSupabaseBackendTarget = 'react'
): Promise<PreparedAppBackendProviderBuild> {
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
    { target, mode: 'production' }
  )
}

const BUILD = await preparedBuild()
const GRAPH: AppBackendProviderDocumentGraph = Object.freeze({
  rootId: 'root-1',
  getNode: () => undefined
})

async function documentDigest(build = BUILD): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: GRAPH.rootId,
    projectRef: PROJECT_REF,
    schema: 'public',
    backendProviderRequest: build.request
  })
}

async function previousReview(build = BUILD): Promise<DesktopSupabaseBackendReviewResult> {
  const inspectedSchemaDigest = 'inspected-schema-digest'
  const inspectedReview = {
    snapshot: {},
    sql: '-- Review only.\n',
    manifest: {
      inspectedSchemaDigest,
      reviewReady: true,
      applyAllowed: false,
      releaseReady: false,
      blockers: []
    },
    manifestDigest: 'inspected-review-manifest-digest'
  }
  const manifest = {
    format: 'openpencil.supabase-backend-host-review.v1',
    version: 1,
    documentDigest: await documentDigest(build),
    compilerVersion: '0.15.0',
    target: build.plan.target,
    environment: 'staging',
    compiler: {
      applicationDigest: build.plan.applicationDigest,
      planDigest: build.plan.planDigest,
      emissionManifestDigest: build.emission.manifestDigest
    },
    backendProvider: AUTHORITY,
    remoteAuthority: {
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      inspectedSchemaDigest
    },
    inspectedReview: {
      manifestDigest: inspectedReview.manifestDigest,
      migrationPlanDigest: 'migration-plan-digest',
      targetModelDigest: 'target-model-digest',
      reviewReady: true,
      applyAllowed: false,
      releaseReady: false
    }
  }
  const artifact = asFixture<SupabaseBackendReleaseReviewArtifactV1>({
    format: 'openpencil.supabase-backend-review-artifact.v1',
    version: 1,
    manifest,
    manifestDigest: await digestCanonicalManifest(manifest),
    inspectedReview
  })
  return {
    artifact,
    documentDigest: manifest.documentDigest,
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    grantGeneration: GRANT_GENERATION,
    reviewReady: true,
    blockerCount: 0,
    applyAvailable: false,
    applyPerformed: false
  }
}

function dependencies(
  overrides: Partial<DesktopSupabaseBackendStagingReleaseDependencies> = {}
): DesktopSupabaseBackendStagingReleaseDependencies {
  return {
    prepareBuild: () => BUILD,
    resolveBackendProviderAuthority: () => AUTHORITY,
    resolveReadCredential: async () => READ_PAT,
    resolveWriteCredential: async () => WRITE_PAT,
    resolveGrantGeneration: async () => GRANT_GENERATION,
    resolveStagingTargetBinding: () => ({
      schemaVersion: 1,
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      boundAt: '2026-09-02T00:00:00.000Z'
    }),
    prepareStrictStagingRelease: async () => {
      throw new Error('not used by this test')
    },
    ...overrides
  }
}

function releaseInput(reviewed: DesktopSupabaseBackendReviewResult) {
  return {
    config: { url: PROJECT_URL, anonKey: '' },
    graph: GRAPH,
    reviewed,
    projectRefConfirmation: PROJECT_REF,
    confirmedIndependentStaging: true as const
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof DesktopSupabaseBackendStagingReleaseError ? cause.code : undefined
  }
  return undefined
}

describe('Desktop Supabase Backend staging release authority', () => {
  test.each(['missing-artifact', 'null-artifact', 'missing-manifest', 'null-manifest'] as const)(
    'rejects a %s review envelope before credentials or strict release',
    async (shape) => {
      const reviewed = structuredClone(await previousReview())
      if (shape === 'missing-artifact') Reflect.deleteProperty(reviewed, 'artifact')
      if (shape === 'null-artifact') Reflect.set(reviewed, 'artifact', null)
      if (shape === 'missing-manifest') Reflect.deleteProperty(reviewed.artifact, 'manifest')
      if (shape === 'null-manifest') Reflect.set(reviewed.artifact, 'manifest', null)
      const sensitive: string[] = []
      const service = createDesktopSupabaseBackendStagingReleaseService(
        dependencies({
          resolveReadCredential: async () => {
            sensitive.push('read-credential')
            return READ_PAT
          },
          resolveWriteCredential: async () => {
            sensitive.push('write-credential')
            return WRITE_PAT
          },
          prepareStrictStagingRelease: async () => {
            sensitive.push('strict-release')
            throw new Error('must not run')
          }
        })
      )
      expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('review-stale')
      expect(sensitive).toEqual([])
    }
  )

  test.each(['vue', 'flutter', null])(
    'rejects a recomputed review target of %s before credentials or strict release',
    async (target) => {
      const reviewed = await previousReview()
      if (target === null) Reflect.deleteProperty(reviewed.artifact.manifest, 'target')
      else Reflect.set(reviewed.artifact.manifest, 'target', target)
      Reflect.set(
        reviewed.artifact,
        'manifestDigest',
        await digestCanonicalManifest(reviewed.artifact.manifest)
      )
      const sensitive: string[] = []
      const service = createDesktopSupabaseBackendStagingReleaseService(
        dependencies({
          resolveReadCredential: async () => {
            sensitive.push('read-credential')
            return READ_PAT
          },
          resolveWriteCredential: async () => {
            sensitive.push('write-credential')
            return WRITE_PAT
          },
          prepareStrictStagingRelease: async () => {
            sensitive.push('strict-release')
            throw new Error('must not run')
          }
        })
      )
      expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('review-stale')
      expect(sensitive).toEqual([])
    }
  )

  test.each(['plan', 'emission'] as const)(
    'rejects a mismatched %s target even when all previous digests are retained',
    async (field) => {
      const reviewed = await previousReview()
      const build = {
        ...BUILD,
        plan: { ...BUILD.plan },
        emission: { ...BUILD.emission, manifest: { ...BUILD.emission.manifest } }
      }
      Reflect.set(field === 'plan' ? build.plan : build.emission.manifest, 'target', 'vue')
      let credentialReads = 0
      const service = createDesktopSupabaseBackendStagingReleaseService(
        dependencies({
          prepareBuild: () => build,
          resolveReadCredential: async () => {
            credentialReads += 1
            return READ_PAT
          }
        })
      )
      expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('review-stale')
      expect(credentialReads).toBe(0)
    }
  )

  test('uses the captured Vue target for initial build and local revalidation', async () => {
    const build = await preparedBuild('vue')
    const reviewed = await previousReview(build)
    const targets: unknown[] = []
    let strictCalls = 0
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        prepareBuild(_graph, target) {
          if (targets.length === 0) Reflect.set(reviewed.artifact.manifest, 'target', 'react')
          targets.push(target)
          return build
        },
        async prepareStrictStagingRelease(input) {
          strictCalls += 1
          expect(input.build.plan.target).toBe('vue')
          expect(input.build.emission.manifest.target).toBe('vue')
          await input.revalidateLocalAuthority({ stage: 'pre-apply' })
          throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
        }
      })
    )
    expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('release-failed')
    expect(strictCalls).toBe(1)
    expect(targets).toEqual(['vue', 'vue'])
  })

  test.each(['plan', 'emission'] as const)(
    'rejects %s target drift during local revalidation before dispatch',
    async (field) => {
      const reviewed = await previousReview()
      const drifted = {
        ...BUILD,
        plan: { ...BUILD.plan },
        emission: { ...BUILD.emission, manifest: { ...BUILD.emission.manifest } }
      }
      Reflect.set(field === 'plan' ? drifted.plan : drifted.emission.manifest, 'target', 'vue')
      let buildCalls = 0
      let dispatchReached = false
      const service = createDesktopSupabaseBackendStagingReleaseService(
        dependencies({
          prepareBuild: () => (++buildCalls === 1 ? BUILD : drifted),
          async prepareStrictStagingRelease(input) {
            await input.revalidateLocalAuthority({ stage: 'pre-apply' })
            dispatchReached = true
            throw new Error('must not dispatch')
          }
        })
      )
      expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('review-stale')
      expect(buildCalls).toBe(2)
      expect(dispatchReached).toBe(false)
    }
  )

  test('rejects a stale reviewed artifact before resolving either credential', async () => {
    const reviewed = await previousReview()
    let credentialReads = 0
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveReadCredential: async () => {
          credentialReads += 1
          return READ_PAT
        }
      })
    )
    const stale = {
      ...reviewed,
      artifact: { ...reviewed.artifact, manifestDigest: 'A'.repeat(43) }
    }

    expect(await errorCode(service.release(releaseInput(stale)))).toBe('review-stale')
    expect(credentialReads).toBe(0)
  })

  test('rejects a staging binding from another project or account', async () => {
    const reviewed = await previousReview()
    const projectMismatch = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: 'abcdefghijklmnopqrst',
          accountId: ACCOUNT_ID,
          boundAt: '2026-09-02T00:00:00.000Z'
        })
      })
    )
    const accountMismatch = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: 'different-organization',
          boundAt: '2026-09-02T00:00:00.000Z'
        })
      })
    )

    expect(await errorCode(projectMismatch.release(releaseInput(reviewed)))).toBe(
      'binding-mismatch'
    )
    expect(await errorCode(accountMismatch.release(releaseInput(reviewed)))).toBe(
      'binding-mismatch'
    )
  })

  test('requires the separate database-write credential', async () => {
    const reviewed = await previousReview()
    let strictCalls = 0
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveWriteCredential: async () => null,
        prepareStrictStagingRelease: async () => {
          strictCalls += 1
          return {} as BackendReleaseStateV1
        }
      })
    )

    expect(await errorCode(service.release(releaseInput(reviewed)))).toBe(
      'write-credential-missing'
    )
    expect(strictCalls).toBe(0)
  })

  test('uses native-vault read credential status without resolving the PAT into the renderer', async () => {
    const reviewed = await previousReview()
    let capturedCredential: string | null | undefined
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveReadCredential: undefined,
        resolveReadCredentialStatus: async () => 'configured',
        async prepareStrictStagingRelease(input) {
          capturedCredential = input.readPersonalAccessToken
          throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
        }
      })
    )

    expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('release-failed')
    expect(capturedCredential).toBeNull()
  })

  test('rejects reuse of the read token as database-write authority', async () => {
    const reviewed = await previousReview()
    let strictCalls = 0
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        resolveWriteCredential: async () => READ_PAT,
        prepareStrictStagingRelease: async () => {
          strictCalls += 1
          return {} as BackendReleaseStateV1
        }
      })
    )

    expect(await errorCode(service.release(releaseInput(reviewed)))).toBe(
      'write-credential-not-independent'
    )
    expect(strictCalls).toBe(0)
  })

  test('rejects concurrent Apply attempts before a second authority preparation', async () => {
    const reviewed = await previousReview()
    let releaseStrict: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const strictGate = new Promise<void>((resolve) => {
      releaseStrict = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        async prepareStrictStagingRelease() {
          markStarted?.()
          await strictGate
          throw new Error('expected test shutdown')
        }
      })
    )
    const first = service.release(releaseInput(reviewed))
    await started

    expect(await errorCode(service.release(releaseInput(reviewed)))).toBe('already-running')
    releaseStrict?.()
    expect(await errorCode(first)).toBe('release-failed')
  })

  test('snapshots the reviewed envelope and confirmations before the first await', async () => {
    const reviewed = await previousReview()
    let releaseBuild: (() => void) | undefined
    let markBuildStarted: (() => void) | undefined
    const buildGate = new Promise<void>((resolve) => {
      releaseBuild = resolve
    })
    const buildStarted = new Promise<void>((resolve) => {
      markBuildStarted = resolve
    })
    let firstBuild = true
    let capturedDigest = ''
    const service = createDesktopSupabaseBackendStagingReleaseService(
      dependencies({
        async prepareBuild(graph) {
          expect(graph).toBe(GRAPH)
          if (firstBuild) {
            firstBuild = false
            markBuildStarted?.()
            await buildGate
          }
          return BUILD
        },
        async prepareStrictStagingRelease(input) {
          capturedDigest = input.expectedReviewArtifactDigest
          throw new DesktopSupabaseBackendStagingReleaseError('release-failed')
        }
      })
    )
    const envelope = releaseInput(reviewed)
    const operation = service.release(envelope)
    await buildStarted

    Reflect.set(envelope, 'reviewed', {
      ...reviewed,
      artifact: { ...reviewed.artifact, manifestDigest: 'Z'.repeat(43) }
    })
    Reflect.set(envelope, 'projectRefConfirmation', 'abcdefghijklmnopqrst')
    Reflect.set(envelope, 'graph', { rootId: 'forged-root', getNode: () => undefined })
    releaseBuild?.()

    expect(await errorCode(operation)).toBe('release-failed')
    expect(capturedDigest).toBe(reviewed.artifact.manifestDigest)
  })
})
