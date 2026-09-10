/* oxlint-disable eslint(max-lines), eslint(complexity) -- Fixed SQL, review metadata, and process-local provenance form one auditable boundary. */

import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

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
  type SupabaseBackfillReceiptZeroCASParameterV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/cas/review'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
  trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1,
  type SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/review'

import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES,
  createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1,
  type SupabaseBackfillReceiptV2ChainTransportSizeReviewV1
} from './transport-size-certificate'

export {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES
} from './transport-size-certificate'

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-first-page-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/receipt-v2-chain-page-review.sql' as const

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS = Object.freeze([
  'queryVersion',
  'pageMode',
  'scopeDigest',
  'afterRevision',
  'pageSize',
  'anchorRevision',
  'anchorEventId',
  'anchorReceiptDigest',
  'anchorUpdatedAt',
  'reportedStatus',
  'reconciliationReportedStatus',
  'reconciliationResponse',
  'inputValid',
  'runtimeReady',
  'fullLedgerShapeVerified',
  'exactImmutableExecutionCount',
  'currentExecutionCount',
  'exactReceiptZeroCount',
  'executionStatus',
  'receiptCount',
  'minimumReceiptRevision',
  'maximumReceiptRevision',
  'headCount',
  'currentHeadRevision',
  'currentHeadEventId',
  'currentHeadReceiptDigest',
  'currentHeadUpdatedAt',
  'headMatchesAnchor',
  'anchorReceiptCount',
  'headTimestampMatchesAnchorReceipt',
  'executionTimestampMatchesHead',
  'pageCandidateCount',
  'pageReceiptCount',
  'pageFirstRevision',
  'pageLastRevision',
  'pageContiguous',
  'pageLinksValid',
  'receiptZeroMatchesCandidate',
  'hasMore',
  'receipts',
  'transactionReadOnly',
  'installMarkerDigest',
  'serverVersionNum',
  'snapshotDigest',
  'observedAt'
] as const)

const INPUT_KEYS = ['reconciliationReview', 'staticSqlSafetyCertificate'] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const FIRST_PAGE_PARAMETER_SUFFIX = Object.freeze(['0', null, null, null, null] as const)
const BLOCKERS = Object.freeze([
  'receipt-v2-chain-first-page-review-only',
  'receipt-v2-chain-page-host-transport-unavailable',
  'receipt-v2-chain-page-indirect-execution-safety-not-proven',
  'receipt-v2-chain-cross-page-head-freshness-unavailable',
  'receipt-v2-chain-production-response-authentication-unavailable'
] as const)

type ParameterValue = string | null
type PageParameterName = (typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER)[number]

export interface CreateSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingOptionsV1 {
  readonly reconciliationReview: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly staticSqlSafetyCertificate: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
}

export interface SupabaseBackfillReceiptV2ChainPageParameterV1 {
  readonly position: number
  readonly name: PageParameterName
  readonly pgType: 'text' | 'bigint' | 'integer'
  readonly nullable: boolean
  readonly encoding: 'plain-text' | 'decimal-text' | 'standard-base64' | 'rfc3339'
}

export interface SupabaseBackfillReceiptV2ChainFirstPageReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly databaseLedgerBound: false
  readonly chainVerificationAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    reconciliationReviewDigest: string
    reconciliationSqlDigest: string
    reconciliationQueryDigest: string
    sourceParameterSchemaDigest: string
    sourceParameterValuesDigest: string
    pageParameterSchemaDigest: string
    pageParameterValuesDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
    scopeDigest: string
    expectedReceiptZeroDigest: string
    historicalInstallMarkerDigest: string
    pageSqlDigest: string
    pageQueryDigest: string
    pageStaticSqlSafetyCertificateDigest: string
    pageTransportSizeCertificateDigest: string
    pageRequestSizeCertificateDigest: string
  }>
  readonly query: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    statementCount: 1
    responseShape: 'one-row-anchor-bound-bounded-receipt-page'
    responseFields: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS
    embedsReconciliationQueryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION
    hostMustRecomputeStatusFromFacts: true
    dmlAllowed: false
    rowLocksUsed: false
    schemaMutationAllowed: false
    staticSqlSafetyCertificateCreated: true
    staticSqlSafetyProfile: typeof SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE
    staticSqlSafetyConditionalOnly: true
    liveIndirectExecutionSafetyAuthenticated: false
    indirectExecutionSafetyProven: false
    requiresTransportEnforcedReadOnlyBoundary: true
    requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true
    requiresBoundedStatementTimeoutBeforeDispatch: true
    managementReadOnlyEndpointSemanticallyCompatible: false
    boundedIntegerResponseWireType: 'int4'
    internalRevisionArithmeticType: 'int8'
    bigintJSONNumberDependency: false
    transportSizeCertificateCreated: true
    fixedQueryRequestSizeCertified: true
    responseSizeUpperBoundCertified: true
    decodedAggregateUpperBoundCertified: true
    hostTransportCreated: false
  }>
  readonly parameters: Readonly<{
    order: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER
    schema: readonly SupabaseBackfillReceiptV2ChainPageParameterV1[]
    valueCount: 33
    valuesExposed: false
    reusedReceiptZeroCASPrefixCount: 28
    modeDerivedFromParameterSuffix: true
    firstPageAfterRevision: 0
    firstPageAnchorValuesAreNull: true
  }>
  readonly catalogGuard: Readonly<{
    inheritedReconciliationStatementEmbedded: true
    evaluatesInSameStatementSnapshotWhenDispatched: true
    fullCatalogVerificationPerformed: false
    fullCatalogVerificationIncludedInStatement: true
    exactColumnInventoryComparisonIncludedInStatement: true
    exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: true
    aclAndUnexpectedObjectCounterChecksIncludedInStatement: true
    historicalInstallMarkerDigestReturned: true
  }>
  readonly page: Readonly<{
    kind: 'first'
    afterRevision: 0
    maximumReceiptCount: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE
    lookaheadReceiptCount: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE
    keysetOrder: 'revision-ascending'
    currentHeadCapturedInSameStatement: true
    fixedQueryAlsoSupportsAnchorBoundContinuation: true
    anchorFields: readonly ['revision', 'eventId', 'receiptDigest', 'updatedAt']
    continuationMustBindExactAnchor: true
    staleAnchorReanchoredAutomatically: false
    crossPageSingleSnapshotClaimed: false
    canonicalReceiptEncoding: 'standard-base64-without-whitespace'
    maximumCanonicalReceiptBytesEach: typeof SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES
    maximumBase64CharactersEach: typeof SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT
    maximumBase64CharactersPerPage: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS
  }>
  readonly transportSize: SupabaseBackfillReceiptV2ChainTransportSizeReviewV1
  readonly policy: Readonly<{
    previewContainsPlaceholdersOnly: true
    canonicalValuesKeptInTrustedContextOnly: true
    requestDispatched: false
    managedDataReadPerformed: false
    productionResponseAuthenticated: false
    responseParserCreated: true
    boundedResponseWireDecoderCreated: true
    localRequestAndResponseBoundsCertified: true
    continuationCreated: false
    fullPortableReceiptV2ChainVerified: false
    headFreshnessAuthenticatedAcrossPages: false
    mutationDispatched: false
    captureConsumed: false
    credentialAuthorityCreated: false
    transportAuthorityCreated: false
    databaseAuthorityCreated: false
    releaseAuthorityCreated: false
    automaticRetryAllowed: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_ARTIFACT_PATH
    kind: 'receipt-v2-chain-page-read-only-review'
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

export interface SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptV2ChainFirstPageReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/** Process-local query material only; no credential, transport, chain, or release authority. */
export interface TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1
  readonly reconciliationContext: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
  readonly staticSqlSafetyContext: TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
  readonly sourceParameters: readonly ParameterValue[]
  readonly parameters: readonly ParameterValue[]
}

