import { parseBackendReleaseAuthority } from './authority'
import { parseBackendProductionGateResults } from './gates'
import { normalizeBackendReleaseDestructiveConfirmations } from './plan'
import { validateBackendReleaseReceipt } from './receipt'
import type {
  BackendReleaseApplyErrorKind,
  BackendReleaseApplySnapshotV1,
  BackendReleaseArtifactsV1,
  BackendReleaseEvent,
  BackendReleaseReconcileOutcome,
  BackendReleaseReviewV1
} from './types'
import {
  exactRecord,
  nullableDigest,
  plainDataRecord,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  stringArray,
  stringValue
} from './validation'
import { isVerifiedBackendReleasePlan } from './verification'

function eventRecord(
  envelope: Record<string, unknown>,
  keys: readonly string[],
  requiredKeys: readonly string[] = keys
): Record<string, unknown> {
  return exactRecord(envelope, 'event', keys, requiredKeys)
}

function eventDigest(source: Record<string, unknown>): string {
  return releaseDigest(stringValue(source.planDigest, 'event.planDigest'), 'event.planDigest')
}

function inspectionCompleted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'authority'])
  return {
    type: 'inspection-completed',
    authority: parseBackendReleaseAuthority(source.authority, 'event.authority')
  }
}

function planCreated(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'plan'])
  if (!isVerifiedBackendReleasePlan(source.plan)) {
    throw new TypeError(
      'Release plan must be digest-verified and deeply frozen before entering state.'
    )
  }
  return { type: 'plan-created', plan: source.plan }
}

function artifacts(value: unknown): BackendReleaseArtifactsV1 {
  const source = exactRecord(value, 'event.artifacts', [
    'staticArtifactDigest',
    'serverArtifactDigest',
    'schemaArtifactDigest'
  ])
  return {
    staticArtifactDigest: nullableDigest(
      source.staticArtifactDigest,
      'event.artifacts.staticArtifactDigest'
    ),
    serverArtifactDigest: nullableDigest(
      source.serverArtifactDigest,
      'event.artifacts.serverArtifactDigest'
    ),
    schemaArtifactDigest: nullableDigest(
      source.schemaArtifactDigest,
      'event.artifacts.schemaArtifactDigest'
    )
  }
}

function artifactsEmitted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'artifacts'])
  return {
    type: 'artifacts-emitted',
    planDigest: eventDigest(source),
    artifacts: artifacts(source.artifacts)
  }
}

function review(value: unknown): BackendReleaseReviewV1 {
  const source = exactRecord(value, 'event.review', [
    'planDigest',
    'reviewedAt',
    'destructiveOperationIds',
    'backupRequired'
  ])
  if (typeof source.backupRequired !== 'boolean') {
    throw new TypeError('event.review.backupRequired must be a boolean')
  }
  return {
    planDigest: releaseDigest(
      stringValue(source.planDigest, 'event.review.planDigest'),
      'event.review.planDigest'
    ),
    reviewedAt: releaseTimestamp(
      stringValue(source.reviewedAt, 'event.review.reviewedAt'),
      'event.review.reviewedAt'
    ),
    destructiveOperationIds: stringArray(
      source.destructiveOperationIds,
      'event.review.destructiveOperationIds'
    ),
    backupRequired: source.backupRequired
  }
}

function reviewCompleted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'review'])
  return { type: 'review-completed', review: review(source.review) }
}

function releaseConfirmed(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'confirmations'])
  return {
    type: 'release-confirmed',
    planDigest: eventDigest(source),
    confirmations: normalizeBackendReleaseDestructiveConfirmations(source.confirmations)
  }
}

function applySnapshot(value: unknown): BackendReleaseApplySnapshotV1 {
  const source = exactRecord(value, 'event.snapshot', ['planDigest', 'authority'])
  return {
    planDigest: releaseDigest(
      stringValue(source.planDigest, 'event.snapshot.planDigest'),
      'event.snapshot.planDigest'
    ),
    authority: parseBackendReleaseAuthority(source.authority, 'event.snapshot.authority')
  }
}

function applyReinspectionCompleted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'snapshot'])
  return {
    type: 'apply-reinspection-completed',
    snapshot: applySnapshot(source.snapshot)
  }
}

function applyDispatched(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'singleFlightKey', 'dispatchedAt'])
  return {
    type: 'apply-dispatched',
    planDigest: eventDigest(source),
    singleFlightKey: stringValue(source.singleFlightKey, 'event.singleFlightKey', 2_048),
    dispatchedAt: releaseTimestamp(
      stringValue(source.dispatchedAt, 'event.dispatchedAt'),
      'event.dispatchedAt'
    )
  }
}

function applyCompleted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'remoteOperationIds', 'completedAt'])
  return {
    type: 'apply-completed',
    planDigest: eventDigest(source),
    remoteOperationIds: stringArray(source.remoteOperationIds, 'event.remoteOperationIds'),
    completedAt: releaseTimestamp(
      stringValue(source.completedAt, 'event.completedAt'),
      'event.completedAt'
    )
  }
}

