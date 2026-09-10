/* eslint-disable max-lines -- strict parsing, lifecycle transitions, and CAS binding form one fail-closed contract */
import { canonicalManifestBytes, digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  exactArray,
  exactRecord,
  nullableDigest,
  releaseDigest,
  releaseIdentifier,
  stringValue
} from '../release/validation'

export const BACKEND_AUTOMATION_IDEMPOTENCY_VERSION = 1 as const
export const BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT =
  'openpencil.backend-automation-idempotency-record' as const
export const BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT =
  'openpencil.backend-automation-idempotency-cas-proposal' as const
export const BACKEND_AUTOMATION_IDEMPOTENCY_CANONICAL_ENCODING =
  'openpencil.canonical-manifest-json-utf8.v1' as const
export const BACKEND_AUTOMATION_IDEMPOTENCY_MAX_ATTEMPTS = 20
export const BACKEND_AUTOMATION_IDEMPOTENCY_MAX_CAUSATION_HOP = 16
export const BACKEND_AUTOMATION_IDEMPOTENCY_MAX_RETENTION_HOURS = 2_160
export const BACKEND_AUTOMATION_IDEMPOTENCY_MAX_REVISION = 1_024
export const BACKEND_AUTOMATION_IDEMPOTENCY_MAX_CANONICAL_BYTES = 16_384
/** The persistence CAS namespace is exactly this tuple; eventId must not create a second row. */
export const BACKEND_AUTOMATION_IDEMPOTENCY_CAS_KEY_FIELDS = Object.freeze([
  'automationId',
  'idempotencyKeyDigest'
] as const)

export const BACKEND_AUTOMATION_IDEMPOTENCY_STATES = Object.freeze([
  'reserved',
  'dispatch-started',
  'outcome-unknown',
  'succeeded',
  'known-not-dispatched'
] as const)

export type BackendAutomationIdempotencyState =
  (typeof BACKEND_AUTOMATION_IDEMPOTENCY_STATES)[number]

/**
 * One immutable revision in a provider-neutral idempotency ledger.
 *
 * Evidence fields are digests only. This contract does not authenticate the evidence, reserve an
 * attempt, persist a row, authorize dispatch, or grant release authority. A trusted Host must do
 * those jobs and compare-and-swap the exact head and revision represented by the CAS proposal.
 */
export interface BackendAutomationIdempotencyRecordV1 {
  readonly format: typeof BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_IDEMPOTENCY_VERSION
  readonly automationId: string
  readonly eventId: string
  readonly operationId: string
  readonly idempotencyKeyDigest: string
  readonly causationId: string
  readonly causationHop: number
  readonly retentionHours: number
  readonly createdAt: string
  /** Earliest retention boundary, never authority to replay or discard an unresolved fence. */
  readonly expiresAt: string
  readonly recordedAt: string
  readonly revision: number
  readonly previousRecordDigest: string | null
  readonly attemptIds: readonly string[]
  readonly currentAttemptId: string
  readonly state: BackendAutomationIdempotencyState
  readonly completionEvidenceDigest: string | null
  readonly knownNotDispatchedEvidenceDigest: string | null
  readonly reconciliationEvidenceDigest: string | null
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
}

/**
 * A deterministic compare-and-swap proposal. It is not a database write or proof that the current
 * head came from trusted storage. Persistence must atomically compare both expected fields and
 * write the exact record whose canonical digest is nextRecordDigest. The database uniqueness/CAS
 * key is (automationId, idempotencyKeyDigest); eventId and operationId are immutable row bindings,
 * not namespaces that permit a second row for the same idempotency key.
 */
export interface BackendAutomationIdempotencyCASProposalV1 {
  readonly format: typeof BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT
  readonly version: typeof BACKEND_AUTOMATION_IDEMPOTENCY_VERSION
  readonly automationId: string
  readonly eventId: string
  readonly operationId: string
  readonly idempotencyKeyDigest: string
  readonly expectedRevision: number | null
  readonly expectedHeadDigest: string | null
  readonly nextRevision: number
  readonly nextRecordDigest: string
  readonly hostEvidenceAuthenticated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
}

export interface BackendAutomationIdempotencyCASCandidateV1 {
  readonly proposal: BackendAutomationIdempotencyCASProposalV1
  readonly record: BackendAutomationIdempotencyRecordV1
  readonly recordDigest: string
}

