import {
  digestStagedMigrationExecutionPlan,
  validateStagedMigrationExecutionPlan,
  type BackendReleaseProviderAuthorityV1,
  type StagedMigrationExecutionPlanV1
} from '@open-pencil/lowcode/backend'
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import type {
  SupabaseBackendReleaseLocalAuthorityRequest,
  SupabaseBackendReleaseReviewArtifactV1
} from '@/app/plugins/host/deployment/supabase/backend-release'
import type { CredentialStatus } from '@/app/settings/credentials/types'

import { backendDocumentDigest, normalizedConfig, sameAuthority, sameBuild } from './binding'
import { isDesktopSupabaseBackendTarget, type DesktopSupabaseBackendTarget } from './target'

type MaybePromise<T> = T | Promise<T>

const GRANT_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_PAT_LENGTH = 4_096

export type DesktopSupabaseBackendReviewErrorCode =
  | 'aborted'
  | 'already-running'
  | 'artifact-invalid'
  | 'backend-provider-missing'
  | 'backend-provider-unavailable'
  | 'credential-missing'
  | 'desktop-required'
  | 'grant-changed'
  | 'grant-unavailable'
  | 'invalid-config'
  | 'invalid-target'
  | 'review-failed'
  | 'review-stale'
  | 'staged-plan-invalid'

const ERROR_MESSAGES = Object.freeze({
  aborted: 'Supabase Backend Provider review was cancelled.',
  'already-running': 'A Supabase Backend Provider review is already running.',
  'artifact-invalid': 'Supabase Backend Provider review returned an invalid authority artifact.',
  'backend-provider-missing': 'This document has no Backend Provider declaration to review.',
  'backend-provider-unavailable':
    'The declared Supabase Backend Provider is unavailable or its authority changed.',
  'credential-missing': 'A Supabase Management API personal access token is required.',
  'desktop-required': 'Supabase Backend Provider review is available only in the desktop app.',
  'grant-changed': 'Supabase credential authority changed during review. Start the review again.',
  'grant-unavailable': 'Supabase credential authority is unavailable. Save the token again.',
  'invalid-config': 'A canonical Supabase project URL is required for Backend Provider review.',
  'invalid-target': 'Supabase Backend Provider review supports only React and Vue targets.',
  'review-failed': 'Supabase Backend Provider review failed closed before Apply.',
  'review-stale': 'The document or Supabase configuration changed during review. Review again.',
  'staged-plan-invalid': 'The staged migration execution plan is invalid or unsafe.'
}) satisfies Readonly<Record<DesktopSupabaseBackendReviewErrorCode, string>>

export class DesktopSupabaseBackendReviewError extends Error {
  constructor(readonly code: DesktopSupabaseBackendReviewErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'DesktopSupabaseBackendReviewError'
  }
}

export interface DesktopSupabaseBackendReviewInput {
  /** Omitted targets preserve the existing React review behavior. */
  readonly target?: DesktopSupabaseBackendTarget
  readonly config: SupabaseConfig | undefined
  /** Live reread used to reject configuration changes that happen during network inspection. */
  readonly readConfig?: () => SupabaseConfig | undefined
  readonly graph: AppBackendProviderDocumentGraph
  /** Optional transient, secret-free expand/backfill/contract plan selected for this review. */
  readonly stagedExecutionPlan?: unknown
  readonly signal?: AbortSignal
}

export interface DesktopSupabaseStrictReviewInput {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly environment: 'staging'
  readonly projectRef: string
  readonly grantGeneration: string
  readonly stagedExecutionPlan?: StagedMigrationExecutionPlanV1
  /** Test-only renderer transport credential; null means the fixed native vault owns the value. */
  readonly personalAccessToken: string | null
  /** Rebuilds the live local authority immediately before each remote catalog inspection. */
  readonly revalidateLocalAuthority: (
    input: SupabaseBackendReleaseLocalAuthorityRequest
  ) => Promise<void>
  readonly signal?: AbortSignal
}