export type SupabaseBackfillReceiptV2ChainFirstPageReviewErrorCode =
  | 'supabase-backfill-receipt-v2-chain-first-page-input-invalid'
  | 'supabase-backfill-receipt-v2-chain-first-page-proof-invalid'
  | 'supabase-backfill-receipt-v2-chain-first-page-static-sql-safety-binding-mismatch'
  | 'supabase-backfill-receipt-v2-chain-first-page-transport-size-binding-mismatch'
  | 'supabase-backfill-receipt-v2-chain-first-page-review-changed'
  | 'supabase-backfill-receipt-v2-chain-first-page-digest-failed'

export class SupabaseBackfillReceiptV2ChainFirstPageReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ChainFirstPageReviewErrorCode) {
    super('Supabase backfill Receipt V2 chain first-page review failed: ' + code + '.')
    this.name = 'SupabaseBackfillReceiptV2ChainFirstPageReviewError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

type StaticSqlSafetyRuntimeViewV1 = SupabaseBackfillReadQueryIndirectExecutionSafetyRuntimeViewV1

interface CurrentReconciliationBindingsV1 {
  readonly reconciliationReviewDigest: string
  readonly reconciliationSqlDigest: string
  readonly reconciliationQueryDigest: string
  readonly sourceParameterSchemaDigest: string
  readonly sourceParameterValuesDigest: string
  readonly expectedColumnInventoryDigest: string
  readonly expectedConstraintInventoryDigest: string
  readonly scopeDigest: string
  readonly expectedReceiptZeroDigest: string
  readonly historicalInstallMarkerDigest: string
  readonly ledgerShapeDigest: string
}

interface ReconciliationRuntimeViewV1 {
  readonly format: unknown
  readonly version: unknown
  readonly providerId: unknown
  readonly environmentIntent: unknown
  readonly testingOnly: unknown
  readonly reviewOnly: unknown
  readonly applyAvailable: unknown
  readonly releaseReady: unknown
  readonly databaseLedgerBound: unknown
  readonly reconciliationAuthorityCreated: unknown
  readonly databaseAuthorityCreated: unknown
  readonly mutationAuthorityCreated: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly query: Readonly<{
    queryId: unknown
    queryVersion: unknown
    accessMode: unknown
    snapshotScope: unknown
    statementCount: unknown
    responseFields: unknown
    staticSqlSafetyCertificateCreated: unknown
    staticSqlSafetyProfile: unknown
    staticSqlSafetyConditionalOnly: unknown
    liveIndirectExecutionSafetyAuthenticated: unknown
    indirectExecutionSafetyProven: unknown
    requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: unknown
    hostTransportCreated: unknown
  }>
  readonly parameters: Readonly<{
    order: unknown
    schema: unknown
    valueCount: unknown
    valuesExposed: unknown
  }>
  readonly catalogGuard: Readonly<{
    fullCatalogVerificationIncludedInStatement: unknown
    exactColumnInventoryComparisonIncludedInStatement: unknown
    exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: unknown
    aclAndUnexpectedObjectCounterChecksIncludedInStatement: unknown
  }>
}

const trustedReviews = new WeakMap<
  object,
  TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
>()

function fail(code: SupabaseBackfillReceiptV2ChainFirstPageReviewErrorCode): never {
  throw new SupabaseBackfillReceiptV2ChainFirstPageReviewError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  let isArray: boolean
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    isArray = Array.isArray(value)
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  if (
    isArray ||
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  for (const key of INPUT_KEYS) ownData(value, key)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-first-page-digest-failed')
  }
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-first-page-digest-failed')
  }
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

function embeddedReconciliationStatement(): string {
  const statement = SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL.trimEnd()
  if (!statement.endsWith(';') || statement.match(/;/gu)?.length !== 1) {
    throw new TypeError('Receipt-zero reconciliation statement boundary changed.')
  }
  return statement
    .slice(0, -1)
    .split('\n')
    .map((line) => '  ' + line)
    .join('\n')
}

const EMBEDDED_RECONCILIATION_STATEMENT = embeddedReconciliationStatement()

const ADDED_PARAMETER_SCHEMA = Object.freeze([
  Object.freeze({
    position: 29,
    name: 'afterRevision',
    pgType: 'bigint',
    nullable: false,
    encoding: 'decimal-text'
  }),
  Object.freeze({
    position: 30,
    name: 'anchorRevision',
    pgType: 'bigint',
    nullable: true,
    encoding: 'decimal-text'
  }),
  Object.freeze({
    position: 31,
    name: 'anchorEventId',
    pgType: 'text',
    nullable: true,
    encoding: 'plain-text'
  }),
  Object.freeze({
    position: 32,
    name: 'anchorReceiptDigest',
    pgType: 'text',
    nullable: true,
    encoding: 'plain-text'
  }),
  Object.freeze({
    position: 33,
    name: 'anchorUpdatedAt',
    pgType: 'text',
    nullable: true,
    encoding: 'rfc3339'
  })
] as const satisfies readonly SupabaseBackfillReceiptV2ChainPageParameterV1[])

/**
 * One fixed page query. First mode captures the live head; continuation mode accepts only the exact
 * prior four-field anchor and returns anchor-stale instead of silently rebinding to a new head.
 */
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL = `-- OpenPencil Supabase Receipt V2 chain page read-only review v1.
-- REVIEW ONLY: no transport, response authentication, continuation factory, mutation, or release authority.
-- Parameters 1-28 reuse Receipt-zero CAS values, parameters 29-33 bind afterRevision and anchor.
WITH
"reconciliation" AS MATERIALIZED (
${EMBEDDED_RECONCILIATION_STATEMENT}
),
"raw_page_input" AS MATERIALIZED (
  SELECT
    $1::"pg_catalog"."text" AS "execution_id",
    $9::"pg_catalog"."text" AS "scope_digest",
    $26::"pg_catalog"."text" AS "receipt_zero_digest",
    $29::"pg_catalog"."int8" AS "after_revision",
    $30::"pg_catalog"."int8" AS "anchor_revision",
    $31::"pg_catalog"."text" AS "anchor_event_id",
    $32::"pg_catalog"."text" AS "anchor_receipt_digest",
    $33::"pg_catalog"."text" AS "anchor_updated_at"
),
"page_input" AS MATERIALIZED (
  SELECT
    "raw_page_input".*,
    CASE
      WHEN "after_revision" = 0
        AND "anchor_revision" IS NULL
        AND "anchor_event_id" IS NULL
        AND "anchor_receipt_digest" IS NULL
        AND "anchor_updated_at" IS NULL
        THEN 'first'
      WHEN "after_revision" BETWEEN 1 AND 9999
        AND "anchor_revision" BETWEEN 2 AND 10000
        AND "after_revision" < "anchor_revision"
        AND "anchor_event_id" IS NOT NULL
        AND "anchor_receipt_digest" IS NOT NULL
        AND "anchor_updated_at" IS NOT NULL
        THEN 'continuation'
      ELSE 'invalid'
    END::"pg_catalog"."text" AS "page_mode",
    COALESCE(
      (
        (
          "after_revision" = 0
          AND "anchor_revision" IS NULL
          AND "anchor_event_id" IS NULL
          AND "anchor_receipt_digest" IS NULL
          AND "anchor_updated_at" IS NULL
        )
        OR (
          "after_revision" BETWEEN 1 AND 9999
          AND "anchor_revision" BETWEEN 2 AND 10000
          AND "after_revision" < "anchor_revision"
          AND "anchor_event_id" IS NOT NULL
          AND "anchor_receipt_digest" IS NOT NULL
          AND "anchor_updated_at" IS NOT NULL
        )
      ),
      false
    ) AS "page_input_valid"
  FROM "raw_page_input"
),
"current_execution_rows" AS MATERIALIZED (
  SELECT
    "execution"."status",
    "execution"."created_at",
    "execution"."updated_at"
  FROM ONLY "openpencil_release"."backfill_executions_v1" AS "execution"
  CROSS JOIN "page_input"
  CROSS JOIN "reconciliation"
  WHERE "execution"."execution_id" = "page_input"."execution_id"
    AND "page_input"."page_input_valid"
    AND "reconciliation"."reportedStatus" IN ('exact-replay', 'advanced-head')
    AND "reconciliation"."inputValid"
    AND "reconciliation"."runtimeReady"
    AND "reconciliation"."fullLedgerShapeVerified"
    AND "reconciliation"."scopeDigest" = "page_input"."scope_digest"
    AND "reconciliation"."receiptDigest" = "page_input"."receipt_zero_digest"
  ORDER BY "execution"."status", "execution"."updated_at"
  LIMIT 2
),
"current_execution" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "execution_count",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("status") END AS "status",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("created_at") END AS "created_at",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("updated_at") END AS "updated_at"
  FROM "current_execution_rows"
),
"current_head_rows" AS MATERIALIZED (
  SELECT
    "head"."execution_id",
    "head"."revision",
    "head"."event_id",
    "head"."receipt_digest",
    "head"."updated_at"
  FROM ONLY "openpencil_release"."backfill_heads_v1" AS "head"
  CROSS JOIN "page_input"
  CROSS JOIN "reconciliation"
  WHERE "head"."execution_id" = "page_input"."execution_id"
    AND "page_input"."page_input_valid"
    AND "reconciliation"."reportedStatus" IN ('exact-replay', 'advanced-head')
    AND "reconciliation"."inputValid"
    AND "reconciliation"."runtimeReady"
    AND "reconciliation"."fullLedgerShapeVerified"
    AND "reconciliation"."scopeDigest" = "page_input"."scope_digest"
    AND "reconciliation"."receiptDigest" = "page_input"."receipt_zero_digest"
  ORDER BY "head"."revision", "head"."event_id", "head"."receipt_digest"
  LIMIT 2
),
"current_head" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "head_count",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("revision") END AS "revision",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("event_id") END AS "event_id",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("receipt_digest") END AS "receipt_digest",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("updated_at") END AS "updated_at"
  FROM "current_head_rows"
),
"effective_anchor" AS MATERIALIZED (
  SELECT
    CASE
      WHEN "page_input"."page_mode" = 'first' THEN "current_head"."revision"
      ELSE "page_input"."anchor_revision"
    END AS "revision",
    CASE
      WHEN "page_input"."page_mode" = 'first' THEN "current_head"."event_id"
      ELSE "page_input"."anchor_event_id"
    END AS "event_id",
    CASE
      WHEN "page_input"."page_mode" = 'first' THEN "current_head"."receipt_digest"
      ELSE "page_input"."anchor_receipt_digest"
    END AS "receipt_digest",
    CASE
      WHEN "page_input"."page_mode" = 'first' AND "current_head"."updated_at" IS NOT NULL
        THEN "pg_catalog"."to_char"(
          "current_head"."updated_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      ELSE "page_input"."anchor_updated_at"
    END AS "updated_at",
    CASE
      WHEN "page_input"."page_mode" = 'first' THEN "current_head"."head_count" = 1
      WHEN "page_input"."page_mode" = 'continuation' THEN
        "current_head"."head_count" = 1
        AND "current_head"."revision" = "page_input"."anchor_revision"
        AND "current_head"."event_id" = "page_input"."anchor_event_id"
        AND "current_head"."receipt_digest" = "page_input"."anchor_receipt_digest"
        AND "pg_catalog"."to_char"(
          "current_head"."updated_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) = "page_input"."anchor_updated_at"
      ELSE false
    END AS "head_matches_anchor"
  FROM "page_input"
  CROSS JOIN "current_head"
),
"anchor_receipt_rows" AS MATERIALIZED (
  SELECT "receipt"."committed_at"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "page_input"
  CROSS JOIN "effective_anchor"
  WHERE "effective_anchor"."head_matches_anchor"
    AND "receipt"."execution_id" = "page_input"."execution_id"
    AND "receipt"."revision" = "effective_anchor"."revision"
    AND "receipt"."event_id" = "effective_anchor"."event_id"
    AND "receipt"."receipt_digest" = "effective_anchor"."receipt_digest"
  ORDER BY "receipt"."committed_at"
  LIMIT 2
),
"anchor_receipt" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "receipt_count",
    COALESCE(
      "pg_catalog"."bool_and"(
        "pg_catalog"."to_char"(
          "committed_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        ) = "effective_anchor"."updated_at"
      ),
      false
    ) AS "timestamp_matches"
  FROM "anchor_receipt_rows"
  CROSS JOIN "effective_anchor"
),
"prior_rows" AS MATERIALIZED (
  SELECT
    "receipt"."revision",
    "receipt"."event_id",
    "receipt"."receipt_digest"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "page_input"
  CROSS JOIN "effective_anchor"
  WHERE "effective_anchor"."head_matches_anchor"
    AND "page_input"."after_revision" > 0
    AND "receipt"."execution_id" = "page_input"."execution_id"
    AND "receipt"."revision" = "page_input"."after_revision"
  ORDER BY "receipt"."event_id", "receipt"."receipt_digest"
  LIMIT 2
),
"prior_receipt" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "receipt_count",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("revision") END AS "revision",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("event_id") END AS "event_id",
    CASE WHEN "pg_catalog"."count"(*) = 1 THEN "pg_catalog"."min"("receipt_digest") END AS "receipt_digest"
  FROM "prior_rows"
),
"page_keys" AS MATERIALIZED (
  SELECT "receipt"."revision"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "page_input"
  CROSS JOIN "effective_anchor"
  WHERE "effective_anchor"."head_matches_anchor"
    AND "receipt"."execution_id" = "page_input"."execution_id"
    AND "receipt"."revision" > "page_input"."after_revision"
    AND "receipt"."revision" <= "effective_anchor"."revision"
  ORDER BY "receipt"."revision"
  LIMIT 5
),
"selected_page_keys" AS MATERIALIZED (
  SELECT "revision"
  FROM "page_keys"
  ORDER BY "revision"
  LIMIT 4
),
"page_rows" AS MATERIALIZED (
  SELECT
    "receipt"."revision",
    "receipt"."event_id",
    "receipt"."receipt_id",
    "receipt"."idempotency_key",
    "receipt"."request_digest",
    "receipt"."receipt_digest",
    "receipt"."previous_revision",
    "receipt"."previous_event_id",
    "receipt"."previous_receipt_digest",
    "receipt"."checkpoint_kind",
    "receipt"."canonical_receipt",
    "receipt"."canonical_receipt_byte_length",
    "receipt"."committed_at"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "page_input"
  JOIN "selected_page_keys"
    ON "selected_page_keys"."revision" = "receipt"."revision"
  WHERE "receipt"."execution_id" = "page_input"."execution_id"
    AND "receipt"."canonical_receipt_byte_length" BETWEEN 2 AND 65536
    AND "pg_catalog"."octet_length"("receipt"."canonical_receipt") =
      "receipt"."canonical_receipt_byte_length"
  ORDER BY "receipt"."revision"
),
"page_summary" AS MATERIALIZED (
  SELECT
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "page_keys") AS "candidate_count",
    "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "receipt_count",
    "pg_catalog"."min"("revision") AS "first_revision",
    "pg_catalog"."max"("revision") AS "last_revision"
  FROM "page_rows"
),
"page_facts" AS MATERIALIZED (
  SELECT
    (
      "effective_anchor"."head_matches_anchor"
      AND "page_summary"."receipt_count" = LEAST(
        4::"pg_catalog"."int8",
        "effective_anchor"."revision" - "page_input"."after_revision"
      )
      AND "page_summary"."first_revision" = "page_input"."after_revision" + 1
      AND "page_summary"."last_revision" = "page_input"."after_revision" +
        "page_summary"."receipt_count"
      AND (
        "effective_anchor"."revision" - "page_input"."after_revision" <= 4
        OR "page_summary"."candidate_count" = 5
      )
    ) AS "page_contiguous",
    COALESCE(
      (
        SELECT "pg_catalog"."bool_and"(
          (
            "receipt"."revision" = "page_input"."after_revision" + 1
            AND (
              (
                "page_input"."after_revision" = 0
                AND "receipt"."previous_revision" IS NULL
                AND "receipt"."previous_event_id" IS NULL
                AND "receipt"."previous_receipt_digest" IS NULL
              )
              OR (
                "page_input"."after_revision" > 0
                AND "prior_receipt"."receipt_count" = 1
                AND "receipt"."previous_revision" = "prior_receipt"."revision"
                AND "receipt"."previous_event_id" = "prior_receipt"."event_id"
                AND "receipt"."previous_receipt_digest" = "prior_receipt"."receipt_digest"
              )
            )
          )
          OR (
            "receipt"."revision" > "page_input"."after_revision" + 1
            AND EXISTS (
              SELECT 1
              FROM "page_rows" AS "previous"
              WHERE "previous"."revision" = "receipt"."revision" - 1
                AND "receipt"."previous_revision" = "previous"."revision"
                AND "receipt"."previous_event_id" = "previous"."event_id"
                AND "receipt"."previous_receipt_digest" = "previous"."receipt_digest"
            )
          )
        )
        FROM "page_rows" AS "receipt"
      ),
      false
    ) AS "page_links_valid",
    (
      "reconciliation"."receiptDigest" = "page_input"."receipt_zero_digest"
      AND "reconciliation"."exactReceiptZeroCount" = 1
    ) AS "receipt_zero_matches_candidate"
  FROM "page_input"
  CROSS JOIN "effective_anchor"
  CROSS JOIN "prior_receipt"
  CROSS JOIN "page_summary"
  CROSS JOIN "reconciliation"
),
"reconciliation_json" AS MATERIALIZED (
  SELECT "pg_catalog"."jsonb_build_object"(
    'queryVersion', "reconciliation"."queryVersion",
    'scopeDigest', "reconciliation"."scopeDigest",
    'receiptDigest', "reconciliation"."receiptDigest",
    'candidateOperationEvidenceDigest', "reconciliation"."candidateOperationEvidenceDigest",
    'initialExecutionStatus', "reconciliation"."initialExecutionStatus",
    'initialReceiptOutcome', "reconciliation"."initialReceiptOutcome",
    'reportedStatus', "reconciliation"."reportedStatus",
    'inputValid', "reconciliation"."inputValid",
    'runtimeReady', "reconciliation"."runtimeReady",
    'fullLedgerShapeVerified', "reconciliation"."fullLedgerShapeVerified",
    'collisionExecutionCount', "reconciliation"."collisionExecutionCount",
    'targetExecutionCount', "reconciliation"."targetExecutionCount",
    'exactInitialExecutionCount', "reconciliation"."exactInitialExecutionCount",
    'exactImmutableExecutionCount', "reconciliation"."exactImmutableExecutionCount",
    'receiptCount', "reconciliation"."receiptCount",
    'exactReceiptZeroCount', "reconciliation"."exactReceiptZeroCount",
    'headCount', "reconciliation"."headCount",
    'headRevision', "reconciliation"."headRevision",
    'exactInitialHeadCount', "reconciliation"."exactInitialHeadCount",
    'chainCount', "reconciliation"."chainCount",
    'chainMinimumRevision', "reconciliation"."chainMinimumRevision",
    'chainMaximumRevision', "reconciliation"."chainMaximumRevision",
    'headTimestampMatchesLatestReceipt', "reconciliation"."headTimestampMatchesLatestReceipt",
    'executionTimestampMatchesHead', "reconciliation"."executionTimestampMatchesHead",
    'transactionReadOnly', "reconciliation"."transactionReadOnly",
    'installMarkerDigest', "reconciliation"."installMarkerDigest",
    'serverVersionNum', "reconciliation"."serverVersionNum",
    'snapshotDigest', "reconciliation"."snapshotDigest",
    'observedAt', "reconciliation"."observedAt"
  ) AS "response"
  FROM "reconciliation"
),
"page_json" AS MATERIALIZED (
  SELECT COALESCE(
    "pg_catalog"."jsonb_agg"(
      "pg_catalog"."jsonb_build_object"(
        'revision', "revision"::"pg_catalog"."int4",
        'eventId', "event_id",
        'receiptId', "receipt_id",
        'idempotencyKey', "idempotency_key",
        'requestDigest', "request_digest",
        'receiptDigest', "receipt_digest",
        'previousRevision', "previous_revision"::"pg_catalog"."int4",
        'previousEventId', "previous_event_id",
        'previousReceiptDigest', "previous_receipt_digest",
        'checkpointKind', "checkpoint_kind",
        'canonicalReceiptBase64', "pg_catalog"."replace"(
          "pg_catalog"."encode"("canonical_receipt", 'base64'),
          "pg_catalog"."chr"(10),
          ''
        ),
        'canonicalReceiptByteLength', "canonical_receipt_byte_length",
        'committedAt', "pg_catalog"."to_char"(
          "committed_at" AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
        )
      )
      ORDER BY "revision"
    ),
    '[]'::"pg_catalog"."jsonb"
  ) AS "receipts"
  FROM "page_rows"
),
"classification" AS MATERIALIZED (
  SELECT CASE
    WHEN NOT "page_input"."page_input_valid"
      OR NOT "reconciliation"."inputValid"
      OR NOT "reconciliation"."runtimeReady"
      OR NOT "reconciliation"."fullLedgerShapeVerified"
      OR "reconciliation"."reportedStatus" = 'precondition-failed'
      THEN 'precondition-failed'
    WHEN "reconciliation"."reportedStatus" = 'corruption'
      THEN 'corruption'
    WHEN "reconciliation"."reportedStatus" NOT IN ('exact-replay', 'advanced-head')
      THEN 'precondition-failed'
    WHEN "page_input"."page_mode" = 'continuation'
      AND NOT "effective_anchor"."head_matches_anchor"
      AND "current_head"."head_count" = 1
      AND "current_head"."revision" > "page_input"."anchor_revision"
      THEN 'anchor-stale'
    WHEN "page_input"."page_mode" = 'continuation'
      AND NOT "effective_anchor"."head_matches_anchor"
      THEN 'corruption'
    WHEN "current_head"."head_count" <> 1
      OR "reconciliation"."exactImmutableExecutionCount" <> 1
      OR "current_execution"."execution_count" <> 1
      OR "reconciliation"."exactReceiptZeroCount" <> 1
      OR "reconciliation"."receiptCount" <> "current_head"."revision"
      OR "reconciliation"."chainMinimumRevision" <> 1
      OR "reconciliation"."chainMaximumRevision" <> "current_head"."revision"
      OR "anchor_receipt"."receipt_count" <> 1
      OR NOT "anchor_receipt"."timestamp_matches"
      OR "current_execution"."updated_at" IS DISTINCT FROM "current_head"."updated_at"
      OR NOT "reconciliation"."executionTimestampMatchesHead"
      OR NOT "page_facts"."receipt_zero_matches_candidate"
      OR NOT "page_facts"."page_contiguous"
      OR NOT "page_facts"."page_links_valid"
      THEN 'corruption'
    WHEN "page_summary"."candidate_count" = 5
      AND "page_summary"."receipt_count" = 4
      AND "page_summary"."last_revision" < "effective_anchor"."revision"
      THEN 'page-ready'
    WHEN "page_summary"."candidate_count" BETWEEN 1 AND 4
      AND "page_summary"."receipt_count" = "page_summary"."candidate_count"
      AND "page_summary"."last_revision" = "effective_anchor"."revision"
      THEN 'chain-complete'
    ELSE 'corruption'
  END::"pg_catalog"."text" AS "reported_status"
  FROM "page_input"
  CROSS JOIN "reconciliation"
  CROSS JOIN "current_execution"
  CROSS JOIN "current_head"
  CROSS JOIN "effective_anchor"
  CROSS JOIN "anchor_receipt"
  CROSS JOIN "page_summary"
  CROSS JOIN "page_facts"
)
SELECT
  'openpencil-supabase-backfill-receipt-v2-chain-page-v1'::"pg_catalog"."text" AS "queryVersion",
  "page_input"."page_mode" AS "pageMode",
  "reconciliation"."scopeDigest" AS "scopeDigest",
  "page_input"."after_revision"::"pg_catalog"."int4" AS "afterRevision",
  4::"pg_catalog"."int4" AS "pageSize",
  "effective_anchor"."revision"::"pg_catalog"."int4" AS "anchorRevision",
  "effective_anchor"."event_id" AS "anchorEventId",
  "effective_anchor"."receipt_digest" AS "anchorReceiptDigest",
  "effective_anchor"."updated_at" AS "anchorUpdatedAt",
  "classification"."reported_status" AS "reportedStatus",
  "reconciliation"."reportedStatus" AS "reconciliationReportedStatus",
  "reconciliation_json"."response" AS "reconciliationResponse",
  ("page_input"."page_input_valid" AND "reconciliation"."inputValid") AS "inputValid",
  "reconciliation"."runtimeReady" AS "runtimeReady",
  "reconciliation"."fullLedgerShapeVerified" AS "fullLedgerShapeVerified",
  "reconciliation"."exactImmutableExecutionCount" AS "exactImmutableExecutionCount",
  "current_execution"."execution_count" AS "currentExecutionCount",
  "reconciliation"."exactReceiptZeroCount" AS "exactReceiptZeroCount",
  "current_execution"."status" AS "executionStatus",
  "reconciliation"."receiptCount" AS "receiptCount",
  "reconciliation"."chainMinimumRevision" AS "minimumReceiptRevision",
  "reconciliation"."chainMaximumRevision" AS "maximumReceiptRevision",
  "current_head"."head_count" AS "headCount",
  "current_head"."revision"::"pg_catalog"."int4" AS "currentHeadRevision",
  "current_head"."event_id" AS "currentHeadEventId",
  "current_head"."receipt_digest" AS "currentHeadReceiptDigest",
  CASE WHEN "current_head"."updated_at" IS NULL THEN NULL ELSE "pg_catalog"."to_char"(
    "current_head"."updated_at" AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  ) END AS "currentHeadUpdatedAt",
  "effective_anchor"."head_matches_anchor" AS "headMatchesAnchor",
  "anchor_receipt"."receipt_count" AS "anchorReceiptCount",
  "anchor_receipt"."timestamp_matches" AS "headTimestampMatchesAnchorReceipt",
  (
    "current_execution"."execution_count" = 1
    AND "current_head"."head_count" = 1
    AND "current_execution"."updated_at" = "current_head"."updated_at"
  ) AS "executionTimestampMatchesHead",
  "page_summary"."candidate_count" AS "pageCandidateCount",
  "page_summary"."receipt_count" AS "pageReceiptCount",
  "page_summary"."first_revision"::"pg_catalog"."int4" AS "pageFirstRevision",
  "page_summary"."last_revision"::"pg_catalog"."int4" AS "pageLastRevision",
  "page_facts"."page_contiguous" AS "pageContiguous",
  "page_facts"."page_links_valid" AS "pageLinksValid",
  "page_facts"."receipt_zero_matches_candidate" AS "receiptZeroMatchesCandidate",
  ("page_summary"."candidate_count" = 5) AS "hasMore",
  "page_json"."receipts" AS "receipts",
  "reconciliation"."transactionReadOnly" AS "transactionReadOnly",
  "reconciliation"."installMarkerDigest" AS "installMarkerDigest",
  "reconciliation"."serverVersionNum" AS "serverVersionNum",
  "reconciliation"."snapshotDigest" AS "snapshotDigest",
  "reconciliation"."observedAt" AS "observedAt"
FROM "reconciliation"
CROSS JOIN "page_input"
CROSS JOIN "current_execution"
CROSS JOIN "current_head"
CROSS JOIN "effective_anchor"
CROSS JOIN "anchor_receipt"
CROSS JOIN "page_summary"
CROSS JOIN "page_facts"
CROSS JOIN "reconciliation_json"
CROSS JOIN "page_json"
CROSS JOIN "classification";
`

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY = Object.freeze({
  queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
  queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  query: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
  parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
  pageSize: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
  lookaheadSize: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
  statementCount: 1 as const,
  accessMode: 'read-only' as const,
  snapshotScope: 'single-statement' as const
})

function requireReconciliationReview(value: unknown): Readonly<{
  envelope: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  context: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  const envelope = value as SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  const context = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(envelope)
  if (!context || context.envelope !== envelope) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-proof-invalid')
  }
  return Object.freeze({ envelope, context })
}

