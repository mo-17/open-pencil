/* oxlint-disable eslint(max-lines), eslint(complexity) -- Strict response decoding, canonical Receipt binding, and fail-closed page classification form one audit boundary. */

import {
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  digestBackendBackfillExecutionScopeV2,
  digestBackendBackfillExecutionReceiptV2,
  parseBackendBackfillExecutionReceiptV2,
  type BackendBackfillExecutionReceiptV2
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE } from '@/app/plugins/host/deployment/supabase/backfill/read-query-indirect-execution-safety'
import {
  SupabaseBackfillReceiptZeroReconciliationResponseError,
  parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1,
  type SupabaseBackfillReceiptZeroReconciliationObservationV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/response'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES,
  type SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/zero/reconciliation/review'

import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT,
  SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES,
  createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1,
  trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1,
  type SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
} from './review'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
  certifySupabaseBackfillReceiptV2ChainResponseSizeV1,
  parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1,
  verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1,
  type SupabaseBackfillReceiptV2ChainResponseSizeV1
} from './transport-size-certificate'

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_OBSERVATION_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-first-page-observation.v1' as const

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RECEIPT_FIELDS = Object.freeze([
  'revision',
  'eventId',
  'receiptId',
  'idempotencyKey',
  'requestDigest',
  'receiptDigest',
  'previousRevision',
  'previousEventId',
  'previousReceiptDigest',
  'checkpointKind',
  'canonicalReceiptBase64',
  'canonicalReceiptByteLength',
  'committedAt'
] as const)

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESULT_STATES = Object.freeze([
  'page-ready',
  'chain-complete',
  'anchor-stale',
  'corruption',
  'precondition-failed'
] as const)

const INPUT_KEYS = ['pageReview', 'response'] as const
const PAGE_MODES = new Set<SupabaseBackfillReceiptV2ChainPageModeV1>([
  'first',
  'continuation',
  'invalid'
])
const PAGE_STATES = new Set<SupabaseBackfillReceiptV2ChainPageStateV1>(
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESULT_STATES
)
const RECONCILIATION_STATES = new Set<SupabaseBackfillReceiptZeroReconciliationStateV1>(
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES
)
const EXECUTION_STATUSES = new Set<SupabaseBackfillExecutionStatusV1>([
  'running',
  'completed',
  'failed'
])
const CHECKPOINT_KINDS = new Set<BackendBackfillExecutionReceiptV2['checkpointKind']>([
  'capture',
  'batch',
  'failure'
])
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const STANDARD_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u
const RFC3339 = /^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,9}))?Z$/u
const RFC3339_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const RFC3339_MICROSECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u
const SUPPORTED_SERVER_VERSION = /^(?:15|16|17)[0-9]{4}$/u

export type SupabaseBackfillReceiptV2ChainPageModeV1 = 'first' | 'continuation' | 'invalid'
export type SupabaseBackfillReceiptV2ChainPageStateV1 =
  (typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESULT_STATES)[number]
type SupabaseBackfillReceiptZeroReconciliationStateV1 =
  (typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESULT_STATES)[number]
type SupabaseBackfillExecutionStatusV1 = 'running' | 'completed' | 'failed'

export interface ParseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingOptionsV1 {
  readonly pageReview: SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1
  readonly response: unknown
}

export interface SupabaseBackfillReceiptV2ChainPageAnchorV1 {
  readonly revision: number | null
  readonly eventId: string | null
  readonly receiptDigest: string | null
  readonly updatedAt: string | null
}

export interface SupabaseBackfillReceiptV2ChainPageReceiptSummaryV1 {
  readonly revision: number
  readonly eventId: string
  readonly receiptId: string
  readonly receiptDigest: string
  readonly checkpointKind: BackendBackfillExecutionReceiptV2['checkpointKind']
  readonly canonicalReceiptByteLength: number
  readonly committedAt: string
}

export interface SupabaseBackfillReceiptV2ChainPageFactsV1 {
  readonly inputValid: boolean
  readonly runtimeReady: boolean
  readonly fullLedgerShapeVerified: boolean
  readonly exactImmutableExecutionCount: number
  readonly currentExecutionCount: number
  readonly exactReceiptZeroCount: number
  readonly executionStatus: SupabaseBackfillExecutionStatusV1 | null
  readonly receiptCount: number
  readonly minimumReceiptRevision: number | null
  readonly maximumReceiptRevision: number | null
  readonly headCount: number
  readonly currentHeadRevision: number | null
  readonly currentHeadEventId: string | null
  readonly currentHeadReceiptDigest: string | null
  readonly currentHeadUpdatedAt: string | null
  readonly headMatchesAnchor: boolean
  readonly anchorReceiptCount: number
  readonly headTimestampMatchesAnchorReceipt: boolean
  readonly executionTimestampMatchesHead: boolean
  readonly pageCandidateCount: number
  readonly pageReceiptCount: number
  readonly pageFirstRevision: number | null
  readonly pageLastRevision: number | null
  readonly pageContiguous: boolean
  readonly pageLinksValid: boolean
  readonly receiptZeroMatchesCandidate: boolean
  readonly hasMore: boolean
}

/**
 * Sanitized testing observation. Canonical Receipt bytes remain process-local, and an injected
 * response never creates transport, database, execution, Receipt, continuation, or release authority.
 */
export interface SupabaseBackfillReceiptV2ChainFirstPageObservationV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_OBSERVATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly pageMode: 'first'
  readonly reportedStatus: SupabaseBackfillReceiptV2ChainPageStateV1
  readonly status: SupabaseBackfillReceiptV2ChainPageStateV1
  readonly reconciliation: Readonly<{
    reportedStatus: SupabaseBackfillReceiptZeroReconciliationStateV1
    status: SupabaseBackfillReceiptZeroReconciliationStateV1
    reportedStatusMatchesRecomputedFacts: true
  }>
  readonly bindings: Readonly<{
    pageReviewDigest: string
    pageQueryDigest: string
    pageSqlDigest: string
    pageParameterSchemaDigest: string
    pageParameterValuesDigest: string
    reconciliationReviewDigest: string
    reconciliationResponseDigest: string
    scopeDigest: string
    expectedReceiptZeroDigest: string
    historicalInstallMarkerDigest: string
    observedInstallMarkerDigest: string | null
    responseDigest: string
  }>
  readonly afterRevision: 0
  readonly anchor: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>
  readonly currentHead: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>
  readonly facts: Readonly<SupabaseBackfillReceiptV2ChainPageFactsV1>
  readonly receipts: readonly Readonly<SupabaseBackfillReceiptV2ChainPageReceiptSummaryV1>[]
  readonly snapshot: Readonly<{
    transactionReadOnly: boolean
    serverVersionNum: string
    snapshotDigest: string
    observedAt: string
  }>
  readonly reportedStatusMatchesRecomputedFacts: true
  readonly statusRecomputedByHost: true
  readonly completeEmbeddedReconciliationRecomputedByHost: true
  readonly canonicalReceiptPayloadsVerified: true
  readonly pageRowsBoundToCanonicalReceipts: true
  readonly reportedInstallMarkerDigestMatchesHistorical: boolean
  readonly specificHistoricalInstallationAuthenticated: false
  readonly reportedStatusProvesDatabaseState: false
  readonly statusProvesDatabaseState: false
  readonly productionTransportAuthenticated: false
  readonly fullPortableReceiptV2ChainVerified: false
  readonly continuationReviewCreated: false
  readonly crossPageHeadFreshnessAuthenticated: false
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

export interface TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1 {
  readonly observation: SupabaseBackfillReceiptV2ChainFirstPageObservationV1
  readonly reviewContext: TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
  readonly receipts: readonly BackendBackfillExecutionReceiptV2[]
}

