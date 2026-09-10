/* oxlint-disable eslint(max-lines), eslint(complexity) -- Strict response decoding, Host state recomputation, and provenance checks form one audit boundary. */

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_REVIEW_FORMAT,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
  trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1,
  type SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  type SupabaseBackfillReceiptZeroReconciliationStateV1,
  type TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
} from './review'

export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_OBSERVATION_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-reconciliation-observation.v1' as const

const INPUT_KEYS = ['reconciliationReview', 'response'] as const
const RESPONSE_STATES = new Set<SupabaseBackfillReceiptZeroReconciliationStateV1>(
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES
)
const INITIAL_EXECUTION_STATUSES = new Set<'running' | 'completed'>(['running', 'completed'])
const INITIAL_RECEIPT_OUTCOMES = new Set<'in-progress' | 'completed'>(['in-progress', 'completed'])
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const RFC3339_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u

export interface ParseSupabaseBackfillReceiptZeroReconciliationResponseForTestingOptionsV1 {
  readonly reconciliationReview: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly response: unknown
}

export interface SupabaseBackfillReceiptZeroReconciliationFactsV1 {
  readonly inputValid: boolean
  readonly runtimeReady: boolean
  readonly fullLedgerShapeVerified: boolean
  readonly collisionExecutionCount: number
  readonly targetExecutionCount: number
  readonly exactInitialExecutionCount: number
  readonly exactImmutableExecutionCount: number
  readonly receiptCount: number
  readonly exactReceiptZeroCount: number
  readonly headCount: number
  readonly headRevision: number | null
  readonly exactInitialHeadCount: number
  readonly chainCount: number
  readonly chainMinimumRevision: number | null
  readonly chainMaximumRevision: number | null
  readonly headTimestampMatchesLatestReceipt: boolean
  readonly executionTimestampMatchesHead: boolean
}

/**
 * Sanitized testing observation. Its state is recomputed by the Host, but the injected response is
 * not production-authenticated and therefore cannot mint database, Receipt, or release authority.
 */
export interface SupabaseBackfillReceiptZeroReconciliationObservationV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_OBSERVATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly reportedStatus: SupabaseBackfillReceiptZeroReconciliationStateV1
  readonly status: SupabaseBackfillReceiptZeroReconciliationStateV1
  readonly bindings: Readonly<{
    reconciliationReviewDigest: string
    reconciliationQueryDigest: string
    reconciliationSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
    scopeDigest: string
    receiptDigest: string
    candidateOperationEvidenceDigest: string
    historicalInstallMarkerDigest: string
    observedInstallMarkerDigest: string | null
    responseDigest: string
  }>
  readonly facts: SupabaseBackfillReceiptZeroReconciliationFactsV1
  readonly snapshot: Readonly<{
    transactionReadOnly: boolean
    serverVersionNum: string
    snapshotDigest: string
    observedAt: string
  }>
  readonly reportedStatusMatchesRecomputedFacts: true
  readonly statusRecomputedByHost: true
  readonly reportedInstallMarkerDigestMatchesHistorical: boolean
  readonly specificHistoricalInstallationAuthenticated: false
  readonly reportedStatusProvesDatabaseState: false
  readonly statusProvesDatabaseState: false
  readonly productionTransportAuthenticated: false
  readonly fullPortableReceiptV2ChainVerified: false
  readonly advancedHeadRequiresFullPortableReceiptV2ChainVerification: boolean
  readonly absentProvesPriorMutationStopped: false
  readonly automaticRetryAllowed: false
  readonly captureConsumed: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillReceiptZeroReconciliationResponseErrorCode =
  | 'supabase-backfill-receipt-zero-reconciliation-response-input-invalid'
  | 'supabase-backfill-receipt-zero-reconciliation-response-proof-invalid'
  | 'supabase-backfill-receipt-zero-reconciliation-response-review-changed'
  | 'supabase-backfill-receipt-zero-reconciliation-response-invalid'
  | 'supabase-backfill-receipt-zero-reconciliation-response-binding-mismatch'
  | 'supabase-backfill-receipt-zero-reconciliation-response-digest-failed'

