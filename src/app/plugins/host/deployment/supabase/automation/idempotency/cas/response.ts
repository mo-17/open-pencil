import { digestCanonicalManifest, encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA,
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES,
  trustedSupabaseAutomationIdempotencyCASReviewContextV1,
  type SupabaseAutomationIdempotencyCASResultStateV1,
  type SupabaseAutomationIdempotencyCASReviewEnvelopeV1,
  type TrustedSupabaseAutomationIdempotencyCASReviewContextV1
} from './review'

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESPONSE_OBSERVATION_FORMAT =
  'openpencil.supabase-automation-idempotency-cas-response-observation.v1' as const

const INPUT_KEYS = Object.freeze(['casReview', 'response'] as const)
const RESPONSE_ROW_KEYS = Object.freeze(['status'] as const)
const RESPONSE_STATES = new Set<string>(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES)

export interface ParseSupabaseAutomationIdempotencyCASResponseForTestingOptionsV1 {
  readonly casReview: SupabaseAutomationIdempotencyCASReviewEnvelopeV1
  readonly response: unknown
}

/**
 * Sanitized interpretation of one injected testing response. The reported status is neither
 * authenticated database evidence nor a receipt; every outcome requires a fresh read-only check.
 */
export interface SupabaseAutomationIdempotencyCASResponseObservationV1 {
  readonly format: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESPONSE_OBSERVATION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly status: SupabaseAutomationIdempotencyCASResultStateV1
  readonly bindings: Readonly<{
    reviewDigest: string
    renderedSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
    resultDigest: string
  }>
  readonly reportedStatusProvesDatabaseState: false
  readonly reportedStatusProvesCommit: false
  readonly reportedStatusAuthenticated: false
  readonly requiresReadOnlyReconciliation: true
  readonly databaseCASCommitted: false
  readonly automaticRetryAllowed: false
  readonly captureConsumed: false
  readonly hiddenParameterValuesExposed: false
  readonly operationAuthorityAuthenticated: false
  readonly hostEvidenceAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly releaseReady: false
}

export interface TrustedSupabaseAutomationIdempotencyCASResponseObservationContextV1 {
  readonly observation: SupabaseAutomationIdempotencyCASResponseObservationV1
  readonly reviewContext: TrustedSupabaseAutomationIdempotencyCASReviewContextV1
  readonly canonicalResult: readonly Readonly<{
    status: SupabaseAutomationIdempotencyCASResultStateV1
  }>[]
}

export type SupabaseAutomationIdempotencyCASResponseErrorCode =
  | 'supabase-automation-idempotency-cas-response-input-invalid'
  | 'supabase-automation-idempotency-cas-response-proof-invalid'
  | 'supabase-automation-idempotency-cas-response-input-changed'
  | 'supabase-automation-idempotency-cas-response-invalid'
  | 'supabase-automation-idempotency-cas-response-digest-failed'

export class SupabaseAutomationIdempotencyCASResponseError extends Error {
  readonly code: SupabaseAutomationIdempotencyCASResponseErrorCode

  constructor(code: SupabaseAutomationIdempotencyCASResponseErrorCode) {
    super(code)
    this.name = 'SupabaseAutomationIdempotencyCASResponseError'
    this.code = code
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ParsedResult {
  readonly status: SupabaseAutomationIdempotencyCASResultStateV1
  readonly canonicalResult: readonly Readonly<{
    status: SupabaseAutomationIdempotencyCASResultStateV1
  }>[]
}

const trustedObservations = new WeakMap<
  object,
  TrustedSupabaseAutomationIdempotencyCASResponseObservationContextV1
>()

function fail(code: SupabaseAutomationIdempotencyCASResponseErrorCode): never {
  throw new SupabaseAutomationIdempotencyCASResponseError(code)
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: SupabaseAutomationIdempotencyCASResponseErrorCode
): UnknownRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return fail(code)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
    ) {
      return fail(code)
    }
    const snapshot = Object.create(null) as UnknownRecord
    for (const key of expectedKeys) {
      const descriptor = descriptors[key]
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return fail(code)
      }
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      })
    }
    return Object.freeze(snapshot)
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASResponseError) throw cause
    return fail(code)
  }
}

function exactInput(value: unknown): UnknownRecord {
  return exactDataRecord(
    value,
    INPUT_KEYS,
    'supabase-automation-idempotency-cas-response-input-invalid'
  )
}

function exactSingleStatusResult(value: unknown): ParsedResult {
  const code = 'supabase-automation-idempotency-cas-response-invalid' as const
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(code)
    }
    const keys = Reflect.ownKeys(value)
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    const firstDescriptor = Object.getOwnPropertyDescriptor(value, '0')
    if (
      keys.length !== 2 ||
      !keys.includes('0') ||
      !keys.includes('length') ||
      lengthDescriptor?.enumerable !== false ||
      lengthDescriptor.configurable !== false ||
      lengthDescriptor.writable !== true ||
      !Object.hasOwn(lengthDescriptor, 'value') ||
      lengthDescriptor.value !== 1 ||
      firstDescriptor?.enumerable !== true ||
      !Object.hasOwn(firstDescriptor, 'value')
    ) {
      return fail(code)
    }
    const row = exactDataRecord(firstDescriptor.value, RESPONSE_ROW_KEYS, code)
    const status = row.status
    if (typeof status !== 'string' || !RESPONSE_STATES.has(status)) return fail(code)
    const parsedStatus = status as SupabaseAutomationIdempotencyCASResultStateV1
    const canonicalResult = Object.freeze([Object.freeze({ status: parsedStatus })])
    return Object.freeze({ status: parsedStatus, canonicalResult })
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASResponseError) throw cause
    return fail(code)
  }
}

