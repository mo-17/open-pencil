import { canonicalManifestBytes } from '@open-pencil/scene-graph'

import {
  backendReleaseSingleFlightKey,
  compareBackendReleaseAuthority,
  normalizeBackendReleaseAuthority
} from './authority'
import { normalizeBackendReleaseEvent } from './event'
import { evaluateProductionReleaseGates } from './gates'
import { createBackendReleaseState } from './initial-state'
import {
  evaluateDestructiveMigrationConfirmations,
  normalizeBackendReleaseDestructiveConfirmations
} from './plan'
import { createBackendReleaseReceipt, validateBackendReleaseReceipt } from './receipt'
import { isAuthenticatedBackendReleaseState, sealBackendReleaseState } from './state-authority'
import type {
  BackendReleaseArtifactsV1,
  BackendReleaseDestructiveConfirmationV1,
  BackendReleaseEvent,
  BackendReleasePhase,
  BackendReleasePlanV1,
  BackendReleaseReceiptV1,
  BackendReleaseStateV1,
  VerifiedBackendReleasePlanV1
} from './types'
import {
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  sortedUniqueStrings
} from './validation'
import { isVerifiedBackendReleasePlan } from './verification'

type ReleaseEvent<Type extends BackendReleaseEvent['type']> = Extract<
  BackendReleaseEvent,
  { type: Type }
>

export class BackendReleaseTransitionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BackendReleaseTransitionError'
    this.code = code
  }
}

function transitionError(code: string, message: string): never {
  throw new BackendReleaseTransitionError(code, message)
}

export { createBackendReleaseState }

function requirePhase(state: BackendReleaseStateV1, phase: BackendReleasePhase): void {
  if (state.phase !== phase || state.outcome !== 'pending') {
    transitionError(
      'backend-release-transition-invalid',
      `Event requires pending phase ${phase}; current phase is ${state.phase} (${state.outcome}).`
    )
  }
}

function requirePlan(state: BackendReleaseStateV1): VerifiedBackendReleasePlanV1 {
  if (!state.plan)
    transitionError('backend-release-plan-required', 'A reviewed release plan is required.')
  return state.plan
}

function requirePlanDigest(plan: BackendReleasePlanV1, digest: string): void {
  try {
    releaseDigest(digest, 'event.planDigest')
  } catch {
    transitionError('backend-release-plan-digest-invalid', 'Event plan digest is invalid.')
  }
  if (digest !== plan.planDigest) {
    transitionError(
      'backend-release-plan-stale',
      'Event belongs to a different release plan digest.'
    )
  }
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizedArtifacts(
  plan: BackendReleasePlanV1,
  value: BackendReleaseArtifactsV1
): BackendReleaseArtifactsV1 {
  const artifacts: BackendReleaseArtifactsV1 = {
    staticArtifactDigest:
      value.staticArtifactDigest === null
        ? null
        : releaseDigest(value.staticArtifactDigest, 'artifacts.staticArtifactDigest'),
    serverArtifactDigest:
      value.serverArtifactDigest === null
        ? null
        : releaseDigest(value.serverArtifactDigest, 'artifacts.serverArtifactDigest'),
    schemaArtifactDigest:
      value.schemaArtifactDigest === null
        ? null
        : releaseDigest(value.schemaArtifactDigest, 'artifacts.schemaArtifactDigest')
  }
  const required = {
    static: artifacts.staticArtifactDigest,
    server: artifacts.serverArtifactDigest,
    schema: artifacts.schemaArtifactDigest
  }
  for (const kind of plan.requiredArtifactKinds) {
    if (!required[kind]) {
      transitionError(
        'backend-release-artifact-required',
        `Required ${kind} backend artifact was not emitted.`
      )
    }
  }
  return artifacts
}

function matchingReceipt(state: BackendReleaseStateV1, receipt: BackendReleaseReceiptV1): boolean {
  let expected: BackendReleaseReceiptV1
  try {
    expected = createBackendReleaseReceipt(state, { receiptId: receipt.receiptId })
  } catch {
    return false
  }
  const left = canonicalManifestBytes(expected)
  const right = canonicalManifestBytes(receipt)
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])
}

