/* oxlint-disable eslint(max-lines) -- This security boundary keeps the public contract, opaque contexts, lifecycle, and validation together for reviewability. */
import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import type { SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER } from './receipt/zero/cas/review'
import {
  parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1,
  type SupabaseBackfillReceiptZeroReconciliationObservationV1
} from './receipt/zero/reconciliation/response'
import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS,
  SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL,
  trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1,
  type SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
} from './receipt/zero/reconciliation/review'

export const SUPABASE_BACKFILL_TESTING_FIXED_READ_HARNESS_FORMAT =
  'openpencil.supabase-backfill-testing-fixed-read-harness.v1' as const
export const SUPABASE_BACKFILL_TESTING_FIXED_READ_SESSION_FORMAT =
  'openpencil.supabase-backfill-testing-fixed-read-session.v1' as const
export const SUPABASE_BACKFILL_TESTING_FIXED_READ_RESULT_FORMAT =
  'openpencil.supabase-backfill-testing-fixed-read-result.v1' as const
export const SUPABASE_BACKFILL_TESTING_FIXED_READ_INVOCATION_FORMAT =
  'openpencil.supabase-backfill-testing-fixed-read-invocation.v1' as const

export const SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS = Object.freeze({
  requestBytes: 262_144,
  reconciliationResponseBytes: 131_072,
  harnessTimeoutMs: 15_000
})

const CREATE_SESSION_KEYS = ['harness', 'reconciliationReview', 'signal'] as const
const REQUIRED_CREATE_SESSION_KEYS = ['harness', 'reconciliationReview'] as const
const RUN_SESSION_KEYS = ['session'] as const
const SAFE_SEARCH_PATH = Object.freeze(['pg_catalog'] as const)
// oxlint-disable-next-line typescript-eslint/unbound-method -- Captured intrinsic is called only through Reflect.apply with an explicit receiver.
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted'
)?.get
// oxlint-disable-next-line typescript-eslint/unbound-method -- Captured intrinsic is called only through Reflect.apply with an explicit receiver.
const EVENT_TARGET_ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener
// oxlint-disable-next-line typescript-eslint/unbound-method -- Captured intrinsic is called only through Reflect.apply with an explicit receiver.
const EVENT_TARGET_REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener

type ParameterValue = string | null
type MaybePromise<T> = T | Promise<T>
type UnknownRecord = Record<PropertyKey, unknown>

export interface SupabaseBackfillFixedReadHarnessForTestingV1 {
  readonly format: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_HARNESS_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly responseSource: 'injected-process-local-callback'
}

export interface SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1 {
  readonly format: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_INVOCATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly variant: 'receipt-zero-reconciliation'
  readonly bindings: Readonly<{
    reconciliationReviewDigest: string
    staticSqlSafetyCertificateDigest: string
    reconciliationSqlDigest: string
    reconciliationQueryDigest: string
    queryContractDigest: string
    analysisProfileDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    responseFieldsDigest: string
    ledgerShapeDigest: string
    expectedColumnInventoryDigest: string
    expectedConstraintInventoryDigest: string
    scopeDigest: string
    receiptDigest: string
    candidateOperationEvidenceDigest: string
    historicalInstallMarkerDigest: string
  }>
  readonly query: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION
    statementCount: 1
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    parameterOrder: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER
    responseFields: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS
    rawSqlCrossedHarnessBoundary: false
    endpointCrossedHarnessBoundary: false
  }>
  readonly requirements: Readonly<{
    configuredSearchPath: typeof SAFE_SEARCH_PATH
    transportEnforcedReadOnlyBoundary: true
    liveCatalogSemanticsAuthentication: true
    serverStatementTimeoutMs: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs
    maximumResponseBytes: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
  }>
  readonly parameters: readonly ParameterValue[]
}

export type SupabaseBackfillFixedReadInvocationForTestingV1 =
  SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1

export type SupabaseBackfillFixedReadResponseProviderForTestingV1 = (
  invocation: SupabaseBackfillFixedReadInvocationForTestingV1,
  signal: AbortSignal
) => MaybePromise<Uint8Array>

export interface CreateSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingOptionsV1 {
  readonly harness: SupabaseBackfillFixedReadHarnessForTestingV1
  readonly reconciliationReview: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly signal?: AbortSignal
}

