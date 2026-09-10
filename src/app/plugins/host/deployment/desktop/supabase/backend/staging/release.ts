import {
  validateBackendReleaseReceipt,
  type BackendReleaseProviderAuthorityV1,
  type BackendReleaseStateV1
} from '@open-pencil/lowcode/backend'
import type { SupabaseConfig } from '@open-pencil/scene-graph'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseStagingTargetBindingV1 } from '@/app/lowcode/supabase/staging-target'
import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'
import type {
  SupabaseBackendReleaseLocalAuthorityRequest,
  SupabaseBackendReleaseRunInput
} from '@/app/plugins/host/deployment/supabase/backend-release'
import type { CredentialStatus } from '@/app/settings/credentials/types'

import { backendDocumentDigest, normalizedConfig, sameAuthority, sameBuild } from '../binding'
import type { DesktopSupabaseBackendReviewResult } from '../review'

type MaybePromise<T> = T | Promise<T>

const GRANT_GENERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MAX_PAT_LENGTH = 4_096

export type DesktopSupabaseBackendStagingReleaseErrorCode =
  | 'aborted'
  | 'already-running'
  | 'backend-provider-missing'
  | 'backend-provider-unavailable'
  | 'binding-mismatch'
  | 'binding-unavailable'
  | 'credential-missing'
  | 'desktop-required'
  | 'grant-changed'
  | 'grant-unavailable'
  | 'invalid-config'
  | 'outcome-unknown'
  | 'release-failed'
  | 'review-stale'
  | 'write-credential-missing'
  | 'write-credential-not-independent'

const ERROR_MESSAGES = Object.freeze({
  aborted: 'Supabase staging Apply was cancelled.',
  'already-running': 'A Supabase staging Apply is already running.',
  'backend-provider-missing': 'This document has no Backend Provider declaration to Apply.',
  'backend-provider-unavailable':
    'The declared Supabase Backend Provider is unavailable or its authority changed.',
  'binding-mismatch': 'The saved Supabase staging target does not match the reviewed authority.',
  'binding-unavailable': 'Bind an independent Supabase staging target before Apply.',
  'credential-missing': 'A read-only Supabase Management API token is required.',
  'desktop-required': 'Supabase staging Apply is available only in the desktop app.',
  'grant-changed': 'Supabase credential authority changed during Apply. Start again.',
  'grant-unavailable': 'Supabase credential authority is unavailable. Save both tokens again.',
  'invalid-config': 'A canonical Supabase project URL is required for staging Apply.',
  'outcome-unknown':
    'Supabase staging Apply crossed the dispatch boundary and its outcome is unknown. Do not retry automatically.',
  'release-failed': 'Supabase staging Apply failed closed before producing a supported result.',
  'review-stale': 'The reviewed artifact, document, configuration, or staging binding changed.',
  'write-credential-missing': 'A separate Supabase database-write token is required for Apply.',
  'write-credential-not-independent':
    'The Supabase database-write token must be different from the read-only token.'
}) satisfies Readonly<Record<DesktopSupabaseBackendStagingReleaseErrorCode, string>>

export class DesktopSupabaseBackendStagingReleaseError extends Error {
  readonly automaticRetryAllowed: false | null
  readonly reconcileRequired: boolean

  constructor(
    readonly code: DesktopSupabaseBackendStagingReleaseErrorCode,
    readonly lastState: BackendReleaseStateV1 | null = null
  ) {
    super(ERROR_MESSAGES[code])
    this.name = 'DesktopSupabaseBackendStagingReleaseError'
    this.automaticRetryAllowed = code === 'outcome-unknown' ? false : null
    this.reconcileRequired = code === 'outcome-unknown'
  }
}

export interface DesktopSupabaseBackendStagingReleaseInput {
  readonly config: SupabaseConfig | undefined
  /** Live reread used before every remote inspection and dispatch preflight. */
  readonly readConfig?: () => SupabaseConfig | undefined
  readonly graph: AppBackendProviderDocumentGraph
  readonly reviewed: DesktopSupabaseBackendReviewResult
  readonly projectRefConfirmation: string
  readonly confirmedIndependentStaging: true
  readonly signal?: AbortSignal
  readonly onTransition?: SupabaseBackendReleaseRunInput['onTransition']
}

