/* oxlint-disable eslint(max-lines), eslint(complexity) -- The fixed read-only statement, state facts, and process-local provenance form one audit boundary. */

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import {
  SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
  SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS,
  trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1,
  type SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1,
  type SupabaseBackfillReadQueryIndirectExecutionSafetyRuntimeViewV1,
  type TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/read-query-indirect-execution-safety'

import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL,
  trustedSupabaseBackfillReceiptZeroCASReviewContextV1,
  type SupabaseBackfillReceiptZeroCASParameterV1,
  type SupabaseBackfillReceiptZeroCASReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
} from '../cas/review'
import { trustedSupabaseBackfillReceiptZeroReviewContextV1 } from '../review'
import SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL_SOURCE from './v1.sql?raw'

export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-reconciliation-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID =
  'backfill-receipt-zero-reconciliation' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION =
  'openpencil-supabase-backfill-receipt-zero-reconciliation-v1' as const
export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/receipt-zero-reconciliation-review.sql' as const

export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES = Object.freeze([
  'absent',
  'exact-replay',
  'advanced-head',
  'corruption',
  'precondition-failed'
] as const)

export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS = Object.freeze([
  'queryVersion',
  'scopeDigest',
  'receiptDigest',
  'candidateOperationEvidenceDigest',
  'initialExecutionStatus',
  'initialReceiptOutcome',
  'reportedStatus',
  'inputValid',
  'runtimeReady',
  'fullLedgerShapeVerified',
  'collisionExecutionCount',
  'targetExecutionCount',
  'exactInitialExecutionCount',
  'exactImmutableExecutionCount',
  'receiptCount',
  'exactReceiptZeroCount',
  'headCount',
  'headRevision',
  'exactInitialHeadCount',
  'chainCount',
  'chainMinimumRevision',
  'chainMaximumRevision',
  'headTimestampMatchesLatestReceipt',
  'executionTimestampMatchesHead',
  'transactionReadOnly',
  'installMarkerDigest',
  'serverVersionNum',
  'snapshotDigest',
  'observedAt'
] as const)

const INPUT_KEYS = ['casReview', 'staticSqlSafetyCertificate'] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const BLOCKERS = Object.freeze([
  'receipt-zero-reconciliation-review-only',
  'receipt-zero-reconciliation-host-transport-unavailable',
  'receipt-zero-reconciliation-production-response-authentication-unavailable',
  'receipt-zero-reconciliation-indirect-execution-safety-not-proven',
  'receipt-zero-reconciliation-bounded-statement-timeout-unavailable',
  'receipt-zero-reconciliation-fixed-query-request-size-not-certified',
  'receipt-zero-reconciliation-full-v2-chain-verification-not-performed',
  'receipt-zero-capture-not-consumed',
  'receipt-zero-production-operation-authority-not-created',
  'bounded-runner-unavailable'
] as const)

const CATALOG_VERIFIER_PARAMETER_VALUES = Object.freeze([
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
  'receipt-zero-reconciliation-catalog-review',
  'receipt-zero-reconciliation-ledger-shape',
  'receipt-zero-reconciliation-ledger-sql',
  'receipt-zero-reconciliation-project',
  'receipt-zero-reconciliation-account',
  'receipt-zero-reconciliation-grant',
  'receipt-zero-reconciliation-catalog-query',
  'receipt-zero-reconciliation-catalog-digest'
] as const)
const CATALOG_VERIFIER_EFFECTIVE_SEARCH_PATH_PROBE = '"pg_catalog"."current_schemas"(TRUE)' as const
const FIXED_READ_EFFECTIVE_SEARCH_PATH_PROBE =
  'ARRAY["pg_catalog"."current_setting"(\'search_path\')::"pg_catalog"."name"]' as const

function sqlTextLiteral(value: string): string {
  const delimiter = '$openpencil_catalog$'
  if (value.includes(delimiter)) throw new TypeError('Catalog literal delimiter collision.')
  return `${delimiter}${value}${delimiter}`
}

function inlineCatalogVerifierParameters(sql: string): string {
  const occurrences = Array.from({ length: CATALOG_VERIFIER_PARAMETER_VALUES.length }, () => 0)
  const inlined = sql.replace(/\$(\d+)(?=::)/gu, (_placeholder, position: string) => {
    const parameterPosition = Number(position)
    if (parameterPosition < 1 || parameterPosition > CATALOG_VERIFIER_PARAMETER_VALUES.length) {
      throw new TypeError('Unexpected catalog verifier parameter position.')
    }
    const index = parameterPosition - 1
    const value = CATALOG_VERIFIER_PARAMETER_VALUES[index]
    occurrences[index] += 1
    return sqlTextLiteral(value)
  })
  if (occurrences.some((count) => count !== 1) || /\$\d+/u.test(inlined)) {
    throw new TypeError('Catalog verifier parameter layout changed.')
  }
  const searchPathProbeCount =
    inlined.split(CATALOG_VERIFIER_EFFECTIVE_SEARCH_PATH_PROBE).length - 1
  if (searchPathProbeCount !== 1) {
    throw new TypeError('Catalog verifier search-path probe changed.')
  }
  return inlined.replace(
    CATALOG_VERIFIER_EFFECTIVE_SEARCH_PATH_PROBE,
    FIXED_READ_EFFECTIVE_SEARCH_PATH_PROBE
  )
}

const INLINED_CATALOG_VERIFICATION_SQL = inlineCatalogVerifierParameters(
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL
)
const EXPECTED_CATALOG_COLUMNS_JSON_SQL = sqlTextLiteral(
  JSON.stringify(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1)
)
const EXPECTED_CATALOG_CONSTRAINTS_JSON_SQL = sqlTextLiteral(
  JSON.stringify(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1)
)

type ParameterValue = string | null
type ReconciliationState =
  (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES)[number]

export interface CreateSupabaseBackfillReceiptZeroReconciliationReviewForTestingOptionsV1 {
  readonly casReview: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1
  readonly staticSqlSafetyCertificate: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
}

