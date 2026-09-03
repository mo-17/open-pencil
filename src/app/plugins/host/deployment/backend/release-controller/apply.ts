import {
  backendReleaseDispatchScopeKey,
  backendReleaseSingleFlightKey,
  reduceBackendReleaseState,
  type BackendReleaseAuthorityV1,
  type BackendReleaseStateV1,
  type MigrationPlan,
  type VerifiedBackendReleasePlanV1
} from '@open-pencil/lowcode/backend'

import type {
  BackendHostReleaseApplyResult,
  BackendHostReleasePreparedApply,
  BackendHostReleaseReconciler,
  BackendHostReleaseReviewInput
} from '../release-controller'
import {
  BACKEND_RELEASE_DISPATCH_LEASE_MS,
  BackendHostReleaseUnresolvedScopeError,
  type BackendHostReleaseDispatchClaimResult,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecord
} from '../release-journal'
import {
  claimBackendReleaseDispatch,
  reconcileBackendReleaseDispatch,
  settlementForApplyResult,
  settleBackendReleaseDispatch,
  unknownSettlement
} from './journal'

type ApplyFailure = (
  cause: unknown
) => Exclude<BackendHostReleaseApplyResult, { readonly ok: true }>

interface JournaledApplyInput {
  readonly dispatchJournal: BackendHostReleaseDispatchJournal
  readonly reconciler: BackendHostReleaseReconciler
  readonly now: () => string
  readonly releaseId: string
  readonly ownerId: string
  readonly state: BackendReleaseStateV1
  readonly plan: VerifiedBackendReleasePlanV1
  readonly freshPlan: VerifiedBackendReleasePlanV1
  readonly freshMigrationPlan: MigrationPlan
  readonly freshAuthority: BackendReleaseAuthorityV1
  readonly reviewInput: BackendHostReleaseReviewInput
  readonly preparedApply: BackendHostReleasePreparedApply
  readonly applyFailure: ApplyFailure
  readonly transition: (state: BackendReleaseStateV1) => BackendReleaseStateV1
}

function journalClaimFailure(input: JournaledApplyInput): BackendReleaseStateV1 {
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'release-error',
      planDigest: input.plan.planDigest,
      code: 'backend-release-journal-claim-failed',
      occurredAt: input.now()
    })
  )
}

function unresolvedScope(
  input: JournaledApplyInput,
  singleFlightKey: string
): BackendReleaseStateV1 {
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey,
      outcome: 'outcome-unknown',
      code: 'backend-release-unresolved-scope',
      remoteOperationIds: [],
      reconciledAt: input.now()
    })
  )
}

function settlementFailure(
  input: JournaledApplyInput,
  state: BackendReleaseStateV1,
  result: BackendHostReleaseApplyResult
): BackendReleaseStateV1 {
  return input.transition(
    reduceBackendReleaseState(state, {
      type: 'apply-error',
      planDigest: input.plan.planDigest,
      kind: 'transport',
      code: 'backend-release-journal-settle-failed',
      occurredAt: input.now(),
      remoteOperationIds: result.remoteOperationIds ?? []
    })
  )
}

async function dispatchNewClaim(
  input: JournaledApplyInput,
  claim: BackendHostReleaseDispatchClaimResult
): Promise<BackendReleaseStateV1> {
  const singleFlightKey = claim.record.singleFlightKey
  let state = input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-dispatched',
      planDigest: input.plan.planDigest,
      singleFlightKey,
      dispatchedAt: input.now()
    })
  )
  let result: BackendHostReleaseApplyResult
  try {
    result = await input.preparedApply.dispatch({ singleFlightKey })
  } catch (cause) {
    result = input.applyFailure(cause)
  }
  try {
    await settleBackendReleaseDispatch(
      input.dispatchJournal,
      settlementForApplyResult(claim.record, result, input.now())
    )
  } catch {
    return settlementFailure(input, state, result)
  }
  if (!result.ok) {
    return input.transition(
      reduceBackendReleaseState(state, {
        type: 'apply-error',
        planDigest: input.plan.planDigest,
        kind: result.kind,
        code: result.code,
        occurredAt: input.now(),
        ...(result.remoteOperationIds ? { remoteOperationIds: result.remoteOperationIds } : {})
      })
    )
  }
  state = input.transition(
    reduceBackendReleaseState(state, {
      type: 'apply-completed',
      planDigest: input.plan.planDigest,
      remoteOperationIds: result.remoteOperationIds,
      completedAt: input.now()
    })
  )
  return state
}

function syntheticUnknown(
  record: BackendHostReleaseDispatchJournalRecord
): BackendHostReleaseDispatchJournalRecord {
  return { ...record, outcome: 'outcome-unknown' }
}

async function settleReconciliationFailure(
  input: JournaledApplyInput,
  record: BackendHostReleaseDispatchJournalRecord
): Promise<BackendHostReleaseDispatchJournalRecord> {
  if (record.outcome !== 'pending') return record
  try {
    return await settleBackendReleaseDispatch(
      input.dispatchJournal,
      unknownSettlement(record, input.now(), 'backend-release-reconciliation-failed')
    )
  } catch {
    return syntheticUnknown(record)
  }
}

async function resolveExistingClaim(
  input: JournaledApplyInput,
  record: BackendHostReleaseDispatchJournalRecord
): Promise<BackendHostReleaseDispatchJournalRecord> {
  if (record.outcome === 'applied' || record.outcome === 'failed') return record
  let proposed
  try {
    proposed = await reconcileBackendReleaseDispatch(
      input.reconciler,
      {
        ...input.reviewInput,
        plan: input.freshPlan,
        migrationPlan: input.freshMigrationPlan,
        authority: input.freshAuthority,
        claim: record
      },
      input.now()
    )
  } catch {
    return settleReconciliationFailure(input, record)
  }
  if (record.outcome === 'outcome-unknown' && proposed.outcome === 'outcome-unknown') {
    return record
  }
  try {
    return await settleBackendReleaseDispatch(input.dispatchJournal, proposed)
  } catch {
    return syntheticUnknown(record)
  }
}