function reconcileOutcome(value: unknown): BackendReleaseReconcileOutcome {
  if (value === 'applied' || value === 'failed' || value === 'outcome-unknown') return value
  throw new TypeError('event.outcome is not supported')
}

function applyReconciled(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, [
    'type',
    'planDigest',
    'singleFlightKey',
    'outcome',
    'code',
    'remoteOperationIds',
    'reconciledAt'
  ])
  const outcome = reconcileOutcome(source.outcome)
  const code =
    source.code === null
      ? null
      : releaseIdentifier(stringValue(source.code, 'event.code'), 'event.code')
  if ((outcome === 'applied') !== (code === null)) {
    throw new TypeError('event.code must be null only for an applied reconciliation')
  }
  return {
    type: 'apply-reconciled',
    planDigest: eventDigest(source),
    singleFlightKey: stringValue(source.singleFlightKey, 'event.singleFlightKey', 2_048),
    outcome,
    code,
    remoteOperationIds: stringArray(source.remoteOperationIds, 'event.remoteOperationIds'),
    reconciledAt: releaseTimestamp(
      stringValue(source.reconciledAt, 'event.reconciledAt'),
      'event.reconciledAt'
    )
  }
}

function applyErrorKind(value: unknown): BackendReleaseApplyErrorKind {
  switch (value) {
    case 'timeout':
    case 'abort':
    case 'transport':
    case 'provider-rejected':
    case 'precondition':
      return value
    default:
      throw new TypeError('event.kind is not supported')
  }
}

function applyError(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(
    envelope,
    ['type', 'planDigest', 'kind', 'code', 'occurredAt', 'remoteOperationIds'],
    ['type', 'planDigest', 'kind', 'code', 'occurredAt']
  )
  return {
    type: 'apply-error',
    planDigest: eventDigest(source),
    kind: applyErrorKind(source.kind),
    code: releaseIdentifier(stringValue(source.code, 'event.code'), 'event.code'),
    occurredAt: releaseTimestamp(
      stringValue(source.occurredAt, 'event.occurredAt'),
      'event.occurredAt'
    ),
    ...(source.remoteOperationIds === undefined
      ? {}
      : {
          remoteOperationIds: stringArray(source.remoteOperationIds, 'event.remoteOperationIds')
        })
  }
}

function releaseError(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'code', 'occurredAt'])
  return {
    type: 'release-error',
    planDigest: eventDigest(source),
    code: releaseIdentifier(stringValue(source.code, 'event.code'), 'event.code'),
    occurredAt: releaseTimestamp(
      stringValue(source.occurredAt, 'event.occurredAt'),
      'event.occurredAt'
    )
  }
}

function cancelRequested(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'reasonCode', 'cancelledAt'])
  return {
    type: 'cancel-requested',
    reasonCode: releaseIdentifier(
      stringValue(source.reasonCode, 'event.reasonCode'),
      'event.reasonCode'
    ),
    cancelledAt: releaseTimestamp(
      stringValue(source.cancelledAt, 'event.cancelledAt'),
      'event.cancelledAt'
    )
  }
}

function verificationCompleted(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'planDigest', 'gates', 'verifiedAt'])
  return {
    type: 'verification-completed',
    planDigest: eventDigest(source),
    gates: parseBackendProductionGateResults(source.gates, 'event.gates'),
    verifiedAt: releaseTimestamp(
      stringValue(source.verifiedAt, 'event.verifiedAt'),
      'event.verifiedAt'
    )
  }
}

function receiptRecorded(envelope: Record<string, unknown>): BackendReleaseEvent {
  const source = eventRecord(envelope, ['type', 'receipt'])
  const validated = validateBackendReleaseReceipt(source.receipt)
  if (!validated.ok) {
    throw new TypeError('Receipt is invalid or does not bind this release state.')
  }
  return { type: 'receipt-recorded', receipt: validated.value }
}

export function normalizeBackendReleaseEvent(value: unknown): BackendReleaseEvent {
  const envelope = plainDataRecord(value, 'event')
  switch (envelope.type) {
    case 'inspection-completed':
      return inspectionCompleted(envelope)
    case 'plan-created':
      return planCreated(envelope)
    case 'artifacts-emitted':
      return artifactsEmitted(envelope)
    case 'review-completed':
      return reviewCompleted(envelope)
    case 'release-confirmed':
      return releaseConfirmed(envelope)
    case 'apply-reinspection-completed':
      return applyReinspectionCompleted(envelope)
    case 'apply-dispatched':
      return applyDispatched(envelope)
    case 'apply-completed':
      return applyCompleted(envelope)
    case 'apply-reconciled':
      return applyReconciled(envelope)
    case 'apply-error':
      return applyError(envelope)
    case 'release-error':
      return releaseError(envelope)
    case 'cancel-requested':
      return cancelRequested(envelope)
    case 'verification-completed':
      return verificationCompleted(envelope)
    case 'receipt-recorded':
      return receiptRecorded(envelope)
    default:
      throw new TypeError('event.type is not supported')
  }
}