function applyError(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'apply-error'>
): BackendReleaseStateV1 {
  requirePhase(state, 'apply')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  releaseTimestamp(event.occurredAt, 'event.occurredAt')
  const failureCode = releaseIdentifier(event.code, 'event.code')
  const remoteOperationIds = sortedUniqueStrings(
    event.remoteOperationIds ?? [],
    'event.remoteOperationIds'
  )
  const uncertain =
    state.dispatch === 'dispatched' &&
    (event.kind === 'timeout' || event.kind === 'abort' || event.kind === 'transport')
  if (uncertain) {
    return {
      ...state,
      phase: 'receipt',
      outcome: 'outcome-unknown',
      dispatch: 'settled',
      automaticRetryAllowed: false,
      reconcileRequired: true,
      remoteOperationIds,
      failureCode
    }
  }
  const cancelled = state.dispatch === 'not-dispatched' && event.kind === 'abort'
  return {
    ...state,
    phase: 'receipt',
    outcome: cancelled ? 'cancelled' : 'failed',
    dispatch: state.dispatch === 'dispatched' ? 'settled' : 'not-dispatched',
    automaticRetryAllowed: false,
    reconcileRequired: false,
    remoteOperationIds,
    failureCode
  }
}

function releaseError(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'release-error'>
): BackendReleaseStateV1 {
  if (
    state.outcome !== 'pending' ||
    state.phase === 'inspect' ||
    state.phase === 'plan' ||
    state.phase === 'receipt'
  ) {
    return transitionError(
      'backend-release-error-too-early-or-late',
      'A release error requires an active verified plan.'
    )
  }
  if (state.dispatch !== 'not-dispatched') {
    return transitionError(
      'backend-release-error-after-dispatch-forbidden',
      'A post-dispatch failure must preserve its potentially unknown remote outcome.'
    )
  }
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  releaseTimestamp(event.occurredAt, 'event.occurredAt')
  return {
    ...state,
    phase: 'receipt',
    outcome: 'failed',
    automaticRetryAllowed: false,
    reconcileRequired: false,
    failureCode: releaseIdentifier(event.code, 'event.code')
  }
}

function inspectionCompleted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'inspection-completed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'inspect')
  return {
    ...state,
    phase: 'plan',
    inspection: normalizeBackendReleaseAuthority(event.authority)
  }
}

function planCreated(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'plan-created'>
): BackendReleaseStateV1 {
  requirePhase(state, 'plan')
  const inspection = state.inspection
  if (!inspection) {
    return transitionError(
      'backend-release-inspection-required',
      'Plan creation requires a completed Inspect snapshot.'
    )
  }
  if (!isVerifiedBackendReleasePlan(event.plan)) {
    return transitionError(
      'backend-release-plan-integrity-invalid',
      'Release plan must be digest-verified and deeply frozen before entering state.'
    )
  }
  releaseDigest(event.plan.planDigest, 'plan.planDigest')
  const authorityIssues = compareBackendReleaseAuthority(event.plan.planDigest, inspection, {
    planDigest: event.plan.planDigest,
    authority: event.plan.authority
  })
  if (authorityIssues.length > 0) {
    return transitionError(
      'backend-release-plan-authority-mismatch',
      `Release plan changed inspected authority: ${authorityIssues.map((issue) => issue.field).join(', ')}.`
    )
  }
  return { ...state, phase: 'emit', plan: event.plan }
}

function artifactsEmitted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'artifacts-emitted'>
): BackendReleaseStateV1 {
  requirePhase(state, 'emit')
  const plan = requirePlan(state)
  if (!isVerifiedBackendReleasePlan(plan)) {
    return transitionError(
      'backend-release-plan-integrity-invalid',
      'Release progression requires a digest-verified, deeply frozen release plan.'
    )
  }
  requirePlanDigest(plan, event.planDigest)
  return {
    ...state,
    phase: 'review',
    artifacts: normalizedArtifacts(plan, event.artifacts)
  }
}

function reviewCompleted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'review-completed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'review')
  const plan = requirePlan(state)
  const review = event.review
  requirePlanDigest(plan, review.planDigest)
  const expected = plan.migration.operations
    .filter((operation) => operation.risk === 'destructive')
    .map((operation) => operation.operationId)
    .sort()
  const reviewed = sortedUniqueStrings(
    review.destructiveOperationIds,
    'review.destructiveOperationIds'
  )
  if (!sameValues(expected, reviewed) || review.backupRequired !== plan.migration.requiresBackup) {
    return transitionError(
      'backend-release-review-incomplete',
      'Review must expose every destructive operation and the derived backup requirement.'
    )
  }
  return {
    ...state,
    phase: 'confirm',
    review: { ...review, destructiveOperationIds: reviewed }
  }
}