function requireStaticSqlSafetyCertificate(value: unknown): Readonly<{
  envelope: SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
  context: TrustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1
}> {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-v2-chain-first-page-input-invalid')
  }
  const envelope = value as SupabaseBackfillReadQueryIndirectExecutionSafetyCertificateEnvelopeV1
  const context =
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(envelope)
  if (!context || context.envelope !== envelope) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-proof-invalid')
  }
  return Object.freeze({ envelope, context })
}

async function requireCurrentReconciliationReview(
  envelope: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
): Promise<CurrentReconciliationBindingsV1> {
  const review = envelope.review
  const runtime = review as ReconciliationRuntimeViewV1
  const casEnvelope = context.casContext.envelope
  const casReview = casEnvelope.review
  const [
    reviewDigest,
    reconciliationSqlDigest,
    reconciliationQueryDigest,
    sourceParameterSchemaDigest,
    sourceParameterValuesDigest
  ] = await Promise.all([
    digest(review),
    digestSql(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    digest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY),
    digest(review.parameters.schema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
        values: context.parameters
      })
    )
  ])
  const currentContext = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(envelope)
  const scopeDigest = casReview.bindings.scopeDigest
  const expectedReceiptZeroDigest = casReview.bindings.receiptDigest
  if (
    currentContext !== context ||
    context.envelope !== envelope ||
    context.parameters !== context.casContext.parameters ||
    runtime.format !== 'openpencil.supabase-backfill-receipt-zero-reconciliation-review.v1' ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environmentIntent !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.reviewOnly !== true ||
    runtime.applyAvailable !== false ||
    runtime.releaseReady !== false ||
    runtime.databaseLedgerBound !== false ||
    runtime.reconciliationAuthorityCreated !== false ||
    runtime.databaseAuthorityCreated !== false ||
    runtime.mutationAuthorityCreated !== false ||
    runtime.executionAuthorityCreated !== false ||
    runtime.receiptAuthorityCreated !== false ||
    runtime.query.queryId !== 'backfill-receipt-zero-reconciliation' ||
    runtime.query.queryVersion !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION ||
    runtime.query.accessMode !== 'read-only' ||
    runtime.query.snapshotScope !== 'single-statement' ||
    runtime.query.statementCount !== 1 ||
    runtime.query.responseFields !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS ||
    runtime.query.staticSqlSafetyCertificateCreated !== true ||
    runtime.query.staticSqlSafetyProfile !==
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE ||
    runtime.query.staticSqlSafetyConditionalOnly !== true ||
    runtime.query.liveIndirectExecutionSafetyAuthenticated !== false ||
    runtime.query.indirectExecutionSafetyProven !== false ||
    runtime.query.requiresFullLiveTypeOperatorIndexGuardBeforeDispatch !== true ||
    runtime.query.hostTransportCreated !== false ||
    runtime.parameters.order !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER ||
    runtime.parameters.valueCount !== 28 ||
    runtime.parameters.valuesExposed !== false ||
    runtime.parameters.schema !== casReview.parameters.schema ||
    context.parameters.length !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    context.parameters[8] !== scopeDigest ||
    context.parameters[25] !== expectedReceiptZeroDigest ||
    envelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL ||
    reviewDigest !== envelope.reviewDigest ||
    review.bindings.casReviewDigest !== casEnvelope.reviewDigest ||
    review.bindings.receiptZeroReviewDigest !== casReview.bindings.receiptZeroReviewDigest ||
    review.bindings.casTransactionSqlDigest !== casReview.bindings.transactionSqlDigest ||
    review.bindings.staticSqlSafetyCertificateDigest !==
      context.staticSqlSafetyContext.envelope.certificateDigest ||
    reconciliationSqlDigest !== review.bindings.reconciliationSqlDigest ||
    reconciliationQueryDigest !== review.bindings.reconciliationQueryDigest ||
    sourceParameterSchemaDigest !== review.bindings.parameterSchemaDigest ||
    sourceParameterSchemaDigest !== casReview.bindings.parameterSchemaDigest ||
    sourceParameterValuesDigest !== review.bindings.parameterValuesDigest ||
    sourceParameterValuesDigest !== casReview.bindings.parameterValuesDigest ||
    runtime.catalogGuard.fullCatalogVerificationIncludedInStatement !== true ||
    runtime.catalogGuard.exactColumnInventoryComparisonIncludedInStatement !== true ||
    runtime.catalogGuard.exactConstraintIndexOperatorInventoryComparisonIncludedInStatement !==
      true ||
    runtime.catalogGuard.aclAndUnexpectedObjectCounterChecksIncludedInStatement !== true ||
    !DIGEST.test(review.bindings.expectedColumnInventoryDigest) ||
    !DIGEST.test(review.bindings.expectedConstraintInventoryDigest) ||
    !DIGEST.test(scopeDigest) ||
    !DIGEST.test(expectedReceiptZeroDigest) ||
    !DIGEST.test(review.bindings.ledgerShapeDigest) ||
    !DIGEST.test(review.bindings.historicalInstallMarkerDigest)
  ) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-review-changed')
  }
  return Object.freeze({
    reconciliationReviewDigest: envelope.reviewDigest,
    reconciliationSqlDigest,
    reconciliationQueryDigest,
    sourceParameterSchemaDigest,
    sourceParameterValuesDigest,
    expectedColumnInventoryDigest: review.bindings.expectedColumnInventoryDigest,
    expectedConstraintInventoryDigest: review.bindings.expectedConstraintInventoryDigest,
    scopeDigest,
    expectedReceiptZeroDigest,
    ledgerShapeDigest: review.bindings.ledgerShapeDigest,
    historicalInstallMarkerDigest: review.bindings.historicalInstallMarkerDigest
  })
}