export interface SupabaseBackfillReceiptZeroReconciliationReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly databaseLedgerBound: false
  readonly reconciliationAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    casReviewDigest: string
    receiptZeroReviewDigest: string
    casTransactionSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    reconciliationSqlDigest: string
    reconciliationQueryDigest: string
    staticSqlSafetyCertificateDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
    appliedDatabaseLedgerResultDigest: string
    installedLedgerVerificationDigest: string
    ledgerShapeDigest: string
    historicalInstallMarkerBindingDigest: string
    historicalInstallMarkerDigest: string
  }>
  readonly query: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    statementCount: 1
    responseShape: 'one-row-classification-facts'
    responseFields: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
    hostMustRecomputeStatusFromFacts: true
    dmlAllowed: false
    staticSqlSafetyCertificateCreated: true
    staticSqlSafetyProfile: typeof SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE
    staticSqlSafetyConditionalOnly: true
    liveIndirectExecutionSafetyAuthenticated: false
    indirectExecutionSafetyProven: false
    requiresTransportEnforcedReadOnlyBoundary: true
    requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true
    requiresBoundedStatementTimeoutBeforeDispatch: true
    rowLocksUsed: false
    schemaMutationAllowed: false
    managementReadOnlyEndpointSemanticallyCompatible: false
    hostTransportCreated: false
  }>
  readonly parameters: Readonly<{
    order: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER
    schema: readonly SupabaseBackfillReceiptZeroCASParameterV1[]
    valueCount: 28
    valuesExposed: false
    reusedWithoutReorderingFromCASReview: true
  }>
  readonly catalogGuard: Readonly<{
    evaluatesInSameStatementSnapshotWhenDispatched: true
    minimumOnly: false
    fullCatalogVerificationPerformed: false
    fullCatalogVerificationIncludedInStatement: true
    exactColumnInventoryComparisonIncludedInStatement: true
    exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: true
    aclAndUnexpectedObjectCounterChecksIncludedInStatement: true
    schemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA
    expectedTables: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES
    schemaComment: 'openpencil:release-ledger:v1'
    tableCommentsChecked: true
    commonOwnerRequired: true
    regularUnpartitionedTablesRequired: true
    rowLevelSecurityEnabledRequired: true
    forcedRowLevelSecurityForbidden: true
    inheritanceForbidden: true
    policyCountRequired: 0
    primaryKeyMarkerConstraint: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT
    installMarkerPrefix: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX
    installMarkerPrefixCountRequired: 1
    specificHistoricalInstallMarkerComparedInSql: false
    observedInstallMarkerDigestReturned: true
    historicalInstallMarkerDigestAvailableInTrustedReviewBinding: true
    specificHistoricalInstallMarkerParserComparisonCreated: true
    roleRequired: 'supabase_read_only_user'
    nonSuperuserRequired: true
    bypassRlsRequired: true
    effectivePgReadAllDataUsageRequired: true
    queryRoleMustNotOwnLedger: true
    currentAndSessionRoleMustMatch: true
    transactionReadOnlyObserved: true
    transactionReadOnlySettingIsEvidenceOnly: true
    databasePrimaryRequired: true
    effectiveSearchPath: readonly ['pg_catalog']
  }>
  readonly classification: Readonly<{
    states: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES
    absent: 'installed-ledger-has-no-colliding-execution-receipt-or-head-row'
    exactReplay: 'all-revision-one-execution-receipt-head-columns-and-canonical-bytes-equal'
    insertedReadbackMapsTo: 'exact-replay'
    advancedHead: 'immutable-execution-and-receipt-zero-equal-with-bounded-relational-tuple-chain'
    advancedHeadIsRelationalOnly: true
    advancedHeadRequiresFullPortableReceiptV2ChainVerification: true
    corruption: 'every-other-successfully-observed-partial-collision-or-byte-mismatch-state'
    preconditionFailed: 'trusted-input-runtime-or-full-ledger-guard-is-not-exact'
    missingSchemaRelationOrColumn: 'transport-failure-outcome-unknown'
  }>
  readonly policy: Readonly<{
    previewContainsPlaceholdersOnly: true
    canonicalValuesKeptInTrustedContextOnly: true
    requestDispatched: false
    managedDataReadPerformed: false
    mutationDispatched: false
    captureConsumed: false
    credentialAuthorityCreated: false
    transportAuthorityCreated: false
    databaseAuthorityCreated: false
    reconciliationResultAuthenticated: false
    reportedReconciliationStatusTrusted: false
    testingStatusParserCreated: true
    productionResponseAuthenticated: false
    automaticRetryAllowed: false
    transportFailureClassifiesDatabaseState: false
    transportFailureOutcome: 'outcome-unknown'
    absentProvesPriorMutationStopped: false
    successfulAdvancedClassificationReleaseReady: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_ARTIFACT_PATH
    kind: 'receipt-zero-read-only-reconciliation-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    containsCatalogRead: true
    containsManagedDataRead: true
    containsDml: false
    containsDirectDml: false
    indirectExecutionSafetyProven: false
    containsRowLock: false
    performsSchemaChange: false
    requestDispatched: false
    hostDispatchAvailable: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptZeroReconciliationReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/** Process-local query material only; it grants no credential, transport, or reconciliation authority. */
export interface TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly casContext: TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
  readonly staticSqlSafetyContext: TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
  readonly parameters: readonly ParameterValue[]
}

export type SupabaseBackfillReceiptZeroReconciliationReviewErrorCode =
  | 'supabase-backfill-receipt-zero-reconciliation-input-invalid'
  | 'supabase-backfill-receipt-zero-reconciliation-proof-invalid'
  | 'supabase-backfill-receipt-zero-reconciliation-static-sql-safety-binding-mismatch'
  | 'supabase-backfill-receipt-zero-reconciliation-input-changed'
  | 'supabase-backfill-receipt-zero-reconciliation-digest-failed'

