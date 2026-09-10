/* eslint-disable max-lines -- strict event parsing, lifecycle checks, authenticated anchors, and append CAS form one audit boundary */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { BackendReleaseEnvironment } from './types'
import {
  compareReleaseTimestamps,
  exactArray,
  exactRecord,
  nullableDigest,
  nullableTimestamp,
  releaseDigest,
  releaseIdentifier,
  releaseText,
  releaseTimestamp,
  sortedUniqueStrings,
  stringValue
} from './validation'

export const BACKEND_OPERATIONAL_EVENT_VERSION = 1 as const
export const BACKEND_OPERATIONAL_EVENT_FORMAT = 'openpencil.backend-operational-event' as const
export const BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT =
  'openpencil.backend-operational-anchor' as const
export const BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT =
  'openpencil.backend-operational-append-authority' as const
export const BACKEND_OPERATIONAL_EVENT_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const
export const BACKEND_OPERATIONAL_EVENT_MAX_DURATION_MS = 31 * 24 * 60 * 60 * 1_000
export const BACKEND_OPERATIONAL_EVENT_MAX_SINGLE_FLIGHT_KEY_LENGTH = 8_192
export const BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS = 256

export const BACKEND_OPERATIONAL_EVENT_PHASES = Object.freeze([
  'apply',
  'confirm',
  'dispatch',
  'emit',
  'execute',
  'inspect',
  'observe',
  'plan',
  'receipt',
  'reconcile',
  'review',
  'verify'
] as const)

export type BackendOperationalEventPhase = (typeof BACKEND_OPERATIONAL_EVENT_PHASES)[number]

export const BACKEND_OPERATIONAL_EVENT_OUTCOMES = Object.freeze([
  'blocked',
  'cancelled',
  'failed',
  'outcome-unknown',
  'started',
  'succeeded'
] as const)

export type BackendOperationalEventOutcome = (typeof BACKEND_OPERATIONAL_EVENT_OUTCOMES)[number]

export interface BackendOperationalEventV1 {
  readonly format: typeof BACKEND_OPERATIONAL_EVENT_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_VERSION
  readonly eventId: string
  readonly operationId: string
  readonly attemptId: string
  readonly occurredAt: string
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly authorityDigest: string
  readonly releaseId: string | null
  readonly planId: string | null
  readonly planDigest: string | null
  readonly singleFlightKey: string | null
  readonly remoteOperationIds: readonly string[]
  readonly phase: BackendOperationalEventPhase
  readonly outcome: BackendOperationalEventOutcome
  readonly durationMs: number | null
  readonly stableErrorCode: string | null
  readonly evidenceDigest: string | null
  readonly traceId: string | null
  readonly previousEventDigest: string | null
}

/** Host-authenticated checkpoint for one bounded event segment. */
export interface BackendOperationalEventTrustedAnchorV1 {
  readonly format: typeof BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_VERSION
  readonly providerId: string
  readonly environment: BackendReleaseEnvironment
  readonly authorityDigest: string
  readonly priorSegmentHeadDigest: string | null
  readonly priorSegmentLastOccurredAt: string | null
  /** Host-derived prior-segment state; rotation is forbidden unless this is empty. */
  readonly priorSegmentOpenAttemptIds: readonly string[]
  readonly trustedHeadDigest: string | null
  /** Trusted Host clock used to reject future-dated persisted or appended events. */
  readonly evaluatedAt: string
}

/**
 * Host-owned authority for exactly one append attempt. The Host must reserve
 * eventId/attemptId globally and persist the new head with the same CAS write.
 */
export interface BackendOperationalEventAppendAuthorityV1 {
  readonly format: typeof BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT
  readonly version: typeof BACKEND_OPERATIONAL_EVENT_VERSION
  readonly eventId: string
  readonly operationId: string
  readonly attemptId: string
  /** Host-observed time; the sealed event uses this exact value as occurredAt. */
  readonly observedAt: string
  readonly phase: BackendOperationalEventPhase
  readonly outcome: BackendOperationalEventOutcome
  readonly releaseId: string | null
  readonly planId: string | null
  readonly planDigest: string | null
  readonly singleFlightKey: string | null
  readonly remoteOperationIds: readonly string[]
  readonly durationMs: number | null
  readonly stableErrorCode: string | null
  readonly evidenceDigest: string | null
  readonly traceId: string | null
}

