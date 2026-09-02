import {
  createSupabaseInspectedMigrationReview,
  type SupabaseInspectedMigrationReviewV1
} from '@open-pencil/compiler/backend'
import {
  digestDataModel,
  normalizeBackendReleaseProviderAuthority,
  type BackendCredentialRef,
  type BackendReleaseDestructiveConfirmationV1,
  type BackendReleaseEnvironment,
  type BackendReleaseProviderAuthorityV1,
  type BackendReleaseStateV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { PreparedAppBackendProviderBuild } from '@/app/plugins/host/backend-provider'

import {
  BackendHostReleaseApplyError,
  createBackendHostReleaseController,
  type BackendHostReleaseConfirmationInput,
  type BackendHostReleaseInspectionInput,
  type BackendHostReleaseReviewInput,
  type BackendHostReleaseRunInput
} from '../backend/release-controller'
import { deepFreeze } from '../backend/release-controller/normalization'
import type { BackendHostReleaseDispatchJournal } from '../backend/release-journal'

type MaybePromise<T> = T | Promise<T>

export type SupabaseBackendReleaseBuild = Pick<
  PreparedAppBackendProviderBuild,
  'request' | 'plan' | 'emission'
>

export interface SupabaseBackendReleaseSnapshotEvidence {
  /** Complete, locally supplied inspection snapshot. The bridge never fetches it. */
  readonly snapshot: unknown
  /** Independently retained authority that the parsed snapshot must reproduce exactly. */
  readonly expectedInspectedSchemaDigest: string
}

export interface SupabaseBackendReleaseSnapshotRequest {
  readonly stage: BackendHostReleaseInspectionInput['stage']
  readonly projectRef: string
  readonly accountId: string
  readonly expectedTargetModelDigest: string
  readonly requiredCredentialRefs: readonly BackendCredentialRef[]
}

export interface SupabaseBackendReleaseLocalAuthorityRequest {
  readonly stage: BackendHostReleaseInspectionInput['stage']
}

export interface SupabaseBackendReleaseHostReviewManifestV1 {
  readonly format: 'openpencil.supabase-backend-host-review.v1'
  readonly version: 1
  readonly documentDigest: string
  readonly compilerVersion: string
  readonly target: string
  readonly environment: BackendReleaseEnvironment
  readonly compiler: Readonly<{
    applicationDigest: string
    planDigest: string
    emissionManifestDigest: string
  }>
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly remoteAuthority: Readonly<{
    projectRef: string
    accountId: string
    grantGeneration: string
    inspectedSchemaDigest: string
  }>
  readonly inspectedReview: Readonly<{
    manifestDigest: string
    migrationPlanDigest: string
    targetModelDigest: string
    reviewReady: boolean
    applyAllowed: false
    releaseReady: false
  }>
}

/** Review-only artifact suitable for a Desktop Host UI. It contains no credential value or Apply. */
export interface SupabaseBackendReleaseReviewArtifactV1 {
  readonly format: 'openpencil.supabase-backend-review-artifact.v1'
  readonly version: 1
  readonly manifest: SupabaseBackendReleaseHostReviewManifestV1
  readonly manifestDigest: string
  readonly inspectedReview: SupabaseInspectedMigrationReviewV1
}

export interface SupabaseBackendReleaseReviewContext {
  readonly artifact: SupabaseBackendReleaseReviewArtifactV1
  readonly release: BackendHostReleaseReviewInput
}

export interface SupabaseBackendReleaseConfirmationContext {
  readonly artifact: SupabaseBackendReleaseReviewArtifactV1
  readonly release: BackendHostReleaseConfirmationInput
}

export interface CreateSupabaseBackendReleaseOptions {
  readonly build: SupabaseBackendReleaseBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly compilerVersion: string
  readonly environment: BackendReleaseEnvironment
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly dispatchJournal: BackendHostReleaseDispatchJournal
  /**
   * Rebuild and compare the live graph/config/Provider/grant authority. Throw on any mismatch.
   * This is invoked immediately before every initial or pre-Apply remote inspection.
   */
  readonly revalidateLocalAuthority: (
    input: SupabaseBackendReleaseLocalAuthorityRequest
  ) => MaybePromise<void>
  readonly snapshotProvider: (
    input: SupabaseBackendReleaseSnapshotRequest
  ) => MaybePromise<SupabaseBackendReleaseSnapshotEvidence>
  /** Independent Backend review; this is intentionally separate from frontend deployment review. */
  readonly reviewBackendRelease: (
    input: SupabaseBackendReleaseReviewContext
  ) => MaybePromise<boolean>
  /** Independent Backend confirmation; destructive confirmations remain Release Core data. */
  readonly confirmBackendRelease: (
    input: SupabaseBackendReleaseConfirmationContext
  ) => MaybePromise<readonly BackendReleaseDestructiveConfirmationV1[] | null>
  readonly now: () => string
}

export type SupabaseBackendReleaseRunInput = Pick<
  BackendHostReleaseRunInput,
  'releaseId' | 'planId' | 'receiptId' | 'onTransition'
>

export interface SupabaseBackendRelease {
  run(input: SupabaseBackendReleaseRunInput): Promise<BackendReleaseStateV1>
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

interface ProviderAuthorityProjectionSource {
  readonly packageDigest: string
  readonly pluginId: string
  readonly contributionId: string
  readonly providerId: string
  readonly adapterId: string
  readonly adapterVersion: string
  readonly contractVersion: number
  readonly supportedModelVersions: readonly (number | string)[]
  readonly capabilities: readonly string[]
}

function providerAuthorityProjection(source: ProviderAuthorityProjectionSource) {
  return {
    packageDigest: source.packageDigest,
    pluginId: source.pluginId,
    contributionId: source.contributionId,
    providerId: source.providerId,
    adapterId: source.adapterId,
    adapterVersion: source.adapterVersion,
    contractVersion: source.contractVersion,
    supportedModelVersions: sorted(source.supportedModelVersions.map(String)),
    capabilities: sorted(source.capabilities)
  }
}

function isStrictApproval(value: unknown): value is true {
  return value === true
}

function assertBuildAuthority(
  build: SupabaseBackendReleaseBuild,
  backendProvider: BackendReleaseProviderAuthorityV1
): void {
  if (backendProvider.providerId !== 'supabase') {
    throw new TypeError('Supabase Backend Release requires exact Supabase provider authority.')
  }
  if (
    build.emission.manifest.planDigest !== build.plan.planDigest ||
    build.emission.manifest.applicationDigest !== build.plan.applicationDigest ||
    JSON.stringify(build.emission.manifest.authority) !== JSON.stringify(build.plan.authority)
  ) {
    throw new TypeError(
      'Supabase Backend Release compiler plan and emission authority do not match.'
    )
  }
  const selected = build.request.selection
  const releaseHostProjection = {
    publisherId: backendProvider.publisherId,
    ...providerAuthorityProjection(backendProvider),
    permissions: sorted(backendProvider.permissions),
    outputKinds: sorted(backendProvider.outputKinds)
  }
  const selectedHostProjection = {
    publisherId: selected.packageAuthority.publisherId,
    ...providerAuthorityProjection({
      ...selected,
      packageDigest: selected.packageAuthority.packageDigest
    }),
    permissions: sorted(selected.permissions),
    outputKinds: sorted(selected.outputKinds)
  }
  if (JSON.stringify(releaseHostProjection) !== JSON.stringify(selectedHostProjection)) {
    throw new TypeError(
      'Supabase Backend Release provider authority differs from the Host selection.'
    )
  }
  const compilerAuthority = build.plan.authority
  const releaseProjection = {
    ...providerAuthorityProjection(backendProvider),
    outputs: sorted(backendProvider.outputKinds)
  }
  const compilerProjection = {
    ...providerAuthorityProjection(compilerAuthority),
    outputs: sorted(compilerAuthority.outputs)
  }
  if (JSON.stringify(releaseProjection) !== JSON.stringify(compilerProjection)) {
    throw new TypeError(
      'Supabase Backend Release provider authority differs from the compiler plan.'
    )
  }
}

function requiredReferences(build: SupabaseBackendReleaseBuild): Readonly<{
  environmentNames: readonly string[]
  credentialRefs: readonly BackendCredentialRef[]
}> {
  const environmentNames = build.request.application.secrets.flatMap((secret) =>
    secret.kind === 'environment' && secret.required ? [secret.name] : []
  )
  const credentialRefs = build.request.application.secrets.flatMap((secret) =>
    secret.kind === 'credential' && secret.required ? [secret.credentialRef] : []
  )
  return Object.freeze({
    environmentNames: Object.freeze([...new Set(environmentNames)].sort()),
    credentialRefs: Object.freeze([...new Set(credentialRefs)].sort())
  })
}

function sameMigrationPlan(
  left: SupabaseInspectedMigrationReviewV1['manifest']['migrationPlan'],
  right: SupabaseInspectedMigrationReviewV1['manifest']['migrationPlan']
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Creates the current fail-closed Supabase Host bridge. It can inspect and present the independent
 * Backend review artifact, but its executor has no dispatch capability by construction.
 */
export function createSupabaseBackendRelease(
  options: CreateSupabaseBackendReleaseOptions
): SupabaseBackendRelease {
  const {
    build,
    backendProvider: requestedBackendProvider,
    documentDigest,
    compilerVersion,
    environment,
    projectRef,
    accountId,
    grantGeneration,
    dispatchJournal,
    revalidateLocalAuthority,
    snapshotProvider,
    reviewBackendRelease,
    confirmBackendRelease,
    now
  } = options
  const backendProvider = normalizeBackendReleaseProviderAuthority(requestedBackendProvider)
  assertBuildAuthority(build, backendProvider)
  const references = requiredReferences(build)
  const expectedTargetModelDigest = digestDataModel(build.request.application.dataModel)
  const reviewsBySchemaDigest = new Map<string, SupabaseInspectedMigrationReviewV1>()
  const artifactsByDigest = new Map<string, SupabaseBackendReleaseReviewArtifactV1>()
  let activeRun = false

  const controller = createBackendHostReleaseController({
    dispatchJournal,
    reconciler: {
      async reconcile() {
        throw new BackendHostReleaseApplyError(
          'precondition',
          'supabase-live-reconcile-unavailable'
        )
      }
    },
    inspector: {
      async inspect(input) {
        await revalidateLocalAuthority({ stage: input.stage })
        const targetModelDigest = await expectedTargetModelDigest
        const evidence = await snapshotProvider({
          stage: input.stage,
          projectRef,
          accountId,
          expectedTargetModelDigest: targetModelDigest,
          requiredCredentialRefs: input.requiredCredentialRefs
        })
        if (
          typeof evidence.expectedInspectedSchemaDigest !== 'string' ||
          evidence.expectedInspectedSchemaDigest.length === 0
        ) {
          throw new TypeError(
            'Supabase Backend Release snapshot authority requires an expected schema digest.'
          )
        }
        const inspectedReview = await createSupabaseInspectedMigrationReview({
          application: build.request.application,
          snapshot: evidence.snapshot,
          expectedProjectRef: projectRef,
          expectedAccountId: accountId,
          expectedInspectedSchemaDigest: evidence.expectedInspectedSchemaDigest,
          expectedTargetModelDigest: targetModelDigest
        })
        if (inspectedReview.manifest.applicationDigest !== build.plan.applicationDigest) {
          throw new TypeError(
            'Supabase inspected review application differs from the compiler plan authority.'
          )
        }
        reviewsBySchemaDigest.set(inspectedReview.manifest.inspectedSchemaDigest, inspectedReview)
        return {
          authority: {
            documentDigest,
            irDigest: build.plan.applicationDigest,
            inspectedSchemaDigest: inspectedReview.manifest.inspectedSchemaDigest,
            compilerVersion,
            target: build.plan.target,
            environment,
            projectId: projectRef,
            accountId,
            grantGeneration,
            backendProvider
          },
          migrationPlan: inspectedReview.manifest.migrationPlan
        }
      }
    },
    emitter: {
      async emit(input) {
        const inspectedReview = reviewsBySchemaDigest.get(
          input.plan.authority.inspectedSchemaDigest
        )
        if (
          !inspectedReview ||
          !sameMigrationPlan(input.migrationPlan, inspectedReview.manifest.migrationPlan)
        ) {
          throw new TypeError(
            'Supabase Backend Release emitter is missing its exact inspected review.'
          )
        }
        const manifest = deepFreeze({
          format: 'openpencil.supabase-backend-host-review.v1',
          version: 1,
          documentDigest,
          compilerVersion,
          target: build.plan.target,
          environment,
          compiler: {
            applicationDigest: build.plan.applicationDigest,
            planDigest: build.plan.planDigest,
            emissionManifestDigest: build.emission.manifestDigest
          },
          backendProvider,
          remoteAuthority: {
            projectRef,
            accountId,
            grantGeneration,
            inspectedSchemaDigest: inspectedReview.manifest.inspectedSchemaDigest
          },
          inspectedReview: {
            manifestDigest: inspectedReview.manifestDigest,
            migrationPlanDigest: inspectedReview.manifest.migrationPlanDigest,
            targetModelDigest: inspectedReview.manifest.targetModelDigest,
            reviewReady: inspectedReview.manifest.reviewReady,
            applyAllowed: false,
            releaseReady: false
          }
        } satisfies SupabaseBackendReleaseHostReviewManifestV1)
        const manifestDigest = await digestCanonicalManifest(manifest)
        const artifact = deepFreeze({
          format: 'openpencil.supabase-backend-review-artifact.v1',
          version: 1,
          manifest,
          manifestDigest,
          inspectedReview
        } satisfies SupabaseBackendReleaseReviewArtifactV1)
        artifactsByDigest.set(manifestDigest, artifact)
        return {
          staticArtifactDigest: null,
          serverArtifactDigest: null,
          schemaArtifactDigest: manifestDigest
        }
      }
    },
    reviewer: {
      async review(release) {
        const digest = release.artifacts.schemaArtifactDigest
        const artifact = digest ? artifactsByDigest.get(digest) : undefined
        if (!artifact) {
          throw new TypeError('Supabase Backend Release review artifact is unavailable.')
        }
        try {
          const approved = await reviewBackendRelease({ artifact, release })
          return artifact.inspectedReview.manifest.reviewReady && isStrictApproval(approved)
        } catch {
          return false
        }
      },
      async confirm(release) {
        const digest = release.artifacts.schemaArtifactDigest
        const artifact = digest ? artifactsByDigest.get(digest) : undefined
        if (!artifact || !artifact.inspectedReview.manifest.reviewReady) return null
        try {
          return await confirmBackendRelease({ artifact, release })
        } catch {
          return null
        }
      }
    },
    executor: {
      async prepareApply() {
        throw new BackendHostReleaseApplyError('precondition', 'supabase-live-apply-unavailable')
      }
    },
    verifier: {
      async verify() {
        throw new Error('Supabase verification is unreachable while live Apply is unavailable.')
      }
    },
    now
  })

  return Object.freeze({
    run(input: SupabaseBackendReleaseRunInput) {
      if (activeRun) {
        return Promise.reject(new Error('A Supabase Backend Release run is already active.'))
      }
      activeRun = true
      const cleanup = () => {
        reviewsBySchemaDigest.clear()
        artifactsByDigest.clear()
        activeRun = false
      }
      try {
        return controller
          .run({
            releaseId: input.releaseId,
            planId: input.planId,
            receiptId: input.receiptId,
            ...(input.onTransition ? { onTransition: input.onTransition } : {}),
            requiredArtifactKinds: ['schema'],
            requiredEnvironmentNames: references.environmentNames,
            requiredCredentialRefs: references.credentialRefs
          })
          .finally(cleanup)
      } catch (cause) {
        cleanup()
        throw cause
      }
    }
  })
}