export interface SupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1 {
  readonly format: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_SESSION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly variant: 'receipt-zero-reconciliation'
  readonly lifetime: 'single-run'
  readonly sessionDigest: string
  readonly bindings: SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1['bindings']
  readonly contract: Readonly<{
    queryId: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID
    queryVersion: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION
    statementCount: 1
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
    parameterCount: 28
    responseFieldCount: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length
    configuredSearchPathRequired: typeof SAFE_SEARCH_PATH
    harnessTimeoutMs: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs
    maximumRequestBytes: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.requestBytes
    maximumResponseBytes: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
  }>
  readonly requestByteLength: number
  readonly requestDigest: string
  readonly parameterValuesRetainedInSession: false
  readonly productionTransportCreated: false
  readonly productionTransportAuthenticated: false
  readonly readOnlyBoundaryAuthenticated: false
  readonly liveCatalogSemanticsAuthenticated: false
  readonly serverStatementTimeoutAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillFixedReadSessionForTestingV1 =
  SupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1

export interface RunSupabaseBackfillFixedReadSessionForTestingOptionsV1 {
  readonly session: SupabaseBackfillFixedReadSessionForTestingV1
}

export interface DisposeSupabaseBackfillFixedReadSessionForTestingOptionsV1 {
  readonly session: SupabaseBackfillFixedReadSessionForTestingV1
}

export interface SupabaseBackfillReceiptZeroReconciliationFixedReadResultForTestingV1 {
  readonly format: typeof SUPABASE_BACKFILL_TESTING_FIXED_READ_RESULT_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly processLocalOnly: true
  readonly variant: 'receipt-zero-reconciliation'
  readonly resultDigest: string
  readonly sessionDigest: string
  readonly requestDigest: string
  readonly responseByteLength: number
  readonly observation: SupabaseBackfillReceiptZeroReconciliationObservationV1
  readonly injectedResponseProviderInvoked: true
  readonly callbackSideEffectsAuthenticated: false
  readonly productionRequestDispatchAuthenticated: false
  readonly productionTransportCreationAuthenticated: false
  readonly productionTransportAuthenticated: false
  readonly readOnlyBoundaryAuthenticated: false
  readonly liveCatalogSemanticsAuthenticated: false
  readonly serverStatementTimeoutAuthenticated: false
  readonly responseSnapshotAuthenticated: false
  readonly automaticRetryAllowed: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillFixedReadResultForTestingV1 =
  SupabaseBackfillReceiptZeroReconciliationFixedReadResultForTestingV1

export interface TrustedSupabaseBackfillFixedReadResultContextForTestingV1 {
  readonly result: SupabaseBackfillFixedReadResultForTestingV1
  readonly session: SupabaseBackfillFixedReadSessionForTestingV1
  readonly observation: SupabaseBackfillReceiptZeroReconciliationObservationV1
}

export type SupabaseBackfillTestingFixedReadSessionErrorCode =
  | 'supabase-backfill-testing-fixed-read-input-invalid'
  | 'supabase-backfill-testing-fixed-read-harness-untrusted'
  | 'supabase-backfill-testing-fixed-read-session-proof-invalid'
  | 'supabase-backfill-testing-fixed-read-session-consumed'
  | 'supabase-backfill-testing-fixed-read-review-changed'
  | 'supabase-backfill-testing-fixed-read-request-too-large'
  | 'supabase-backfill-testing-fixed-read-response-too-large'
  | 'supabase-backfill-testing-fixed-read-response-invalid'
  | 'supabase-backfill-testing-fixed-read-response-provider-failed'
  | 'supabase-backfill-testing-fixed-read-aborted'
  | 'supabase-backfill-testing-fixed-read-timeout'
  | 'supabase-backfill-testing-fixed-read-digest-failed'

export class SupabaseBackfillTestingFixedReadSessionError extends Error {
  constructor(readonly code: SupabaseBackfillTestingFixedReadSessionErrorCode) {
    super(`Supabase backfill testing fixed-read session failed: ${code}.`)
    this.name = 'SupabaseBackfillTestingFixedReadSessionError'
  }
}

interface HarnessContext {
  readonly harness: SupabaseBackfillFixedReadHarnessForTestingV1
  readonly provideResponse: SupabaseBackfillFixedReadResponseProviderForTestingV1
}

interface SessionContext {
  readonly session: SupabaseBackfillFixedReadSessionForTestingV1
  readonly harnessContext: HarnessContext
  readonly review: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
  readonly reviewContext: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
  readonly invocation: SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1
  readonly signal: AbortSignal | undefined
}

const trustedHarnesses = new WeakMap<object, HarnessContext>()
const trustedSessions = new WeakMap<object, SessionContext>()
const consumedSessions = new WeakSet<object>()
const trustedResults = new WeakMap<
  object,
  Readonly<{
    publicContext: TrustedSupabaseBackfillFixedReadResultContextForTestingV1
    review: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1
    reviewContext: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
  }>
>()

function fail(code: SupabaseBackfillTestingFixedReadSessionErrorCode): never {
  throw new SupabaseBackfillTestingFixedReadSessionError(code)
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseBackfillTestingFixedReadSessionErrorCode
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

function exactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
  code: SupabaseBackfillTestingFixedReadSessionErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    return fail(code)
  }
  for (const key of keys) ownData(value, key, code)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-testing-fixed-read-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const encoded = new TextEncoder().encode(value)
    const copy = new Uint8Array(encoded.byteLength)
    copy.set(encoded)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-testing-fixed-read-digest-failed')
  }
}