function reconciliationCode(
  outcome: 'applied' | 'failed' | 'outcome-unknown',
  resolution: BackendHostReleaseDispatchJournalRecord
): string | null {
  if (outcome === 'applied') return null
  if (resolution.settledAt === null) return 'backend-release-journal-settle-failed'
  return resolution.code ?? 'backend-release-reconciliation-failed'
}

function canonicalTimestampMilliseconds(value: string): number {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError('Backend Release journal time must be a canonical ISO timestamp.')
  }
  return milliseconds
}

function leaseExpiration(claimedAt: string): string {
  return new Date(
    canonicalTimestampMilliseconds(claimedAt) + BACKEND_RELEASE_DISPATCH_LEASE_MS
  ).toISOString()
}

function pendingLeaseIsActive(
  record: BackendHostReleaseDispatchJournalRecord,
  observedAt: string
): boolean {
  return (
    record.outcome === 'pending' &&
    canonicalTimestampMilliseconds(observedAt) <
      canonicalTimestampMilliseconds(record.leaseExpiresAt)
  )
}

function blockedByActiveLease(
  input: JournaledApplyInput,
  singleFlightKey: string,
  record: BackendHostReleaseDispatchJournalRecord,
  reconciledAt: string
): BackendReleaseStateV1 {
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey,
      outcome: 'outcome-unknown',
      code: 'backend-release-dispatch-in-flight',
      remoteOperationIds: record.remoteOperationIds,
      reconciledAt
    })
  )
}

function reconciledState(
  input: JournaledApplyInput,
  singleFlightKey: string,
  resolution: BackendHostReleaseDispatchJournalRecord
): BackendReleaseStateV1 {
  const outcome = resolution.outcome === 'pending' ? 'outcome-unknown' : resolution.outcome
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey,
      outcome,
      code: reconciliationCode(outcome, resolution),
      remoteOperationIds: resolution.remoteOperationIds,
      reconciledAt: input.now()
    })
  )
}

function reconciledPriorClaimState(
  input: JournaledApplyInput,
  singleFlightKey: string,
  resolution: BackendHostReleaseDispatchJournalRecord
): BackendReleaseStateV1 {
  const code =
    resolution.outcome === 'applied'
      ? 'backend-release-prior-claim-applied-review-required'
      : 'backend-release-prior-claim-failed-review-required'
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey,
      outcome: 'failed',
      code,
      // The current plan never owned the prior claim's provider operation identifiers.
      remoteOperationIds: [],
      reconciledAt: input.now()
    })
  )
}

async function reconcileExistingClaim(
  input: JournaledApplyInput,
  claim: BackendHostReleaseDispatchClaimResult,
  observedAt: string
): Promise<BackendReleaseStateV1> {
  if (pendingLeaseIsActive(claim.record, observedAt)) {
    return blockedByActiveLease(input, claim.record.singleFlightKey, claim.record, observedAt)
  }
  const resolution = await resolveExistingClaim(input, claim.record)
  return reconciledState(input, claim.record.singleFlightKey, resolution)
}

async function reconcileUnresolvedScope(
  input: JournaledApplyInput,
  singleFlightKey: string,
  dispatchScopeKey: string,
  observedAt: string
): Promise<BackendReleaseStateV1> {
  let records: readonly BackendHostReleaseDispatchJournalRecord[]
  try {
    records = await input.dispatchJournal.listUnresolvedForScope(dispatchScopeKey)
  } catch {
    return unresolvedScope(input, singleFlightKey)
  }
  const record = records[0]
  if (
    records.length !== 1 ||
    record.singleFlightKey === singleFlightKey ||
    (record.outcome !== 'pending' && record.outcome !== 'outcome-unknown')
  ) {
    return unresolvedScope(input, singleFlightKey)
  }
  try {
    if (pendingLeaseIsActive(record, observedAt)) {
      return blockedByActiveLease(input, singleFlightKey, record, observedAt)
    }
    const resolution = await resolveExistingClaim(input, record)
    if (resolution.outcome !== 'applied' && resolution.outcome !== 'failed') {
      return unresolvedScope(input, singleFlightKey)
    }
    return reconciledPriorClaimState(input, singleFlightKey, resolution)
  } catch {
    return unresolvedScope(input, singleFlightKey)
  }
}

export async function advanceJournaledApply(
  input: JournaledApplyInput
): Promise<BackendReleaseStateV1> {
  const singleFlightKey = backendReleaseSingleFlightKey(input.plan, input.reviewInput.artifacts)
  const dispatchScopeKey = backendReleaseDispatchScopeKey(input.plan)
  let claim: BackendHostReleaseDispatchClaimResult
  let observedAt: string | null = null
  try {
    observedAt = input.now()
    claim = await claimBackendReleaseDispatch(input.dispatchJournal, {
      singleFlightKey,
      dispatchScopeKey,
      releaseId: input.releaseId,
      ownerId: input.ownerId,
      planDigest: input.plan.planDigest,
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiration(observedAt)
    })
  } catch (cause) {
    if (cause instanceof BackendHostReleaseUnresolvedScopeError && observedAt !== null) {
      return reconcileUnresolvedScope(input, singleFlightKey, dispatchScopeKey, observedAt)
    }
    return journalClaimFailure(input)
  }
  return claim.claimed
    ? dispatchNewClaim(input, claim)
    : reconcileExistingClaim(input, claim, observedAt)
}
