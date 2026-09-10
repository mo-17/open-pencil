/* oxlint-disable eslint(max-lines) -- Claim, settlement, evidence validation, and matching memory/IndexedDB implementations stay together for atomic-invariant auditing. */
import { containsBackendSecretLikeMaterial } from '@open-pencil/lowcode/backend'

import { APP_DATABASE_NAMES, openIdb, reqToPromise, txDone } from '@/app/storage/idb'

export const BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT =
  'openpencil.backend-release-dispatch-journal' as const
export const BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION = 2 as const
const BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION = 1 as const
/** Fixed recovery lease for a durable claim whose dispatch owner may still be running. */
export const BACKEND_RELEASE_DISPATCH_LEASE_MS = 5 * 60 * 1_000

const DATABASE_VERSION = 3
const STORE = 'dispatchClaims'
const EVIDENCE_STORE = 'dispatchEvidence'
const TOMBSTONE_STORE = 'dispatchTombstones'
const BACKEND_RELEASE_DISPATCH_TOMBSTONE_FORMAT =
  'openpencil.backend-release-dispatch-tombstone' as const
const BACKEND_RELEASE_DISPATCH_TOMBSTONE_VERSION = 1 as const
const MAX_ACTIVE_RECORDS = 256
const MAX_TOMBSTONES = 4_096
const MAX_STARTUP_RECORDS = MAX_ACTIVE_RECORDS + MAX_TOMBSTONES
const STRICT_TRANSACTION_OPTIONS: IDBTransactionOptions = { durability: 'strict' }
const MAX_KEY_LENGTH = 2_048
const MAX_ID_LENGTH = 256
const MAX_CODE_LENGTH = 256
const MAX_REMOTE_OPERATION_IDS = 256
const MAX_EVIDENCE_BYTES = 1024 * 1024
const MAX_EVIDENCE_DEPTH = 64
const MAX_EVIDENCE_NODES = 100_000
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const HOST_OPERATION_EVIDENCE_ID =
  /^(?:edge-(?:deploy|health)-[A-Za-z0-9_-]{32}|storage-(?:bucket|actors|probe)-[1-9][0-9]{0,5}-[A-Za-z0-9_-]{24})$/u
const trustedBackendHostReleaseDispatchJournals = new WeakSet<object>()
interface BackendReleaseJournalUnknownRecord {
  [key: string]: unknown
}

export type BackendHostReleaseDispatchOutcome = 'pending' | 'applied' | 'failed' | 'outcome-unknown'

interface BackendHostReleaseDispatchJournalRecordBase {
  readonly format: typeof BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT
  readonly singleFlightKey: string
  readonly releaseId: string
  readonly ownerId: string
  readonly planDigest: string
  readonly claimedAt: string
  readonly leaseExpiresAt: string
  readonly settledAt: string | null
  readonly outcome: BackendHostReleaseDispatchOutcome
  readonly code: string | null
  readonly remoteOperationIds: readonly string[]
}

export interface BackendHostReleaseDispatchJournalRecordV1 extends BackendHostReleaseDispatchJournalRecordBase {
  readonly version: typeof BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION
}

export interface BackendHostReleaseDispatchJournalRecordV2 extends BackendHostReleaseDispatchJournalRecordBase {
  readonly version: typeof BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION
  readonly dispatchScopeKey: string
}

export type BackendHostReleaseDispatchJournalRecord =
  | BackendHostReleaseDispatchJournalRecordV1
  | BackendHostReleaseDispatchJournalRecordV2

export type BackendHostReleaseDispatchClaimInput = Pick<
  BackendHostReleaseDispatchJournalRecordV2,
  | 'singleFlightKey'
  | 'dispatchScopeKey'
  | 'releaseId'
  | 'ownerId'
  | 'planDigest'
  | 'claimedAt'
  | 'leaseExpiresAt'
>

export interface BackendHostReleaseDispatchSettlementInput {
  readonly singleFlightKey: string
  readonly releaseId: string
  readonly planDigest: string
  readonly settledAt: string
  readonly outcome: Exclude<BackendHostReleaseDispatchOutcome, 'pending'>
  readonly code: string | null
  readonly remoteOperationIds: readonly string[]
}

export interface BackendHostReleaseDispatchClaimResult {
  readonly claimed: boolean
  readonly record: BackendHostReleaseDispatchJournalRecord
}

export const BACKEND_RELEASE_DISPATCH_EVIDENCE_FORMAT =
  'openpencil.backend-release-dispatch-evidence' as const
export const BACKEND_RELEASE_DISPATCH_EVIDENCE_VERSION = 1 as const

export interface BackendHostReleaseDispatchEvidenceRecord {
  readonly format: typeof BACKEND_RELEASE_DISPATCH_EVIDENCE_FORMAT
  readonly version: typeof BACKEND_RELEASE_DISPATCH_EVIDENCE_VERSION
  readonly singleFlightKey: string
  readonly dispatchScopeKey: string
  readonly releaseId: string
  readonly planDigest: string
  readonly phase: 'progress' | 'final'
  /** Strictly bounded, secret-scanned JSON owned by the release-specific Host adapter. */
  readonly payload: string
  readonly payloadDigest: string
  readonly recordedAt: string
}

export type BackendHostReleaseDispatchEvidenceInput = Omit<
  BackendHostReleaseDispatchEvidenceRecord,
  'format' | 'version'
>

interface BackendHostReleaseDispatchTombstoneV1 {
  readonly format: typeof BACKEND_RELEASE_DISPATCH_TOMBSTONE_FORMAT
  readonly version: typeof BACKEND_RELEASE_DISPATCH_TOMBSTONE_VERSION
  readonly singleFlightKey: string
  /** Complete secret-scanned terminal audit record; never a new dispatch authority. */
  readonly record: BackendHostReleaseDispatchJournalRecord
  readonly evidence: BackendHostReleaseDispatchEvidenceRecord | null
}