function assertCloneableWithoutProxy(
  value: unknown,
  code: SupabaseAutomationIdempotencyCASResponseErrorCode
): void {
  try {
    structuredClone(value)
  } catch {
    return fail(code)
  }
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-response-digest-failed')
  }
}

async function digestRawText(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-automation-idempotency-cas-response-digest-failed')
  }
}

function requireTrustedReview(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReviewContextV1 {
  const context = trustedSupabaseAutomationIdempotencyCASReviewContextV1(value)
  if (!context || context.envelope !== value) {
    return fail('supabase-automation-idempotency-cas-response-proof-invalid')
  }
  const { envelope, parameters, sql } = context
  if (
    envelope.previewSql !== sql ||
    envelope.review.parameters.order !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER ||
    envelope.review.parameters.schema !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA ||
    !Array.isArray(parameters) ||
    Object.getPrototypeOf(parameters) !== Array.prototype ||
    parameters.length !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER.length
  ) {
    return fail('supabase-automation-idempotency-cas-response-input-changed')
  }
  return context
}

/**
 * Strictly parse one injected testing response. All caller-owned descriptors and the complete
 * response are snapshotted and transparently proxied values are rejected before any Promise that
 * could reject is created. No transport, database, mutation, execution, or receipt authority is
 * created here.
 */
export async function parseSupabaseAutomationIdempotencyCASResponseForTestingV1(
  input: ParseSupabaseAutomationIdempotencyCASResponseForTestingOptionsV1
): Promise<SupabaseAutomationIdempotencyCASResponseObservationV1> {
  const source = exactInput(input)
  const reviewContext = requireTrustedReview(source.casReview)
  const responseValue = source.response
  const parsed = exactSingleStatusResult(responseValue)

  // Run only after descriptor inspection has rejected accessors at every untrusted boundary.
  assertCloneableWithoutProxy(responseValue, 'supabase-automation-idempotency-cas-response-invalid')
  assertCloneableWithoutProxy(input, 'supabase-automation-idempotency-cas-response-input-invalid')

  // These are intentionally created only after both transparent-Proxy probes above.
  const [
    reviewDigest,
    renderedSqlDigest,
    parameterSchemaDigest,
    parameterValuesDigest,
    resultDigest
  ] = await Promise.all([
    digest(reviewContext.envelope.review),
    digestRawText(reviewContext.sql),
    digest(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA),
    digest(
      Object.freeze({
        format: 'openpencil.supabase-automation-idempotency-cas-parameters.v1' as const,
        version: 1 as const,
        order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
        values: reviewContext.parameters
      })
    ),
    digest(parsed.canonicalResult)
  ])

  const review = reviewContext.envelope.review
  if (
    trustedSupabaseAutomationIdempotencyCASReviewContextV1(reviewContext.envelope) !==
      reviewContext ||
    reviewDigest !== reviewContext.envelope.reviewDigest ||
    renderedSqlDigest !== review.bindings.renderedSqlDigest ||
    renderedSqlDigest !== review.artifact.digest ||
    parameterSchemaDigest !== review.bindings.parameterSchemaDigest ||
    parameterValuesDigest !== review.bindings.parameterValuesDigest
  ) {
    return fail('supabase-automation-idempotency-cas-response-input-changed')
  }

  const observation = Object.freeze({
    format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESPONSE_OBSERVATION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    status: parsed.status,
    bindings: Object.freeze({
      reviewDigest,
      renderedSqlDigest,
      parameterSchemaDigest,
      parameterValuesDigest,
      resultDigest
    }),
    reportedStatusProvesDatabaseState: false as const,
    reportedStatusProvesCommit: false as const,
    reportedStatusAuthenticated: false as const,
    requiresReadOnlyReconciliation: true as const,
    databaseCASCommitted: false as const,
    automaticRetryAllowed: false as const,
    captureConsumed: false as const,
    hiddenParameterValuesExposed: false as const,
    operationAuthorityAuthenticated: false as const,
    hostEvidenceAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    persistenceAuthorityGranted: false as const,
    dispatchAuthorityGranted: false as const,
    releaseReady: false as const
  }) satisfies SupabaseAutomationIdempotencyCASResponseObservationV1

  trustedObservations.set(
    observation,
    Object.freeze({
      observation,
      reviewContext,
      canonicalResult: parsed.canonicalResult
    })
  )
  return observation
}

/** Identity-only lookup for a genuine, process-local testing observation. */
export function trustedSupabaseAutomationIdempotencyCASResponseObservationContextV1(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASResponseObservationContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedObservations.get(value)
  if (
    !context ||
    context.observation !== value ||
    trustedSupabaseAutomationIdempotencyCASReviewContextV1(context.reviewContext.envelope) !==
      context.reviewContext
  ) {
    return null
  }
  return context
}
