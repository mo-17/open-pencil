/* oxlint-disable eslint(max-lines) -- Claim, settlement, evidence validation, and matching memory/IndexedDB implementations stay together for atomic-invariant auditing. */
import { containsBackendSecretLikeMaterial } from '@open-pencil/lowcode/backend'

import { APP_DATABASE_NAMES, openIdb, reqToPromise, txDone } from '@/app/storage/idb'

export const BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT =
  'openpencil.backend-release-dispatch-journal' as const
export const BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION = 2 as const
const BACKEND_RELEASE_DISPATCH_JOURNAL_LEGACY_VERSION = 1 as const
/** Fixed recovery lease for a durable claim whose dispatch owner may still be running. */
export const BACKEND_RELEASE_DISPATCH_LEASE_MS = 5 * 60 * 1_000

const DATABASE_VERSION = 2
const STORE = 'dispatchClaims'
const EVIDENCE_STORE = 'dispatchEvidence'
const MAX_KEY_LENGTH = 2_048
const MAX_ID_LENGTH = 256
const MAX_CODE_LENGTH = 256
const MAX_REMOTE_OPERATION_IDS = 256
const MAX_EVIDENCE_BYTES = 1024 * 1024
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const HOST_OPERATION_EVIDENCE_ID =
  /^(?:edge-(?:deploy|health)-[A-Za-z0-9_-]{32}|storage-(?:bucket|actors|probe)-[1-9][0-9]{0,5}-[A-Za-z0-9_-]{24})$/u
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

export class BackendHostReleaseJournalConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendHostReleaseJournalConflictError'
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
  const normalized = value.map((entry, index) =>
    boundedText(entry, `remoteOperationIds[${String(index)}]`, MAX_ID_LENGTH)
  )
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
  const containsSecret = (entry: unknown): boolean => {
    if (typeof entry === 'string') {
      return !HOST_OPERATION_EVIDENCE_ID.test(entry) && containsBackendSecretLikeMaterial(entry)
    }
    if (entry === null || typeof entry !== 'object') return false
    return Object.entries(entry).some(
      ([key, nested]) => containsBackendSecretLikeMaterial(key) || containsSecret(nested)
    )
  }
  if (containsSecret(parsed)) {
    throw new TypeError('Backend Release evidence payload must not contain secret-like material.')
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
  const common: Omit<BackendHostReleaseDispatchJournalRecordBase, never> = {
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    singleFlightKey,
    releaseId: boundedText(record.releaseId, 'releaseId', MAX_ID_LENGTH),
    ownerId: secretFreeOwnerId(record.ownerId),
    planDigest: boundedText(record.planDigest, 'planDigest', MAX_ID_LENGTH),
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
  if (
    !sameScopeAuthority(
      scopeAuthorityFromScopeKey(dispatchScopeKey),
      scopeAuthorityFromSingleFlightKey(singleFlightKey)
    )
  ) {
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

function evidenceRecordForClaim(
  claim: BackendHostReleaseDispatchJournalRecord,
  existing: BackendHostReleaseDispatchEvidenceRecord | null,
  input: BackendHostReleaseDispatchEvidenceInput
): BackendHostReleaseDispatchEvidenceRecord {
  const candidate = evidenceRecord(input)
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
  if (claim.outcome === 'applied' || claim.outcome === 'failed') {
    if (candidate.phase !== 'final') {
      throw new BackendHostReleaseJournalConflictError(
        'A terminal Backend Release claim accepts final evidence only.'
      )
    }
  }
  if (!existing) return candidate
  if (
    existing.singleFlightKey !== candidate.singleFlightKey ||
    existing.dispatchScopeKey !== candidate.dispatchScopeKey ||
    existing.releaseId !== candidate.releaseId ||
    existing.planDigest !== candidate.planDigest
  ) {
    throw new BackendHostReleaseJournalConflictError(
      'Backend Release evidence authority does not match its existing record.'
    )
  }
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

export function createMemoryBackendHostReleaseDispatchJournal(): BackendHostReleaseDispatchJournal {
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
      records.set(next.singleFlightKey, next)
      return cloneRecord(next)
    },
    async read(singleFlightKey) {
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
  return Object.freeze(journal)
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
      },
      idbFactory
    ))

  const journal: BackendHostReleaseDispatchJournal = {
    async claim(input) {
      const candidate = claimRecord(input)
      const db = await database()
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const storedRequest = store.get(candidate.singleFlightKey)
      const allRequest = store.getAll()
      const [stored, allStored] = await Promise.all([
        reqToPromise(storedRequest),
        reqToPromise(allRequest)
      ])
      try {
        const records = allStored.map(parseBackendHostReleaseDispatchJournalRecord)
        if (unresolvedScopeConflict(records, candidate)) {
          throw new BackendHostReleaseUnresolvedScopeError()
        }
        if (stored === undefined) store.add(candidate)
      } catch (cause) {
        transaction.abort()
        throw cause
      }
      await txDone(transaction)
      const record =
        stored === undefined ? candidate : parseBackendHostReleaseDispatchJournalRecord(stored)
      return { claimed: stored === undefined, record: cloneRecord(record) }
    },
    async settle(input) {
      const db = await database()
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const stored = await reqToPromise(store.get(input.singleFlightKey))
      if (stored === undefined) {
        transaction.abort()
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release journal claim is unavailable for settlement.'
        )
      }
      let next: BackendHostReleaseDispatchJournalRecord
      try {
        next = settlementRecord(parseBackendHostReleaseDispatchJournalRecord(stored), input)
      } catch (cause) {
        transaction.abort()
        throw cause
      }
      store.put(next)
      await txDone(transaction)
      return cloneRecord(next)
    },
    async read(singleFlightKey) {
      const key = boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(transaction.objectStore(STORE).get(key))
      await txDone(transaction)
      return stored === undefined
        ? null
        : cloneRecord(parseBackendHostReleaseDispatchJournalRecord(stored))
    },
    async listPending() {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(transaction.objectStore(STORE).getAll())
      await txDone(transaction)
      return pendingRecords(stored.map(parseBackendHostReleaseDispatchJournalRecord))
    },
    async listUnresolved() {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(transaction.objectStore(STORE).getAll())
      await txDone(transaction)
      return unresolvedRecords(stored.map(parseBackendHostReleaseDispatchJournalRecord))
    },
    async listUnresolvedForScope(dispatchScopeKey) {
      const db = await database()
      const transaction = db.transaction(STORE, 'readonly')
      const stored = await reqToPromise(transaction.objectStore(STORE).getAll())
      await txDone(transaction)
      return unresolvedRecords(
        stored.map(parseBackendHostReleaseDispatchJournalRecord),
        dispatchScopeKey
      )
    },
    async recordEvidence(input) {
      const candidate = evidenceRecord(input)
      const db = await database()
      const transaction = db.transaction([STORE, EVIDENCE_STORE], 'readwrite')
      const claimStore = transaction.objectStore(STORE)
      const evidenceStore = transaction.objectStore(EVIDENCE_STORE)
      const [storedClaim, storedEvidence] = await Promise.all([
        reqToPromise(claimStore.get(candidate.singleFlightKey)),
        reqToPromise(evidenceStore.get(candidate.singleFlightKey))
      ])
      if (storedClaim === undefined) {
        transaction.abort()
        throw new BackendHostReleaseJournalConflictError(
          'Backend Release dispatch claim is unavailable for evidence.'
        )
      }
      let next: BackendHostReleaseDispatchEvidenceRecord
      try {
        next = evidenceRecordForClaim(
          parseBackendHostReleaseDispatchJournalRecord(storedClaim),
          storedEvidence === undefined
            ? null
            : parseBackendHostReleaseDispatchEvidenceRecord(storedEvidence),
          candidate
        )
      } catch (cause) {
        transaction.abort()
        throw cause
      }
      evidenceStore.put(next)
      await txDone(transaction)
      return cloneEvidence(next)
    },
    async readEvidence(singleFlightKey) {
      const key = boundedText(singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH)
      const db = await database()
      const transaction = db.transaction(EVIDENCE_STORE, 'readonly')
      const stored = await reqToPromise(transaction.objectStore(EVIDENCE_STORE).get(key))
      await txDone(transaction)
      return stored === undefined
        ? null
        : cloneEvidence(parseBackendHostReleaseDispatchEvidenceRecord(stored))
    }
  }
  return Object.freeze(journal)
}
