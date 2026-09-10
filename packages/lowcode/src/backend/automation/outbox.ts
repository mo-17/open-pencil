/* eslint-disable max-lines -- strict outbox parsing, lifecycle transitions, and CAS binding form one boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  compareReleaseTimestamps,
  exactRecord,
  exactArray,
  nullableDigest,
  releaseTimestamp,
  stringValue
} from '../release/validation'
import { containsBackendSecretLikeMaterial } from '../secret-boundary'
import { digest, fixedFalse, identifier, integer, nullableInteger } from './scalars'
import {
  BACKEND_AUTOMATION_WORKER_VERSION,
  parseBackendAutomationQueueMessageEnvelope,
  type BackendAutomationQueueMessageEnvelopeV1
} from './worker'

export const BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT =
  'openpencil.backend-automation-outbox-record' as const
export const BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT =
  'openpencil.backend-automation-outbox-cas-proposal' as const
export const BACKEND_AUTOMATION_OUTBOX_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const
export const BACKEND_AUTOMATION_OUTBOX_MAX_REVISION = 1_024
export const BACKEND_AUTOMATION_OUTBOX_MAX_ROW_VERSION = 2_147_483_647
export const BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS = 20
export const BACKEND_AUTOMATION_OUTBOX_MAX_CANONICAL_BYTES = 32_768

export const BACKEND_AUTOMATION_OUTBOX_STATES = Object.freeze([
  'pending',
  'pre-publish-outcome-unknown',
  'outcome-unknown',
  'known-not-published',
  'published',
  'delivered'
] as const)

export type BackendAutomationOutboxState = (typeof BACKEND_AUTOMATION_OUTBOX_STATES)[number]

/**
 * An immutable revision in a transactional outbox handoff ledger.
 *
 * All evidence is digest-only. This contract cannot authenticate the business transaction,
 * publish a message, persist a row, acknowledge delivery, or grant release authority.
 */
