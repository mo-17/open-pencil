import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import { exactRecord, releaseDigest, releaseIdentifier, stringValue } from '../release/validation'
import { containsBackendSecretLikeMaterial } from '../secret-boundary'

export const BACKEND_AUTOMATION_EXECUTION_VERSION = 1 as const
export const BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT =
  'openpencil.backend-automation-execution-input' as const
export const BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT =
  'openpencil.backend-automation-execution-disposition' as const
export const BACKEND_AUTOMATION_EXECUTION_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const
export const BACKEND_AUTOMATION_EXECUTION_MAX_ATTEMPTS = 20
export const BACKEND_AUTOMATION_EXECUTION_MAX_DELAY_MS = 86_400_000
export const BACKEND_AUTOMATION_EXECUTION_MAX_CAUSATION_HOP = 16
export const BACKEND_AUTOMATION_EXECUTION_UINT32_MAX = 0xffff_ffff

const INPUT_KEYS = Object.freeze([
  'format',
  'version',
  'automationId',
  'operationId',
  'attemptId',
  'eventId',
  'idempotencyDigest',
  'causation',
  'attemptNumber',
  'retryPolicy',
  'observedOutcome',
  'jitterUint32'
] as const)
const CAUSATION_KEYS = Object.freeze(['id', 'hop', 'maxHop'] as const)
const RETRY_POLICY_KEYS = Object.freeze([
  'maxAttempts',
  'initialDelayMs',
  'maxDelayMs',
  'backoff',
  'jitter',
  'deadLetterQueueId'
] as const)
const OBSERVED_OUTCOME_KEYS = Object.freeze(['kind', 'stableCode', 'evidenceDigest'] as const)
const DISPOSITION_KEYS = Object.freeze(['format', 'version', 'input', 'decision'] as const)
const DECISION_KEYS = Object.freeze([
  'kind',
  'terminal',
  'requiresReconciliation',
  'nextAttemptNumber',
  'retryDelayMs',
  'deadLetterQueueId',
  'hostAuthorityAuthenticated',
  'runtimeAuthorityGranted',
  'releaseAuthorityGranted'
] as const)

export type BackendAutomationExecutionObservedOutcomeKind =
  | 'succeeded'
  | 'retryable-failure'
  | 'permanent-failure'
  | 'outcome-unknown'

export type BackendAutomationExecutionDecisionKind =
  | 'succeeded'
  | 'retry'
  | 'dead-letter'
  | 'failed'
  | 'outcome-unknown'

export interface BackendAutomationExecutionCausationV1 {
  readonly id: string
  readonly hop: number
  readonly maxHop: number
}

export interface BackendAutomationExecutionRetryPolicyV1 {
  readonly maxAttempts: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly backoff: 'fixed' | 'exponential'
  readonly jitter: 'none' | 'full'
  readonly deadLetterQueueId: string | null
}

export interface BackendAutomationExecutionObservedOutcomeV1 {
  readonly kind: BackendAutomationExecutionObservedOutcomeKind
  readonly stableCode: string | null
  readonly evidenceDigest: string
}

export interface BackendAutomationExecutionInputV1 {
  readonly format: typeof BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_EXECUTION_VERSION
  readonly automationId: string
  readonly operationId: string
  readonly attemptId: string
  readonly eventId: string
  readonly idempotencyDigest: string
  readonly causation: BackendAutomationExecutionCausationV1
  readonly attemptNumber: number
  readonly retryPolicy: BackendAutomationExecutionRetryPolicyV1
  readonly observedOutcome: BackendAutomationExecutionObservedOutcomeV1
  /** Required only when a retry using full jitter is actually planned. */
  readonly jitterUint32: number | null
}

