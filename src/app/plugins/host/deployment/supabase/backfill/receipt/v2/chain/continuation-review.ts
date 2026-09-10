/* oxlint-disable eslint(max-lines), eslint(complexity) -- Provenance validation and the complete continuation review contract form one auditable boundary. */

import {
  digestBackendBackfillExecutionReceiptV2,
  type BackendBackfillExecutionReceiptV2
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SupabaseBackfillReceiptV2ChainPageResponseError,
  decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1,
  requireCurrentPageReview,
  trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1,
  type SupabaseBackfillReceiptV2ChainFirstPageObservationV1,
  type SupabaseBackfillReceiptV2ChainPageParseExpectationV1,
  type TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
} from './page/response'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_ARTIFACT_PATH,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL,
  createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1,
  trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1,
  type SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1,
  type SupabaseBackfillReceiptV2ChainFirstPageReviewV1,
  type SupabaseBackfillReceiptV2ChainPageParameterV1,
  type TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
} from './page/review'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1,
  createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1,
  verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1,
  type SupabaseBackfillReceiptV2ChainTransportSizeReviewV1
} from './page/transport-size-certificate'

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-continuation-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-continuation-page-observation.v1' as const

const INPUT_KEYS = ['previousPageObservation'] as const
const RESPONSE_INPUT_KEYS = ['continuationReview', 'response'] as const
const BLOCKERS = Object.freeze([
  'receipt-v2-chain-continuation-review-only',
  'receipt-v2-chain-page-host-transport-unavailable',
  'receipt-v2-chain-cross-page-head-freshness-unavailable',
  'receipt-v2-chain-production-response-authentication-unavailable'
] as const)

type ParameterValue = string | null

export interface CreateSupabaseBackfillReceiptV2ChainContinuationReviewForTestingOptionsV1 {
  readonly previousPageObservation:
    | SupabaseBackfillReceiptV2ChainFirstPageObservationV1
    | SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
}

export interface ParseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingOptionsV1 {
  readonly continuationReview: SupabaseBackfillReceiptV2ChainContinuationReviewEnvelopeV1
  readonly response: unknown
}

export interface SupabaseBackfillReceiptV2ChainContinuationReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly databaseLedgerBound: false
  readonly chainVerificationAuthorityCreated: false
  readonly continuationAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    sourcePageObservationDigest: string
    sourcePageResponseDigest: string
    sourcePageReviewDigest: string
    reconciliationReviewDigest: string
    sourceParameterSchemaDigest: string
    sourceParameterValuesDigest: string
    pageParameterSchemaDigest: string
    pageParameterValuesDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
    scopeDigest: string
    expectedReceiptZeroDigest: string
    historicalInstallMarkerDigest: string
    anchorDigest: string
    pageSqlDigest: string
    pageQueryDigest: string
    pageTransportSizeCertificateDigest: string
    pageRequestSizeCertificateDigest: string
  }>
  readonly query: SupabaseBackfillReceiptV2ChainFirstPageReviewV1['query']
  readonly parameters: Readonly<{
    order: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER
    schema: readonly SupabaseBackfillReceiptV2ChainPageParameterV1[]
    valueCount: 33
    valuesExposed: false
    reusedReceiptZeroCASPrefixCount: 28
    suffixBoundFromGenuinePreviousPage: true
  }>
  readonly catalogGuard: SupabaseBackfillReceiptV2ChainFirstPageReviewV1['catalogGuard']
  readonly page: Readonly<{
    kind: 'continuation'
    afterRevision: number
    maximumReceiptCount: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE
    lookaheadReceiptCount: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE
    keysetOrder: 'revision-ascending'
    sourcePageStatus: 'page-ready'
    anchor: Readonly<{
      revision: number
      eventId: string
      receiptDigest: string
      updatedAt: string
    }>
    continuationBindsExactAnchor: true
    staleAnchorReanchoredAutomatically: false
    crossPageSingleSnapshotClaimed: false
  }>
  readonly transportSize: SupabaseBackfillReceiptV2ChainTransportSizeReviewV1
  readonly policy: Readonly<{
    previousPageIdentityRequired: true
    previousPageCanonicalReceiptsRetainedOnlyInTrustedContext: true
    previewContainsPlaceholdersOnly: true
    canonicalValuesKeptInTrustedContextOnly: true
    requestDispatched: false
    managedDataReadPerformed: false
    productionResponseAuthenticated: false
    responseParserCreated: true
    boundedResponseWireDecoderCreated: true
    localRequestAndResponseBoundsCertified: true
    pageCollectionPerformed: false
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
  readonly artifact: SupabaseBackfillReceiptV2ChainFirstPageReviewV1['artifact']
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillReceiptV2ChainContinuationReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptV2ChainContinuationReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/** Process-local query material only; no credential, transport, continuation, or release authority. */
export interface TrustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptV2ChainContinuationReviewEnvelopeV1
  readonly sourceObservationContext:
    | TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
    | TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1
  readonly firstPageReviewContext: TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
  readonly sourceParameters: readonly ParameterValue[]
  readonly parameters: readonly ParameterValue[]
}

