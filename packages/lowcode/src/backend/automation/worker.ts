/* eslint-disable max-lines -- queue lease, worker lifecycle, and mutation proposals form one fail-closed boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  compareReleaseTimestamps,
  exactRecord,
  nullableDigest,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  releaseTimestampInstantNanoseconds,
  stringValue
} from '../release/validation'
import { containsBackendSecretLikeMaterial } from '../secret-boundary'
import {
  digestBackendAutomationExecutionDisposition,
  parseBackendAutomationExecutionDisposition,
  type BackendAutomationExecutionDispositionV1
} from './execution'
import {
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  parseBackendAutomationIdempotencyCASProposal,
  parseBackendAutomationIdempotencyRecord,
  type BackendAutomationIdempotencyCASProposalV1,
  type BackendAutomationIdempotencyRecordV1
} from './idempotency'

export const BACKEND_AUTOMATION_WORKER_VERSION = 1 as const
export const BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT =
  'openpencil.backend-automation-queue-message' as const
export const BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT =
  'openpencil.backend-automation-queue-lease-observation' as const
export const BACKEND_AUTOMATION_WORKER_RECORD_FORMAT =
  'openpencil.backend-automation-worker-record' as const
export const BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT =
  'openpencil.backend-automation-worker-cas-proposal' as const
export const BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT =
  'openpencil.backend-automation-queue-mutation-proposal' as const
export const BACKEND_AUTOMATION_WORKER_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const

export const BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES = 1_048_576
export const BACKEND_AUTOMATION_WORKER_MAX_RETENTION_SECONDS = 2_592_000
export const BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_SECONDS = 3_600
export const BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS = 8
export const BACKEND_AUTOMATION_WORKER_MAX_DELIVERY_ATTEMPTS = 20
export const BACKEND_AUTOMATION_WORKER_MAX_CAUSATION_HOP = 16
export const BACKEND_AUTOMATION_WORKER_MAX_REVISION = 1_024
export const BACKEND_AUTOMATION_WORKER_MAX_CANONICAL_BYTES = 65_536

export const BACKEND_AUTOMATION_WORKER_STATES = Object.freeze([
  'received',
  'pre-dispatch-outcome-unknown',
  'outcome-unknown',
  'succeeded',
  'deduplicated',
  'known-not-dispatched'
] as const)

export type BackendAutomationWorkerState = (typeof BACKEND_AUTOMATION_WORKER_STATES)[number]

export type BackendAutomationWorkerIdempotencyState =
  | 'dispatch-started'
  | 'succeeded'
  | 'known-not-dispatched'
  | 'outcome-unknown'
export type BackendAutomationQueueMutationKind = 'ack' | 'archive' | 'retry' | 'extend-visibility'

/** Payload bytes remain outside this contract; only their digest and exact byte length are bound. */
export interface BackendAutomationQueueMessageEnvelopeV1 {
  readonly format: typeof BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly queueId: string
  readonly messageId: string
  readonly automationId: string
  readonly eventId: string
  readonly operationId: string
  readonly idempotencyKeyDigest: string
  readonly causationId: string
  readonly causationHop: number
  readonly causationMaxHop: number
  readonly payloadDigest: string
  readonly payloadByteLength: number
  readonly maxPayloadBytes: number
  readonly visibilityTimeoutSeconds: number
  readonly retentionSeconds: number
  readonly enqueuedAt: string
  readonly retentionDeadline: string
  readonly payloadIncluded: false
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

/** Digest-only observation of a Host queue lease; parsing does not authenticate the observation. */
export interface BackendAutomationQueueLeaseObservationV1 {
  readonly format: typeof BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly messageEnvelopeDigest: string
  readonly queueId: string
  readonly messageId: string
  readonly leaseId: string
  readonly deliveryId: string
  readonly deliveryAttempt: number
  readonly attemptId: string
  readonly receivedAt: string
  readonly observedAt: string
  readonly visibilityDeadline: string
  readonly extensionCount: number
  readonly leaseEvidenceDigest: string
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationQueueLeaseBindingV1 {
  readonly message: BackendAutomationQueueMessageEnvelopeV1
  readonly messageEnvelopeDigest: string
  readonly lease: BackendAutomationQueueLeaseObservationV1
  readonly leaseObservationDigest: string
}

/**
 * Claimed inputs for a Host-authenticated succeeded-head replay decision.
 *
 * This contract parses and cross-binds the complete record and CAS proposal, but it cannot prove
 * that either value came from durable storage or that persistedHead* is the current stored head.
 * The Host must authenticate and re-read those facts plus persisted original-dispatch evidence for
 * the envelope and payload claims before calling the dedicated deduplication helper. Every authority
 * field remains false because the result is only an unprivileged proposal.
 */
export interface BackendAutomationWorkerDeduplicationInputV1 {
  readonly succeededIdempotencyRecord: BackendAutomationIdempotencyRecordV1
  readonly succeededIdempotencyCASProposal: BackendAutomationIdempotencyCASProposalV1
  /** Claimed original envelope digest; the Host must authenticate persisted dispatch evidence. */
  readonly succeededMessageEnvelopeDigest: string
  /** Claimed original payload digest; the Host must authenticate persisted dispatch evidence. */
  readonly succeededPayloadDigest: string
  readonly persistedHeadRevision: number
  readonly persistedHeadDigest: string
  /** Digest of separate Host terminal-head verification; a digest is not authentication. */
  readonly terminalCASVerificationEvidenceDigest: string
  readonly recordedAt: string
  /** Fresh evidence for recording the no-dispatch worker transition itself. */
  readonly transitionEvidenceDigest: string
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationWorkerRecordV1 {
  readonly format: typeof BACKEND_AUTOMATION_WORKER_RECORD_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly messageEnvelopeDigest: string
  readonly leaseObservationDigest: string
  readonly queueId: string
  readonly messageId: string
  readonly leaseId: string
  readonly deliveryId: string
  readonly deliveryAttempt: number
  readonly automationId: string
  readonly eventId: string
  readonly operationId: string
  readonly idempotencyKeyDigest: string
  readonly causationId: string
  readonly causationHop: number
  readonly causationMaxHop: number
  readonly attemptId: string
  readonly state: BackendAutomationWorkerState
  readonly revision: number
  readonly previousRecordDigest: string | null
  readonly recordedAt: string
  readonly transitionEvidenceDigest: string
  readonly idempotencyCASDigest: string | null
  readonly idempotencyRecordDigest: string | null
  readonly idempotencyState: BackendAutomationWorkerIdempotencyState | null
  readonly reconciliationEvidenceDigest: string | null
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationWorkerCASProposalV1 {
  readonly format: typeof BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly queueId: string
  readonly messageId: string
  readonly deliveryId: string
  readonly attemptId: string
  readonly idempotencyKeyDigest: string
  readonly expectedRevision: number | null
  readonly expectedHeadDigest: string | null
  readonly nextRevision: number
  readonly nextRecordDigest: string
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationWorkerCASCandidateV1 {
  readonly proposal: BackendAutomationWorkerCASProposalV1
  readonly record: BackendAutomationWorkerRecordV1
  readonly recordDigest: string
}

export interface BackendAutomationQueueMutationProposalV1 {
  readonly format: typeof BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly kind: BackendAutomationQueueMutationKind
  readonly queueId: string
  readonly messageId: string
  readonly leaseId: string
  readonly deliveryId: string
  readonly deliveryAttempt: number
  readonly attemptId: string
  readonly automationId: string
  readonly eventId: string
  readonly operationId: string
  readonly idempotencyKeyDigest: string
  readonly messageEnvelopeDigest: string
  readonly leaseObservationDigest: string
  readonly workerRecordDigest: string
  readonly workerState: BackendAutomationWorkerState
  readonly idempotencyCASDigest: string | null
  readonly idempotencyRecordDigest: string | null
  readonly terminalCASVerificationEvidenceDigest: string | null
  readonly executionDispositionDigest: string | null
  readonly dispositionKind: 'retry' | 'dead-letter' | 'failed' | null
  readonly deadLetterQueueId: string | null
  readonly deadLetterState: 'published' | null
  readonly deadLetterMessageEnvelopeDigest: string | null
  readonly deadLetterPublishedRecordDigest: string | null
  readonly deadLetterCASDigest: string | null
  readonly deadLetterPublishVerificationEvidenceDigest: string | null
  readonly proposedAt: string
  readonly nextVisibilityDeadline: string | null
  readonly nextExtensionCount: number | null
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendAutomationQueueMutationRequestV1 {
  readonly kind: BackendAutomationQueueMutationKind
  readonly proposedAt: string
  readonly nextVisibilityDeadline: string | null
  /** Digest of separate Host verification; this module does not authenticate it. */
  readonly terminalCASVerificationEvidenceDigest: string | null
  readonly executionDisposition: BackendAutomationExecutionDispositionV1 | null
  /** Claimed DLQ state only; the Host must authenticate the published record and CAS evidence. */
  readonly deadLetterState: 'published' | null
  readonly deadLetterMessageEnvelopeDigest: string | null
  readonly deadLetterPublishedRecordDigest: string | null
  readonly deadLetterCASDigest: string | null
  readonly deadLetterPublishVerificationEvidenceDigest: string | null
}

const AUTHORITY_KEYS = Object.freeze([
  'hostEvidenceAuthenticated',
  'persistenceAuthorityGranted',
  'dispatchAuthorityGranted',
  'ackAuthorityGranted',
  'releaseAuthorityGranted'
] as const)

const MESSAGE_KEYS = Object.freeze([
  'format',
  'version',
  'queueId',
  'messageId',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'causationId',
  'causationHop',
  'causationMaxHop',
  'payloadDigest',
  'payloadByteLength',
  'maxPayloadBytes',
  'visibilityTimeoutSeconds',
  'retentionSeconds',
  'enqueuedAt',
  'retentionDeadline',
  'payloadIncluded',
  ...AUTHORITY_KEYS
] as const)

const LEASE_KEYS = Object.freeze([
  'format',
  'version',
  'messageEnvelopeDigest',
  'queueId',
  'messageId',
  'leaseId',
  'deliveryId',
  'deliveryAttempt',
  'attemptId',
  'receivedAt',
  'observedAt',
  'visibilityDeadline',
  'extensionCount',
  'leaseEvidenceDigest',
  ...AUTHORITY_KEYS
] as const)

const WORKER_RECORD_KEYS = Object.freeze([
  'format',
  'version',
  'messageEnvelopeDigest',
  'leaseObservationDigest',
  'queueId',
  'messageId',
  'leaseId',
  'deliveryId',
  'deliveryAttempt',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'causationId',
  'causationHop',
  'causationMaxHop',
  'attemptId',
  'state',
  'revision',
  'previousRecordDigest',
  'recordedAt',
  'transitionEvidenceDigest',
  'idempotencyCASDigest',
  'idempotencyRecordDigest',
  'idempotencyState',
  'reconciliationEvidenceDigest',
  ...AUTHORITY_KEYS
] as const)

const WORKER_CAS_KEYS = Object.freeze([
  'format',
  'version',
  'queueId',
  'messageId',
  'deliveryId',
  'attemptId',
  'idempotencyKeyDigest',
  'expectedRevision',
  'expectedHeadDigest',
  'nextRevision',
  'nextRecordDigest',
  ...AUTHORITY_KEYS
] as const)

const DEDUPLICATION_INPUT_KEYS = Object.freeze([
  'succeededIdempotencyRecord',
  'succeededIdempotencyCASProposal',
  'succeededMessageEnvelopeDigest',
  'succeededPayloadDigest',
  'persistedHeadRevision',
  'persistedHeadDigest',
  'terminalCASVerificationEvidenceDigest',
  'recordedAt',
  'transitionEvidenceDigest',
  ...AUTHORITY_KEYS
] as const)

const MUTATION_KEYS = Object.freeze([
  'format',
  'version',
  'kind',
  'queueId',
  'messageId',
  'leaseId',
  'deliveryId',
  'deliveryAttempt',
  'attemptId',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'messageEnvelopeDigest',
  'leaseObservationDigest',
  'workerRecordDigest',
  'workerState',
  'idempotencyCASDigest',
  'idempotencyRecordDigest',
  'terminalCASVerificationEvidenceDigest',
  'executionDispositionDigest',
  'dispositionKind',
  'deadLetterQueueId',
  'deadLetterState',
  'deadLetterMessageEnvelopeDigest',
  'deadLetterPublishedRecordDigest',
  'deadLetterCASDigest',
  'deadLetterPublishVerificationEvidenceDigest',
  'proposedAt',
  'nextVisibilityDeadline',
  'nextExtensionCount',
  ...AUTHORITY_KEYS
] as const)

const MUTATION_REQUEST_KEYS = Object.freeze([
  'kind',
  'proposedAt',
  'nextVisibilityDeadline',
  'terminalCASVerificationEvidenceDigest',
  'executionDisposition',
  'deadLetterState',
  'deadLetterMessageEnvelopeDigest',
  'deadLetterPublishedRecordDigest',
  'deadLetterCASDigest',
  'deadLetterPublishVerificationEvidenceDigest'
] as const)

const WORKER_STATES = new Set<string>(BACKEND_AUTOMATION_WORKER_STATES)
const WORKER_IDEMPOTENCY_STATES = new Set<string>([
  'dispatch-started',
  'succeeded',
  'known-not-dispatched',
  'outcome-unknown'
])
const MUTATION_KINDS = new Set<string>(['ack', 'archive', 'retry', 'extend-visibility'])
const DISPOSITION_KINDS = new Set<string>(['retry', 'dead-letter', 'failed'])
const CANONICAL_NANOSECOND_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{9}Z$/u
const NANOSECONDS_PER_SECOND = 1_000_000_000n
const NANOSECONDS_PER_MILLISECOND = 1_000_000n

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

function nullableInteger(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number
): number | null {
  return value === null ? null : integer(value, path, minimum, maximum)
}

function fixedFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false`)
  return false
}

function authorityFields(source: Readonly<Record<string, unknown>>) {
  return {
    hostEvidenceAuthenticated: fixedFalse(
      source.hostEvidenceAuthenticated,
      '$.hostEvidenceAuthenticated'
    ),
    persistenceAuthorityGranted: fixedFalse(
      source.persistenceAuthorityGranted,
      '$.persistenceAuthorityGranted'
    ),
    dispatchAuthorityGranted: fixedFalse(
      source.dispatchAuthorityGranted,
      '$.dispatchAuthorityGranted'
    ),
    ackAuthorityGranted: fixedFalse(source.ackAuthorityGranted, '$.ackAuthorityGranted'),
    releaseAuthorityGranted: fixedFalse(source.releaseAuthorityGranted, '$.releaseAuthorityGranted')
  } as const
}

const NO_AUTHORITY = Object.freeze({
  hostEvidenceAuthenticated: false,
  persistenceAuthorityGranted: false,
  dispatchAuthorityGranted: false,
  ackAuthorityGranted: false,
  releaseAuthorityGranted: false
} as const)

function identifier(value: unknown, path: string): string {
  return releaseIdentifier(stringValue(value, path), path)
}

function nullableIdentifier(value: unknown, path: string): string | null {
  return value === null ? null : identifier(value, path)
}

function digest(value: unknown, path: string): string {
  return releaseDigest(stringValue(value, path), path)
}

function timestamp(value: unknown, path: string): string {
  const parsed = releaseTimestamp(stringValue(value, path, 30), path)
  if (!CANONICAL_NANOSECOND_TIMESTAMP.test(parsed)) {
    throw new TypeError(`${path} must be a canonical UTC timestamp with nine fractional digits`)
  }
  return parsed
}

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : timestamp(value, path)
}

function assertExactDuration(start: string, end: string, seconds: number, path: string): void {
  const delta =
    releaseTimestampInstantNanoseconds(end, path) -
    releaseTimestampInstantNanoseconds(start, '$.durationStart')
  if (delta !== BigInt(seconds) * NANOSECONDS_PER_SECOND) {
    throw new TypeError(`${path} does not match the declared duration`)
  }
}

function assertPositiveBoundedDuration(
  start: string,
  end: string,
  maximumSeconds: number,
  path: string
): void {
  const delta =
    releaseTimestampInstantNanoseconds(end, path) -
    releaseTimestampInstantNanoseconds(start, '$.durationStart')
  if (delta <= 0n || delta > BigInt(maximumSeconds) * NANOSECONDS_PER_SECOND) {
    throw new TypeError(`${path} exceeds the bounded positive duration`)
  }
}

function boundedCanonicalBytes(value: unknown): Uint8Array {
  const bytes = canonicalManifestBytes(value)
  if (bytes.byteLength > BACKEND_AUTOMATION_WORKER_MAX_CANONICAL_BYTES) {
    throw new TypeError('Backend Automation worker data exceeds the canonical byte limit')
  }
  return bytes
}

function assertSecretFreeNormalizedData(value: object): void {
  for (const entry of Object.values(value)) {
    if (typeof entry === 'string' && containsBackendSecretLikeMaterial(entry)) {
      throw new TypeError('Backend Automation worker data contains secret-like material')
    }
  }
}

/** Descriptor parsing runs first; structured clone rejects otherwise transparent Proxy values. */
function assertNoProxyValues(value: unknown): void {
  try {
    structuredClone(value)
  } catch {
    throw new TypeError('Backend Automation worker input must be cloneable Proxy-free plain data')
  }
}

function workerState(value: unknown, path: string): BackendAutomationWorkerState {
  if (typeof value !== 'string' || !WORKER_STATES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendAutomationWorkerState
}

function nullableIdempotencyState(
  value: unknown,
  path: string
): BackendAutomationWorkerIdempotencyState | null {
  if (value === null) return null
  if (typeof value !== 'string' || !WORKER_IDEMPOTENCY_STATES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendAutomationWorkerIdempotencyState
}

function parseDeduplicationInput(value: unknown): BackendAutomationWorkerDeduplicationInputV1 {
  const source = exactRecord(value, '$', DEDUPLICATION_INPUT_KEYS)
  const parsed: BackendAutomationWorkerDeduplicationInputV1 = Object.freeze({
    succeededIdempotencyRecord: parseBackendAutomationIdempotencyRecord(
      source.succeededIdempotencyRecord
    ),
    succeededIdempotencyCASProposal: parseBackendAutomationIdempotencyCASProposal(
      source.succeededIdempotencyCASProposal
    ),
    succeededMessageEnvelopeDigest: digest(
      source.succeededMessageEnvelopeDigest,
      '$.succeededMessageEnvelopeDigest'
    ),
    succeededPayloadDigest: digest(source.succeededPayloadDigest, '$.succeededPayloadDigest'),
    persistedHeadRevision: integer(
      source.persistedHeadRevision,
      '$.persistedHeadRevision',
      0,
      BACKEND_AUTOMATION_WORKER_MAX_REVISION
    ),
    persistedHeadDigest: digest(source.persistedHeadDigest, '$.persistedHeadDigest'),
    terminalCASVerificationEvidenceDigest: digest(
      source.terminalCASVerificationEvidenceDigest,
      '$.terminalCASVerificationEvidenceDigest'
    ),
    recordedAt: timestamp(source.recordedAt, '$.recordedAt'),
    transitionEvidenceDigest: digest(source.transitionEvidenceDigest, '$.transitionEvidenceDigest'),
    ...authorityFields(source)
  })
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

function parseMessage(value: unknown): BackendAutomationQueueMessageEnvelopeV1 {
  const source = exactRecord(value, '$', MESSAGE_KEYS)
  if (source.format !== BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  if (source.payloadIncluded !== false) throw new TypeError('$.payloadIncluded must be false')
  const payloadByteLength = integer(
    source.payloadByteLength,
    '$.payloadByteLength',
    0,
    BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES
  )
  const maxPayloadBytes = integer(
    source.maxPayloadBytes,
    '$.maxPayloadBytes',
    1,
    BACKEND_AUTOMATION_WORKER_MAX_PAYLOAD_BYTES
  )
  if (payloadByteLength > maxPayloadBytes) {
    throw new TypeError('$.payloadByteLength exceeds $.maxPayloadBytes')
  }
  const visibilityTimeoutSeconds = integer(
    source.visibilityTimeoutSeconds,
    '$.visibilityTimeoutSeconds',
    1,
    BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_SECONDS
  )
  const retentionSeconds = integer(
    source.retentionSeconds,
    '$.retentionSeconds',
    60,
    BACKEND_AUTOMATION_WORKER_MAX_RETENTION_SECONDS
  )
  if (visibilityTimeoutSeconds >= retentionSeconds) {
    throw new TypeError('$.visibilityTimeoutSeconds must be shorter than retention')
  }
  const causationHop = integer(
    source.causationHop,
    '$.causationHop',
    0,
    BACKEND_AUTOMATION_WORKER_MAX_CAUSATION_HOP
  )
  const causationMaxHop = integer(
    source.causationMaxHop,
    '$.causationMaxHop',
    1,
    BACKEND_AUTOMATION_WORKER_MAX_CAUSATION_HOP
  )
  if (causationHop > causationMaxHop) {
    throw new TypeError('$.causationHop cannot exceed $.causationMaxHop')
  }
  const enqueuedAt = timestamp(source.enqueuedAt, '$.enqueuedAt')
  const retentionDeadline = timestamp(source.retentionDeadline, '$.retentionDeadline')
  assertExactDuration(enqueuedAt, retentionDeadline, retentionSeconds, '$.retentionDeadline')
  const parsed: BackendAutomationQueueMessageEnvelopeV1 = Object.freeze({
    format: BACKEND_AUTOMATION_QUEUE_MESSAGE_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    queueId: identifier(source.queueId, '$.queueId'),
    messageId: identifier(source.messageId, '$.messageId'),
    automationId: identifier(source.automationId, '$.automationId'),
    eventId: identifier(source.eventId, '$.eventId'),
    operationId: identifier(source.operationId, '$.operationId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    causationId: identifier(source.causationId, '$.causationId'),
    causationHop,
    causationMaxHop,
    payloadDigest: digest(source.payloadDigest, '$.payloadDigest'),
    payloadByteLength,
    maxPayloadBytes,
    visibilityTimeoutSeconds,
    retentionSeconds,
    enqueuedAt,
    retentionDeadline,
    payloadIncluded: false,
    ...authorityFields(source)
  })
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

function parseLease(value: unknown): BackendAutomationQueueLeaseObservationV1 {
  const source = exactRecord(value, '$', LEASE_KEYS)
  if (source.format !== BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const receivedAt = timestamp(source.receivedAt, '$.receivedAt')
  const observedAt = timestamp(source.observedAt, '$.observedAt')
  const visibilityDeadline = timestamp(source.visibilityDeadline, '$.visibilityDeadline')
  if (compareReleaseTimestamps(observedAt, receivedAt) < 0) {
    throw new TypeError('$.observedAt cannot precede $.receivedAt')
  }
  if (compareReleaseTimestamps(visibilityDeadline, observedAt) <= 0) {
    throw new TypeError('$.visibilityDeadline must follow $.observedAt')
  }
  const extensionCount = integer(
    source.extensionCount,
    '$.extensionCount',
    0,
    BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS
  )
  if (extensionCount === 0 && observedAt !== receivedAt) {
    throw new TypeError('An unextended lease must be observed at receipt time')
  }
  const parsed: BackendAutomationQueueLeaseObservationV1 = Object.freeze({
    format: BACKEND_AUTOMATION_QUEUE_LEASE_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    messageEnvelopeDigest: digest(source.messageEnvelopeDigest, '$.messageEnvelopeDigest'),
    queueId: identifier(source.queueId, '$.queueId'),
    messageId: identifier(source.messageId, '$.messageId'),
    leaseId: identifier(source.leaseId, '$.leaseId'),
    deliveryId: identifier(source.deliveryId, '$.deliveryId'),
    deliveryAttempt: integer(
      source.deliveryAttempt,
      '$.deliveryAttempt',
      1,
      BACKEND_AUTOMATION_WORKER_MAX_DELIVERY_ATTEMPTS
    ),
    attemptId: identifier(source.attemptId, '$.attemptId'),
    receivedAt,
    observedAt,
    visibilityDeadline,
    extensionCount,
    leaseEvidenceDigest: digest(source.leaseEvidenceDigest, '$.leaseEvidenceDigest'),
    ...authorityFields(source)
  })
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

export function parseBackendAutomationQueueMessageEnvelope(
  value: unknown
): BackendAutomationQueueMessageEnvelopeV1 {
  try {
    return parseMessage(value)
  } catch {
    throw new TypeError('Backend Automation queue message envelope is invalid.')
  }
}

export function canonicalBackendAutomationQueueMessageEnvelopeBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseMessage(value))
  } catch {
    throw new TypeError('Backend Automation queue message envelope is invalid.')
  }
}

export async function digestBackendAutomationQueueMessageEnvelope(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseMessage(value))
  } catch {
    throw new TypeError('Backend Automation queue message envelope is invalid.')
  }
}

export function parseBackendAutomationQueueLeaseObservation(
  value: unknown
): BackendAutomationQueueLeaseObservationV1 {
  try {
    return parseLease(value)
  } catch {
    throw new TypeError('Backend Automation queue lease observation is invalid.')
  }
}

export function canonicalBackendAutomationQueueLeaseObservationBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseLease(value))
  } catch {
    throw new TypeError('Backend Automation queue lease observation is invalid.')
  }
}

export async function digestBackendAutomationQueueLeaseObservation(
  value: unknown
): Promise<string> {
  try {
    return await digestCanonicalManifest(parseLease(value))
  } catch {
    throw new TypeError('Backend Automation queue lease observation is invalid.')
  }
}

async function bindParsedLease(
  message: BackendAutomationQueueMessageEnvelopeV1,
  lease: BackendAutomationQueueLeaseObservationV1
): Promise<BackendAutomationQueueLeaseBindingV1> {
  const messageEnvelopeDigest = await digestCanonicalManifest(message)
  if (
    lease.messageEnvelopeDigest !== messageEnvelopeDigest ||
    lease.queueId !== message.queueId ||
    lease.messageId !== message.messageId
  ) {
    throw new TypeError('Queue lease does not bind the exact message envelope')
  }
  if (compareReleaseTimestamps(lease.receivedAt, message.enqueuedAt) < 0) {
    throw new TypeError('Queue lease cannot precede enqueue time')
  }
  if (compareReleaseTimestamps(lease.visibilityDeadline, message.retentionDeadline) > 0) {
    throw new TypeError('Queue lease visibility cannot exceed message retention')
  }
  assertPositiveBoundedDuration(
    lease.observedAt,
    lease.visibilityDeadline,
    message.visibilityTimeoutSeconds,
    '$.lease.visibilityDeadline'
  )
  const leaseObservationDigest = await digestCanonicalManifest(lease)
  return Object.freeze({ message, messageEnvelopeDigest, lease, leaseObservationDigest })
}

async function bindLease(
  messageValue: unknown,
  leaseValue: unknown
): Promise<BackendAutomationQueueLeaseBindingV1> {
  const message = parseMessage(messageValue)
  const lease = parseLease(leaseValue)
  return bindParsedLease(message, lease)
}

function requiredWorkerIdempotencyState(
  state: Exclude<BackendAutomationWorkerState, 'received'>
): BackendAutomationWorkerIdempotencyState {
  if (state === 'pre-dispatch-outcome-unknown') return 'dispatch-started'
  if (state === 'succeeded' || state === 'deduplicated') return 'succeeded'
  if (state === 'known-not-dispatched') return 'known-not-dispatched'
  return 'outcome-unknown'
}

function assertDeduplicatedWorkerEvidence(record: BackendAutomationWorkerRecordV1): void {
  if (record.state !== 'deduplicated') return
  if (
    record.revision === 0 ||
    record.reconciliationEvidenceDigest === null ||
    new Set([
      record.idempotencyCASDigest,
      record.idempotencyRecordDigest,
      record.transitionEvidenceDigest,
      record.reconciliationEvidenceDigest
    ]).size !== 4
  ) {
    throw new TypeError(
      'A deduplicated replay requires independent persisted-head and terminal verification evidence'
    )
  }
}

function assertWorkerRecordStateShape(record: BackendAutomationWorkerRecordV1): void {
  if (record.state === 'received') {
    if (record.idempotencyState !== null || record.reconciliationEvidenceDigest !== null) {
      throw new TypeError('A received record cannot claim idempotency settlement')
    }
    return
  }
  if (record.idempotencyState !== requiredWorkerIdempotencyState(record.state)) {
    throw new TypeError('Worker and idempotency states do not match')
  }
  if (
    record.state === 'pre-dispatch-outcome-unknown' &&
    record.reconciliationEvidenceDigest !== null
  ) {
    throw new TypeError('A pre-dispatch fence cannot claim reconciliation evidence')
  }
  if (record.state === 'known-not-dispatched' && record.reconciliationEvidenceDigest === null) {
    throw new TypeError('A post-dispatch non-dispatch result requires reconciliation evidence')
  }
  assertDeduplicatedWorkerEvidence(record)
}

export async function verifyBackendAutomationQueueLeaseObservation(
  messageValue: unknown,
  leaseValue: unknown
): Promise<BackendAutomationQueueLeaseBindingV1> {
  try {
    return await bindLease(messageValue, leaseValue)
  } catch {
    throw new TypeError('Backend Automation queue lease binding is invalid.')
  }
}

function parseWorkerRecord(value: unknown): BackendAutomationWorkerRecordV1 {
  const source = exactRecord(value, '$', WORKER_RECORD_KEYS)
  if (source.format !== BACKEND_AUTOMATION_WORKER_RECORD_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const revision = integer(source.revision, '$.revision', 0, BACKEND_AUTOMATION_WORKER_MAX_REVISION)
  const previousRecordDigest = nullableDigest(source.previousRecordDigest, '$.previousRecordDigest')
  if ((revision === 0) !== (previousRecordDigest === null)) {
    throw new TypeError('$.revision and $.previousRecordDigest do not form a chain position')
  }
  const idempotencyCASDigest = nullableDigest(source.idempotencyCASDigest, '$.idempotencyCASDigest')
  const idempotencyRecordDigest = nullableDigest(
    source.idempotencyRecordDigest,
    '$.idempotencyRecordDigest'
  )
  const idempotencyState = nullableIdempotencyState(source.idempotencyState, '$.idempotencyState')
  if (
    (idempotencyCASDigest === null) !== (idempotencyRecordDigest === null) ||
    (idempotencyCASDigest === null) !== (idempotencyState === null)
  ) {
    throw new TypeError('Idempotency CAS, record, and state bindings must be present together')
  }
  const parsed: BackendAutomationWorkerRecordV1 = Object.freeze({
    format: BACKEND_AUTOMATION_WORKER_RECORD_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    messageEnvelopeDigest: digest(source.messageEnvelopeDigest, '$.messageEnvelopeDigest'),
    leaseObservationDigest: digest(source.leaseObservationDigest, '$.leaseObservationDigest'),
    queueId: identifier(source.queueId, '$.queueId'),
    messageId: identifier(source.messageId, '$.messageId'),
    leaseId: identifier(source.leaseId, '$.leaseId'),
    deliveryId: identifier(source.deliveryId, '$.deliveryId'),
    deliveryAttempt: integer(
      source.deliveryAttempt,
      '$.deliveryAttempt',
      1,
      BACKEND_AUTOMATION_WORKER_MAX_DELIVERY_ATTEMPTS
    ),
    automationId: identifier(source.automationId, '$.automationId'),
    eventId: identifier(source.eventId, '$.eventId'),
    operationId: identifier(source.operationId, '$.operationId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    causationId: identifier(source.causationId, '$.causationId'),
    causationHop: integer(
      source.causationHop,
      '$.causationHop',
      0,
      BACKEND_AUTOMATION_WORKER_MAX_CAUSATION_HOP
    ),
    causationMaxHop: integer(
      source.causationMaxHop,
      '$.causationMaxHop',
      1,
      BACKEND_AUTOMATION_WORKER_MAX_CAUSATION_HOP
    ),
    attemptId: identifier(source.attemptId, '$.attemptId'),
    state: workerState(source.state, '$.state'),
    revision,
    previousRecordDigest,
    recordedAt: timestamp(source.recordedAt, '$.recordedAt'),
    transitionEvidenceDigest: digest(source.transitionEvidenceDigest, '$.transitionEvidenceDigest'),
    idempotencyCASDigest,
    idempotencyRecordDigest,
    idempotencyState,
    reconciliationEvidenceDigest: nullableDigest(
      source.reconciliationEvidenceDigest,
      '$.reconciliationEvidenceDigest'
    ),
    ...authorityFields(source)
  })
  if (parsed.causationHop > parsed.causationMaxHop) {
    throw new TypeError('$.causationHop cannot exceed $.causationMaxHop')
  }
  assertWorkerRecordStateShape(parsed)
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

export function parseBackendAutomationWorkerRecord(
  value: unknown
): BackendAutomationWorkerRecordV1 {
  try {
    return parseWorkerRecord(value)
  } catch {
    throw new TypeError('Backend Automation worker record is invalid.')
  }
}

export function canonicalBackendAutomationWorkerRecordBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseWorkerRecord(value))
  } catch {
    throw new TypeError('Backend Automation worker record is invalid.')
  }
}

export async function digestBackendAutomationWorkerRecord(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseWorkerRecord(value))
  } catch {
    throw new TypeError('Backend Automation worker record is invalid.')
  }
}

function sameWorkerBinding(
  left: BackendAutomationWorkerRecordV1,
  right: BackendAutomationWorkerRecordV1
): boolean {
  const keys = [
    'messageEnvelopeDigest',
    'leaseObservationDigest',
    'queueId',
    'messageId',
    'leaseId',
    'deliveryId',
    'deliveryAttempt',
    'automationId',
    'eventId',
    'operationId',
    'idempotencyKeyDigest',
    'causationId',
    'causationHop',
    'causationMaxHop',
    'attemptId'
  ] as const
  return keys.every((key) => left[key] === right[key])
}

function assertWorkerRecordBinding(
  record: BackendAutomationWorkerRecordV1,
  binding: BackendAutomationQueueLeaseBindingV1
): void {
  const { message, lease } = binding
  if (
    record.messageEnvelopeDigest !== binding.messageEnvelopeDigest ||
    record.leaseObservationDigest !== binding.leaseObservationDigest ||
    record.queueId !== message.queueId ||
    record.messageId !== message.messageId ||
    record.leaseId !== lease.leaseId ||
    record.deliveryId !== lease.deliveryId ||
    record.deliveryAttempt !== lease.deliveryAttempt ||
    record.automationId !== message.automationId ||
    record.eventId !== message.eventId ||
    record.operationId !== message.operationId ||
    record.idempotencyKeyDigest !== message.idempotencyKeyDigest ||
    record.causationId !== message.causationId ||
    record.causationHop !== message.causationHop ||
    record.causationMaxHop !== message.causationMaxHop ||
    record.attemptId !== lease.attemptId
  ) {
    throw new TypeError('Worker record crosses message, lease, attempt, or idempotency bindings')
  }
}

function assertReceivedWorkerTransition(next: BackendAutomationWorkerRecordV1): void {
  if (next.state !== 'pre-dispatch-outcome-unknown') {
    throw new TypeError('A received message must persist its pre-dispatch unknown fence')
  }
}

function assertPreDispatchWorkerTransition(
  previous: BackendAutomationWorkerRecordV1,
  next: BackendAutomationWorkerRecordV1
): void {
  if (
    next.state !== 'succeeded' &&
    next.state !== 'known-not-dispatched' &&
    next.state !== 'outcome-unknown'
  ) {
    throw new TypeError('A pre-dispatch fence may only settle or remain outcome-unknown')
  }
  if (
    next.idempotencyCASDigest === previous.idempotencyCASDigest ||
    next.idempotencyRecordDigest === previous.idempotencyRecordDigest
  ) {
    throw new TypeError('Dispatch settlement requires a new idempotency CAS and record digest')
  }
  if ((next.state === 'known-not-dispatched') !== (next.reconciliationEvidenceDigest !== null)) {
    throw new TypeError('Direct success/unknown and reconciled non-dispatch evidence are distinct')
  }
  if (
    next.reconciliationEvidenceDigest !== null &&
    next.reconciliationEvidenceDigest === previous.transitionEvidenceDigest
  ) {
    throw new TypeError('Known non-dispatch requires fresh reconciliation evidence')
  }
}

function assertUnknownWorkerTransition(
  previous: BackendAutomationWorkerRecordV1,
  next: BackendAutomationWorkerRecordV1
): void {
  if (
    next.state !== 'succeeded' &&
    next.state !== 'known-not-dispatched' &&
    next.state !== 'outcome-unknown'
  ) {
    throw new TypeError('An unknown outcome remains fenced until reconciliation')
  }
  if (
    next.reconciliationEvidenceDigest === null ||
    next.reconciliationEvidenceDigest === previous.transitionEvidenceDigest ||
    next.reconciliationEvidenceDigest === previous.reconciliationEvidenceDigest
  ) {
    throw new TypeError('An unknown outcome transition requires reconciliation evidence')
  }
  const idempotencyPairChanged =
    next.idempotencyCASDigest !== previous.idempotencyCASDigest &&
    next.idempotencyRecordDigest !== previous.idempotencyRecordDigest
  const idempotencyPairUnchanged =
    next.idempotencyCASDigest === previous.idempotencyCASDigest &&
    next.idempotencyRecordDigest === previous.idempotencyRecordDigest
  if (next.state === 'outcome-unknown' ? !idempotencyPairUnchanged : !idempotencyPairChanged) {
    throw new TypeError('Reconciliation must preserve or advance the exact idempotency pair')
  }
}

function assertWorkerStateTransition(
  previous: BackendAutomationWorkerRecordV1,
  next: BackendAutomationWorkerRecordV1,
  mode: 'standard' | 'deduplicated'
): void {
  if (
    previous.state === 'succeeded' ||
    previous.state === 'deduplicated' ||
    previous.state === 'known-not-dispatched'
  ) {
    throw new TypeError('A terminal worker record cannot be extended')
  }
  if (mode === 'deduplicated') {
    if (previous.state !== 'received' || next.state !== 'deduplicated') {
      throw new TypeError('A deduplicated replay must branch directly from its received record')
    }
    return
  }
  if (previous.state === 'received') return assertReceivedWorkerTransition(next)
  if (previous.state === 'pre-dispatch-outcome-unknown') {
    return assertPreDispatchWorkerTransition(previous, next)
  }
  assertUnknownWorkerTransition(previous, next)
}

async function assertWorkerTransition(
  current: BackendAutomationWorkerRecordV1 | null,
  next: BackendAutomationWorkerRecordV1,
  binding: BackendAutomationQueueLeaseBindingV1,
  mode: 'standard' | 'deduplicated' = 'standard'
): Promise<string | null> {
  assertWorkerRecordBinding(next, binding)
  if (current === null) {
    if (
      next.revision !== 0 ||
      next.previousRecordDigest !== null ||
      next.state !== 'received' ||
      next.recordedAt !== binding.lease.observedAt ||
      next.transitionEvidenceDigest !== binding.lease.leaseEvidenceDigest
    ) {
      throw new TypeError('Worker lifecycle must begin from the exact received lease observation')
    }
    return null
  }
  assertWorkerRecordBinding(current, binding)
  if (!sameWorkerBinding(current, next)) {
    throw new TypeError('Worker lifecycle binding changed')
  }
  if (current.revision >= BACKEND_AUTOMATION_WORKER_MAX_REVISION) {
    throw new TypeError('Worker lifecycle revision limit is exhausted')
  }
  const expectedHeadDigest = await digestCanonicalManifest(current)
  if (next.revision !== current.revision + 1 || next.previousRecordDigest !== expectedHeadDigest) {
    throw new TypeError('Worker lifecycle revision or previous digest is stale')
  }
  if (compareReleaseTimestamps(next.recordedAt, current.recordedAt) <= 0) {
    throw new TypeError('Worker lifecycle time must advance')
  }
  if (
    (next.state === 'pre-dispatch-outcome-unknown' || next.state === 'deduplicated') &&
    (compareReleaseTimestamps(next.recordedAt, binding.lease.visibilityDeadline) >= 0 ||
      compareReleaseTimestamps(next.recordedAt, binding.message.retentionDeadline) >= 0)
  ) {
    throw new TypeError('A pre-dispatch decision requires a live lease and retained message')
  }
  if (next.transitionEvidenceDigest === current.transitionEvidenceDigest) {
    throw new TypeError('Worker lifecycle transition evidence must advance')
  }
  assertWorkerStateTransition(current, next, mode)
  return expectedHeadDigest
}

function parseWorkerCASProposal(value: unknown): BackendAutomationWorkerCASProposalV1 {
  const source = exactRecord(value, '$', WORKER_CAS_KEYS)
  if (source.format !== BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const expectedRevision = nullableInteger(
    source.expectedRevision,
    '$.expectedRevision',
    0,
    BACKEND_AUTOMATION_WORKER_MAX_REVISION
  )
  const expectedHeadDigest = nullableDigest(source.expectedHeadDigest, '$.expectedHeadDigest')
  if ((expectedRevision === null) !== (expectedHeadDigest === null)) {
    throw new TypeError('Worker CAS expected revision and head must be present together')
  }
  const nextRevision = integer(
    source.nextRevision,
    '$.nextRevision',
    0,
    BACKEND_AUTOMATION_WORKER_MAX_REVISION
  )
  if (nextRevision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
    throw new TypeError('Worker CAS revision does not advance exactly')
  }
  const parsed: BackendAutomationWorkerCASProposalV1 = Object.freeze({
    format: BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    queueId: identifier(source.queueId, '$.queueId'),
    messageId: identifier(source.messageId, '$.messageId'),
    deliveryId: identifier(source.deliveryId, '$.deliveryId'),
    attemptId: identifier(source.attemptId, '$.attemptId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    expectedRevision,
    expectedHeadDigest,
    nextRevision,
    nextRecordDigest: digest(source.nextRecordDigest, '$.nextRecordDigest'),
    ...authorityFields(source)
  })
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

export function parseBackendAutomationWorkerCASProposal(
  value: unknown
): BackendAutomationWorkerCASProposalV1 {
  try {
    return parseWorkerCASProposal(value)
  } catch {
    throw new TypeError('Backend Automation worker CAS proposal is invalid.')
  }
}

export function canonicalBackendAutomationWorkerCASProposalBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseWorkerCASProposal(value))
  } catch {
    throw new TypeError('Backend Automation worker CAS proposal is invalid.')
  }
}

export async function digestBackendAutomationWorkerCASProposal(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseWorkerCASProposal(value))
  } catch {
    throw new TypeError('Backend Automation worker CAS proposal is invalid.')
  }
}

async function verifyWorkerCAS(
  proposalValue: unknown,
  messageValue: unknown,
  leaseValue: unknown,
  currentValue: unknown,
  nextValue: unknown,
  mode: 'standard' | 'deduplicated' = 'standard'
): Promise<BackendAutomationWorkerCASCandidateV1> {
  const message = parseMessage(messageValue)
  const lease = parseLease(leaseValue)
  const proposal = parseWorkerCASProposal(proposalValue)
  const current = currentValue === null ? null : parseWorkerRecord(currentValue)
  const next = parseWorkerRecord(nextValue)
  const binding = await bindParsedLease(message, lease)
  const expectedHeadDigest = await assertWorkerTransition(current, next, binding, mode)
  const recordDigest = await digestCanonicalManifest(next)
  if (
    proposal.queueId !== next.queueId ||
    proposal.messageId !== next.messageId ||
    proposal.deliveryId !== next.deliveryId ||
    proposal.attemptId !== next.attemptId ||
    proposal.idempotencyKeyDigest !== next.idempotencyKeyDigest ||
    proposal.expectedRevision !== (current?.revision ?? null) ||
    proposal.expectedHeadDigest !== expectedHeadDigest ||
    proposal.nextRevision !== next.revision ||
    proposal.nextRecordDigest !== recordDigest
  ) {
    throw new TypeError('Worker CAS proposal does not bind the exact transition')
  }
  return Object.freeze({ proposal, record: next, recordDigest })
}

export async function verifyBackendAutomationWorkerCASProposal(
  proposalValue: unknown,
  messageValue: unknown,
  leaseValue: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationWorkerCASCandidateV1> {
  try {
    return await verifyWorkerCAS(proposalValue, messageValue, leaseValue, currentValue, nextValue)
  } catch {
    throw new TypeError('Backend Automation worker CAS transition is invalid.')
  }
}

/** Produces an unprivileged CAS candidate; it neither authenticates nor persists the transition. */
export async function createBackendAutomationWorkerCASProposal(
  messageValue: unknown,
  leaseValue: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationWorkerCASCandidateV1> {
  try {
    const message = parseMessage(messageValue)
    const lease = parseLease(leaseValue)
    const current = currentValue === null ? null : parseWorkerRecord(currentValue)
    const next = parseWorkerRecord(nextValue)
    const binding = await bindParsedLease(message, lease)
    const expectedHeadDigest = await assertWorkerTransition(current, next, binding)
    const recordDigest = await digestCanonicalManifest(next)
    const proposal: BackendAutomationWorkerCASProposalV1 = Object.freeze({
      format: BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT,
      version: BACKEND_AUTOMATION_WORKER_VERSION,
      queueId: next.queueId,
      messageId: next.messageId,
      deliveryId: next.deliveryId,
      attemptId: next.attemptId,
      idempotencyKeyDigest: next.idempotencyKeyDigest,
      expectedRevision: current?.revision ?? null,
      expectedHeadDigest,
      nextRevision: next.revision,
      nextRecordDigest: recordDigest,
      ...NO_AUTHORITY
    })
    return await verifyWorkerCAS(proposal, binding.message, binding.lease, current, next)
  } catch {
    throw new TypeError('Backend Automation worker CAS transition is invalid.')
  }
}

interface PreparedWorkerDeduplicationTransition {
  readonly binding: BackendAutomationQueueLeaseBindingV1
  readonly current: BackendAutomationWorkerRecordV1
  readonly next: BackendAutomationWorkerRecordV1
  readonly expectedHeadDigest: string
}

function assertDeduplicationIdentity(
  message: BackendAutomationQueueMessageEnvelopeV1,
  record: BackendAutomationIdempotencyRecordV1,
  proposal: BackendAutomationIdempotencyCASProposalV1
): void {
  if (
    record.automationId !== message.automationId ||
    record.eventId !== message.eventId ||
    record.operationId !== message.operationId ||
    record.idempotencyKeyDigest !== message.idempotencyKeyDigest ||
    record.causationId !== message.causationId ||
    record.causationHop !== message.causationHop ||
    proposal.automationId !== message.automationId ||
    proposal.eventId !== message.eventId ||
    proposal.operationId !== message.operationId ||
    proposal.idempotencyKeyDigest !== message.idempotencyKeyDigest
  ) {
    throw new TypeError(
      'Deduplication evidence crosses automation, event, operation, idempotency, or causation identity'
    )
  }
}

function assertIndependentDeduplicationEvidence(
  binding: BackendAutomationQueueLeaseBindingV1,
  current: BackendAutomationWorkerRecordV1,
  currentHeadDigest: string,
  record: BackendAutomationIdempotencyRecordV1,
  proposal: BackendAutomationIdempotencyCASProposalV1,
  input: BackendAutomationWorkerDeduplicationInputV1,
  recordDigest: string,
  proposalDigest: string
): void {
  const evidence = [
    proposalDigest,
    recordDigest,
    input.terminalCASVerificationEvidenceDigest,
    input.transitionEvidenceDigest,
    record.completionEvidenceDigest,
    record.reconciliationEvidenceDigest,
    proposal.expectedHeadDigest
  ].filter((value): value is string => value !== null)
  const unrelatedBindings = new Set([
    binding.messageEnvelopeDigest,
    binding.message.payloadDigest,
    binding.leaseObservationDigest,
    binding.message.idempotencyKeyDigest,
    binding.lease.leaseEvidenceDigest,
    currentHeadDigest,
    current.transitionEvidenceDigest
  ])
  if (
    new Set(evidence).size !== evidence.length ||
    [
      proposalDigest,
      recordDigest,
      input.terminalCASVerificationEvidenceDigest,
      input.transitionEvidenceDigest
    ].some((value) => unrelatedBindings.has(value))
  ) {
    throw new TypeError(
      'Deduplication CAS, record/head, completion, terminal, and transition evidence must be independent'
    )
  }
}

async function prepareWorkerDeduplicationTransition(
  messageValue: unknown,
  leaseValue: unknown,
  currentValue: unknown,
  inputValue: unknown
): Promise<PreparedWorkerDeduplicationTransition> {
  // Parse every caller-controlled value before the first digest await so later mutation cannot
  // change the claimed Host verification snapshot.
  const message = parseMessage(messageValue)
  const lease = parseLease(leaseValue)
  const current = parseWorkerRecord(currentValue)
  const input = parseDeduplicationInput(inputValue)
  const binding = await bindParsedLease(message, lease)
  await assertWorkerTransition(null, current, binding)

  const record = input.succeededIdempotencyRecord
  const proposal = input.succeededIdempotencyCASProposal
  if (record.state !== 'succeeded' || record.revision < 2) {
    throw new TypeError('Deduplication requires a legally positioned succeeded idempotency record')
  }
  assertDeduplicationIdentity(message, record, proposal)
  if (
    input.succeededMessageEnvelopeDigest !== binding.messageEnvelopeDigest ||
    input.succeededPayloadDigest !== message.payloadDigest
  ) {
    throw new TypeError(
      'Deduplication requires the exact originally dispatched message envelope and payload'
    )
  }

  const [recordDigest, proposalDigest, expectedHeadDigest] = await Promise.all([
    digestBackendAutomationIdempotencyRecord(record),
    digestBackendAutomationIdempotencyCASProposal(proposal),
    digestCanonicalManifest(current)
  ])
  if (
    input.persistedHeadRevision !== record.revision ||
    input.persistedHeadDigest !== recordDigest ||
    proposal.nextRevision !== record.revision ||
    proposal.nextRecordDigest !== recordDigest ||
    proposal.expectedRevision !== record.revision - 1 ||
    proposal.expectedHeadDigest !== record.previousRecordDigest
  ) {
    throw new TypeError(
      'Deduplication record, claimed persisted head, and succeeded CAS proposal do not bind exactly'
    )
  }
  if (
    compareReleaseTimestamps(input.recordedAt, record.recordedAt) < 0 ||
    compareReleaseTimestamps(input.recordedAt, record.expiresAt) >= 0
  ) {
    throw new TypeError('Deduplication verification must follow the live succeeded record')
  }
  assertIndependentDeduplicationEvidence(
    binding,
    current,
    expectedHeadDigest,
    record,
    proposal,
    input,
    recordDigest,
    proposalDigest
  )

  const next = parseWorkerRecord({
    ...current,
    state: 'deduplicated',
    revision: current.revision + 1,
    previousRecordDigest: expectedHeadDigest,
    recordedAt: input.recordedAt,
    transitionEvidenceDigest: input.transitionEvidenceDigest,
    idempotencyCASDigest: proposalDigest,
    idempotencyRecordDigest: recordDigest,
    idempotencyState: 'succeeded',
    // Persist the separate terminal-head verification so a later ack must bind this exact proof.
    reconciliationEvidenceDigest: input.terminalCASVerificationEvidenceDigest,
    ...NO_AUTHORITY
  })
  await assertWorkerTransition(current, next, binding, 'deduplicated')
  return Object.freeze({ binding, current, next, expectedHeadDigest })
}

/**
 * Builds the sole received -> deduplicated transition. The Host must first authenticate the exact
 * succeeded idempotency record, its persisted current head, the historical CAS proposal, persisted
 * original message-envelope and payload evidence, and the separate terminal verification evidence.
 * Parsing/digest agreement here is not that authentication and grants no database, dispatch, queue
 * acknowledgement, credential, or release authority.
 */
export async function createBackendAutomationWorkerDeduplicationCASProposal(
  messageValue: unknown,
  leaseValue: unknown,
  receivedWorkerValue: unknown,
  inputValue: unknown
): Promise<BackendAutomationWorkerCASCandidateV1> {
  try {
    const prepared = await prepareWorkerDeduplicationTransition(
      messageValue,
      leaseValue,
      receivedWorkerValue,
      inputValue
    )
    const recordDigest = await digestCanonicalManifest(prepared.next)
    const proposal: BackendAutomationWorkerCASProposalV1 = Object.freeze({
      format: BACKEND_AUTOMATION_WORKER_CAS_PROPOSAL_FORMAT,
      version: BACKEND_AUTOMATION_WORKER_VERSION,
      queueId: prepared.next.queueId,
      messageId: prepared.next.messageId,
      deliveryId: prepared.next.deliveryId,
      attemptId: prepared.next.attemptId,
      idempotencyKeyDigest: prepared.next.idempotencyKeyDigest,
      expectedRevision: prepared.current.revision,
      expectedHeadDigest: prepared.expectedHeadDigest,
      nextRevision: prepared.next.revision,
      nextRecordDigest: recordDigest,
      ...NO_AUTHORITY
    })
    return await verifyWorkerCAS(
      proposal,
      prepared.binding.message,
      prepared.binding.lease,
      prepared.current,
      prepared.next,
      'deduplicated'
    )
  } catch {
    throw new TypeError('Backend Automation worker deduplication transition is invalid.')
  }
}

/** Verifies a deduplication candidate only when the same externally authenticated inputs recur. */
export async function verifyBackendAutomationWorkerDeduplicationCASProposal(
  proposalValue: unknown,
  messageValue: unknown,
  leaseValue: unknown,
  receivedWorkerValue: unknown,
  nextValue: unknown,
  inputValue: unknown
): Promise<BackendAutomationWorkerCASCandidateV1> {
  try {
    const next = parseWorkerRecord(nextValue)
    const prepared = await prepareWorkerDeduplicationTransition(
      messageValue,
      leaseValue,
      receivedWorkerValue,
      inputValue
    )
    if (JSON.stringify(next) !== JSON.stringify(prepared.next)) {
      throw new TypeError('Deduplication candidate differs from the exactly reconstructed record')
    }
    return await verifyWorkerCAS(
      proposalValue,
      prepared.binding.message,
      prepared.binding.lease,
      prepared.current,
      next,
      'deduplicated'
    )
  } catch {
    throw new TypeError('Backend Automation worker deduplication transition is invalid.')
  }
}

function mutationKind(value: unknown, path: string): BackendAutomationQueueMutationKind {
  if (typeof value !== 'string' || !MUTATION_KINDS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendAutomationQueueMutationKind
}

function nullableDispositionKind(
  value: unknown,
  path: string
): BackendAutomationQueueMutationProposalV1['dispositionKind'] {
  if (value === null) return null
  if (typeof value !== 'string' || !DISPOSITION_KINDS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as Exclude<BackendAutomationQueueMutationProposalV1['dispositionKind'], null>
}

function nullableDeadLetterState(value: unknown, path: string): 'published' | null {
  if (value === null) return null
  if (value !== 'published') throw new TypeError(`${path} is not supported`)
  return value
}

function parseMutationRequest(value: unknown): BackendAutomationQueueMutationRequestV1 {
  const source = exactRecord(value, '$', MUTATION_REQUEST_KEYS)
  const parsed = Object.freeze({
    kind: mutationKind(source.kind, '$.kind'),
    proposedAt: timestamp(source.proposedAt, '$.proposedAt'),
    nextVisibilityDeadline: nullableTimestamp(
      source.nextVisibilityDeadline,
      '$.nextVisibilityDeadline'
    ),
    terminalCASVerificationEvidenceDigest: nullableDigest(
      source.terminalCASVerificationEvidenceDigest,
      '$.terminalCASVerificationEvidenceDigest'
    ),
    executionDisposition:
      source.executionDisposition === null
        ? null
        : parseBackendAutomationExecutionDisposition(source.executionDisposition),
    deadLetterState: nullableDeadLetterState(source.deadLetterState, '$.deadLetterState'),
    deadLetterMessageEnvelopeDigest: nullableDigest(
      source.deadLetterMessageEnvelopeDigest,
      '$.deadLetterMessageEnvelopeDigest'
    ),
    deadLetterPublishedRecordDigest: nullableDigest(
      source.deadLetterPublishedRecordDigest,
      '$.deadLetterPublishedRecordDigest'
    ),
    deadLetterCASDigest: nullableDigest(source.deadLetterCASDigest, '$.deadLetterCASDigest'),
    deadLetterPublishVerificationEvidenceDigest: nullableDigest(
      source.deadLetterPublishVerificationEvidenceDigest,
      '$.deadLetterPublishVerificationEvidenceDigest'
    )
  })
  assertNoProxyValues(value)
  return parsed
}

function assertMutationTerminalEvidence(
  proposal: BackendAutomationQueueMutationProposalV1
): boolean {
  const idempotencyBound =
    proposal.idempotencyCASDigest !== null && proposal.idempotencyRecordDigest !== null
  if (
    idempotencyBound !== (proposal.terminalCASVerificationEvidenceDigest !== null) ||
    (proposal.idempotencyCASDigest === null) !== (proposal.idempotencyRecordDigest === null)
  ) {
    throw new TypeError('Queue terminal idempotency evidence must be bound together')
  }
  return idempotencyBound
}

function hasDeadLetterProposalEvidence(
  proposal: BackendAutomationQueueMutationProposalV1
): boolean {
  return (
    proposal.deadLetterQueueId !== null ||
    proposal.deadLetterState !== null ||
    proposal.deadLetterMessageEnvelopeDigest !== null ||
    proposal.deadLetterPublishedRecordDigest !== null ||
    proposal.deadLetterCASDigest !== null ||
    proposal.deadLetterPublishVerificationEvidenceDigest !== null
  )
}

function assertDistinctDeadLetterProposalEvidence(
  proposal: BackendAutomationQueueMutationProposalV1
): void {
  if (proposal.dispositionKind !== 'dead-letter') return
  const deadLetterDigests = [
    proposal.deadLetterMessageEnvelopeDigest,
    proposal.deadLetterPublishedRecordDigest,
    proposal.deadLetterCASDigest,
    proposal.deadLetterPublishVerificationEvidenceDigest
  ]
  if (deadLetterDigests.some((value) => value === null)) {
    throw new TypeError('Dead-letter archive is missing published record evidence')
  }
  const sourceDigests = new Set(
    [
      proposal.idempotencyKeyDigest,
      proposal.messageEnvelopeDigest,
      proposal.leaseObservationDigest,
      proposal.workerRecordDigest,
      proposal.idempotencyCASDigest,
      proposal.idempotencyRecordDigest,
      proposal.terminalCASVerificationEvidenceDigest,
      proposal.executionDispositionDigest
    ].filter((value): value is string => value !== null)
  )
  const distinct = deadLetterDigests as string[]
  if (
    new Set(distinct).size !== distinct.length ||
    distinct.some((value) => sourceDigests.has(value))
  ) {
    throw new TypeError('Dead-letter publication evidence must be exact and independently bound')
  }
}

function assertVisibilityProposalShape(
  proposal: BackendAutomationQueueMutationProposalV1,
  idempotencyBound: boolean
): void {
  if (
    idempotencyBound ||
    proposal.executionDispositionDigest !== null ||
    proposal.dispositionKind !== null ||
    hasDeadLetterProposalEvidence(proposal) ||
    proposal.nextVisibilityDeadline === null ||
    proposal.nextExtensionCount === null
  ) {
    throw new TypeError('Visibility extension proposal shape is invalid')
  }
}

function assertAcknowledgementProposalShape(
  proposal: BackendAutomationQueueMutationProposalV1,
  idempotencyBound: boolean
): void {
  if (
    !idempotencyBound ||
    (proposal.workerState !== 'succeeded' && proposal.workerState !== 'deduplicated') ||
    proposal.executionDispositionDigest !== null ||
    proposal.dispositionKind !== null ||
    hasDeadLetterProposalEvidence(proposal) ||
    proposal.nextVisibilityDeadline !== null ||
    proposal.nextExtensionCount !== null
  ) {
    throw new TypeError('Queue acknowledgement proposal shape is invalid')
  }
}

function assertRetryProposalShape(proposal: BackendAutomationQueueMutationProposalV1): void {
  if (
    proposal.dispositionKind !== 'retry' ||
    proposal.nextVisibilityDeadline === null ||
    hasDeadLetterProposalEvidence(proposal)
  ) {
    throw new TypeError('Queue retry proposal shape is invalid')
  }
}

function assertArchiveProposalShape(proposal: BackendAutomationQueueMutationProposalV1): void {
  const isDeadLetter = proposal.dispositionKind === 'dead-letter'
  const completeDeadLetterClaim =
    proposal.deadLetterQueueId !== null &&
    proposal.deadLetterState === 'published' &&
    proposal.deadLetterMessageEnvelopeDigest !== null &&
    proposal.deadLetterPublishedRecordDigest !== null &&
    proposal.deadLetterCASDigest !== null &&
    proposal.deadLetterPublishVerificationEvidenceDigest !== null
  if (
    proposal.nextVisibilityDeadline !== null ||
    (proposal.dispositionKind !== 'failed' && !isDeadLetter) ||
    isDeadLetter !== completeDeadLetterClaim ||
    (!isDeadLetter && hasDeadLetterProposalEvidence(proposal))
  ) {
    throw new TypeError('Queue archive proposal shape is invalid')
  }
  assertDistinctDeadLetterProposalEvidence(proposal)
}

function assertMutationProposalShape(proposal: BackendAutomationQueueMutationProposalV1): void {
  const idempotencyBound = assertMutationTerminalEvidence(proposal)
  if (proposal.kind === 'extend-visibility') {
    assertVisibilityProposalShape(proposal, idempotencyBound)
    return
  }
  if (proposal.kind === 'ack') {
    assertAcknowledgementProposalShape(proposal, idempotencyBound)
    return
  }
  if (
    !idempotencyBound ||
    proposal.workerState !== 'known-not-dispatched' ||
    proposal.executionDispositionDigest === null ||
    proposal.dispositionKind === null ||
    proposal.nextExtensionCount !== null
  ) {
    throw new TypeError('Queue retry/archive proposal shape is invalid')
  }
  if (proposal.kind === 'retry') assertRetryProposalShape(proposal)
  else assertArchiveProposalShape(proposal)
}

function parseMutationProposal(value: unknown): BackendAutomationQueueMutationProposalV1 {
  const source = exactRecord(value, '$', MUTATION_KEYS)
  if (source.format !== BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const kind = mutationKind(source.kind, '$.kind')
  const parsed: BackendAutomationQueueMutationProposalV1 = Object.freeze({
    format: BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    kind,
    queueId: identifier(source.queueId, '$.queueId'),
    messageId: identifier(source.messageId, '$.messageId'),
    leaseId: identifier(source.leaseId, '$.leaseId'),
    deliveryId: identifier(source.deliveryId, '$.deliveryId'),
    deliveryAttempt: integer(
      source.deliveryAttempt,
      '$.deliveryAttempt',
      1,
      BACKEND_AUTOMATION_WORKER_MAX_DELIVERY_ATTEMPTS
    ),
    attemptId: identifier(source.attemptId, '$.attemptId'),
    automationId: identifier(source.automationId, '$.automationId'),
    eventId: identifier(source.eventId, '$.eventId'),
    operationId: identifier(source.operationId, '$.operationId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    messageEnvelopeDigest: digest(source.messageEnvelopeDigest, '$.messageEnvelopeDigest'),
    leaseObservationDigest: digest(source.leaseObservationDigest, '$.leaseObservationDigest'),
    workerRecordDigest: digest(source.workerRecordDigest, '$.workerRecordDigest'),
    workerState: workerState(source.workerState, '$.workerState'),
    idempotencyCASDigest: nullableDigest(source.idempotencyCASDigest, '$.idempotencyCASDigest'),
    idempotencyRecordDigest: nullableDigest(
      source.idempotencyRecordDigest,
      '$.idempotencyRecordDigest'
    ),
    terminalCASVerificationEvidenceDigest: nullableDigest(
      source.terminalCASVerificationEvidenceDigest,
      '$.terminalCASVerificationEvidenceDigest'
    ),
    executionDispositionDigest: nullableDigest(
      source.executionDispositionDigest,
      '$.executionDispositionDigest'
    ),
    dispositionKind: nullableDispositionKind(source.dispositionKind, '$.dispositionKind'),
    deadLetterQueueId: nullableIdentifier(source.deadLetterQueueId, '$.deadLetterQueueId'),
    deadLetterState: nullableDeadLetterState(source.deadLetterState, '$.deadLetterState'),
    deadLetterMessageEnvelopeDigest: nullableDigest(
      source.deadLetterMessageEnvelopeDigest,
      '$.deadLetterMessageEnvelopeDigest'
    ),
    deadLetterPublishedRecordDigest: nullableDigest(
      source.deadLetterPublishedRecordDigest,
      '$.deadLetterPublishedRecordDigest'
    ),
    deadLetterCASDigest: nullableDigest(source.deadLetterCASDigest, '$.deadLetterCASDigest'),
    deadLetterPublishVerificationEvidenceDigest: nullableDigest(
      source.deadLetterPublishVerificationEvidenceDigest,
      '$.deadLetterPublishVerificationEvidenceDigest'
    ),
    proposedAt: timestamp(source.proposedAt, '$.proposedAt'),
    nextVisibilityDeadline: nullableTimestamp(
      source.nextVisibilityDeadline,
      '$.nextVisibilityDeadline'
    ),
    nextExtensionCount: nullableInteger(
      source.nextExtensionCount,
      '$.nextExtensionCount',
      1,
      BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS
    ),
    ...authorityFields(source)
  })
  assertMutationProposalShape(parsed)
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

export function parseBackendAutomationQueueMutationProposal(
  value: unknown
): BackendAutomationQueueMutationProposalV1 {
  try {
    return parseMutationProposal(value)
  } catch {
    throw new TypeError('Backend Automation queue mutation proposal is invalid.')
  }
}

export function canonicalBackendAutomationQueueMutationProposalBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseMutationProposal(value))
  } catch {
    throw new TypeError('Backend Automation queue mutation proposal is invalid.')
  }
}

export async function digestBackendAutomationQueueMutationProposal(
  value: unknown
): Promise<string> {
  try {
    return await digestCanonicalManifest(parseMutationProposal(value))
  } catch {
    throw new TypeError('Backend Automation queue mutation proposal is invalid.')
  }
}

function assertLiveLease(
  request: BackendAutomationQueueMutationRequestV1,
  binding: BackendAutomationQueueLeaseBindingV1
): void {
  if (
    compareReleaseTimestamps(request.proposedAt, binding.lease.observedAt) < 0 ||
    compareReleaseTimestamps(request.proposedAt, binding.lease.visibilityDeadline) >= 0
  ) {
    throw new TypeError('Queue mutation must be proposed while the observed lease remains visible')
  }
}

function assertDispositionBinding(
  disposition: BackendAutomationExecutionDispositionV1,
  worker: BackendAutomationWorkerRecordV1
): void {
  const { input } = disposition
  if (
    input.automationId !== worker.automationId ||
    input.operationId !== worker.operationId ||
    input.attemptId !== worker.attemptId ||
    input.eventId !== worker.eventId ||
    input.idempotencyDigest !== worker.idempotencyKeyDigest ||
    input.causation.id !== worker.causationId ||
    input.causation.hop !== worker.causationHop ||
    input.causation.maxHop !== worker.causationMaxHop ||
    input.attemptNumber !== worker.deliveryAttempt ||
    input.observedOutcome.evidenceDigest !== worker.transitionEvidenceDigest
  ) {
    throw new TypeError('Execution disposition crosses worker identity or evidence bindings')
  }
}

function terminalEvidence(
  request: BackendAutomationQueueMutationRequestV1,
  worker: BackendAutomationWorkerRecordV1
): string {
  const terminalVerification = request.terminalCASVerificationEvidenceDigest
  if (
    worker.idempotencyCASDigest === null ||
    worker.idempotencyRecordDigest === null ||
    terminalVerification === null ||
    terminalVerification === worker.idempotencyCASDigest ||
    terminalVerification === worker.idempotencyRecordDigest ||
    terminalVerification === worker.transitionEvidenceDigest
  ) {
    throw new TypeError('A separate terminal idempotency CAS verification digest is required')
  }
  if (worker.state === 'deduplicated') {
    if (
      worker.reconciliationEvidenceDigest === null ||
      terminalVerification !== worker.reconciliationEvidenceDigest
    ) {
      throw new TypeError(
        'A deduplicated acknowledgement must reuse its exact persisted terminal verification'
      )
    }
  } else if (terminalVerification === worker.reconciliationEvidenceDigest) {
    throw new TypeError(
      'Terminal CAS verification must be independent from reconciliation evidence'
    )
  }
  return terminalVerification
}

function assertNullDispositionRequest(request: BackendAutomationQueueMutationRequestV1): void {
  if (
    request.executionDisposition !== null ||
    request.deadLetterState !== null ||
    request.deadLetterMessageEnvelopeDigest !== null ||
    request.deadLetterPublishedRecordDigest !== null ||
    request.deadLetterCASDigest !== null ||
    request.deadLetterPublishVerificationEvidenceDigest !== null
  ) {
    throw new TypeError('Queue mutation request contains unrelated disposition evidence')
  }
}

function hasDeadLetterRequestEvidence(request: BackendAutomationQueueMutationRequestV1): boolean {
  return (
    request.deadLetterState !== null ||
    request.deadLetterMessageEnvelopeDigest !== null ||
    request.deadLetterPublishedRecordDigest !== null ||
    request.deadLetterCASDigest !== null ||
    request.deadLetterPublishVerificationEvidenceDigest !== null
  )
}

interface QueueMutationPlanFields {
  readonly terminalCASVerificationEvidenceDigest: string | null
  readonly executionDispositionDigest: string | null
  readonly dispositionKind: BackendAutomationQueueMutationProposalV1['dispositionKind']
  readonly deadLetterQueueId: string | null
  readonly deadLetterState: 'published' | null
  readonly deadLetterMessageEnvelopeDigest: string | null
  readonly deadLetterPublishedRecordDigest: string | null
  readonly deadLetterCASDigest: string | null
  readonly deadLetterPublishVerificationEvidenceDigest: string | null
  readonly nextVisibilityDeadline: string | null
  readonly nextExtensionCount: number | null
}

interface VerifiedSettledDisposition {
  readonly value: BackendAutomationExecutionDispositionV1
  readonly digest: string
  readonly kind: Exclude<BackendAutomationQueueMutationProposalV1['dispositionKind'], null>
  readonly terminalCASVerificationEvidenceDigest: string
}

function visibilityMutationFields(
  binding: BackendAutomationQueueLeaseBindingV1,
  worker: BackendAutomationWorkerRecordV1,
  request: BackendAutomationQueueMutationRequestV1
): QueueMutationPlanFields {
  if (
    worker.state !== 'received' &&
    worker.state !== 'pre-dispatch-outcome-unknown' &&
    worker.state !== 'outcome-unknown'
  ) {
    throw new TypeError('Only a nonterminal or unknown worker may extend visibility')
  }
  if (request.terminalCASVerificationEvidenceDigest !== null) {
    throw new TypeError('Visibility extension cannot claim terminal CAS verification')
  }
  assertNullDispositionRequest(request)
  if (
    request.nextVisibilityDeadline === null ||
    binding.lease.extensionCount >= BACKEND_AUTOMATION_WORKER_MAX_VISIBILITY_EXTENSIONS
  ) {
    throw new TypeError('Visibility extension count or deadline is invalid')
  }
  if (
    compareReleaseTimestamps(request.nextVisibilityDeadline, binding.lease.visibilityDeadline) <=
      0 ||
    compareReleaseTimestamps(request.nextVisibilityDeadline, binding.message.retentionDeadline) > 0
  ) {
    throw new TypeError('Visibility extension must advance without crossing retention')
  }
  assertPositiveBoundedDuration(
    request.proposedAt,
    request.nextVisibilityDeadline,
    binding.message.visibilityTimeoutSeconds,
    '$.nextVisibilityDeadline'
  )
  return Object.freeze({
    terminalCASVerificationEvidenceDigest: null,
    executionDispositionDigest: null,
    dispositionKind: null,
    deadLetterQueueId: null,
    deadLetterState: null,
    deadLetterMessageEnvelopeDigest: null,
    deadLetterPublishedRecordDigest: null,
    deadLetterCASDigest: null,
    deadLetterPublishVerificationEvidenceDigest: null,
    nextVisibilityDeadline: request.nextVisibilityDeadline,
    nextExtensionCount: binding.lease.extensionCount + 1
  })
}

function acknowledgementMutationFields(
  worker: BackendAutomationWorkerRecordV1,
  request: BackendAutomationQueueMutationRequestV1
): QueueMutationPlanFields {
  if (
    (worker.state !== 'succeeded' && worker.state !== 'deduplicated') ||
    worker.idempotencyState !== 'succeeded'
  ) {
    throw new TypeError('Only a successful terminal worker may propose acknowledgement')
  }
  assertNullDispositionRequest(request)
  if (request.nextVisibilityDeadline !== null) {
    throw new TypeError('Acknowledgement cannot change visibility')
  }
  return Object.freeze({
    terminalCASVerificationEvidenceDigest: terminalEvidence(request, worker),
    executionDispositionDigest: null,
    dispositionKind: null,
    deadLetterQueueId: null,
    deadLetterState: null,
    deadLetterMessageEnvelopeDigest: null,
    deadLetterPublishedRecordDigest: null,
    deadLetterCASDigest: null,
    deadLetterPublishVerificationEvidenceDigest: null,
    nextVisibilityDeadline: null,
    nextExtensionCount: null
  })
}

async function verifiedSettledDisposition(
  worker: BackendAutomationWorkerRecordV1,
  request: BackendAutomationQueueMutationRequestV1
): Promise<VerifiedSettledDisposition> {
  if (
    worker.state !== 'known-not-dispatched' ||
    worker.idempotencyState !== 'known-not-dispatched' ||
    request.executionDisposition === null
  ) {
    throw new TypeError('Retry/archive requires known-not-dispatched and a disposition')
  }
  const terminalCASVerificationEvidenceDigest = terminalEvidence(request, worker)
  assertDispositionBinding(request.executionDisposition, worker)
  const dispositionDigest = await digestBackendAutomationExecutionDisposition(
    request.executionDisposition
  )
  const kind = request.executionDisposition.decision.kind
  if (kind !== 'retry' && kind !== 'dead-letter' && kind !== 'failed') {
    throw new TypeError('Queue mutation requires a retry or exhausted disposition')
  }
  return Object.freeze({
    value: request.executionDisposition,
    digest: dispositionDigest,
    kind,
    terminalCASVerificationEvidenceDigest
  })
}

function retryMutationFields(
  binding: BackendAutomationQueueLeaseBindingV1,
  request: BackendAutomationQueueMutationRequestV1,
  disposition: VerifiedSettledDisposition
): QueueMutationPlanFields {
  if (
    disposition.kind !== 'retry' ||
    request.nextVisibilityDeadline === null ||
    hasDeadLetterRequestEvidence(request)
  ) {
    throw new TypeError('Retry request does not match the verified retry disposition')
  }
  const delayMs = disposition.value.decision.retryDelayMs
  if (delayMs === null) throw new TypeError('Retry disposition does not contain a delay')
  const retryDelta =
    releaseTimestampInstantNanoseconds(request.nextVisibilityDeadline, '$.nextVisibilityDeadline') -
    releaseTimestampInstantNanoseconds(request.proposedAt, '$.proposedAt')
  if (retryDelta !== BigInt(delayMs) * NANOSECONDS_PER_MILLISECOND) {
    throw new TypeError('Retry visibility does not match the disposition delay')
  }
  if (
    compareReleaseTimestamps(request.nextVisibilityDeadline, binding.message.retentionDeadline) >= 0
  ) {
    throw new TypeError('Retry visibility cannot cross message retention')
  }
  return Object.freeze({
    terminalCASVerificationEvidenceDigest: disposition.terminalCASVerificationEvidenceDigest,
    executionDispositionDigest: disposition.digest,
    dispositionKind: disposition.kind,
    deadLetterQueueId: null,
    deadLetterState: null,
    deadLetterMessageEnvelopeDigest: null,
    deadLetterPublishedRecordDigest: null,
    deadLetterCASDigest: null,
    deadLetterPublishVerificationEvidenceDigest: null,
    nextVisibilityDeadline: request.nextVisibilityDeadline,
    nextExtensionCount: null
  })
}

function archiveMutationFields(
  binding: BackendAutomationQueueLeaseBindingV1,
  worker: BackendAutomationWorkerRecordV1,
  request: BackendAutomationQueueMutationRequestV1,
  disposition: VerifiedSettledDisposition
): QueueMutationPlanFields {
  if (
    request.nextVisibilityDeadline !== null ||
    (disposition.kind !== 'failed' && disposition.kind !== 'dead-letter')
  ) {
    throw new TypeError('Archive request requires an exhausted disposition')
  }
  const deadLetterQueueId = disposition.value.decision.deadLetterQueueId
  if (disposition.kind === 'dead-letter') {
    const deadLetterDigests = [
      request.deadLetterMessageEnvelopeDigest,
      request.deadLetterPublishedRecordDigest,
      request.deadLetterCASDigest,
      request.deadLetterPublishVerificationEvidenceDigest
    ]
    if (
      deadLetterQueueId === null ||
      deadLetterQueueId === binding.message.queueId ||
      request.deadLetterState !== 'published' ||
      deadLetterDigests.some((value) => value === null)
    ) {
      throw new TypeError('Dead-letter archive requires an exact claimed-published DLQ record')
    }
    const distinctDeadLetterDigests = deadLetterDigests as string[]
    const sourceDigests = new Set([
      binding.message.idempotencyKeyDigest,
      binding.messageEnvelopeDigest,
      binding.leaseObservationDigest,
      worker.idempotencyCASDigest as string,
      worker.idempotencyRecordDigest as string,
      worker.transitionEvidenceDigest,
      disposition.digest,
      disposition.terminalCASVerificationEvidenceDigest
    ])
    if (
      new Set(distinctDeadLetterDigests).size !== distinctDeadLetterDigests.length ||
      distinctDeadLetterDigests.some((value) => sourceDigests.has(value))
    ) {
      throw new TypeError('Dead-letter publication evidence must not reuse source evidence')
    }
  } else if (deadLetterQueueId !== null || hasDeadLetterRequestEvidence(request)) {
    throw new TypeError('Non-DLQ archive cannot carry dead-letter evidence')
  }
  return Object.freeze({
    terminalCASVerificationEvidenceDigest: disposition.terminalCASVerificationEvidenceDigest,
    executionDispositionDigest: disposition.digest,
    dispositionKind: disposition.kind,
    deadLetterQueueId,
    deadLetterState: request.deadLetterState,
    deadLetterMessageEnvelopeDigest: request.deadLetterMessageEnvelopeDigest,
    deadLetterPublishedRecordDigest: request.deadLetterPublishedRecordDigest,
    deadLetterCASDigest: request.deadLetterCASDigest,
    deadLetterPublishVerificationEvidenceDigest:
      request.deadLetterPublishVerificationEvidenceDigest,
    nextVisibilityDeadline: null,
    nextExtensionCount: null
  })
}

async function mutationFields(
  binding: BackendAutomationQueueLeaseBindingV1,
  worker: BackendAutomationWorkerRecordV1,
  request: BackendAutomationQueueMutationRequestV1
): Promise<QueueMutationPlanFields> {
  if (request.kind === 'extend-visibility') {
    return visibilityMutationFields(binding, worker, request)
  }
  if (request.kind === 'ack') return acknowledgementMutationFields(worker, request)
  const disposition = await verifiedSettledDisposition(worker, request)
  return request.kind === 'retry'
    ? retryMutationFields(binding, request, disposition)
    : archiveMutationFields(binding, worker, request, disposition)
}

async function planQueueMutation(
  messageValue: unknown,
  leaseValue: unknown,
  workerValue: unknown,
  requestValue: unknown
): Promise<BackendAutomationQueueMutationProposalV1> {
  const message = parseMessage(messageValue)
  const lease = parseLease(leaseValue)
  const worker = parseWorkerRecord(workerValue)
  const request = parseMutationRequest(requestValue)
  const binding = await bindParsedLease(message, lease)
  assertWorkerRecordBinding(worker, binding)
  assertLiveLease(request, binding)
  if (compareReleaseTimestamps(request.proposedAt, worker.recordedAt) < 0) {
    throw new TypeError('Queue mutation cannot precede the bound worker record')
  }
  const workerRecordDigest = await digestCanonicalManifest(worker)
  const fields = await mutationFields(binding, worker, request)

  const proposal: BackendAutomationQueueMutationProposalV1 = Object.freeze({
    format: BACKEND_AUTOMATION_QUEUE_MUTATION_PROPOSAL_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    kind: request.kind,
    queueId: worker.queueId,
    messageId: worker.messageId,
    leaseId: worker.leaseId,
    deliveryId: worker.deliveryId,
    deliveryAttempt: worker.deliveryAttempt,
    attemptId: worker.attemptId,
    automationId: worker.automationId,
    eventId: worker.eventId,
    operationId: worker.operationId,
    idempotencyKeyDigest: worker.idempotencyKeyDigest,
    messageEnvelopeDigest: binding.messageEnvelopeDigest,
    leaseObservationDigest: binding.leaseObservationDigest,
    workerRecordDigest,
    workerState: worker.state,
    idempotencyCASDigest: request.kind === 'extend-visibility' ? null : worker.idempotencyCASDigest,
    idempotencyRecordDigest:
      request.kind === 'extend-visibility' ? null : worker.idempotencyRecordDigest,
    terminalCASVerificationEvidenceDigest: fields.terminalCASVerificationEvidenceDigest,
    executionDispositionDigest: fields.executionDispositionDigest,
    dispositionKind: fields.dispositionKind,
    deadLetterQueueId: fields.deadLetterQueueId,
    deadLetterState: fields.deadLetterState,
    deadLetterMessageEnvelopeDigest: fields.deadLetterMessageEnvelopeDigest,
    deadLetterPublishedRecordDigest: fields.deadLetterPublishedRecordDigest,
    deadLetterCASDigest: fields.deadLetterCASDigest,
    deadLetterPublishVerificationEvidenceDigest: fields.deadLetterPublishVerificationEvidenceDigest,
    proposedAt: request.proposedAt,
    nextVisibilityDeadline: fields.nextVisibilityDeadline,
    nextExtensionCount: fields.nextExtensionCount,
    ...NO_AUTHORITY
  })
  return parseMutationProposal(proposal)
}

/**
 * Produces an unprivileged queue mutation proposal only. The Host must independently authenticate
 * every digest, re-read the lease, and execute the queue/DB operation atomically where required.
 */
export async function planBackendAutomationQueueMutation(
  messageValue: unknown,
  leaseValue: unknown,
  workerValue: unknown,
  requestValue: unknown
): Promise<BackendAutomationQueueMutationProposalV1> {
  try {
    return await planQueueMutation(messageValue, leaseValue, workerValue, requestValue)
  } catch {
    throw new TypeError('Backend Automation queue mutation request is invalid.')
  }
}