export interface BackendAutomationExecutionDecisionV1 {
  readonly kind: BackendAutomationExecutionDecisionKind
  readonly terminal: boolean
  readonly requiresReconciliation: boolean
  readonly nextAttemptNumber: number | null
  readonly retryDelayMs: number | null
  readonly deadLetterQueueId: string | null
  /** This pure parser does not authenticate the caller or any claimed Host observation. */
  readonly hostAuthorityAuthenticated: false
  /** A disposition is evidence, never permission to dispatch work. */
  readonly runtimeAuthorityGranted: false
  /** A disposition cannot satisfy or bypass Backend release gates. */
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationExecutionDispositionV1 {
  readonly format: typeof BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_EXECUTION_VERSION
  readonly input: BackendAutomationExecutionInputV1
  readonly decision: BackendAutomationExecutionDecisionV1
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new TypeError(`${path} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function nullableIdentifier(value: unknown, path: string): string | null {
  if (value === null) return null
  return releaseIdentifier(stringValue(value, path), path)
}

function nullableInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number | null {
  if (value === null) return null
  return integer(value, path, minimum, maximum)
}

function literal<Value extends string>(
  value: unknown,
  path: string,
  allowed: readonly Value[]
): Value {
  if (typeof value !== 'string' || !allowed.includes(value as Value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as Value
}

function booleanLiteral<Value extends boolean>(
  value: unknown,
  path: string,
  expected: Value
): Value {
  if (value !== expected) throw new TypeError(`${path} must be ${String(expected)}`)
  return expected
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
  return value
}

function causation(value: unknown): BackendAutomationExecutionCausationV1 {
  const source = exactRecord(value, '$.causation', CAUSATION_KEYS)
  const hop = integer(
    source.hop,
    '$.causation.hop',
    0,
    BACKEND_AUTOMATION_EXECUTION_MAX_CAUSATION_HOP
  )
  const maxHop = integer(
    source.maxHop,
    '$.causation.maxHop',
    1,
    BACKEND_AUTOMATION_EXECUTION_MAX_CAUSATION_HOP
  )
  if (hop > maxHop) throw new TypeError('$.causation.hop cannot exceed $.causation.maxHop')
  return Object.freeze({
    id: releaseIdentifier(stringValue(source.id, '$.causation.id'), '$.causation.id'),
    hop,
    maxHop
  })
}

function retryPolicy(value: unknown): BackendAutomationExecutionRetryPolicyV1 {
  const source = exactRecord(value, '$.retryPolicy', RETRY_POLICY_KEYS)
  const initialDelayMs = integer(source.initialDelayMs, '$.retryPolicy.initialDelayMs', 100, 60_000)
  const maxDelayMs = integer(
    source.maxDelayMs,
    '$.retryPolicy.maxDelayMs',
    100,
    BACKEND_AUTOMATION_EXECUTION_MAX_DELAY_MS
  )
  if (initialDelayMs > maxDelayMs) {
    throw new TypeError('$.retryPolicy.initialDelayMs cannot exceed $.retryPolicy.maxDelayMs')
  }
  return Object.freeze({
    maxAttempts: integer(
      source.maxAttempts,
      '$.retryPolicy.maxAttempts',
      1,
      BACKEND_AUTOMATION_EXECUTION_MAX_ATTEMPTS
    ),
    initialDelayMs,
    maxDelayMs,
    backoff: literal(source.backoff, '$.retryPolicy.backoff', ['fixed', 'exponential']),
    jitter: literal(source.jitter, '$.retryPolicy.jitter', ['none', 'full']),
    deadLetterQueueId: nullableIdentifier(
      source.deadLetterQueueId,
      '$.retryPolicy.deadLetterQueueId'
    )
  })
}

function observedOutcome(value: unknown): BackendAutomationExecutionObservedOutcomeV1 {
  const source = exactRecord(value, '$.observedOutcome', OBSERVED_OUTCOME_KEYS)
  const kind = literal(source.kind, '$.observedOutcome.kind', [
    'succeeded',
    'retryable-failure',
    'permanent-failure',
    'outcome-unknown'
  ])
  const stableCode = nullableIdentifier(source.stableCode, '$.observedOutcome.stableCode')
  if (kind === 'succeeded' && stableCode !== null) {
    throw new TypeError('$.observedOutcome.stableCode must be null for succeeded outcomes')
  }
  if (kind !== 'succeeded' && stableCode === null) {
    throw new TypeError('$.observedOutcome.stableCode is required for non-success outcomes')
  }
  return Object.freeze({
    kind,
    stableCode,
    evidenceDigest: releaseDigest(
      stringValue(source.evidenceDigest, '$.observedOutcome.evidenceDigest'),
      '$.observedOutcome.evidenceDigest'
    )
  })
}

function jitterUint32(value: unknown): number | null {
  return nullableInteger(value, '$.jitterUint32', 0, BACKEND_AUTOMATION_EXECUTION_UINT32_MAX)
}

export function parseBackendAutomationExecutionInput(
  value: unknown
): BackendAutomationExecutionInputV1 {
  const source = exactRecord(value, '$', INPUT_KEYS)
  if (source.format !== BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_EXECUTION_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const parsedRetryPolicy = retryPolicy(source.retryPolicy)
  const attemptNumber = integer(
    source.attemptNumber,
    '$.attemptNumber',
    1,
    BACKEND_AUTOMATION_EXECUTION_MAX_ATTEMPTS
  )
  if (attemptNumber > parsedRetryPolicy.maxAttempts) {
    throw new TypeError('$.attemptNumber cannot exceed $.retryPolicy.maxAttempts')
  }
  const parsed = Object.freeze({
    format: BACKEND_AUTOMATION_EXECUTION_INPUT_FORMAT,
    version: BACKEND_AUTOMATION_EXECUTION_VERSION,
    automationId: releaseIdentifier(
      stringValue(source.automationId, '$.automationId'),
      '$.automationId'
    ),
    operationId: releaseIdentifier(
      stringValue(source.operationId, '$.operationId'),
      '$.operationId'
    ),
    attemptId: releaseIdentifier(stringValue(source.attemptId, '$.attemptId'), '$.attemptId'),
    eventId: releaseIdentifier(stringValue(source.eventId, '$.eventId'), '$.eventId'),
    idempotencyDigest: releaseDigest(
      stringValue(source.idempotencyDigest, '$.idempotencyDigest'),
      '$.idempotencyDigest'
    ),
    causation: causation(source.causation),
    attemptNumber,
    retryPolicy: parsedRetryPolicy,
    observedOutcome: observedOutcome(source.observedOutcome),
    jitterUint32: jitterUint32(source.jitterUint32)
  })
  validateJitterUse(parsed)
  return parsed
}

function cappedRetryDelay(
  policy: BackendAutomationExecutionRetryPolicyV1,
  attemptNumber: number
): number {
  if (policy.backoff === 'fixed') return policy.initialDelayMs
  let delay = policy.initialDelayMs
  for (let completedAttempt = 1; completedAttempt < attemptNumber; completedAttempt += 1) {
    if (delay >= policy.maxDelayMs || delay > Math.floor(policy.maxDelayMs / 2)) {
      return policy.maxDelayMs
    }
    delay *= 2
  }
  return Math.min(delay, policy.maxDelayMs)
}

function applyFullJitter(cappedDelay: number, entropy: number): number {
  return Number(
    (BigInt(entropy) * BigInt(cappedDelay + 1)) /
      BigInt(BACKEND_AUTOMATION_EXECUTION_UINT32_MAX + 1)
  )
}

function dispositionKind(
  input: BackendAutomationExecutionInputV1
): BackendAutomationExecutionDecisionKind {
  if (input.observedOutcome.kind === 'succeeded') return 'succeeded'
  if (input.observedOutcome.kind === 'outcome-unknown') return 'outcome-unknown'
  if (
    input.observedOutcome.kind === 'retryable-failure' &&
    input.attemptNumber < input.retryPolicy.maxAttempts
  ) {
    return 'retry'
  }
  return input.retryPolicy.deadLetterQueueId === null ? 'failed' : 'dead-letter'
}

function validateJitterUse(input: BackendAutomationExecutionInputV1): void {
  const kind = dispositionKind(input)
  const retryPlanned = kind === 'retry'
  if (retryPlanned && input.retryPolicy.jitter === 'full' && input.jitterUint32 === null) {
    throw new TypeError('$.jitterUint32 is required when a full-jitter retry is planned')
  }
  if ((!retryPlanned || input.retryPolicy.jitter === 'none') && input.jitterUint32 !== null) {
    throw new TypeError('$.jitterUint32 must be null when full jitter is not used')
  }
}

function decision(input: BackendAutomationExecutionInputV1): BackendAutomationExecutionDecisionV1 {
  const kind = dispositionKind(input)
  const retryPlanned = kind === 'retry'
  const cappedDelay = retryPlanned ? cappedRetryDelay(input.retryPolicy, input.attemptNumber) : null
  let retryDelayMs: number | null = cappedDelay
  if (cappedDelay !== null && input.retryPolicy.jitter === 'full') {
    if (input.jitterUint32 === null) {
      throw new TypeError('$.jitterUint32 is required when a full-jitter retry is planned')
    }
    retryDelayMs = applyFullJitter(cappedDelay, input.jitterUint32)
  }
  return Object.freeze({
    kind,
    terminal: kind === 'succeeded' || kind === 'dead-letter' || kind === 'failed',
    requiresReconciliation: kind === 'outcome-unknown',
    nextAttemptNumber: retryPlanned ? input.attemptNumber + 1 : null,
    retryDelayMs,
    deadLetterQueueId: kind === 'dead-letter' ? input.retryPolicy.deadLetterQueueId : null,
    hostAuthorityAuthenticated: false,
    runtimeAuthorityGranted: false,
    releaseAuthorityGranted: false
  })
}

function assertSecretFreeDisposition(value: BackendAutomationExecutionDispositionV1): void {
  const strings = [
    value.input.automationId,
    value.input.operationId,
    value.input.attemptId,
    value.input.eventId,
    value.input.causation.id,
    value.input.retryPolicy.deadLetterQueueId,
    value.input.observedOutcome.stableCode,
    value.decision.deadLetterQueueId
  ]
  if (strings.some((entry) => entry !== null && containsBackendSecretLikeMaterial(entry))) {
    throw new TypeError('Backend Automation execution disposition must be secret-free')
  }
}

/**
 * Produce a deterministic policy disposition only. The caller must separately authenticate the
 * Host observation, persist attempt/idempotency state, and authorize any retry or dead-letter write.
 */
export function planBackendAutomationExecutionDisposition(
  value: unknown
): BackendAutomationExecutionDispositionV1 {
  const input = parseBackendAutomationExecutionInput(value)
  const result = Object.freeze({
    format: BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT,
    version: BACKEND_AUTOMATION_EXECUTION_VERSION,
    input,
    decision: decision(input)
  })
  assertSecretFreeDisposition(result)
  return result
}

function parsedDecision(value: unknown): BackendAutomationExecutionDecisionV1 {
  const source = exactRecord(value, '$.decision', DECISION_KEYS)
  return Object.freeze({
    kind: literal(source.kind, '$.decision.kind', [
      'succeeded',
      'retry',
      'dead-letter',
      'failed',
      'outcome-unknown'
    ]),
    terminal: booleanValue(source.terminal, '$.decision.terminal'),
    requiresReconciliation: booleanValue(
      source.requiresReconciliation,
      '$.decision.requiresReconciliation'
    ),
    nextAttemptNumber: nullableInteger(
      source.nextAttemptNumber,
      '$.decision.nextAttemptNumber',
      1,
      BACKEND_AUTOMATION_EXECUTION_MAX_ATTEMPTS
    ),
    retryDelayMs: nullableInteger(
      source.retryDelayMs,
      '$.decision.retryDelayMs',
      0,
      BACKEND_AUTOMATION_EXECUTION_MAX_DELAY_MS
    ),
    deadLetterQueueId: nullableIdentifier(source.deadLetterQueueId, '$.decision.deadLetterQueueId'),
    hostAuthorityAuthenticated: booleanLiteral(
      source.hostAuthorityAuthenticated,
      '$.decision.hostAuthorityAuthenticated',
      false
    ),
    runtimeAuthorityGranted: booleanLiteral(
      source.runtimeAuthorityGranted,
      '$.decision.runtimeAuthorityGranted',
      false
    ),
    releaseAuthorityGranted: booleanLiteral(
      source.releaseAuthorityGranted,
      '$.decision.releaseAuthorityGranted',
      false
    )
  })
}

function sameDecision(
  actual: BackendAutomationExecutionDecisionV1,
  expected: BackendAutomationExecutionDecisionV1
): boolean {
  return DECISION_KEYS.every((key) => actual[key] === expected[key])
}

export function parseBackendAutomationExecutionDisposition(
  value: unknown
): BackendAutomationExecutionDispositionV1 {
  const source = exactRecord(value, '$', DISPOSITION_KEYS)
  if (source.format !== BACKEND_AUTOMATION_EXECUTION_DISPOSITION_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_EXECUTION_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const planned = planBackendAutomationExecutionDisposition(source.input)
  const suppliedDecision = parsedDecision(source.decision)
  if (!sameDecision(suppliedDecision, planned.decision)) {
    throw new TypeError('$.decision does not match the bound execution input')
  }
  return planned
}

export function canonicalBackendAutomationExecutionInputBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendAutomationExecutionInput(value))
}

export async function digestBackendAutomationExecutionInput(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendAutomationExecutionInput(value))
}

export function canonicalBackendAutomationExecutionDispositionBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendAutomationExecutionDisposition(value))
}

export async function digestBackendAutomationExecutionDisposition(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendAutomationExecutionDisposition(value))
}