/**
 * Process-local expectations supplied only after a page review's WeakMap provenance is checked.
 * The shared decoder does not mint observation or continuation authority from this value.
 */
export interface SupabaseBackfillReceiptV2ChainPageParseExpectationV1 {
  readonly pageMode: Exclude<SupabaseBackfillReceiptV2ChainPageModeV1, 'invalid'>
  readonly afterRevision: number
  readonly anchor: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1> | null
  readonly priorReceipt: Readonly<{
    revision: number
    eventId: string
    receiptDigest: string
  }> | null
  readonly reconciliationReview: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly scopeDigest: string
  readonly expectedReceiptZeroDigest: string
  readonly historicalInstallMarkerDigest: string
  readonly executionId: string
  readonly receiptZero: Readonly<{
    eventId: string
    receiptId: string
    idempotencyKey: string
    requestDigest: string
    receiptDigest: string
    canonicalReceiptBase64: string
  }>
}

/** Strict decoded page data. Only the owning review parser may register it as process-local proof. */
export interface SupabaseBackfillReceiptV2ChainDecodedPageV1 {
  readonly pageMode: Exclude<SupabaseBackfillReceiptV2ChainPageModeV1, 'invalid'>
  readonly reportedStatus: SupabaseBackfillReceiptV2ChainPageStateV1
  readonly status: SupabaseBackfillReceiptV2ChainPageStateV1
  readonly reconciliation: SupabaseBackfillReceiptZeroReconciliationObservationV1
  readonly afterRevision: number
  readonly anchor: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>
  readonly currentHead: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>
  readonly facts: Readonly<SupabaseBackfillReceiptV2ChainPageFactsV1>
  readonly receipts: readonly Readonly<SupabaseBackfillReceiptV2ChainPageReceiptSummaryV1>[]
  readonly canonicalReceipts: readonly BackendBackfillExecutionReceiptV2[]
  readonly snapshot: SupabaseBackfillReceiptV2ChainFirstPageObservationV1['snapshot']
  readonly installMarkerDigest: string | null
  readonly reportedInstallMarkerDigestMatchesHistorical: boolean
  readonly responseDigest: string
}

export type SupabaseBackfillReceiptV2ChainPageResponseErrorCode =
  | 'supabase-backfill-receipt-v2-chain-page-response-input-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-response-proof-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-response-review-changed'
  | 'supabase-backfill-receipt-v2-chain-page-response-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-response-binding-mismatch'
  | 'supabase-backfill-receipt-v2-chain-page-response-receipt-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-response-digest-failed'