function snapshotParameters(
  values: readonly ParameterValue[],
  expectedCount: number
): readonly ParameterValue[] {
  if (
    !Array.isArray(values) ||
    values.length !== expectedCount ||
    Reflect.ownKeys(values).some((key) => {
      if (key === 'length') return false
      return (
        typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= values.length
      )
    })
  ) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  const snapshot = values.map((value) => {
    if (value !== null && typeof value !== 'string') {
      return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
    }
    return value
  })
  if (snapshot.length !== expectedCount) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  return Object.freeze(snapshot)
}

function nativeAbortSignalState(value: unknown): boolean | null {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof ABORT_SIGNAL_ABORTED_GETTER !== 'function'
  ) {
    return null
  }
  try {
    const aborted = Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, value, []) as unknown
    return typeof aborted === 'boolean' ? aborted : null
  } catch {
    return null
  }
}

function isNativeAbortSignal(value: unknown): value is AbortSignal {
  return nativeAbortSignalState(value) !== null
}

function nativeAbortSignalAborted(signal: AbortSignal): boolean {
  const aborted = nativeAbortSignalState(signal)
  if (aborted === null) return fail('supabase-backfill-testing-fixed-read-input-invalid')
  return aborted
}

function addNativeAbortListener(signal: AbortSignal, listener: () => void): void {
  try {
    Reflect.apply(EVENT_TARGET_ADD_EVENT_LISTENER, signal, ['abort', listener, { once: true }])
  } catch {
    return fail('supabase-backfill-testing-fixed-read-input-invalid')
  }
}

function removeNativeAbortListener(signal: AbortSignal, listener: () => void): void {
  try {
    Reflect.apply(EVENT_TARGET_REMOVE_EVENT_LISTENER, signal, ['abort', listener])
  } catch {
    return fail('supabase-backfill-testing-fixed-read-input-invalid')
  }
}

function requireCurrentReview(
  review: SupabaseBackfillReceiptZeroReconciliationReviewEnvelopeV1,
  expected: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1,
  code:
    | 'supabase-backfill-testing-fixed-read-session-proof-invalid'
    | 'supabase-backfill-testing-fixed-read-review-changed'
): TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1 {
  const current = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(review)
  if (current !== expected) return fail(code)
  return current
}

function requireEqualProofBindings(pairs: readonly (readonly [unknown, unknown])[]): void {
  if (pairs.some(([actual, expected]) => actual !== expected)) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
}

async function invocationFor(
  reviewContext: TrustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1
): Promise<
  Readonly<{
    invocation: SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1
    requestByteLength: number
    requestDigest: string
  }>
