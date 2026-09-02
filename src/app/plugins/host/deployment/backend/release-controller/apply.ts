import {
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
  type BackendHostReleaseDispatchClaimResult,
  type BackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournalRecordV1
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
  record: BackendHostReleaseDispatchJournalRecordV1
): BackendHostReleaseDispatchJournalRecordV1 {
  return { ...record, outcome: 'outcome-unknown' }
}

async function settleReconciliationFailure(
  input: JournaledApplyInput,
  record: BackendHostReleaseDispatchJournalRecordV1
): Promise<BackendHostReleaseDispatchJournalRecordV1> {
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
  record: BackendHostReleaseDispatchJournalRecordV1
): Promise<BackendHostReleaseDispatchJournalRecordV1> {
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
  resolution: BackendHostReleaseDispatchJournalRecordV1
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
  record: BackendHostReleaseDispatchJournalRecordV1,
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
  record: BackendHostReleaseDispatchJournalRecordV1,
  reconciledAt: string
): BackendReleaseStateV1 {
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey: record.singleFlightKey,
      outcome: 'outcome-unknown',
      code: 'backend-release-dispatch-in-flight',
      remoteOperationIds: record.remoteOperationIds,
      reconciledAt
    })
  )
}

async function reconcileExistingClaim(
  input: JournaledApplyInput,
  claim: BackendHostReleaseDispatchClaimResult,
  observedAt: string
): Promise<BackendReleaseStateV1> {
  if (pendingLeaseIsActive(claim.record, observedAt)) {
    return blockedByActiveLease(input, claim.record, observedAt)
  }
  const resolution = await resolveExistingClaim(input, claim.record)
  const outcome = resolution.outcome === 'pending' ? 'outcome-unknown' : resolution.outcome
  return input.transition(
    reduceBackendReleaseState(input.state, {
      type: 'apply-reconciled',
      planDigest: input.plan.planDigest,
      singleFlightKey: claim.record.singleFlightKey,
      outcome,
      code: reconciliationCode(outcome, resolution),
      remoteOperationIds: resolution.remoteOperationIds,
      reconciledAt: input.now()
    })
  )
}

export async function advanceJournaledApply(
  input: JournaledApplyInput
): Promise<BackendReleaseStateV1> {
  const singleFlightKey = backendReleaseSingleFlightKey(input.plan)
  let claim: BackendHostReleaseDispatchClaimResult
  let observedAt: string
  try {
    observedAt = input.now()
    claim = await claimBackendReleaseDispatch(input.dispatchJournal, {
      singleFlightKey,
      releaseId: input.releaseId,
      ownerId: input.ownerId,
      planDigest: input.plan.planDigest,
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiration(observedAt)
    })
  } catch {
    return journalClaimFailure(input)
  }
  return claim.claimed
    ? dispatchNewClaim(input, claim)
    : reconcileExistingClaim(input, claim, observedAt)
}
