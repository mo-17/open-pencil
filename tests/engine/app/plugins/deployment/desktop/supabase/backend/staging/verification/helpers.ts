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
import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import type { DesktopSupabaseBackendReviewResult } from '@/app/plugins/host/deployment/desktop/supabase/backend/review'
import {
  DesktopSupabaseBackendStagingVerificationError,
  type DesktopSupabaseBackendStagingCapabilityReceiptV1,
  type DesktopSupabaseBackendStagingVerificationDependencies,
  type DesktopSupabaseBackendStagingVerificationResult,
  type DesktopSupabaseStrictStagingVerificationInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification'
import type { DesktopSupabaseBackendTarget } from '@/app/plugins/host/deployment/desktop/supabase/backend/target'
import type { SupabaseBackendReleaseReviewArtifactV1 } from '@/app/plugins/host/deployment/supabase/backend-release'

export const PROJECT_REF = 'enekobitnhobuiuamvqj'
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
export const ACCOUNT_ID = 'organization-1'
export const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
export const READ_PAT = 'sbp_read_secret_canary_1234567890'
export const WRITE_PAT = 'sbp_write_secret_canary_1234567890'
export const PUBLISHABLE_KEY = ['sb', 'publishable', 'test', '1234567890'].join('_')
export const NOW = '2026-09-03T02:00:00.000Z'
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

export const BUILD = await preparedBuild()
export const VUE_BUILD = await preparedBuild('vue')
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

export async function previousReview(build = BUILD): Promise<DesktopSupabaseBackendReviewResult> {
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

export async function strictResult(
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

export function mutationProgress(
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

export function dependencies(
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

export function verificationInput(reviewed: DesktopSupabaseBackendReviewResult) {
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

export async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof DesktopSupabaseBackendStagingVerificationError ? cause.code : undefined
  }
  return undefined
}