export interface SupabaseBackfillReceiptV2ChainContinuationPageObservationV1 extends Omit<
  SupabaseBackfillReceiptV2ChainFirstPageObservationV1,
  'format' | 'pageMode' | 'afterRevision' | 'bindings'
> {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT
  readonly pageMode: 'continuation'
  readonly afterRevision: number
  readonly bindings: Readonly<{
    continuationReviewDigest: string
    sourcePageObservationDigest: string
    sourcePageResponseDigest: string
    sourcePageReviewDigest: string
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
    anchorDigest: string
    responseDigest: string
  }>
  readonly previousPageIdentityVerified: true
  readonly priorReceiptExpectationEnforced: true
  readonly staleAnchorReanchoredAutomatically: false
}

export interface TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1 {
  readonly observation: SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
  readonly reviewContext: TrustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1
  readonly canonicalReceipts: readonly BackendBackfillExecutionReceiptV2[]
}

export type SupabaseBackfillReceiptV2ChainContinuationReviewErrorCode =
  | 'supabase-backfill-receipt-v2-chain-continuation-input-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-proof-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-source-not-page-ready'
  | 'supabase-backfill-receipt-v2-chain-continuation-transport-size-binding-mismatch'
  | 'supabase-backfill-receipt-v2-chain-continuation-review-changed'
  | 'supabase-backfill-receipt-v2-chain-continuation-digest-failed'

export type SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode =
  | 'supabase-backfill-receipt-v2-chain-continuation-response-input-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-review-changed'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-binding-mismatch'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-receipt-invalid'
  | 'supabase-backfill-receipt-v2-chain-continuation-response-digest-failed'

export class SupabaseBackfillReceiptV2ChainContinuationReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ChainContinuationReviewErrorCode) {
    super(`Supabase backfill Receipt V2 chain continuation review failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ChainContinuationReviewError'
  }
}

export class SupabaseBackfillReceiptV2ChainContinuationResponseError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode) {
    super(`Supabase backfill Receipt V2 chain continuation response failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ChainContinuationResponseError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ObservationRuntimeViewV1 {
  readonly format: unknown
  readonly version: unknown
  readonly providerId: unknown
  readonly environment: unknown
  readonly testingOnly: unknown
  readonly pageMode: unknown
  readonly reportedStatus: unknown
  readonly status: unknown
  readonly afterRevision: unknown
  readonly anchor: Readonly<{
    revision: unknown
    eventId: unknown
    receiptDigest: unknown
    updatedAt: unknown
  }>
  readonly facts: Readonly<{
    pageCandidateCount: unknown
    pageReceiptCount: unknown
    pageFirstRevision: unknown
    pageLastRevision: unknown
    pageContiguous: unknown
    pageLinksValid: unknown
    hasMore: unknown
  }>
  readonly reportedInstallMarkerDigestMatchesHistorical: unknown
  readonly productionTransportAuthenticated: unknown
  readonly fullPortableReceiptV2ChainVerified: unknown
  readonly continuationReviewCreated: unknown
  readonly databaseAuthorityCreated: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly releaseAuthorityCreated: unknown
  readonly releaseReady: unknown
}

const trustedReviews = new WeakMap<
  object,
  TrustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1
>()
const trustedContinuationObservations = new WeakMap<
  object,
  TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1
>()

type TrustedPageSourceV1 =
  | Readonly<{
      kind: 'first'
      context: TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
      observation: SupabaseBackfillReceiptV2ChainFirstPageObservationV1
      canonicalReceipts: readonly BackendBackfillExecutionReceiptV2[]
      sourceReviewEnvelope: SupabaseBackfillReceiptV2ChainFirstPageReviewEnvelopeV1
      firstPageReviewContext: TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
    }>
  | Readonly<{
      kind: 'continuation'
      context: TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1
      observation: SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
      canonicalReceipts: readonly BackendBackfillExecutionReceiptV2[]
      sourceReviewEnvelope: SupabaseBackfillReceiptV2ChainContinuationReviewEnvelopeV1
      firstPageReviewContext: TrustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1
    }>

function trustedPageSource(value: unknown): TrustedPageSourceV1 | null {
  const firstPage = trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(value)
  if (firstPage && firstPage.observation === value) {
    return {
      kind: 'first',
      context: firstPage,
      observation: firstPage.observation,
      canonicalReceipts: firstPage.receipts,
      sourceReviewEnvelope: firstPage.reviewContext.envelope,
      firstPageReviewContext: firstPage.reviewContext
    }
  }
  if (value === null || typeof value !== 'object') return null
  const continuation = trustedContinuationObservations.get(value)
  if (!continuation || continuation.observation !== value) return null
  const reviewContext = continuation.reviewContext
  const firstPageReviewContext = reviewContext.firstPageReviewContext
  if (
    trustedReviews.get(reviewContext.envelope) !== reviewContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      firstPageReviewContext.envelope
    ) !== firstPageReviewContext
  ) {
    return null
  }
  return {
    kind: 'continuation',
    context: continuation,
    observation: continuation.observation,
    canonicalReceipts: continuation.canonicalReceipts,
    sourceReviewEnvelope: reviewContext.envelope,
    firstPageReviewContext
  }
}

function sourceOwnReviewDigest(
  observation:
    | SupabaseBackfillReceiptV2ChainFirstPageObservationV1
    | SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
): string {
  return observation.pageMode === 'first'
    ? observation.bindings.pageReviewDigest
    : observation.bindings.continuationReviewDigest
}

function sourceReviewMatchesObservation(source: TrustedPageSourceV1): boolean {
  if (source.kind === 'first') {
    return source.sourceReviewEnvelope === source.firstPageReviewContext.envelope
  }
  const page = source.sourceReviewEnvelope.review.page
  const anchor = source.observation.anchor
  return (
    page.afterRevision === source.observation.afterRevision &&
    page.anchor.revision === anchor.revision &&
    page.anchor.eventId === anchor.eventId &&
    page.anchor.receiptDigest === anchor.receiptDigest &&
    page.anchor.updatedAt === anchor.updatedAt
  )
}

function fail(code: SupabaseBackfillReceiptV2ChainContinuationReviewErrorCode): never {
  throw new SupabaseBackfillReceiptV2ChainContinuationReviewError(code)
}

function failResponse(code: SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode): never {
  throw new SupabaseBackfillReceiptV2ChainContinuationResponseError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    if (Array.isArray(value)) {
      return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
    }
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  if (keys.length !== INPUT_KEYS.length || keys.some((key) => key !== 'previousPageObservation')) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-input-invalid')
  }
  return Object.freeze({ previousPageObservation: ownData(value, 'previousPageObservation') })
}

