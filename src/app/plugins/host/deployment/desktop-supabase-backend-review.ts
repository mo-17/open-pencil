import type { BackendReleaseProviderAuthorityV1 } from '@open-pencil/lowcode/backend'
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL
} from '@/app/lowcode/supabase/management-client'

import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '../backend-provider'
import type {
  SupabaseBackendReleaseLocalAuthorityRequest,
  SupabaseBackendReleaseReviewArtifactV1
} from './supabase/backend-release'

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
  | 'review-failed'
  | 'review-stale'

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
  'review-failed': 'Supabase Backend Provider review failed closed before Apply.',
  'review-stale': 'The document or Supabase configuration changed during review. Review again.'
}) satisfies Readonly<Record<DesktopSupabaseBackendReviewErrorCode, string>>

export class DesktopSupabaseBackendReviewError extends Error {
  constructor(readonly code: DesktopSupabaseBackendReviewErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = 'DesktopSupabaseBackendReviewError'
  }
}

export interface DesktopSupabaseBackendReviewInput {
  readonly config: SupabaseConfig | undefined
  /** Live reread used to reject configuration changes that happen during network inspection. */
  readonly readConfig?: () => SupabaseConfig | undefined
  readonly graph: AppBackendProviderDocumentGraph
  readonly signal?: AbortSignal
}

export interface DesktopSupabaseStrictReviewInput {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly environment: 'staging'
  readonly projectRef: string
  readonly grantGeneration: string
  /** Transient only. Implementations must not retain or return this value. */
  readonly personalAccessToken: string
  /** Rebuilds the live local authority immediately before each remote catalog inspection. */
  readonly revalidateLocalAuthority: (
    input: SupabaseBackendReleaseLocalAuthorityRequest
  ) => Promise<void>
  readonly signal?: AbortSignal
}

export interface DesktopSupabaseBackendReviewDependencies {
  prepareBuild(
    graph: AppBackendProviderDocumentGraph
  ): MaybePromise<PreparedAppBackendProviderBuild | null>
  resolveBackendProviderAuthority(
    build: PreparedAppBackendProviderBuild
  ): MaybePromise<BackendReleaseProviderAuthorityV1 | null>
  resolveCredential(): Promise<string | null>
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

function validCredential(value: string | null): value is string {
  if (!value || value.length < 16 || value.length > MAX_PAT_LENGTH) return false
  return !/\p{Cc}/u.test(value)
}

function sameAuthority(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sameBuild(
  left: PreparedAppBackendProviderBuild,
  right: PreparedAppBackendProviderBuild
): boolean {
  return (
    JSON.stringify(left.request) === JSON.stringify(right.request) &&
    left.plan.applicationDigest === right.plan.applicationDigest &&
    left.plan.planDigest === right.plan.planDigest &&
    left.emission.manifestDigest === right.emission.manifestDigest
  )
}

function normalizedConfig(
  value: SupabaseConfig | undefined
): Readonly<{ projectRef: string; schema: 'public' }> | null {
  try {
    const projectRef = projectRefFromSupabaseURL(value?.url ?? '')
    const schema = normalizeSupabaseSchemaName(value?.schema)
    return schema === 'public' ? Object.freeze({ projectRef, schema }) : null
  } catch {
    return null
  }
}

async function backendDocumentDigest(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild,
  projectRef: string,
  schema: 'public'
): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: graph.rootId,
    projectRef,
    schema,
    backendProviderRequest: build.request
  })
}

interface ExpectedReviewArtifactAuthority {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly projectRef: string
  readonly grantGeneration: string
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
    manifest.documentDigest === expected.documentDigest &&
    manifest.compiler.applicationDigest === expected.build.plan.applicationDigest &&
    manifest.compiler.planDigest === expected.build.plan.planDigest &&
    manifest.compiler.emissionManifestDigest === expected.build.emission.manifestDigest &&
    sameAuthority(manifest.backendProvider, expected.backendProvider) &&
    manifest.remoteAuthority.projectRef === expected.projectRef &&
    manifest.remoteAuthority.grantGeneration === expected.grantGeneration &&
    Boolean(manifest.remoteAuthority.accountId)
  )
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
        throwIfAborted(input.signal)
        const initialConfig = normalizedConfig(input.readConfig?.() ?? input.config)
        if (!initialConfig) fail('invalid-config')
        const { projectRef, schema } = initialConfig

        let build: PreparedAppBackendProviderBuild | null
        try {
          build = await dependencies.prepareBuild(input.graph)
        } catch {
          return fail('backend-provider-unavailable')
        }
        if (!build) fail('backend-provider-missing')
        if (build.descriptor.providerId !== 'supabase') fail('backend-provider-unavailable')

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
        personalAccessToken = await dependencies.resolveCredential()
        if (!validCredential(personalAccessToken)) fail('credential-missing')
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
            currentBuild = await dependencies.prepareBuild(input.graph)
          } catch {
            return fail('review-stale')
          }
          if (
            !currentConfig ||
            currentConfig.projectRef !== projectRef ||
            !currentBuild ||
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
          grantGeneration
        })
        if (JSON.stringify(artifact).includes(personalAccessToken)) fail('artifact-invalid')

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