export interface DesktopSupabaseStrictStagingReleaseInput {
  readonly build: PreparedAppBackendProviderBuild
  readonly backendProvider: BackendReleaseProviderAuthorityV1
  readonly documentDigest: string
  readonly environment: 'staging'
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly expectedReview: DesktopSupabaseBackendReviewResult
  readonly expectedReviewArtifactDigest: string
  /** Test-only renderer transport credential; null means the fixed native vault owns the value. */
  readonly readPersonalAccessToken: string | null
  /** Transient, mutation-capable value. It must stay inside this single operation. */
  readonly writePersonalAccessToken: string
  readonly revalidateLocalAuthority: (
    input: SupabaseBackendReleaseLocalAuthorityRequest
  ) => Promise<void>
  readonly signal?: AbortSignal
  readonly onTransition?: SupabaseBackendReleaseRunInput['onTransition']
}

export interface DesktopSupabaseBackendStagingReleaseDependencies {
  prepareBuild(
    graph: AppBackendProviderDocumentGraph
  ): MaybePromise<PreparedAppBackendProviderBuild | null>
  resolveBackendProviderAuthority(
    build: PreparedAppBackendProviderBuild
  ): MaybePromise<BackendReleaseProviderAuthorityV1 | null>
  /** Legacy renderer transport seam. Exactly one read credential resolver must be configured. */
  resolveReadCredential?: () => Promise<string | null>
  /** Native-vault mode checks presence without returning the read PAT to the renderer. */
  resolveReadCredentialStatus?: () => Promise<CredentialStatus>
  resolveWriteCredential(): Promise<string | null>
  resolveGrantGeneration(): Promise<string | null>
  resolveStagingTargetBinding(): MaybePromise<SupabaseStagingTargetBindingV1 | null>
  prepareStrictStagingRelease(
    input: DesktopSupabaseStrictStagingReleaseInput
  ): Promise<BackendReleaseStateV1>
}

export type DesktopSupabaseBackendStagingReleaseOutcome =
  | 'succeeded'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'outcome-unknown'

export interface DesktopSupabaseBackendStagingReleaseResult {
  readonly outcome: DesktopSupabaseBackendStagingReleaseOutcome
  readonly state: BackendReleaseStateV1
  readonly receipt: NonNullable<BackendReleaseStateV1['receipt']>
  /** Staging verification is intentionally narrower than production release readiness. */
  readonly productionReleaseReady: false
}

export interface DesktopSupabaseBackendStagingReleaseService {
  release(
    input: DesktopSupabaseBackendStagingReleaseInput
  ): Promise<DesktopSupabaseBackendStagingReleaseResult>
}

function fail(code: DesktopSupabaseBackendStagingReleaseErrorCode): never {
  throw new DesktopSupabaseBackendStagingReleaseError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function validCredential(value: string | null): value is string {
  if (!value || value.length < 16 || value.length > MAX_PAT_LENGTH) return false
  return !/\p{Cc}/u.test(value)
}

function runtimeField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key)
}

function freezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ('value' in descriptor) freezeSnapshot(descriptor.value, seen)
  }
  return Object.freeze(value)
}

function snapshotExpectedReview(
  value: DesktopSupabaseBackendReviewResult
): DesktopSupabaseBackendReviewResult {
  try {
    return freezeSnapshot(structuredClone(value))
  } catch {
    return fail('review-stale')
  }
}

