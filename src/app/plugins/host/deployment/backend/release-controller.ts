import {
  createBackendReleasePlan,
  createBackendReleaseReceipt,
  createBackendReleaseState,
  inspectBackendReleasePlanFreshness,
  normalizeBackendReleaseAuthority,
  reduceBackendReleaseState,
  type BackendCredentialRef,
  type BackendProductionGateResultV1,
  type BackendReleaseApplyErrorKind,
  type BackendReleaseArtifactKind,
  type BackendReleaseArtifactsV1,
  type BackendReleaseAuthorityV1,
  type BackendReleaseDestructiveConfirmationV1,
  type BackendReleaseReviewV1,
  type BackendReleaseStateV1,
  type MigrationPlan,
  type VerifiedBackendReleasePlanV1
} from '@open-pencil/lowcode/backend'

import { advanceJournaledApply } from './release-controller/apply'
import {
  failedVerificationGates,
  normalizedArtifactKinds,
  normalizedCredentialRefs,
  normalizedEnvironmentNames,
  normalizedMigrationPlan
} from './release-controller/normalization'
import type {
  BackendHostReleaseDispatchJournal,
  BackendHostReleaseDispatchJournalRecordV1
} from './release-journal'

type MaybePromise<T> = T | Promise<T>

interface BackendHostReleaseBoundInput {
  readonly plan: VerifiedBackendReleasePlanV1
  readonly migrationPlan: MigrationPlan
  readonly requiredEnvironmentNames: readonly string[]
  readonly requiredCredentialRefs: readonly BackendCredentialRef[]
}

export type BackendHostReleaseInspectionInput =
  | {
      readonly stage: 'initial'
      readonly plan: null
      readonly requiredCredentialRefs: readonly BackendCredentialRef[]
    }
  | (BackendHostReleaseBoundInput & {
      readonly stage: 'pre-apply'
    })

export interface BackendHostReleaseInspectionResult {
  readonly authority: BackendReleaseAuthorityV1
  /** Semantic diff derived from the exact schema snapshot bound by authority.inspectedSchemaDigest. */
  readonly migrationPlan: MigrationPlan
}

export interface BackendHostReleasePrepareApplyInput extends BackendHostReleaseReviewInput {
  readonly authority: BackendReleaseAuthorityV1
  readonly confirmations: readonly BackendReleaseDestructiveConfirmationV1[]
}

export interface BackendHostReleaseDispatchInput {
  readonly singleFlightKey: string
}

export interface BackendHostReleasePreparedApply {
  /** The only injected method allowed to begin a remote mutation. */
  dispatch(input: BackendHostReleaseDispatchInput): Promise<BackendHostReleaseApplyResult>
}

export type BackendHostReleaseEmitInput = BackendHostReleaseBoundInput

export interface BackendHostReleaseReviewInput extends BackendHostReleaseBoundInput {
  readonly artifacts: BackendReleaseArtifactsV1
}

export interface BackendHostReleaseConfirmationInput extends BackendHostReleaseReviewInput {
  readonly review: BackendReleaseReviewV1
}

export interface BackendHostReleaseVerificationInput extends BackendHostReleaseReviewInput {
  readonly authority: BackendReleaseAuthorityV1
  readonly remoteOperationIds: readonly string[]
}

export interface BackendHostReleaseReconcileInput extends BackendHostReleaseReviewInput {
  readonly authority: BackendReleaseAuthorityV1
  readonly claim: BackendHostReleaseDispatchJournalRecordV1
}

export interface BackendHostReleaseReconcileResult {
  readonly outcome: 'applied' | 'failed' | 'outcome-unknown'
  readonly code: string | null
  readonly remoteOperationIds: readonly string[]
}

export interface BackendHostReleaseReconciler {
  /** Read-only remote lookup. This capability must never begin or retry Apply. */
  reconcile(input: BackendHostReleaseReconcileInput): Promise<BackendHostReleaseReconcileResult>
}