function responseOwnData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
  }
  return descriptor.value
}

function exactResponseInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    if (Array.isArray(value)) {
      return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
    }
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== RESPONSE_INPUT_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== 'string' || !RESPONSE_INPUT_KEYS.some((expectedKey) => expectedKey === key)
    )
  ) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-input-invalid')
  }
  return Object.freeze({
    continuationReview: responseOwnData(value, 'continuationReview'),
    response: responseOwnData(value, 'response')
  })
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-digest-failed')
  }
}

function uniqueBlockers(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)])
}

function continuationParameters(
  source: readonly ParameterValue[],
  afterRevision: number,
  anchor: Readonly<{ revision: number; eventId: string; receiptDigest: string; updatedAt: string }>
): readonly ParameterValue[] {
  return Object.freeze([
    ...source,
    String(afterRevision),
    String(anchor.revision),
    anchor.eventId,
    anchor.receiptDigest,
    anchor.updatedAt
  ])
}

/** Build the next deterministic testing-only page review from a genuine page-ready observation. */
export async function createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1(
  input: CreateSupabaseBackfillReceiptV2ChainContinuationReviewForTestingOptionsV1
): Promise<SupabaseBackfillReceiptV2ChainContinuationReviewEnvelopeV1> {
  const source = exactInput(input)
  const observationValue = ownData(source, 'previousPageObservation')
  const pageSource = trustedPageSource(observationValue)
  if (!pageSource || pageSource.observation !== observationValue) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-proof-invalid')
  }
  const sourceObservationContext = pageSource.context
  const observation = pageSource.observation
  const runtime = observation as ObservationRuntimeViewV1
  const firstPageReviewContext = pageSource.firstPageReviewContext
  const firstPageReview = firstPageReviewContext.envelope.review
  const sourceReviewEnvelope = pageSource.sourceReviewEnvelope
  let refreshedFirstPageReview: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1>
  >
  try {
    refreshedFirstPageReview =
      await createSupabaseBackfillReceiptV2ChainFirstPageReviewForTestingV1({
        reconciliationReview: firstPageReviewContext.reconciliationContext.envelope,
        staticSqlSafetyCertificate: firstPageReviewContext.staticSqlSafetyContext.envelope
      })
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-proof-invalid')
  }
  const anchorRevision = observation.anchor.revision
  const anchorEventId = observation.anchor.eventId
  const anchorReceiptDigest = observation.anchor.receiptDigest
  const anchorUpdatedAt = observation.anchor.updatedAt
  const sourceAfterRevision = observation.afterRevision
  const afterRevision = observation.facts.pageLastRevision
  if (
    runtime.format !==
      (pageSource.kind === 'first'
        ? 'openpencil.supabase-backfill-receipt-v2-chain-first-page-observation.v1'
        : SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT) ||
    runtime.version !== 1 ||
    runtime.providerId !== 'supabase' ||
    runtime.environment !== 'staging' ||
    runtime.testingOnly !== true ||
    runtime.pageMode !== pageSource.kind ||
    runtime.reportedStatus !== 'page-ready' ||
    runtime.status !== 'page-ready' ||
    runtime.afterRevision !== sourceAfterRevision ||
    !Number.isSafeInteger(sourceAfterRevision) ||
    sourceAfterRevision < 0 ||
    sourceAfterRevision > Number.MAX_SAFE_INTEGER - SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    runtime.facts.pageCandidateCount !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE ||
    runtime.facts.pageReceiptCount !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    runtime.facts.pageFirstRevision !== sourceAfterRevision + 1 ||
    runtime.facts.pageLastRevision !==
      sourceAfterRevision + SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    runtime.facts.pageContiguous !== true ||
    runtime.facts.pageLinksValid !== true ||
    runtime.facts.hasMore !== true ||
    runtime.reportedInstallMarkerDigestMatchesHistorical !== true ||
    runtime.productionTransportAuthenticated !== false ||
    runtime.fullPortableReceiptV2ChainVerified !== false ||
    runtime.continuationReviewCreated !== false ||
    runtime.databaseAuthorityCreated !== false ||
    runtime.executionAuthorityCreated !== false ||
    runtime.receiptAuthorityCreated !== false ||
    runtime.releaseAuthorityCreated !== false ||
    runtime.releaseReady !== false ||
    anchorRevision === null ||
    !Number.isSafeInteger(anchorRevision) ||
    anchorEventId === null ||
    anchorReceiptDigest === null ||
    anchorUpdatedAt === null ||
    afterRevision === null ||
    anchorRevision <= afterRevision ||
    observation.receipts.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    observation.receipts[0]?.revision !== sourceAfterRevision + 1 ||
    observation.receipts.at(-1)?.revision !== afterRevision ||
    pageSource.canonicalReceipts.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE ||
    pageSource.canonicalReceipts[0]?.databaseHeadVersion !== sourceAfterRevision + 1 ||
    pageSource.canonicalReceipts.at(-1)?.databaseHeadVersion !== afterRevision
  ) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-source-not-page-ready')
  }
  const anchor = Object.freeze({
    revision: anchorRevision,
    eventId: anchorEventId,
    receiptDigest: anchorReceiptDigest,
    updatedAt: anchorUpdatedAt
  })
  const parameterSchema = firstPageReview.parameters.schema
  const parameters = continuationParameters(
    firstPageReviewContext.sourceParameters,
    afterRevision,
    anchor
  )
  let pageRequestSizeCertificate: Awaited<
    ReturnType<typeof createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1>
  >
  try {
    pageRequestSizeCertificate =
      await createSupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(parameters)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-continuation-transport-size-binding-mismatch')
  }
  const [
    sourcePageObservationDigest,
    sourceReviewDigest,
    pageQueryDigest,
    pageSqlDigest,
    pageParameterSchemaDigest,
    pageParameterValuesDigest,
    anchorDigest,
    pageTransportSizeCertificateDigest,
    pageRequestSizeCertificateDigest
  ] = await Promise.all([
    digest(observation),
    digest(sourceReviewEnvelope.review),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    digest(parameterSchema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-page-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        values: parameters
      })
    ),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-anchor.v1' as const,
        version: 1 as const,
        ...anchor
      })
    ),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1),
    digest(pageRequestSizeCertificate)
  ])
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
      parameters,
      pageRequestSizeCertificate
    ))
  ) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-transport-size-binding-mismatch')
  }
  const currentPageSource = trustedPageSource(observation)
  if (
    currentPageSource?.context !== sourceObservationContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      firstPageReviewContext.envelope
    ) !== firstPageReviewContext ||
    refreshedFirstPageReview.reviewDigest !== firstPageReviewContext.envelope.reviewDigest ||
    !sourceReviewMatchesObservation(pageSource) ||
    sourceReviewEnvelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL ||
    sourceReviewDigest !== sourceReviewEnvelope.reviewDigest ||
    sourceOwnReviewDigest(observation) !== sourceReviewEnvelope.reviewDigest ||
    observation.bindings.pageQueryDigest !== pageQueryDigest ||
    observation.bindings.pageSqlDigest !== pageSqlDigest ||
    observation.bindings.pageParameterSchemaDigest !== pageParameterSchemaDigest ||
    observation.bindings.pageParameterValuesDigest !==
      sourceReviewEnvelope.review.bindings.pageParameterValuesDigest ||
    observation.bindings.reconciliationReviewDigest !==
      firstPageReview.bindings.reconciliationReviewDigest ||
    observation.bindings.scopeDigest !== firstPageReview.bindings.scopeDigest ||
    observation.bindings.expectedReceiptZeroDigest !==
      firstPageReview.bindings.expectedReceiptZeroDigest ||
    observation.bindings.historicalInstallMarkerDigest !==
      firstPageReview.bindings.historicalInstallMarkerDigest ||
    parameters.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length
  ) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-review-changed')
  }
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    databaseLedgerBound: false as const,
    chainVerificationAuthorityCreated: false as const,
    continuationAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      sourcePageObservationDigest,
      sourcePageResponseDigest: observation.bindings.responseDigest,
      sourcePageReviewDigest: sourceOwnReviewDigest(observation),
      reconciliationReviewDigest: firstPageReview.bindings.reconciliationReviewDigest,
      sourceParameterSchemaDigest: firstPageReview.bindings.sourceParameterSchemaDigest,
      sourceParameterValuesDigest: firstPageReview.bindings.sourceParameterValuesDigest,
      pageParameterSchemaDigest,
      pageParameterValuesDigest,
      expectedColumnInventoryDigest: firstPageReview.bindings.expectedColumnInventoryDigest,
      expectedConstraintInventoryDigest: firstPageReview.bindings.expectedConstraintInventoryDigest,
      scopeDigest: firstPageReview.bindings.scopeDigest,
      expectedReceiptZeroDigest: firstPageReview.bindings.expectedReceiptZeroDigest,
      historicalInstallMarkerDigest: firstPageReview.bindings.historicalInstallMarkerDigest,
      anchorDigest,
      pageSqlDigest,
      pageQueryDigest,
      pageTransportSizeCertificateDigest,
      pageRequestSizeCertificateDigest
    }),
    query: firstPageReview.query,
    parameters: Object.freeze({
      order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
      schema: parameterSchema,
      valueCount: 33 as const,
      valuesExposed: false as const,
      reusedReceiptZeroCASPrefixCount: 28 as const,
      suffixBoundFromGenuinePreviousPage: true as const
    }),
    catalogGuard: firstPageReview.catalogGuard,
    page: Object.freeze({
      kind: 'continuation' as const,
      afterRevision,
      maximumReceiptCount: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE,
      lookaheadReceiptCount: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_LOOKAHEAD_SIZE,
      keysetOrder: 'revision-ascending' as const,
      sourcePageStatus: 'page-ready' as const,
      anchor,
      continuationBindsExactAnchor: true as const,
      staleAnchorReanchoredAutomatically: false as const,
      crossPageSingleSnapshotClaimed: false as const
    }),
    transportSize: transportSizeReview,
    policy: Object.freeze({
      previousPageIdentityRequired: true as const,
      previousPageCanonicalReceiptsRetainedOnlyInTrustedContext: true as const,
      previewContainsPlaceholdersOnly: true as const,
      canonicalValuesKeptInTrustedContextOnly: true as const,
      requestDispatched: false as const,
      managedDataReadPerformed: false as const,
      productionResponseAuthenticated: false as const,
      responseParserCreated: true as const,
      boundedResponseWireDecoderCreated: true as const,
      localRequestAndResponseBoundsCertified: true as const,
      pageCollectionPerformed: false as const,
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
      ...firstPageReview.artifact,
      path: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_ARTIFACT_PATH,
      requestDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: uniqueBlockers([
      ...firstPageReview.blockers.filter(
        (blocker) => blocker !== 'receipt-v2-chain-first-page-review-only'
      ),
      ...BLOCKERS
    ])
  }) satisfies SupabaseBackfillReceiptV2ChainContinuationReviewV1
  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL
  })
  if (trustedPageSource(observation)?.context !== sourceObservationContext) {
    return fail('supabase-backfill-receipt-v2-chain-continuation-proof-invalid')
  }
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      sourceObservationContext,
      firstPageReviewContext,
      sourceParameters: firstPageReviewContext.sourceParameters,
      parameters
    })
  )
  return envelope
}