export interface BackendAutomationOutboxRecordV1 {
  readonly format: typeof BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly outboxId: string
  readonly businessTransactionId: string
  readonly businessTransactionDigest: string
  readonly entityId: string
  readonly rowIdDigest: string
  readonly rowVersion: number
  readonly eventId: string
  readonly eventDigest: string
  readonly queueId: string
  readonly messageEnvelopeDigest: string
  readonly idempotencyKeyDigest: string
  readonly publishAttemptIds: readonly string[]
  readonly currentPublishAttemptId: string
  readonly publishAttemptOrdinal: number
  readonly state: BackendAutomationOutboxState
  readonly revision: number
  readonly previousRecordDigest: string | null
  readonly recordedAt: string
  readonly transitionEvidenceDigest: string
  readonly publishConfirmationEvidenceDigest: string | null
  readonly knownNotPublishedEvidenceDigest: string | null
  readonly deliveryEvidenceDigest: string | null
  readonly reconciliationEvidenceDigest: string | null
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly ackAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

/** A deterministic, unprivileged CAS proposal for one exact outbox row revision. */
export interface BackendAutomationOutboxCASProposalV1 {
  readonly format: typeof BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_WORKER_VERSION
  readonly outboxId: string
  readonly businessTransactionId: string
  readonly businessTransactionDigest: string
  readonly entityId: string
  readonly rowIdDigest: string
  readonly rowVersion: number
  readonly eventId: string
  readonly eventDigest: string
  readonly queueId: string
  readonly messageEnvelopeDigest: string
  readonly idempotencyKeyDigest: string
  readonly currentPublishAttemptId: string
  readonly publishAttemptOrdinal: number
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

export interface BackendAutomationOutboxCASCandidateV1 {
  readonly proposal: BackendAutomationOutboxCASProposalV1
  readonly record: BackendAutomationOutboxRecordV1
  readonly recordDigest: string
}

const AUTHORITY_KEYS = Object.freeze([
  'hostEvidenceAuthenticated',
  'persistenceAuthorityGranted',
  'dispatchAuthorityGranted',
  'ackAuthorityGranted',
  'releaseAuthorityGranted'
] as const)

const RECORD_KEYS = Object.freeze([
  'format',
  'version',
  'outboxId',
  'businessTransactionId',
  'businessTransactionDigest',
  'entityId',
  'rowIdDigest',
  'rowVersion',
  'eventId',
  'eventDigest',
  'queueId',
  'messageEnvelopeDigest',
  'idempotencyKeyDigest',
  'publishAttemptIds',
  'currentPublishAttemptId',
  'publishAttemptOrdinal',
  'state',
  'revision',
  'previousRecordDigest',
  'recordedAt',
  'transitionEvidenceDigest',
  'publishConfirmationEvidenceDigest',
  'knownNotPublishedEvidenceDigest',
  'deliveryEvidenceDigest',
  'reconciliationEvidenceDigest',
  ...AUTHORITY_KEYS
] as const)

const CAS_KEYS = Object.freeze([
  'format',
  'version',
  'outboxId',
  'businessTransactionId',
  'businessTransactionDigest',
  'entityId',
  'rowIdDigest',
  'rowVersion',
  'eventId',
  'eventDigest',
  'queueId',
  'messageEnvelopeDigest',
  'idempotencyKeyDigest',
  'currentPublishAttemptId',
  'publishAttemptOrdinal',
  'expectedRevision',
  'expectedHeadDigest',
  'nextRevision',
  'nextRecordDigest',
  ...AUTHORITY_KEYS
] as const)

const OUTBOX_STATES = new Set<string>(BACKEND_AUTOMATION_OUTBOX_STATES)
const CANONICAL_NANOSECOND_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{9}Z$/u

const NO_AUTHORITY = Object.freeze({
  hostEvidenceAuthenticated: false,
  persistenceAuthorityGranted: false,
  dispatchAuthorityGranted: false,
  ackAuthorityGranted: false,
  releaseAuthorityGranted: false
} as const)

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

function timestamp(value: unknown, path: string): string {
  const parsed = releaseTimestamp(stringValue(value, path, 30), path)
  if (!CANONICAL_NANOSECOND_TIMESTAMP.test(parsed)) {
    throw new TypeError(`${path} must be a canonical UTC timestamp with nine fractional digits`)
  }
  return parsed
}

function state(value: unknown, path: string): BackendAutomationOutboxState {
  if (typeof value !== 'string' || !OUTBOX_STATES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendAutomationOutboxState
}

function boundedCanonicalBytes(value: unknown): Uint8Array {
  const bytes = canonicalManifestBytes(value)
  if (bytes.byteLength > BACKEND_AUTOMATION_OUTBOX_MAX_CANONICAL_BYTES) {
    throw new TypeError('Backend Automation outbox data exceeds the canonical byte limit')
  }
  return bytes
}

function assertSecretFreeNormalizedData(value: unknown): void {
  if (typeof value === 'string') {
    if (containsBackendSecretLikeMaterial(value)) {
      throw new TypeError('Backend Automation outbox data contains secret-like material')
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) assertSecretFreeNormalizedData(entry)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) assertSecretFreeNormalizedData(entry)
  }
}

/** Descriptor parsing runs first; structured clone rejects otherwise transparent Proxy values. */
function assertNoProxyValues(value: unknown): void {
  try {
    structuredClone(value)
  } catch {
    throw new TypeError('Backend Automation outbox input must be cloneable Proxy-free plain data')
  }
}

function publishAttemptIds(value: unknown, path: string): readonly string[] {
  const entries = exactArray(value, path, BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS).map(
    (entry, index) => identifier(entry, `${path}[${index}]`)
  )
  if (entries.length === 0 || new Set(entries).size !== entries.length) {
    throw new TypeError(`${path} must contain one or more unique publish attempt IDs`)
  }
  return Object.freeze(entries)
}

function assertNoSettlementEvidence(record: BackendAutomationOutboxRecordV1): void {
  if (
    record.publishConfirmationEvidenceDigest !== null ||
    record.knownNotPublishedEvidenceDigest !== null ||
    record.deliveryEvidenceDigest !== null ||
    record.reconciliationEvidenceDigest !== null
  ) {
    throw new TypeError(`${record.state} cannot carry settlement evidence`)
  }
}

function assertEvidenceShape(record: BackendAutomationOutboxRecordV1): void {
  const publish = record.publishConfirmationEvidenceDigest
  const knownNotPublished = record.knownNotPublishedEvidenceDigest
  const delivery = record.deliveryEvidenceDigest
  if (record.state === 'pending' || record.state === 'pre-publish-outcome-unknown') {
    assertNoSettlementEvidence(record)
    return
  }
  if (record.state === 'outcome-unknown') {
    if (publish !== null || knownNotPublished !== null || delivery !== null) {
      throw new TypeError('An unknown publish outcome cannot claim confirmation or delivery')
    }
    return
  }
  if (record.state === 'known-not-published') {
    if (publish !== null || knownNotPublished === null || delivery !== null) {
      throw new TypeError('Known-not-published state requires negative dispatch evidence only')
    }
    return
  }
  if (publish === null) {
    throw new TypeError('Published outbox state requires publish confirmation evidence')
  }
  if (knownNotPublished !== null) {
    throw new TypeError('Published outbox state cannot retain negative dispatch evidence')
  }
  if (record.state === 'published') {
    if (delivery !== null) throw new TypeError('Published state cannot claim downstream delivery')
    return
  }
  if (delivery === null || delivery === publish) {
    throw new TypeError('Delivered state requires separate delivery evidence')
  }
}

function parseRecord(value: unknown): BackendAutomationOutboxRecordV1 {
  const source = exactRecord(value, '$', RECORD_KEYS)
  if (source.format !== BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const revision = integer(source.revision, '$.revision', 0, BACKEND_AUTOMATION_OUTBOX_MAX_REVISION)
  const previousRecordDigest = nullableDigest(source.previousRecordDigest, '$.previousRecordDigest')
  if ((revision === 0) !== (previousRecordDigest === null)) {
    throw new TypeError('$.revision and $.previousRecordDigest do not form a chain position')
  }
  const attempts = publishAttemptIds(source.publishAttemptIds, '$.publishAttemptIds')
  const currentPublishAttemptId = identifier(
    source.currentPublishAttemptId,
    '$.currentPublishAttemptId'
  )
  const publishAttemptOrdinal = integer(
    source.publishAttemptOrdinal,
    '$.publishAttemptOrdinal',
    1,
    BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS
  )
  if (
    publishAttemptOrdinal !== attempts.length ||
    attempts[publishAttemptOrdinal - 1] !== currentPublishAttemptId
  ) {
    throw new TypeError('Current publish attempt must be the last unique attempt in order')
  }
  const parsed: BackendAutomationOutboxRecordV1 = Object.freeze({
    format: BACKEND_AUTOMATION_OUTBOX_RECORD_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    outboxId: identifier(source.outboxId, '$.outboxId'),
    businessTransactionId: identifier(source.businessTransactionId, '$.businessTransactionId'),
    businessTransactionDigest: digest(
      source.businessTransactionDigest,
      '$.businessTransactionDigest'
    ),
    entityId: identifier(source.entityId, '$.entityId'),
    rowIdDigest: digest(source.rowIdDigest, '$.rowIdDigest'),
    rowVersion: integer(
      source.rowVersion,
      '$.rowVersion',
      0,
      BACKEND_AUTOMATION_OUTBOX_MAX_ROW_VERSION
    ),
    eventId: identifier(source.eventId, '$.eventId'),
    eventDigest: digest(source.eventDigest, '$.eventDigest'),
    queueId: identifier(source.queueId, '$.queueId'),
    messageEnvelopeDigest: digest(source.messageEnvelopeDigest, '$.messageEnvelopeDigest'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    publishAttemptIds: attempts,
    currentPublishAttemptId,
    publishAttemptOrdinal,
    state: state(source.state, '$.state'),
    revision,
    previousRecordDigest,
    recordedAt: timestamp(source.recordedAt, '$.recordedAt'),
    transitionEvidenceDigest: digest(source.transitionEvidenceDigest, '$.transitionEvidenceDigest'),
    publishConfirmationEvidenceDigest: nullableDigest(
      source.publishConfirmationEvidenceDigest,
      '$.publishConfirmationEvidenceDigest'
    ),
    knownNotPublishedEvidenceDigest: nullableDigest(
      source.knownNotPublishedEvidenceDigest,
      '$.knownNotPublishedEvidenceDigest'
    ),
    deliveryEvidenceDigest: nullableDigest(
      source.deliveryEvidenceDigest,
      '$.deliveryEvidenceDigest'
    ),
    reconciliationEvidenceDigest: nullableDigest(
      source.reconciliationEvidenceDigest,
      '$.reconciliationEvidenceDigest'
    ),
    ...authorityFields(source)
  })
  assertEvidenceShape(parsed)
  assertNoProxyValues(value)
  assertSecretFreeNormalizedData(parsed)
  boundedCanonicalBytes(parsed)
  return parsed
}

export function parseBackendAutomationOutboxRecord(
  value: unknown
): BackendAutomationOutboxRecordV1 {
  try {
    return parseRecord(value)
  } catch {
    throw new TypeError('Backend Automation outbox record is invalid.')
  }
}

export function canonicalBackendAutomationOutboxRecordBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseRecord(value))
  } catch {
    throw new TypeError('Backend Automation outbox record is invalid.')
  }
}

export async function digestBackendAutomationOutboxRecord(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseRecord(value))
  } catch {
    throw new TypeError('Backend Automation outbox record is invalid.')
  }
}