export interface BackendHostReleaseDispatchJournal {
  /** Atomically creates a one-way dispatch claim. Existing claims are never overwritten. */
  claim(input: BackendHostReleaseDispatchClaimInput): Promise<BackendHostReleaseDispatchClaimResult>
  /** Idempotently records the known post-dispatch result without deleting the claim. */
  settle(
    input: BackendHostReleaseDispatchSettlementInput
  ): Promise<BackendHostReleaseDispatchJournalRecord>
  read(singleFlightKey: string): Promise<BackendHostReleaseDispatchJournalRecord | null>
  listPending(): Promise<readonly BackendHostReleaseDispatchJournalRecord[]>
  listUnresolved(): Promise<readonly BackendHostReleaseDispatchJournalRecord[]>
  listUnresolvedForScope(
    dispatchScopeKey: string
  ): Promise<readonly BackendHostReleaseDispatchJournalRecord[]>
  /** Persist secret-free operation evidence bound atomically to an existing dispatch claim. */
  recordEvidence(
    input: BackendHostReleaseDispatchEvidenceInput
  ): Promise<BackendHostReleaseDispatchEvidenceRecord>
  readEvidence(singleFlightKey: string): Promise<BackendHostReleaseDispatchEvidenceRecord | null>
}

/**
 * Fault injection for the in-memory journal only. Hooks receive no journal data and their return
 * values are ignored; they may only delay or reject a read or settlement boundary.
 */
export interface MemoryBackendHostReleaseDispatchJournalOptions {
  readonly beforeRead?: () => void | Promise<void>
  readonly beforeSettle?: () => void | Promise<void>
  readonly afterSettle?: () => void | Promise<void>
}

export function trustedBackendHostReleaseDispatchJournal(
  value: unknown
): value is BackendHostReleaseDispatchJournal {
  return (
    value !== null &&
    typeof value === 'object' &&
    trustedBackendHostReleaseDispatchJournals.has(value)
  )
}

export class BackendHostReleaseJournalConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendHostReleaseJournalConflictError'
  }
}

export class BackendHostReleaseJournalCapacityError extends Error {
  constructor() {
    super('Backend Release journal capacity is exhausted and requires reviewed archival.')
    this.name = 'BackendHostReleaseJournalCapacityError'
  }
}

export class BackendHostReleaseUnresolvedScopeError extends Error {
  constructor() {
    super('An unresolved Backend Release already exists for this provider project authority.')
    this.name = 'BackendHostReleaseUnresolvedScopeError'
  }
}