// oxlint-disable-next-line eslint(complexity) -- One auditable predicate binds every persisted review field before credentials resolve.
async function assertExpectedReview(
  reviewed: DesktopSupabaseBackendReviewResult,
  expected: Readonly<{
    build: PreparedAppBackendProviderBuild
    backendProvider: BackendReleaseProviderAuthorityV1
    documentDigest: string
    projectRef: string
    grantGeneration: string
  }>
): Promise<void> {
  const artifact = reviewed.artifact
  const manifest = artifact.manifest
  const inspected = artifact.inspectedReview
  if (
    runtimeField(artifact, 'format') !== 'openpencil.supabase-backend-review-artifact.v1' ||
    runtimeField(artifact, 'version') !== 1 ||
    runtimeField(manifest, 'format') !== 'openpencil.supabase-backend-host-review.v1' ||
    runtimeField(manifest, 'version') !== 1 ||
    manifest.environment !== 'staging' ||
    manifest.documentDigest !== expected.documentDigest ||
    reviewed.documentDigest !== expected.documentDigest ||
    reviewed.projectRef !== expected.projectRef ||
    reviewed.accountId !== manifest.remoteAuthority.accountId ||
    reviewed.grantGeneration !== expected.grantGeneration ||
    runtimeField(reviewed, 'reviewReady') !== true ||
    reviewed.blockerCount !== 0 ||
    runtimeField(reviewed, 'applyAvailable') !== false ||
    runtimeField(reviewed, 'applyPerformed') !== false ||
    manifest.compiler.applicationDigest !== expected.build.plan.applicationDigest ||
    manifest.compiler.planDigest !== expected.build.plan.planDigest ||
    manifest.compiler.emissionManifestDigest !== expected.build.emission.manifestDigest ||
    !sameAuthority(manifest.backendProvider, expected.backendProvider) ||
    manifest.remoteAuthority.projectRef !== expected.projectRef ||
    manifest.remoteAuthority.grantGeneration !== expected.grantGeneration ||
    !manifest.remoteAuthority.accountId ||
    manifest.inspectedReview.manifestDigest !== inspected.manifestDigest ||
    runtimeField(manifest.inspectedReview, 'reviewReady') !== true ||
    runtimeField(manifest.inspectedReview, 'applyAllowed') !== false ||
    runtimeField(manifest.inspectedReview, 'releaseReady') !== false ||
    runtimeField(inspected.manifest, 'reviewReady') !== true ||
    inspected.manifest.blockers.length !== 0 ||
    runtimeField(inspected.manifest, 'applyAllowed') !== false ||
    runtimeField(inspected.manifest, 'releaseReady') !== false ||
    inspected.manifest.inspectedSchemaDigest !== manifest.remoteAuthority.inspectedSchemaDigest ||
    (await digestCanonicalManifest(manifest)) !== artifact.manifestDigest
  ) {
    fail('review-stale')
  }
}

function assertStagingBinding(
  binding: SupabaseStagingTargetBindingV1 | null,
  projectRef: string,
  accountId: string
): void {
  if (!binding) fail('binding-unavailable')
  if (binding.projectRef !== projectRef || binding.accountId !== accountId) {
    fail('binding-mismatch')
  }
}

function terminalResult(state: BackendReleaseStateV1): DesktopSupabaseBackendStagingReleaseResult {
  if (state.phase !== 'receipt' || !state.receipt) {
    fail('release-failed')
  }
  const parsedReceipt = validateBackendReleaseReceipt(state.receipt)
  if (!parsedReceipt.ok || state.releaseId !== parsedReceipt.value.releaseId) {
    fail('release-failed')
  }
  const outcome = parsedReceipt.value.outcome
  if (state.outcome !== outcome) fail('release-failed')
  return Object.freeze({
    outcome,
    state,
    receipt: parsedReceipt.value,
    productionReleaseReady: false
  })
}

/**
 * Operation-scoped Desktop staging orchestration. The prior artifact remains review-only; this
 * service supplies a separate, one-shot Host authority after revalidating every bound input.
 */
