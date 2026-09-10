import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import type {
  BackendApplicationSpecV1,
  BackendReleaseProviderAuthorityV1
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
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  createDesktopSupabaseBackendStagingVerificationService,
  DesktopSupabaseBackendStagingVerificationError,
  type DesktopSupabaseBackendStagingCapabilityReceiptV1,
  type DesktopSupabaseBackendStagingVerificationDependencies,
  type DesktopSupabaseBackendStagingVerificationResult,
  type DesktopSupabaseStrictStagingVerificationInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification'
import type { SupabaseBackendReleaseReviewArtifactV1 } from '@/app/plugins/host/deployment/supabase/backend-release'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
const ACCOUNT_ID = 'organization-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const READ_PAT = 'sbp_read_secret_canary_1234567890'
const WRITE_PAT = 'sbp_write_secret_canary_1234567890'
const PUBLISHABLE_KEY = ['sb', 'publishable', 'test', '1234567890'].join('_')
const NOW = '2026-09-03T02:00:00.000Z'
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
    applicationId: 'staging-capability-test',
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

async function documentDigest(): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: GRAPH.rootId,
    projectRef: PROJECT_REF,
    schema: 'public',
    backendProviderRequest: BUILD.request
  })
}

async function previousReview(): Promise<DesktopSupabaseBackendReviewResult> {
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
    documentDigest: await documentDigest(),
    compilerVersion: '0.15.0',
    target: 'react',
    environment: 'staging',
    compiler: {
      applicationDigest: BUILD.plan.applicationDigest,
      planDigest: BUILD.plan.planDigest,
      emissionManifestDigest: BUILD.emission.manifestDigest
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

async function strictResult(
  input: DesktopSupabaseStrictStagingVerificationInput
): Promise<DesktopSupabaseBackendStagingVerificationResult> {
  const receipt = Object.freeze({
    format: 'openpencil.supabase-backend-staging-capability-receipt.v1' as const,
    version: 1 as const,
    verificationId: input.verificationId,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    reviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
    outcome: 'succeeded' as const,
    schemaApplied: true,
    edgeFunctionReceipt: null,
    storageIsolationReceipts: Object.freeze([]),
    gates: Object.freeze([]),
    startedAt: NOW,
    completedAt: NOW
  }) satisfies DesktopSupabaseBackendStagingCapabilityReceiptV1
  return Object.freeze({
    receipt,
    receiptDigest: await digestCanonicalManifest(receipt),
    productionReleaseReady: false
  })
}

function mutationProgress(
  input: DesktopSupabaseStrictStagingVerificationInput,
  stage: 'edge-pre-dispatch' | 'edge-deployed' | 'storage-pre-dispatch' | 'storage-progress'
) {
  const edge = stage.startsWith('edge')
    ? Object.freeze({
        releaseId: 'edge-release-1',
        functionSlug: 'openpencil-runtime',
        artifactDigest: 'E'.repeat(43),
        secretInspectionEvidenceDigest: 'S'.repeat(43),
        functionId: stage === 'edge-deployed' ? 'function-1' : null,
        versionId: stage === 'edge-deployed' ? '7' : null,
        operationId: stage === 'edge-deployed' ? `edge-deploy-${'A1b2'.repeat(8)}` : null,
        outcome: null
      })
    : null
  const storage = stage.startsWith('storage')
    ? Object.freeze([
        Object.freeze({
          verificationId: 'storage-verification-1',
          bucketId: 'user-assets',
          bucketName: 'user-assets',
          ruleId: 'owner-files',
          potentialResidualObjectPaths: Object.freeze(['users/user-a/probe-1.bin']),
          residualObjectPaths: Object.freeze(['users/user-a/probe-1.bin']),
          remoteOperationIds: Object.freeze(
            stage === 'storage-progress' ? [`storage-probe-1-${'A1b2'.repeat(6)}`] : []
          ),
          outcome: null
        })
      ])
    : Object.freeze([])
  return Object.freeze({
    format: 'openpencil.supabase-capability-dispatch-progress.v1' as const,
    version: 1 as const,
    verificationId: input.verificationId,
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration,
    documentDigest: input.documentDigest,
    reviewedArtifactDigest: input.expectedReview.artifact.manifestDigest,
    target: Object.freeze({
      target: input.build.plan.target,
      applicationDigest: input.build.plan.applicationDigest,
      planDigest: input.build.plan.planDigest,
      emissionManifestDigest: input.build.emission.manifestDigest
    }),
    stage,
    edge,
    storage
  })
}

function dependencies(
  overrides: Partial<DesktopSupabaseBackendStagingVerificationDependencies> = {}
): DesktopSupabaseBackendStagingVerificationDependencies {
  return {
    isDesktop: () => true,
    nextId: () => 'verification-1',
    now: () => NOW,
    dispatchJournal: createMemoryBackendHostReleaseDispatchJournal(),
    prepareBuild: () => BUILD,
    resolveBackendProviderAuthority: () => AUTHORITY,
    resolveReadCredential: async () => READ_PAT,
    resolveWriteCredential: async () => WRITE_PAT,
    resolveGrantGeneration: async () => GRANT_GENERATION,
    resolveStagingTargetBinding: () => ({
      schemaVersion: 1,
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      boundAt: NOW
    }),
    prepareStrictVerification: strictResult,
    ...overrides
  }
}

function verificationInput(reviewed: DesktopSupabaseBackendReviewResult) {
  return {
    config: { url: PROJECT_URL, anonKey: PUBLISHABLE_KEY },
    graph: GRAPH,
    reviewed,
    projectRefConfirmation: PROJECT_REF,
    confirmedIndependentStaging: true as const,
    edgeUserAccessToken: 'edge_user_access_token_1234567890',
    storageUserA: { userId: 'user-a', accessToken: 'user_a_access_token_1234567890' },
    storageUserB: { userId: 'user-b', accessToken: 'user_b_access_token_1234567890' }
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof DesktopSupabaseBackendStagingVerificationError ? cause.code : undefined
  }
  return undefined
}

describe('Desktop Supabase staging capability verification authority', () => {
  test('passes only exact review, staging binding, credentials, and result receipt authority', async () => {
    const reviewed = await previousReview()
    let strictInput: DesktopSupabaseStrictStagingVerificationInput | undefined
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          strictInput = input
          await input.revalidateLocalAuthority()
          return strictResult(input)
        }
      })
    )

    const result = await service.verify(verificationInput(reviewed))

    expect(result.receipt.verificationId).toBe('verification-1')
    expect(result.receipt.reviewedArtifactDigest).toBe(reviewed.artifact.manifestDigest)
    expect(result.productionReleaseReady).toBe(false)
    expect(strictInput?.publishableKey).toBe(PUBLISHABLE_KEY)
    expect(strictInput?.edgeUserAccessToken).toBe('edge_user_access_token_1234567890')
    expect(strictInput?.storageUserA?.userId).toBe('user-a')
  })

  test('uses native-vault read credential status without resolving the PAT into the renderer', async () => {
    const reviewed = await previousReview()
    let capturedCredential: string | null | undefined
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveReadCredential: undefined,
        resolveReadCredentialStatus: async () => 'configured',
        async prepareStrictVerification(input) {
          capturedCredential = input.readPersonalAccessToken
          return strictResult(input)
        }
      })
    )

    await expect(service.verify(verificationInput(reviewed))).resolves.toBeDefined()
    expect(capturedCredential).toBeNull()
  })

  test('rejects a stale review before resolving credentials or invoking strict verification', async () => {
    const reviewed = await previousReview()
    let credentialReads = 0
    let strictCalls = 0
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveReadCredential: async () => {
          credentialReads += 1
          return READ_PAT
        },
        async prepareStrictVerification(input) {
          strictCalls += 1
          return strictResult(input)
        }
      })
    )
    const stale = {
      ...reviewed,
      artifact: { ...reviewed.artifact, manifestDigest: 'A'.repeat(43) }
    }

    expect(await errorCode(service.verify(verificationInput(stale)))).toBe('review-stale')
    expect(credentialReads).toBe(0)
    expect(strictCalls).toBe(0)
  })

  test('fails closed for target, grant, and independent write-token gates', async () => {
    const reviewed = await previousReview()
    const wrongTarget = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: 'another-account',
          boundAt: NOW
        })
      })
    )
    const missingGrant = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({ resolveGrantGeneration: async () => null })
    )
    const reusedToken = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({ resolveWriteCredential: async () => READ_PAT })
    )

    expect(await errorCode(wrongTarget.verify(verificationInput(reviewed)))).toBe(
      'binding-mismatch'
    )
    expect(await errorCode(missingGrant.verify(verificationInput(reviewed)))).toBe(
      'grant-unavailable'
    )
    expect(await errorCode(reusedToken.verify(verificationInput(reviewed)))).toBe(
      'write-credential-not-independent'
    )
  })

  test('rejects concurrent operations and a tampered strict receipt digest', async () => {
    const reviewed = await previousReview()
    let releaseStrict: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const strictGate = new Promise<void>((resolve) => {
      releaseStrict = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          markStarted?.()
          await strictGate
          return strictResult(input)
        }
      })
    )
    const first = service.verify(verificationInput(reviewed))
    await started
    expect(await errorCode(service.verify(verificationInput(reviewed)))).toBe('already-running')
    releaseStrict?.()
    await expect(first).resolves.toBeDefined()

    const tampered = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          return { ...(await strictResult(input)), receiptDigest: 'Z'.repeat(43) }
        }
      })
    )
    expect(await errorCode(tampered.verify(verificationInput(reviewed)))).toBe(
      'verification-failed'
    )
  })

  test('persists a claim before mutation and replays the exact terminal result without redispatch', async () => {
    const reviewed = await previousReview()
    const stored = createMemoryBackendHostReleaseDispatchJournal()
    let claimedKey = ''
    const journal: BackendHostReleaseDispatchJournal = {
      ...stored,
      async claim(input) {
        claimedKey = input.singleFlightKey
        return stored.claim(input)
      }
    }
    let mutationCalls = 0
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          await input.recordMutationProgress(mutationProgress(input, 'edge-deployed'))
          return strictResult(input)
        }
      })
    )
    const firstResult = await first.verify(verificationInput(reviewed))
    const finalEvidence = await journal.readEvidence(claimedKey)

    expect(mutationCalls).toBe(1)
    expect(finalEvidence?.phase).toBe('final')
    const serializedEvidence = finalEvidence?.payload ?? ''
    for (const secret of [
      READ_PAT,
      WRITE_PAT,
      PUBLISHABLE_KEY,
      'edge_user_access_token_1234567890',
      'user_a_access_token_1234567890',
      'user_b_access_token_1234567890'
    ]) {
      expect(serializedEvidence).not.toContain(secret)
    }

    const replay = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-2',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )
    const replayed = await replay.verify(verificationInput(reviewed))
    expect(replayed).toEqual(firstResult)
    expect(replayed.receipt.verificationId).toBe('verification-1')
    expect(mutationCalls).toBe(1)
  })

  test('allows only one concurrent Host instance to cross the mutation boundary', async () => {
    const reviewed = await previousReview()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let mutationCalls = 0
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    let finish!: () => void
    const hold = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-concurrent-a',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          signalStarted()
          await hold
          return strictResult(input)
        }
      })
    )
    const second = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-concurrent-b',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )

    const winner = first.verify(verificationInput(reviewed))
    await started
    expect(await errorCode(second.verify(verificationInput(reviewed)))).toBe(
      'reconciliation-required'
    )
    expect(mutationCalls).toBe(1)
    finish()
    await expect(winner).resolves.toBeDefined()
  })

  test('keeps restart and changed-target retries locked until provider-authoritative reconciliation', async () => {
    const reviewed = await previousReview()
    const databaseName = `supabase-capability-restart-${crypto.randomUUID()}`
    const writer = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    let mutationCalls = 0
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: writer,
        nextId: () => 'verification-restart-a',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'storage-pre-dispatch'))
          mutationCalls += 1
          await input.recordMutationProgress(mutationProgress(input, 'storage-progress'))
          throw new Error('simulated process loss after Storage mutation')
        }
      })
    )
    expect(await errorCode(first.verify(verificationInput(reviewed)))).toBe(
      'reconciliation-required'
    )

    const restartedJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const restarted = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: restartedJournal,
        nextId: () => 'verification-restart-b',
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: ACCOUNT_ID,
          boundAt: '2026-09-03T03:00:00.000Z'
        }),
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'storage-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )
    const changedTargetInput = {
      ...verificationInput(reviewed),
      config: { url: PROJECT_URL, anonKey: `${PUBLISHABLE_KEY}-changed` }
    }
    expect(await errorCode(restarted.verify(changedTargetInput))).toBe('reconciliation-required')
    expect(mutationCalls).toBe(1)

    const inspection = await restarted.inspectUnresolved?.(PROJECT_REF)
    expect(inspection).toHaveLength(1)
    expect(inspection?.[0]).toMatchObject({
      outcome: 'outcome-unknown',
      evidenceIntegrity: 'verified',
      automaticRetryAllowed: false,
      providerAuthoritativeReconciliationRequired: true
    })
    expect(JSON.stringify(inspection?.[0]?.evidence)).toContain('users/user-a/probe-1.bin')
    expect(await restarted.inspectUnresolved?.(PROJECT_REF)).toHaveLength(1)
  })
})