function boundedText(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty bounded string.`)
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) {
      throw new TypeError(`${name} must not contain control characters.`)
    }
  }
  return value
}

function secretFreeBoundedText(value: unknown, name: string, maximum: number): string {
  const parsed = boundedText(value, name, maximum)
  if (containsBackendSecretLikeMaterial(parsed)) {
    throw new TypeError(`${name} must not contain secret-like material.`)
  }
  return parsed
}

function timestamp(value: unknown, name: string): string {
  const parsed = boundedText(value, name, 64)
  const milliseconds = Date.parse(parsed)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== parsed) {
    throw new TypeError(`${name} must be a canonical ISO timestamp.`)
  }
  return parsed
}

function remoteOperationIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_REMOTE_OPERATION_IDS) {
    throw new TypeError('Backend Release remote operation IDs are invalid.')
  }
  const normalized = value.map((entry, index) => {
    const operationId = boundedText(entry, `remoteOperationIds[${String(index)}]`, MAX_ID_LENGTH)
    if (
      !HOST_OPERATION_EVIDENCE_ID.test(operationId) &&
      containsBackendSecretLikeMaterial(operationId)
    ) {
      throw new TypeError('Backend Release remote operation IDs must be secret-free.')
    }
    return operationId
  })
  if (new Set(normalized).size !== normalized.length) {
    throw new TypeError('Backend Release remote operation IDs must be unique.')
  }
  return Object.freeze([...normalized])
}

function optionalCode(value: unknown): string | null {
  if (value === null) return null
  const code = boundedText(value, 'code', MAX_CODE_LENGTH)
  if (!CODE.test(code) || containsBackendSecretLikeMaterial(code)) {
    throw new TypeError('Backend Release journal code must be a secret-free identifier.')
  }
  return code
}

function evidencePayload(value: unknown): string {
  const payload = boundedText(value, 'payload', MAX_EVIDENCE_BYTES)
  if (new TextEncoder().encode(payload).byteLength > MAX_EVIDENCE_BYTES) {
    throw new TypeError('Backend Release evidence payload exceeds its byte limit.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(payload) as unknown
    if (!isUnknownRecord(parsed)) {
      throw new TypeError('Backend Release evidence payload must encode a JSON object.')
    }
  } catch (cause) {
    if (cause instanceof TypeError) throw cause
    throw new TypeError('Backend Release evidence payload must be valid JSON.')
  }
  // Reject duplicate keys and alternate encodings before applying the narrowly bounded Host
  // operation-ID exemption below. Every retained byte must correspond to the scanned JSON value;
  // scanning the whole JSON as one token would incorrectly reject legitimate opaque operation IDs.
  if (JSON.stringify(parsed) !== payload) {
    throw new TypeError('Backend Release evidence payload must use canonical JSON serialization.')
  }
  const remaining: Array<Readonly<{ value: unknown; depth: number }>> = [
    { value: parsed, depth: 0 }
  ]
  let visited = 0
  while (remaining.length > 0) {
    const current = remaining.pop()
    if (!current) break
    visited += 1
    if (visited > MAX_EVIDENCE_NODES || current.depth > MAX_EVIDENCE_DEPTH) {
      throw new TypeError('Backend Release evidence payload exceeds its structural limit.')
    }
    if (typeof current.value === 'string') {
      if (
        !HOST_OPERATION_EVIDENCE_ID.test(current.value) &&
        containsBackendSecretLikeMaterial(current.value)
      ) {
        throw new TypeError(
          'Backend Release evidence payload must not contain secret-like material.'
        )
      }
      continue
    }
    if (current.value === null || typeof current.value !== 'object') continue
    for (const [key, nested] of Object.entries(current.value)) {
      if (containsBackendSecretLikeMaterial(key)) {
        throw new TypeError(
          'Backend Release evidence payload must not contain secret-like material.'
        )
      }
      remaining.push({ value: nested, depth: current.depth + 1 })
    }
  }
  return payload
}

function evidenceDigest(value: unknown): string {
  const digest = boundedText(value, 'payloadDigest', 43)
  if (!DIGEST.test(digest)) {
    throw new TypeError('Backend Release evidence digest must be canonical SHA-256 base64url.')
  }
  return digest
}

function secretFreeOwnerId(value: unknown): string {
  const ownerId = boundedText(value, 'ownerId', MAX_ID_LENGTH)
  if (containsBackendSecretLikeMaterial(ownerId)) {
    throw new TypeError('Backend Release journal owner ID must be secret-free.')
  }
  return ownerId
}

function isUnknownRecord(value: unknown): value is BackendReleaseJournalUnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function memoryJournalOptions(
  value: MemoryBackendHostReleaseDispatchJournalOptions | undefined
): Readonly<MemoryBackendHostReleaseDispatchJournalOptions> {
  if (value === undefined) return Object.freeze({})
  if (!isUnknownRecord(value)) {
    throw new TypeError('Memory Backend Release journal options must be an object.')
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Memory Backend Release journal options must be a plain object.')
  }
  const normalized: {
    beforeRead?: () => void | Promise<void>
    beforeSettle?: () => void | Promise<void>
    afterSettle?: () => void | Promise<void>
  } = {}
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'beforeRead' && key !== 'beforeSettle' && key !== 'afterSettle') {
      throw new TypeError('Memory Backend Release journal options shape is invalid.')
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError('Memory Backend Release journal hooks must be functions.')
    }
    normalized[key] = descriptor.value as () => void | Promise<void>
  }
  return Object.freeze(normalized)
}

function exactRecord(value: unknown): BackendReleaseJournalUnknownRecord {
  if (!isUnknownRecord(value)) {
    throw new TypeError('Backend Release journal record must be an object.')
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Backend Release journal record must be a plain data object.')
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    throw new TypeError('Backend Release journal record must not contain symbol keys.')
  }
  const record: BackendReleaseJournalUnknownRecord = Object.create(null)
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(
        'Backend Release journal record must contain enumerable data properties only.'
      )
    }
    record[key] = descriptor.value
  }
  const expected = [
    'format',
    'version',
    'singleFlightKey',
    'releaseId',
    'ownerId',
    'planDigest',
    'claimedAt',
    'leaseExpiresAt',
    'settledAt',
    'outcome',
    'code',
    'remoteOperationIds'
  ]
  if (record.version === BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION) {
    expected.splice(3, 0, 'dispatchScopeKey')
  } else if (record.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION) {
    throw new TypeError('Backend Release journal version is unsupported.')
  }
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError('Backend Release journal record shape is invalid.')
  }
  return record
}

export function parseBackendHostReleaseDispatchEvidenceRecord(
  value: unknown
): BackendHostReleaseDispatchEvidenceRecord {
  if (!isUnknownRecord(value)) {
    throw new TypeError('Backend Release evidence record must be an object.')
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Backend Release evidence record must be a plain data object.')
  }
  const expected = [
    'format',
    'version',
    'singleFlightKey',
    'dispatchScopeKey',
    'releaseId',
    'planDigest',
    'phase',
    'payload',
    'payloadDigest',
    'recordedAt'
  ]
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError('Backend Release evidence record shape is invalid.')
  }
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError(
        'Backend Release evidence record must contain enumerable data properties only.'
      )
    }
  }
  if (
    value.format !== BACKEND_RELEASE_DISPATCH_EVIDENCE_FORMAT ||
    value.version !== BACKEND_RELEASE_DISPATCH_EVIDENCE_VERSION
  ) {
    throw new TypeError('Backend Release evidence format or version is invalid.')
  }
  if (value.phase !== 'progress' && value.phase !== 'final') {
    throw new TypeError('Backend Release evidence phase is invalid.')
  }
  const singleFlightKey = boundedText(value.singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
  const dispatchScopeKey = boundedText(value.dispatchScopeKey, 'dispatchScopeKey', MAX_KEY_LENGTH)
  if (
    !sameScopeAuthority(
      scopeAuthorityFromScopeKey(dispatchScopeKey),
      scopeAuthorityFromSingleFlightKey(singleFlightKey)
    )
  ) {
    throw new TypeError('Backend Release evidence scope does not match its semantic release key.')
  }
  return Object.freeze({
    format: BACKEND_RELEASE_DISPATCH_EVIDENCE_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_EVIDENCE_VERSION,
    singleFlightKey,
    dispatchScopeKey,
    releaseId: boundedText(value.releaseId, 'releaseId', MAX_ID_LENGTH),
    planDigest: boundedText(value.planDigest, 'planDigest', MAX_ID_LENGTH),
    phase: value.phase,
    payload: evidencePayload(value.payload),
    payloadDigest: evidenceDigest(value.payloadDigest),
    recordedAt: timestamp(value.recordedAt, 'recordedAt')
  })
}

interface BackendReleaseDispatchScopeAuthority {
  readonly providerId: string | null
  readonly projectId: string
}

function decodedKeyParts(value: string, name: string): readonly string[] {
  try {
    return value.split(':').map((part, index) => {
      const decoded = boundedText(
        decodeURIComponent(part),
        `${name}[${String(index)}]`,
        MAX_ID_LENGTH
      )
      if (encodeURIComponent(decoded) !== part) {
        throw new TypeError(`${name} is not canonically encoded.`)
      }
      if (containsBackendSecretLikeMaterial(decoded)) {
        throw new TypeError(`${name} must not contain secret-like material.`)
      }
      return decoded
    })
  } catch (cause) {
    if (cause instanceof TypeError) throw cause
    throw new TypeError(`${name} is not canonically encoded.`)
  }
}

function scopeAuthorityFromScopeKey(value: unknown): BackendReleaseDispatchScopeAuthority {
  const scopeKey = boundedText(value, 'dispatchScopeKey', MAX_KEY_LENGTH)
  const parts = decodedKeyParts(scopeKey, 'dispatchScopeKey')
  if (parts.length !== 3 || parts[0] !== 'backend-release-dispatch-scope-v1') {
    throw new TypeError('Backend Release dispatch scope key is invalid.')
  }
  return Object.freeze({ providerId: parts[1], projectId: parts[2] })
}

function scopeAuthorityFromSingleFlightKey(value: string): BackendReleaseDispatchScopeAuthority {
  const parts = decodedKeyParts(value, 'singleFlightKey')
  if (
    (parts[0] === 'backend-release-v2' || parts[0] === 'backend-release-v3') &&
    parts.length >= 4
  ) {
    return Object.freeze({ providerId: parts[1], projectId: parts[2] })
  }
  if (parts[0] === 'backend-release-v1' && parts.length >= 3) {
    return Object.freeze({ providerId: null, projectId: parts[1] })
  }
  throw new TypeError('Unresolved legacy Backend Release scope cannot be determined safely.')
}

function sameScopeAuthority(
  left: BackendReleaseDispatchScopeAuthority,
  right: BackendReleaseDispatchScopeAuthority
): boolean {
  return (
    left.projectId === right.projectId &&
    (left.providerId === null || right.providerId === null || left.providerId === right.providerId)
  )
}

export function parseBackendHostReleaseDispatchJournalRecord(
  value: unknown
): BackendHostReleaseDispatchJournalRecord {
  const record = exactRecord(value)
  if (record.format !== BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT) {
    throw new TypeError('Backend Release journal format is invalid.')
  }
  const version = record.version
  const outcome = record.outcome
  if (
    outcome !== 'pending' &&
    outcome !== 'applied' &&
    outcome !== 'failed' &&
    outcome !== 'outcome-unknown'
  ) {
    throw new TypeError('Backend Release journal outcome is invalid.')
  }
  const settledAt = record.settledAt === null ? null : timestamp(record.settledAt, 'settledAt')
  const claimedAt = timestamp(record.claimedAt, 'claimedAt')
  const leaseExpiresAt = timestamp(record.leaseExpiresAt, 'leaseExpiresAt')
  if (Date.parse(leaseExpiresAt) - Date.parse(claimedAt) !== BACKEND_RELEASE_DISPATCH_LEASE_MS) {
    throw new TypeError('Backend Release journal lease duration is invalid.')
  }
  const code = optionalCode(record.code)
  const operations = remoteOperationIds(record.remoteOperationIds)
  if (outcome === 'pending') {
    if (settledAt !== null || code !== null || operations.length !== 0) {
      throw new TypeError('Pending Backend Release journal claims cannot contain a settlement.')
    }
  } else if (settledAt === null) {
    throw new TypeError('Settled Backend Release journal claims require settledAt.')
  } else if (Date.parse(settledAt) < Date.parse(claimedAt)) {
    throw new TypeError('Backend Release journal settlement cannot precede its claim.')
  } else if (outcome === 'applied' ? code !== null : code === null) {
    throw new TypeError(
      'Applied journal claims require a null code; failed or unknown claims require a code.'
    )
  }
  const singleFlightKey = boundedText(record.singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
  const singleFlightAuthority = scopeAuthorityFromSingleFlightKey(singleFlightKey)
  const common: Omit<BackendHostReleaseDispatchJournalRecordBase, never> = {
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    singleFlightKey,
    releaseId: secretFreeBoundedText(record.releaseId, 'releaseId', MAX_ID_LENGTH),
    ownerId: secretFreeOwnerId(record.ownerId),
    planDigest: secretFreeBoundedText(record.planDigest, 'planDigest', MAX_ID_LENGTH),
    claimedAt,
    leaseExpiresAt,
    settledAt,
    outcome,
    code,
    remoteOperationIds: operations
  }
  if (version === BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION) {
    return Object.freeze({
      ...common,
      version: BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION
    })
  }
  const dispatchScopeKey = boundedText(record.dispatchScopeKey, 'dispatchScopeKey', MAX_KEY_LENGTH)
  if (!sameScopeAuthority(scopeAuthorityFromScopeKey(dispatchScopeKey), singleFlightAuthority)) {
    throw new TypeError('Backend Release dispatch scope does not match its semantic release key.')
  }
  return Object.freeze({
    ...common,
    version: BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
    dispatchScopeKey
  })
}

function claimRecord(
  input: BackendHostReleaseDispatchClaimInput
): BackendHostReleaseDispatchJournalRecordV2 {
  return parseBackendHostReleaseDispatchJournalRecord({
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
    singleFlightKey: input.singleFlightKey,
    dispatchScopeKey: input.dispatchScopeKey,
    releaseId: input.releaseId,
    ownerId: input.ownerId,
    planDigest: input.planDigest,
    claimedAt: input.claimedAt,
    leaseExpiresAt: input.leaseExpiresAt,
    settledAt: null,
    outcome: 'pending',
    code: null,
    remoteOperationIds: []
  }) as BackendHostReleaseDispatchJournalRecordV2
}

function settlementRecord(
  existing: BackendHostReleaseDispatchJournalRecord,
  input: BackendHostReleaseDispatchSettlementInput
): BackendHostReleaseDispatchJournalRecord {
  if (
    existing.singleFlightKey !== input.singleFlightKey ||
    existing.releaseId !== input.releaseId ||
    existing.planDigest !== input.planDigest
  ) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release journal settlement authority does not match its claim.'
    )
  }
  const next = parseBackendHostReleaseDispatchJournalRecord({
    ...existing,
    settledAt: input.settledAt,
    outcome: input.outcome,
    code: input.code,
    remoteOperationIds: input.remoteOperationIds
  })
  const reconciledTerminal =
    existing.outcome === 'outcome-unknown' &&
    (next.outcome === 'applied' || next.outcome === 'failed')
  if (
    existing.outcome !== 'pending' &&
    !reconciledTerminal &&
    JSON.stringify(existing) !== JSON.stringify(next)
  ) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release journal claim already has a different settlement.'
    )
  }
  return existing.outcome === 'pending' || reconciledTerminal ? next : existing
}

function cloneRecord(
  value: BackendHostReleaseDispatchJournalRecord
): BackendHostReleaseDispatchJournalRecord {
  return Object.freeze({
    ...value,
    remoteOperationIds: Object.freeze([...value.remoteOperationIds])
  }) as BackendHostReleaseDispatchJournalRecord
}

function evidenceRecord(
  input: BackendHostReleaseDispatchEvidenceInput
): BackendHostReleaseDispatchEvidenceRecord {
  return parseBackendHostReleaseDispatchEvidenceRecord({
    format: BACKEND_RELEASE_DISPATCH_EVIDENCE_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_EVIDENCE_VERSION,
    ...input
  })
}

function cloneEvidence(
  value: BackendHostReleaseDispatchEvidenceRecord
): BackendHostReleaseDispatchEvidenceRecord {
  return Object.freeze({ ...value })
}

function assertEvidenceClaimBinding(
  claim: BackendHostReleaseDispatchJournalRecord,
  candidate: BackendHostReleaseDispatchEvidenceRecord
): void {
  if (
    claim.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION ||
    claim.singleFlightKey !== candidate.singleFlightKey ||
    claim.dispatchScopeKey !== candidate.dispatchScopeKey ||
    claim.releaseId !== candidate.releaseId ||
    claim.planDigest !== candidate.planDigest
  ) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release evidence authority does not match its dispatch claim.'
    )
  }
  if (Date.parse(candidate.recordedAt) < Date.parse(claim.claimedAt)) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release evidence cannot precede its dispatch claim.'
    )
  }
}

function evidenceRecordForClaim(
  claim: BackendHostReleaseDispatchJournalRecord,
  existing: BackendHostReleaseDispatchEvidenceRecord | null,
  input: BackendHostReleaseDispatchEvidenceInput
): BackendHostReleaseDispatchEvidenceRecord {
  const candidate = evidenceRecord(input)
  assertEvidenceClaimBinding(claim, candidate)
  if (claim.outcome === 'applied' || claim.outcome === 'failed') {
    if (candidate.phase !== 'final') {
      throw new BackendHostReleaseJournalConflictError(
        'A terminal Backend Release claim accepts final evidence only.'
      )
    }
  }
  if (!existing) return candidate
  assertEvidenceClaimBinding(claim, existing)
  if (existing.phase === 'final') {
    if (JSON.stringify(existing) !== JSON.stringify(candidate)) {
      throw new BackendHostReleaseJournalConflictError(
        'Final Backend Release evidence cannot be replaced.'
      )
    }
    return existing
  }
  if (Date.parse(candidate.recordedAt) < Date.parse(existing.recordedAt)) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release evidence updates must be monotonic.'
    )
  }
  return candidate
}

function parseBackendHostReleaseDispatchTombstone(
  value: unknown
): BackendHostReleaseDispatchTombstoneV1 {
  if (!isUnknownRecord(value)) {
    throw new TypeError('Backend Release tombstone must be an object.')
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Backend Release tombstone must be a plain data object.')
  }
  const expected = ['format', 'version', 'singleFlightKey', 'record', 'evidence']
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key === 'symbol') ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new TypeError('Backend Release tombstone shape is invalid.')
  }
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      throw new TypeError('Backend Release tombstone must contain enumerable data properties only.')
    }
  }
  if (
    value.format !== BACKEND_RELEASE_DISPATCH_TOMBSTONE_FORMAT ||
    value.version !== BACKEND_RELEASE_DISPATCH_TOMBSTONE_VERSION
  ) {
    throw new TypeError('Backend Release tombstone format or version is invalid.')
  }
  const singleFlightKey = boundedText(value.singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
  const record = parseBackendHostReleaseDispatchJournalRecord(value.record)
  if (
    record.singleFlightKey !== singleFlightKey ||
    (record.outcome !== 'applied' && record.outcome !== 'failed')
  ) {
    throw new TypeError('Backend Release tombstone must bind one terminal journal record.')
  }
  const storedEvidence =
    value.evidence === null ? null : parseBackendHostReleaseDispatchEvidenceRecord(value.evidence)
  if (storedEvidence) {
    assertEvidenceClaimBinding(record, storedEvidence)
    if (storedEvidence.phase !== 'final') {
      throw new TypeError('Backend Release tombstone evidence must be final.')
    }
  }
  return Object.freeze({
    format: BACKEND_RELEASE_DISPATCH_TOMBSTONE_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_TOMBSTONE_VERSION,
    singleFlightKey,
    record: cloneRecord(record),
    evidence: storedEvidence ? cloneEvidence(storedEvidence) : null
  })
}

function tombstoneRecord(
  record: BackendHostReleaseDispatchJournalRecord,
  storedEvidence: BackendHostReleaseDispatchEvidenceRecord | null
): BackendHostReleaseDispatchTombstoneV1 {
  return parseBackendHostReleaseDispatchTombstone({
    format: BACKEND_RELEASE_DISPATCH_TOMBSTONE_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_TOMBSTONE_VERSION,
    singleFlightKey: record.singleFlightKey,
    record,
    evidence: storedEvidence
  })
}

function pendingRecords(
  values: Iterable<BackendHostReleaseDispatchJournalRecord>
): readonly BackendHostReleaseDispatchJournalRecord[] {
  return Object.freeze(
    [...values]
      .filter((record) => record.outcome === 'pending')
      .sort((left, right) => left.singleFlightKey.localeCompare(right.singleFlightKey, 'en'))
      .map(cloneRecord)
  )
}

function unresolvedRecords(
  values: Iterable<BackendHostReleaseDispatchJournalRecord>,
  dispatchScopeKey?: string
): readonly BackendHostReleaseDispatchJournalRecord[] {
  const scope = dispatchScopeKey === undefined ? null : scopeAuthorityFromScopeKey(dispatchScopeKey)
  return Object.freeze(
    [...values]
      .filter(
        (record) =>
          (record.outcome === 'pending' || record.outcome === 'outcome-unknown') &&
          (scope === null || sameScopeAuthority(recordScopeAuthority(record), scope))
      )
      .sort((left, right) => left.singleFlightKey.localeCompare(right.singleFlightKey, 'en'))
      .map(cloneRecord)
  )
}

function recordScopeAuthority(
  record: BackendHostReleaseDispatchJournalRecord
): BackendReleaseDispatchScopeAuthority {
  return record.version === BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION
    ? scopeAuthorityFromScopeKey(record.dispatchScopeKey)
    : scopeAuthorityFromSingleFlightKey(record.singleFlightKey)
}

function unresolvedScopeConflict(
  records: Iterable<BackendHostReleaseDispatchJournalRecord>,
  candidate: BackendHostReleaseDispatchJournalRecordV2
): boolean {
  const scope = recordScopeAuthority(candidate)
  return [...records].some(
    (record) =>
      record.singleFlightKey !== candidate.singleFlightKey &&
      (record.outcome === 'pending' || record.outcome === 'outcome-unknown') &&
      sameScopeAuthority(recordScopeAuthority(record), scope)
  )
}

function requireStorageCountWithin(
  values: readonly unknown[],
  maximum: number
): readonly unknown[] {
  if (values.length > maximum) throw new BackendHostReleaseJournalCapacityError()
  return values
}

function abortIdbTransaction(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch (cause) {
    // A failed request may already have aborted the transaction. Swallow only that exact state;
    // an unexpected abort failure must itself keep the journal unavailable.
    if (!(cause instanceof DOMException) || cause.name !== 'InvalidStateError') throw cause
  }
}

/**
 * One atomic startup transaction is the only IndexedDB archival authority. Terminal records move
 * with final (or absent) evidence into a versioned tombstone; a terminal record with progress-only
 * evidence stays active until final evidence is durable. Pending/outcome-unknown records never move.
 * Any malformed, over-capacity, or partially duplicated state aborts the transaction and keeps the
 * journal factory's memoized startup promise rejected for the lifetime of that journal instance.
 */
async function recoverIdbBackendReleaseJournal(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(
    [STORE, EVIDENCE_STORE, TOMBSTONE_STORE],
    'readwrite',
    STRICT_TRANSACTION_OPTIONS
  )
  const claimStore = transaction.objectStore(STORE)
  const evidenceStore = transaction.objectStore(EVIDENCE_STORE)
  const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE)
  try {
    const [storedClaims, storedEvidence, storedTombstones] = await Promise.all([
      reqToPromise(claimStore.getAll(undefined, MAX_STARTUP_RECORDS + 1)),
      reqToPromise(evidenceStore.getAll(undefined, MAX_STARTUP_RECORDS + 1)),
      reqToPromise(tombstoneStore.getAll(undefined, MAX_TOMBSTONES + 1))
    ])
    requireStorageCountWithin(storedClaims, MAX_STARTUP_RECORDS)
    requireStorageCountWithin(storedEvidence, MAX_STARTUP_RECORDS)
    requireStorageCountWithin(storedTombstones, MAX_TOMBSTONES)

    const records = storedClaims.map(parseBackendHostReleaseDispatchJournalRecord)
    const recordsByKey = new Map(records.map((record) => [record.singleFlightKey, record]))
    const evidenceByKey = new Map<string, BackendHostReleaseDispatchEvidenceRecord>()
    for (const value of storedEvidence) {
      const entry = parseBackendHostReleaseDispatchEvidenceRecord(value)
      const record = recordsByKey.get(entry.singleFlightKey)
      if (!record) {
        throw new TypeError('Backend Release journal contains orphaned operation evidence.')
      }
      assertEvidenceClaimBinding(record, entry)
      evidenceByKey.set(entry.singleFlightKey, entry)
    }

    const tombstones = storedTombstones.map(parseBackendHostReleaseDispatchTombstone)
    const tombstoneKeys = new Set<string>()
    for (const tombstone of tombstones) {
      if (
        tombstoneKeys.has(tombstone.singleFlightKey) ||
        recordsByKey.has(tombstone.singleFlightKey)
      ) {
        throw new TypeError('Backend Release journal contains a duplicated replay fence.')
      }
      tombstoneKeys.add(tombstone.singleFlightKey)
    }

    const terminal = records.filter((record) => {
      if (record.outcome !== 'applied' && record.outcome !== 'failed') return false
      return evidenceByKey.get(record.singleFlightKey)?.phase !== 'progress'
    })
    const terminalAwaitingFinalEvidence = records.filter((record) => {
      if (record.outcome !== 'applied' && record.outcome !== 'failed') return false
      return evidenceByKey.get(record.singleFlightKey)?.phase === 'progress'
    })
    const unresolved = records.filter(
      (record) => record.outcome === 'pending' || record.outcome === 'outcome-unknown'
    )
    if (unresolved.length + terminalAwaitingFinalEvidence.length > MAX_ACTIVE_RECORDS) {
      throw new BackendHostReleaseJournalCapacityError()
    }
    // Older journal versions may legitimately contain several unresolved entries for one project.
    // Preserve all of them: each continues to block the scope and requires explicit reconciliation.
    if (tombstones.length + terminal.length > MAX_TOMBSTONES) {
      throw new BackendHostReleaseJournalCapacityError()
    }
    for (const record of terminal) {
      tombstoneStore.add(tombstoneRecord(record, evidenceByKey.get(record.singleFlightKey) ?? null))
      claimStore.delete(record.singleFlightKey)
      evidenceStore.delete(record.singleFlightKey)
    }
  } catch (cause) {
    abortIdbTransaction(transaction)
    throw cause
  }
  await txDone(transaction)
}

export function createMemoryBackendHostReleaseDispatchJournal(
  options?: MemoryBackendHostReleaseDispatchJournalOptions
): BackendHostReleaseDispatchJournal {
  const hooks = memoryJournalOptions(options)
  const records = new Map<string, BackendHostReleaseDispatchJournalRecord>()
  const evidence = new Map<string, BackendHostReleaseDispatchEvidenceRecord>()
  const journal: BackendHostReleaseDispatchJournal = {
    async claim(input) {
      const candidate = claimRecord(input)
      const existing = records.get(candidate.singleFlightKey)
      if (unresolvedScopeConflict(records.values(), candidate)) {
        throw new BackendHostReleaseUnresolvedScopeError()
      }
      if (existing) return { claimed: false, record: cloneRecord(existing) }
      if (records.size >= MAX_ACTIVE_RECORDS) {
        throw new BackendHostReleaseJournalCapacityError()
      }
      records.set(candidate.singleFlightKey, candidate)
      return { claimed: true, record: cloneRecord(candidate) }
    },
    async settle(input) {
      const existing = records.get(input.singleFlightKey)
      if (!existing) {
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release journal claim is unavailable for settlement.'
        )
      }
      const next = settlementRecord(existing, input)
      if (hooks.beforeSettle) await hooks.beforeSettle()
      records.set(next.singleFlightKey, next)
      if (hooks.afterSettle) await hooks.afterSettle()
      return cloneRecord(next)
    },
    async read(singleFlightKey) {
      if (hooks.beforeRead) await hooks.beforeRead()
      const existing = records.get(boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH))
      return existing ? cloneRecord(existing) : null
    },
    async listPending() {
      return pendingRecords(records.values())
    },
    async listUnresolved() {
      return unresolvedRecords(records.values())
    },
    async listUnresolvedForScope(dispatchScopeKey) {
      return unresolvedRecords(records.values(), dispatchScopeKey)
    },
    async recordEvidence(input) {
      const key = boundedText(input.singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const claim = records.get(key)
      if (!claim) {
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release dispatch claim is unavailable for evidence.'
        )
      }
      const next = evidenceRecordForClaim(claim, evidence.get(key) ?? null, input)
      evidence.set(key, next)
      return cloneEvidence(next)
    },
    async readEvidence(singleFlightKey) {
      const key = boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const existing = evidence.get(key)
      return existing ? cloneEvidence(existing) : null
    }
  }
  const trustedJournal = Object.freeze(journal)
  trustedBackendHostReleaseDispatchJournals.add(trustedJournal)
  return trustedJournal
}

export function createIdbBackendHostReleaseDispatchJournal(
  databaseName = APP_DATABASE_NAMES.backendReleaseJournal,
  idbFactory: IDBFactory | undefined = globalThis.indexedDB
): BackendHostReleaseDispatchJournal {
  let databasePromise: Promise<IDBDatabase> | null = null
  const database = () =>
    (databasePromise ??= openIdb(
      databaseName,
      DATABASE_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'singleFlightKey' })
        }
        if (!db.objectStoreNames.contains(EVIDENCE_STORE)) {
          db.createObjectStore(EVIDENCE_STORE, { keyPath: 'singleFlightKey' })
        }
        if (!db.objectStoreNames.contains(TOMBSTONE_STORE)) {
          db.createObjectStore(TOMBSTONE_STORE, { keyPath: 'singleFlightKey' })
        }
      },
      idbFactory
    ).then(async (db) => {
      try {
        await recoverIdbBackendReleaseJournal(db)
        return db
      } catch (cause) {
        db.close()
        throw cause
      }
    }))

  const journal: BackendHostReleaseDispatchJournal = {
    async claim(input) {
      const candidate = claimRecord(input)
      const db = await database()
      const transaction = db.transaction(
        [STORE, TOMBSTONE_STORE],
        'readwrite',
        STRICT_TRANSACTION_OPTIONS
      )
      const store = transaction.objectStore(STORE)
      const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE)
      const storedRequest = store.get(candidate.singleFlightKey)
      const tombstoneRequest = tombstoneStore.get(candidate.singleFlightKey)
      const allRequest = store.getAll(undefined, MAX_ACTIVE_RECORDS + 1)
      const [stored, storedTombstone, allStored] = await Promise.all([
        reqToPromise(storedRequest),
        reqToPromise(tombstoneRequest),
        reqToPromise(allRequest)
      ])
      let existingTombstone: BackendHostReleaseDispatchTombstoneV1 | null = null
      try {
        const records = requireStorageCountWithin(allStored, MAX_ACTIVE_RECORDS).map(
          parseBackendHostReleaseDispatchJournalRecord
        )
        if (stored !== undefined && storedTombstone !== undefined) {
          throw new TypeError('Backend Release journal contains a duplicated replay fence.')
        }
        existingTombstone =
          storedTombstone === undefined
            ? null
            : parseBackendHostReleaseDispatchTombstone(storedTombstone)
        if (unresolvedScopeConflict(records, candidate)) {
          throw new BackendHostReleaseUnresolvedScopeError()
        }
        if (stored === undefined && existingTombstone === null) {
          if (records.length >= MAX_ACTIVE_RECORDS) {
            throw new BackendHostReleaseJournalCapacityError()
          }
          store.add(candidate)
        }
      } catch (cause) {
        abortIdbTransaction(transaction)
        throw cause
      }
      await txDone(transaction)
      const record =
        stored !== undefined
          ? parseBackendHostReleaseDispatchJournalRecord(stored)
          : (existingTombstone?.record ?? candidate)
      return {
        claimed: stored === undefined && existingTombstone === null,
        record: cloneRecord(record)
      }
    },
    async settle(input) {
      const db = await database()
      const transaction = db.transaction(
        [STORE, TOMBSTONE_STORE],
        'readwrite',
        STRICT_TRANSACTION_OPTIONS
      )
      const store = transaction.objectStore(STORE)
      const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE)
      const [stored, storedTombstone] = await Promise.all([
        reqToPromise(store.get(input.singleFlightKey)),
        reqToPromise(tombstoneStore.get(input.singleFlightKey))
      ])
      if (stored === undefined && storedTombstone === undefined) {
        abortIdbTransaction(transaction)
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release journal claim is unavailable for settlement.'
        )
      }
      let next: BackendHostReleaseDispatchJournalRecord
      try {
        if (stored !== undefined && storedTombstone !== undefined) {
          throw new TypeError('Backend Release journal contains a duplicated replay fence.')
        }
        const existing =
          stored !== undefined
            ? parseBackendHostReleaseDispatchJournalRecord(stored)
            : parseBackendHostReleaseDispatchTombstone(storedTombstone).record
        next = settlementRecord(existing, input)
      } catch (cause) {
        abortIdbTransaction(transaction)
        throw cause
      }
      if (stored !== undefined) store.put(next)
      await txDone(transaction)
      return cloneRecord(next)
    },
    async read(singleFlightKey) {
      const key = boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const db = await database()
      const transaction = db.transaction([STORE, TOMBSTONE_STORE], 'readonly')
      const [stored, storedTombstone] = await Promise.all([
        reqToPromise(transaction.objectStore(STORE).get(key)),
        reqToPromise(transaction.objectStore(TOMBSTONE_STORE).get(key))
      ])
      await txDone(transaction)
      if (stored !== undefined && storedTombstone !== undefined) {
        throw new TypeError('Backend Release journal contains a duplicated replay fence.')
      }
      if (stored !== undefined) {
        return cloneRecord(parseBackendHostReleaseDispatchJournalRecord(stored))
      }
      return storedTombstone === undefined
        ? null
        : cloneRecord(parseBackendHostReleaseDispatchTombstone(storedTombstone).record)
    },
    async listPending() {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(
        transaction.objectStore(STORE).getAll(undefined, MAX_ACTIVE_RECORDS + 1)
      )
      await txDone(transaction)
      return pendingRecords(
        requireStorageCountWithin(stored, MAX_ACTIVE_RECORDS).map(
          parseBackendHostReleaseDispatchJournalRecord
        )
      )
    },
    async listUnresolved() {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(
        transaction.objectStore(STORE).getAll(undefined, MAX_ACTIVE_RECORDS + 1)
      )
      await txDone(transaction)
      return unresolvedRecords(
        requireStorageCountWithin(stored, MAX_ACTIVE_RECORDS).map(
          parseBackendHostReleaseDispatchJournalRecord
        )
      )
    },
    async listUnresolvedForScope(dispatchScopeKey) {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(
        transaction.objectStore(STORE).getAll(undefined, MAX_ACTIVE_RECORDS + 1)
      )
      await txDone(transaction)
      return unresolvedRecords(
        requireStorageCountWithin(stored, MAX_ACTIVE_RECORDS).map(
          parseBackendHostReleaseDispatchJournalRecord
        ),
        dispatchScopeKey
      )
    },
    async recordEvidence(input) {
      const candidate = evidenceRecord(input)
      const db = await database()
      const transaction = db.transaction(
        [STORE, EVIDENCE_STORE, TOMBSTONE_STORE],
        'readwrite',
        STRICT_TRANSACTION_OPTIONS
      )
      const claimStore = transaction.objectStore(STORE)
      const evidenceStore = transaction.objectStore(EVIDENCE_STORE)
      const tombstoneStore = transaction.objectStore(TOMBSTONE_STORE)
      const [storedClaim, storedEvidence, storedTombstone] = await Promise.all([
        reqToPromise(claimStore.get(candidate.singleFlightKey)),
        reqToPromise(evidenceStore.get(candidate.singleFlightKey)),
        reqToPromise(tombstoneStore.get(candidate.singleFlightKey))
      ])
      if (storedClaim === undefined && storedTombstone === undefined) {
        abortIdbTransaction(transaction)
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release dispatch claim is unavailable for evidence.'
        )
      }
      let next: BackendHostReleaseDispatchEvidenceRecord
      try {
        if (storedClaim !== undefined && storedTombstone !== undefined) {
          throw new TypeError('Backend Release journal contains a duplicated replay fence.')
        }
        const tombstone =
          storedTombstone === undefined
            ? null
            : parseBackendHostReleaseDispatchTombstone(storedTombstone)
        if (tombstone && storedEvidence !== undefined) {
          throw new TypeError('Backend Release journal contains orphaned operation evidence.')
        }
        const existingClaim =
          storedClaim === undefined
            ? tombstone?.record
            : parseBackendHostReleaseDispatchJournalRecord(storedClaim)
        if (!existingClaim) {
          throw new BackendHostReleaseJournalConflictError(
            'Backend Release dispatch claim is unavailable for evidence.'
          )
        }
        next = evidenceRecordForClaim(
          existingClaim,
          tombstone?.evidence ??
            (storedEvidence === undefined
              ? null
              : parseBackendHostReleaseDispatchEvidenceRecord(storedEvidence)),
          candidate
        )
        if (tombstone) {
          tombstoneStore.put(tombstoneRecord(tombstone.record, next))
        } else {
          evidenceStore.put(next)
        }
      } catch (cause) {
        abortIdbTransaction(transaction)
        throw cause
      }
      await txDone(transaction)
      return cloneEvidence(next)
    },
    async readEvidence(singleFlightKey) {
      const key = boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const db = await database()
      const transaction = db.transaction([EVIDENCE_STORE, TOMBSTONE_STORE], 'readonly')
      const [stored, storedTombstone] = await Promise.all([
        reqToPromise(transaction.objectStore(EVIDENCE_STORE).get(key)),
        reqToPromise(transaction.objectStore(TOMBSTONE_STORE).get(key))
      ])
      await txDone(transaction)
      if (stored !== undefined && storedTombstone !== undefined) {
        throw new TypeError('Backend Release journal contains orphaned operation evidence.')
      }
      if (stored !== undefined) {
        return cloneEvidence(parseBackendHostReleaseDispatchEvidenceRecord(stored))
      }
      if (storedTombstone === undefined) return null
      const tombstone = parseBackendHostReleaseDispatchTombstone(storedTombstone)
      return tombstone.evidence ? cloneEvidence(tombstone.evidence) : null
    }
  }
  const trustedJournal = Object.freeze(journal)
  trustedBackendHostReleaseDispatchJournals.add(trustedJournal)
  return trustedJournal
}