export class SupabaseBackfillReceiptV2ChainPageResponseError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode) {
    super(`Supabase backfill Receipt V2 chain page response failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ChainPageResponseError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ParsedReceiptRowV1 {
  readonly revision: number
  readonly eventId: string
  readonly receiptId: string
  readonly idempotencyKey: string
  readonly requestDigest: string
  readonly receiptDigest: string
  readonly previousRevision: number | null
  readonly previousEventId: string | null
  readonly previousReceiptDigest: string | null
  readonly checkpointKind: BackendBackfillExecutionReceiptV2['checkpointKind']
  readonly canonicalReceiptBase64: string
  readonly canonicalReceiptByteLength: number
  readonly committedAt: string
  readonly receipt: BackendBackfillExecutionReceiptV2
  readonly canonicalRow: Readonly<Record<string, unknown>>
}

interface ParsedPageResponseV1 {
  readonly queryVersion: string
  readonly pageMode: SupabaseBackfillReceiptV2ChainPageModeV1
  readonly scopeDigest: string
  readonly afterRevision: number
  readonly pageSize: number
  readonly anchor: SupabaseBackfillReceiptV2ChainPageAnchorV1
  readonly reportedStatus: SupabaseBackfillReceiptV2ChainPageStateV1
  readonly reconciliationReportedStatus: SupabaseBackfillReceiptZeroReconciliationStateV1
  readonly reconciliationResponse: UnknownRecord
  readonly facts: SupabaseBackfillReceiptV2ChainPageFactsV1
  readonly receiptRows: readonly ParsedReceiptRowV1[]
  readonly base64PayloadCharacterCount: number
  readonly snapshot: SupabaseBackfillReceiptV2ChainFirstPageObservationV1['snapshot']
  readonly installMarkerDigest: string | null
  readonly canonicalResponse: readonly Readonly<Record<string, unknown>>[]
}

export interface CurrentPageReviewBindingsV1 extends SupabaseBackfillReceiptV2ChainPageParseExpectationV1 {
  readonly pageReviewDigest: string
  readonly pageQueryDigest: string
  readonly pageSqlDigest: string
  readonly pageParameterSchemaDigest: string
  readonly pageParameterValuesDigest: string
  readonly reconciliationReviewDigest: string
  readonly scopeDigest: string
  readonly expectedReceiptZeroDigest: string
  readonly historicalInstallMarkerDigest: string
  readonly executionId: string
  readonly receiptZero: Readonly<{
    eventId: string
    receiptId: string
    idempotencyKey: string
    requestDigest: string
    receiptDigest: string
    canonicalReceiptBase64: string
  }>
}

interface PageReviewRuntimeViewV1 {
  readonly format: unknown
  readonly version: unknown
  readonly providerId: unknown
  readonly environmentIntent: unknown
  readonly testingOnly: unknown
  readonly reviewOnly: unknown
  readonly applyAvailable: unknown
  readonly releaseReady: unknown
  readonly databaseLedgerBound: unknown
  readonly chainVerificationAuthorityCreated: unknown
  readonly databaseAuthorityCreated: unknown
  readonly mutationAuthorityCreated: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly bindings: Readonly<{
    pageTransportSizeCertificateDigest: unknown
    pageRequestSizeCertificateDigest: unknown
  }>
  readonly query: Readonly<{
    queryVersion: unknown
    responseFields: unknown
    hostMustRecomputeStatusFromFacts: unknown
    staticSqlSafetyCertificateCreated: unknown
    staticSqlSafetyProfile: unknown
    staticSqlSafetyConditionalOnly: unknown
    liveIndirectExecutionSafetyAuthenticated: unknown
    indirectExecutionSafetyProven: unknown
    requiresFullLiveTypeOperatorIndexGuardBeforeDispatch: unknown
    transportSizeCertificateCreated: unknown
    fixedQueryRequestSizeCertified: unknown
    responseSizeUpperBoundCertified: unknown
    decodedAggregateUpperBoundCertified: unknown
    hostTransportCreated: unknown
  }>
  readonly parameters: Readonly<{
    order: unknown
    valueCount: unknown
    valuesExposed: unknown
  }>
  readonly policy: Readonly<{
    responseParserCreated: unknown
    requestDispatched: unknown
    productionResponseAuthenticated: unknown
    continuationCreated: unknown
    fullPortableReceiptV2ChainVerified: unknown
    boundedResponseWireDecoderCreated: unknown
    localRequestAndResponseBoundsCertified: unknown
  }>
  readonly transportSize: Readonly<{
    limits: unknown
    request: unknown
    localRequestAndResponseBoundsCertified: unknown
    decodedAggregateBoundCertified: unknown
    productionResponseProvenanceAuthenticated: unknown
    productionTransportAuthenticated: unknown
    transportAuthorityCreated: unknown
    databaseAuthorityCreated: unknown
    releaseAuthorityCreated: unknown
  }>
}

const trustedObservations = new WeakMap<
  object,
  TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
>()

function fail(code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode): never {
  throw new SupabaseBackfillReceiptV2ChainPageResponseError(code)
}

function ownKeys(
  value: object,
  code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode
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
  code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode
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
  code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode
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

function exactArray(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
  code: SupabaseBackfillReceiptV2ChainPageResponseErrorCode
): readonly unknown[] {
  let prototype: object | null
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    if (!Array.isArray(value)) return fail(code)
    prototype = Object.getPrototypeOf(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail(code)
  }
  if (
    prototype !== Array.prototype ||
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < minimumLength ||
    lengthDescriptor.value > maximumLength
  ) {
    return fail(code)
  }
  const length = lengthDescriptor.value as number
  const keys = ownKeys(value, code)
  const expectedKeys = Array.from({ length }, (_, index) => String(index))
  if (
    keys.length !== length + 1 ||
    !keys.includes('length') ||
    expectedKeys.some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof key !== 'string' || (key !== 'length' && !expectedKeys.includes(key)))
  ) {
    return fail(code)
  }
  return Object.freeze(expectedKeys.map((key) => ownData(value, key, code)))
}

function exactInput(value: unknown): UnknownRecord {
  return exactPlainRecord(
    value,
    INPUT_KEYS,
    'supabase-backfill-receipt-v2-chain-page-response-input-invalid'
  )
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
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
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return value as number
}

function nullableInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (value === null) return null
  return integer(value, minimum, maximum)
}

function stringValue(value: unknown, maximumLength = 256): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.trim() !== value
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return value
}

function identifierValue(value: unknown): string {
  const parsed = stringValue(value)
  if (!IDENTIFIER.test(parsed)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return parsed
}

function nullableIdentifier(value: unknown): string | null {
  if (value === null) return null
  return identifierValue(value)
}

function digestValue(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return value
}

function nullableDigest(value: unknown): string | null {
  if (value === null) return null
  return digestValue(value)
}

function oneOf<T extends string>(value: unknown, values: ReadonlySet<T>): T {
  if (typeof value !== 'string' || !values.has(value as T)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return value as T
}

function timestampNanoseconds(value: string): bigint {
  const match = RFC3339.exec(value)
  const calendar = match?.[1]
  const time = match?.[2]
  const calendarDate = calendar ? new Date(`${calendar}T00:00:00.000Z`) : undefined
  if (
    !calendar ||
    !time ||
    !calendarDate ||
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== calendar ||
    !Number.isFinite(Date.parse(value))
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  const epochMilliseconds = Date.parse(`${calendar}T${time}Z`)
  const fractionalNanoseconds = BigInt((match[3] ?? '').padEnd(9, '0'))
  return BigInt(epochMilliseconds / 1_000) * 1_000_000_000n + fractionalNanoseconds
}

function canonicalMillisecondTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC3339_MILLISECONDS.test(value)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  timestampNanoseconds(value)
  if (new Date(value).toISOString() !== value) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return value
}

function postgresMicrosecondTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC3339_MICROSECONDS.test(value)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  timestampNanoseconds(value)
  return value
}

function nullablePostgresTimestamp(value: unknown): string | null {
  if (value === null) return null
  return postgresMicrosecondTimestamp(value)
}

function decodeCanonicalBase64(value: unknown, expectedByteLength: number): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > SUPABASE_BACKFILL_RECEIPT_V2_MAX_BASE64_CHARACTERS_PER_RECEIPT ||
    value.length !== 4 * Math.ceil(expectedByteLength / 3) ||
    value.length % 4 !== 0 ||
    !STANDARD_BASE64.test(value)
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  let binary: string
  try {
    binary = atob(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  if (btoa(binary) !== value || binary.length !== expectedByteLength) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function parseReceiptRow(value: unknown): ParsedReceiptRowV1 {
  const code = 'supabase-backfill-receipt-v2-chain-page-response-invalid' as const
  const row = exactPlainRecord(value, SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RECEIPT_FIELDS, code)
  const revision = integer(ownData(row, 'revision', code), 1, 10_000)
  const eventId = identifierValue(ownData(row, 'eventId', code))
  const receiptId = identifierValue(ownData(row, 'receiptId', code))
  const idempotencyKey = identifierValue(ownData(row, 'idempotencyKey', code))
  const requestDigest = digestValue(ownData(row, 'requestDigest', code))
  const receiptDigest = digestValue(ownData(row, 'receiptDigest', code))
  const previousRevision = nullableInteger(ownData(row, 'previousRevision', code), 1, 9_999)
  const previousEventId = nullableIdentifier(ownData(row, 'previousEventId', code))
  const previousReceiptDigest = nullableDigest(ownData(row, 'previousReceiptDigest', code))
  const checkpointKind = oneOf<BackendBackfillExecutionReceiptV2['checkpointKind']>(
    ownData(row, 'checkpointKind', code),
    CHECKPOINT_KINDS
  )
  const canonicalReceiptByteLength = integer(
    ownData(row, 'canonicalReceiptByteLength', code),
    2,
    SUPABASE_BACKFILL_RECEIPT_V2_MAX_CANONICAL_RECEIPT_BYTES
  )
  const canonicalReceiptBase64Value = ownData(row, 'canonicalReceiptBase64', code)
  const bytes = decodeCanonicalBase64(canonicalReceiptBase64Value, canonicalReceiptByteLength)
  const canonicalReceiptBase64 = canonicalReceiptBase64Value as string
  let decodedText: string
  let decodedJSON: unknown
  let receipt: BackendBackfillExecutionReceiptV2
  try {
    decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    decodedJSON = JSON.parse(decodedText) as unknown
    receipt = parseBackendBackfillExecutionReceiptV2(decodedJSON, '$.canonicalReceipt')
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  const canonicalBytes = canonicalBackendBackfillExecutionReceiptV2Bytes(receipt)
  if (!bytesEqual(bytes, canonicalBytes)) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  const committedAt = postgresMicrosecondTimestamp(ownData(row, 'committedAt', code))
  const canonicalRow = Object.freeze({
    revision,
    eventId,
    receiptId,
    idempotencyKey,
    requestDigest,
    receiptDigest,
    previousRevision,
    previousEventId,
    previousReceiptDigest,
    checkpointKind,
    canonicalReceiptBase64,
    canonicalReceiptByteLength,
    committedAt
  })
  return Object.freeze({
    ...canonicalRow,
    receipt,
    canonicalRow
  })
}

function exactReceiptRows(value: unknown): readonly ParsedReceiptRowV1[] {
  const code = 'supabase-backfill-receipt-v2-chain-page-response-invalid' as const
  const rows = Object.freeze(
    exactArray(value, 0, SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE, code).map(parseReceiptRow)
  )
  if (
    rows.reduce((total, row) => total + row.canonicalReceiptBase64.length, 0) >
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_MAX_BASE64_CHARACTERS
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-receipt-invalid')
  }
  return rows
}

function parseAnchor(
  revision: unknown,
  eventId: unknown,
  receiptDigest: unknown,
  updatedAt: unknown
): SupabaseBackfillReceiptV2ChainPageAnchorV1 {
  const parsedRevision = nullableInteger(revision, 1, 10_000)
  const parsedEventId = nullableIdentifier(eventId)
  const parsedReceiptDigest = nullableDigest(receiptDigest)
  const parsedUpdatedAt = nullablePostgresTimestamp(updatedAt)
  const allNull =
    parsedRevision === null &&
    parsedEventId === null &&
    parsedReceiptDigest === null &&
    parsedUpdatedAt === null
  const allPresent =
    parsedRevision !== null &&
    parsedEventId !== null &&
    parsedReceiptDigest !== null &&
    parsedUpdatedAt !== null
  if (!allNull && !allPresent) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  return Object.freeze({
    revision: parsedRevision,
    eventId: parsedEventId,
    receiptDigest: parsedReceiptDigest,
    updatedAt: parsedUpdatedAt
  })
}

function exactSingleResponse(value: unknown): ParsedPageResponseV1 {
  const code = 'supabase-backfill-receipt-v2-chain-page-response-invalid' as const
  const entries = exactArray(value, 1, 1, code)
  const row = exactPlainRecord(
    entries[0],
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS,
    code
  )
  const queryVersion = stringValue(ownData(row, 'queryVersion', code))
  const pageMode = oneOf<SupabaseBackfillReceiptV2ChainPageModeV1>(
    ownData(row, 'pageMode', code),
    PAGE_MODES
  )
  const scopeDigest = digestValue(ownData(row, 'scopeDigest', code))
  const afterRevision = integer(ownData(row, 'afterRevision', code), 0, 9_999)
  const pageSize = integer(ownData(row, 'pageSize', code), 1, 64)
  const anchor = parseAnchor(
    ownData(row, 'anchorRevision', code),
    ownData(row, 'anchorEventId', code),
    ownData(row, 'anchorReceiptDigest', code),
    ownData(row, 'anchorUpdatedAt', code)
  )
  const reportedStatus = oneOf<SupabaseBackfillReceiptV2ChainPageStateV1>(
    ownData(row, 'reportedStatus', code),
    PAGE_STATES
  )
  const reconciliationReportedStatus = oneOf<SupabaseBackfillReceiptZeroReconciliationStateV1>(
    ownData(row, 'reconciliationReportedStatus', code),
    RECONCILIATION_STATES
  )
  const reconciliationResponse = exactPlainRecord(
    ownData(row, 'reconciliationResponse', code),
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
    code
  )
  const executionStatusValue = ownData(row, 'executionStatus', code)
  const executionStatus =
    executionStatusValue === null
      ? null
      : oneOf<SupabaseBackfillExecutionStatusV1>(executionStatusValue, EXECUTION_STATUSES)
  const currentHead = parseAnchor(
    ownData(row, 'currentHeadRevision', code),
    ownData(row, 'currentHeadEventId', code),
    ownData(row, 'currentHeadReceiptDigest', code),
    ownData(row, 'currentHeadUpdatedAt', code)
  )
  const facts = Object.freeze({
    inputValid: booleanValue(ownData(row, 'inputValid', code)),
    runtimeReady: booleanValue(ownData(row, 'runtimeReady', code)),
    fullLedgerShapeVerified: booleanValue(ownData(row, 'fullLedgerShapeVerified', code)),
    exactImmutableExecutionCount: integer(ownData(row, 'exactImmutableExecutionCount', code), 0, 2),
    currentExecutionCount: integer(ownData(row, 'currentExecutionCount', code), 0, 2),
    exactReceiptZeroCount: integer(ownData(row, 'exactReceiptZeroCount', code), 0, 2),
    executionStatus,
    receiptCount: integer(ownData(row, 'receiptCount', code), 0, 10_001),
    minimumReceiptRevision: nullableInteger(
      ownData(row, 'minimumReceiptRevision', code),
      1,
      10_000
    ),
    maximumReceiptRevision: nullableInteger(
      ownData(row, 'maximumReceiptRevision', code),
      1,
      10_000
    ),
    headCount: integer(ownData(row, 'headCount', code), 0, 2),
    currentHeadRevision: currentHead.revision,
    currentHeadEventId: currentHead.eventId,
    currentHeadReceiptDigest: currentHead.receiptDigest,
    currentHeadUpdatedAt: currentHead.updatedAt,
    headMatchesAnchor: booleanValue(ownData(row, 'headMatchesAnchor', code)),
    anchorReceiptCount: integer(ownData(row, 'anchorReceiptCount', code), 0, 2),
    headTimestampMatchesAnchorReceipt: booleanValue(
      ownData(row, 'headTimestampMatchesAnchorReceipt', code)
    ),
    executionTimestampMatchesHead: booleanValue(
      ownData(row, 'executionTimestampMatchesHead', code)
    ),
    pageCandidateCount: integer(
      ownData(row, 'pageCandidateCount', code),
      0,
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE
    ),
    pageReceiptCount: integer(
      ownData(row, 'pageReceiptCount', code),
      0,
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE
    ),
    pageFirstRevision: nullableInteger(ownData(row, 'pageFirstRevision', code), 1, 10_000),
    pageLastRevision: nullableInteger(ownData(row, 'pageLastRevision', code), 1, 10_000),
    pageContiguous: booleanValue(ownData(row, 'pageContiguous', code)),
    pageLinksValid: booleanValue(ownData(row, 'pageLinksValid', code)),
    receiptZeroMatchesCandidate: booleanValue(ownData(row, 'receiptZeroMatchesCandidate', code)),
    hasMore: booleanValue(ownData(row, 'hasMore', code))
  }) satisfies SupabaseBackfillReceiptV2ChainPageFactsV1
  const receiptRows = exactReceiptRows(ownData(row, 'receipts', code))
  const base64PayloadCharacterCount = receiptRows.reduce(
    (total, entry) => total + entry.canonicalReceiptBase64.length,
    0
  )
  const transactionReadOnly = booleanValue(ownData(row, 'transactionReadOnly', code))
  const installMarkerDigest = nullableDigest(ownData(row, 'installMarkerDigest', code))
  const serverVersionNum = ownData(row, 'serverVersionNum', code)
  if (typeof serverVersionNum !== 'string' || !SUPPORTED_SERVER_VERSION.test(serverVersionNum)) {
    return fail(code)
  }
  const snapshotDigest = digestValue(ownData(row, 'snapshotDigest', code))
  const observedAt = canonicalMillisecondTimestamp(ownData(row, 'observedAt', code))
  const canonicalReceipts = Object.freeze(receiptRows.map((entry) => entry.canonicalRow))
  const canonicalRow = Object.freeze({
    ...row,
    reconciliationResponse,
    receipts: canonicalReceipts
  })
  return Object.freeze({
    queryVersion,
    pageMode,
    scopeDigest,
    afterRevision,
    pageSize,
    anchor,
    reportedStatus,
    reconciliationReportedStatus,
    reconciliationResponse,
    facts,
    receiptRows,
    base64PayloadCharacterCount,
    snapshot: Object.freeze({ transactionReadOnly, serverVersionNum, snapshotDigest, observedAt }),
    installMarkerDigest,
    canonicalResponse: Object.freeze([canonicalRow])
  })
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-digest-failed')
  }
}

/** @internal Revalidate the genuine first-page review before decoding any injected response. */
export async function requireCurrentPageReview(
  envelope: SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
): Promise<CurrentPageReviewBindingsV1> {
  let refreshed: SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1
  try {
    refreshed = await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
      reconciliationReview: context.reconciliationContext.envelope,
      staticSqlSafetyCertificate: context.staticSqlSafetyContext.envelope
    })
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
  const review = envelope.review
  const runtime = review as PageReviewRuntimeViewV1
  const [
    currentReviewDigest,
    currentQueryDigest,
    currentSqlDigest,
    currentParameterValuesDigest,
    currentTransportSizeCertificateDigest,
    currentRequestSizeCertificateDigest,
    requestSizeCertificateVerified
  ] = await Promise.all([
    digest(review),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-page-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        values: context.parameters
      })
    ),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1),
    digest(runtime.transportSize.request),
    verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
      context.parameters,
      runtime.transportSize.request
    )
  ])
  const parameters = context.parameters
  const sourceParameters = context.sourceParameters
  const executionId = parameters[0]
  const receiptZeroEventId = parameters[21]
  const receiptZeroReceiptId = parameters[22]
  const receiptZeroIdempotencyKey = parameters[23]
  const receiptZeroRequestDigest = parameters[24]
  const receiptZeroDigest = parameters[25]
  const receiptZeroBase64 = parameters[26]
  if (
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(envelope) !== context ||
    context.envelope !== envelope ||
    refreshed.reviewDigest !== envelope.reviewDigest ||
    currentReviewDigest !== envelope.reviewDigest ||
    envelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL ||
    runtime.format !== 'openpencil.supabase-backfill-receipt-v2-chain-first-page-review.v1' ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environmentIntent !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.reviewOnly !== true ||
    runtime.applyAvailable !== false ||
    runtime.releaseReady !== false ||
    runtime.databaseLedgerBound !== false ||
    runtime.chainVerificationAuthorityCreated !== false ||
    runtime.databaseAuthorityCreated !== false ||
    runtime.mutationAuthorityCreated !== false ||
    runtime.executionAuthorityCreated !== false ||
    runtime.receiptAuthorityCreated !== false ||
    runtime.query.queryVersion !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION ||
    runtime.query.responseFields !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_RESPONSE_FIELDS ||
    runtime.query.hostMustRecomputeStatusFromFacts !== true ||
    runtime.query.staticSqlSafetyCertificateCreated !== true ||
    runtime.query.staticSqlSafetyProfile !==
      SUPABASE_BACKFILL_READ_QUERY_INDIRECT_EXECUTION_SAFETY_PROFILE ||
    runtime.query.staticSqlSafetyConditionalOnly !== true ||
    runtime.query.liveIndirectExecutionSafetyAuthenticated !== false ||
    runtime.query.indirectExecutionSafetyProven !== false ||
    runtime.query.requiresFullLiveTypeOperatorIndexGuardBeforeDispatch !== true ||
    runtime.query.transportSizeCertificateCreated !== true ||
    runtime.query.fixedQueryRequestSizeCertified !== true ||
    runtime.query.responseSizeUpperBoundCertified !== true ||
    runtime.query.decodedAggregateUpperBoundCertified !== true ||
    runtime.query.hostTransportCreated !== false ||
    runtime.policy.responseParserCreated !== true ||
    runtime.policy.requestDispatched !== false ||
    runtime.policy.productionResponseAuthenticated !== false ||
    runtime.policy.continuationCreated !== false ||
    runtime.policy.fullPortableReceiptV2ChainVerified !== false ||
    runtime.policy.boundedResponseWireDecoderCreated !== true ||
    runtime.policy.localRequestAndResponseBoundsCertified !== true ||
    runtime.transportSize.localRequestAndResponseBoundsCertified !== true ||
    runtime.transportSize.decodedAggregateBoundCertified !== true ||
    runtime.transportSize.limits !==
      SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1 ||
    !verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(runtime.transportSize.limits) ||
    !requestSizeCertificateVerified ||
    runtime.transportSize.productionResponseProvenanceAuthenticated !== false ||
    runtime.transportSize.productionTransportAuthenticated !== false ||
    runtime.transportSize.transportAuthorityCreated !== false ||
    runtime.transportSize.databaseAuthorityCreated !== false ||
    runtime.transportSize.releaseAuthorityCreated !== false ||
    runtime.parameters.order !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER ||
    runtime.parameters.valueCount !== 33 ||
    runtime.parameters.valuesExposed !== false ||
    context.sourceParameters !== context.reconciliationContext.parameters ||
    parameters.length !== 33 ||
    sourceParameters.length !== 28 ||
    !sourceParameters.every((value, index) => parameters[index] === value) ||
    parameters[28] !== '0' ||
    parameters[29] !== null ||
    parameters[30] !== null ||
    parameters[31] !== null ||
    parameters[32] !== null ||
    executionId === null ||
    receiptZeroEventId === null ||
    receiptZeroReceiptId === null ||
    receiptZeroIdempotencyKey === null ||
    receiptZeroRequestDigest === null ||
    receiptZeroDigest === null ||
    receiptZeroBase64 === null ||
    parameters[8] !== review.bindings.scopeDigest ||
    parameters[25] !== review.bindings.expectedReceiptZeroDigest ||
    review.bindings.reconciliationReviewDigest !==
      context.reconciliationContext.envelope.reviewDigest ||
    review.bindings.pageQueryDigest !== currentQueryDigest ||
    review.bindings.pageSqlDigest !== currentSqlDigest ||
    review.bindings.pageStaticSqlSafetyCertificateDigest !==
      context.staticSqlSafetyContext.envelope.certificateDigest ||
    review.bindings.pageTransportSizeCertificateDigest !== currentTransportSizeCertificateDigest ||
    review.bindings.pageRequestSizeCertificateDigest !== currentRequestSizeCertificateDigest ||
    refreshed.review.bindings.pageStaticSqlSafetyCertificateDigest !==
      review.bindings.pageStaticSqlSafetyCertificateDigest ||
    refreshed.review.bindings.pageTransportSizeCertificateDigest !==
      review.bindings.pageTransportSizeCertificateDigest ||
    refreshed.review.bindings.pageRequestSizeCertificateDigest !==
      review.bindings.pageRequestSizeCertificateDigest ||
    review.bindings.pageParameterValuesDigest !== currentParameterValuesDigest ||
    refreshed.review.bindings.pageParameterSchemaDigest !==
      review.bindings.pageParameterSchemaDigest ||
    refreshed.review.bindings.historicalInstallMarkerDigest !==
      review.bindings.historicalInstallMarkerDigest
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-review-changed')
  }
  return Object.freeze({
    pageMode: 'first' as const,
    afterRevision: 0,
    anchor: null,
    priorReceipt: null,
    reconciliationReview: context.reconciliationContext.envelope,
    pageReviewDigest: envelope.reviewDigest,
    pageQueryDigest: review.bindings.pageQueryDigest,
    pageSqlDigest: review.bindings.pageSqlDigest,
    pageParameterSchemaDigest: review.bindings.pageParameterSchemaDigest,
    pageParameterValuesDigest: review.bindings.pageParameterValuesDigest,
    reconciliationReviewDigest: review.bindings.reconciliationReviewDigest,
    scopeDigest: review.bindings.scopeDigest,
    expectedReceiptZeroDigest: review.bindings.expectedReceiptZeroDigest,
    historicalInstallMarkerDigest: review.bindings.historicalInstallMarkerDigest,
    executionId,
    receiptZero: Object.freeze({
      eventId: receiptZeroEventId,
      receiptId: receiptZeroReceiptId,
      idempotencyKey: receiptZeroIdempotencyKey,
      requestDigest: receiptZeroRequestDigest,
      receiptDigest: receiptZeroDigest,
      canonicalReceiptBase64: receiptZeroBase64
    })
  })
}

function sameAnchor(
  left: SupabaseBackfillReceiptV2ChainPageAnchorV1,
  right: SupabaseBackfillReceiptV2ChainPageAnchorV1
): boolean {
  return (
    left.revision === right.revision &&
    left.eventId === right.eventId &&
    left.receiptDigest === right.receiptDigest &&
    left.updatedAt === right.updatedAt
  )
}

function reconciliationAllowsPageData(
  reconciliation: SupabaseBackfillReceiptZeroReconciliationObservationV1
): boolean {
  return (
    (reconciliation.reportedStatus === 'exact-replay' ||
      reconciliation.reportedStatus === 'advanced-head') &&
    reconciliation.facts.inputValid &&
    reconciliation.facts.runtimeReady &&
    reconciliation.facts.fullLedgerShapeVerified
  )
}

function requireOuterReconciliationBindings(
  parsed: ParsedPageResponseV1,
  reconciliation: SupabaseBackfillReceiptZeroReconciliationObservationV1,
  expected: SupabaseBackfillReceiptV2ChainPageParseExpectationV1
): void {
  const facts = parsed.facts
  const pageDataEligible = reconciliationAllowsPageData(reconciliation)
  const eligiblePageFactsMatch =
    facts.currentExecutionCount === reconciliation.facts.targetExecutionCount &&
    (facts.currentExecutionCount === 1) === (facts.executionStatus !== null) &&
    facts.headCount === reconciliation.facts.headCount &&
    facts.currentHeadRevision === reconciliation.facts.headRevision &&
    facts.executionTimestampMatchesHead === reconciliation.facts.executionTimestampMatchesHead &&
    (reconciliation.reportedStatus !== 'advanced-head' ||
      !facts.headMatchesAnchor ||
      facts.headTimestampMatchesAnchorReceipt ===
        reconciliation.facts.headTimestampMatchesLatestReceipt)
  const ineligiblePageFactsAreEmpty =
    facts.currentExecutionCount === 0 &&
    facts.executionStatus === null &&
    facts.headCount === 0 &&
    facts.currentHeadRevision === null &&
    facts.currentHeadEventId === null &&
    facts.currentHeadReceiptDigest === null &&
    facts.currentHeadUpdatedAt === null &&
    !facts.executionTimestampMatchesHead
  if (
    parsed.scopeDigest !== expected.scopeDigest ||
    parsed.scopeDigest !== reconciliation.bindings.scopeDigest ||
    reconciliation.bindings.receiptDigest !== expected.expectedReceiptZeroDigest ||
    parsed.reconciliationReportedStatus !== reconciliation.reportedStatus ||
    facts.inputValid !== reconciliation.facts.inputValid ||
    facts.runtimeReady !== reconciliation.facts.runtimeReady ||
    facts.fullLedgerShapeVerified !== reconciliation.facts.fullLedgerShapeVerified ||
    facts.exactImmutableExecutionCount !== reconciliation.facts.exactImmutableExecutionCount ||
    facts.exactReceiptZeroCount !== reconciliation.facts.exactReceiptZeroCount ||
    facts.receiptCount !== reconciliation.facts.receiptCount ||
    facts.minimumReceiptRevision !== reconciliation.facts.chainMinimumRevision ||
    facts.maximumReceiptRevision !== reconciliation.facts.chainMaximumRevision ||
    (pageDataEligible ? !eligiblePageFactsMatch : !ineligiblePageFactsAreEmpty) ||
    parsed.snapshot.transactionReadOnly !== reconciliation.snapshot.transactionReadOnly ||
    parsed.snapshot.serverVersionNum !== reconciliation.snapshot.serverVersionNum ||
    parsed.snapshot.snapshotDigest !== reconciliation.snapshot.snapshotDigest ||
    parsed.snapshot.observedAt !== reconciliation.snapshot.observedAt ||
    parsed.installMarkerDigest !== reconciliation.bindings.observedInstallMarkerDigest
  ) {
    fail('supabase-backfill-receipt-v2-chain-page-response-binding-mismatch')
  }
}

async function requireReceiptBindings(
  parsed: ParsedPageResponseV1,
  expected: SupabaseBackfillReceiptV2ChainPageParseExpectationV1
): Promise<void> {
  const computedDigests: string[] = []
  const computedScopeDigests: string[] = []
  try {
    for (const row of parsed.receiptRows) {
      computedDigests.push(await digestBackendBackfillExecutionReceiptV2(row.receipt))
      computedScopeDigests.push(await digestBackendBackfillExecutionScopeV2(row.receipt.scope))
    }
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-response-digest-failed')
  }
  let previous: ParsedReceiptRowV1 | undefined
  for (const [index, row] of parsed.receiptRows.entries()) {
    const receipt = row.receipt
    const expectedRevision = parsed.afterRevision + index + 1
    const expectedPrevious = previous ?? (index === 0 ? expected.priorReceipt : null)
    const expectedPreviousRevision = expectedPrevious?.revision ?? null
    const expectedPreviousEventId = expectedPrevious?.eventId ?? null
    const expectedPreviousReceiptDigest = expectedPrevious?.receiptDigest ?? null
    if (
      row.revision !== expectedRevision ||
      row.previousRevision !== expectedPreviousRevision ||
      row.previousEventId !== expectedPreviousEventId ||
      row.previousReceiptDigest !== expectedPreviousReceiptDigest ||
      receipt.executionId !== expected.executionId ||
      receipt.scopeDigest !== expected.scopeDigest ||
      computedScopeDigests[index] !== expected.scopeDigest ||
      receipt.databaseHeadVersion !== row.revision ||
      receipt.databaseEventId !== row.eventId ||
      receipt.receiptId !== row.receiptId ||
      receipt.idempotencyKey !== row.idempotencyKey ||
      receipt.requestDigest !== row.requestDigest ||
      receipt.previousReceiptDigest !== row.previousReceiptDigest ||
      receipt.checkpointKind !== row.checkpointKind ||
      timestampNanoseconds(receipt.committedAt) !== timestampNanoseconds(row.committedAt) ||
      computedDigests[index] !== row.receiptDigest ||
      (row.revision === 1 &&
        (row.eventId !== expected.receiptZero.eventId ||
          row.receiptId !== expected.receiptZero.receiptId ||
          row.idempotencyKey !== expected.receiptZero.idempotencyKey ||
          row.requestDigest !== expected.receiptZero.requestDigest ||
          row.receiptDigest !== expected.receiptZero.receiptDigest ||
          row.canonicalReceiptBase64 !== expected.receiptZero.canonicalReceiptBase64))
    ) {
      return fail('supabase-backfill-receipt-v2-chain-page-response-binding-mismatch')
    }
    previous = row
  }
}

function requireSelfConsistentPageFacts(
  parsed: ParsedPageResponseV1,
  expected: SupabaseBackfillReceiptV2ChainPageParseExpectationV1,
  pageDataEligible: boolean
): void {
  const facts = parsed.facts
  const rows = parsed.receiptRows
  const expectedFirstRevision = rows.length === 0 ? null : rows[0].revision
  const expectedLastRevision = rows.length === 0 ? null : rows[rows.length - 1].revision
  const expectedHeadMatchesAnchor =
    facts.headCount === 1 &&
    sameAnchor(parsed.anchor, {
      revision: facts.currentHeadRevision,
      eventId: facts.currentHeadEventId,
      receiptDigest: facts.currentHeadReceiptDigest,
      updatedAt: facts.currentHeadUpdatedAt
    })
  const distance =
    expectedHeadMatchesAnchor && parsed.anchor.revision !== null
      ? parsed.anchor.revision - parsed.afterRevision
      : 0
  const expectedContiguous =
    expectedHeadMatchesAnchor &&
    distance > 0 &&
    facts.pageReceiptCount === Math.min(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE, distance) &&
    facts.pageFirstRevision === parsed.afterRevision + 1 &&
    facts.pageLastRevision === parsed.afterRevision + facts.pageReceiptCount &&
    (distance <= SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
      facts.pageCandidateCount === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE)
  let expectedLinksValid = rows.length > 0
  for (const [index, row] of rows.entries()) {
    const previous = index === 0 ? expected.priorReceipt : rows[index - 1]
    const previousRevision = previous?.revision ?? null
    const previousEventId = previous?.eventId ?? null
    const previousReceiptDigest = previous?.receiptDigest ?? null
    if (
      row.revision !== parsed.afterRevision + index + 1 ||
      row.previousRevision !== previousRevision ||
      row.previousEventId !== previousEventId ||
      row.previousReceiptDigest !== previousReceiptDigest
    ) {
      expectedLinksValid = false
    }
  }
  const expectedReceiptZeroMatchesCandidate =
    expected.receiptZero.receiptDigest === expected.expectedReceiptZeroDigest &&
    facts.exactReceiptZeroCount === 1
  const currentHeadTuplePresent = facts.currentHeadRevision !== null
  const expectedAnchorMatches =
    expected.pageMode === 'first'
      ? sameAnchor(parsed.anchor, {
          revision: facts.currentHeadRevision,
          eventId: facts.currentHeadEventId,
          receiptDigest: facts.currentHeadReceiptDigest,
          updatedAt: facts.currentHeadUpdatedAt
        })
      : expected.anchor !== null && sameAnchor(parsed.anchor, expected.anchor)
  const emptyPageRequired =
    !pageDataEligible || (expected.pageMode === 'continuation' && !expectedHeadMatchesAnchor)
  const gatedPageShapeMatches =
    !emptyPageRequired ||
    (facts.pageCandidateCount === 0 &&
      facts.pageReceiptCount === 0 &&
      facts.pageFirstRevision === null &&
      facts.pageLastRevision === null &&
      !facts.pageContiguous &&
      !facts.pageLinksValid &&
      !facts.hasMore &&
      facts.anchorReceiptCount === 0 &&
      !facts.headTimestampMatchesAnchorReceipt &&
      rows.length === 0)
  if (
    parsed.queryVersion !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_QUERY_VERSION ||
    parsed.pageMode !== expected.pageMode ||
    parsed.afterRevision !== expected.afterRevision ||
    parsed.pageSize !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    !expectedAnchorMatches ||
    !gatedPageShapeMatches ||
    (facts.headCount === 1) !== currentHeadTuplePresent ||
    facts.pageReceiptCount !== rows.length ||
    facts.pageFirstRevision !== expectedFirstRevision ||
    facts.pageLastRevision !== expectedLastRevision ||
    facts.headMatchesAnchor !== expectedHeadMatchesAnchor ||
    facts.pageContiguous !== expectedContiguous ||
    facts.pageLinksValid !== expectedLinksValid ||
    facts.receiptZeroMatchesCandidate !== expectedReceiptZeroMatchesCandidate ||
    facts.hasMore !==
      (facts.pageCandidateCount === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE) ||
    (facts.minimumReceiptRevision === null) !== (facts.maximumReceiptRevision === null)
  ) {
    fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
}

function terminalExecutionStatus(
  outcome: BackendBackfillExecutionReceiptV2['outcome']
): SupabaseBackfillExecutionStatusV1 {
  if (outcome === 'completed') return 'completed'
  if (outcome === 'failed') return 'failed'
  return 'running'
}

function classifyPage(
  parsed: ParsedPageResponseV1,
  reconciliation: SupabaseBackfillReceiptZeroReconciliationObservationV1
): SupabaseBackfillReceiptV2ChainPageStateV1 {
  const facts = parsed.facts
  const reconciliationStatus = reconciliation.reportedStatus
  if (
    !facts.inputValid ||
    !facts.runtimeReady ||
    !facts.fullLedgerShapeVerified ||
    reconciliationStatus === 'absent' ||
    reconciliationStatus === 'precondition-failed'
  ) {
    return 'precondition-failed'
  }
  if (reconciliationStatus === 'corruption') return 'corruption'
  if (
    parsed.pageMode === 'continuation' &&
    !facts.headMatchesAnchor &&
    facts.headCount === 1 &&
    facts.currentHeadRevision !== null &&
    parsed.anchor.revision !== null &&
    facts.currentHeadRevision > parsed.anchor.revision
  ) {
    return 'anchor-stale'
  }
  const anchorRevision = parsed.anchor.revision
  const reconciliationRevisionShapeMatches =
    reconciliationStatus === 'exact-replay'
      ? anchorRevision === 1 &&
        facts.minimumReceiptRevision === null &&
        facts.maximumReceiptRevision === null
      : anchorRevision !== null &&
        anchorRevision >= 2 &&
        facts.minimumReceiptRevision === 1 &&
        facts.maximumReceiptRevision === anchorRevision
  if (
    !parsed.snapshot.transactionReadOnly ||
    anchorRevision === null ||
    !reconciliationRevisionShapeMatches ||
    facts.exactImmutableExecutionCount !== 1 ||
    facts.currentExecutionCount !== 1 ||
    facts.exactReceiptZeroCount !== 1 ||
    facts.headCount !== 1 ||
    facts.currentHeadRevision !== anchorRevision ||
    facts.receiptCount !== anchorRevision ||
    !facts.headMatchesAnchor ||
    facts.anchorReceiptCount !== 1 ||
    !facts.headTimestampMatchesAnchorReceipt ||
    !facts.executionTimestampMatchesHead ||
    !facts.receiptZeroMatchesCandidate ||
    !facts.pageContiguous ||
    !facts.pageLinksValid
  ) {
    return 'corruption'
  }
  const distance = anchorRevision - parsed.afterRevision
  const expectedCandidateCount = Math.min(
    SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
    distance
  )
  if (facts.pageCandidateCount !== expectedCandidateCount) return 'corruption'
  const lastReceiptRow = parsed.receiptRows.at(-1)
  const lastReceipt = lastReceiptRow?.receipt
  if (
    facts.pageCandidateCount === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE &&
    facts.pageReceiptCount === SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE &&
    facts.pageLastRevision !== null &&
    facts.pageLastRevision < anchorRevision &&
    lastReceipt?.outcome === 'in-progress'
  ) {
    return 'page-ready'
  }
  if (
    facts.pageCandidateCount >= 1 &&
    facts.pageCandidateCount <= SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE &&
    facts.pageReceiptCount === facts.pageCandidateCount &&
    facts.pageLastRevision === anchorRevision &&
    lastReceiptRow?.revision === anchorRevision &&
    lastReceiptRow.eventId === parsed.anchor.eventId &&
    lastReceiptRow.receiptDigest === parsed.anchor.receiptDigest &&
    parsed.anchor.updatedAt !== null &&
    timestampNanoseconds(lastReceiptRow.committedAt) ===
      timestampNanoseconds(parsed.anchor.updatedAt) &&
    lastReceipt &&
    facts.executionStatus === terminalExecutionStatus(lastReceipt.outcome)
  ) {
    return 'chain-complete'
  }
  return 'corruption'
}

function receiptSummaries(
  rows: readonly ParsedReceiptRowV1[]
): readonly Readonly<SupabaseBackfillReceiptV2ChainPageReceiptSummaryV1>[] {
  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        revision: row.revision,
        eventId: row.eventId,
        receiptId: row.receiptId,
        receiptDigest: row.receiptDigest,
        checkpointKind: row.checkpointKind,
        canonicalReceiptByteLength: row.canonicalReceiptByteLength,
        committedAt: row.committedAt
      })
    )
  )
}

function requireValidParseExpectation(
  expected: SupabaseBackfillReceiptV2ChainPageParseExpectationV1
): void {
  if (expected.pageMode === 'first') {
    if (
      expected.afterRevision === 0 &&
      expected.anchor === null &&
      expected.priorReceipt === null
    ) {
      return
    }
    fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
  const anchor = expected.anchor
  const priorReceipt = expected.priorReceipt
  if (anchor === null || priorReceipt === null) {
    fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
  if (
    expected.afterRevision < 1 ||
    expected.afterRevision > 9_999 ||
    anchor.revision === null ||
    anchor.revision <= expected.afterRevision ||
    anchor.eventId === null ||
    anchor.receiptDigest === null ||
    anchor.updatedAt === null ||
    priorReceipt.revision !== expected.afterRevision
  ) {
    fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
}

/**
 * @internal Decode and verify one already review-bound page response. This function snapshots the
 * untrusted response before its first await and returns data only; it never registers provenance.
 */
async function decodeParsedSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
  parsed: ParsedPageResponseV1,
  expectedPromise: PromiseLike<SupabaseBackfillReceiptV2ChainPageParseExpectationV1>
): Promise<SupabaseBackfillReceiptV2ChainDecodedPageV1> {
  const expected = await expectedPromise
  requireValidParseExpectation(expected)
  let reconciliation: SupabaseBackfillReceiptZeroReconciliationObservationV1
  try {
    reconciliation = await parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
      reconciliationReview: expected.reconciliationReview,
      response: Object.freeze([parsed.reconciliationResponse])
    })
  } catch (cause) {
    if (
      cause instanceof SupabaseBackfillReceiptZeroReconciliationResponseError &&
      (cause.code === 'supabase-backfill-receipt-zero-reconciliation-response-proof-invalid' ||
        cause.code === 'supabase-backfill-receipt-zero-reconciliation-response-review-changed')
    ) {
      return fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
    }
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  requireOuterReconciliationBindings(parsed, reconciliation, expected)
  await requireReceiptBindings(parsed, expected)
  requireSelfConsistentPageFacts(parsed, expected, reconciliationAllowsPageData(reconciliation))
  const recomputedReportedStatus = classifyPage(parsed, reconciliation)
  if (recomputedReportedStatus !== parsed.reportedStatus) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-invalid')
  }
  const markerMatches =
    parsed.installMarkerDigest === expected.historicalInstallMarkerDigest &&
    reconciliation.reportedInstallMarkerDigestMatchesHistorical
  const status = markerMatches ? recomputedReportedStatus : ('precondition-failed' as const)
  const responseDigest = await digest(parsed.canonicalResponse)
  return Object.freeze({
    pageMode: expected.pageMode,
    reportedStatus: parsed.reportedStatus,
    status,
    reconciliation,
    afterRevision: parsed.afterRevision,
    anchor: parsed.anchor,
    currentHead: Object.freeze({
      revision: parsed.facts.currentHeadRevision,
      eventId: parsed.facts.currentHeadEventId,
      receiptDigest: parsed.facts.currentHeadReceiptDigest,
      updatedAt: parsed.facts.currentHeadUpdatedAt
    }),
    facts: parsed.facts,
    receipts: receiptSummaries(parsed.receiptRows),
    canonicalReceipts: Object.freeze(parsed.receiptRows.map((row) => row.receipt)),
    snapshot: parsed.snapshot,
    installMarkerDigest: parsed.installMarkerDigest,
    reportedInstallMarkerDigestMatchesHistorical: markerMatches,
    responseDigest
  })
}

/**
 * Decode an already materialized injected value. This legacy testing seam cannot authenticate raw
 * transport size or framing and therefore remains production-unauthenticated.
 */
export async function decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
  response: unknown,
  expectedPromise: PromiseLike<SupabaseBackfillReceiptV2ChainPageParseExpectationV1>
): Promise<SupabaseBackfillReceiptV2ChainDecodedPageV1> {
  return decodeParsedSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
    exactSingleResponse(response),
    expectedPromise
  )
}

export interface SupabaseBackfillReceiptV2ChainDecodedWirePageForTestingV1 {
  readonly decodedPage: SupabaseBackfillReceiptV2ChainDecodedPageV1
  readonly size: SupabaseBackfillReceiptV2ChainResponseSizeV1
  readonly productionTransportAuthenticated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly releaseAuthorityCreated: false
}

/**
 * Cap raw bytes before copying/parsing, require fatal UTF-8 and compact JSON framing, then reuse the
 * strict page decoder. Passing this local wire gate authenticates no producer or database response.
 */
export async function decodeSupabaseBackfillReceiptV2ChainPageWireResponseForTestingV1(
  responseBytes: unknown,
  expectedPromise: PromiseLike<SupabaseBackfillReceiptV2ChainPageParseExpectationV1>
): Promise<SupabaseBackfillReceiptV2ChainDecodedWirePageForTestingV1> {
  const bounded = parseSupabaseBackfillReceiptV2ChainBoundedResponseJSONV1(responseBytes)
  const parsed = exactSingleResponse(bounded.response)
  const size = certifySupabaseBackfillReceiptV2ChainResponseSizeV1(
    bounded.responseByteLength,
    parsed.base64PayloadCharacterCount
  )
  const decodedPage = await decodeParsedSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
    parsed,
    expectedPromise
  )
  return Object.freeze({
    decodedPage,
    size,
    productionTransportAuthenticated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const
  })
}

/**
 * Strictly parse one injected first-page response. This is a testing seam only: it snapshots all
 * untrusted values before awaiting, reuses the complete reconciliation parser, and binds every
 * returned row to canonical Receipt V2 bytes without granting any production authority.
 */
export async function parseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingV1(
  input: ParseSupabaseBackfillReceiptV2ChainFirstPageResponseForTestingOptionsV1
): Promise<SupabaseBackfillReceiptV2ChainFirstPageObservationV1> {
  const source = exactInput(input)
  const reviewValue = ownData(
    source,
    'pageReview',
    'supabase-backfill-receipt-v2-chain-page-response-input-invalid'
  )
  const reviewContext = trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(reviewValue)
  if (!reviewContext || reviewContext.envelope !== reviewValue) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
  const responseValue = ownData(
    source,
    'response',
    'supabase-backfill-receipt-v2-chain-page-response-input-invalid'
  )
  const expectedPromise = requireCurrentPageReview(reviewContext.envelope, reviewContext)
  const decodedPromise = decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
    responseValue,
    expectedPromise
  )
  const [expected, decoded] = await Promise.all([expectedPromise, decodedPromise])
  if (
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(reviewContext.envelope) !==
    reviewContext
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-response-proof-invalid')
  }
  const observation = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_FIRST_PAGE_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    pageMode: 'first' as const,
    reportedStatus: decoded.reportedStatus,
    status: decoded.status,
    reconciliation: Object.freeze({
      reportedStatus: decoded.reconciliation.reportedStatus,
      status: decoded.reconciliation.status,
      reportedStatusMatchesRecomputedFacts: true as const
    }),
    bindings: Object.freeze({
      pageReviewDigest: expected.pageReviewDigest,
      pageQueryDigest: expected.pageQueryDigest,
      pageSqlDigest: expected.pageSqlDigest,
      pageParameterSchemaDigest: expected.pageParameterSchemaDigest,
      pageParameterValuesDigest: expected.pageParameterValuesDigest,
      reconciliationReviewDigest: expected.reconciliationReviewDigest,
      reconciliationResponseDigest: decoded.reconciliation.bindings.responseDigest,
      scopeDigest: expected.scopeDigest,
      expectedReceiptZeroDigest: expected.expectedReceiptZeroDigest,
      historicalInstallMarkerDigest: expected.historicalInstallMarkerDigest,
      observedInstallMarkerDigest: decoded.installMarkerDigest,
      responseDigest: decoded.responseDigest
    }),
    afterRevision: 0 as const,
    anchor: decoded.anchor,
    currentHead: decoded.currentHead,
    facts: decoded.facts,
    receipts: decoded.receipts,
    snapshot: decoded.snapshot,
    reportedStatusMatchesRecomputedFacts: true as const,
    statusRecomputedByHost: true as const,
    completeEmbeddedReconciliationRecomputedByHost: true as const,
    canonicalReceiptPayloadsVerified: true as const,
    pageRowsBoundToCanonicalReceipts: true as const,
    reportedInstallMarkerDigestMatchesHistorical:
      decoded.reportedInstallMarkerDigestMatchesHistorical,
    specificHistoricalInstallationAuthenticated: false as const,
    reportedStatusProvesDatabaseState: false as const,
    statusProvesDatabaseState: false as const,
    productionTransportAuthenticated: false as const,
    fullPortableReceiptV2ChainVerified: false as const,
    continuationReviewCreated: false as const,
    crossPageHeadFreshnessAuthenticated: false as const,
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
  }) satisfies SupabaseBackfillReceiptV2ChainFirstPageObservationV1
  trustedObservations.set(
    observation,
    Object.freeze({
      observation,
      reviewContext,
      receipts: decoded.canonicalReceipts
    })
  )
  return observation
}

/** Identity-only lookup for a genuine process-local testing observation. */
export function trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedObservations.get(value)
  if (
    !context ||
    context.observation !== value ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      context.reviewContext.envelope
    ) !== context.reviewContext
  ) {
    return null
  }
  return context
}