export type BackendHostReleaseApplyResult =
  | {
      readonly ok: true
      readonly remoteOperationIds: readonly string[]
    }
  | {
      readonly ok: false
      readonly kind: BackendReleaseApplyErrorKind
      readonly code: string
      readonly remoteOperationIds?: readonly string[]
    }

export interface BackendHostReleaseControllerDependencies {
  readonly dispatchJournal: BackendHostReleaseDispatchJournal
  readonly reconciler: BackendHostReleaseReconciler
  readonly inspector: {
    inspect(input: BackendHostReleaseInspectionInput): Promise<BackendHostReleaseInspectionResult>
  }
  readonly emitter: {
    emit(input: BackendHostReleaseEmitInput): Promise<BackendReleaseArtifactsV1>
  }
  readonly reviewer: {
    review(input: BackendHostReleaseReviewInput): MaybePromise<boolean>
    confirm(
      input: BackendHostReleaseConfirmationInput
    ): MaybePromise<readonly BackendReleaseDestructiveConfirmationV1[] | null>
  }
  readonly executor: {
    /** Resolve credentials and preconditions only; this method must not mutate remote state. */
    prepareApply(
      input: BackendHostReleasePrepareApplyInput
    ): Promise<BackendHostReleasePreparedApply>
  }
  readonly verifier: {
    verify(
      input: BackendHostReleaseVerificationInput
    ): Promise<readonly BackendProductionGateResultV1[]>
  }
  readonly now: () => string
}

export interface BackendHostReleaseRunInput {
  readonly releaseId: string
  readonly planId: string
  readonly receiptId: string
  readonly requiredArtifactKinds: readonly BackendReleaseArtifactKind[]
  readonly requiredEnvironmentNames?: readonly string[]
  readonly requiredCredentialRefs?: readonly BackendCredentialRef[]
  readonly onTransition?: (state: BackendReleaseStateV1) => void
}

export interface BackendHostReleaseController {
  run(input: BackendHostReleaseRunInput): Promise<BackendReleaseStateV1>
}

/**
 * Typed error for a host executor that rejects after dispatch. Unknown thrown errors are treated as
 * transport failures because the remote outcome can no longer be proven.
 */
export class BackendHostReleaseApplyError extends Error {
  constructor(
    readonly kind: BackendReleaseApplyErrorKind,
    readonly code: string,
    readonly remoteOperationIds: readonly string[] = [],
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'BackendHostReleaseApplyError'
  }
}

function publishTransition(
  state: BackendReleaseStateV1,
  observer?: (state: BackendReleaseStateV1) => void
): BackendReleaseStateV1 {
  try {
    observer?.(state)
  } catch (cause) {
    // Observability is deliberately non-authoritative and must not interrupt a release transition.
    void cause
  }
  return state
}

function applyFailure(cause: unknown): Exclude<BackendHostReleaseApplyResult, { ok: true }> {
  if (cause instanceof BackendHostReleaseApplyError) {
    return {
      ok: false,
      kind: cause.kind,
      code: cause.code,
      remoteOperationIds: cause.remoteOperationIds
    }
  }
  return {
    ok: false,
    kind: 'transport',
    code: 'backend-release-apply-transport'
  }
}

function prepareFailure(cause: unknown): Exclude<BackendHostReleaseApplyResult, { ok: true }> {
  if (cause instanceof BackendHostReleaseApplyError) return applyFailure(cause)
  return {
    ok: false,
    kind: 'precondition',
    code: 'backend-release-apply-prepare-failed'
  }
}