interface CurrentContinuationResponseReviewV1 {
  readonly review: SupabaseBackfillReceiptV2ChainContinuationReviewV1
  readonly expectation: SupabaseBackfillReceiptV2ChainPageParseExpectationV1
}

async function requireCurrentContinuationResponseReview(
  context: TrustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1
): Promise<CurrentContinuationResponseReviewV1> {
  const envelope = context.envelope
  const review = envelope.review
  const policy = review.policy as Readonly<{
    responseParserCreated: unknown
    boundedResponseWireDecoderCreated: unknown
    localRequestAndResponseBoundsCertified: unknown
    requestDispatched: unknown
    productionResponseAuthenticated: unknown
    pageCollectionPerformed: unknown
    fullPortableReceiptV2ChainVerified: unknown
  }>
  const transportSize = review.transportSize as Readonly<{
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
  const sourceObservationContext = context.sourceObservationContext
  const sourceObservation = sourceObservationContext.observation
  const pageSource = trustedPageSource(sourceObservation)
  const firstPageReviewContext = context.firstPageReviewContext
  const firstPageReview = firstPageReviewContext.envelope.review
  if (!pageSource || pageSource.context !== sourceObservationContext) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid')
  }
  const priorCanonicalReceipt = pageSource.canonicalReceipts.at(-1)
  const priorSummary = sourceObservation.receipts.at(-1)
  if (!priorCanonicalReceipt || !priorSummary) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid')
  }
  let priorReceiptDigest: string
  try {
    priorReceiptDigest = await digestBackendBackfillExecutionReceiptV2(priorCanonicalReceipt)
  } catch {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-digest-failed')
  }
  const baselinePromise = requireCurrentPageReview(
    firstPageReviewContext.envelope,
    firstPageReviewContext
  )
  const refreshedPromise = createSupabaseBackfillReceiptV2ChainContinuationReviewForTestingV1({
    previousPageObservation: sourceObservation
  })
  const [
    baseline,
    refreshed,
    currentReviewDigest,
    sourcePageObservationDigest,
    pageQueryDigest,
    pageSqlDigest,
    pageParameterSchemaDigest,
    pageParameterValuesDigest,
    anchorDigest,
    pageTransportSizeCertificateDigest,
    pageRequestSizeCertificateDigest,
    requestSizeCertificateVerified
  ] = await Promise.all([
    baselinePromise,
    refreshedPromise,
    digest(review),
    digest(sourceObservation),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_FIXED_QUERY),
    digestRawText(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL),
    digest(review.parameters.schema),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-page-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER,
        values: context.parameters
      })
    ),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-anchor.v1' as const,
        version: 1 as const,
        ...review.page.anchor
      })
    ),
    digest(SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1),
    digest(transportSize.request),
    verifySupabaseBackfillReceiptV2ChainRequestSizeCertificateV1(
      context.parameters,
      transportSize.request
    )
  ])
  const afterRevision = review.page.afterRevision
  const parameters = context.parameters
  const anchor = review.page.anchor
  if (
    trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(envelope) !== context ||
    trustedPageSource(sourceObservation)?.context !== sourceObservationContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      firstPageReviewContext.envelope
    ) !== firstPageReviewContext ||
    refreshed.reviewDigest !== envelope.reviewDigest ||
    currentReviewDigest !== envelope.reviewDigest ||
    envelope.previewSql !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SQL ||
    policy.responseParserCreated !== true ||
    policy.boundedResponseWireDecoderCreated !== true ||
    policy.localRequestAndResponseBoundsCertified !== true ||
    policy.requestDispatched !== false ||
    policy.productionResponseAuthenticated !== false ||
    policy.pageCollectionPerformed !== false ||
    policy.fullPortableReceiptV2ChainVerified !== false ||
    review.query !== firstPageReview.query ||
    transportSize.limits !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_TRANSPORT_SIZE_CERTIFICATE_V1 ||
    !verifySupabaseBackfillReceiptV2ChainTransportSizeCertificateV1(transportSize.limits) ||
    !requestSizeCertificateVerified ||
    transportSize.localRequestAndResponseBoundsCertified !== true ||
    transportSize.decodedAggregateBoundCertified !== true ||
    transportSize.productionResponseProvenanceAuthenticated !== false ||
    transportSize.productionTransportAuthenticated !== false ||
    transportSize.transportAuthorityCreated !== false ||
    transportSize.databaseAuthorityCreated !== false ||
    transportSize.releaseAuthorityCreated !== false ||
    review.parameters.schema !== firstPageReview.parameters.schema ||
    review.bindings.sourcePageObservationDigest !== sourcePageObservationDigest ||
    review.bindings.sourcePageResponseDigest !== sourceObservation.bindings.responseDigest ||
    review.bindings.sourcePageReviewDigest !== sourceOwnReviewDigest(sourceObservation) ||
    review.bindings.reconciliationReviewDigest !== baseline.reconciliationReviewDigest ||
    review.bindings.scopeDigest !== baseline.scopeDigest ||
    review.bindings.expectedReceiptZeroDigest !== baseline.expectedReceiptZeroDigest ||
    review.bindings.historicalInstallMarkerDigest !== baseline.historicalInstallMarkerDigest ||
    review.bindings.pageQueryDigest !== pageQueryDigest ||
    review.bindings.pageSqlDigest !== pageSqlDigest ||
    review.bindings.pageParameterSchemaDigest !== pageParameterSchemaDigest ||
    review.bindings.pageParameterValuesDigest !== pageParameterValuesDigest ||
    review.bindings.pageTransportSizeCertificateDigest !== pageTransportSizeCertificateDigest ||
    review.bindings.pageRequestSizeCertificateDigest !== pageRequestSizeCertificateDigest ||
    refreshed.review.bindings.pageTransportSizeCertificateDigest !==
      review.bindings.pageTransportSizeCertificateDigest ||
    refreshed.review.bindings.pageRequestSizeCertificateDigest !==
      review.bindings.pageRequestSizeCertificateDigest ||
    review.bindings.anchorDigest !== anchorDigest ||
    parameters.length !== SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_PARAMETER_ORDER.length ||
    !context.sourceParameters.every((value, index) => parameters[index] === value) ||
    parameters[28] !== String(afterRevision) ||
    parameters[29] !== String(anchor.revision) ||
    parameters[30] !== anchor.eventId ||
    parameters[31] !== anchor.receiptDigest ||
    parameters[32] !== anchor.updatedAt ||
    priorSummary.revision !== afterRevision ||
    priorCanonicalReceipt.databaseHeadVersion !== afterRevision ||
    priorCanonicalReceipt.databaseEventId !== priorSummary.eventId ||
    priorReceiptDigest !== priorSummary.receiptDigest
  ) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-review-changed')
  }
  return Object.freeze({
    review,
    expectation: Object.freeze({
      ...baseline,
      pageMode: 'continuation' as const,
      afterRevision,
      anchor,
      priorReceipt: Object.freeze({
        revision: afterRevision,
        eventId: priorSummary.eventId,
        receiptDigest: priorSummary.receiptDigest
      })
    })
  })
}