> {
  const envelope = reviewContext.envelope
  const review = envelope.review
  const certificateEnvelope = reviewContext.staticSqlSafetyContext.envelope
  const certificate = certificateEnvelope.certificate
  const parameters = snapshotParameters(reviewContext.parameters, 28)
  const queryContract = Object.freeze({
    format: 'openpencil.supabase-backfill-read-query-contract.v1' as const,
    version: 1 as const,
    queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
    parameterOrder: review.parameters.order,
    responseFields: review.query.responseFields
  })
  const parameterValuesEnvelope = Object.freeze({
    format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
    version: 1 as const,
    order: review.parameters.order,
    values: parameters
  })
  const [
    reviewDigest,
    certificateDigest,
    sqlDigest,
    queryDigest,
    queryContractDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    responseFieldsDigest
  ] = await Promise.all([
    digest(review),
    digest(certificate),
    digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL),
    digest(SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_FIXED_QUERY),
    digest(queryContract),
    digest(review.parameters.schema),
    digest(parameterValuesEnvelope),
    digest(review.query.responseFields)
  ])
  requireEqualProofBindings([
    [reviewDigest, envelope.reviewDigest],
    [certificateDigest, certificateEnvelope.certificateDigest],
    [review.bindings.staticSqlSafetyCertificateDigest, certificateDigest],
    [review.bindings.reconciliationSqlDigest, sqlDigest],
    [review.bindings.reconciliationQueryDigest, queryDigest],
    [review.bindings.parameterSchemaDigest, parameterSchemaDigest],
    [review.bindings.parameterValuesDigest, parameterValuesDigest],
    [certificate.bindings.sqlDigest, sqlDigest],
    [certificate.bindings.queryDigest, queryDigest],
    [certificate.bindings.queryContractDigest, queryContractDigest],
    [review.query.queryId, SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID],
    [review.query.queryVersion, SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION],
    [review.query.statementCount, 1],
    [review.query.accessMode, 'read-only'],
    [review.query.snapshotScope, 'single-statement'],
    [review.query.managementReadOnlyEndpointSemanticallyCompatible, false],
    [review.query.hostTransportCreated, false],
    [JSON.stringify(review.catalogGuard.effectiveSearchPath), JSON.stringify(SAFE_SEARCH_PATH)]
  ])
  if (
    review.query.responseFields !== SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS ||
    reviewContext.staticSqlSafetyContext.sql !==
      SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL ||
    SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL.includes('current_schemas') ||
    !SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_SQL.includes(
      '"pg_catalog"."current_setting"(\'search_path\') = \'pg_catalog\''
    )
  ) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }

  const bindings = Object.freeze({
    reconciliationReviewDigest: envelope.reviewDigest,
    staticSqlSafetyCertificateDigest: certificateEnvelope.certificateDigest,
    reconciliationSqlDigest: sqlDigest,
    reconciliationQueryDigest: queryDigest,
    queryContractDigest,
    analysisProfileDigest: certificate.bindings.analysisProfileDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    responseFieldsDigest,
    ledgerShapeDigest: review.bindings.ledgerShapeDigest,
    expectedColumnInventoryDigest: review.bindings.expectedColumnInventoryDigest,
    expectedConstraintInventoryDigest: review.bindings.expectedConstraintInventoryDigest,
    scopeDigest: reviewContext.casContext.envelope.review.bindings.scopeDigest,
    receiptDigest: reviewContext.casContext.envelope.review.bindings.receiptDigest,
    candidateOperationEvidenceDigest:
      reviewContext.casContext.envelope.review.bindings.candidateOperationEvidenceDigest,
    historicalInstallMarkerDigest: review.bindings.historicalInstallMarkerDigest
  })
  const invocation = Object.freeze({
    format: SUPABASE_BACKFILL_TESTING_FIXED_READ_INVOCATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    processLocalOnly: true as const,
    variant: 'receipt-zero-reconciliation' as const,
    bindings,
    query: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      statementCount: 1 as const,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      parameterOrder: review.parameters.order,
      responseFields: review.query.responseFields,
      rawSqlCrossedHarnessBoundary: false as const,
      endpointCrossedHarnessBoundary: false as const
    }),
    requirements: Object.freeze({
      configuredSearchPath: SAFE_SEARCH_PATH,
      transportEnforcedReadOnlyBoundary: true as const,
      liveCatalogSemanticsAuthentication: true as const,
      serverStatementTimeoutMs: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs,
      maximumResponseBytes: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
    }),
    parameters
  }) satisfies SupabaseBackfillReceiptZeroReconciliationFixedReadInvocationForTestingV1
  let requestByteLength: number
  try {
    requestByteLength = new TextEncoder().encode(JSON.stringify(invocation)).byteLength
  } catch {
    return fail('supabase-backfill-testing-fixed-read-digest-failed')
  }
  if (requestByteLength > SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.requestBytes) {
    return fail('supabase-backfill-testing-fixed-read-request-too-large')
  }
  return Object.freeze({
    invocation,
    requestByteLength,
    requestDigest: await digest(invocation)
  })
}

