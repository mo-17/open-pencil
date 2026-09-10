/* oxlint-disable eslint(max-lines), eslint(complexity) -- The fixed transaction, parameter contract, state machine, and provenance checks form one audit boundary. */

import {
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  canonicalBackendBackfillExecutionScopeV2Bytes,
  digestBackendBackfillExecutionReceiptV2,
  digestBackendBackfillExecutionScopeV2
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  trustedSupabaseBackfillReceiptZeroReviewContextV1,
  type SupabaseBackfillReceiptZeroReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptZeroReviewContextV1
} from '../review'
import SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE from './v1.sql?raw'

export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-cas-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_ID = 'backfill-receipt-zero-cas' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_VERSION =
  'openpencil-supabase-backfill-receipt-zero-cas-v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/receipt-zero-cas-review.sql' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_STATEMENT_COUNT = 1 as const

export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER = Object.freeze([
  'executionId',
  'applicationId',
  'applicationDigest',
  'migrationId',
  'migrationDigest',
  'migrationPlanDigest',
  'providerAuthorityDigest',
  'sourceLedgerDigest',
  'scopeDigest',
  'resourceIdentityDigest',
  'catalogPreconditionDigest',
  'canonicalScopeBase64',
  'captureDigest',
  'capturedHighWater',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'requiredMatchedRowCount',
  'requiredBatchCount',
  'batchSize',
  'initialExecutionStatus',
  'candidateCommittedAt',
  'eventId',
  'receiptId',
  'idempotencyKey',
  'requestDigest',
  'receiptDigest',
  'canonicalReceiptBase64',
  'unauthenticatedOperationEvidenceDigest'
] as const)

export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES = Object.freeze([
  'inserted',
  'exact-replay',
  'advanced-head',
  'corruption',
  'precondition-failed'
] as const)

const INPUT_KEYS = ['receiptZeroReview'] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
// This is intentionally identical to the fixed SQL and native precommit grammar. Rejecting the
// six identifiers while the artifact is still review-only prevents a value accepted by the wider
// portable release-id grammar from reaching a durable OutcomeUnknown fence that the CAS statement
// must deterministically refuse.
const PRECOMMIT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const BLOCKERS = Object.freeze([
  'receipt-zero-cas-testing-review-only',
  'receipt-zero-cas-production-operation-authority-not-created',
  'receipt-zero-cas-database-ledger-not-reverified-in-transaction',
  'receipt-zero-cas-capture-not-consumed',
  'receipt-zero-cas-parameterized-management-transport-not-certified',
  'receipt-zero-cas-production-response-authentication-unavailable',
  'receipt-zero-cas-read-only-reconciliation-unavailable',
  'receipt-zero-candidate-commit-time-untrusted',
  'bounded-runner-unavailable'
] as const)

type ParameterValue = string | null
type ParameterName = (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER)[number]
type ResultState = (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES)[number]

export interface CreateSupabaseBackfillReceiptZeroCASReviewForTestingOptionsV1 {
  readonly receiptZeroReview: SupabaseBackfillReceiptZeroReviewEnvelopeV1
}

export interface SupabaseBackfillReceiptZeroCASParameterV1 {
  readonly position: number
  readonly name: ParameterName
  readonly pgType: 'text' | 'bigint' | 'integer'
  readonly nullable: boolean
  readonly encoding: 'plain-text' | 'decimal-text' | 'standard-base64' | 'rfc3339'
}