export interface DesktopSupabaseBackendReviewDependencies {
  prepareBuild(
    graph: AppBackendProviderDocumentGraph,
    target: DesktopSupabaseBackendTarget
  ): MaybePromise<PreparedAppBackendProviderBuild | null>
  resolveBackendProviderAuthority(
    build: PreparedAppBackendProviderBuild
  ): MaybePromise<BackendReleaseProviderAuthorityV1 | null>
  /** Legacy renderer transport seam. Exactly one credential resolver must be configured. */
  resolveCredential?: () => Promise<string | null>
  /** Native-vault mode checks presence without returning the PAT to the renderer. */
  resolveCredentialStatus?: () => Promise<CredentialStatus>
  resolveGrantGeneration(): Promise<string | null>
  prepareStrictReview(
    input: DesktopSupabaseStrictReviewInput
  ): Promise<SupabaseBackendReleaseReviewArtifactV1>
}

export interface DesktopSupabaseBackendReviewResult {
  readonly artifact: SupabaseBackendReleaseReviewArtifactV1
  readonly documentDigest: string
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly reviewReady: boolean
  readonly blockerCount: number
  readonly applyAvailable: false
  readonly applyPerformed: false
}

export interface DesktopSupabaseBackendReviewService {
  review(input: DesktopSupabaseBackendReviewInput): Promise<DesktopSupabaseBackendReviewResult>
}

function fail(code: DesktopSupabaseBackendReviewErrorCode): never {
  throw new DesktopSupabaseBackendReviewError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function reviewTarget(value: unknown): DesktopSupabaseBackendTarget {
  const target = value === undefined ? 'react' : value
  if (!isDesktopSupabaseBackendTarget(target)) fail('invalid-target')
  return target
}

function hasReviewBuildTarget(
  build: PreparedAppBackendProviderBuild,
  target: DesktopSupabaseBackendTarget
): boolean {
  return (
    build.descriptor.providerId === 'supabase' &&
    build.plan.target === target &&
    build.emission.manifest.target === target
  )
}

function validCredential(value: string | null): value is string {
  if (!value || value.length < 16 || value.length > MAX_PAT_LENGTH) return false
  return !/\p{Cc}/u.test(value)
}

async function resolveReviewPersonalAccessToken(
  dependencies: Pick<
    DesktopSupabaseBackendReviewDependencies,
    'resolveCredential' | 'resolveCredentialStatus'
  >
): Promise<string | null> {
  const hasValueResolver = dependencies.resolveCredential !== undefined
  const hasStatusResolver = dependencies.resolveCredentialStatus !== undefined
  if (hasValueResolver === hasStatusResolver) fail('credential-missing')

  if (dependencies.resolveCredentialStatus) {
    if ((await dependencies.resolveCredentialStatus()) !== 'configured') {
      fail('credential-missing')
    }
    return null
  }

  const personalAccessToken = (await dependencies.resolveCredential?.()) ?? null
  if (!validCredential(personalAccessToken)) fail('credential-missing')
  return personalAccessToken
}

interface ExpectedReviewArtifactAuthority {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly projectRef: string
  readonly grantGeneration: string
  readonly stagedExecutionPlanDigest: string | null
}

function runtimeField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key)
}

function hasStrictReviewEnvelope(artifact: SupabaseBackendReleaseReviewArtifactV1): boolean {
  const manifest = artifact.manifest
  return (
    runtimeField(artifact, 'format') === 'openpencil.supabase-backend-review-artifact.v1' &&
    runtimeField(artifact, 'version') === 1 &&
    runtimeField(manifest, 'format') === 'openpencil.supabase-backend-host-review.v1' &&
    runtimeField(manifest, 'version') === 1 &&
    manifest.environment === 'staging'
  )
}

