/* eslint-disable max-lines -- strict batch parsing, chain verification, and CAS binding form one fail-closed contract */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS,
  canonicalBackendOperationalEventBytes,
  digestBackendOperationalEvent,
  parseBackendOperationalEvent,
  verifyBackendOperationalEventChain,
  type BackendOperationalEventTrustedAnchorV1,
  type BackendOperationalEventV1
} from './release/operational-event'
import type { BackendReleaseEnvironment } from './release/types'
import {
  exactArray,
  exactRecord,
  nullableDigest,
  releaseDigest,
  releaseIdentifier,
  releaseTimestamp,
  stringValue
} from './release/validation'
import { containsBackendSecretLikeMaterial } from './secret-boundary'

export const BACKEND_OPERATIONAL_EVENT_SINK_VERSION = 1 as const
export const BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT =
  'openpencil.backend-operational-event-sink-input' as const
export const BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT =
  'openpencil.backend-operational-event-sink-batch' as const
export const BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT =
  'openpencil.backend-operational-event-sink-cas-proposal' as const
export const BACKEND_OPERATIONAL_EVENT_SINK_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const
export const BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION = Number.MAX_SAFE_INTEGER
/** Mirrors the bounded observability artifact envelope without depending on compiler internals. */
export const BACKEND_OPERATIONAL_EVENT_SINK_MAX_EVENT_CANONICAL_BYTES = 16_384
export const BACKEND_OPERATIONAL_EVENT_SINK_MAX_CANONICAL_BYTES = 262_144

const INPUT_KEYS = Object.freeze([
  'format',
  'version',
  'events',
  'trustedAnchor',
  'expectedRevision',
  'expectedHeadDigest'
] as const)
const ANCHOR_KEYS = Object.freeze([
  'format',
  'version',
  'providerId',
  'environment',
  'authorityDigest',
  'priorSegmentHeadDigest',
  'priorSegmentLastOccurredAt',
  'priorSegmentOpenAttemptIds',
  'trustedHeadDigest',
  'evaluatedAt'
] as const)
const BATCH_KEYS = Object.freeze([
  'format',
  'version',
  'providerId',
  'environment',
  'authorityDigest',
  'trustedAnchor',
  'segmentPriorHeadDigest',
  'segmentHeadDigest',
  'eventCount',
  'eventDigests',
  'events',
  'hostEvaluatedAt',
  'hostAnchorAuthenticated',
  'persistenceAuthorityGranted',
  'exportAuthorityGranted',
  'alertAuthorityGranted',
  'releaseAuthorityGranted'
] as const)
const PROPOSAL_KEYS = Object.freeze([
  'format',
  'version',
  'batch',
  'batchDigest',
  'expectedRevision',
  'expectedHeadDigest',
  'nextRevision',
  'nextHeadDigest',
  'hostAnchorAuthenticated',
  'persistenceAuthorityGranted',
  'exportAuthorityGranted',
  'alertAuthorityGranted',
  'releaseAuthorityGranted'
] as const)

export interface BackendOperationalEventSinkInputV1 {
  readonly format: typeof BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_SINK_VERSION
  readonly events: readonly BackendOperationalEventV1[]
  /** The Host must authenticate this anchor before passing it to this pure contract. */
  readonly trustedAnchor: BackendOperationalEventTrustedAnchorV1
  /** Null denotes an empty sink. A non-null revision must have a non-null head. */
  readonly expectedRevision: number | null
  readonly expectedHeadDigest: string | null
}