export type BackendOperationalEventChainErrorCode =
  | 'operational-event-invalid'
  | 'operational-event-chain-broken'
  | 'operational-event-trusted-anchor-required'
  | 'operational-event-head-mismatch'
  | 'operational-event-id-duplicate'
  | 'operational-event-order-invalid'
  | 'operational-event-domain-mismatch'
  | 'operational-event-attempt-transition-invalid'
  | 'operational-event-attempt-binding-mismatch'
  | 'operational-event-clock-skew-invalid'
  | 'operational-event-segment-boundary-open'
  | 'operational-event-single-flight-conflict'

export type BackendOperationalEventChainInspection =
  | Readonly<{
      ok: true
      events: readonly BackendOperationalEventV1[]
      priorSegmentHeadDigest: string | null
      computedHeadDigest: string | null
      openAttemptIds: readonly string[]
    }>
  | Readonly<{
      ok: false
      index: number
      code: BackendOperationalEventChainErrorCode
      message: string
    }>

export type BackendOperationalEventChainVerification = BackendOperationalEventChainInspection
type BackendOperationalEventChainFailure = Extract<
  BackendOperationalEventChainInspection,
  { ok: false }
>

interface AttemptState {
  readonly first: BackendOperationalEventV1
  terminal: boolean
}

const PHASES = new Set<string>(BACKEND_OPERATIONAL_EVENT_PHASES)
const OUTCOMES = new Set<string>(BACKEND_OPERATIONAL_EVENT_OUTCOMES)
const ENVIRONMENTS = new Set<string>(['preview', 'staging', 'production'])
const TERMINAL_ERROR_OUTCOMES = new Set<BackendOperationalEventOutcome>([
  'blocked',
  'cancelled',
  'failed',
  'outcome-unknown'
])
const RELEASE_BOUND_PHASES = new Set<BackendOperationalEventPhase>([
  'plan',
  'emit',
  'review',
  'confirm',
  'dispatch',
  'apply',
  'verify',
  'receipt',
  'reconcile'
])
const SINGLE_FLIGHT_PHASES = new Set<BackendOperationalEventPhase>([
  'dispatch',
  'apply',
  'reconcile'
])
const EVIDENCE_PHASES = new Set<BackendOperationalEventPhase>(['verify', 'receipt'])

export const BACKEND_OPERATIONAL_EVENT_FIELDS = Object.freeze([
  'format',
  'version',
  'eventId',
  'operationId',
  'attemptId',
  'occurredAt',
  'providerId',
  'environment',
  'authorityDigest',
  'releaseId',
  'planId',
  'planDigest',
  'singleFlightKey',
  'remoteOperationIds',
  'phase',
  'outcome',
  'durationMs',
  'stableErrorCode',
  'evidenceDigest',
  'traceId',
  'previousEventDigest'
] as const)
const EVENT_KEYS = BACKEND_OPERATIONAL_EVENT_FIELDS
const ANCHOR_KEYS = [
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
] as const
const APPEND_AUTHORITY_KEYS = [
  'format',
  'version',
  'eventId',
  'operationId',
  'attemptId',
  'observedAt',
  'phase',
  'outcome',
  'releaseId',
  'planId',
  'planDigest',
  'singleFlightKey',
  'remoteOperationIds',
  'durationMs',
  'stableErrorCode',
  'evidenceDigest',
  'traceId'
] as const

function nullableIdentifier(value: unknown, path: string): string | null {
  if (value === null) return null
  return releaseIdentifier(stringValue(value, path), path)
}