function releaseConfirmed(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'release-confirmed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'confirm')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  let confirmations: BackendReleaseDestructiveConfirmationV1[]
  try {
    confirmations = normalizeBackendReleaseDestructiveConfirmations(event.confirmations)
  } catch {
    return transitionError(
      'backend-release-destructive-confirmation-required',
      'destructive-confirmation-invalid'
    )
  }
  const readiness = evaluateDestructiveMigrationConfirmations(plan, confirmations)
  if (!readiness.ready) {
    return transitionError(
      'backend-release-destructive-confirmation-required',
      readiness.blockers.map((blocker) => blocker.code).join(', ')
    )
  }
  return {
    ...state,
    phase: 'apply',
    confirmations,
    applyReinspectionAccepted: false
  }
}

function applyReinspectionCompleted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'apply-reinspection-completed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'apply')
  if (state.dispatch !== 'not-dispatched') {
    return transitionError(
      'backend-release-reinspection-too-late',
      'Apply reinspection must complete before remote dispatch.'
    )
  }
  const plan = requirePlan(state)
  if (!isVerifiedBackendReleasePlan(plan)) {
    return transitionError(
      'backend-release-plan-integrity-invalid',
      'Apply requires a digest-verified, deeply frozen release plan.'
    )
  }
  const snapshot = {
    planDigest: event.snapshot.planDigest,
    authority: normalizeBackendReleaseAuthority(event.snapshot.authority)
  }
  const issues = compareBackendReleaseAuthority(plan.planDigest, plan.authority, snapshot)
  if (issues.length > 0) {
    return transitionError(
      'backend-release-plan-stale',
      `Apply is blocked by stale authority: ${issues.map((issue) => issue.field).join(', ')}.`
    )
  }
  return { ...state, applyReinspectionAccepted: true }
}

function applyDispatched(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'apply-dispatched'>
): BackendReleaseStateV1 {
  requirePhase(state, 'apply')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  if (state.dispatch !== 'not-dispatched' || !state.applyReinspectionAccepted) {
    return transitionError(
      'backend-release-apply-precondition-failed',
      'Fresh Inspect and a not-dispatched state are required before Apply.'
    )
  }
  releaseTimestamp(event.dispatchedAt, 'event.dispatchedAt')
  const expectedKey = backendReleaseSingleFlightKey(plan)
  if (event.singleFlightKey !== expectedKey) {
    return transitionError(
      'backend-release-single-flight-key-mismatch',
      'Single-flight key must bind project, account, grant generation, and plan digest.'
    )
  }
  return {
    ...state,
    dispatch: 'dispatched',
    automaticRetryAllowed: false,
    singleFlightKey: expectedKey
  }
}

function applyCompleted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'apply-completed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'apply')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  if (state.dispatch !== 'dispatched') {
    return transitionError(
      'backend-release-dispatch-required',
      'Apply completion cannot be recorded before dispatch.'
    )
  }
  releaseTimestamp(event.completedAt, 'event.completedAt')
  return {
    ...state,
    phase: 'verify',
    dispatch: 'settled',
    remoteOperationIds: sortedUniqueStrings(event.remoteOperationIds, 'event.remoteOperationIds')
  }
}

function applyReconciled(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'apply-reconciled'>
): BackendReleaseStateV1 {
  requirePhase(state, 'apply')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  if (state.dispatch !== 'not-dispatched' || !state.applyReinspectionAccepted) {
    return transitionError(
      'backend-release-reconcile-precondition-failed',
      'Fresh Inspect and a not-dispatched state are required before reconciliation.'
    )
  }
  releaseTimestamp(event.reconciledAt, 'event.reconciledAt')
  const expectedKey = backendReleaseSingleFlightKey(plan)
  if (event.singleFlightKey !== expectedKey) {
    return transitionError(
      'backend-release-single-flight-key-mismatch',
      'Reconciliation must bind the reviewed release single-flight key.'
    )
  }
  const remoteOperationIds = sortedUniqueStrings(
    event.remoteOperationIds,
    'event.remoteOperationIds'
  )
  const applied = event.outcome === 'applied'
  return {
    ...state,
    phase: applied ? 'verify' : 'receipt',
    outcome: applied ? 'pending' : event.outcome,
    dispatch: 'settled',
    automaticRetryAllowed: false,
    reconcileRequired: event.outcome === 'outcome-unknown',
    singleFlightKey: expectedKey,
    remoteOperationIds,
    failureCode: event.code
  }
}