const RECORD_KEYS = Object.freeze([
  'format',
  'version',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'causationId',
  'causationHop',
  'retentionHours',
  'createdAt',
  'expiresAt',
  'recordedAt',
  'revision',
  'previousRecordDigest',
  'attemptIds',
  'currentAttemptId',
  'state',
  'completionEvidenceDigest',
  'knownNotDispatchedEvidenceDigest',
  'reconciliationEvidenceDigest',
  'hostEvidenceAuthenticated',
  'persistenceAuthorityGranted',
  'dispatchAuthorityGranted'
] as const)

const CAS_PROPOSAL_KEYS = Object.freeze([
  'format',
  'version',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'expectedRevision',
  'expectedHeadDigest',
  'nextRevision',
  'nextRecordDigest',
  'hostEvidenceAuthenticated',
  'persistenceAuthorityGranted',
  'dispatchAuthorityGranted'
] as const)

const STATES = new Set<string>(BACKEND_AUTOMATION_IDEMPOTENCY_STATES)
const CANONICAL_MILLISECOND_TIMESTAMP =
  /^(?!0000-)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u

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

function identifier(value: unknown, path: string): string {
  return releaseIdentifier(stringValue(value, path), path)
}

function digest(value: unknown, path: string): string {
  return releaseDigest(stringValue(value, path), path)
}

function timestamp(value: unknown, path: string): string {
  const parsed = stringValue(value, path, 24)
  if (!CANONICAL_MILLISECOND_TIMESTAMP.test(parsed)) {
    throw new TypeError(`${path} must be a canonical UTC timestamp with milliseconds`)
  }
  const milliseconds = Date.parse(parsed)
  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`${path} must be a valid UTC timestamp`)
  }
  let roundTrip: string
  try {
    roundTrip = new Date(milliseconds).toISOString()
  } catch {
    throw new TypeError(`${path} must be a valid UTC timestamp`)
  }
  if (roundTrip !== parsed) throw new TypeError(`${path} must be a valid UTC timestamp`)
  return parsed
}