export interface BackendOperationalEventSinkBatchV1 {
  readonly format: typeof BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_SINK_VERSION
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly authorityDigest: string
  readonly trustedAnchor: BackendOperationalEventTrustedAnchorV1
  readonly segmentPriorHeadDigest: string | null
  readonly segmentHeadDigest: string
  readonly eventCount: number
  /** Digests preserve the exact event order; they are never sorted. */
  readonly eventDigests: readonly string[]
  readonly events: readonly BackendOperationalEventV1[]
  readonly hostEvaluatedAt: string
  /** This pure module validates anchor consistency but cannot authenticate its Host provenance. */
  readonly hostAnchorAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly exportAuthorityGranted: false
  readonly alertAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

export interface BackendOperationalEventSinkCASProposalV1 {
  readonly format: typeof BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_SINK_VERSION
  readonly batch: BackendOperationalEventSinkBatchV1
  readonly batchDigest: string
  readonly expectedRevision: number | null
  readonly expectedHeadDigest: string | null
  readonly nextRevision: number
  readonly nextHeadDigest: string
  readonly hostAnchorAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly exportAuthorityGranted: false
  readonly alertAuthorityGranted: false
  readonly releaseAuthorityGranted: false
}

function fixedFalse(value: unknown, path: string): false {
  if (value !== false) throw new TypeError(`${path} must be false`)
  return false
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

function nullableRevision(value: unknown, path: string): number | null {
  if (value === null) return null
  return integer(value, path, 0, BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION - 1)
}

function assertCanonicalByteLimit(value: unknown, path: string): Uint8Array {
  const bytes = canonicalManifestBytes(value)
  if (bytes.byteLength > BACKEND_OPERATIONAL_EVENT_SINK_MAX_CANONICAL_BYTES) {
    throw new TypeError(`${path} exceeds the canonical byte limit`)
  }
  return bytes
}

/**
 * Exact descriptor parsing runs first so structured cloning cannot encounter an accessor. Native
 * structured-clone then supplies the portable fail-closed check for otherwise transparent Proxy
 * values, which ECMAScript reflection alone cannot distinguish from their targets.
 */
function assertNoProxyValues(value: unknown, path: string): void {
  try {
    structuredClone(value)
  } catch {
    throw new TypeError(`${path} must contain cloneable plain data without Proxy values`)
  }
}

/**
 * Snapshot only the anchor's exact data shape. Semantic validation remains solely owned by
 * verifyBackendOperationalEventChain so this module cannot weaken or fork its release rules.
 */
function snapshotTrustedAnchor(value: unknown): BackendOperationalEventTrustedAnchorV1 {
  const source = exactRecord(value, '$.trustedAnchor', ANCHOR_KEYS)
  const priorSegmentOpenAttemptIds = Object.freeze(
    exactArray(
      source.priorSegmentOpenAttemptIds,
      '$.trustedAnchor.priorSegmentOpenAttemptIds',
      BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS
    )
  )
  const snapshot = Object.freeze({
    format: source.format,
    version: source.version,
    providerId: source.providerId,
    environment: source.environment,
    authorityDigest: source.authorityDigest,
    priorSegmentHeadDigest: source.priorSegmentHeadDigest,
    priorSegmentLastOccurredAt: source.priorSegmentLastOccurredAt,
    priorSegmentOpenAttemptIds,
    trustedHeadDigest: source.trustedHeadDigest,
    evaluatedAt: source.evaluatedAt
  })
  return snapshot as BackendOperationalEventTrustedAnchorV1
}

function snapshotEvents(value: unknown): readonly BackendOperationalEventV1[] {
  const entries = exactArray(value, '$.events', BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS)
  if (entries.length === 0) throw new TypeError('$.events must contain at least one event')
  const events = entries.map((entry, index) =>
    parseBackendOperationalEvent(entry, `$.events[${index}]`)
  )
  if (events.some((event) => event.durationMs !== null && Object.is(event.durationMs, -0))) {
    throw new TypeError('$.events must not contain negative zero')
  }
  if (
    events.some(
      (event) =>
        canonicalBackendOperationalEventBytes(event).byteLength >
        BACKEND_OPERATIONAL_EVENT_SINK_MAX_EVENT_CANONICAL_BYTES
    )
  ) {
    throw new TypeError('$.events contains an oversized canonical event')
  }
  return Object.freeze(events)
}

function assertCASPosition(
  expectedRevision: number | null,
  expectedHeadDigest: string | null
): void {
  if ((expectedRevision === null) !== (expectedHeadDigest === null)) {
    throw new TypeError('Expected sink revision and head digest must be present together')
  }
}

function snapshotInput(value: unknown): BackendOperationalEventSinkInputV1 {
  const source = exactRecord(value, '$', INPUT_KEYS)
  if (source.format !== BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_SINK_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const expectedRevision = nullableRevision(source.expectedRevision, '$.expectedRevision')
  const expectedHeadDigest = nullableDigest(source.expectedHeadDigest, '$.expectedHeadDigest')
  assertCASPosition(expectedRevision, expectedHeadDigest)
  const events = snapshotEvents(source.events)
  const trustedAnchor = snapshotTrustedAnchor(source.trustedAnchor)
  assertNoProxyValues(value, '$')
  return Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_SINK_INPUT_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
    events,
    trustedAnchor,
    expectedRevision,
    expectedHeadDigest
  })
}

function authorityFlags(): Pick<
  BackendOperationalEventSinkBatchV1,
  | 'hostAnchorAuthenticated'
  | 'persistenceAuthorityGranted'
  | 'exportAuthorityGranted'
  | 'alertAuthorityGranted'
  | 'releaseAuthorityGranted'
> {
  return {
    hostAnchorAuthenticated: false,
    persistenceAuthorityGranted: false,
    exportAuthorityGranted: false,
    alertAuthorityGranted: false,
    releaseAuthorityGranted: false
  }
}

function assertSecretFreeVerifiedEvents(
  events: readonly BackendOperationalEventV1[],
  trustedAnchor: BackendOperationalEventTrustedAnchorV1
): void {
  const strings: Array<string | null> = [
    trustedAnchor.providerId,
    ...trustedAnchor.priorSegmentOpenAttemptIds
  ]
  for (const event of events) {
    strings.push(
      event.eventId,
      event.operationId,
      event.attemptId,
      event.providerId,
      event.releaseId,
      event.planId,
      event.singleFlightKey,
      event.stableErrorCode,
      event.traceId,
      ...event.remoteOperationIds
    )
  }
  if (strings.some((entry) => entry !== null && containsBackendSecretLikeMaterial(entry))) {
    throw new TypeError('Operational event sink batch must be secret-free')
  }
}

async function createBatch(
  events: readonly BackendOperationalEventV1[],
  trustedAnchor: BackendOperationalEventTrustedAnchorV1
): Promise<BackendOperationalEventSinkBatchV1> {
  const verified = await verifyBackendOperationalEventChain(events, trustedAnchor)
  if (!verified.ok) {
    throw new TypeError(`Operational event sink batch failed strict verification: ${verified.code}`)
  }
  if (verified.events.length === 0 || verified.computedHeadDigest === null) {
    throw new TypeError('Operational event sink batch must not be empty')
  }
  assertSecretFreeVerifiedEvents(verified.events, trustedAnchor)
  const eventDigests = Object.freeze(
    await Promise.all(verified.events.map((event) => digestBackendOperationalEvent(event)))
  )
  if (eventDigests.at(-1) !== verified.computedHeadDigest) {
    throw new TypeError('Operational event sink batch head does not match its final event')
  }
  const domain = verified.events[0]
  const batch: BackendOperationalEventSinkBatchV1 = Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
    providerId: domain.providerId,
    environment: domain.environment,
    authorityDigest: domain.authorityDigest,
    trustedAnchor,
    segmentPriorHeadDigest: verified.priorSegmentHeadDigest,
    segmentHeadDigest: verified.computedHeadDigest,
    eventCount: verified.events.length,
    eventDigests,
    events: verified.events,
    hostEvaluatedAt: trustedAnchor.evaluatedAt,
    ...authorityFlags()
  })
  assertCanonicalByteLimit(batch, '$.batch')
  return batch
}