export class SupabaseBackfillReceiptZeroReconciliationReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptZeroReconciliationReviewErrorCode) {
    super(`Supabase backfill Receipt-zero reconciliation review failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptZeroReconciliationReviewError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

type StaticSqlSafetyRuntimeViewV1 = SupabaseBackfillReadQueryIndirectExecutionSafetyRuntimeViewV1

const trustedReviews = new WeakMap<
  object,
  TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
>()

function fail(code: SupabaseBackfillReceiptZeroReconciliationReviewErrorCode): never {
  throw new SupabaseBackfillReceiptZeroReconciliationReviewError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    if (Array.isArray(value)) {
      return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
    }
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  for (const key of INPUT_KEYS) ownData(value, key)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-digest-failed')
  }
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-zero-reconciliation-digest-failed')
  }
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

/**
 * Fixed read-only query with bounded managed-row reads and a bounded response shape. It reuses the
 * CAS review's 28 values without reordering and reads one PostgreSQL statement snapshot. Catalog
 * recursion, aggregation, and schema-wide scans still require a server-enforced statement timeout.
 * A later Host parser must recompute `reportedStatus`; `advanced-head` is never a portable
 * Receipt-chain proof.
 */
const GENERATED_SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL = `-- OpenPencil Supabase Receipt-zero read-only reconciliation review v1.
-- REVIEW ONLY: bounded managed-row reads and response shape, no DML, row locks, credential, or release authority.
-- Parameters are the CAS review's exact 28 positional values and must never be interpolated.
WITH RECURSIVE
"input" AS MATERIALIZED (
  SELECT
    $1::"pg_catalog"."text" AS "execution_id",
    $2::"pg_catalog"."text" AS "application_id",
    $3::"pg_catalog"."text" AS "application_digest",
    $4::"pg_catalog"."text" AS "migration_id",
    $5::"pg_catalog"."text" AS "migration_digest",
    $6::"pg_catalog"."text" AS "migration_plan_digest",
    $7::"pg_catalog"."text" AS "provider_authority_digest",
    $8::"pg_catalog"."text" AS "source_ledger_digest",
    $9::"pg_catalog"."text" AS "scope_digest",
    $10::"pg_catalog"."text" AS "resource_identity_digest",
    $11::"pg_catalog"."text" AS "catalog_precondition_digest",
    "pg_catalog"."decode"($12::"pg_catalog"."text", 'base64') AS "canonical_scope",
    $13::"pg_catalog"."text" AS "capture_digest",
    $14::"pg_catalog"."int8" AS "captured_high_water",
    $15::"pg_catalog"."int8" AS "initial_remaining_eligible_row_count",
    $16::"pg_catalog"."int8" AS "initial_remaining_target_row_count",
    $17::"pg_catalog"."int8" AS "required_matched_row_count",
    $18::"pg_catalog"."int4" AS "required_batch_count",
    $19::"pg_catalog"."int4" AS "batch_size",
    $20::"pg_catalog"."text" AS "initial_execution_status",
    $21::"pg_catalog"."text"::"pg_catalog"."timestamptz" AS "candidate_committed_at",
    $21::"pg_catalog"."text" AS "candidate_committed_at_text",
    $22::"pg_catalog"."text" AS "event_id",
    $23::"pg_catalog"."text" AS "receipt_id",
    $24::"pg_catalog"."text" AS "idempotency_key",
    $25::"pg_catalog"."text" AS "request_digest",
    $26::"pg_catalog"."text" AS "receipt_digest",
    "pg_catalog"."decode"($27::"pg_catalog"."text", 'base64') AS "canonical_receipt",
    $28::"pg_catalog"."text" AS "unauthenticated_operation_evidence_digest"
),
"documents" AS MATERIALIZED (
  SELECT
    "input".*,
    "pg_catalog"."convert_from"("input"."canonical_scope", 'UTF8')::"pg_catalog"."jsonb" AS "scope_document",
    "pg_catalog"."convert_from"("input"."canonical_receipt", 'UTF8')::"pg_catalog"."jsonb" AS "receipt_document"
  FROM "input"
),
"input_validity" AS MATERIALIZED (
  SELECT
    "documents".*,
    (
      "execution_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "application_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "migration_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "receipt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "application_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "migration_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "migration_plan_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "provider_authority_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "source_ledger_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "scope_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "resource_identity_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "catalog_precondition_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "capture_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "request_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "receipt_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "unauthenticated_operation_evidence_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "pg_catalog"."octet_length"("canonical_scope") BETWEEN 2 AND 65536
      AND "pg_catalog"."octet_length"("canonical_receipt") BETWEEN 2 AND 65536
      AND "scope_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"("pg_catalog"."encode"("pg_catalog"."sha256"("canonical_scope"), 'base64'), '='),
        '+/', '-_'
      )
      AND "receipt_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"("pg_catalog"."encode"("pg_catalog"."sha256"("canonical_receipt"), 'base64'), '='),
        '+/', '-_'
      )
      AND ("captured_high_water" IS NULL) = ("initial_remaining_eligible_row_count" = 0)
      AND ("captured_high_water" IS NULL OR "captured_high_water" BETWEEN 0 AND 9007199254740991)
      AND "batch_size" BETWEEN 1 AND 1000
      AND "initial_remaining_eligible_row_count" BETWEEN 0 AND ("batch_size"::"pg_catalog"."int8" * 9999)
      AND "initial_remaining_target_row_count" BETWEEN 0 AND "initial_remaining_eligible_row_count"
      AND ("required_matched_row_count" IS NULL OR "required_matched_row_count" BETWEEN 0 AND "initial_remaining_target_row_count")
      AND "required_batch_count" = CASE
        WHEN "initial_remaining_eligible_row_count" = 0 THEN 0
        ELSE (("initial_remaining_eligible_row_count" - 1) / "batch_size") + 1
      END
      AND "initial_execution_status" IN ('running', 'completed')
      AND "scope_document" ->> 'format' = 'openpencil.backend-backfill-execution-scope'
      AND "scope_document" ->> 'version' = '2'
      AND "scope_document" ->> 'providerId' = 'supabase'
      AND "scope_document" ->> 'environment' = 'staging'
      AND "scope_document" ->> 'providerAuthorityDigest' = "provider_authority_digest"
      AND "scope_document" ->> 'applicationId' = "application_id"
      AND "scope_document" ->> 'applicationDigest' = "application_digest"
      AND "scope_document" ->> 'migrationId' = "migration_id"
      AND "scope_document" ->> 'migrationDigest' = "migration_digest"
      AND "scope_document" ->> 'migrationPlanDigest' = "migration_plan_digest"
      AND "scope_document" ->> 'sourceLedgerDigest' = "source_ledger_digest"
      AND "scope_document" ->> 'captureDigest' = "capture_digest"
      AND "scope_document" ->> 'resourceIdentityDigest' = "resource_identity_digest"
      AND "scope_document" ->> 'catalogPreconditionDigest' = "catalog_precondition_digest"
      AND "scope_document" -> 'initialRemainingEligibleRowCount' = "pg_catalog"."to_jsonb"("initial_remaining_eligible_row_count")
      AND "scope_document" -> 'initialRemainingTargetRowCount' = "pg_catalog"."to_jsonb"("initial_remaining_target_row_count")
      AND "scope_document" -> 'requiredBatchCount' = "pg_catalog"."to_jsonb"("required_batch_count")
      AND "scope_document" -> 'batchSize' = "pg_catalog"."to_jsonb"("batch_size")
      AND "scope_document" -> 'maximumReceiptCount' = '10000'::"pg_catalog"."jsonb"
      AND "scope_document" -> 'maximumBatchCount' = '9999'::"pg_catalog"."jsonb"
      AND CASE
        WHEN "captured_high_water" IS NULL THEN "scope_document" -> 'capturedHighWater' = 'null'::"pg_catalog"."jsonb"
        ELSE "scope_document" -> 'capturedHighWater' = "pg_catalog"."to_jsonb"("captured_high_water")
      END
      AND CASE
        WHEN "required_matched_row_count" IS NULL THEN "scope_document" -> 'requiredMatchedRowCount' = 'null'::"pg_catalog"."jsonb"
        ELSE "scope_document" -> 'requiredMatchedRowCount' = "pg_catalog"."to_jsonb"("required_matched_row_count")
      END
      AND "receipt_document" ->> 'format' = 'openpencil.backend-backfill-execution-receipt'
      AND "receipt_document" ->> 'version' = '2'
      AND "receipt_document" ->> 'executionId' = "execution_id"
      AND "receipt_document" ->> 'receiptId' = "receipt_id"
      AND "receipt_document" ->> 'idempotencyKey' = "idempotency_key"
      AND "receipt_document" ->> 'requestDigest' = "request_digest"
      AND "receipt_document" ->> 'scopeDigest' = "scope_digest"
      AND "receipt_document" -> 'scope' = "scope_document"
      AND "receipt_document" ->> 'checkpointKind' = 'capture'
      AND "receipt_document" ->> 'batchIndex' = '0'
      AND "receipt_document" ->> 'databaseEventId' = "event_id"
      AND "receipt_document" ->> 'databaseHeadVersion' = '1'
      AND "receipt_document" ->> 'committedAt' = "candidate_committed_at_text"
      AND "receipt_document" ->> 'operationAuthorityDigest' = "unauthenticated_operation_evidence_digest"
      AND (
        ("initial_execution_status" = 'completed' AND "receipt_document" ->> 'outcome' = 'completed')
        OR ("initial_execution_status" = 'running' AND "receipt_document" ->> 'outcome' = 'in-progress')
      )
    ) AS "valid"
  FROM "documents"
),
"expected_tables"("table_name", "comment") AS (
  VALUES
    ('backfill_executions_v1'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-executions:v1'::"pg_catalog"."text"),
    ('backfill_heads_v1'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-heads:v1'::"pg_catalog"."text"),
    ('backfill_receipts_v2'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-receipts:v2'::"pg_catalog"."text")
),
"schema_entry" AS MATERIALIZED (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "pg_catalog"."obj_description"("namespace_entry"."oid", 'pg_namespace') AS "comment"
  FROM "pg_catalog"."pg_namespace" AS "namespace_entry"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry"
    ON "owner_entry"."oid" = "namespace_entry"."nspowner"
  WHERE "namespace_entry"."nspname" = 'openpencil_release'
),
"owner_role_members"("role_oid") AS (
  SELECT "membership_entry"."member"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_auth_members" AS "membership_entry"
    ON "membership_entry"."roleid" = "schema_entry"."owner_oid"
  UNION
  SELECT "membership_entry"."member"
  FROM "pg_catalog"."pg_auth_members" AS "membership_entry"
  JOIN "owner_role_members"
    ON "membership_entry"."roleid" = "owner_role_members"."role_oid"
),
"table_entries" AS MATERIALIZED (
  SELECT
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "table_entry"."relkind" AS "relation_kind",
    "table_entry"."relpersistence" AS "persistence",
    "table_entry"."relispartition" AS "is_partition",
    "table_entry"."relreplident" AS "replica_identity",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relacl" AS "acl",
    "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') AS "comment",
    "expected_tables"."comment" AS "expected_comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
  JOIN "expected_tables" ON "expected_tables"."table_name" = "table_entry"."relname"
),
"current_role_entry" AS MATERIALIZED (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = CURRENT_USER
),
"session_role_entry" AS MATERIALIZED (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = SESSION_USER
),
"install_marker_constraint_entry" AS MATERIALIZED (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
   AND "table_entry"."relname" = 'backfill_executions_v1'
   AND "table_entry"."relkind" = 'r'
  JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
    ON "constraint_entry"."conrelid" = "table_entry"."oid"
   AND "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
   AND "constraint_entry"."conname" = 'backfill_executions_v1_pkey'
   AND "constraint_entry"."contype" = 'p'
  JOIN "pg_catalog"."pg_attribute" AS "attribute_entry"
    ON "attribute_entry"."attrelid" = "table_entry"."oid"
   AND "attribute_entry"."attname" = 'execution_id'
   AND "attribute_entry"."attnum" > 0
   AND NOT "attribute_entry"."attisdropped"
  WHERE "constraint_entry"."conkey" = ARRAY["attribute_entry"."attnum"]::"pg_catalog"."int2"[]
    AND NOT "constraint_entry"."condeferrable"
    AND NOT "constraint_entry"."condeferred"
    AND "constraint_entry"."convalidated"
    AND NOT "constraint_entry"."connoinherit"
    AND "constraint_entry"."conislocal"
    AND "constraint_entry"."coninhcount" = 0
    AND "constraint_entry"."conparentid" = 0
),
"full_catalog_snapshot" AS MATERIALIZED (
${INLINED_CATALOG_VERIFICATION_SQL}
),
"full_catalog_exactness" AS MATERIALIZED (
  SELECT COALESCE((
    "pg_catalog"."jsonb_extract_path"("snapshot"."catalog", 'columns')
      = ${EXPECTED_CATALOG_COLUMNS_JSON_SQL}::"pg_catalog"."jsonb"
    AND "pg_catalog"."jsonb_extract_path"("snapshot"."catalog", 'constraints')
      = ${EXPECTED_CATALOG_CONSTRAINTS_JSON_SQL}::"pg_catalog"."jsonb"
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'schemaCount') = '1'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'ownerRoleMemberCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'ownerDefaultNonOwnerPrivilegeCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'schemaNonOwnerPrivilegeCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'relationCount') = '3'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedIndexCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedTriggerCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedRuleCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedConstraintCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'inheritanceRelationCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'publicationExposureCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'droppedColumnCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'policyCount') = '0'
  ), FALSE) AS "ready"
  FROM "full_catalog_snapshot" AS "snapshot"
),
"catalog_guard" AS MATERIALIZED (
  SELECT COALESCE((
    (SELECT "pg_catalog"."count"(*) FROM "schema_entry") = 1
    AND (SELECT "comment" FROM "schema_entry") = 'openpencil:release-ledger:v1'
    AND (SELECT "pg_catalog"."count"(*) FROM "table_entries") = 3
    AND NOT EXISTS (
      SELECT 1
      FROM "table_entries"
      CROSS JOIN "schema_entry"
      WHERE "table_entries"."owner_oid" <> "schema_entry"."owner_oid"
        OR "table_entries"."relation_kind" <> 'r'
        OR "table_entries"."persistence" <> 'p'
        OR "table_entries"."is_partition"
        OR "table_entries"."replica_identity" <> 'd'
        OR NOT "table_entries"."rls_enabled"
        OR "table_entries"."rls_forced"
        OR "table_entries"."comment" IS DISTINCT FROM "table_entries"."expected_comment"
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_class" AS "relation_entry"
        ON "relation_entry"."relnamespace" = "schema_entry"."schema_oid"
      WHERE "relation_entry"."relkind" IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) = 3
    AND NOT EXISTS (
      SELECT 1
      FROM "table_entries"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE(
          "table_entries"."acl",
          "pg_catalog"."acldefault"('r', "table_entries"."owner_oid")
        )
      ) AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_inherits" AS "inheritance_entry"
      WHERE "inheritance_entry"."inhrelid" IN (SELECT "table_oid" FROM "table_entries")
         OR "inheritance_entry"."inhparent" IN (SELECT "table_oid" FROM "table_entries")
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_policy" AS "policy_entry"
      WHERE "policy_entry"."polrelid" IN (SELECT "table_oid" FROM "table_entries")
    ) = 0
    AND COALESCE((SELECT "ready" FROM "full_catalog_exactness"), FALSE)
    AND (SELECT "pg_catalog"."count"(*) FROM "install_marker_constraint_entry") = 1
    AND (
      SELECT "comment" FROM "install_marker_constraint_entry"
    ) ~ '^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$'
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
      WHERE "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint')
        LIKE 'openpencil-install:v1:supabase-backfill-database-cas-ledger:%'
    ) = 1
  ), FALSE) AS "ready",
  CASE
    WHEN (SELECT "pg_catalog"."count"(*) FROM "install_marker_constraint_entry") = 1
      AND (SELECT "comment" FROM "install_marker_constraint_entry")
        ~ '^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$'
      THEN "pg_catalog"."translate"(
        "pg_catalog"."rtrim"(
          "pg_catalog"."encode"(
            "pg_catalog"."sha256"(
              "pg_catalog"."convert_to"(
                (SELECT "comment" FROM "install_marker_constraint_entry"),
                'UTF8'
              )
            ),
            'base64'
          ),
          '='
        ),
        '+/',
        '-_'
      )
    ELSE NULL
  END::"pg_catalog"."text" AS "install_marker_digest"
),
"runtime_guard" AS MATERIALIZED (
  SELECT
    COALESCE((
      (SELECT "pg_catalog"."count"(*) FROM "current_role_entry") = 1
      AND (SELECT "pg_catalog"."count"(*) FROM "session_role_entry") = 1
      AND CURRENT_USER = SESSION_USER
      AND CURRENT_USER = 'supabase_read_only_user'
      AND NOT (SELECT "rolsuper" FROM "current_role_entry")
      AND NOT (SELECT "rolsuper" FROM "session_role_entry")
      AND (SELECT "rolbypassrls" FROM "current_role_entry")
      AND (SELECT "rolbypassrls" FROM "session_role_entry")
      AND "pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'usage')
      AND "pg_catalog"."pg_has_role"(SESSION_USER, 'pg_read_all_data', 'usage')
      AND (SELECT "oid" FROM "current_role_entry") = (SELECT "oid" FROM "session_role_entry")
      AND (SELECT "oid" FROM "current_role_entry") <> (SELECT "owner_oid" FROM "schema_entry")
      AND NOT EXISTS (
        SELECT 1 FROM "owner_role_members"
        WHERE "role_oid" = (SELECT "oid" FROM "current_role_entry")
      )
      AND NOT "pg_catalog"."pg_is_in_recovery"()
      AND "pg_catalog"."current_setting"('search_path') = 'pg_catalog'
    ), FALSE) AS "ready",
    "pg_catalog"."current_setting"('transaction_read_only')::"pg_catalog"."boolean"
      AS "transaction_read_only"
),
"read_executions" AS MATERIALIZED (
  SELECT "execution".*
  FROM ONLY "openpencil_release"."backfill_executions_v1" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND (
      "execution"."execution_id" = "input"."execution_id"
      OR "execution"."capture_digest" = "input"."capture_digest"
      OR "execution"."scope_digest" = "input"."scope_digest"
    )
  LIMIT 2
),
"read_head" AS MATERIALIZED (
  SELECT "head".*
  FROM ONLY "openpencil_release"."backfill_heads_v1" AS "head"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "head"."execution_id" = "input"."execution_id"
  LIMIT 2
),
"read_receipts" AS MATERIALIZED (
  SELECT
    "input"."execution_id" AS "execution_id",
    "receipt"."revision",
    CASE
      WHEN "pg_catalog"."octet_length"("receipt"."event_id") BETWEEN 1 AND 128
        THEN "receipt"."event_id"
      ELSE NULL
    END AS "event_id",
    CASE
      WHEN "pg_catalog"."octet_length"("receipt"."receipt_digest") = 43
        THEN "receipt"."receipt_digest"
      ELSE NULL
    END AS "receipt_digest",
    "receipt"."previous_revision",
    CASE
      WHEN "receipt"."previous_event_id" IS NULL THEN NULL
      WHEN "pg_catalog"."octet_length"("receipt"."previous_event_id") BETWEEN 1 AND 128
        THEN "receipt"."previous_event_id"
      ELSE NULL
    END AS "previous_event_id",
    CASE
      WHEN "receipt"."previous_receipt_digest" IS NULL THEN NULL
      WHEN "pg_catalog"."octet_length"("receipt"."previous_receipt_digest") = 43
        THEN "receipt"."previous_receipt_digest"
      ELSE NULL
    END AS "previous_receipt_digest",
    "receipt"."committed_at"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "receipt"."execution_id" = "input"."execution_id"
  LIMIT 10001
),
"read_receipt_zero" AS MATERIALIZED (
  SELECT
    "input"."execution_id" AS "execution_id",
    "receipt"."revision",
    "receipt"."event_id" = "input"."event_id" AS "event_id_exact",
    "receipt"."receipt_id" = "input"."receipt_id" AS "receipt_id_exact",
    "receipt"."idempotency_key" = "input"."idempotency_key" AS "idempotency_key_exact",
    "receipt"."request_digest" = "input"."request_digest" AS "request_digest_exact",
    "receipt"."receipt_digest" = "input"."receipt_digest" AS "receipt_digest_exact",
    "receipt"."previous_revision" IS NULL AS "previous_revision_exact",
    "receipt"."previous_event_id" IS NULL AS "previous_event_id_exact",
    "receipt"."previous_receipt_digest" IS NULL AS "previous_receipt_digest_exact",
    "receipt"."checkpoint_kind" = 'capture' AS "checkpoint_kind_exact",
    "receipt"."canonical_receipt" = "input"."canonical_receipt" AS "canonical_receipt_exact",
    "receipt"."canonical_receipt_byte_length" =
      "pg_catalog"."octet_length"("input"."canonical_receipt") AS "canonical_receipt_byte_length_exact",
    "receipt"."committed_at" = "input"."candidate_committed_at" AS "committed_at_exact"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "receipt"."execution_id" = "input"."execution_id"
    AND "receipt"."revision" = 1
  LIMIT 2
),
"exact_initial_execution" AS MATERIALIZED (
  SELECT "execution"."execution_id"
  FROM "read_executions" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  WHERE "execution"."execution_id" = "input"."execution_id"
    AND "execution"."provider_id" = 'supabase'
    AND "execution"."environment" = 'staging'
    AND "execution"."application_id" = "input"."application_id"
    AND "execution"."application_digest" = "input"."application_digest"
    AND "execution"."migration_id" = "input"."migration_id"
    AND "execution"."migration_digest" = "input"."migration_digest"
    AND "execution"."migration_plan_digest" = "input"."migration_plan_digest"
    AND "execution"."provider_authority_digest" = "input"."provider_authority_digest"
    AND "execution"."source_ledger_digest" = "input"."source_ledger_digest"
    AND "execution"."scope_digest" = "input"."scope_digest"
    AND "execution"."resource_identity_digest" = "input"."resource_identity_digest"
    AND "execution"."catalog_precondition_digest" = "input"."catalog_precondition_digest"
    AND "execution"."canonical_scope" = "input"."canonical_scope"
    AND "execution"."canonical_scope_byte_length" = "pg_catalog"."octet_length"("input"."canonical_scope")
    AND "execution"."capture_digest" = "input"."capture_digest"
    AND "execution"."captured_high_water" IS NOT DISTINCT FROM "input"."captured_high_water"
    AND "execution"."initial_remaining_eligible_row_count" = "input"."initial_remaining_eligible_row_count"
    AND "execution"."initial_remaining_target_row_count" = "input"."initial_remaining_target_row_count"
    AND "execution"."required_matched_row_count" IS NOT DISTINCT FROM "input"."required_matched_row_count"
    AND "execution"."required_batch_count" = "input"."required_batch_count"
    AND "execution"."batch_size" = "input"."batch_size"
    AND "execution"."maximum_receipt_count" = 10000
    AND "execution"."maximum_batch_count" = 9999
    AND "execution"."status" = "input"."initial_execution_status"
    AND "execution"."created_at" = "input"."candidate_committed_at"
    AND "execution"."updated_at" = "input"."candidate_committed_at"
),
"exact_immutable_execution" AS MATERIALIZED (
  SELECT "exact"."execution_id"
  FROM "exact_initial_execution" AS "exact"
  UNION ALL
  SELECT "execution"."execution_id"
  FROM "read_executions" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  WHERE "execution"."execution_id" = "input"."execution_id"
    AND NOT EXISTS (SELECT 1 FROM "exact_initial_execution")
    AND "execution"."provider_id" = 'supabase'
    AND "execution"."environment" = 'staging'
    AND "execution"."application_id" = "input"."application_id"
    AND "execution"."application_digest" = "input"."application_digest"
    AND "execution"."migration_id" = "input"."migration_id"
    AND "execution"."migration_digest" = "input"."migration_digest"
    AND "execution"."migration_plan_digest" = "input"."migration_plan_digest"
    AND "execution"."provider_authority_digest" = "input"."provider_authority_digest"
    AND "execution"."source_ledger_digest" = "input"."source_ledger_digest"
    AND "execution"."scope_digest" = "input"."scope_digest"
    AND "execution"."resource_identity_digest" = "input"."resource_identity_digest"
    AND "execution"."catalog_precondition_digest" = "input"."catalog_precondition_digest"
    AND "execution"."canonical_scope" = "input"."canonical_scope"
    AND "execution"."canonical_scope_byte_length" = "pg_catalog"."octet_length"("input"."canonical_scope")
    AND "execution"."capture_digest" = "input"."capture_digest"
    AND "execution"."captured_high_water" IS NOT DISTINCT FROM "input"."captured_high_water"
    AND "execution"."initial_remaining_eligible_row_count" = "input"."initial_remaining_eligible_row_count"
    AND "execution"."initial_remaining_target_row_count" = "input"."initial_remaining_target_row_count"
    AND "execution"."required_matched_row_count" IS NOT DISTINCT FROM "input"."required_matched_row_count"
    AND "execution"."required_batch_count" = "input"."required_batch_count"
    AND "execution"."batch_size" = "input"."batch_size"
    AND "execution"."maximum_receipt_count" = 10000
    AND "execution"."maximum_batch_count" = 9999
    AND "execution"."status" IN ('running', 'completed', 'failed')
    AND "execution"."updated_at" >= "execution"."created_at"
    AND "execution"."created_at" = "input"."candidate_committed_at"
),
"exact_receipt_zero" AS MATERIALIZED (
  SELECT "receipt"."execution_id"
  FROM "read_receipt_zero" AS "receipt"
  WHERE "receipt"."revision" = 1
    AND "receipt"."event_id_exact"
    AND "receipt"."receipt_id_exact"
    AND "receipt"."idempotency_key_exact"
    AND "receipt"."request_digest_exact"
    AND "receipt"."receipt_digest_exact"
    AND "receipt"."previous_revision_exact"
    AND "receipt"."previous_event_id_exact"
    AND "receipt"."previous_receipt_digest_exact"
    AND "receipt"."checkpoint_kind_exact"
    AND "receipt"."canonical_receipt_exact"
    AND "receipt"."canonical_receipt_byte_length_exact"
    AND "receipt"."committed_at_exact"
),
"exact_initial_head" AS MATERIALIZED (
  SELECT "head"."execution_id"
  FROM "read_head" AS "head"
  CROSS JOIN "input_validity" AS "input"
  WHERE "head"."execution_id" = "input"."execution_id"
    AND "head"."revision" = 1
    AND "head"."event_id" = "input"."event_id"
    AND "head"."receipt_digest" = "input"."receipt_digest"
    AND "head"."updated_at" = "input"."candidate_committed_at"
),
"receipt_chain"(
  "execution_id", "revision", "event_id", "receipt_digest", "previous_revision",
  "previous_event_id", "previous_receipt_digest", "committed_at", "depth"
) AS (
  SELECT
    "receipt"."execution_id", "receipt"."revision", "receipt"."event_id",
    "receipt"."receipt_digest", "receipt"."previous_revision", "receipt"."previous_event_id",
    "receipt"."previous_receipt_digest", "receipt"."committed_at", 1::"pg_catalog"."int4"
  FROM "read_head" AS "head"
  JOIN "read_receipts" AS "receipt"
    ON "receipt"."execution_id" = "head"."execution_id"
   AND "receipt"."revision" = "head"."revision"
   AND "receipt"."event_id" = "head"."event_id"
   AND "receipt"."receipt_digest" = "head"."receipt_digest"
  WHERE "head"."revision" BETWEEN 2 AND 10000
  UNION
  SELECT
    "previous"."execution_id", "previous"."revision", "previous"."event_id",
    "previous"."receipt_digest", "previous"."previous_revision",
    "previous"."previous_event_id", "previous"."previous_receipt_digest",
    "previous"."committed_at", "chain"."depth" + 1
  FROM "receipt_chain" AS "chain"
  JOIN "read_receipts" AS "previous"
    ON "previous"."execution_id" = "chain"."execution_id"
   AND "previous"."revision" = "chain"."previous_revision"
   AND "previous"."event_id" = "chain"."previous_event_id"
   AND "previous"."receipt_digest" = "chain"."previous_receipt_digest"
  WHERE "chain"."previous_revision" = "chain"."revision" - 1
    AND "chain"."depth" < 10000
),
"facts" AS MATERIALIZED (
  SELECT
    "input"."scope_digest",
    "input"."receipt_digest",
    "input"."unauthenticated_operation_evidence_digest" AS "candidate_operation_evidence_digest",
    "input"."valid" AS "input_valid",
    "runtime"."ready" AS "runtime_ready",
    "catalog"."ready" AS "full_ledger_shape_verified",
    "catalog"."install_marker_digest",
    "runtime"."transaction_read_only",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_executions") AS "collision_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_executions" AS "execution"
      WHERE "execution"."execution_id" = "input"."execution_id") AS "target_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_initial_execution") AS "exact_initial_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_immutable_execution") AS "exact_immutable_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_receipts") AS "receipt_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_receipt_zero") AS "exact_receipt_zero_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_head") AS "head_count",
    (SELECT "pg_catalog"."max"("revision")::"pg_catalog"."int4" FROM "read_head") AS "head_revision",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_initial_head") AS "exact_initial_head_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_count",
    (SELECT "pg_catalog"."min"("revision")::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_minimum_revision",
    (SELECT "pg_catalog"."max"("revision")::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_maximum_revision",
    COALESCE(
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_head") = (
        SELECT "pg_catalog"."max"("committed_at") FROM "receipt_chain"
        WHERE "revision" = (SELECT "pg_catalog"."max"("revision") FROM "receipt_chain")
      ),
      FALSE
    ) AS "head_timestamp_matches_latest_receipt",
    COALESCE(
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_executions" AS "execution"
        WHERE "execution"."execution_id" = "input"."execution_id") =
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_head"),
      FALSE
    ) AS "execution_timestamp_matches_head",
    "input"."initial_execution_status",
    "input"."receipt_document" ->> 'outcome' AS "initial_receipt_outcome"
  FROM "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
),
"classification" AS MATERIALIZED (
  SELECT CASE
    WHEN NOT "facts"."input_valid"
      OR NOT "facts"."runtime_ready"
      OR NOT "facts"."full_ledger_shape_verified"
      THEN 'precondition-failed'
    WHEN "facts"."collision_execution_count" = 0
      AND "facts"."receipt_count" = 0
      AND "facts"."head_count" = 0
      THEN 'absent'
    WHEN "facts"."collision_execution_count" = 1
      AND "facts"."target_execution_count" = 1
      AND "facts"."exact_initial_execution_count" = 1
      AND "facts"."receipt_count" = 1
      AND "facts"."exact_receipt_zero_count" = 1
      AND "facts"."head_count" = 1
      AND "facts"."head_revision" = 1
      AND "facts"."exact_initial_head_count" = 1
      THEN 'exact-replay'
    WHEN "facts"."initial_execution_status" = 'running'
      AND "facts"."initial_receipt_outcome" = 'in-progress'
      AND "facts"."collision_execution_count" = 1
      AND "facts"."target_execution_count" = 1
      AND "facts"."exact_immutable_execution_count" = 1
      AND "facts"."receipt_count" = "facts"."head_revision"
      AND "facts"."exact_receipt_zero_count" = 1
      AND "facts"."head_count" = 1
      AND "facts"."head_revision" BETWEEN 2 AND 10000
      AND "facts"."chain_count" = "facts"."head_revision"
      AND "facts"."chain_minimum_revision" = 1
      AND "facts"."chain_maximum_revision" = "facts"."head_revision"
      AND "facts"."head_timestamp_matches_latest_receipt"
      AND "facts"."execution_timestamp_matches_head"
      THEN 'advanced-head'
    ELSE 'corruption'
  END::"pg_catalog"."text" AS "reported_status"
  FROM "facts"
)
SELECT
  'openpencil-supabase-backfill-receipt-zero-reconciliation-v1'::"pg_catalog"."text"
    AS "queryVersion",
  "facts"."scope_digest" AS "scopeDigest",
  "facts"."receipt_digest" AS "receiptDigest",
  "facts"."candidate_operation_evidence_digest" AS "candidateOperationEvidenceDigest",
  "facts"."initial_execution_status" AS "initialExecutionStatus",
  "facts"."initial_receipt_outcome" AS "initialReceiptOutcome",
  "classification"."reported_status" AS "reportedStatus",
  "facts"."input_valid" AS "inputValid",
  "facts"."runtime_ready" AS "runtimeReady",
  "facts"."full_ledger_shape_verified" AS "fullLedgerShapeVerified",
  "facts"."collision_execution_count" AS "collisionExecutionCount",
  "facts"."target_execution_count" AS "targetExecutionCount",
  "facts"."exact_initial_execution_count" AS "exactInitialExecutionCount",
  "facts"."exact_immutable_execution_count" AS "exactImmutableExecutionCount",
  "facts"."receipt_count" AS "receiptCount",
  "facts"."exact_receipt_zero_count" AS "exactReceiptZeroCount",
  "facts"."head_count" AS "headCount",
  "facts"."head_revision" AS "headRevision",
  "facts"."exact_initial_head_count" AS "exactInitialHeadCount",
  "facts"."chain_count" AS "chainCount",
  "facts"."chain_minimum_revision" AS "chainMinimumRevision",
  "facts"."chain_maximum_revision" AS "chainMaximumRevision",
  "facts"."head_timestamp_matches_latest_receipt" AS "headTimestampMatchesLatestReceipt",
  "facts"."execution_timestamp_matches_head" AS "executionTimestampMatchesHead",
  "facts"."transaction_read_only" AS "transactionReadOnly",
  "facts"."install_marker_digest" AS "installMarkerDigest",
  "pg_catalog"."current_setting"('server_version_num') AS "serverVersionNum",
  "pg_catalog"."translate"(
    "pg_catalog"."rtrim"(
      "pg_catalog"."encode"(
        "pg_catalog"."sha256"(
          "pg_catalog"."convert_to"(
            "pg_catalog"."txid_current_snapshot"()::"pg_catalog"."text",
            'UTF8'
          )
        ),
        'base64'
      ),
      '='
    ),
    '+/',
    '-_'
  ) AS "snapshotDigest",
  "pg_catalog"."to_char"(
    "pg_catalog"."statement_timestamp"() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "observedAt"
FROM "facts"
CROSS JOIN "classification";
`

/** Immutable SQL artifact shared byte-for-byte with the future native PostgreSQL session runner. */
export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL =
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL_SOURCE

if (
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL !==
  GENERATED_SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
) {
  throw new TypeError('The shared Supabase Receipt-zero reconciliation query is out of sync')
}

export const SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY = Object.freeze({
  queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
  queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  query: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
  parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  statementCount: 1 as const,
  accessMode: 'read-only' as const,
  snapshotScope: 'single-statement' as const
})

interface CurrentCASBindingsV1 {
  readonly casReviewDigest: string
  readonly receiptZeroReviewDigest: string
  readonly casTransactionSqlDigest: string
  readonly parameterSchemaDigest: string
  readonly parameterValuesDigest: string
  readonly appliedDatabaseLedgerResultDigest: string
  readonly installedLedgerVerificationDigest: string
  readonly ledgerShapeDigest: string
  readonly historicalInstallMarkerBindingDigest: string
  readonly historicalInstallMarkerDigest: string
}

interface CASReviewRuntimeViewV1 {
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
  readonly databaseAuthorityCreated: unknown
  readonly mutationAuthorityCreated: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly transaction: Readonly<{
    accessMode: unknown
    snapshotScope: unknown
    directManagementQueryDispatchCompatible: unknown
  }>
  readonly parameters: Readonly<{
    valueCount: unknown
    valuesExposed: unknown
    order: unknown
  }>
}

function requireCASReview(value: unknown): Readonly<{
  envelope: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1
  context: TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  const envelope = value as SupabaseBackfillReceiptZeroCASReviewEnvelopeV1
  const context = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(envelope)
  if (!context || context.envelope !== envelope) {
    return fail('supabase-backfill-receipt-zero-reconciliation-proof-invalid')
  }
  return Object.freeze({ envelope, context })
}

function requireStaticSqlSafetyCertificate(value: unknown): Readonly<{
  envelope: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
  context: TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-invalid')
  }
  const envelope = value as SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
  const context =
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(envelope)
  if (!context || context.envelope !== envelope) {
    return fail('supabase-backfill-receipt-zero-reconciliation-proof-invalid')
  }
  return Object.freeze({ envelope, context })
}

async function requireCurrentCASReview(
  envelope: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
): Promise<CurrentCASBindingsV1> {
  const review = envelope.review
  const runtime = review as CASReviewRuntimeViewV1
  const receiptZeroEnvelope = context.receiptZeroContext.envelope
  const receiptZeroContext = trustedSupabaseBackfillReceiptZeroReviewContextV1(receiptZeroEnvelope)
  const appliedLedger = context.receiptZeroContext.databaseLedgerContext.result
  const historicalMarker = appliedLedger.marker
  const markerSuffix = historicalMarker.startsWith(
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX
  )
    ? historicalMarker.slice(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX.length)
    : ''
  if (
    context.envelope !== envelope ||
    !receiptZeroContext ||
    receiptZeroContext !== context.receiptZeroContext ||
    runtime.format !== 'openpencil.supabase-backfill-receipt-zero-cas-review.v1' ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environmentIntent !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.reviewOnly !== true ||
    runtime.applyAvailable !== false ||
    runtime.releaseReady !== false ||
    runtime.databaseLedgerBound !== false ||
    runtime.operationAuthorityAuthenticated !== false ||
    runtime.databaseAuthorityCreated !== false ||
    runtime.mutationAuthorityCreated !== false ||
    runtime.executionAuthorityCreated !== false ||
    runtime.receiptAuthorityCreated !== false ||
    runtime.transaction.accessMode !== 'read-write' ||
    runtime.transaction.snapshotScope !== 'externally-established-serializable-transaction' ||
    runtime.transaction.directManagementQueryDispatchCompatible !== false ||
    runtime.parameters.valueCount !== 28 ||
    runtime.parameters.valuesExposed !== false ||
    runtime.parameters.order !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER ||
    context.parameters.length !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    review.parameters.schema.length !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    !review.parameters.schema.every(
      (entry, index) =>
        entry.position === index + 1 &&
        entry.name === SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER[index]
    ) ||
    envelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL ||
    !DIGEST.test(envelope.reviewDigest) ||
    !DIGEST.test(receiptZeroEnvelope.reviewDigest) ||
    !DIGEST.test(appliedLedger.markerBindingDigest) ||
    !DIGEST.test(markerSuffix)
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-changed')
  }

  const [
    casReviewDigest,
    receiptZeroReviewDigest,
    casTransactionSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    appliedDatabaseLedgerResultDigest,
    historicalInstallMarkerDigest
  ] = await Promise.all([
    digest(review),
    digest(receiptZeroEnvelope.review),
    digestSql(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL),
    digest(review.parameters.schema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values: context.parameters
      })
    ),
    digest(appliedLedger),
    digestSql(historicalMarker)
  ])

  const receiptZeroReview = receiptZeroEnvelope.review
  if (
    casReviewDigest !== envelope.reviewDigest ||
    receiptZeroReviewDigest !== receiptZeroEnvelope.reviewDigest ||
    review.bindings.receiptZeroReviewDigest !== receiptZeroReviewDigest ||
    casTransactionSqlDigest !== review.bindings.transactionSqlDigest ||
    casTransactionSqlDigest !== review.artifact.digest ||
    parameterSchemaDigest !== review.bindings.parameterSchemaDigest ||
    parameterValuesDigest !== review.bindings.parameterValuesDigest ||
    appliedDatabaseLedgerResultDigest !== receiptZeroReview.bindings.appliedResultDigest ||
    appliedLedger.installedVerificationDigest !==
      receiptZeroReview.bindings.installedVerificationDigest ||
    appliedLedger.ledgerShapeDigest !==
      receiptZeroReview.operationEvidence.databaseLedger.ledgerShapeDigest ||
    appliedLedger.marker !== receiptZeroReview.operationEvidence.databaseLedger.marker ||
    appliedLedger.markerBindingDigest !==
      receiptZeroReview.operationEvidence.databaseLedger.markerBindingDigest
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-input-changed')
  }

  return Object.freeze({
    casReviewDigest,
    receiptZeroReviewDigest,
    casTransactionSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    appliedDatabaseLedgerResultDigest,
    installedLedgerVerificationDigest: appliedLedger.installedVerificationDigest,
    ledgerShapeDigest: appliedLedger.ledgerShapeDigest,
    historicalInstallMarkerBindingDigest: appliedLedger.markerBindingDigest,
    historicalInstallMarkerDigest
  })
}

/**
 * Build a deterministic testing-only reconciliation query review. It performs no query and keeps
 * every positional value in the process-local trusted context inherited from the CAS review.
 */
export async function createSupabaseBackfillReceiptZeroReconciliationReviewForTestingV1(
  input: CreateSupabaseBackfillReceiptZeroReconciliationReviewForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1> {
  const source = exactInput(input)
  const proof = requireCASReview(ownData(source, 'casReview'))
  const staticSqlSafetyProof = requireStaticSqlSafetyCertificate(
    ownData(source, 'staticSqlSafetyCertificate')
  )
  const sourceBindings = await requireCurrentCASReview(proof.envelope, proof.context)
  const [
    reconciliationSqlDigest,
    reconciliationQueryDigest,
    reconciliationQueryContractDigest,
    expectedColumnInventoryDigest,
    expectedConstraintInventoryDigest,
    staticSqlSafetyCertificateDigest
  ] = await Promise.all([
    digestSql(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    digest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-read-query-contract.v1' as const,
        version: 1 as const,
        queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
        queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
        parameterOrder: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
      })
    ),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_COLUMNS_V1),
    digest(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_EXPECTED_CONSTRAINTS_V1),
    digest(staticSqlSafetyProof.envelope.certificate)
  ])
  const staticSqlSafetyCertificate = staticSqlSafetyProof.envelope.certificate
  const staticSqlSafetyRuntime: StaticSqlSafetyRuntimeViewV1 = staticSqlSafetyCertificate
  const staticSqlSafetyContext = staticSqlSafetyProof.context
  if (
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      staticSqlSafetyProof.envelope
    ) !== staticSqlSafetyContext ||
    staticSqlSafetyCertificateDigest !== staticSqlSafetyProof.envelope.certificateDigest ||
    staticSqlSafetyContext.queryId !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID ||
    staticSqlSafetyContext.queryVersion !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION ||
    staticSqlSafetyContext.sql !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL ||
    staticSqlSafetyContext.parameterOrder.length !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    !staticSqlSafetyContext.parameterOrder.every(
      (name, index) => name === SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER[index]
    ) ||
    staticSqlSafetyContext.responseFields.length !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length ||
    !staticSqlSafetyContext.responseFields.every(
      (name, index) => name === SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS[index]
    ) ||
    staticSqlSafetyContext.managedRelations.length !==
      SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS.length ||
    !staticSqlSafetyContext.managedRelations.every(
      (name, index) => name === SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS[index]
    ) ||
    staticSqlSafetyCertificate.subject.queryId !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID ||
    staticSqlSafetyCertificate.subject.queryVersion !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION ||
    staticSqlSafetyCertificate.subject.sqlByteLength !==
      new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL).byteLength ||
    staticSqlSafetyCertificate.subject.parameterCount !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    staticSqlSafetyCertificate.subject.responseFieldCount !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length ||
    staticSqlSafetyCertificate.bindings.queryDigest !== reconciliationQueryDigest ||
    staticSqlSafetyCertificate.bindings.sqlDigest !== reconciliationSqlDigest ||
    staticSqlSafetyCertificate.bindings.queryContractDigest !== reconciliationQueryContractDigest ||
    staticSqlSafetyCertificate.bindings.ledgerShapeDigest !== sourceBindings.ledgerShapeDigest ||
    staticSqlSafetyCertificate.bindings.expectedColumnInventoryDigest !==
      expectedColumnInventoryDigest ||
    staticSqlSafetyCertificate.bindings.expectedConstraintInventoryDigest !==
      expectedConstraintInventoryDigest ||
    staticSqlSafetyRuntime.profile !==
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE ||
    staticSqlSafetyRuntime.liveAuthenticated !== false ||
    staticSqlSafetyRuntime.staticConditionalOnly !== true ||
    staticSqlSafetyRuntime.staticScanPassed !== true ||
    staticSqlSafetyRuntime.indirectExecutionSafetyProven !== false ||
    staticSqlSafetyRuntime.requestDispatched !== false ||
    staticSqlSafetyRuntime.transportAuthorityCreated !== false ||
    staticSqlSafetyRuntime.databaseAuthorityCreated !== false ||
    staticSqlSafetyRuntime.mutationAuthorityCreated !== false ||
    staticSqlSafetyRuntime.executionAuthorityCreated !== false ||
    staticSqlSafetyRuntime.receiptAuthorityCreated !== false ||
    staticSqlSafetyRuntime.releaseAuthorityCreated !== false ||
    staticSqlSafetyRuntime.releaseReady !== false
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-static-sql-safety-binding-mismatch')
  }

  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    databaseLedgerBound: false as const,
    reconciliationAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      ...sourceBindings,
      reconciliationSqlDigest,
      reconciliationQueryDigest,
      staticSqlSafetyCertificateDigest,
      expectedColumnInventoryDigest,
      expectedConstraintInventoryDigest
    }),
    query: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      statementCount: 1 as const,
      responseShape: 'one-row-classification-facts' as const,
      responseFields: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
      hostMustRecomputeStatusFromFacts: true as const,
      dmlAllowed: false as const,
      staticSqlSafetyCertificateCreated: true as const,
      staticSqlSafetyProfile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
      staticSqlSafetyConditionalOnly: true as const,
      liveIndirectExecutionSafetyAuthenticated: false as const,
      indirectExecutionSafetyProven: false as const,
      requiresTransportEnforcedReadOnlyBoundary: true as const,
      requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true as const,
      requiresBoundedStatementTimeoutBeforeDispatch: true as const,
      rowLocksUsed: false as const,
      schemaMutationAllowed: false as const,
      managementReadOnlyEndpointSemanticallyCompatible: false as const,
      hostTransportCreated: false as const
    }),
    parameters: Object.freeze({
      order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
      schema: proof.envelope.review.parameters.schema,
      valueCount: 28 as const,
      valuesExposed: false as const,
      reusedWithoutReorderingFromCASReview: true as const
    }),
    catalogGuard: Object.freeze({
      evaluatesInSameStatementSnapshotWhenDispatched: true as const,
      minimumOnly: false as const,
      fullCatalogVerificationPerformed: false as const,
      fullCatalogVerificationIncludedInStatement: true as const,
      exactColumnInventoryComparisonIncludedInStatement: true as const,
      exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: true as const,
      aclAndUnexpectedObjectCounterChecksIncludedInStatement: true as const,
      schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
      expectedTables: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
      schemaComment: 'openpencil:release-ledger:v1' as const,
      tableCommentsChecked: true as const,
      commonOwnerRequired: true as const,
      regularUnpartitionedTablesRequired: true as const,
      rowLevelSecurityEnabledRequired: true as const,
      forcedRowLevelSecurityForbidden: true as const,
      inheritanceForbidden: true as const,
      policyCountRequired: 0 as const,
      primaryKeyMarkerConstraint: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
      installMarkerPrefix: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
      installMarkerPrefixCountRequired: 1 as const,
      specificHistoricalInstallMarkerComparedInSql: false as const,
      observedInstallMarkerDigestReturned: true as const,
      historicalInstallMarkerDigestAvailableInTrustedReviewBinding: true as const,
      specificHistoricalInstallMarkerParserComparisonCreated: true as const,
      roleRequired: 'supabase_read_only_user' as const,
      nonSuperuserRequired: true as const,
      bypassRlsRequired: true as const,
      effectivePgReadAllDataUsageRequired: true as const,
      queryRoleMustNotOwnLedger: true as const,
      currentAndSessionRoleMustMatch: true as const,
      transactionReadOnlyObserved: true as const,
      transactionReadOnlySettingIsEvidenceOnly: true as const,
      databasePrimaryRequired: true as const,
      effectiveSearchPath: Object.freeze(['pg_catalog'] as const)
    }),
    classification: Object.freeze({
      states: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES,
      absent: 'installed-ledger-has-no-colliding-execution-receipt-or-head-row' as const,
      exactReplay:
        'all-revision-one-execution-receipt-head-columns-and-canonical-bytes-equal' as const,
      insertedReadbackMapsTo: 'exact-replay' as const,
      advancedHead:
        'immutable-execution-and-receipt-zero-equal-with-bounded-relational-tuple-chain' as const,
      advancedHeadIsRelationalOnly: true as const,
      advancedHeadRequiresFullPortableReceiptV2ChainVerification: true as const,
      corruption:
        'every-other-successfully-observed-partial-collision-or-byte-mismatch-state' as const,
      preconditionFailed: 'trusted-input-runtime-or-full-ledger-guard-is-not-exact' as const,
      missingSchemaRelationOrColumn: 'transport-failure-outcome-unknown' as const
    }),
    policy: Object.freeze({
      previewContainsPlaceholdersOnly: true as const,
      canonicalValuesKeptInTrustedContextOnly: true as const,
      requestDispatched: false as const,
      managedDataReadPerformed: false as const,
      mutationDispatched: false as const,
      captureConsumed: false as const,
      credentialAuthorityCreated: false as const,
      transportAuthorityCreated: false as const,
      databaseAuthorityCreated: false as const,
      reconciliationResultAuthenticated: false as const,
      reportedReconciliationStatusTrusted: false as const,
      testingStatusParserCreated: true as const,
      productionResponseAuthenticated: false as const,
      automaticRetryAllowed: false as const,
      transportFailureClassifiesDatabaseState: false as const,
      transportFailureOutcome: 'outcome-unknown' as const,
      absentProvesPriorMutationStopped: false as const,
      successfulAdvancedClassificationReleaseReady: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_ARTIFACT_PATH,
      kind: 'receipt-zero-read-only-reconciliation-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL)
        .byteLength,
      digest: reconciliationSqlDigest,
      containsCatalogRead: true as const,
      containsManagedDataRead: true as const,
      containsDml: false as const,
      containsDirectDml: false as const,
      indirectExecutionSafetyProven: false as const,
      containsRowLock: false as const,
      performsSchemaChange: false as const,
      requestDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: uniqueBlockers([...proof.envelope.review.blockers, ...BLOCKERS])
  }) satisfies SupabaseBackfillReceiptZeroReconciliationReviewV1

  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL
  })
  if (trustedSupabaseBackfillReceiptZeroCASReviewContextV1(proof.envelope) !== proof.context) {
    return fail('supabase-backfill-receipt-zero-reconciliation-proof-invalid')
  }
  if (
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      staticSqlSafetyProof.envelope
    ) !== staticSqlSafetyContext
  ) {
    return fail('supabase-backfill-receipt-zero-reconciliation-proof-invalid')
  }
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      casContext: proof.context,
      staticSqlSafetyContext,
      parameters: proof.context.parameters
    })
  )
  return envelope
}

/** Identity-only lookup; no query, credential, transport, or Receipt authority is returned. */
export function trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (
    !context ||
    trustedSupabaseBackfillReceiptZeroCASReviewContextV1(context.casContext.envelope) !==
      context.casContext ||
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      context.staticSqlSafetyContext.envelope
    ) !== context.staticSqlSafetyContext
  ) {
    return null
  }
  return context
}

export type SupabaseBackfillReceiptZeroReconciliationStateV1 = ReconciliationState