function cancelRequested(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'cancel-requested'>
): BackendReleaseStateV1 {
  if (state.outcome !== 'pending' || state.phase === 'receipt') {
    return transitionError(
      'backend-release-cancel-too-late',
      'A terminal release cannot be cancelled.'
    )
  }
  if (state.dispatch !== 'not-dispatched') {
    return transitionError(
      'backend-release-cancel-after-dispatch-forbidden',
      'Cancellation after dispatch has an unknown remote outcome and must be reconciled instead.'
    )
  }
  releaseTimestamp(event.cancelledAt, 'event.cancelledAt')
  return {
    ...state,
    phase: 'receipt',
    outcome: 'cancelled',
    automaticRetryAllowed: false,
    failureCode: releaseIdentifier(event.reasonCode, 'event.reasonCode')
  }
}

function verificationOutcome(
  production: boolean,
  releaseReady: boolean,
  explicitFailure: boolean
): BackendReleaseStateV1['outcome'] {
  if (production) return releaseReady ? 'succeeded' : 'blocked'
  return explicitFailure ? 'blocked' : 'succeeded'
}

function verificationCompleted(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'verification-completed'>
): BackendReleaseStateV1 {
  requirePhase(state, 'verify')
  const plan = requirePlan(state)
  requirePlanDigest(plan, event.planDigest)
  const verifiedAt = releaseTimestamp(event.verifiedAt, 'event.verifiedAt')
  const readiness = evaluateProductionReleaseGates(event.gates, verifiedAt)
  const explicitFailure = readiness.gates.some((gate) => gate.status === 'failed')
  const production = plan.authority.environment === 'production'
  const releaseReady = production && readiness.releaseReady
  return {
    ...state,
    phase: 'receipt',
    outcome: verificationOutcome(production, readiness.releaseReady, explicitFailure),
    verifiedAt,
    gates: readiness.gates,
    releaseReady,
    backendDeploymentRequired: !readiness.releaseReady
  }
}

function receiptRecorded(
  state: BackendReleaseStateV1,
  event: ReleaseEvent<'receipt-recorded'>
): BackendReleaseStateV1 {
  if (state.phase !== 'receipt' || state.outcome === 'pending') {
    return transitionError(
      'backend-release-receipt-too-early',
      'Receipt can only be recorded for a terminal release outcome.'
    )
  }
  const validated = validateBackendReleaseReceipt(event.receipt)
  if (!validated.ok || !matchingReceipt(state, validated.value)) {
    return transitionError(
      'backend-release-receipt-mismatch',
      'Receipt is invalid or does not bind this release state.'
    )
  }
  return { ...state, receipt: validated.value }
}

function transitionBackendReleaseState(
  state: BackendReleaseStateV1,
  event: BackendReleaseEvent
): BackendReleaseStateV1 {
  switch (event.type) {
    case 'inspection-completed':
      return inspectionCompleted(state, event)
    case 'plan-created':
      return planCreated(state, event)
    case 'artifacts-emitted':
      return artifactsEmitted(state, event)
    case 'review-completed':
      return reviewCompleted(state, event)
    case 'release-confirmed':
      return releaseConfirmed(state, event)
    case 'apply-reinspection-completed':
      return applyReinspectionCompleted(state, event)
    case 'apply-dispatched':
      return applyDispatched(state, event)
    case 'apply-completed':
      return applyCompleted(state, event)
    case 'apply-reconciled':
      return applyReconciled(state, event)
    case 'apply-error':
      return applyError(state, event)
    case 'release-error':
      return releaseError(state, event)
    case 'cancel-requested':
      return cancelRequested(state, event)
    case 'verification-completed':
      return verificationCompleted(state, event)
    case 'receipt-recorded':
      return receiptRecorded(state, event)
  }
  throw new TypeError('Unsupported Backend Release event.')
}

/**
 * Release states are authenticated in-memory authority objects. Persisted, cloned, or manually
 * reconstructed states cannot be resumed; callers must begin a new Inspect lifecycle.
 */
export function reduceBackendReleaseState(
  state: BackendReleaseStateV1,
  event: BackendReleaseEvent
): BackendReleaseStateV1 {
  if (!isAuthenticatedBackendReleaseState(state)) {
    return transitionError(
      'backend-release-state-unauthenticated',
      'Backend Release state is not an authenticated live state; cloned or reconstructed states cannot be resumed.'
    )
  }
  let normalizedEvent: BackendReleaseEvent
  try {
    normalizedEvent = normalizeBackendReleaseEvent(event)
  } catch (cause) {
    return transitionError(
      'backend-release-event-invalid',
      cause instanceof Error ? cause.message : 'Backend Release event is invalid.'
    )
  }
  return sealBackendReleaseState(transitionBackendReleaseState(state, normalizedEvent))
}