function parsedEventDigests(value: unknown): readonly string[] {
  return Object.freeze(
    exactArray(value, '$.batch.eventDigests', BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS).map(
      (entry, index) =>
        releaseDigest(
          stringValue(entry, `$.batch.eventDigests[${index}]`),
          `$.batch.eventDigests[${index}]`
        )
    )
  )
}

interface ParsedBatchClaims {
  readonly providerId: string
  readonly environment: string
  readonly authorityDigest: string
  readonly segmentPriorHeadDigest: string | null
  readonly segmentHeadDigest: string
  readonly eventCount: number
  readonly eventDigests: readonly string[]
  readonly hostEvaluatedAt: string
}

function parseBatchClaims(source: Record<string, unknown>): ParsedBatchClaims {
  const claims = Object.freeze({
    providerId: releaseIdentifier(
      stringValue(source.providerId, '$.batch.providerId'),
      '$.batch.providerId'
    ),
    environment: stringValue(source.environment, '$.batch.environment'),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, '$.batch.authorityDigest'),
      '$.batch.authorityDigest'
    ),
    segmentPriorHeadDigest: nullableDigest(
      source.segmentPriorHeadDigest,
      '$.batch.segmentPriorHeadDigest'
    ),
    segmentHeadDigest: releaseDigest(
      stringValue(source.segmentHeadDigest, '$.batch.segmentHeadDigest'),
      '$.batch.segmentHeadDigest'
    ),
    eventCount: integer(
      source.eventCount,
      '$.batch.eventCount',
      1,
      BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS
    ),
    eventDigests: parsedEventDigests(source.eventDigests),
    hostEvaluatedAt: releaseTimestamp(
      stringValue(source.hostEvaluatedAt, '$.batch.hostEvaluatedAt'),
      '$.batch.hostEvaluatedAt'
    )
  })
  fixedFalse(source.hostAnchorAuthenticated, '$.batch.hostAnchorAuthenticated')
  fixedFalse(source.persistenceAuthorityGranted, '$.batch.persistenceAuthorityGranted')
  fixedFalse(source.exportAuthorityGranted, '$.batch.exportAuthorityGranted')
  fixedFalse(source.alertAuthorityGranted, '$.batch.alertAuthorityGranted')
  fixedFalse(source.releaseAuthorityGranted, '$.batch.releaseAuthorityGranted')
  return claims
}