function remapContinuationResponseFailure(cause: unknown): never {
  if (cause instanceof SupabaseBackfillReceiptV2ChainContinuationResponseError) throw cause
  if (cause instanceof SupabaseBackfillReceiptV2ChainPageResponseError) {
    const mappings: Readonly<
      Record<
        SupabaseBackfillReceiptV2ChainPageResponseError['code'],
        SupabaseBackfillReceiptV2ChainContinuationResponseErrorCode
      >
    > = {
      'supabase-backfill-receipt-v2-chain-page-response-input-invalid':
        'supabase-backfill-receipt-v2-chain-continuation-response-invalid',
      'supabase-backfill-receipt-v2-chain-page-response-proof-invalid':
        'supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid',
      'supabase-backfill-receipt-v2-chain-page-response-review-changed':
        'supabase-backfill-receipt-v2-chain-continuation-response-review-changed',
      'supabase-backfill-receipt-v2-chain-page-response-invalid':
        'supabase-backfill-receipt-v2-chain-continuation-response-invalid',
      'supabase-backfill-receipt-v2-chain-page-response-binding-mismatch':
        'supabase-backfill-receipt-v2-chain-continuation-response-binding-mismatch',
      'supabase-backfill-receipt-v2-chain-page-response-receipt-invalid':
        'supabase-backfill-receipt-v2-chain-continuation-response-receipt-invalid',
      'supabase-backfill-receipt-v2-chain-page-response-digest-failed':
        'supabase-backfill-receipt-v2-chain-continuation-response-digest-failed'
    }
    return failResponse(mappings[cause.code])
  }
  if (cause instanceof SupabaseBackfillReceiptV2ChainContinuationReviewError) {
    if (cause.code === 'supabase-backfill-receipt-v2-chain-continuation-digest-failed') {
      return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-digest-failed')
    }
    if (cause.code === 'supabase-backfill-receipt-v2-chain-continuation-review-changed') {
      return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-review-changed')
    }
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid')
  }
  return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-invalid')
}