export class SupabaseBackfillReceiptZeroReconciliationResponseError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode) {
    super(`Supabase backfill Receipt-zero reconciliation response failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptZeroReconciliationResponseError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface CurrentReviewBindingsV1 {
  readonly reconciliationReviewDigest: string
  readonly reconciliationQueryDigest: string
  readonly reconciliationSqlDigest: string
  readonly parameterSchemaDigest: string
  readonly parameterValuesDigest: string
  readonly expectedColumnInventoryDigest: string
  readonly expectedConstraintInventoryDigest: string
  readonly scopeDigest: string
  readonly receiptDigest: string
  readonly candidateOperationEvidenceDigest: string
  readonly historicalInstallMarkerDigest: string
  readonly initialExecutionStatus: 'running' | 'completed'
  readonly initialReceiptOutcome: 'in-progress' | 'completed'
}

interface ParsedResponseV1 {
  readonly reportedStatus: SupabaseBackfillReceiptZeroReconciliationStateV1
  readonly initialExecutionStatus: 'running' | 'completed'
  readonly initialReceiptOutcome: 'in-progress' | 'completed'
  readonly scopeDigest: string
  readonly receiptDigest: string
  readonly candidateOperationEvidenceDigest: string
  readonly installMarkerDigest: string | null
  readonly facts: SupabaseBackfillReceiptZeroReconciliationFactsV1
  readonly snapshot: SupabaseBackfillReceiptZeroReconciliationObservationV1['snapshot']
  readonly canonicalResponse: readonly Readonly<Record<string, unknown>>[]
}

function fail(code: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode): never {
  throw new SupabaseBackfillReceiptZeroReconciliationResponseError(code)
}

function ownKeys(
  value: object,
  code: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function exactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: SupabaseBackfillReceiptZeroReconciliationResponseErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object') return fail(code)
  let prototype: object | null
  try {
    if (Array.isArray(value)) return fail(code)
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail(code)
  }
  if (prototype !== Object.prototype && prototype !== null) return fail(code)
  const keys = ownKeys(value, code)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return fail(code)
  }
  const snapshot: UnknownRecord = {}
  for (const key of expectedKeys) snapshot[key] = ownData(value, key, code)
  return Object.freeze(snapshot)
}

function exactInput(value: unknown): UnknownRecord {
  return exactPlainRecord(
    value,
    INPUT_KEYS,
    'supabase-backfill-receipt-zero-reconciliation-response-input-invalid'
  )
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  return value as number
}

function nullableInt32(value: unknown): number | null {
  if (value === null) return null
  return integer(value, -2_147_483_648, 2_147_483_647)
}

function digestValue(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  return value
}

function nullableDigest(value: unknown): string | null {
  if (value === null) return null
  return digestValue(value)
}

function oneOf<T extends string>(value: unknown, values: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  return value as T
}

function canonicalTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !RFC3339_MILLISECONDS.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  if (new Date(value).toISOString() !== value) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  return value
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-digest-failed')
  }
}

function requireConsistentFacts(facts: SupabaseBackfillReceiptZeroReconciliationFactsV1): void {
  const gated = facts.inputValid && facts.runtimeReady && facts.fullLedgerShapeVerified
  if (
    facts.targetExecutionCount > facts.collisionExecutionCount ||
    facts.exactInitialExecutionCount > facts.targetExecutionCount ||
    facts.exactImmutableExecutionCount > facts.targetExecutionCount ||
    facts.exactInitialExecutionCount > facts.exactImmutableExecutionCount ||
    facts.exactReceiptZeroCount > facts.receiptCount ||
    facts.exactInitialHeadCount > facts.headCount ||
    (facts.headCount === 0 && facts.headRevision !== null) ||
    facts.chainCount > facts.receiptCount * facts.headCount ||
    (facts.chainCount === 0 &&
      (facts.chainMinimumRevision !== null || facts.chainMaximumRevision !== null)) ||
    (facts.chainCount > 0 &&
      (facts.chainMinimumRevision === null ||
        facts.chainMaximumRevision === null ||
        facts.chainMinimumRevision > facts.chainMaximumRevision)) ||
    ((facts.headCount === 0 || facts.chainCount === 0) &&
      facts.headTimestampMatchesLatestReceipt) ||
    ((facts.targetExecutionCount === 0 || facts.headCount === 0) &&
      facts.executionTimestampMatchesHead) ||
    (!gated &&
      (facts.collisionExecutionCount !== 0 ||
        facts.targetExecutionCount !== 0 ||
        facts.exactInitialExecutionCount !== 0 ||
        facts.exactImmutableExecutionCount !== 0 ||
        facts.receiptCount !== 0 ||
        facts.exactReceiptZeroCount !== 0 ||
        facts.headCount !== 0 ||
        facts.headRevision !== null ||
        facts.exactInitialHeadCount !== 0 ||
        facts.chainCount !== 0 ||
        facts.chainMinimumRevision !== null ||
        facts.chainMaximumRevision !== null ||
        facts.headTimestampMatchesLatestReceipt ||
        facts.executionTimestampMatchesHead))
  ) {
    fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
}

function classifyFacts(
  facts: SupabaseBackfillReceiptZeroReconciliationFactsV1,
  initialExecutionStatus: 'running' | 'completed',
  initialReceiptOutcome: 'in-progress' | 'completed'
): SupabaseBackfillReceiptZeroReconciliationStateV1 {
  if (!facts.inputValid || !facts.runtimeReady || !facts.fullLedgerShapeVerified) {
    return 'precondition-failed'
  }
  if (
    facts.collisionExecutionCount === 0 &&
    facts.targetExecutionCount === 0 &&
    facts.exactInitialExecutionCount === 0 &&
    facts.exactImmutableExecutionCount === 0 &&
    facts.receiptCount === 0 &&
    facts.exactReceiptZeroCount === 0 &&
    facts.headCount === 0 &&
    facts.headRevision === null &&
    facts.exactInitialHeadCount === 0 &&
    facts.chainCount === 0 &&
    facts.chainMinimumRevision === null &&
    facts.chainMaximumRevision === null &&
    !facts.headTimestampMatchesLatestReceipt &&
    !facts.executionTimestampMatchesHead
  ) {
    return 'absent'
  }
  if (
    facts.collisionExecutionCount === 1 &&
    facts.targetExecutionCount === 1 &&
    facts.exactInitialExecutionCount === 1 &&
    facts.exactImmutableExecutionCount === 1 &&
    facts.receiptCount === 1 &&
    facts.exactReceiptZeroCount === 1 &&
    facts.headCount === 1 &&
    facts.headRevision === 1 &&
    facts.exactInitialHeadCount === 1 &&
    facts.chainCount === 0 &&
    facts.chainMinimumRevision === null &&
    facts.chainMaximumRevision === null &&
    !facts.headTimestampMatchesLatestReceipt &&
    facts.executionTimestampMatchesHead
  ) {
    return 'exact-replay'
  }
  if (
    initialExecutionStatus === 'running' &&
    initialReceiptOutcome === 'in-progress' &&
    facts.collisionExecutionCount === 1 &&
    facts.targetExecutionCount === 1 &&
    facts.exactImmutableExecutionCount === 1 &&
    facts.headRevision !== null &&
    facts.receiptCount === facts.headRevision &&
    facts.exactReceiptZeroCount === 1 &&
    facts.headCount === 1 &&
    facts.exactInitialHeadCount === 0 &&
    facts.headRevision >= 2 &&
    facts.headRevision <= 10_000 &&
    facts.chainCount === facts.headRevision &&
    facts.chainMinimumRevision === 1 &&
    facts.chainMaximumRevision === facts.headRevision &&
    facts.headTimestampMatchesLatestReceipt &&
    facts.executionTimestampMatchesHead
  ) {
    return 'advanced-head'
  }
  return 'corruption'
}

interface ReconciliationReviewRuntimeViewV1 {
  readonly format: unknown
  readonly version: unknown
  readonly providerId: unknown
  readonly environmentIntent: unknown
  readonly testingOnly: unknown
  readonly reviewOnly: unknown
  readonly applyAvailable: unknown
  readonly releaseReady: unknown
  readonly reconciliationAuthorityCreated: unknown
  readonly query: Readonly<{
    queryVersion: unknown
    accessMode: unknown
    snapshotScope: unknown
    statementCount: unknown
    hostMustRecomputeStatusFromFacts: unknown
    dmlAllowed: unknown
    indirectExecutionSafetyProven: unknown
    requiresTransportEnforcedReadOnlyBoundary: unknown
    requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: unknown
    requiresBoundedStatementTimeoutBeforeDispatch: unknown
    rowLocksUsed: unknown
    hostTransportCreated: unknown
  }>
  readonly parameters: Readonly<{
    valueCount: unknown
    valuesExposed: unknown
    reusedWithoutReorderingFromCASReview: unknown
  }>
  readonly catalogGuard: Readonly<{
    minimumOnly: unknown
    evaluatesInSameStatementSnapshotWhenDispatched: unknown
    fullCatalogVerificationPerformed: unknown
    fullCatalogVerificationIncludedInStatement: unknown
    exactColumnInventoryComparisonIncludedInStatement: unknown
    exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: unknown
    aclAndUnexpectedObjectCounterChecksIncludedInStatement: unknown
  }>
  readonly policy: Readonly<{
    requestDispatched: unknown
    managedDataReadPerformed: unknown
    mutationDispatched: unknown
    captureConsumed: unknown
    reconciliationResultAuthenticated: unknown
    reportedReconciliationStatusTrusted: unknown
    testingStatusParserCreated: unknown
    productionResponseAuthenticated: unknown
    automaticRetryAllowed: unknown
  }>
}

async function requireCurrentReview(
  envelope: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
): Promise<CurrentReviewBindingsV1> {
  const review = envelope.review
  const runtime = review as ReconciliationReviewRuntimeViewV1
  const casReview = context.casContext.envelope.review
  const receiptZero = context.casContext.receiptZeroContext.envelope.review
  const appliedLedger = context.casContext.receiptZeroContext.databaseLedgerContext.result
  const initialExecutionStatus = receiptZero.rowPlan.execution.status
  const initialReceiptOutcome = receiptZero.receipt.outcome
  if (
    context.envelope !== envelope ||
    context.parameters !== context.casContext.parameters ||
    runtime.format !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_REVIEW_FORMAT ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environmentIntent !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.reviewOnly !== true ||
    runtime.applyAvailable !== false ||
    runtime.releaseReady !== false ||
    runtime.reconciliationAuthorityCreated !== false ||
    runtime.query.queryVersion !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION ||
    runtime.query.accessMode !== 'read-only' ||
    runtime.query.snapshotScope !== 'single-statement' ||
    runtime.query.statementCount !== 1 ||
    runtime.query.hostMustRecomputeStatusFromFacts !== true ||
    runtime.query.dmlAllowed !== false ||
    runtime.query.indirectExecutionSafetyProven !== false ||
    runtime.query.requiresTransportEnforcedReadOnlyBoundary !== true ||
    runtime.query.requiresFullLiveTypeOperatorIndexGuardBeforeDispatch !== true ||
    runtime.query.requiresBoundedStatementTimeoutBeforeDispatch !== true ||
    runtime.query.rowLocksUsed !== false ||
    runtime.query.hostTransportCreated !== false ||
    runtime.parameters.valueCount !== 28 ||
    runtime.parameters.valuesExposed !== false ||
    runtime.parameters.reusedWithoutReorderingFromCASReview !== true ||
    runtime.catalogGuard.minimumOnly !== false ||
    runtime.catalogGuard.evaluatesInSameStatementSnapshotWhenDispatched !== true ||
    runtime.catalogGuard.fullCatalogVerificationPerformed !== false ||
    runtime.catalogGuard.fullCatalogVerificationIncludedInStatement !== true ||
    runtime.catalogGuard.exactColumnInventoryComparisonIncludedInStatement !== true ||
    runtime.catalogGuard.exactConstraintIndexOperatorInventoryComparisonIncludedInStatement !==
      true ||
    runtime.catalogGuard.aclAndUnexpectedObjectCounterChecksIncludedInStatement !== true ||
    runtime.policy.requestDispatched !== false ||
    runtime.policy.managedDataReadPerformed !== false ||
    runtime.policy.mutationDispatched !== false ||
    runtime.policy.captureConsumed !== false ||
    runtime.policy.reconciliationResultAuthenticated !== false ||
    runtime.policy.reportedReconciliationStatusTrusted !== false ||
    runtime.policy.testingStatusParserCreated !== true ||
    runtime.policy.productionResponseAuthenticated !== false ||
    runtime.policy.automaticRetryAllowed !== false ||
    envelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL ||
    context.parameters.length !== 28 ||
    initialExecutionStatus !== context.parameters[19] ||
    receiptZero.receipt.operationAuthorityDigest !== context.parameters[27] ||
    (initialReceiptOutcome !== 'in-progress' && initialReceiptOutcome !== 'completed')
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-review-changed')
  }

  const [
    reconciliationReviewDigest,
    reconciliationQueryDigest,
    reconciliationSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    expectedColumnInventoryDigest,
    expectedConstraintInventoryDigest,
    historicalInstallMarkerDigest
  ] = await Promise.all([
    digest(review),
    digest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY),
    digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    digest(review.parameters.schema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
        version: 1 as const,
        order: review.parameters.order,
        values: context.parameters
      })
    ),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1),
    digestRawText(appliedLedger.marker)
  ])

  if (
    reconciliationReviewDigest !== envelope.reviewDigest ||
    reconciliationQueryDigest !== review.bindings.reconciliationQueryDigest ||
    reconciliationSqlDigest !== review.bindings.reconciliationSqlDigest ||
    reconciliationSqlDigest !== review.artifact.digest ||
    parameterSchemaDigest !== review.bindings.parameterSchemaDigest ||
    parameterSchemaDigest !== casReview.bindings.parameterSchemaDigest ||
    parameterValuesDigest !== review.bindings.parameterValuesDigest ||
    parameterValuesDigest !== casReview.bindings.parameterValuesDigest ||
    expectedColumnInventoryDigest !== review.bindings.expectedColumnInventoryDigest ||
    expectedConstraintInventoryDigest !== review.bindings.expectedConstraintInventoryDigest ||
    historicalInstallMarkerDigest !== review.bindings.historicalInstallMarkerDigest ||
    review.bindings.casReviewDigest !== context.casContext.envelope.reviewDigest ||
    casReview.bindings.scopeDigest !== context.parameters[8] ||
    casReview.bindings.receiptDigest !== context.parameters[25] ||
    casReview.bindings.candidateOperationEvidenceDigest !== context.parameters[27]
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-review-changed')
  }

  return Object.freeze({
    reconciliationReviewDigest,
    reconciliationQueryDigest,
    reconciliationSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    expectedColumnInventoryDigest,
    expectedConstraintInventoryDigest,
    scopeDigest: casReview.bindings.scopeDigest,
    receiptDigest: casReview.bindings.receiptDigest,
    candidateOperationEvidenceDigest: casReview.bindings.candidateOperationEvidenceDigest,
    historicalInstallMarkerDigest,
    initialExecutionStatus,
    initialReceiptOutcome
  })
}

function exactSingleResponse(value: unknown): ParsedResponseV1 {
  const code = 'supabase-backfill-receipt-zero-reconciliation-response-invalid' as const
  let prototype: object | null
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    if (!Array.isArray(value)) return fail(code)
    prototype = Object.getPrototypeOf(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail(code)
  }
  const keys = ownKeys(value, code)
  if (
    prototype !== Array.prototype ||
    keys.length !== 2 ||
    !keys.includes('0') ||
    !keys.includes('length') ||
    lengthDescriptor?.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== 1
  ) {
    return fail(code)
  }
  const row = exactPlainRecord(
    ownData(value, '0', code),
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
    code
  )
  const queryVersion = ownData(row, 'queryVersion', code)
  const scopeDigest = digestValue(ownData(row, 'scopeDigest', code))
  const receiptDigest = digestValue(ownData(row, 'receiptDigest', code))
  const candidateOperationEvidenceDigest = digestValue(
    ownData(row, 'candidateOperationEvidenceDigest', code)
  )
  const initialExecutionStatus = oneOf<'running' | 'completed'>(
    ownData(row, 'initialExecutionStatus', code),
    INITIAL_EXECUTION_STATUSES
  )
  const initialReceiptOutcome = oneOf<'in-progress' | 'completed'>(
    ownData(row, 'initialReceiptOutcome', code),
    INITIAL_RECEIPT_OUTCOMES
  )
  const reportedStatus = oneOf<SupabaseBackfillReceiptZeroReconciliationStateV1>(
    ownData(row, 'reportedStatus', code),
    RESPONSE_STATES
  )
  const facts = Object.freeze({
    inputValid: booleanValue(ownData(row, 'inputValid', code)),
    runtimeReady: booleanValue(ownData(row, 'runtimeReady', code)),
    fullLedgerShapeVerified: booleanValue(ownData(row, 'fullLedgerShapeVerified', code)),
    collisionExecutionCount: integer(ownData(row, 'collisionExecutionCount', code), 0, 2),
    targetExecutionCount: integer(ownData(row, 'targetExecutionCount', code), 0, 2),
    exactInitialExecutionCount: integer(ownData(row, 'exactInitialExecutionCount', code), 0, 2),
    exactImmutableExecutionCount: integer(ownData(row, 'exactImmutableExecutionCount', code), 0, 2),
    receiptCount: integer(ownData(row, 'receiptCount', code), 0, 10_001),
    exactReceiptZeroCount: integer(ownData(row, 'exactReceiptZeroCount', code), 0, 2),
    headCount: integer(ownData(row, 'headCount', code), 0, 2),
    headRevision: nullableInt32(ownData(row, 'headRevision', code)),
    exactInitialHeadCount: integer(ownData(row, 'exactInitialHeadCount', code), 0, 2),
    chainCount: integer(ownData(row, 'chainCount', code), 0, 20_002),
    chainMinimumRevision: nullableInt32(ownData(row, 'chainMinimumRevision', code)),
    chainMaximumRevision: nullableInt32(ownData(row, 'chainMaximumRevision', code)),
    headTimestampMatchesLatestReceipt: booleanValue(
      ownData(row, 'headTimestampMatchesLatestReceipt', code)
    ),
    executionTimestampMatchesHead: booleanValue(ownData(row, 'executionTimestampMatchesHead', code))
  }) satisfies SupabaseBackfillReceiptZeroReconciliationFactsV1
  requireConsistentFacts(facts)
  const transactionReadOnly = booleanValue(ownData(row, 'transactionReadOnly', code))
  const installMarkerDigest = nullableDigest(ownData(row, 'installMarkerDigest', code))
  const serverVersionNum = ownData(row, 'serverVersionNum', code)
  const snapshotDigest = digestValue(ownData(row, 'snapshotDigest', code))
  if (
    queryVersion !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION ||
    typeof serverVersionNum !== 'string' ||
    !SUPPORTED_SERVER_VERSION.test(serverVersionNum) ||
    (facts.fullLedgerShapeVerified && installMarkerDigest === null)
  ) {
    return fail(code)
  }
  const observedAt = canonicalTimestamp(ownData(row, 'observedAt', code))
  const canonicalRow = Object.freeze({
    queryVersion,
    scopeDigest,
    receiptDigest,
    candidateOperationEvidenceDigest,
    initialExecutionStatus,
    initialReceiptOutcome,
    reportedStatus,
    ...facts,
    transactionReadOnly,
    installMarkerDigest,
    serverVersionNum,
    snapshotDigest,
    observedAt
  })
  return Object.freeze({
    reportedStatus,
    initialExecutionStatus,
    initialReceiptOutcome,
    scopeDigest,
    receiptDigest,
    candidateOperationEvidenceDigest,
    installMarkerDigest,
    facts,
    snapshot: Object.freeze({
      transactionReadOnly,
      serverVersionNum,
      snapshotDigest,
      observedAt
    }),
    canonicalResponse: Object.freeze([canonicalRow])
  })
}

/**
 * Strictly decode one testing response and recompute its relational status. Marker drift lowers any
 * non-precondition result to `precondition-failed`; the reported result remains visible separately,
 * and neither value creates installation proof.
 */
export async function parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1(
  input: ParseSupabaseBackfillReceiptZeroReconciliationResponseForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroReconciliationObservationV1> {
  const source = exactInput(input)
  const reviewValue = ownData(
    source,
    'reconciliationReview',
    'supabase-backfill-receipt-zero-reconciliation-response-input-invalid'
  )
  const context = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(reviewValue)
  if (!context || context.envelope !== reviewValue) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-proof-invalid')
  }
  const parsed = exactSingleResponse(
    ownData(
      source,
      'response',
      'supabase-backfill-receipt-zero-reconciliation-response-input-invalid'
    )
  )
  const expected = await requireCurrentReview(context.envelope, context)
  if (
    parsed.scopeDigest !== expected.scopeDigest ||
    parsed.receiptDigest !== expected.receiptDigest ||
    parsed.candidateOperationEvidenceDigest !== expected.candidateOperationEvidenceDigest ||
    parsed.initialExecutionStatus !== expected.initialExecutionStatus ||
    parsed.initialReceiptOutcome !== expected.initialReceiptOutcome
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-binding-mismatch')
  }
  const recomputedStatus = classifyFacts(
    parsed.facts,
    parsed.initialExecutionStatus,
    parsed.initialReceiptOutcome
  )
  if (recomputedStatus !== parsed.reportedStatus) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-invalid')
  }
  const markerMatches = parsed.installMarkerDigest === expected.historicalInstallMarkerDigest
  const status =
    parsed.reportedStatus === 'precondition-failed' || markerMatches
      ? parsed.reportedStatus
      : ('precondition-failed' as const)
  const responseDigest = await digest(parsed.canonicalResponse)
  if (
    trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(context.envelope) !== context
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-response-proof-invalid')
  }

  return Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    reportedStatus: parsed.reportedStatus,
    status,
    bindings: Object.freeze({
      reconciliationReviewDigest: expected.reconciliationReviewDigest,
      reconciliationQueryDigest: expected.reconciliationQueryDigest,
      reconciliationSqlDigest: expected.reconciliationSqlDigest,
      parameterSchemaDigest: expected.parameterSchemaDigest,
      parameterValuesDigest: expected.parameterValuesDigest,
      expectedColumnInventoryDigest: expected.expectedColumnInventoryDigest,
      expectedConstraintInventoryDigest: expected.expectedConstraintInventoryDigest,
      scopeDigest: expected.scopeDigest,
      receiptDigest: expected.receiptDigest,
      candidateOperationEvidenceDigest: expected.candidateOperationEvidenceDigest,
      historicalInstallMarkerDigest: expected.historicalInstallMarkerDigest,
      observedInstallMarkerDigest: parsed.installMarkerDigest,
      responseDigest
    }),
    facts: parsed.facts,
    snapshot: parsed.snapshot,
    reportedStatusMatchesRecomputedFacts: true as const,
    statusRecomputedByHost: true as const,
    reportedInstallMarkerDigestMatchesHistorical: markerMatches,
    specificHistoricalInstallationAuthenticated: false as const,
    reportedStatusProvesDatabaseState: false as const,
    statusProvesDatabaseState: false as const,
    productionTransportAuthenticated: false as const,
    fullPortableReceiptV2ChainVerified: false as const,
    advancedHeadRequiresFullPortableReceiptV2ChainVerification:
      parsed.reportedStatus === 'advanced-head',
    absentProvesPriorMutationStopped: false as const,
    automaticRetryAllowed: false as const,
    captureConsumed: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  })
}