function assertSameStrings(left: readonly string[], right: readonly string[], path: string): void {
  if (left.length !== right.length || left.some((entry, index) => entry !== right[index])) {
    throw new TypeError(`${path} does not match the verified event order`)
  }
}

function assertBatchClaims(
  claims: ParsedBatchClaims,
  expected: BackendOperationalEventSinkBatchV1
): void {
  if (
    claims.providerId !== expected.providerId ||
    claims.environment !== expected.environment ||
    claims.authorityDigest !== expected.authorityDigest ||
    claims.segmentPriorHeadDigest !== expected.segmentPriorHeadDigest ||
    claims.segmentHeadDigest !== expected.segmentHeadDigest ||
    claims.eventCount !== expected.eventCount ||
    claims.hostEvaluatedAt !== expected.hostEvaluatedAt
  ) {
    throw new TypeError('$.batch claims do not match its strictly verified events and anchor')
  }
  assertSameStrings(claims.eventDigests, expected.eventDigests, '$.batch.eventDigests')
}

interface BatchSnapshot {
  readonly claims: ParsedBatchClaims
  readonly events: readonly BackendOperationalEventV1[]
  readonly trustedAnchor: BackendOperationalEventTrustedAnchorV1
}

function snapshotBatch(value: unknown): BatchSnapshot {
  const source = exactRecord(value, '$.batch', BATCH_KEYS)
  if (source.format !== BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT) {
    throw new TypeError('$.batch.format is not supported')
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_SINK_VERSION) {
    throw new TypeError('$.batch.version is not supported')
  }
  const events = snapshotEvents(source.events)
  const trustedAnchor = snapshotTrustedAnchor(source.trustedAnchor)
  const claims = parseBatchClaims(source)
  assertNoProxyValues(value, '$.batch')
  return Object.freeze({ claims, events, trustedAnchor })
}

async function verifyBatchSnapshot(
  snapshot: BatchSnapshot
): Promise<BackendOperationalEventSinkBatchV1> {
  const batch = await createBatch(snapshot.events, snapshot.trustedAnchor)
  assertBatchClaims(snapshot.claims, batch)
  return batch
}

async function verifyBatch(value: unknown): Promise<BackendOperationalEventSinkBatchV1> {
  return verifyBatchSnapshot(snapshotBatch(value))
}

/**
 * Verify and normalize a sink batch. This checks consistency against the supplied strict anchor,
 * but cannot authenticate that the anchor came from the Host or persist/export/alert anything.
 */
export async function verifyBackendOperationalEventSinkBatch(
  value: unknown
): Promise<BackendOperationalEventSinkBatchV1> {
  try {
    return await verifyBatch(value)
  } catch {
    throw new TypeError('Backend operational event sink batch is invalid.')
  }
}

function proposalFlags(source: Record<string, unknown>): void {
  fixedFalse(source.hostAnchorAuthenticated, '$.hostAnchorAuthenticated')
  fixedFalse(source.persistenceAuthorityGranted, '$.persistenceAuthorityGranted')
  fixedFalse(source.exportAuthorityGranted, '$.exportAuthorityGranted')
  fixedFalse(source.alertAuthorityGranted, '$.alertAuthorityGranted')
  fixedFalse(source.releaseAuthorityGranted, '$.releaseAuthorityGranted')
}

