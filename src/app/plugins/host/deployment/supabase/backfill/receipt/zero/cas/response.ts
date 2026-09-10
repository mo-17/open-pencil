import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES,
  SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL,
  trustedSupabaseBackfillReceiptZeroCASReviewContextV1,
  type SupabaseBackfillReceiptZeroCASResultStateV1,
  type SupabaseBackfillReceiptZeroCASReviewEnvelopeV1,
  type TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
} from './review'

export const SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESPONSE_OBSERVATION_FORMAT =
  'openpencil.supabase-backfill-receipt-zero-cas-response-observation.v1' as const

const INPUT_KEYS = ['casReview', 'response'] as const
const RESPONSE_ROW_KEYS = ['status'] as const
const RESPONSE_STATES = new Set<string>(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESULT_STATES)

export interface ParseSupabaseBackfillReceiptZeroCASResponseForTestingOptionsV1 {
  readonly casReview: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1
  readonly response: unknown
}

/**
 * Sanitized interpretation of one testing-only CAS response. A reported state is not authenticated
 * database evidence and every state still requires a fresh read-only ledger reconciliation.
 */
export interface SupabaseBackfillReceiptZeroCASResponseObservationV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESPONSE_OBSERVATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly status: SupabaseBackfillReceiptZeroCASResultStateV1
  readonly bindings: Readonly<{
    casReviewDigest: string
    transactionSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    responseDigest: string
  }>
  readonly reportedStatusProvesDatabaseState: false
  readonly requiresReadOnlyReconciliation: true
  readonly automaticRetryAllowed: false
  readonly captureConsumed: false
  readonly hiddenParameterValuesExposed: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillReceiptZeroCASResponseErrorCode =
  | 'supabase-backfill-receipt-zero-cas-response-input-invalid'
  | 'supabase-backfill-receipt-zero-cas-response-proof-invalid'
  | 'supabase-backfill-receipt-zero-cas-response-input-changed'
  | 'supabase-backfill-receipt-zero-cas-response-invalid'
  | 'supabase-backfill-receipt-zero-cas-response-digest-failed'

export class SupabaseBackfillReceiptZeroCASResponseError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptZeroCASResponseErrorCode) {
    super(`Supabase backfill Receipt-zero CAS response parsing failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptZeroCASResponseError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

function fail(code: SupabaseBackfillReceiptZeroCASResponseErrorCode): never {
  throw new SupabaseBackfillReceiptZeroCASResponseError(code)
}

function ownKeys(
  value: object,
  code: SupabaseBackfillReceiptZeroCASResponseErrorCode
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
  code: SupabaseBackfillReceiptZeroCASResponseErrorCode
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
  code: SupabaseBackfillReceiptZeroCASResponseErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  try {
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
  for (const key of expectedKeys) ownData(value, key, code)
  return value as UnknownRecord
}

function exactInput(value: unknown): UnknownRecord {
  return exactPlainRecord(
    value,
    INPUT_KEYS,
    'supabase-backfill-receipt-zero-cas-response-input-invalid'
  )
}

function exactSingleStatusResponse(value: unknown): Readonly<{
  status: SupabaseBackfillReceiptZeroCASResultStateV1
  canonicalResponse: readonly Readonly<{ status: SupabaseBackfillReceiptZeroCASResultStateV1 }>[]
}> {
  const code = 'supabase-backfill-receipt-zero-cas-response-invalid' as const
  if (!Array.isArray(value)) return fail(code)
  let prototype: object | null
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
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
  const row = exactPlainRecord(ownData(value, '0', code), RESPONSE_ROW_KEYS, code)
  const status = ownData(row, 'status', code)
  if (typeof status !== 'string' || !RESPONSE_STATES.has(status)) return fail(code)
  const parsedStatus = status as SupabaseBackfillReceiptZeroCASResultStateV1
  return Object.freeze({
    status: parsedStatus,
    canonicalResponse: Object.freeze([Object.freeze({ status: parsedStatus })])
  })
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-response-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-receipt-zero-cas-response-digest-failed')
  }
}

async function requireCurrentReview(
  review: SupabaseBackfillReceiptZeroCASReviewEnvelopeV1,
  context: TrustedSupabaseBackfillReceiptZeroCASReviewContextV1
): Promise<
  Readonly<{
    casReviewDigest: string
    transactionSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
  }>
> {
  if (
    context.envelope !== review ||
    context.parameters.length !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER.length ||
    review.previewSql !== SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL
  ) {
    return fail('supabase-backfill-receipt-zero-cas-response-input-changed')
  }
  const [casReviewDigest, transactionSqlDigest, parameterSchemaDigest, parameterValuesDigest] =
    await Promise.all([
      digest(review.review),
      digestRawText(SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_SQL),
      digest(review.review.parameters.schema),
      digest(
        Object.freeze({
          format: 'openpencil.supabase-backfill-receipt-zero-cas-parameters.v1' as const,
          version: 1 as const,
          order: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_PARAMETER_ORDER,
          values: context.parameters
        })
      )
    ])
  if (
    casReviewDigest !== review.reviewDigest ||
    transactionSqlDigest !== review.review.bindings.transactionSqlDigest ||
    transactionSqlDigest !== review.review.artifact.digest ||
    parameterSchemaDigest !== review.review.bindings.parameterSchemaDigest ||
    parameterValuesDigest !== review.review.bindings.parameterValuesDigest
  ) {
    return fail('supabase-backfill-receipt-zero-cas-response-input-changed')
  }
  return Object.freeze({
    casReviewDigest,
    transactionSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest
  })
}

/**
 * Strictly parse one testing-only CAS response without consuming its capture or creating authority.
 * Even a successful reported status must be reconciled against a fresh read-only ledger snapshot.
 */
export async function parseSupabaseBackfillReceiptZeroCASResponseForTestingV1(
  input: ParseSupabaseBackfillReceiptZeroCASResponseForTestingOptionsV1
): Promise<SupabaseBackfillReceiptZeroCASResponseObservationV1> {
  const source = exactInput(input)
  const casReview = ownData(
    source,
    'casReview',
    'supabase-backfill-receipt-zero-cas-response-input-invalid'
  )
  const context = trustedSupabaseBackfillReceiptZeroCASReviewContextV1(casReview)
  if (!context || context.envelope !== casReview) {
    return fail('supabase-backfill-receipt-zero-cas-response-proof-invalid')
  }
  const bindings = await requireCurrentReview(context.envelope, context)
  const parsed = exactSingleStatusResponse(
    ownData(source, 'response', 'supabase-backfill-receipt-zero-cas-response-input-invalid')
  )
  const responseDigest = await digest(parsed.canonicalResponse)

  return Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_ZERO_CAS_RESPONSE_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    status: parsed.status,
    bindings: Object.freeze({ ...bindings, responseDigest }),
    reportedStatusProvesDatabaseState: false as const,
    requiresReadOnlyReconciliation: true as const,
    automaticRetryAllowed: false as const,
    captureConsumed: false as const,
    hiddenParameterValuesExposed: false as const,
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