function nullableSingleFlightKey(value: unknown, path: string): string | null {
  if (value === null) return null
  return releaseText(
    stringValue(value, path, BACKEND_OPERATIONAL_EVENT_MAX_SINGLE_FLIGHT_KEY_LENGTH),
    path,
    BACKEND_OPERATIONAL_EVENT_MAX_SINGLE_FLIGHT_KEY_LENGTH
  )
}

function nonNegativeDuration(value: unknown, path: string): number | null {
  if (value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > BACKEND_OPERATIONAL_EVENT_MAX_DURATION_MS
  ) {
    throw new TypeError(`${path} must be null or a bounded non-negative integer`)
  }
  return value
}

function environment(value: unknown, path: string): BackendReleaseEnvironment {
  if (typeof value !== 'string' || !ENVIRONMENTS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendReleaseEnvironment
}

function phase(value: unknown, path: string): BackendOperationalEventPhase {
  if (typeof value !== 'string' || !PHASES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendOperationalEventPhase
}

function outcome(value: unknown, path: string): BackendOperationalEventOutcome {
  if (typeof value !== 'string' || !OUTCOMES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendOperationalEventOutcome
}

interface ParsedEventSemantics {
  phase: BackendOperationalEventPhase
  outcome: BackendOperationalEventOutcome
  durationMs: number | null
  stableErrorCode: string | null
  releaseId: string | null
  planId: string | null
  planDigest: string | null
  singleFlightKey: string | null
  evidenceDigest: string | null
}

function validateEventSemantics(value: ParsedEventSemantics, path: string): void {
  if (value.outcome === 'started' && value.durationMs !== null) {
    throw new TypeError(`${path}.durationMs must be null while an operation is started`)
  }
  if (value.outcome !== 'started' && value.durationMs === null) {
    throw new TypeError(`${path}.durationMs is required for a terminal outcome`)
  }
  if (TERMINAL_ERROR_OUTCOMES.has(value.outcome) !== (value.stableErrorCode !== null)) {
    throw new TypeError(`${path}.stableErrorCode does not match the outcome`)
  }
  if ((value.planId === null) !== (value.planDigest === null)) {
    throw new TypeError(`${path}.planId and planDigest must be present together`)
  }
  if (
    RELEASE_BOUND_PHASES.has(value.phase) &&
    (!value.releaseId || !value.planId || !value.planDigest)
  ) {
    throw new TypeError(`${path} release phase requires releaseId, planId, and planDigest`)
  }
  if (SINGLE_FLIGHT_PHASES.has(value.phase) && !value.singleFlightKey) {
    throw new TypeError(`${path} dispatch/apply/reconcile phase requires singleFlightKey`)
  }
  if (value.evidenceDigest && !EVIDENCE_PHASES.has(value.phase)) {
    throw new TypeError(`${path}.evidenceDigest is allowed only for verify or receipt phases`)
  }
  if (value.evidenceDigest && value.outcome === 'started') {
    throw new TypeError(`${path}.evidenceDigest is not allowed while an operation is started`)
  }
  if (EVIDENCE_PHASES.has(value.phase) && value.outcome === 'succeeded' && !value.evidenceDigest) {
    throw new TypeError(`${path} successful verify/receipt phase requires evidenceDigest`)
  }
}

function parseEventFields(
  source: Record<string, unknown>,
  path: string
): BackendOperationalEventV1 {
  if (source.format !== BACKEND_OPERATIONAL_EVENT_FORMAT) {
    throw new TypeError(`${path}.format is not supported`)
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_VERSION) {
    throw new TypeError(`${path}.version is not supported`)
  }
  const parsedPhase = phase(source.phase, `${path}.phase`)
  const parsedOutcome = outcome(source.outcome, `${path}.outcome`)
  const durationMs = nonNegativeDuration(source.durationMs, `${path}.durationMs`)
  const stableErrorCode = nullableIdentifier(source.stableErrorCode, `${path}.stableErrorCode`)
  const releaseId = nullableIdentifier(source.releaseId, `${path}.releaseId`)
  const planId = nullableIdentifier(source.planId, `${path}.planId`)
  const planDigest = nullableDigest(source.planDigest, `${path}.planDigest`)
  const singleFlightKey = nullableSingleFlightKey(source.singleFlightKey, `${path}.singleFlightKey`)
  const evidenceDigest = nullableDigest(source.evidenceDigest, `${path}.evidenceDigest`)
  validateEventSemantics(
    {
      phase: parsedPhase,
      outcome: parsedOutcome,
      durationMs,
      stableErrorCode,
      releaseId,
      planId,
      planDigest,
      singleFlightKey,
      evidenceDigest
    },
    path
  )
  return Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_VERSION,
    eventId: releaseIdentifier(stringValue(source.eventId, `${path}.eventId`), `${path}.eventId`),
    operationId: releaseIdentifier(
      stringValue(source.operationId, `${path}.operationId`),
      `${path}.operationId`
    ),
    attemptId: releaseIdentifier(
      stringValue(source.attemptId, `${path}.attemptId`),
      `${path}.attemptId`
    ),
    occurredAt: releaseTimestamp(
      stringValue(source.occurredAt, `${path}.occurredAt`),
      `${path}.occurredAt`
    ),
    providerId: releaseIdentifier(
      stringValue(source.providerId, `${path}.providerId`),
      `${path}.providerId`
    ),
    environment: environment(source.environment, `${path}.environment`),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, `${path}.authorityDigest`),
      `${path}.authorityDigest`
    ),
    releaseId,
    planId,
    planDigest,
    singleFlightKey,
    remoteOperationIds: Object.freeze(
      sortedUniqueStrings(
        exactArray(source.remoteOperationIds, `${path}.remoteOperationIds`).map((entry, index) =>
          releaseIdentifier(
            stringValue(entry, `${path}.remoteOperationIds[${index}]`),
            `${path}.remoteOperationIds[${index}]`
          )
        ),
        `${path}.remoteOperationIds`
      )
    ),
    phase: parsedPhase,
    outcome: parsedOutcome,
    durationMs,
    stableErrorCode,
    evidenceDigest,
    traceId: nullableIdentifier(source.traceId, `${path}.traceId`),
    previousEventDigest: nullableDigest(source.previousEventDigest, `${path}.previousEventDigest`)
  })
}