function pageParameterSchema(
  source: readonly SupabaseBackfillReceiptZeroCASParameterV1[]
): readonly SupabaseBackfillReceiptV2ChainPageParameterV1[] {
  return Object.freeze([...source, ...ADDED_PARAMETER_SCHEMA])
}

function firstPageParameterValues(source: readonly ParameterValue[]): readonly ParameterValue[] {
  return Object.freeze([...source, ...FIRST_PAGE_PARAMETER_SUFFIX])
}

/** Build a deterministic testing-only first-page query review. No query is dispatched. */
export async function createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1(
  input: CreateSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingOptionsV1
): Promise<SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1> {
  const source = exactInput(input)
  const proof = requireReconciliationReview(ownData(source, 'reconciliationReview'))
  const staticSqlSafetyProof = requireStaticSqlSafetyCertificate(
    ownData(source, 'staticSqlSafetyCertificate')
  )
  const sourceBindings = await requireCurrentReconciliationReview(proof.envelope, proof.context)
  const { ledgerShapeDigest, ...pageSourceBindings } = sourceBindings
  const parameterSchema = pageParameterSchema(proof.envelope.review.parameters.schema)
  const parameterValues = firstPageParameterValues(proof.context.parameters)
  if (
    parameterSchema.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length ||
    parameterValues.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length ||
    !parameterSchema.every(
      (entry, index) =>
        entry.position === index + 1 &&
        entry.name === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER[index]
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-review-changed')
  }
  let pageRequestSizeCertificate: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1>
  >
  try {
    pageRequestSizeCertificate =
      await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(parameterValues)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-first-page-transport-size-binding-mismatch')
  }
  const [
    pageSqlDigest,
    pageQueryDigest,
    pageQueryContractDigest,
    pageParameterSchemaDigest,
    pageParameterValuesDigest,
    pageStaticSqlSafetyCertificateDigest,
    pageTransportSizeCertificateDigest,
    pageRequestSizeCertificateDigest
  ] = await Promise.all([
    digestSql(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-read-query-contract.v1' as const,
        version: 1 as const,
        queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
        queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
        parameterOrder: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS
      })
    ),
    digest(parameterSchema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-page-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        values: parameterValues
      })
    ),
    digest(staticSqlSafetyProof.envelope.certificate),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1),
    digest(pageRequestSizeCertificate)
  ])
  const staticSqlSafetyCertificate = staticSqlSafetyProof.envelope.certificate
  const staticSqlSafetyRuntime: StaticSqlSafetyRuntimeViewV1 = staticSqlSafetyCertificate
  const staticSqlSafetyContext = staticSqlSafetyProof.context
  const transportSizeReview = Object.freeze({
    limits: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
    request: pageRequestSizeCertificate,
    localRequestAndResponseBoundsCertified: true as const,
    decodedAggregateBoundCertified: true as const,
    productionResponseProvenanceAuthenticated: false as const,
    productionTransportAuthenticated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const
  }) satisfies SupabaseBackfillReceiptV2ChainTransportSizeReviewV1
  if (
    !verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1
    ) ||
    pageRequestSizeCertificate.limitsCertificateDigest !== pageTransportSizeCertificateDigest ||
    !(await verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
      parameterValues,
      pageRequestSizeCertificate
    ))
  ) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-transport-size-binding-mismatch')
  }
  if (
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      staticSqlSafetyProof.envelope
    ) !== staticSqlSafetyContext ||
    pageStaticSqlSafetyCertificateDigest !== staticSqlSafetyProof.envelope.certificateDigest ||
    staticSqlSafetyContext.queryId !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID ||
    staticSqlSafetyContext.queryVersion !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION ||
    staticSqlSafetyContext.sql !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL ||
    staticSqlSafetyContext.parameterOrder.length !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length ||
    !staticSqlSafetyContext.parameterOrder.every(
      (name, index) => name === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER[index]
    ) ||
    staticSqlSafetyContext.responseFields.length !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS.length ||
    !staticSqlSafetyContext.responseFields.every(
      (name, index) => name === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS[index]
    ) ||
    staticSqlSafetyContext.managedRelations.length !==
      SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS.length ||
    !staticSqlSafetyContext.managedRelations.every(
      (name, index) => name === SUPABASE_BACKFILL_READ_QUERY_MANAGED_RELATIONS[index]
    ) ||
    staticSqlSafetyCertificate.subject.queryId !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID ||
    staticSqlSafetyCertificate.subject.queryVersion !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION ||
    staticSqlSafetyCertificate.subject.sqlByteLength !==
      new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL).byteLength ||
    staticSqlSafetyCertificate.subject.parameterCount !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length ||
    staticSqlSafetyCertificate.subject.responseFieldCount !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS.length ||
    staticSqlSafetyCertificate.bindings.queryDigest !== pageQueryDigest ||
    staticSqlSafetyCertificate.bindings.sqlDigest !== pageSqlDigest ||
    staticSqlSafetyCertificate.bindings.queryContractDigest !== pageQueryContractDigest ||
    staticSqlSafetyCertificate.bindings.ledgerShapeDigest !== ledgerShapeDigest ||
    staticSqlSafetyCertificate.bindings.expectedColumnInventoryDigest !==
      sourceBindings.expectedColumnInventoryDigest ||
    staticSqlSafetyCertificate.bindings.expectedConstraintInventoryDigest !==
      sourceBindings.expectedConstraintInventoryDigest ||
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
    return fail('supabase-backfill-receipt-v2-chain-first-page-static-sql-safety-binding-mismatch')
  }
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    databaseLedgerBound: false as const,
    chainVerificationAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      ...pageSourceBindings,
      pageParameterSchemaDigest,
      pageParameterValuesDigest,
      pageSqlDigest,
      pageQueryDigest,
      pageStaticSqlSafetyCertificateDigest,
      pageTransportSizeCertificateDigest,
      pageRequestSizeCertificateDigest
    }),
    query: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      statementCount: 1 as const,
      responseShape: 'one-row-anchor-bound-bounded-receipt-page' as const,
      responseFields: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
      embedsReconciliationQueryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      hostMustRecomputeStatusFromFacts: true as const,
      dmlAllowed: false as const,
      rowLocksUsed: false as const,
      schemaMutationAllowed: false as const,
      staticSqlSafetyCertificateCreated: true as const,
      staticSqlSafetyProfile: SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE,
      staticSqlSafetyConditionalOnly: true as const,
      liveIndirectExecutionSafetyAuthenticated: false as const,
      indirectExecutionSafetyProven: false as const,
      requiresTransportEnforcedReadOnlyBoundary: true as const,
      requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: true as const,
      requiresBoundedStatementTimeoutBeforeDispatch: true as const,
      managementReadOnlyEndpointSemanticallyCompatible: false as const,
      boundedIntegerResponseWireType: 'int4' as const,
      internalRevisionArithmeticType: 'int8' as const,
      bigintJSONNumberDependency: false as const,
      transportSizeCertificateCreated: true as const,
      fixedQueryRequestSizeCertified: true as const,
      responseSizeUpperBoundCertified: true as const,
      decodedAggregateUpperBoundCertified: true as const,
      hostTransportCreated: false as const
    }),
    parameters: Object.freeze({
      order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
      schema: parameterSchema,
      valueCount: 33 as const,
      valuesExposed: false as const,
      reusedReceiptZeroCASPrefixCount: 28 as const,
      modeDerivedFromParameterSuffix: true as const,
      firstPageAfterRevision: 0 as const,
      firstPageAnchorValuesAreNull: true as const
    }),
    catalogGuard: Object.freeze({
      inheritedReconciliationStatementEmbedded: true as const,
      evaluatesInSameStatementSnapshotWhenDispatched: true as const,
      fullCatalogVerificationPerformed: false as const,
      fullCatalogVerificationIncludedInStatement: true as const,
      exactColumnInventoryComparisonIncludedInStatement: true as const,
      exactConstraintIndexOperatorInventoryComparisonIncludedInStatement: true as const,
      aclAndUnexpectedObjectCounterChecksIncludedInStatement: true as const,
      historicalInstallMarkerDigestReturned: true as const
    }),
    page: Object.freeze({
      kind: 'first' as const,
      afterRevision: 0 as const,
      maximumReceiptCount: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
      lookaheadReceiptCount: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
      keysetOrder: 'revision-ascending' as const,
      currentHeadCapturedInSameStatement: true as const,
      fixedQueryAlsoSupportsAnchorBoundContinuation: true as const,
      anchorFields: Object.freeze(['revision', 'eventId', 'receiptDigest', 'updatedAt'] as const),
      continuationMustBindExactAnchor: true as const,
      staleAnchorReanchoredAutomatically: false as const,
      crossPageSingleSnapshotClaimed: false as const,
      canonicalReceiptEncoding: 'standard-base64-without-whitespace' as const,
      maximumCanonicalReceiptBytesEach: SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES,
      maximumBase64CharactersEach: SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT,
      maximumBase64CharactersPerPage: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS
    }),
    transportSize: transportSizeReview,
    policy: Object.freeze({
      previewContainsPlaceholdersOnly: true as const,
      canonicalValuesKeptInTrustedContextOnly: true as const,
      requestDispatched: false as const,
      managedDataReadPerformed: false as const,
      productionResponseAuthenticated: false as const,
      responseParserCreated: true as const,
      boundedResponseWireDecoderCreated: true as const,
      localRequestAndResponseBoundsCertified: true as const,
      continuationCreated: false as const,
      fullPortableReceiptV2ChainVerified: false as const,
      headFreshnessAuthenticatedAcrossPages: false as const,
      mutationDispatched: false as const,
      captureConsumed: false as const,
      credentialAuthorityCreated: false as const,
      transportAuthorityCreated: false as const,
      databaseAuthorityCreated: false as const,
      releaseAuthorityCreated: false as const,
      automaticRetryAllowed: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_ARTIFACT_PATH,
      kind: 'receipt-v2-chain-page-read-only-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL).byteLength,
      digest: pageSqlDigest,
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
  }) satisfies SupabaseBackfillReceiptV2ChainFirstPageReviewV1
  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL
  })
  if (
    trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(proof.envelope) !==
      proof.context ||
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      staticSqlSafetyProof.envelope
    ) !== staticSqlSafetyContext
  ) {
    return fail('supabase-backfill-receipt-v2-chain-first-page-proof-invalid')
  }
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      reconciliationContext: proof.context,
      staticSqlSafetyContext,
      sourceParameters: proof.context.parameters,
      parameters: parameterValues
    })
  )
  return envelope
}

/** Identity-only lookup; no query, credential, Receipt, or continuation authority is returned. */
export function trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (
    !context ||
    context.envelope !== value ||
    trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(
      context.reconciliationContext.envelope
    ) !== context.reconciliationContext ||
    trustedSupabaseBackfillReadQueryIndirectExecutionSafetyCertificateContextV1(
      context.staticSqlSafetyContext.envelope
    ) !== context.staticSqlSafetyContext
  ) {
    return null
  }
  return context
}