function parseCASProposal(value: unknown): BackendAutomationOutboxCASProposalV1 {
  const source = exactRecord(value, '$', CAS_KEYS)
  if (source.format !== BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_WORKER_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const expectedRevision = nullableInteger(
    source.expectedRevision,
    '$.expectedRevision',
    0,
    BACKEND_AUTOMATION_OUTBOX_MAX_REVISION
  )
  const expectedHeadDigest = nullableDigest(source.expectedHeadDigest, '$.expectedHeadDigest')
  if ((expectedRevision === null) !== (expectedHeadDigest === null)) {
    throw new TypeError('Outbox CAS expected revision and head must be present together')
  }
  const nextRevision = integer(
    source.nextRevision,
    '$.nextRevision',
    0,
    BACKEND_AUTOMATION_OUTBOX_MAX_REVISION
  )
  if (nextRevision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
    throw new TypeError('Outbox CAS revision does not advance exactly')
  }
  const parsed: BackendAutomationOutboxCASProposalV1 = Object.freeze({
    format: BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT,
    version: BACKEND_AUTOMATION_WORKER_VERSION,
    outboxId: identifier(source.outboxId, '$.outboxId'),
    businessTransactionId: identifier(source.businessTransactionId, '$.businessTransactionId'),
    businessTransactionDigest: digest(
      source.businessTransactionDigest,
      '$.businessTransactionDigest'
    ),
    entityId: identifier(source.entityId, '$.entityId'),
    rowIdDigest: digest(source.rowIdDigest, '$.rowIdDigest'),
    rowVersion: integer(
      source.rowVersion,
      '$.rowVersion',
      0,
      BACKEND_AUTOMATION_OUTBOX_MAX_ROW_VERSION
    ),
    eventId: identifier(source.eventId, '$.eventId'),
    eventDigest: digest(source.eventDigest, '$.eventDigest'),
    queueId: identifier(source.queueId, '$.queueId'),
    messageEnvelopeDigest: digest(source.messageEnvelopeDigest, '$.messageEnvelopeDigest'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    currentPublishAttemptId: identifier(
      source.currentPublishAttemptId,
      '$.currentPublishAttemptId'
    ),
    publishAttemptOrdinal: integer(
      source.publishAttemptOrdinal,
      '$.publishAttemptOrdinal',
      1,
      BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS
    ),
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

export function parseBackendAutomationOutboxCASProposal(
  value: unknown
): BackendAutomationOutboxCASProposalV1 {
  try {
    return parseCASProposal(value)
  } catch {
    throw new TypeError('Backend Automation outbox CAS proposal is invalid.')
  }
}

export function canonicalBackendAutomationOutboxCASProposalBytes(value: unknown): Uint8Array {
  try {
    return boundedCanonicalBytes(parseCASProposal(value))
  } catch {
    throw new TypeError('Backend Automation outbox CAS proposal is invalid.')
  }
}

export async function digestBackendAutomationOutboxCASProposal(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseCASProposal(value))
  } catch {
    throw new TypeError('Backend Automation outbox CAS proposal is invalid.')
  }
}

function sameBinding(
  left: BackendAutomationOutboxRecordV1,
  right: BackendAutomationOutboxRecordV1
): boolean {
  const keys = [
    'outboxId',
    'businessTransactionId',
    'businessTransactionDigest',
    'entityId',
    'rowIdDigest',
    'rowVersion',
    'eventId',
    'eventDigest',
    'queueId',
    'messageEnvelopeDigest',
    'idempotencyKeyDigest'
  ] as const
  return keys.every((key) => left[key] === right[key])
}

async function assertMessageBinding(
  message: BackendAutomationQueueMessageEnvelopeV1,
  record: BackendAutomationOutboxRecordV1
): Promise<void> {
  const messageEnvelopeDigest = await digestCanonicalManifest(message)
  if (
    record.queueId !== message.queueId ||
    record.eventId !== message.eventId ||
    record.eventDigest !== message.payloadDigest ||
    record.messageEnvelopeDigest !== messageEnvelopeDigest ||
    record.idempotencyKeyDigest !== message.idempotencyKeyDigest
  ) {
    throw new TypeError('Outbox record crosses event, queue, message, or idempotency bindings')
  }
}

function sameAttempts(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): boolean {
  return (
    current.currentPublishAttemptId === next.currentPublishAttemptId &&
    current.publishAttemptOrdinal === next.publishAttemptOrdinal &&
    current.publishAttemptIds.length === next.publishAttemptIds.length &&
    current.publishAttemptIds.every((value, index) => value === next.publishAttemptIds[index])
  )
}

function assertAttemptTransition(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): void {
  if (current.state !== 'known-not-published') {
    if (!sameAttempts(current, next)) {
      throw new TypeError('Publish attempt identity changed outside a verified retry transition')
    }
    return
  }
  if (
    next.state !== 'pre-publish-outcome-unknown' ||
    current.publishAttemptOrdinal >= BACKEND_AUTOMATION_OUTBOX_MAX_PUBLISH_ATTEMPTS ||
    next.publishAttemptOrdinal !== current.publishAttemptOrdinal + 1 ||
    next.publishAttemptIds.length !== current.publishAttemptIds.length + 1 ||
    next.currentPublishAttemptId === current.currentPublishAttemptId ||
    !current.publishAttemptIds.every((value, index) => value === next.publishAttemptIds[index])
  ) {
    throw new TypeError('A retry must append one fresh bounded publish attempt')
  }
}

function assertPrePublishTransition(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): void {
  if (
    next.state !== 'published' &&
    next.state !== 'outcome-unknown' &&
    next.state !== 'known-not-published'
  ) {
    throw new TypeError('A pre-publish fence may only confirm, remain unknown, or prove no publish')
  }
  if (next.reconciliationEvidenceDigest !== null) {
    throw new TypeError('A direct publish result cannot claim reconciliation evidence')
  }
  if (
    next.state === 'known-not-published' &&
    next.knownNotPublishedEvidenceDigest === current.transitionEvidenceDigest
  ) {
    throw new TypeError('Known-not-published requires fresh negative dispatch evidence')
  }
  if (
    next.state === 'published' &&
    next.publishConfirmationEvidenceDigest === current.transitionEvidenceDigest
  ) {
    throw new TypeError('Publish confirmation must not reuse the pre-publish fence evidence')
  }
}

function assertUnknownTransition(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): void {
  if (
    next.state !== 'published' &&
    next.state !== 'outcome-unknown' &&
    next.state !== 'known-not-published'
  ) {
    throw new TypeError('An unknown publish outcome remains fenced until reconciliation')
  }
  if (
    next.reconciliationEvidenceDigest === null ||
    next.reconciliationEvidenceDigest === current.transitionEvidenceDigest ||
    next.reconciliationEvidenceDigest === current.reconciliationEvidenceDigest
  ) {
    throw new TypeError('Unknown publish reconciliation requires fresh evidence')
  }
  if (
    next.state === 'known-not-published' &&
    next.knownNotPublishedEvidenceDigest === current.transitionEvidenceDigest
  ) {
    throw new TypeError('Known-not-published requires fresh negative dispatch evidence')
  }
  if (
    next.state === 'published' &&
    (next.publishConfirmationEvidenceDigest === current.transitionEvidenceDigest ||
      next.publishConfirmationEvidenceDigest === current.reconciliationEvidenceDigest)
  ) {
    throw new TypeError('Publish confirmation must not reuse prior unknown evidence')
  }
}

function assertPublishedTransition(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): void {
  if (
    next.state !== 'delivered' ||
    next.publishConfirmationEvidenceDigest !== current.publishConfirmationEvidenceDigest ||
    next.reconciliationEvidenceDigest !== current.reconciliationEvidenceDigest ||
    next.deliveryEvidenceDigest === current.transitionEvidenceDigest ||
    next.deliveryEvidenceDigest === current.reconciliationEvidenceDigest
  ) {
    throw new TypeError('Published state may only record delivery without changing confirmation')
  }
}

function assertStateTransition(
  current: BackendAutomationOutboxRecordV1,
  next: BackendAutomationOutboxRecordV1
): void {
  if (current.state === 'delivered') {
    throw new TypeError('A delivered outbox record is immutable')
  }
  if (current.state === 'pending') {
    if (next.state !== 'pre-publish-outcome-unknown') {
      throw new TypeError('A pending outbox row must persist a pre-publish unknown fence')
    }
    return
  }
  if (current.state === 'pre-publish-outcome-unknown') {
    assertPrePublishTransition(current, next)
    return
  }
  if (current.state === 'outcome-unknown') {
    assertUnknownTransition(current, next)
    return
  }
  if (current.state === 'known-not-published') {
    if (next.state !== 'pre-publish-outcome-unknown') {
      throw new TypeError('Known-not-published may only begin one fresh publish attempt')
    }
    return
  }
  assertPublishedTransition(current, next)
}

async function assertTransition(
  message: BackendAutomationQueueMessageEnvelopeV1,
  current: BackendAutomationOutboxRecordV1 | null,
  next: BackendAutomationOutboxRecordV1
): Promise<string | null> {
  await assertMessageBinding(message, next)
  if (current === null) {
    if (
      next.revision !== 0 ||
      next.previousRecordDigest !== null ||
      next.state !== 'pending' ||
      next.publishAttemptOrdinal !== 1 ||
      next.publishAttemptIds.length !== 1 ||
      next.transitionEvidenceDigest !== next.businessTransactionDigest ||
      compareReleaseTimestamps(next.recordedAt, message.enqueuedAt) > 0
    ) {
      throw new TypeError('Outbox lifecycle must begin in the bound business transaction')
    }
    return null
  }
  await assertMessageBinding(message, current)
  if (!sameBinding(current, next)) {
    throw new TypeError('Outbox transaction, row, event, or message binding changed')
  }
  if (current.revision >= BACKEND_AUTOMATION_OUTBOX_MAX_REVISION) {
    throw new TypeError('Outbox lifecycle revision limit is exhausted')
  }
  const expectedHeadDigest = await digestCanonicalManifest(current)
  if (next.revision !== current.revision + 1 || next.previousRecordDigest !== expectedHeadDigest) {
    throw new TypeError('Outbox lifecycle revision or previous digest is stale')
  }
  if (compareReleaseTimestamps(next.recordedAt, current.recordedAt) <= 0) {
    throw new TypeError('Outbox lifecycle time must advance')
  }
  if (
    next.state === 'pre-publish-outcome-unknown' &&
    compareReleaseTimestamps(next.recordedAt, message.retentionDeadline) >= 0
  ) {
    throw new TypeError('A pre-publish fence requires a retained message')
  }
  if (next.transitionEvidenceDigest === current.transitionEvidenceDigest) {
    throw new TypeError('Outbox lifecycle transition evidence must advance')
  }
  assertAttemptTransition(current, next)
  assertStateTransition(current, next)
  return expectedHeadDigest
}

function proposalMatchesRecord(
  proposal: BackendAutomationOutboxCASProposalV1,
  record: BackendAutomationOutboxRecordV1
): boolean {
  const keys = [
    'outboxId',
    'businessTransactionId',
    'businessTransactionDigest',
    'entityId',
    'rowIdDigest',
    'rowVersion',
    'eventId',
    'eventDigest',
    'queueId',
    'messageEnvelopeDigest',
    'idempotencyKeyDigest',
    'currentPublishAttemptId',
    'publishAttemptOrdinal'
  ] as const
  return keys.every((key) => proposal[key] === record[key])
}

async function verifyCAS(
  proposalValue: unknown,
  messageValue: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationOutboxCASCandidateV1> {
  const message = parseBackendAutomationQueueMessageEnvelope(messageValue)
  const proposal = parseCASProposal(proposalValue)
  const current = currentValue === null ? null : parseRecord(currentValue)
  const next = parseRecord(nextValue)
  const expectedHeadDigest = await assertTransition(message, current, next)
  const recordDigest = await digestCanonicalManifest(next)
  if (
    !proposalMatchesRecord(proposal, next) ||
    proposal.expectedRevision !== (current?.revision ?? null) ||
    proposal.expectedHeadDigest !== expectedHeadDigest ||
    proposal.nextRevision !== next.revision ||
    proposal.nextRecordDigest !== recordDigest
  ) {
    throw new TypeError('Outbox CAS proposal does not bind the exact transition')
  }
  return Object.freeze({ proposal, record: next, recordDigest })
}

export async function verifyBackendAutomationOutboxCASProposal(
  proposalValue: unknown,
  messageValue: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationOutboxCASCandidateV1> {
  try {
    return await verifyCAS(proposalValue, messageValue, currentValue, nextValue)
  } catch {
    throw new TypeError('Backend Automation outbox CAS transition is invalid.')
  }
}

/**
 * Produces an unprivileged CAS candidate only. A trusted DB Host must authenticate the evidence,
 * compare the exact row head and revision, and persist the candidate atomically.
 */
export async function createBackendAutomationOutboxCASProposal(
  messageValue: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationOutboxCASCandidateV1> {
  try {
    const message = parseBackendAutomationQueueMessageEnvelope(messageValue)
    const current = currentValue === null ? null : parseRecord(currentValue)
    const next = parseRecord(nextValue)
    const expectedHeadDigest = await assertTransition(message, current, next)
    const recordDigest = await digestCanonicalManifest(next)
    const proposal: BackendAutomationOutboxCASProposalV1 = Object.freeze({
      format: BACKEND_AUTOMATION_OUTBOX_CAS_PROPOSAL_FORMAT,
      version: BACKEND_AUTOMATION_WORKER_VERSION,
      outboxId: next.outboxId,
      businessTransactionId: next.businessTransactionId,
      businessTransactionDigest: next.businessTransactionDigest,
      entityId: next.entityId,
      rowIdDigest: next.rowIdDigest,
      rowVersion: next.rowVersion,
      eventId: next.eventId,
      eventDigest: next.eventDigest,
      queueId: next.queueId,
      messageEnvelopeDigest: next.messageEnvelopeDigest,
      idempotencyKeyDigest: next.idempotencyKeyDigest,
      currentPublishAttemptId: next.currentPublishAttemptId,
      publishAttemptOrdinal: next.publishAttemptOrdinal,
      expectedRevision: current?.revision ?? null,
      expectedHeadDigest,
      nextRevision: next.revision,
      nextRecordDigest: recordDigest,
      ...NO_AUTHORITY
    })
    return await verifyCAS(proposal, message, current, next)
  } catch {
    throw new TypeError('Backend Automation outbox CAS transition is invalid.')
  }
}