function state(value: unknown, path: string): BackendAutomationIdempotencyState {
  if (typeof value !== 'string' || !STATES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as BackendAutomationIdempotencyState
}

function attemptIds(value: unknown, path: string): readonly string[] {
  const entries = exactArray(value, path, BACKEND_AUTOMATION_IDEMPOTENCY_MAX_ATTEMPTS).map(
    (entry, index) => identifier(entry, `${path}[${index}]`)
  )
  if (entries.length === 0) throw new TypeError(`${path} must contain an attempt`)
  if (new Set(entries).size !== entries.length) {
    throw new TypeError(`${path} must contain unique attempt IDs`)
  }
  return Object.freeze(entries)
}

function assertCanonicalByteLimit(value: unknown, path: string): Uint8Array {
  const bytes = canonicalManifestBytes(value)
  if (bytes.byteLength > BACKEND_AUTOMATION_IDEMPOTENCY_MAX_CANONICAL_BYTES) {
    throw new TypeError(`${path} exceeds the canonical byte limit`)
  }
  return bytes
}

/**
 * Descriptor validation runs first so cloning cannot encounter an accessor. Native structured
 * clone then supplies the portable fail-closed check for otherwise transparent Proxy values,
 * which ECMAScript reflection alone cannot distinguish from their targets.
 */
function assertNoProxyValues(value: unknown, path: string): void {
  try {
    structuredClone(value)
  } catch {
    throw new TypeError(`${path} must contain cloneable plain data without Proxy values`)
  }
}

function assertExpiry(createdAt: string, expiresAt: string, retentionHours: number): void {
  const expectedMilliseconds = Date.parse(createdAt) + retentionHours * 60 * 60 * 1_000
  if (!Number.isFinite(expectedMilliseconds)) {
    throw new TypeError('$.expiresAt exceeds the supported timestamp range')
  }
  let expected: string
  try {
    expected = new Date(expectedMilliseconds).toISOString()
  } catch {
    throw new TypeError('$.expiresAt exceeds the supported timestamp range')
  }
  if (expiresAt !== expected) {
    throw new TypeError('$.expiresAt must equal $.createdAt plus $.retentionHours')
  }
}

function assertEvidenceShape(record: BackendAutomationIdempotencyRecordV1): void {
  const completion = record.completionEvidenceDigest
  const knownNotDispatched = record.knownNotDispatchedEvidenceDigest
  const reconciliation = record.reconciliationEvidenceDigest
  if (record.state === 'reserved' || record.state === 'dispatch-started') {
    if (completion !== null || knownNotDispatched !== null || reconciliation !== null) {
      throw new TypeError(`$.state ${record.state} cannot carry settlement evidence`)
    }
    return
  }
  if (record.state === 'outcome-unknown') {
    if (completion !== null || knownNotDispatched !== null || reconciliation !== null) {
      throw new TypeError('$.state outcome-unknown must remain fenced without settlement evidence')
    }
    return
  }
  if (record.state === 'succeeded') {
    if (completion === null || knownNotDispatched !== null) {
      throw new TypeError('$.state succeeded requires only completion evidence')
    }
    return
  }
  if (completion !== null || knownNotDispatched === null) {
    throw new TypeError('$.state known-not-dispatched requires only non-dispatch evidence')
  }
}

function parseRecord(value: unknown): BackendAutomationIdempotencyRecordV1 {
  const source = exactRecord(value, '$', RECORD_KEYS)
  if (source.format !== BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_IDEMPOTENCY_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const parsedAttempts = attemptIds(source.attemptIds, '$.attemptIds')
  const currentAttemptId = identifier(source.currentAttemptId, '$.currentAttemptId')
  if (parsedAttempts.at(-1) !== currentAttemptId) {
    throw new TypeError('$.currentAttemptId must equal the final cumulative attempt ID')
  }
  const revision = integer(
    source.revision,
    '$.revision',
    0,
    BACKEND_AUTOMATION_IDEMPOTENCY_MAX_REVISION
  )
  const previousRecordDigest = nullableDigest(source.previousRecordDigest, '$.previousRecordDigest')
  if ((revision === 0) !== (previousRecordDigest === null)) {
    throw new TypeError('$.revision and $.previousRecordDigest do not form a valid chain position')
  }
  if (parsedAttempts.length > revision + 1) {
    throw new TypeError('$.attemptIds cannot grow faster than ledger revisions')
  }
  const retentionHours = integer(
    source.retentionHours,
    '$.retentionHours',
    1,
    BACKEND_AUTOMATION_IDEMPOTENCY_MAX_RETENTION_HOURS
  )
  const createdAt = timestamp(source.createdAt, '$.createdAt')
  const expiresAt = timestamp(source.expiresAt, '$.expiresAt')
  const recordedAt = timestamp(source.recordedAt, '$.recordedAt')
  assertExpiry(createdAt, expiresAt, retentionHours)
  if (Date.parse(recordedAt) < Date.parse(createdAt)) {
    throw new TypeError('$.recordedAt cannot precede $.createdAt')
  }
  if (revision === 0 && recordedAt !== createdAt) {
    throw new TypeError('The initial revision must be recorded at creation time')
  }
  const parsed: BackendAutomationIdempotencyRecordV1 = Object.freeze({
    format: BACKEND_AUTOMATION_IDEMPOTENCY_RECORD_FORMAT,
    version: BACKEND_AUTOMATION_IDEMPOTENCY_VERSION,
    automationId: identifier(source.automationId, '$.automationId'),
    eventId: identifier(source.eventId, '$.eventId'),
    operationId: identifier(source.operationId, '$.operationId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    causationId: identifier(source.causationId, '$.causationId'),
    causationHop: integer(
      source.causationHop,
      '$.causationHop',
      0,
      BACKEND_AUTOMATION_IDEMPOTENCY_MAX_CAUSATION_HOP
    ),
    retentionHours,
    createdAt,
    expiresAt,
    recordedAt,
    revision,
    previousRecordDigest,
    attemptIds: parsedAttempts,
    currentAttemptId,
    state: state(source.state, '$.state'),
    completionEvidenceDigest: nullableDigest(
      source.completionEvidenceDigest,
      '$.completionEvidenceDigest'
    ),
    knownNotDispatchedEvidenceDigest: nullableDigest(
      source.knownNotDispatchedEvidenceDigest,
      '$.knownNotDispatchedEvidenceDigest'
    ),
    reconciliationEvidenceDigest: nullableDigest(
      source.reconciliationEvidenceDigest,
      '$.reconciliationEvidenceDigest'
    ),
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
    )
  })
  assertEvidenceShape(parsed)
  assertNoProxyValues(value, '$')
  assertCanonicalByteLimit(parsed, '$')
  return parsed
}

export function parseBackendAutomationIdempotencyRecord(
  value: unknown
): BackendAutomationIdempotencyRecordV1 {
  try {
    return parseRecord(value)
  } catch {
    throw new TypeError('Backend Automation idempotency record is invalid.')
  }
}

export function canonicalBackendAutomationIdempotencyRecordBytes(value: unknown): Uint8Array {
  try {
    return assertCanonicalByteLimit(parseRecord(value), '$')
  } catch {
    throw new TypeError('Backend Automation idempotency record is invalid.')
  }
}

export async function digestBackendAutomationIdempotencyRecord(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(parseRecord(value))
  } catch {
    throw new TypeError('Backend Automation idempotency record is invalid.')
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function assertStableBinding(
  previous: BackendAutomationIdempotencyRecordV1,
  next: BackendAutomationIdempotencyRecordV1
): void {
  const stableKeys = [
    'automationId',
    'eventId',
    'operationId',
    'idempotencyKeyDigest',
    'causationId',
    'causationHop',
    'retentionHours',
    'createdAt',
    'expiresAt'
  ] as const
  if (stableKeys.some((key) => previous[key] !== next[key])) {
    throw new TypeError('Automation idempotency identity, causation, or retention binding changed')
  }
}

function assertSameAttempt(
  previous: BackendAutomationIdempotencyRecordV1,
  next: BackendAutomationIdempotencyRecordV1
): void {
  if (
    !sameStrings(previous.attemptIds, next.attemptIds) ||
    previous.currentAttemptId !== next.currentAttemptId
  ) {
    throw new TypeError('The current attempt binding changed before it became retry eligible')
  }
}

function assertNewAttempt(
  previous: BackendAutomationIdempotencyRecordV1,
  next: BackendAutomationIdempotencyRecordV1
): void {
  if (
    next.attemptIds.length !== previous.attemptIds.length + 1 ||
    !previous.attemptIds.every((entry, index) => next.attemptIds[index] === entry) ||
    previous.attemptIds.includes(next.currentAttemptId)
  ) {
    throw new TypeError('A retry must append exactly one fresh attempt ID')
  }
  if (Date.parse(next.recordedAt) >= Date.parse(next.expiresAt)) {
    throw new TypeError('A new attempt cannot be reserved at or after idempotency expiry')
  }
}

function assertTransitionEvidence(
  previous: BackendAutomationIdempotencyRecordV1,
  next: BackendAutomationIdempotencyRecordV1
): void {
  const reconciledFromDispatchBoundary =
    previous.state === 'dispatch-started' || previous.state === 'outcome-unknown'
  if (
    (next.state === 'succeeded' || next.state === 'known-not-dispatched') &&
    reconciledFromDispatchBoundary &&
    previous.state === 'outcome-unknown' &&
    next.reconciliationEvidenceDigest === null
  ) {
    throw new TypeError('An outcome-unknown fence requires reconciliation evidence')
  }
  if (
    next.state === 'known-not-dispatched' &&
    previous.state === 'dispatch-started' &&
    next.reconciliationEvidenceDigest === null
  ) {
    throw new TypeError('A post-dispatch non-dispatch result requires reconciliation evidence')
  }
  if (
    next.reconciliationEvidenceDigest !== null &&
    previous.state !== 'dispatch-started' &&
    previous.state !== 'outcome-unknown'
  ) {
    throw new TypeError('Reconciliation evidence is not valid before the dispatch boundary')
  }
  if (
    next.state === 'succeeded' &&
    previous.state === 'dispatch-started' &&
    next.reconciliationEvidenceDigest !== null
  ) {
    throw new TypeError('Direct dispatch success must not claim reconciliation evidence')
  }
}

function assertStateTransition(
  previous: BackendAutomationIdempotencyRecordV1,
  next: BackendAutomationIdempotencyRecordV1
): void {
  if (previous.state === 'succeeded') {
    throw new TypeError('A successful idempotency record is immutable')
  }
  if (previous.state === 'reserved') {
    if (next.state !== 'dispatch-started' && next.state !== 'known-not-dispatched') {
      throw new TypeError('A reservation may only start dispatch or record known non-dispatch')
    }
    assertSameAttempt(previous, next)
  } else if (previous.state === 'dispatch-started') {
    if (
      next.state !== 'outcome-unknown' &&
      next.state !== 'succeeded' &&
      next.state !== 'known-not-dispatched'
    ) {
      throw new TypeError('A dispatched attempt must settle or remain outcome-unknown')
    }
    assertSameAttempt(previous, next)
  } else if (previous.state === 'outcome-unknown') {
    if (next.state !== 'succeeded' && next.state !== 'known-not-dispatched') {
      throw new TypeError('An outcome-unknown attempt remains fenced until reconciliation')
    }
    assertSameAttempt(previous, next)
  } else {
    if (next.state !== 'reserved') {
      throw new TypeError('Known non-dispatch may only reserve a new attempt')
    }
    assertNewAttempt(previous, next)
  }
  assertTransitionEvidence(previous, next)
}

async function assertRecordTransition(
  previous: BackendAutomationIdempotencyRecordV1 | null,
  next: BackendAutomationIdempotencyRecordV1
): Promise<string | null> {
  if (previous === null) {
    if (
      next.revision !== 0 ||
      next.previousRecordDigest !== null ||
      next.state !== 'reserved' ||
      next.attemptIds.length !== 1
    ) {
      throw new TypeError('An idempotency ledger must begin with one revision-zero reservation')
    }
    return null
  }
  const previousDigest = await digestBackendAutomationIdempotencyRecord(previous)
  assertStableBinding(previous, next)
  if (previous.revision >= BACKEND_AUTOMATION_IDEMPOTENCY_MAX_REVISION) {
    throw new TypeError('Automation idempotency ledger revision limit is exhausted')
  }
  if (next.revision !== previous.revision + 1) {
    throw new TypeError('Automation idempotency revision must advance exactly once')
  }
  if (next.previousRecordDigest !== previousDigest) {
    throw new TypeError('Automation idempotency previous record digest does not match')
  }
  if (Date.parse(next.recordedAt) < Date.parse(previous.recordedAt)) {
    throw new TypeError('Automation idempotency record time cannot move backwards')
  }
  assertStateTransition(previous, next)
  return previousDigest
}

function parseCASProposal(value: unknown): BackendAutomationIdempotencyCASProposalV1 {
  const source = exactRecord(value, '$', CAS_PROPOSAL_KEYS)
  if (source.format !== BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT) {
    throw new TypeError('$.format is not supported')
  }
  if (source.version !== BACKEND_AUTOMATION_IDEMPOTENCY_VERSION) {
    throw new TypeError('$.version is not supported')
  }
  const expectedRevision = nullableInteger(
    source.expectedRevision,
    '$.expectedRevision',
    0,
    BACKEND_AUTOMATION_IDEMPOTENCY_MAX_REVISION
  )
  const expectedHeadDigest = nullableDigest(source.expectedHeadDigest, '$.expectedHeadDigest')
  if ((expectedRevision === null) !== (expectedHeadDigest === null)) {
    throw new TypeError('Expected CAS revision and head digest must be present together')
  }
  const nextRevision = integer(
    source.nextRevision,
    '$.nextRevision',
    0,
    BACKEND_AUTOMATION_IDEMPOTENCY_MAX_REVISION
  )
  if (nextRevision !== (expectedRevision === null ? 0 : expectedRevision + 1)) {
    throw new TypeError('CAS proposal revision does not advance the expected revision exactly')
  }
  const parsed = Object.freeze({
    format: BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT,
    version: BACKEND_AUTOMATION_IDEMPOTENCY_VERSION,
    automationId: identifier(source.automationId, '$.automationId'),
    eventId: identifier(source.eventId, '$.eventId'),
    operationId: identifier(source.operationId, '$.operationId'),
    idempotencyKeyDigest: digest(source.idempotencyKeyDigest, '$.idempotencyKeyDigest'),
    expectedRevision,
    expectedHeadDigest,
    nextRevision,
    nextRecordDigest: digest(source.nextRecordDigest, '$.nextRecordDigest'),
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
    )
  })
  assertNoProxyValues(value, '$')
  assertCanonicalByteLimit(parsed, '$')
  return parsed
}

export function parseBackendAutomationIdempotencyCASProposal(
  value: unknown
): BackendAutomationIdempotencyCASProposalV1 {
  try {
    return parseCASProposal(value)
  } catch {
    throw new TypeError('Backend Automation idempotency CAS proposal is invalid.')
  }
}

export function canonicalBackendAutomationIdempotencyCASProposalBytes(value: unknown): Uint8Array {
  try {
    return assertCanonicalByteLimit(parseCASProposal(value), '$')
  } catch {
    throw new TypeError('Backend Automation idempotency CAS proposal is invalid.')
  }
}

export async function digestBackendAutomationIdempotencyCASProposal(
  value: unknown
): Promise<string> {
  try {
    return await digestCanonicalManifest(parseCASProposal(value))
  } catch {
    throw new TypeError('Backend Automation idempotency CAS proposal is invalid.')
  }
}

function assertProposalIdentity(
  proposal: BackendAutomationIdempotencyCASProposalV1,
  record: BackendAutomationIdempotencyRecordV1
): void {
  if (
    proposal.automationId !== record.automationId ||
    proposal.eventId !== record.eventId ||
    proposal.operationId !== record.operationId ||
    proposal.idempotencyKeyDigest !== record.idempotencyKeyDigest
  ) {
    throw new TypeError('CAS proposal identity does not match the proposed record')
  }
}

/**
 * Verify deterministic transition and digest consistency only. This does not authenticate current,
 * authenticate evidence, reserve identifiers, or execute the database compare-and-swap.
 */
export async function verifyBackendAutomationIdempotencyCASProposal(
  value: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationIdempotencyCASCandidateV1> {
  try {
    return await verifyCASProposal(value, currentValue, nextValue)
  } catch {
    throw new TypeError('Backend Automation idempotency CAS transition is invalid.')
  }
}

async function verifyCASProposal(
  value: unknown,
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationIdempotencyCASCandidateV1> {
  const proposal = parseCASProposal(value)
  const current = currentValue === null ? null : parseRecord(currentValue)
  const next = parseRecord(nextValue)
  const expectedHeadDigest = await assertRecordTransition(current, next)
  const expectedRevision = current?.revision ?? null
  const recordDigest = await digestBackendAutomationIdempotencyRecord(next)
  assertProposalIdentity(proposal, next)
  if (
    proposal.expectedRevision !== expectedRevision ||
    proposal.expectedHeadDigest !== expectedHeadDigest ||
    proposal.nextRevision !== next.revision ||
    proposal.nextRecordDigest !== recordDigest
  ) {
    throw new TypeError('CAS proposal does not bind the exact current head and next record')
  }
  return Object.freeze({ proposal, record: next, recordDigest })
}

/**
 * Create an unprivileged deterministic CAS candidate. A trusted persistence adapter must still read
 * an authenticated head, reserve IDs globally, and atomically compare and write the proposal.
 */
export async function createBackendAutomationIdempotencyCASProposal(
  currentValue: unknown,
  nextValue: unknown
): Promise<BackendAutomationIdempotencyCASCandidateV1> {
  try {
    const current = currentValue === null ? null : parseRecord(currentValue)
    const next = parseRecord(nextValue)
    const expectedHeadDigest = await assertRecordTransition(current, next)
    const recordDigest = await digestCanonicalManifest(next)
    const proposal: BackendAutomationIdempotencyCASProposalV1 = Object.freeze({
      format: BACKEND_AUTOMATION_IDEMPOTENCY_CAS_PROPOSAL_FORMAT,
      version: BACKEND_AUTOMATION_IDEMPOTENCY_VERSION,
      automationId: next.automationId,
      eventId: next.eventId,
      operationId: next.operationId,
      idempotencyKeyDigest: next.idempotencyKeyDigest,
      expectedRevision: current?.revision ?? null,
      expectedHeadDigest,
      nextRevision: next.revision,
      nextRecordDigest: recordDigest,
      hostEvidenceAuthenticated: false,
      persistenceAuthorityGranted: false,
      dispatchAuthorityGranted: false
    })
    return await verifyCASProposal(proposal, current, next)
  } catch {
    throw new TypeError('Backend Automation idempotency CAS transition is invalid.')
  }
}