export function parseBackendOperationalEvent(
  value: unknown,
  path = '$.event'
): BackendOperationalEventV1 {
  return parseEventFields(exactRecord(value, path, EVENT_KEYS), path)
}

export function canonicalBackendOperationalEventBytes(value: unknown): Uint8Array {
  return canonicalManifestBytes(parseBackendOperationalEvent(value))
}

export async function digestBackendOperationalEvent(value: unknown): Promise<string> {
  return digestCanonicalManifest(parseBackendOperationalEvent(value))
}

function failure(
  index: number,
  code: BackendOperationalEventChainErrorCode,
  message: string
): BackendOperationalEventChainFailure {
  return Object.freeze({ ok: false, index, code, message })
}

function sameDomain(left: BackendOperationalEventV1, right: BackendOperationalEventV1): boolean {
  return (
    left.providerId === right.providerId &&
    left.environment === right.environment &&
    left.authorityDigest === right.authorityDigest
  )
}

function sameAttemptBinding(
  left: BackendOperationalEventV1,
  right: BackendOperationalEventV1
): boolean {
  return (
    left.operationId === right.operationId &&
    left.phase === right.phase &&
    left.releaseId === right.releaseId &&
    left.planId === right.planId &&
    left.planDigest === right.planDigest &&
    left.singleFlightKey === right.singleFlightKey &&
    left.traceId === right.traceId &&
    left.remoteOperationIds.every((remoteId) => right.remoteOperationIds.includes(remoteId))
  )
}