export function createDesktopSupabaseBackendStagingReleaseService(
  dependencies: DesktopSupabaseBackendStagingReleaseDependencies
): DesktopSupabaseBackendStagingReleaseService {
  let active = false

  return Object.freeze({
    // oxlint-disable-next-line eslint(complexity) -- The operation intentionally keeps all authority gates in one single-flight lifecycle.
    async release(
      input: DesktopSupabaseBackendStagingReleaseInput
    ): Promise<DesktopSupabaseBackendStagingReleaseResult> {
      if (active) fail('already-running')
      active = true
      let readPersonalAccessToken: string | null = null
      let writePersonalAccessToken: string | null = null
      try {
        // Snapshot every caller-owned envelope property before the first await. The captured graph
        // reference is intentionally re-read to detect document mutations, but cannot be swapped.
        const graph = input.graph
        const config = input.config ? Object.freeze({ ...input.config }) : undefined
        const readConfig = input.readConfig
        const reviewed = snapshotExpectedReview(input.reviewed)
        const projectRefConfirmation = input.projectRefConfirmation
        const confirmedIndependentStaging = runtimeField(input, 'confirmedIndependentStaging')
        const signal = input.signal
        const onTransition = input.onTransition
        throwIfAborted(signal)
        const initialConfig = normalizedConfig(readConfig?.() ?? config)
        if (!initialConfig) fail('invalid-config')
        const { projectRef, schema } = initialConfig
        if (confirmedIndependentStaging !== true || projectRefConfirmation !== projectRef) {
          fail('binding-mismatch')
        }

        let build: PreparedAppBackendProviderBuild | null
        try {
          build = await dependencies.prepareBuild(graph)
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
        if (backendProvider?.providerId !== 'supabase') fail('backend-provider-unavailable')

        const documentDigest = await backendDocumentDigest(graph, build, projectRef, schema)
        const grantGeneration = await dependencies.resolveGrantGeneration()
        if (!grantGeneration || !GRANT_GENERATION.test(grantGeneration)) {
          fail('grant-unavailable')
        }
        try {
          await assertExpectedReview(reviewed, {
            build,
            backendProvider,
            documentDigest,
            projectRef,
            grantGeneration
          })
        } catch (cause) {
          if (cause instanceof DesktopSupabaseBackendStagingReleaseError) throw cause
          return fail('review-stale')
        }
        let initialBinding: SupabaseStagingTargetBindingV1 | null
        try {
          initialBinding = await dependencies.resolveStagingTargetBinding()
        } catch {
          return fail('binding-unavailable')
        }
        assertStagingBinding(initialBinding, projectRef, reviewed.accountId)
        throwIfAborted(signal)

        const hasReadValueResolver = dependencies.resolveReadCredential !== undefined
        const hasReadStatusResolver = dependencies.resolveReadCredentialStatus !== undefined
        if (hasReadValueResolver === hasReadStatusResolver) fail('credential-missing')
        if (dependencies.resolveReadCredentialStatus) {
          if ((await dependencies.resolveReadCredentialStatus()) !== 'configured') {
            fail('credential-missing')
          }
        } else {
          const resolveReadCredential = dependencies.resolveReadCredential
          if (!resolveReadCredential) fail('credential-missing')
          readPersonalAccessToken = await resolveReadCredential()
          if (!validCredential(readPersonalAccessToken)) fail('credential-missing')
        }
        writePersonalAccessToken = await dependencies.resolveWriteCredential()
        if (!validCredential(writePersonalAccessToken)) fail('write-credential-missing')
        if (
          readPersonalAccessToken !== null &&
          writePersonalAccessToken === readPersonalAccessToken
        ) {
          fail('write-credential-not-independent')
        }
        if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) fail('grant-changed')

        const revalidateLocalAuthority = async (): Promise<void> => {
          throwIfAborted(signal)
          if ((await dependencies.resolveGrantGeneration()) !== grantGeneration) {
            fail('grant-changed')
          }
          const currentConfig = normalizedConfig(readConfig?.() ?? config)
          let currentBuild: PreparedAppBackendProviderBuild | null
          try {
            currentBuild = await dependencies.prepareBuild(graph)
          } catch {
            return fail('review-stale')
          }
          if (
            !currentConfig ||
            currentConfig.projectRef !== projectRef ||
            !currentBuild ||
            !sameBuild(currentBuild, build) ||
            (await backendDocumentDigest(graph, currentBuild, projectRef, schema)) !==
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
          let currentBinding: SupabaseStagingTargetBindingV1 | null
          try {
            currentBinding = await dependencies.resolveStagingTargetBinding()
          } catch {
            return fail('review-stale')
          }
          assertStagingBinding(currentBinding, projectRef, reviewed.accountId)
          throwIfAborted(signal)
        }

        let state: BackendReleaseStateV1
        let dispatchObserved = false
        const wasDispatchObserved = () => dispatchObserved
        const transitionCapture: { last: BackendReleaseStateV1 | null } = { last: null }
        try {
          state = await dependencies.prepareStrictStagingRelease({
            build,
            backendProvider,
            documentDigest,
            environment: 'staging',
            projectRef,
            accountId: reviewed.accountId,
            grantGeneration,
            expectedReview: reviewed,
            expectedReviewArtifactDigest: reviewed.artifact.manifestDigest,
            readPersonalAccessToken,
            writePersonalAccessToken,
            revalidateLocalAuthority,
            signal,
            onTransition(transition) {
              transitionCapture.last = transition
              if (transition.dispatch === 'dispatched' || transition.dispatch === 'settled') {
                dispatchObserved = true
              }
              onTransition?.(transition)
            }
          })
        } catch (cause) {
          if (cause instanceof DesktopSupabaseBackendStagingReleaseError) throw cause
          const lastTransition = transitionCapture.last
          if (lastTransition?.phase === 'receipt' && lastTransition.receipt) {
            return terminalResult(lastTransition)
          }
          if (wasDispatchObserved()) {
            throw new DesktopSupabaseBackendStagingReleaseError('outcome-unknown', lastTransition)
          }
          throwIfAborted(signal)
          return fail('release-failed')
        }
        // Once the Host records dispatch, the terminal receipt is authoritative even if the caller
        // aborts at the same time. Never mask succeeded/outcome-unknown and invite a blind retry.
        return terminalResult(state)
      } finally {
        readPersonalAccessToken = null
        writePersonalAccessToken = null
        active = false
      }
    }
  })
}