function matchesReviewAuthority(
  artifact: SupabaseBackendReleaseReviewArtifactV1,
  expected: ExpectedReviewArtifactAuthority
): boolean {
  const manifest = artifact.manifest
  return (
    manifest.target === expected.build.plan.target &&
    manifest.documentDigest === expected.documentDigest &&
    manifest.compiler.applicationDigest === expected.build.plan.applicationDigest &&
    manifest.compiler.planDigest === expected.build.plan.planDigest &&
    manifest.compiler.emissionManifestDigest === expected.build.emission.manifestDigest &&
    sameAuthority(manifest.backendProvider, expected.backendProvider) &&
    manifest.remoteAuthority.projectRef === expected.projectRef &&
    manifest.remoteAuthority.grantGeneration === expected.grantGeneration &&
    artifact.inspectedReview.manifest.stagedExecutionPlanDigest ===
      expected.stagedExecutionPlanDigest &&
    Boolean(manifest.remoteAuthority.accountId)
  )
}

function normalizedStagedExecutionPlan(value: unknown): StagedMigrationExecutionPlanV1 | undefined {
  if (value === undefined) return undefined
  const parsed = validateStagedMigrationExecutionPlan(value)
  if (!parsed.ok) fail('staged-plan-invalid')
  try {
    return Object.freeze(structuredClone(parsed.value))
  } catch {
    return fail('staged-plan-invalid')
  }
}

function isReviewOnlyArtifact(artifact: SupabaseBackendReleaseReviewArtifactV1): boolean {
  const manifest = artifact.manifest
  const inspected = artifact.inspectedReview
  return (
    runtimeField(manifest.inspectedReview, 'applyAllowed') === false &&
    runtimeField(manifest.inspectedReview, 'releaseReady') === false &&
    runtimeField(inspected.manifest, 'applyAllowed') === false &&
    runtimeField(inspected.manifest, 'releaseReady') === false &&
    inspected.manifest.reviewReady === manifest.inspectedReview.reviewReady &&
    inspected.manifestDigest === manifest.inspectedReview.manifestDigest &&
    inspected.manifest.inspectedSchemaDigest === manifest.remoteAuthority.inspectedSchemaDigest
  )
}

async function validateArtifact(
  artifact: SupabaseBackendReleaseReviewArtifactV1,
  expected: ExpectedReviewArtifactAuthority
): Promise<void> {
  if (
    !hasStrictReviewEnvelope(artifact) ||
    !matchesReviewAuthority(artifact, expected) ||
    !isReviewOnlyArtifact(artifact)
  ) {
    fail('artifact-invalid')
  }
  if ((await digestCanonicalManifest(artifact.manifest)) !== artifact.manifestDigest) {
    fail('artifact-invalid')
  }
}

/**
 * Review-only Desktop orchestration. It re-resolves credential generation and Provider authority
 * around the network-bound inspection, and never exposes a confirmation or Apply callback.
 */