function acceptAttemptEvent(
  event: BackendOperationalEventV1,
  index: number,
  attempts: Map<string, AttemptState>,
  openSingleFlights: Map<string, string>
): BackendOperationalEventChainFailure | null {
  const priorAttempt = attempts.get(event.attemptId)
  if (!priorAttempt) {
    if (event.outcome !== 'started') {
      return failure(
        index,
        'operational-event-attempt-transition-invalid',
        'An attempt must begin with started'
      )
    }
    if (event.singleFlightKey) {
      const activeAttemptId = openSingleFlights.get(event.singleFlightKey)
      if (activeAttemptId && activeAttemptId !== event.attemptId) {
        return failure(
          index,
          'operational-event-single-flight-conflict',
          'A single-flight release scope already has an open attempt'
        )
      }
      openSingleFlights.set(event.singleFlightKey, event.attemptId)
    }
    attempts.set(event.attemptId, { first: event, terminal: false })
    return null
  }
  if (priorAttempt.terminal || event.outcome === 'started') {
    return failure(
      index,
      'operational-event-attempt-transition-invalid',
      'An attempt permits one started event followed by one terminal event'
    )
  }
  if (!sameAttemptBinding(priorAttempt.first, event)) {
    return failure(
      index,
      'operational-event-attempt-binding-mismatch',
      'Attempt phase, trace, release, plan, single-flight, or remote binding changed'
    )
  }
  priorAttempt.terminal = true
  if (priorAttempt.first.singleFlightKey) {
    openSingleFlights.delete(priorAttempt.first.singleFlightKey)
  }
  return null
}

function parsedPriorHead(value: string | null | undefined): string | null {
  if (value === undefined) throw new TypeError('Prior segment head or explicit null is required')
  return value === null ? null : releaseDigest(value, '$.priorSegmentHeadDigest')
}

/** Inspect internal segment consistency. This does not authenticate either head. */
export async function inspectBackendOperationalEventChain(
  value: unknown,
  priorSegmentHeadDigest: string | null | undefined
): Promise<BackendOperationalEventChainInspection> {
  let entries: unknown[]
  let priorHead: string | null
  try {
    entries = exactArray(value, '$.events', BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS)
    priorHead = parsedPriorHead(priorSegmentHeadDigest)
  } catch (cause) {
    return failure(
      0,
      'operational-event-invalid',
      cause instanceof Error ? cause.message : 'Operational event segment is invalid.'
    )
  }
  const parsedEvents: BackendOperationalEventV1[] = []
  for (const [index, entry] of entries.entries()) {
    try {
      parsedEvents.push(parseBackendOperationalEvent(entry, `$.events[${index}]`))
    } catch (cause) {
      return failure(
        index,
        'operational-event-invalid',
        cause instanceof Error ? cause.message : 'Operational event is invalid.'
      )
    }
  }
  const events: BackendOperationalEventV1[] = []
  const eventIds = new Set<string>()
  const attempts = new Map<string, AttemptState>()
  const openSingleFlights = new Map<string, string>()
  let computedHeadDigest = priorHead
  let previousOccurredAt: string | null = null
  let domain: BackendOperationalEventV1 | undefined
  for (const [index, event] of parsedEvents.entries()) {
    if (eventIds.has(event.eventId)) {
      return failure(
        index,
        'operational-event-id-duplicate',
        'Event ID duplicates an earlier event'
      )
    }
    if (event.previousEventDigest !== computedHeadDigest) {
      return failure(index, 'operational-event-chain-broken', 'Previous digest does not match')
    }
    if (domain && !sameDomain(domain, event)) {
      return failure(
        index,
        'operational-event-domain-mismatch',
        'Provider authority domain changed'
      )
    }
    if (previousOccurredAt && compareReleaseTimestamps(event.occurredAt, previousOccurredAt) < 0) {
      return failure(index, 'operational-event-order-invalid', 'Timestamp precedes prior event')
    }
    const attemptFailure = acceptAttemptEvent(event, index, attempts, openSingleFlights)
    if (attemptFailure) return attemptFailure
    domain ??= event
    eventIds.add(event.eventId)
    events.push(event)
    previousOccurredAt = event.occurredAt
    computedHeadDigest = await digestCanonicalManifest(event)
  }
  const openAttemptIds = [...attempts]
    .filter(([, state]) => !state.terminal)
    .map(([attemptId]) => attemptId)
    .sort()
  return Object.freeze({
    ok: true,
    events: Object.freeze(events),
    priorSegmentHeadDigest: priorHead,
    computedHeadDigest,
    openAttemptIds: Object.freeze(openAttemptIds)
  })
}