interface Deadline {
  readonly signal: AbortSignal
  readonly cancellation: Error
  readonly cancellationCode: () =>
    | 'supabase-backfill-testing-fixed-read-aborted'
    | 'supabase-backfill-testing-fixed-read-timeout'
  readonly race: <T>(pending: Promise<T>) => Promise<T>
  readonly dispose: () => void
}

function deadline(externalSignal: AbortSignal | undefined): Deadline {
  const controller = new AbortController()
  const cancellation = Object.freeze(new Error('Testing fixed-read deadline canceled.'))
  let timedOut = false
  const abort = () => controller.abort()
  if (externalSignal && nativeAbortSignalAborted(externalSignal)) {
    return fail('supabase-backfill-testing-fixed-read-aborted')
  }
  if (externalSignal) addNativeAbortListener(externalSignal, abort)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs)
  const canceled = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(cancellation), { once: true })
  })
  return Object.freeze({
    signal: controller.signal,
    cancellation,
    cancellationCode() {
      return timedOut
        ? 'supabase-backfill-testing-fixed-read-timeout'
        : 'supabase-backfill-testing-fixed-read-aborted'
    },
    race<T>(pending: Promise<T>): Promise<T> {
      return Promise.race([pending, canceled])
    },
    dispose() {
      clearTimeout(timer)
      if (externalSignal) removeNativeAbortListener(externalSignal, abort)
    }
  })
}

function isUint8Array(value: unknown): value is Uint8Array {
  try {
    return value instanceof Uint8Array
  } catch {
    return false
  }
}

function responseBytes(value: unknown): Uint8Array {
  if (!isUint8Array(value)) {
    return fail('supabase-backfill-testing-fixed-read-response-invalid')
  }
  let byteLength: number
  try {
    byteLength = value.byteLength
  } catch {
    return fail('supabase-backfill-testing-fixed-read-response-invalid')
  }
  if (byteLength > SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes) {
    return fail('supabase-backfill-testing-fixed-read-response-too-large')
  }
  try {
    const snapshot = new Uint8Array(byteLength)
    snapshot.set(value)
    return snapshot
  } catch {
    return fail('supabase-backfill-testing-fixed-read-response-invalid')
  }
}

function parseResponse(bytes: Uint8Array): unknown {
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return JSON.parse(json) as unknown
  } catch {
    return fail('supabase-backfill-testing-fixed-read-response-invalid')
  }
}

export function createSupabaseBackfillFixedReadHarnessForTestingV1(
  provideResponse: SupabaseBackfillFixedReadResponseProviderForTestingV1
): SupabaseBackfillFixedReadHarnessForTestingV1 {
  if (typeof provideResponse !== 'function') {
    return fail('supabase-backfill-testing-fixed-read-input-invalid')
  }
  const harness = Object.freeze({
    format: SUPABASE_BACKFILL_TESTING_FIXED_READ_HARNESS_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    testingOnly: true as const,
    processLocalOnly: true as const,
    responseSource: 'injected-process-local-callback' as const
  })
  trustedHarnesses.set(harness, Object.freeze({ harness, provideResponse }))
  return harness
}

