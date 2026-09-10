/* oxlint-disable eslint(max-lines), eslint(complexity) -- Receipt-zero provenance, canonical Receipt material, and fail-closed cross-binding stay in one audit boundary. */

import {
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  canonicalBackendBackfillExecutionScopeV2Bytes,
  digestBackendBackfillExecutionReceiptV2,
  digestBackendBackfillExecutionScopeV2,
  parseBackendBackfillExecutionReceiptV2,
  verifyBackendBackfillExecutionReceiptChainV2,
  type BackendBackfillExecutionReceiptV2
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1,
  type SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1,
  type TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES,
  trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import { trustedSupabaseBackfillLockedHighWaterCaptureV1 } from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1,
  type SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1,
  type TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/source-ledger-binding'

export const SUPABASE_BACKFILL_RECEIPT_ZERO_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_OPERATION_EVIDENCE_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-operation-evidence.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_REQUEST_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-request.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_ROW_PLAN_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-row-plan.v1' as const

const INPUT_KEYS = ['scopeEnvelope', 'databaseLedgerInstallation', 'preparedAt', 'nonce'] as const
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const REVIEW_BLOCKERS = Object.freeze([
  'receipt-zero-testing-source-trust-only',
  'receipt-zero-production-operation-authority-not-created',
  'receipt-zero-database-cas-not-dispatched',
  'receipt-zero-operation-credential-not-issued',
  'receipt-zero-candidate-commit-time-untrusted',
  'bounded-runner-unavailable'
] as const)

export interface CreateSupabaseBackfillReceiptZeroReviewForTestingOptionsV1 {
  readonly scopeEnvelope: SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1
  readonly databaseLedgerInstallation: SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  readonly preparedAt: string
  readonly nonce: string
}

export interface SupabaseBackfillReceiptZeroOperationEvidenceV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_OPERATION_EVIDENCE_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly projectRef: string
  readonly accountId: string
  readonly identifiers: Readonly<{
    identitySeedDigest: string
    executionId: string
    receiptId: string
    idempotencyKey: string
    databaseEventId: string
  }>
  readonly source: Readonly<{
    receiptReviewDigest: string
    scopeDigest: string
    sourceLedgerBindingDigest: string
    sourceLedgerReviewDigest: string
    sourceLedgerDigest: string
    bindingReceiptDigest: string
    subjectDigest: string
    attestationDigest: string
    trustRootId: string
    ciRequestDigest: string
    ciVerifiedAt: string
    captureDigest: string
    captureObservedAt: string
    captureQueryDigest: string
    catalogPreconditionDigest: string
  }>
  readonly databaseLedger: Readonly<{
    provenance: 'testing'
    appliedResultDigest: string
    planDigest: string
    installReviewDigest: string
    sourceReviewDigest: string
    verificationDigest: string
    installedVerificationDigest: string
    ledgerShapeDigest: string
    baseSqlDigest: string
    marker: string
    markerBindingDigest: string
    installSqlDigest: string
    verificationQueryDigest: string
    credentialLeaseBindingDigest: string
    writeCredentialIncarnation: string
    operationLeaseGeneration: string
    observedAt: string
    snapshotMarker: string
    serverVersionNum: string
  }>
  readonly preparedAt: string
}

export interface SupabaseBackfillReceiptZeroRowPlanV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_ROW_PLAN_FORMAT
  readonly version: 1
  readonly execution: Readonly<{
    executionId: string
    scopeDigest: string
    captureDigest: string
    status: 'running' | 'completed'
    canonicalScopeByteLength: number
    createdAt: string
    updatedAt: string
  }>
  readonly receipt: Readonly<{
    executionId: string
    revision: 1
    eventId: string
    receiptId: string
    idempotencyKey: string
    requestDigest: string
    receiptDigest: string
    previousRevision: null
    previousEventId: null
    previousReceiptDigest: null
    checkpointKind: 'capture'
    canonicalReceiptByteLength: number
    committedAt: string
  }>
  readonly head: Readonly<{
    executionId: string
    revision: 1
    eventId: string
    receiptDigest: string
    updatedAt: string
  }>
}

export interface SupabaseBackfillReceiptZeroReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly sourceLedgerBound: false
  readonly testingSourceLedgerBound: true
  readonly ciAuthenticated: false
  readonly testingCiVerified: true
  readonly testingDatabaseLedgerInstalledProofObserved: true
  readonly databaseLedgerBound: false
  readonly operationAuthorityAuthenticated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    receiptReviewDigest: string
    scopeDigest: string
    sourceLedgerBindingDigest: string
    sourceLedgerDigest: string
    captureDigest: string
    databaseLedgerInstallPlanDigest: string
    databaseLedgerInstallReviewDigest: string
    installedVerificationDigest: string
    appliedResultDigest: string
    candidateOperationEvidenceDigest: string
    requestDigest: string
    receiptDigest: string
    rowPlanDigest: string
  }>
  readonly authority: Readonly<{
    projectRef: string
    accountId: string
  }>
  readonly operationEvidence: SupabaseBackfillReceiptZeroOperationEvidenceV1
  readonly receipt: BackendBackfillExecutionReceiptV2
  readonly rowPlan: SupabaseBackfillReceiptZeroRowPlanV1
  readonly policy: Readonly<{
    databaseTransactionRequired: true
    isolation: 'serializable'
    expectedInitialHead: null
    insertOrder: readonly ['execution', 'receipt', 'head']
    exactReplayOnly: true
    conflictUpdateAllowed: false
    advancedHeadMayBeRewound: false
    partialStateIsCorruption: true
    captureConsumed: false
    operationCredentialIssued: false
    installCredentialLeaseUsedAsProvenanceOnly: true
    databaseLedgerReverificationRequired: true
    receiptOperationAuthorityDigestIsUnauthenticatedTestingEvidence: true
    mutationDispatched: false
    requestDispatched: false
    receiptPersisted: false
    databaseCASCommitted: false
    databaseCommitTimeObserved: false
    candidateCommittedAtEqualsPreparedAt: true
    outcomeUnknownRequiresReadOnlyReconciliation: true
    automaticRetryAllowed: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillReceiptZeroReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptZeroReviewV1
  readonly reviewDigest: string
}

/** Process-local review provenance only; strings are immutable canonical JSON, not write permits. */
export interface TrustedSupabaseBackfillReceiptZeroReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptZeroReviewEnvelopeV1
  readonly scopeContext: TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1
  readonly databaseLedgerContext: TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1
  readonly canonicalScopeJSON: string
  readonly canonicalReceiptJSON: string
}

export type SupabaseBackfillReceiptZeroReviewErrorCode =
  | 'supabase-backfill-receipt-zero-input-invalid'
  | 'supabase-backfill-receipt-zero-scope-proof-invalid'
  | 'supabase-backfill-receipt-zero-database-ledger-proof-invalid'
  | 'supabase-backfill-receipt-zero-evidence-crosswired'
  | 'supabase-backfill-receipt-zero-input-changed'
  | 'supabase-backfill-receipt-zero-timestamp-invalid'
  | 'supabase-backfill-receipt-zero-capacity-exceeded'
  | 'supabase-backfill-receipt-zero-receipt-invalid'
  | 'supabase-backfill-receipt-zero-digest-failed'

export class SupabaseBackfillReceiptZeroReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptZeroReviewErrorCode) {
    super(`Supabase backfill Receipt-zero review failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptZeroReviewError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

const trustedReviews = new WeakMap<object, TrustedSupabaseBackfillReceiptZeroReviewContextV1>()

function fail(code: SupabaseBackfillReceiptZeroReviewErrorCode): never {
  throw new SupabaseBackfillReceiptZeroReviewError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  for (const key of INPUT_KEYS) ownData(value, key)
  return value as UnknownRecord
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !TIMESTAMP.test(value)) {
    return fail('supabase-backfill-receipt-zero-timestamp-invalid')
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    return fail('supabase-backfill-receipt-zero-timestamp-invalid')
  }
  return value
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-digest-failed')
  }
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

function requireProofs(
  scopeEnvelope: SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1,
  databaseLedgerInstallation: SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
): Readonly<{
  scope: TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1
  databaseLedger: TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1
}> {
  const scope = trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1(scopeEnvelope)
  if (!scope || !trustedSupabaseBackfillLockedHighWaterCaptureV1(scope.capture)) {
    return fail('supabase-backfill-receipt-zero-scope-proof-invalid')
  }
  const databaseLedger = trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1(
    databaseLedgerInstallation
  )
  if (databaseLedger?.provenance !== 'testing') {
    return fail('supabase-backfill-receipt-zero-database-ledger-proof-invalid')
  }
  const ledgerReview = trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(
    databaseLedger.dispatchEvidence.sourceReview
  )
  if (!ledgerReview || ledgerReview.receiptReview !== scope.receiptReview) {
    return fail('supabase-backfill-receipt-zero-evidence-crosswired')
  }
  return Object.freeze({ scope, databaseLedger })
}

function requireCurrentBindings(
  scopeEnvelope: SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1,
  databaseLedgerInstallation: SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1,
  proof: ReturnType<typeof requireProofs>
): void {
  const { scope, databaseLedger } = proof
  const capture = scope.capture
  const binding = scope.binding
  const dispatch = databaseLedger.dispatchContext
  const result = databaseLedger.result
  const matches = [
    result === databaseLedgerInstallation,
    scope.envelope === scopeEnvelope,
    scopeEnvelope.scope.captureDigest === capture.captureDigest,
    scopeEnvelope.scope.sourceLedgerDigest === binding.bindings.sourceLedgerDigest,
    scopeEnvelope.sourceLedgerBindingDigest === binding.bindingDigest,
    capture.authority.projectRef === result.projectRef,
    capture.authority.accountId === result.accountId,
    dispatch.projectRef === result.projectRef,
    dispatch.accountId === result.accountId,
    dispatch.installReviewDigest === result.installReviewDigest,
    dispatch.sourceReviewDigest === result.sourceReviewDigest,
    dispatch.verificationDigest === result.verificationDigest,
    dispatch.ledgerShapeDigest === result.ledgerShapeDigest,
    dispatch.sqlDigest === result.baseSqlDigest,
    dispatch.markerBindingDigest === result.markerBindingDigest,
    dispatch.installSqlDigest === result.installSqlDigest,
    dispatch.verificationQueryDigest === result.verificationQueryDigest,
    databaseLedger.installedVerification.verificationDigest === result.installedVerificationDigest,
    databaseLedger.credentialLease.bindingDigest === result.credentialLeaseBindingDigest,
    databaseLedger.credentialLease.writeCredentialIncarnation === result.writeCredentialIncarnation,
    databaseLedger.credentialLease.operationLeaseGeneration === result.operationLeaseGeneration,
    result.provenance === 'testing'
  ].every(Boolean)
  if (!matches) return fail('supabase-backfill-receipt-zero-input-changed')
}

function requirePreparedAfterEvidence(
  preparedAt: string,
  scope: TrustedSupabaseBackfillExecutionScopeV2ForTestingContextV1,
  databaseLedger: TrustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1
): void {
  const lowerBound = Math.max(
    Date.parse(scope.capture.observedAt),
    Date.parse(scope.binding.trust.verifiedAt),
    Date.parse(databaseLedger.result.observedAt)
  )
  if (Date.parse(preparedAt) < lowerBound) {
    return fail('supabase-backfill-receipt-zero-timestamp-invalid')
  }
}

async function identifiers(
  identitySeedDigest: string
): Promise<SupabaseBackfillReceiptZeroOperationEvidenceV1['identifiers']> {
  const identifier = async (kind: 'execution' | 'receipt' | 'receipt-zero' | 'event') =>
    `${kind}:${await digest({
      format: 'openpencil.supabase-backfill-receipt-zero-identifier.v1',
      version: 1,
      kind,
      identitySeedDigest
    })}`
  return Object.freeze({
    identitySeedDigest,
    executionId: await identifier('execution'),
    receiptId: await identifier('receipt'),
    idempotencyKey: await identifier('receipt-zero'),
    databaseEventId: await identifier('event')
  })
}

function receiptOutcome(scope: SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1['scope']) {
  const matchedRowCountSatisfied =
    scope.requiredMatchedRowCount === null || scope.requiredMatchedRowCount === 0
  const alreadySatisfied = scope.initialRemainingTargetRowCount === 0 && matchedRowCountSatisfied
  return Object.freeze({
    fieldNotNull: scope.initialRemainingTargetRowCount === 0,
    matchedRowCountSatisfied,
    outcome: alreadySatisfied ? ('completed' as const) : ('in-progress' as const),
    terminalReason: alreadySatisfied ? ('already-satisfied' as const) : null
  })
}

/**
 * Build exact Receipt-zero review material from genuine testing provenance. This does not consume
 * the capture, issue a credential, persist a row, run SQL, or authenticate operationAuthorityDigest.
 */
export async function createSupabaseBackfillReceiptZeroReviewForTestingV1(
  input: CreateSupabaseBackfillReceiptZeroReviewForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroReviewEnvelopeV1> {
  const options = exactInput(input)
  const scopeEnvelopeValue = ownData(options, 'scopeEnvelope')
  const databaseLedgerInstallationValue = ownData(options, 'databaseLedgerInstallation')
  const preparedAt = canonicalTimestamp(ownData(options, 'preparedAt'))
  const nonceValue = ownData(options, 'nonce')
  if (
    scopeEnvelopeValue === null ||
    typeof scopeEnvelopeValue !== 'object' ||
    databaseLedgerInstallationValue === null ||
    typeof databaseLedgerInstallationValue !== 'object' ||
    typeof nonceValue !== 'string' ||
    !UUID.test(nonceValue)
  ) {
    return fail('supabase-backfill-receipt-zero-input-invalid')
  }
  const scopeEnvelope = scopeEnvelopeValue as SupabaseBackfillExecutionScopeV2EnvelopeForTestingV1
  const databaseLedgerInstallation =
    databaseLedgerInstallationValue as SupabaseBackfillDatabaseCASLedgerInstallAppliedResultV1
  const proof = requireProofs(scopeEnvelope, databaseLedgerInstallation)
  requireCurrentBindings(scopeEnvelope, databaseLedgerInstallation, proof)
  requirePreparedAfterEvidence(preparedAt, proof.scope, proof.databaseLedger)

  const scopeDigest = await digestBackendBackfillExecutionScopeV2(scopeEnvelope.scope)
  if (scopeDigest !== scopeEnvelope.scopeDigest) {
    return fail('supabase-backfill-receipt-zero-input-changed')
  }
  const sourceBinding = proof.scope.binding
  const installed = proof.databaseLedger.result
  const appliedResultDigest = await digest(installed)
  const identitySeedDigest = await digest(
    Object.freeze({
      format: 'openpencil.supabase-backfill-receipt-zero-identity-seed.v1' as const,
      version: 1 as const,
      nonce: nonceValue,
      projectRef: installed.projectRef,
      accountId: installed.accountId,
      receiptReviewDigest: proof.scope.receiptReview.reviewDigest,
      scopeDigest,
      sourceLedgerBindingDigest: sourceBinding.bindingDigest,
      appliedResultDigest
    })
  )
  const ids = await identifiers(identitySeedDigest)
  const operationEvidence = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_OPERATION_EVIDENCE_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    projectRef: installed.projectRef,
    accountId: installed.accountId,
    identifiers: ids,
    source: Object.freeze({
      receiptReviewDigest: proof.scope.receiptReview.reviewDigest,
      scopeDigest,
      sourceLedgerBindingDigest: sourceBinding.bindingDigest,
      sourceLedgerReviewDigest: sourceBinding.reviewDigest,
      sourceLedgerDigest: sourceBinding.bindings.sourceLedgerDigest,
      bindingReceiptDigest: sourceBinding.bindings.bindingReceiptDigest,
      subjectDigest: sourceBinding.bindings.subjectDigest,
      attestationDigest: sourceBinding.bindings.attestationDigest,
      trustRootId: sourceBinding.trust.trustRootId,
      ciRequestDigest: sourceBinding.trust.requestDigest,
      ciVerifiedAt: sourceBinding.trust.verifiedAt,
      captureDigest: proof.scope.capture.captureDigest,
      captureObservedAt: proof.scope.capture.observedAt,
      captureQueryDigest: proof.scope.capture.bindings.queryDigest,
      catalogPreconditionDigest: scopeEnvelope.scope.catalogPreconditionDigest
    }),
    databaseLedger: Object.freeze({
      provenance: 'testing' as const,
      appliedResultDigest,
      planDigest: installed.planDigest,
      installReviewDigest: installed.installReviewDigest,
      sourceReviewDigest: installed.sourceReviewDigest,
      verificationDigest: installed.verificationDigest,
      installedVerificationDigest: installed.installedVerificationDigest,
      ledgerShapeDigest: installed.ledgerShapeDigest,
      baseSqlDigest: installed.baseSqlDigest,
      marker: installed.marker,
      markerBindingDigest: installed.markerBindingDigest,
      installSqlDigest: installed.installSqlDigest,
      verificationQueryDigest: installed.verificationQueryDigest,
      credentialLeaseBindingDigest: installed.credentialLeaseBindingDigest,
      writeCredentialIncarnation: installed.writeCredentialIncarnation,
      operationLeaseGeneration: installed.operationLeaseGeneration,
      observedAt: installed.observedAt,
      snapshotMarker: installed.snapshotMarker,
      serverVersionNum: installed.serverVersionNum
    }),
    preparedAt
  }) satisfies SupabaseBackfillReceiptZeroOperationEvidenceV1
  const candidateOperationEvidenceDigest = await digest(operationEvidence)
  const outcome = receiptOutcome(scopeEnvelope.scope)
  const requestDigest = await digest(
    Object.freeze({
      format: SUPABASE_BACKFILL_RECEIPT_ZERO_REQUEST_FORMAT,
      version: 1 as const,
      providerId: 'supabase' as const,
      environment: 'staging' as const,
      projectRef: installed.projectRef,
      accountId: installed.accountId,
      identifiers: ids,
      scopeDigest,
      candidateOperationEvidenceDigest,
      expectedHeadDigest: null,
      requestedRevision: 1 as const,
      requestedCheckpointKind: 'capture' as const,
      initialRemainingEligibleRowCount: scopeEnvelope.scope.initialRemainingEligibleRowCount,
      initialRemainingTargetRowCount: scopeEnvelope.scope.initialRemainingTargetRowCount,
      initialOutcome: outcome.outcome,
      initialTerminalReason: outcome.terminalReason,
      preparedAt
    })
  )
  let receipt: BackendBackfillExecutionReceiptV2
  try {
    receipt = parseBackendBackfillExecutionReceiptV2({
      format: 'openpencil.backend-backfill-execution-receipt',
      version: 2,
      receiptId: ids.receiptId,
      executionId: ids.executionId,
      idempotencyKey: ids.idempotencyKey,
      requestDigest,
      scope: scopeEnvelope.scope,
      scopeDigest,
      checkpointKind: 'capture',
      batchIndex: 0,
      previousCursor: null,
      lastProcessedKey: null,
      batchCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 },
      cumulativeCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 },
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: scopeEnvelope.scope.initialRemainingEligibleRowCount,
        remainingTargetRowCount: scopeEnvelope.scope.initialRemainingTargetRowCount
      },
      postconditions: {
        fieldNotNull: outcome.fieldNotNull,
        requiredMatchedRowCount: scopeEnvelope.scope.requiredMatchedRowCount,
        matchedRowCountSatisfied: outcome.matchedRowCountSatisfied
      },
      outcome: outcome.outcome,
      terminalReason: outcome.terminalReason,
      stableErrorCode: null,
      previousReceiptDigest: null,
      catalogEvidenceDigest: scopeEnvelope.scope.catalogPreconditionDigest,
      operationAuthorityDigest: candidateOperationEvidenceDigest,
      databaseEventId: ids.databaseEventId,
      databaseHeadVersion: 1,
      committedAt: preparedAt,
      evidenceDigest: scopeEnvelope.scope.receiptZeroEvidenceDigest
    })
  } catch {
    return fail('supabase-backfill-receipt-zero-receipt-invalid')
  }
  let receiptDigest: string
  let canonicalScopeBytes: Uint8Array
  let canonicalReceiptBytes: Uint8Array
  try {
    receiptDigest = await digestBackendBackfillExecutionReceiptV2(receipt)
    canonicalScopeBytes = canonicalBackendBackfillExecutionScopeV2Bytes(scopeEnvelope.scope)
    canonicalReceiptBytes = canonicalBackendBackfillExecutionReceiptV2Bytes(receipt)
  } catch {
    return fail('supabase-backfill-receipt-zero-digest-failed')
  }
  if (
    canonicalScopeBytes.byteLength > SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES ||
    canonicalReceiptBytes.byteLength > SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES
  ) {
    return fail('supabase-backfill-receipt-zero-capacity-exceeded')
  }
  const verified = await verifyBackendBackfillExecutionReceiptChainV2([receipt], {
    scope: scopeEnvelope.scope,
    expectedHeadDigest: receiptDigest,
    evaluatedAt: preparedAt
  })
  if (!verified.ok || verified.computedHeadDigest !== receiptDigest) {
    return fail('supabase-backfill-receipt-zero-receipt-invalid')
  }
  const executionStatus =
    receipt.outcome === 'completed' ? ('completed' as const) : ('running' as const)
  const rowPlan = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_ROW_PLAN_FORMAT,
    version: 1 as const,
    execution: Object.freeze({
      executionId: receipt.executionId,
      scopeDigest,
      captureDigest: receipt.scope.captureDigest,
      status: executionStatus,
      canonicalScopeByteLength: canonicalScopeBytes.byteLength,
      createdAt: preparedAt,
      updatedAt: preparedAt
    }),
    receipt: Object.freeze({
      executionId: receipt.executionId,
      revision: 1 as const,
      eventId: receipt.databaseEventId,
      receiptId: receipt.receiptId,
      idempotencyKey: receipt.idempotencyKey,
      requestDigest,
      receiptDigest,
      previousRevision: null,
      previousEventId: null,
      previousReceiptDigest: null,
      checkpointKind: 'capture' as const,
      canonicalReceiptByteLength: canonicalReceiptBytes.byteLength,
      committedAt: preparedAt
    }),
    head: Object.freeze({
      executionId: receipt.executionId,
      revision: 1 as const,
      eventId: receipt.databaseEventId,
      receiptDigest,
      updatedAt: preparedAt
    })
  }) satisfies SupabaseBackfillReceiptZeroRowPlanV1
  const rowPlanDigest = await digest(rowPlan)
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    sourceLedgerBound: false as const,
    testingSourceLedgerBound: true as const,
    ciAuthenticated: false as const,
    testingCiVerified: true as const,
    testingDatabaseLedgerInstalledProofObserved: true as const,
    databaseLedgerBound: false as const,
    operationAuthorityAuthenticated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      receiptReviewDigest: proof.scope.receiptReview.reviewDigest,
      scopeDigest,
      sourceLedgerBindingDigest: sourceBinding.bindingDigest,
      sourceLedgerDigest: sourceBinding.bindings.sourceLedgerDigest,
      captureDigest: proof.scope.capture.captureDigest,
      databaseLedgerInstallPlanDigest: installed.planDigest,
      databaseLedgerInstallReviewDigest: installed.installReviewDigest,
      installedVerificationDigest: installed.installedVerificationDigest,
      appliedResultDigest,
      candidateOperationEvidenceDigest,
      requestDigest,
      receiptDigest,
      rowPlanDigest
    }),
    authority: Object.freeze({
      projectRef: installed.projectRef,
      accountId: installed.accountId
    }),
    operationEvidence,
    receipt,
    rowPlan,
    policy: Object.freeze({
      databaseTransactionRequired: true as const,
      isolation: 'serializable' as const,
      expectedInitialHead: null,
      insertOrder: Object.freeze(['execution', 'receipt', 'head'] as const),
      exactReplayOnly: true as const,
      conflictUpdateAllowed: false as const,
      advancedHeadMayBeRewound: false as const,
      partialStateIsCorruption: true as const,
      captureConsumed: false as const,
      operationCredentialIssued: false as const,
      installCredentialLeaseUsedAsProvenanceOnly: true as const,
      databaseLedgerReverificationRequired: true as const,
      receiptOperationAuthorityDigestIsUnauthenticatedTestingEvidence: true as const,
      mutationDispatched: false as const,
      requestDispatched: false as const,
      receiptPersisted: false as const,
      databaseCASCommitted: false as const,
      databaseCommitTimeObserved: false as const,
      candidateCommittedAtEqualsPreparedAt: true as const,
      outcomeUnknownRequiresReadOnlyReconciliation: true as const,
      automaticRetryAllowed: false as const
    }),
    blockers: uniqueBlockers([...sourceBinding.blockers, ...REVIEW_BLOCKERS])
  }) satisfies SupabaseBackfillReceiptZeroReviewV1
  const envelope = Object.freeze({ review, reviewDigest: await digest(review) })
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      scopeContext: proof.scope,
      databaseLedgerContext: proof.databaseLedger,
      canonicalScopeJSON: new TextDecoder().decode(canonicalScopeBytes),
      canonicalReceiptJSON: new TextDecoder().decode(canonicalReceiptBytes)
    })
  )
  return envelope
}

/** Identity-only lookup for a future initializer; it still creates or consumes no authority. */
export function trustedSupabaseBackfillReceiptZeroReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptZeroReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (
    !context ||
    !trustedSupabaseBackfillExecutionScopeV2ForTestingContextV1(context.scopeContext.envelope) ||
    !trustedSupabaseBackfillDatabaseCASLedgerInstallAppliedContextV1(
      context.databaseLedgerContext.result
    ) ||
    !trustedSupabaseBackfillLockedHighWaterCaptureV1(context.scopeContext.capture)
  ) {
    return null
  }
  return context
}