function parseTrustedAnchor(value: unknown): BackendOperationalEventTrustedAnchorV1 {
  const source = exactRecord(value, '$.trustedAnchor', ANCHOR_KEYS)
  if (source.format !== BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT) {
    throw new TypeError('$.trustedAnchor.format is not supported')
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_VERSION) {
    throw new TypeError('$.trustedAnchor.version is not supported')
  }
  const priorSegmentOpenAttemptIds = sortedUniqueStrings(
    exactArray(source.priorSegmentOpenAttemptIds, '$.trustedAnchor.priorSegmentOpenAttemptIds').map(
      (entry, index) =>
        releaseIdentifier(
          stringValue(entry, `$.trustedAnchor.priorSegmentOpenAttemptIds[${index}]`),
          `$.trustedAnchor.priorSegmentOpenAttemptIds[${index}]`
        )
    ),
    '$.trustedAnchor.priorSegmentOpenAttemptIds'
  )
  const priorSegmentHeadDigest = nullableDigest(
    source.priorSegmentHeadDigest,
    '$.trustedAnchor.priorSegmentHeadDigest'
  )
  const priorSegmentLastOccurredAt = nullableTimestamp(
    source.priorSegmentLastOccurredAt,
    '$.trustedAnchor.priorSegmentLastOccurredAt'
  )
  if ((priorSegmentHeadDigest === null) !== (priorSegmentLastOccurredAt === null)) {
    throw new TypeError(
      '$.trustedAnchor prior segment head and last occurred time must be present together'
    )
  }
  const evaluatedAt = releaseTimestamp(
    stringValue(source.evaluatedAt, '$.trustedAnchor.evaluatedAt'),
    '$.trustedAnchor.evaluatedAt'
  )
  if (
    priorSegmentLastOccurredAt &&
    compareReleaseTimestamps(priorSegmentLastOccurredAt, evaluatedAt) > 0
  ) {
    throw new TypeError('$.trustedAnchor prior segment time cannot exceed evaluatedAt')
  }
  return Object.freeze({
    format: BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_VERSION,
    providerId: releaseIdentifier(
      stringValue(source.providerId, '$.trustedAnchor.providerId'),
      '$.trustedAnchor.providerId'
    ),
    environment: environment(source.environment, '$.trustedAnchor.environment'),
    authorityDigest: releaseDigest(
      stringValue(source.authorityDigest, '$.trustedAnchor.authorityDigest'),
      '$.trustedAnchor.authorityDigest'
    ),
    priorSegmentHeadDigest,
    priorSegmentLastOccurredAt,
    priorSegmentOpenAttemptIds: Object.freeze(priorSegmentOpenAttemptIds),
    trustedHeadDigest: nullableDigest(
      source.trustedHeadDigest,
      '$.trustedAnchor.trustedHeadDigest'
    ),
    evaluatedAt
  })
}