/** Parse one injected continuation page without creating transport, database, or release authority. */
export async function parseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingV1(
  input: ParseSupabaseBackfillReceiptV2ChainContinuationResponseForTestingOptionsV1
): Promise<SupabaseBackfillReceiptV2ChainContinuationPageObservationV1> {
  const source = exactResponseInput(input)
  const reviewValue = responseOwnData(source, 'continuationReview')
  const reviewContext =
    trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(reviewValue)
  if (!reviewContext || reviewContext.envelope !== reviewValue) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid')
  }
  const responseValue = responseOwnData(source, 'response')
  const currentPromise = requireCurrentContinuationResponseReview(reviewContext)
  const expectationPromise = currentPromise.then((current) => current.expectation)
  // The decoder snapshots the response before awaiting this promise and may reject first. Mark the
  // derived rejection handled without changing what the decoder observes.
  void expectationPromise.catch(() => undefined)
  const decodedPromise = decodeSupabaseBackfillReceiptV2ChainPageResponseForTestingV1(
    responseValue,
    expectationPromise
  )
  let current: CurrentContinuationResponseReviewV1
  let decoded: Awaited<typeof decodedPromise>
  try {
    ;[current, decoded] = await Promise.all([currentPromise, decodedPromise])
  } catch (cause) {
    return remapContinuationResponseFailure(cause)
  }
  const review = current.review
  const sourceObservationContext = reviewContext.sourceObservationContext
  const firstPageReviewContext = reviewContext.firstPageReviewContext
  if (
    trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(reviewContext.envelope) !==
      reviewContext ||
    trustedPageSource(sourceObservationContext.observation)?.context !== sourceObservationContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      firstPageReviewContext.envelope
    ) !== firstPageReviewContext
  ) {
    return failResponse('supabase-backfill-receipt-v2-chain-continuation-response-proof-invalid')
  }
  const observation = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_CONTINUATION_PAGE_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    pageMode: 'continuation' as const,
    reportedStatus: decoded.reportedStatus,
    status: decoded.status,
    reconciliation: Object.freeze({
      reportedStatus: decoded.reconciliation.reportedStatus,
      status: decoded.reconciliation.status,
      reportedStatusMatchesRecomputedFacts: true as const
    }),
    bindings: Object.freeze({
      continuationReviewDigest: reviewContext.envelope.reviewDigest,
      sourcePageObservationDigest: review.bindings.sourcePageObservationDigest,
      sourcePageResponseDigest: review.bindings.sourcePageResponseDigest,
      sourcePageReviewDigest: review.bindings.sourcePageReviewDigest,
      pageQueryDigest: review.bindings.pageQueryDigest,
      pageSqlDigest: review.bindings.pageSqlDigest,
      pageParameterSchemaDigest: review.bindings.pageParameterSchemaDigest,
      pageParameterValuesDigest: review.bindings.pageParameterValuesDigest,
      reconciliationReviewDigest: review.bindings.reconciliationReviewDigest,
      reconciliationResponseDigest: decoded.reconciliation.bindings.responseDigest,
      scopeDigest: review.bindings.scopeDigest,
      expectedReceiptZeroDigest: review.bindings.expectedReceiptZeroDigest,
      historicalInstallMarkerDigest: review.bindings.historicalInstallMarkerDigest,
      observedInstallMarkerDigest: decoded.installMarkerDigest,
      anchorDigest: review.bindings.anchorDigest,
      responseDigest: decoded.responseDigest
    }),
    afterRevision: review.page.afterRevision,
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
    releaseReady: false as const,
    previousPageIdentityVerified: true as const,
    priorReceiptExpectationEnforced: true as const,
    staleAnchorReanchoredAutomatically: false as const
  }) satisfies SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
  trustedContinuationObservations.set(
    observation,
    Object.freeze({
      observation,
      reviewContext,
      canonicalReceipts: decoded.canonicalReceipts
    })
  )
  return observation
}

/** Identity-only lookup for a strictly parsed continuation observation. */
export function trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedContinuationObservations.get(value)
  if (
    !context ||
    context.observation !== value ||
    trustedReviews.get(context.reviewContext.envelope) !== context.reviewContext ||
    trustedPageSource(context.reviewContext.sourceObservationContext.observation)?.context !==
      context.reviewContext.sourceObservationContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      context.reviewContext.firstPageReviewContext.envelope
    ) !== context.reviewContext.firstPageReviewContext
  ) {
    return null
  }
  return context
}

/** Identity-only lookup; no query, credential, continuation, or release authority is returned. */
export function trustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptV2ChainContinuationReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (
    !context ||
    context.envelope !== value ||
    trustedPageSource(context.sourceObservationContext.observation)?.context !==
      context.sourceObservationContext ||
    trustedSupabaseBackfillReceiptV2ChainFirstPageReviewContextV1(
      context.firstPageReviewContext.envelope
    ) !== context.firstPageReviewContext
  ) {
    return null
  }
  return context
}