function createRunner(dependencies: BackendHostReleaseControllerDependencies) {
  return async function run(input: BackendHostReleaseRunInput): Promise<BackendReleaseStateV1> {
    const releaseId = input.releaseId
    const planId = input.planId
    const receiptId = input.receiptId
    const requiredArtifactKinds = normalizedArtifactKinds(input.requiredArtifactKinds)
    const requiredCredentialRefs = normalizedCredentialRefs(input.requiredCredentialRefs)
    const requiredEnvironmentNames = normalizedEnvironmentNames(input.requiredEnvironmentNames)
    const observe = input.onTransition
    const transition = (state: BackendReleaseStateV1): BackendReleaseStateV1 =>
      publishTransition(state, observe)
    const recordReceipt = (state: BackendReleaseStateV1): BackendReleaseStateV1 => {
      const receipt = createBackendReleaseReceipt(state, { receiptId })
      return transition(reduceBackendReleaseState(state, { type: 'receipt-recorded', receipt }))
    }
    const cancel = (state: BackendReleaseStateV1, reasonCode: string): BackendReleaseStateV1 => {
      const cancelled = transition(
        reduceBackendReleaseState(state, {
          type: 'cancel-requested',
          reasonCode,
          cancelledAt: dependencies.now()
        })
      )
      return recordReceipt(cancelled)
    }
    const fail = (
      state: BackendReleaseStateV1,
      planDigest: string,
      code: string
    ): BackendReleaseStateV1 => {
      const failed = transition(
        reduceBackendReleaseState(state, {
          type: 'release-error',
          planDigest,
          code,
          occurredAt: dependencies.now()
        })
      )
      return recordReceipt(failed)
    }

    const initialInspection = await dependencies.inspector.inspect({
      stage: 'initial',
      plan: null,
      requiredCredentialRefs
    })
    const initialAuthority = normalizeBackendReleaseAuthority(initialInspection.authority)
    const migrationPlan = normalizedMigrationPlan(initialInspection.migrationPlan)
    const plan = await createBackendReleasePlan({
      planId,
      authority: initialAuthority,
      migrationPlan,
      requiredArtifactKinds,
      requiredEnvironmentNames,
      requiredCredentialRefs
    })

    let state = transition(createBackendReleaseState(releaseId))
    state = transition(
      reduceBackendReleaseState(state, {
        type: 'inspection-completed',
        authority: initialAuthority
      })
    )
    state = transition(reduceBackendReleaseState(state, { type: 'plan-created', plan }))

    const bound: BackendHostReleaseBoundInput = {
      plan,
      migrationPlan,
      requiredEnvironmentNames: plan.requiredEnvironmentNames,
      requiredCredentialRefs: plan.requiredCredentialRefs
    }
    let artifacts: BackendReleaseArtifactsV1
    try {
      const emittedArtifacts = await dependencies.emitter.emit(bound)
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'artifacts-emitted',
          planDigest: plan.planDigest,
          artifacts: emittedArtifacts
        })
      )
      if (!state.artifacts) {
        throw new TypeError('Backend Release artifacts were not retained by Release Core.')
      }
      artifacts = state.artifacts
    } catch {
      return fail(state, plan.planDigest, 'backend-release-emission-failed')
    }
    const reviewInput: BackendHostReleaseReviewInput = { ...bound, artifacts }

    let review: BackendReleaseReviewV1
    try {
      if (!(await dependencies.reviewer.review(reviewInput))) {
        return cancel(state, 'review-denied')
      }
      review = {
        planDigest: plan.planDigest,
        reviewedAt: dependencies.now(),
        destructiveOperationIds: plan.migration.operations
          .filter((operation) => operation.risk === 'destructive')
          .map((operation) => operation.operationId),
        backupRequired: plan.migration.requiresBackup
      }
      state = transition(reduceBackendReleaseState(state, { type: 'review-completed', review }))
    } catch {
      return fail(state, plan.planDigest, 'backend-release-review-failed')
    }

    try {
      const confirmations = await dependencies.reviewer.confirm({
        ...reviewInput,
        review: state.review ?? review
      })
      if (confirmations === null) return cancel(state, 'confirmation-denied')
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'release-confirmed',
          planDigest: plan.planDigest,
          confirmations
        })
      )
    } catch {
      return fail(state, plan.planDigest, 'backend-release-confirmation-failed')
    }

    let preparedApply: BackendHostReleasePreparedApply
    try {
      preparedApply = await dependencies.executor.prepareApply({
        ...reviewInput,
        authority: plan.authority,
        confirmations: state.confirmations
      })
    } catch (cause) {
      const failure = prepareFailure(cause)
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'apply-error',
          planDigest: plan.planDigest,
          kind: failure.kind,
          code: failure.code,
          occurredAt: dependencies.now(),
          ...(failure.remoteOperationIds ? { remoteOperationIds: failure.remoteOperationIds } : {})
        })
      )
      return recordReceipt(state)
    }

    // Credential resolution and every other non-mutating preflight completes before this final
    // Inspect. Only the local atomic journal claim remains before an authorized dispatch.
    let freshAuthority: BackendReleaseAuthorityV1
    let freshPlan: VerifiedBackendReleasePlanV1
    let freshMigrationPlan: MigrationPlan
    try {
      const freshInspection = await dependencies.inspector.inspect({
        stage: 'pre-apply',
        ...bound
      })
      freshAuthority = normalizeBackendReleaseAuthority(freshInspection.authority)
      freshMigrationPlan = normalizedMigrationPlan(freshInspection.migrationPlan)
      freshPlan = await createBackendReleasePlan({
        planId: plan.planId,
        authority: freshAuthority,
        migrationPlan: freshMigrationPlan,
        requiredArtifactKinds: plan.requiredArtifactKinds,
        requiredEnvironmentNames: plan.requiredEnvironmentNames,
        requiredCredentialRefs: plan.requiredCredentialRefs
      })
    } catch {
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'apply-error',
          planDigest: plan.planDigest,
          kind: 'precondition',
          code: 'backend-release-reinspection-failed',
          occurredAt: dependencies.now()
        })
      )
      return recordReceipt(state)
    }
    const snapshot = { planDigest: freshPlan.planDigest, authority: freshAuthority }
    const freshness = await inspectBackendReleasePlanFreshness(plan, snapshot)
    if (freshness.stale) {
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'apply-error',
          planDigest: plan.planDigest,
          kind: 'precondition',
          code: 'release-plan-stale',
          occurredAt: dependencies.now()
        })
      )
      return recordReceipt(state)
    }
    state = transition(
      reduceBackendReleaseState(state, {
        type: 'apply-reinspection-completed',
        snapshot
      })
    )

    state = await advanceJournaledApply({
      dispatchJournal: dependencies.dispatchJournal,
      reconciler: dependencies.reconciler,
      now: dependencies.now,
      releaseId,
      ownerId: receiptId,
      state,
      plan,
      freshPlan,
      freshMigrationPlan,
      freshAuthority,
      reviewInput,
      preparedApply,
      applyFailure,
      transition
    })
    if (state.phase === 'receipt') return recordReceipt(state)
    const verificationInput: BackendHostReleaseVerificationInput = {
      ...reviewInput,
      plan: freshPlan,
      migrationPlan: freshMigrationPlan,
      authority: freshAuthority,
      remoteOperationIds: state.remoteOperationIds
    }
    try {
      const gates = await dependencies.verifier.verify(verificationInput)
      const verifiedAt = dependencies.now()
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'verification-completed',
          planDigest: plan.planDigest,
          gates,
          verifiedAt
        })
      )
    } catch {
      const verifiedAt = dependencies.now()
      state = transition(
        reduceBackendReleaseState(state, {
          type: 'verification-completed',
          planDigest: plan.planDigest,
          gates: failedVerificationGates(),
          verifiedAt
        })
      )
    }
    return recordReceipt(state)
  }
}

/**
 * Creates a host-only orchestrator. Every operation with side effects is an injected capability;
 * the controller itself has no network, filesystem, Supabase, or credential-value access.
 */
export function createBackendHostReleaseController(
  dependencies: BackendHostReleaseControllerDependencies
): BackendHostReleaseController {
  return Object.freeze({ run: createRunner(dependencies) })
}