export function createDesktopSupabaseBackendReviewService(
  dependencies: DesktopSupabaseBackendReviewDependencies
): DesktopSupabaseBackendReviewService {
  let active = false

  return Object.freeze({
    async review(
      input: DesktopSupabaseBackendReviewInput
    ): Promise<DesktopSupabaseBackendReviewResult> {
      if (active) fail('already-running')
      active = true
      let personalAccessToken: string | null = null
      try {
        const target = reviewTarget(input.target)
        throwIfAborted(input.signal)
        const stagedExecutionPlan = normalizedStagedExecutionPlan(input.stagedExecutionPlan)
        const stagedExecutionPlanDigest = stagedExecutionPlan
          ? await digestStagedMigrationExecutionPlan(stagedExecutionPlan)
          : null
        const initialConfig = normalizedConfig(input.readConfig?.() ?? input.config)
        if (!initialConfig) fail('invalid-config')
        const { projectRef, schema } = initialConfig

        let build: PreparedAppBackendProviderBuild | null
        try {
          build = await dependencies.prepareBuild(input.graph, target)
        } catch {
          return fail('backend-provider-unavailable')
        }
        if (!build) fail('backend-provider-missing')
        if (!hasReviewBuildTarget(build, target)) fail('backend-provider-unavailable')

        let backendProvider: BackendReleaseProviderAuthorityV1 | null
        try {
          backendProvider = await dependencies.resolveBackendProviderAuthority(build)
        } catch {
          return fail('backend-provider-unavailable')
        }
        if (backendProvider?.providerId !== 'supabase') {
          fail('backend-provider-unavailable')
        }
        const documentDigest = await backendDocumentDigest(input.graph, build, projectRef, schema)
        throwIfAborted(input.signal)

        const grantGeneration = await dependencies.resolveGrantGeneration()
        if (!grantGeneration || !GRANT_GENERATION.test(grantGeneration)) {
          fail('grant-unavailable')
        }
        personalAccessToken = await resolveReviewPersonalAccessToken(dependencies)
        if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) {
          fail('grant-changed')
        }
        throwIfAborted(input.signal)

        const revalidateLocalAuthority = async (): Promise<void> => {
          throwIfAborted(input.signal)
          if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) {
            fail('grant-changed')
          }
          const currentConfig = normalizedConfig(input.readConfig?.() ?? input.config)
          let currentBuild: PreparedAppBackendProviderBuild | null
          try {
            currentBuild = await dependencies.prepareBuild(input.graph, target)
          } catch {
            return fail('review-stale')
          }
          if (
            !currentConfig ||
            currentConfig.projectRef !== projectRef ||
            !currentBuild ||
            !hasReviewBuildTarget(currentBuild, target) ||
            !sameBuild(currentBuild, build) ||
            (await backendDocumentDigest(input.graph, currentBuild, projectRef, schema)) !==
              documentDigest
          ) {
            fail('review-stale')
          }
          let currentAuthority: BackendReleaseProviderAuthorityV1 | null
          try {
            currentAuthority = await dependencies.resolveBackendProviderAuthority(currentBuild)
          } catch {
            return fail('backend-provider-unavailable')
          }
          if (!currentAuthority || !sameAuthority(currentAuthority, backendProvider)) {
            fail('backend-provider-unavailable')
          }
          throwIfAborted(input.signal)
        }

        let artifact: SupabaseBackendReleaseReviewArtifactV1
        try {
          artifact = await dependencies.prepareStrictReview({
            build,
            backendProvider,
            documentDigest,
            environment: 'staging',
            projectRef,
            grantGeneration,
            ...(stagedExecutionPlan ? { stagedExecutionPlan } : {}),
            personalAccessToken,
            revalidateLocalAuthority: () => revalidateLocalAuthority(),
            signal: input.signal
          })
        } catch (cause) {
          throwIfAborted(input.signal)
          if (cause instanceof DesktopSupabaseBackendReviewError) throw cause
          return fail('review-failed')
        }
        throwIfAborted(input.signal)
        await revalidateLocalAuthority()
        await validateArtifact(artifact, {
          build,
          backendProvider,
          documentDigest,
          projectRef,
          grantGeneration,
          stagedExecutionPlanDigest
        })
        if (
          personalAccessToken !== null &&
          JSON.stringify(artifact).includes(personalAccessToken)
        ) {
          fail('artifact-invalid')
        }

        return Object.freeze({
          artifact,
          documentDigest,
          projectRef,
          accountId: artifact.manifest.remoteAuthority.accountId,
          grantGeneration,
          reviewReady: artifact.inspectedReview.manifest.reviewReady,
          blockerCount: artifact.inspectedReview.manifest.blockers.length,
          applyAvailable: false,
          applyPerformed: false
        })
      } finally {
        personalAccessToken = null
        active = false
      }
    }
  })
}