export interface SupabaseBackfillReceiptZeroCASReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly databaseLedgerBound: false
  readonly operationAuthorityAuthenticated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    receiptZeroReviewDigest: string
    scopeDigest: string
    receiptDigest: string
    rowPlanDigest: string
    candidateOperationEvidenceDigest: string
    transactionSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
  }>
  readonly transaction: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_VERSION
    isolation: 'serializable'
    snapshotScope: 'externally-established-serializable-transaction'
    accessMode: 'read-write'
    statementCount: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_STATEMENT_COUNT
    dmlCTECount: 3
    lockOrder: readonly ['execution', 'head', 'receipt']
    insertOrder: readonly ['execution', 'receipt', 'head']
    executionInsertConflictAction: 'do-nothing'
    receiptInsertConflictAction: 'error-rollback'
    headInsertConflictAction: 'error-rollback'
    conflictUpdateAllowed: false
    exactReplayWrites: false
    advancedHeadWrites: false
    corruptionWrites: false
    preconditionFailedWrites: false
    advancedHeadMayBeRewound: false
    advancedHeadIsRelationalClassificationOnly: true
    advancedHeadRequiresReadOnlyChainReconciliation: true
    absentIsPreStateOnly: true
    finalStates: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES
    responseShape: 'one-row-one-status-field'
    requiresExternallyEstablishedSerializableTransaction: true
    requiresExternallyBoundedStatementTimeout: true
    requiresExternallyBoundedLockTimeout: true
    establishesTransaction: false
    directManagementQueryDispatchCompatible: false
  }>
  readonly parameters: Readonly<{
    order: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER
    schema: readonly SupabaseBackfillReceiptZeroCASParameterV1[]
    valueCount: 28
    valuesExposed: false
    canonicalScopeByteLength: number
    canonicalReceiptByteLength: number
  }>
  readonly classification: Readonly<{
    absent: 'no-execution-scope-capture-collision-and-no-receipt-or-head'
    inserted: 'absent-and-all-three-inserts-returned-one-row'
    exactReplay: 'all-initial-execution-receipt-head-columns-and-canonical-bytes-equal'
    advancedHead: 'immutable-execution-and-receipt-zero-equal-with-complete-database-tuple-chain'
    corruption: 'every-other-partial-collision-or-byte-mismatch-state'
    preconditionFailed: 'transaction-role-primary-or-runtime-setting-is-not-exact'
  }>
  readonly policy: Readonly<{
    previewContainsPlaceholdersOnly: true
    canonicalValuesKeptInTrustedContextOnly: true
    databaseLedgerReverificationIncluded: false
    captureConsumed: false
    operationCredentialIssued: false
    operationAuthorityDigestIsUnauthenticatedTestingEvidence: true
    candidateCommittedAtIsUntrusted: true
    databaseCommitTimeObserved: false
    managementTransportCreated: false
    currentManagementQueryEndpointCompatible: false
    requestDispatched: false
    mutationDispatched: false
    receiptPersisted: false
    databaseCASCommitted: false
    ambiguousOutcomeRequiresReadOnlyReconciliation: true
    automaticRetryAllowed: false
    serializationFailureMayBeRetriedAutomatically: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_ARTIFACT_PATH
    kind: 'receipt-zero-cas-transaction-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    containsCatalogRead: false
    containsManagedDataRead: true
    containsDml: true
    performsSchemaChange: false
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillReceiptZeroCASReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptZeroCASReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/** Process-local parameter material only. It grants no credential, permit, or mutation authority. */
export interface TrustedSupabaseBackfillReceiptZeroCASReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1
  readonly receiptZeroContext: TrustedSupabaseBackfillReceiptZeroReviewContextV1
  readonly parameters: readonly ParameterValue[]
}

export type SupabaseBackfillReceiptZeroCASReviewErrorCode =
  | 'supabase-backfill-receipt-zero-cas-input-invalid'
  | 'supabase-backfill-receipt-zero-cas-proof-invalid'
  | 'supabase-backfill-receipt-zero-cas-input-changed'
  | 'supabase-backfill-receipt-zero-cas-digest-failed'

export class SupabaseBackfillReceiptZeroCASReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptZeroCASReviewErrorCode) {
    super(`Supabase backfill Receipt-zero CAS review failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptZeroCASReviewError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ReceiptZeroRuntimeView {
  readonly format: unknown
  readonly version: unknown
  readonly providerId: unknown
  readonly environmentIntent: unknown
  readonly testingOnly: unknown
  readonly reviewOnly: unknown
  readonly applyAvailable: unknown
  readonly releaseReady: unknown
  readonly databaseLedgerBound: unknown
  readonly operationAuthorityAuthenticated: unknown
  readonly mutationAuthorityCreated: unknown
  readonly policy: Readonly<{
    captureConsumed: unknown
    operationCredentialIssued: unknown
    receiptOperationAuthorityDigestIsUnauthenticatedTestingEvidence: unknown
    mutationDispatched: unknown
    requestDispatched: unknown
    receiptPersisted: unknown
    databaseCASCommitted: unknown
    automaticRetryAllowed: unknown
  }>
}

const trustedReviews = new WeakMap<object, TrustedSupabaseBackfillReceiptZeroCASReviewContextV1>()

function fail(code: SupabaseBackfillReceiptZeroCASReviewErrorCode): never {
  throw new SupabaseBackfillReceiptZeroCASReviewError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  for (const key of INPUT_KEYS) ownData(value, key)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-digest-failed')
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-digest-failed')
  }
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

const BIGINT_PARAMETERS = new Set<ParameterName>([
  'capturedHighWater',
  'initialRemainingEligibleRowCount',
  'initialRemainingTargetRowCount',
  'requiredMatchedRowCount'
])
const INTEGER_PARAMETERS = new Set<ParameterName>(['requiredBatchCount', 'batchSize'])

function parameterType(name: ParameterName): SupabaseBackfillReceiptZeroCASParameterV1['pgType'] {
  if (BIGINT_PARAMETERS.has(name)) return 'bigint'
  if (INTEGER_PARAMETERS.has(name)) return 'integer'
  return 'text'
}

function parameterEncoding(
  name: ParameterName
): SupabaseBackfillReceiptZeroCASParameterV1['encoding'] {
  if (name === 'canonicalScopeBase64' || name === 'canonicalReceiptBase64') {
    return 'standard-base64'
  }
  if (BIGINT_PARAMETERS.has(name) || INTEGER_PARAMETERS.has(name)) return 'decimal-text'
  if (name === 'candidateCommittedAt') return 'rfc3339'
  return 'plain-text'
}

export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA = Object.freeze(
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.map((name, index) => {
    return Object.freeze({
      position: index + 1,
      name,
      pgType: parameterType(name),
      nullable: name === 'capturedHighWater' || name === 'requiredMatchedRowCount',
      encoding: parameterEncoding(name)
    }) satisfies SupabaseBackfillReceiptZeroCASParameterV1
  })
)

/**
 * Fixed single-statement review SQL. A future native transport must establish SERIALIZABLE READ
 * WRITE, row_security=off, and search_path=pg_catalog before invoking this statement. The current
 * Management query endpoint cannot do that around a parameterized statement and must not dispatch
 * it. The testing Receipt's committedAt and operationAuthorityDigest are not production authority.
 */
export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL = SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL_SOURCE

function requireReceiptZero(value: unknown): Readonly<{
  envelope: SupabaseBackfillReceiptZeroReviewEnvelopeV1
  context: TrustedSupabaseBackfillReceiptZeroReviewContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-zero-cas-input-invalid')
  }
  const envelope = value as SupabaseBackfillReceiptZeroReviewEnvelopeV1
  const context = trustedSupabaseBackfillReceiptZeroReviewContextV1(envelope)
  if (!context) return fail('supabase-backfill-receipt-zero-cas-proof-invalid')
  return Object.freeze({ envelope, context })
}

async function requireCurrentReceiptZero(
  envelope: SupabaseBackfillReceiptZeroReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroReviewContextV1
): Promise<void> {
  const review = envelope.review
  const runtime: ReceiptZeroRuntimeView = review
  const receipt = review.receipt
  const scope = receipt.scope
  if (
    context.envelope !== envelope ||
    runtime.format !== 'openpencil.supabase-backfill-receipt-zero-review.v1' ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environmentIntent !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.reviewOnly !== true ||
    runtime.applyAvailable !== false ||
    runtime.releaseReady !== false ||
    runtime.databaseLedgerBound !== false ||
    runtime.operationAuthorityAuthenticated !== false ||
    runtime.mutationAuthorityCreated !== false ||
    runtime.policy.captureConsumed !== false ||
    runtime.policy.operationCredentialIssued !== false ||
    runtime.policy.receiptOperationAuthorityDigestIsUnauthenticatedTestingEvidence !== true ||
    runtime.policy.mutationDispatched !== false ||
    runtime.policy.requestDispatched !== false ||
    runtime.policy.receiptPersisted !== false ||
    runtime.policy.databaseCASCommitted !== false ||
    runtime.policy.automaticRetryAllowed !== false ||
    ![
      receipt.executionId,
      scope.applicationId,
      scope.migrationId,
      receipt.databaseEventId,
      receipt.receiptId,
      receipt.idempotencyKey
    ].every((value) => typeof value === 'string' && PRECOMMIT_IDENTIFIER.test(value))
  ) {
    return fail('supabase-backfill-receipt-zero-cas-input-changed')
  }
  const [reviewDigest, scopeDigest, receiptDigest, rowPlanDigest, operationEvidenceDigest] =
    await Promise.all([
      digest(review),
      digestBackendBackfillExecutionScopeV2(review.receipt.scope),
      digestBackendBackfillExecutionReceiptV2(review.receipt),
      digest(review.rowPlan),
      digest(review.operationEvidence)
    ])
  let scopeJSON: string
  let receiptJSON: string
  try {
    scopeJSON = new TextDecoder().decode(
      canonicalBackendBackfillExecutionScopeV2Bytes(review.receipt.scope)
    )
    receiptJSON = new TextDecoder().decode(
      canonicalBackendBackfillExecutionReceiptV2Bytes(review.receipt)
    )
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-input-changed')
  }
  if (
    !DIGEST.test(envelope.reviewDigest) ||
    reviewDigest !== envelope.reviewDigest ||
    scopeDigest !== review.bindings.scopeDigest ||
    receiptDigest !== review.bindings.receiptDigest ||
    rowPlanDigest !== review.bindings.rowPlanDigest ||
    operationEvidenceDigest !== review.bindings.candidateOperationEvidenceDigest ||
    review.receipt.operationAuthorityDigest !== operationEvidenceDigest ||
    scopeJSON !== context.canonicalScopeJSON ||
    receiptJSON !== context.canonicalReceiptJSON ||
    review.rowPlan.execution.executionId !== review.receipt.executionId ||
    review.rowPlan.execution.scopeDigest !== scopeDigest ||
    review.rowPlan.execution.captureDigest !== review.receipt.scope.captureDigest ||
    review.rowPlan.execution.createdAt !== review.receipt.committedAt ||
    review.rowPlan.execution.updatedAt !== review.receipt.committedAt ||
    review.rowPlan.receipt.receiptDigest !== receiptDigest ||
    review.rowPlan.receipt.committedAt !== review.receipt.committedAt ||
    review.rowPlan.head.receiptDigest !== receiptDigest ||
    review.rowPlan.head.updatedAt !== review.receipt.committedAt
  ) {
    return fail('supabase-backfill-receipt-zero-cas-input-changed')
  }
}

function parameters(
  review: SupabaseBackfillReceiptZeroReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroReviewContextV1
): readonly ParameterValue[] {
  const receipt = review.review.receipt
  const scope = receipt.scope
  const plan = review.review.rowPlan
  const scopeBytes = new TextEncoder().encode(context.canonicalScopeJSON)
  const receiptBytes = new TextEncoder().encode(context.canonicalReceiptJSON)
  return Object.freeze([
    receipt.executionId,
    scope.applicationId,
    scope.applicationDigest,
    scope.migrationId,
    scope.migrationDigest,
    scope.migrationPlanDigest,
    scope.providerAuthorityDigest,
    scope.sourceLedgerDigest,
    review.review.bindings.scopeDigest,
    scope.resourceIdentityDigest,
    scope.catalogPreconditionDigest,
    encodeBase64(scopeBytes),
    scope.captureDigest,
    scope.capturedHighWater === null ? null : String(scope.capturedHighWater),
    String(scope.initialRemainingEligibleRowCount),
    String(scope.initialRemainingTargetRowCount),
    scope.requiredMatchedRowCount === null ? null : String(scope.requiredMatchedRowCount),
    String(scope.requiredBatchCount),
    String(scope.batchSize),
    plan.execution.status,
    receipt.committedAt,
    receipt.databaseEventId,
    receipt.receiptId,
    receipt.idempotencyKey,
    receipt.requestDigest,
    review.review.bindings.receiptDigest,
    encodeBase64(receiptBytes),
    review.review.bindings.candidateOperationEvidenceDigest
  ])
}

/**
 * Build a deterministic testing-only SQL and parameter review. No parameterized Management
 * transport is created here, and the genuine locked capture remains unconsumed.
 */
export async function createSupabaseBackfillReceiptZeroCASReviewForTestingV1(
  input: CreateSupabaseBackfillReceiptZeroCASReviewForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroCASReviewEnvelopeV1> {
  const source = exactInput(input)
  const proof = requireReceiptZero(ownData(source, 'receiptZeroReview'))
  await requireCurrentReceiptZero(proof.envelope, proof.context)

  const parameterValues = parameters(proof.envelope, proof.context)
  if (parameterValues.length !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length) {
    return fail('supabase-backfill-receipt-zero-cas-input-changed')
  }
  const [transactionSqlDigest, parameterSchemaDigest, parameterValuesDigest] = await Promise.all([
    digestSql(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL),
    digest(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values: parameterValues
      })
    )
  ])
  const receiptZero = proof.envelope.review
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    databaseLedgerBound: false as const,
    operationAuthorityAuthenticated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      receiptZeroReviewDigest: proof.envelope.reviewDigest,
      scopeDigest: receiptZero.bindings.scopeDigest,
      receiptDigest: receiptZero.bindings.receiptDigest,
      rowPlanDigest: receiptZero.bindings.rowPlanDigest,
      candidateOperationEvidenceDigest: receiptZero.bindings.candidateOperationEvidenceDigest,
      transactionSqlDigest,
      parameterSchemaDigest,
      parameterValuesDigest
    }),
    transaction: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_QUERY_VERSION,
      isolation: 'serializable' as const,
      snapshotScope: 'externally-established-serializable-transaction' as const,
      accessMode: 'read-write' as const,
      statementCount: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_STATEMENT_COUNT,
      dmlCTECount: 3 as const,
      lockOrder: Object.freeze(['execution', 'head', 'receipt'] as const),
      insertOrder: Object.freeze(['execution', 'receipt', 'head'] as const),
      executionInsertConflictAction: 'do-nothing' as const,
      receiptInsertConflictAction: 'error-rollback' as const,
      headInsertConflictAction: 'error-rollback' as const,
      conflictUpdateAllowed: false as const,
      exactReplayWrites: false as const,
      advancedHeadWrites: false as const,
      corruptionWrites: false as const,
      preconditionFailedWrites: false as const,
      advancedHeadMayBeRewound: false as const,
      advancedHeadIsRelationalClassificationOnly: true as const,
      advancedHeadRequiresReadOnlyChainReconciliation: true as const,
      absentIsPreStateOnly: true as const,
      finalStates: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES,
      responseShape: 'one-row-one-status-field' as const,
      requiresExternallyEstablishedSerializableTransaction: true as const,
      requiresExternallyBoundedStatementTimeout: true as const,
      requiresExternallyBoundedLockTimeout: true as const,
      establishesTransaction: false as const,
      directManagementQueryDispatchCompatible: false as const
    }),
    parameters: Object.freeze({
      order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      schema: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_SCHEMA,
      valueCount: 28 as const,
      valuesExposed: false as const,
      canonicalScopeByteLength: receiptZero.rowPlan.execution.canonicalScopeByteLength,
      canonicalReceiptByteLength: receiptZero.rowPlan.receipt.canonicalReceiptByteLength
    }),
    classification: Object.freeze({
      absent: 'no-execution-scope-capture-collision-and-no-receipt-or-head' as const,
      inserted: 'absent-and-all-three-inserts-returned-one-row' as const,
      exactReplay: 'all-initial-execution-receipt-head-columns-and-canonical-bytes-equal' as const,
      advancedHead:
        'immutable-execution-and-receipt-zero-equal-with-complete-database-tuple-chain' as const,
      corruption: 'every-other-partial-collision-or-byte-mismatch-state' as const,
      preconditionFailed: 'transaction-role-primary-or-runtime-setting-is-not-exact' as const
    }),
    policy: Object.freeze({
      previewContainsPlaceholdersOnly: true as const,
      canonicalValuesKeptInTrustedContextOnly: true as const,
      databaseLedgerReverificationIncluded: false as const,
      captureConsumed: false as const,
      operationCredentialIssued: false as const,
      operationAuthorityDigestIsUnauthenticatedTestingEvidence: true as const,
      candidateCommittedAtIsUntrusted: true as const,
      databaseCommitTimeObserved: false as const,
      managementTransportCreated: false as const,
      currentManagementQueryEndpointCompatible: false as const,
      requestDispatched: false as const,
      mutationDispatched: false as const,
      receiptPersisted: false as const,
      databaseCASCommitted: false as const,
      ambiguousOutcomeRequiresReadOnlyReconciliation: true as const,
      automaticRetryAllowed: false as const,
      serializationFailureMayBeRetriedAutomatically: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_ARTIFACT_PATH,
      kind: 'receipt-zero-cas-transaction-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL).byteLength,
      digest: transactionSqlDigest,
      containsCatalogRead: false as const,
      containsManagedDataRead: true as const,
      containsDml: true as const,
      performsSchemaChange: false as const,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: uniqueBlockers([...receiptZero.blockers, ...BLOCKERS])
  }) satisfies SupabaseBackfillReceiptZeroCASReviewV1
  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL
  })
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      receiptZeroContext: proof.context,
      parameters: parameterValues
    })
  )
  return envelope
}

/** Identity-only parameter lookup; callers still receive no credential, permit, or dispatcher. */
export function trustedSupabaseBackfillReceiptZeroCASReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptZeroCASReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (
    !context ||
    !trustedSupabaseBackfillReceiptZeroReviewContextV1(context.receiptZeroContext.envelope)
  ) {
    return null
  }
  return context
}

export type SupabaseBackfillReceiptZeroCASResultStateV1 = ResultState