async function verifyBackendOperationalEventChainWithAnchor(
  value: unknown,
  anchor: BackendOperationalEventTrustedAnchorV1
): Promise<BackendOperationalEventChainVerification> {
  if (anchor.priorSegmentOpenAttemptIds.length > 0) {
    return failure(
      0,
      'operational-event-segment-boundary-open',
      'Cannot rotate an operational segment while prior attempts are open'
    )
  }
  const inspected = await inspectBackendOperationalEventChain(value, anchor.priorSegmentHeadDigest)
  if (!inspected.ok) return inspected
  const firstEvent = inspected.events.at(0)
  if (
    firstEvent &&
    anchor.priorSegmentLastOccurredAt &&
    compareReleaseTimestamps(firstEvent.occurredAt, anchor.priorSegmentLastOccurredAt) < 0
  ) {
    return failure(
      0,
      'operational-event-order-invalid',
      'Segment timestamp precedes the authenticated prior segment boundary'
    )
  }
  if (
    inspected.events.some(
      (event) => compareReleaseTimestamps(event.occurredAt, anchor.evaluatedAt) > 0
    )
  ) {
    return failure(
      Math.max(0, inspected.events.length - 1),
      'operational-event-clock-skew-invalid',
      'Segment contains an event after the Host evaluation time'
    )
  }
  if (
    inspected.events.some(
      (event) =>
        event.providerId !== anchor.providerId ||
        event.environment !== anchor.environment ||
        event.authorityDigest !== anchor.authorityDigest
    )
  ) {
    return failure(0, 'operational-event-domain-mismatch', 'Segment violates trusted domain')
  }
  if (inspected.computedHeadDigest !== anchor.trustedHeadDigest) {
    return failure(
      Math.max(0, inspected.events.length - 1),
      'operational-event-head-mismatch',
      'Segment does not match the trusted operational head'
    )
  }
  return inspected
}

/** Verify a segment against mandatory Host-authenticated boundary anchors. */
export async function verifyBackendOperationalEventChain(
  value: unknown,
  trustedAnchor: BackendOperationalEventTrustedAnchorV1 | undefined
): Promise<BackendOperationalEventChainVerification> {
  if (trustedAnchor === undefined) {
    return failure(
      0,
      'operational-event-trusted-anchor-required',
      'A Host-trusted segment anchor is required'
    )
  }
  let anchor: BackendOperationalEventTrustedAnchorV1
  try {
    anchor = parseTrustedAnchor(trustedAnchor)
  } catch (cause) {
    return failure(
      0,
      'operational-event-invalid',
      cause instanceof Error ? cause.message : 'Trusted segment anchor is invalid.'
    )
  }
  return verifyBackendOperationalEventChainWithAnchor(value, anchor)
}

function parseAppendAuthority(value: unknown): BackendOperationalEventAppendAuthorityV1 {
  const source = exactRecord(value, '$.appendAuthority', APPEND_AUTHORITY_KEYS)
  if (source.format !== BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT) {
    throw new TypeError('$.appendAuthority.format is not supported')
  }
  if (source.version !== BACKEND_OPERATIONAL_EVENT_VERSION) {
    throw new TypeError('$.appendAuthority.version is not supported')
  }
  const parsedPhase = phase(source.phase, '$.appendAuthority.phase')
  const parsedOutcome = outcome(source.outcome, '$.appendAuthority.outcome')
  const releaseId = nullableIdentifier(source.releaseId, '$.appendAuthority.releaseId')
  const planId = nullableIdentifier(source.planId, '$.appendAuthority.planId')
  const planDigest = nullableDigest(source.planDigest, '$.appendAuthority.planDigest')
  const singleFlightKey = nullableSingleFlightKey(
    source.singleFlightKey,
    '$.appendAuthority.singleFlightKey'
  )
  const durationMs = nonNegativeDuration(source.durationMs, '$.appendAuthority.durationMs')
  const stableErrorCode = nullableIdentifier(
    source.stableErrorCode,
    '$.appendAuthority.stableErrorCode'
  )
  return Object.freeze({
    format: BACKEND_OPERATIONAL_APPEND_AUTHORITY_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_VERSION,
    eventId: releaseIdentifier(
      stringValue(source.eventId, '$.appendAuthority.eventId'),
      '$.appendAuthority.eventId'
    ),
    operationId: releaseIdentifier(
      stringValue(source.operationId, '$.appendAuthority.operationId'),
      '$.appendAuthority.operationId'
    ),
    attemptId: releaseIdentifier(
      stringValue(source.attemptId, '$.appendAuthority.attemptId'),
      '$.appendAuthority.attemptId'
    ),
    observedAt: releaseTimestamp(
      stringValue(source.observedAt, '$.appendAuthority.observedAt'),
      '$.appendAuthority.observedAt'
    ),
    phase: parsedPhase,
    outcome: parsedOutcome,
    releaseId,
    planId,
    planDigest,
    singleFlightKey,
    remoteOperationIds: Object.freeze(
      sortedUniqueStrings(
        exactArray(source.remoteOperationIds, '$.appendAuthority.remoteOperationIds').map(
          (entry, index) =>
            releaseIdentifier(
              stringValue(entry, `$.appendAuthority.remoteOperationIds[${index}]`),
              `$.appendAuthority.remoteOperationIds[${index}]`
            )
        ),
        '$.appendAuthority.remoteOperationIds'
      )
    ),
    durationMs,
    stableErrorCode,
    evidenceDigest: nullableDigest(source.evidenceDigest, '$.appendAuthority.evidenceDigest'),
    traceId: nullableIdentifier(source.traceId, '$.appendAuthority.traceId')
  })
}