export async function createSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1(
  input: CreateSupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1> {
  const source = exactRecord(
    input,
    CREATE_SESSION_KEYS,
    REQUIRED_CREATE_SESSION_KEYS,
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  const harnessValue = ownData(
    source,
    'harness',
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  const harnessContext =
    harnessValue !== null && typeof harnessValue === 'object'
      ? trustedHarnesses.get(harnessValue)
      : undefined
  if (!harnessContext || harnessContext.harness !== harnessValue) {
    return fail('supabase-backfill-testing-fixed-read-harness-untrusted')
  }
  const reviewValue = ownData(
    source,
    'reconciliationReview',
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  const reviewContext = trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(reviewValue)
  if (!reviewContext || reviewContext.envelope !== reviewValue) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  const signalValue = Object.hasOwn(source, 'signal')
    ? ownData(source, 'signal', 'supabase-backfill-testing-fixed-read-input-invalid')
    : undefined
  if (signalValue !== undefined && !isNativeAbortSignal(signalValue)) {
    return fail('supabase-backfill-testing-fixed-read-input-invalid')
  }
  const material = await invocationFor(reviewContext)
  requireCurrentReview(
    reviewContext.envelope,
    reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const withoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_TESTING_FIXED_READ_SESSION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    processLocalOnly: true as const,
    variant: 'receipt-zero-reconciliation' as const,
    lifetime: 'single-run' as const,
    bindings: material.invocation.bindings,
    contract: Object.freeze({
      queryId: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_ID,
      queryVersion: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_QUERY_VERSION,
      statementCount: 1 as const,
      accessMode: 'read-only' as const,
      snapshotScope: 'single-statement' as const,
      parameterCount: 28 as const,
      responseFieldCount: SUPABASE_BACKFILL_RECEIPT_ZERO_RECONCILIATION_RESPONSE_FIELDS.length,
      configuredSearchPathRequired: SAFE_SEARCH_PATH,
      harnessTimeoutMs: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.harnessTimeoutMs,
      maximumRequestBytes: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.requestBytes,
      maximumResponseBytes: SUPABASE_BACKFILL_TESTING_FIXED_READ_LIMITS.reconciliationResponseBytes
    }),
    requestByteLength: material.requestByteLength,
    requestDigest: material.requestDigest,
    parameterValuesRetainedInSession: false as const,
    productionTransportCreated: false as const,
    productionTransportAuthenticated: false as const,
    readOnlyBoundaryAuthenticated: false as const,
    liveCatalogSemanticsAuthenticated: false as const,
    serverStatementTimeoutAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  })
  const session = Object.freeze({
    ...withoutDigest,
    sessionDigest: await digest(withoutDigest)
  }) satisfies SupabaseBackfillReceiptZeroReconciliationFixedReadSessionForTestingV1
  requireCurrentReview(
    reviewContext.envelope,
    reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  trustedSessions.set(
    session,
    Object.freeze({
      session,
      harnessContext,
      review: reviewContext.envelope,
      reviewContext,
      invocation: material.invocation,
      signal: signalValue
    })
  )
  return session
}

export async function runSupabaseBackfillFixedReadSessionForTestingV1(
  input: RunSupabaseBackfillFixedReadSessionForTestingOptionsV1
): Promise<SupabaseBackfillFixedReadResultForTestingV1> {
  const source = exactRecord(
    input,
    RUN_SESSION_KEYS,
    RUN_SESSION_KEYS,
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  const sessionValue = ownData(
    source,
    'session',
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  if (sessionValue === null || typeof sessionValue !== 'object') {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  const context = trustedSessions.get(sessionValue)
  if (!context || context.session !== sessionValue) {
    return fail(
      consumedSessions.has(sessionValue)
        ? 'supabase-backfill-testing-fixed-read-session-consumed'
        : 'supabase-backfill-testing-fixed-read-session-proof-invalid'
    )
  }
  trustedSessions.delete(sessionValue)
  consumedSessions.add(sessionValue)
  requireCurrentReview(
    context.review,
    context.reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const publicSession = context.session
  const sessionWithoutDigest = Object.freeze({
    format: publicSession.format,
    version: publicSession.version,
    providerId: publicSession.providerId,
    environment: publicSession.environment,
    testingOnly: publicSession.testingOnly,
    processLocalOnly: publicSession.processLocalOnly,
    variant: publicSession.variant,
    lifetime: publicSession.lifetime,
    bindings: publicSession.bindings,
    contract: publicSession.contract,
    requestByteLength: publicSession.requestByteLength,
    requestDigest: publicSession.requestDigest,
    parameterValuesRetainedInSession: publicSession.parameterValuesRetainedInSession,
    productionTransportCreated: publicSession.productionTransportCreated,
    productionTransportAuthenticated: publicSession.productionTransportAuthenticated,
    readOnlyBoundaryAuthenticated: publicSession.readOnlyBoundaryAuthenticated,
    liveCatalogSemanticsAuthenticated: publicSession.liveCatalogSemanticsAuthenticated,
    serverStatementTimeoutAuthenticated: publicSession.serverStatementTimeoutAuthenticated,
    credentialAuthorityCreated: publicSession.credentialAuthorityCreated,
    transportAuthorityCreated: publicSession.transportAuthorityCreated,
    databaseAuthorityCreated: publicSession.databaseAuthorityCreated,
    mutationAuthorityCreated: publicSession.mutationAuthorityCreated,
    executionAuthorityCreated: publicSession.executionAuthorityCreated,
    receiptAuthorityCreated: publicSession.receiptAuthorityCreated,
    releaseAuthorityCreated: publicSession.releaseAuthorityCreated,
    releaseReady: publicSession.releaseReady
  })
  if ((await digest(sessionWithoutDigest)) !== publicSession.sessionDigest) {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  requireCurrentReview(
    context.review,
    context.reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const runDeadline = deadline(context.signal)
  let provided: unknown
  try {
    const pending = Promise.resolve().then(() =>
      Reflect.apply(context.harnessContext.provideResponse, undefined, [
        context.invocation,
        runDeadline.signal
      ])
    )
    provided = await runDeadline.race(pending)
  } catch (cause) {
    if (cause === runDeadline.cancellation) return fail(runDeadline.cancellationCode())
    return fail('supabase-backfill-testing-fixed-read-response-provider-failed')
  } finally {
    runDeadline.dispose()
  }
  requireCurrentReview(
    context.review,
    context.reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const bytes = responseBytes(provided)
  const response = parseResponse(bytes)
  const observation = await parseSupabaseBackfillReceiptZeroReconciliationResponseForTestingV1({
    reconciliationReview: context.review,
    response
  })
  requireCurrentReview(
    context.review,
    context.reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const withoutDigest = Object.freeze({
    format: SUPABASE_BACKFILL_TESTING_FIXED_READ_RESULT_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    processLocalOnly: true as const,
    variant: 'receipt-zero-reconciliation' as const,
    sessionDigest: context.session.sessionDigest,
    requestDigest: context.session.requestDigest,
    responseByteLength: bytes.byteLength,
    observation,
    injectedResponseProviderInvoked: true as const,
    callbackSideEffectsAuthenticated: false as const,
    productionRequestDispatchAuthenticated: false as const,
    productionTransportCreationAuthenticated: false as const,
    productionTransportAuthenticated: false as const,
    readOnlyBoundaryAuthenticated: false as const,
    liveCatalogSemanticsAuthenticated: false as const,
    serverStatementTimeoutAuthenticated: false as const,
    responseSnapshotAuthenticated: false as const,
    automaticRetryAllowed: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  })
  const result = Object.freeze({
    ...withoutDigest,
    resultDigest: await digest(withoutDigest)
  }) satisfies SupabaseBackfillReceiptZeroReconciliationFixedReadResultForTestingV1
  requireCurrentReview(
    context.review,
    context.reviewContext,
    'supabase-backfill-testing-fixed-read-review-changed'
  )
  const resultContext = Object.freeze({
    result,
    session: context.session,
    observation
  })
  trustedResults.set(
    result,
    Object.freeze({
      publicContext: resultContext,
      review: context.review,
      reviewContext: context.reviewContext
    })
  )
  return result
}

export function disposeSupabaseBackfillFixedReadSessionForTestingV1(
  input: DisposeSupabaseBackfillFixedReadSessionForTestingOptionsV1
): boolean {
  const source = exactRecord(
    input,
    RUN_SESSION_KEYS,
    RUN_SESSION_KEYS,
    'supabase-backfill-testing-fixed-read-input-invalid'
  )
  const session = ownData(source, 'session', 'supabase-backfill-testing-fixed-read-input-invalid')
  if (session === null || typeof session !== 'object') {
    return fail('supabase-backfill-testing-fixed-read-session-proof-invalid')
  }
  const context = trustedSessions.get(session)
  if (!context || context.session !== session) return false
  trustedSessions.delete(session)
  consumedSessions.add(session)
  return true
}

export function trustedSupabaseBackfillFixedReadResultContextForTestingV1(
  value: unknown
): TrustedSupabaseBackfillFixedReadResultContextForTestingV1 | null {
  if (value === null || typeof value !== 'object') return null
  const record = trustedResults.get(value)
  if (
    !record ||
    record.publicContext.result !== value ||
    !consumedSessions.has(record.publicContext.session) ||
    trustedSupabaseBackfillReceiptZeroReconciliationReviewContextV1(record.review) !==
      record.reviewContext
  ) {
    return null
  }
  return record.publicContext
}