async function createProposal(
  input: BackendOperationalEventSinkInputV1
): Promise<BackendOperationalEventSinkCASProposalV1> {
  const batch = await createBatch(input.events, input.trustedAnchor)
  if (input.expectedHeadDigest !== batch.segmentPriorHeadDigest) {
    throw new TypeError('Expected sink head does not equal the verified segment prior head')
  }
  const batchDigest = await digestCanonicalManifest(batch)
  const nextRevision = input.expectedRevision === null ? 0 : input.expectedRevision + 1
  const proposal: BackendOperationalEventSinkCASProposalV1 = Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
    batch,
    batchDigest,
    expectedRevision: input.expectedRevision,
    expectedHeadDigest: input.expectedHeadDigest,
    nextRevision,
    nextHeadDigest: batch.segmentHeadDigest,
    ...authorityFlags()
  })
  assertCanonicalByteLimit(proposal, '$')
  return proposal
}

/**
 * Create an unprivileged deterministic CAS proposal only. A trusted Host must authenticate the
 * anchor, read the sink head, and atomically persist the exact revision/head/batch tuple.
 */
export async function createBackendOperationalEventSinkCASProposal(
  value: unknown
): Promise<BackendOperationalEventSinkCASProposalV1> {
  try {
    return await createProposal(snapshotInput(value))
  } catch {
    throw new TypeError('Backend operational event sink CAS proposal is invalid.')
  }
}

async function verifyProposal(value: unknown): Promise<BackendOperationalEventSinkCASProposalV1> {
  const source = exactRecord(value, '$', PROPOSAL_KEYS)
  if (source.format !== BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_SINK_VERSION) {
    throw new TypeError('$.version is not supported')
  }

  // Snapshot every nested and outer claim before the first asynchronous digest.
  const batchSnapshot = snapshotBatch(source.batch)
  const batchDigest = releaseDigest(
    stringValue(source.batchDigest, '$.batchDigest'),
    '$.batchDigest'
  )
  const expectedRevision = nullableRevision(source.expectedRevision, '$.expectedRevision')
  const expectedHeadDigest = nullableDigest(source.expectedHeadDigest, '$.expectedHeadDigest')
  assertCASPosition(expectedRevision, expectedHeadDigest)
  const nextRevision = integer(
    source.nextRevision,
    '$.nextRevision',
    0,
    BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION
  )
  const nextHeadDigest = releaseDigest(
    stringValue(source.nextHeadDigest, '$.nextHeadDigest'),
    '$.nextHeadDigest'
  )
  proposalFlags(source)
  assertNoProxyValues(value, '$')

  const batch = await verifyBatchSnapshot(batchSnapshot)
  const computedBatchDigest = await digestCanonicalManifest(batch)
  const computedNextRevision = expectedRevision === null ? 0 : expectedRevision + 1
  if (
    batchDigest !== computedBatchDigest ||
    expectedHeadDigest !== batch.segmentPriorHeadDigest ||
    nextRevision !== computedNextRevision ||
    nextHeadDigest !== batch.segmentHeadDigest
  ) {
    throw new TypeError(
      'Sink CAS proposal does not bind the exact batch and revision/head transition'
    )
  }
  return Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
    batch,
    batchDigest,
    expectedRevision,
    expectedHeadDigest,
    nextRevision,
    nextHeadDigest,
    ...authorityFlags()
  })
}

/** Recompute every batch and CAS binding without authenticating or executing the sink write. */
export async function verifyBackendOperationalEventSinkCASProposal(
  value: unknown
): Promise<BackendOperationalEventSinkCASProposalV1> {
  try {
    return await verifyProposal(value)
  } catch {
    throw new TypeError('Backend operational event sink CAS proposal is invalid.')
  }
}

export async function canonicalBackendOperationalEventSinkBatchBytes(
  value: unknown
): Promise<Uint8Array> {
  return assertCanonicalByteLimit(await verifyBackendOperationalEventSinkBatch(value), '$.batch')
}

export async function digestBackendOperationalEventSinkBatch(value: unknown): Promise<string> {
  return digestCanonicalManifest(await verifyBackendOperationalEventSinkBatch(value))
}

export async function canonicalBackendOperationalEventSinkCASProposalBytes(
  value: unknown
): Promise<Uint8Array> {
  return assertCanonicalByteLimit(await verifyBackendOperationalEventSinkCASProposal(value), '$')
}

export async function digestBackendOperationalEventSinkCASProposal(
  value: unknown
): Promise<string> {
  return digestCanonicalManifest(await verifyBackendOperationalEventSinkCASProposal(value))
}