/**
 * Seal one event only after authenticating the segment CAS head and a Host-owned
 * append scope. Persistence must atomically compare the same trusted head.
 */
export async function appendBackendOperationalEvent(
  historySegment: unknown,
  trustedAnchor: BackendOperationalEventTrustedAnchorV1 | undefined,
  appendAuthority: unknown
): Promise<
  Readonly<{
    event: BackendOperationalEventV1
    previousHeadDigest: string | null
    eventDigest: string
  }>
> {
  if (trustedAnchor === undefined) {
    throw new TypeError('Cannot append without a Host-trusted segment anchor')
  }
  const anchor = parseTrustedAnchor(trustedAnchor)
  const authority = parseAppendAuthority(appendAuthority)
  if (anchor.priorSegmentOpenAttemptIds.length > 0) {
    throw new TypeError(
      'Cannot append to an operational segment with operational-event-segment-boundary-open'
    )
  }
  if (compareReleaseTimestamps(authority.observedAt, anchor.evaluatedAt) > 0) {
    throw new TypeError('Cannot append an event after the Host evaluation time')
  }
  if (
    anchor.priorSegmentLastOccurredAt &&
    compareReleaseTimestamps(authority.observedAt, anchor.priorSegmentLastOccurredAt) < 0
  ) {
    throw new TypeError('Cannot append an event before the prior segment boundary')
  }
  const verified = await verifyBackendOperationalEventChainWithAnchor(historySegment, anchor)
  if (!verified.ok) {
    throw new TypeError(`Cannot append to unauthenticated operational segment: ${verified.code}`)
  }
  const event = parseBackendOperationalEvent({
    format: BACKEND_OPERATIONAL_EVENT_FORMAT,
    version: BACKEND_OPERATIONAL_EVENT_VERSION,
    eventId: authority.eventId,
    operationId: authority.operationId,
    attemptId: authority.attemptId,
    occurredAt: authority.observedAt,
    providerId: anchor.providerId,
    environment: anchor.environment,
    authorityDigest: anchor.authorityDigest,
    releaseId: authority.releaseId,
    planId: authority.planId,
    planDigest: authority.planDigest,
    singleFlightKey: authority.singleFlightKey,
    remoteOperationIds: authority.remoteOperationIds,
    phase: authority.phase,
    outcome: authority.outcome,
    durationMs: authority.durationMs,
    stableErrorCode: authority.stableErrorCode,
    evidenceDigest: authority.evidenceDigest,
    traceId: authority.traceId,
    previousEventDigest: verified.computedHeadDigest
  })
  const appended = await inspectBackendOperationalEventChain(
    [...verified.events, event],
    verified.priorSegmentHeadDigest
  )
  if (!appended.ok) throw new TypeError(`Cannot append invalid event: ${appended.code}`)
  const eventDigest = appended.computedHeadDigest
  if (!eventDigest) throw new TypeError('Appended operational event digest is unavailable')
  return Object.freeze({
    event,
    previousHeadDigest: verified.computedHeadDigest,
    eventDigest
  })
}
