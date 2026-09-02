import { containsBackendSecretLikeMaterial } from '@open-pencil/lowcode/backend'

import { APP_DATABASE_NAMES, openIdb, reqToPromise, txDone } from '@/app/storage/idb'

export const BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT =
  'openpencil.backend-release-dispatch-journal' as const
export const BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION = 1 as const
/** Fixed recovery lease for a durable claim whose dispatch owner may still be running. */
export const BACKEND_RELEASE_DISPATCH_LEASE_MS = 5 * 60 * 1_000

const DATABASE_VERSION = 1
const STORE = 'dispatchClaims'
const MAX_KEY_LENGTH = 2_048
const MAX_ID_LENGTH = 256
const MAX_CODE_LENGTH = 256
const MAX_REMOTE_OPERATION_IDS = 256
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/u

interface BackendReleaseJournalUnknownRecord {
  [key: string]: unknown
}

export type BackendHostReleaseDispatchOutcome = 'pending' | 'applied' | 'failed' | 'outcome-unknown'

export interface BackendHostReleaseDispatchJournalRecordV1 {
  readonly format: typeof BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT
  readonly version: typeof BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION
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

export type BackendHostReleaseDispatchClaimInput = Pick<
  BackendHostReleaseDispatchJournalRecordV1,
  'singleFlightKey' | 'releaseId' | 'ownerId' | 'planDigest' | 'claimedAt' | 'leaseExpiresAt'
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
  readonly record: BackendHostReleaseDispatchJournalRecordV1
}

export interface BackendHostReleaseDispatchJournal {
  /** Atomically creates a one-way dispatch claim. Existing claims are never overwritten. */
  claim(input: BackendHostReleaseDispatchClaimInput): Promise<BackendHostReleaseDispatchClaimResult>
  /** Idempotently records the known post-dispatch result without deleting the claim. */
  settle(
    input: BackendHostReleaseDispatchSettlementInput
  ): Promise<BackendHostReleaseDispatchJournalRecordV1>
  read(singleFlightKey: string): Promise<BackendHostReleaseDispatchJournalRecordV1 | null>
  listPending(): Promise<readonly BackendHostReleaseDispatchJournalRecordV1[]>
}

export class BackendHostReleaseJournalConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackendHostReleaseJournalConflictError'
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
  if (
    Object.keys(record).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new TypeError('Backend Release journal record shape is invalid.')
  }
  return record
}

export function parseBackendHostReleaseDispatchJournalRecord(
  value: unknown
): BackendHostReleaseDispatchJournalRecordV1 {
  const record = exactRecord(value)
  if (record.format !== BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT) {
    throw new TypeError('Backend Release journal format is invalid.')
  }
  if (record.version !== BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION) {
    throw new TypeError('Backend Release journal version is unsupported.')
  }
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
  } else if (outcome === 'applied' ? code !== null : code === null) {
    throw new TypeError(
      'Applied journal claims require a null code; failed or unknown claims require a code.'
    )
  }
  return Object.freeze({
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
    singleFlightKey: boundedText(record.singleFlightKey, 'singleFlightKey', MAX_KEY_LENGTH),
    releaseId: boundedText(record.releaseId, 'releaseId', MAX_ID_LENGTH),
    ownerId: secretFreeOwnerId(record.ownerId),
    planDigest: boundedText(record.planDigest, 'planDigest', MAX_ID_LENGTH),
    claimedAt,
    leaseExpiresAt,
    settledAt,
    outcome,
    code,
    remoteOperationIds: operations
  })
}

function claimRecord(
  input: BackendHostReleaseDispatchClaimInput
): BackendHostReleaseDispatchJournalRecordV1 {
  return parseBackendHostReleaseDispatchJournalRecord({
    format: BACKEND_RELEASE_DISPATCH_JOURNAL_FORMAT,
    version: BACKEND_RELEASE_DISPATCH_JOURNAL_VERSION,
    singleFlightKey: input.singleFlightKey,
    releaseId: input.releaseId,
    ownerId: input.ownerId,
    planDigest: input.planDigest,
    claimedAt: input.claimedAt,
    leaseExpiresAt: input.leaseExpiresAt,
    settledAt: null,
    outcome: 'pending',
    code: null,
    remoteOperationIds: []
  })
}

function settlementRecord(
  existing: BackendHostReleaseDispatchJournalRecordV1,
  input: BackendHostReleaseDispatchSettlementInput
): BackendHostReleaseDispatchJournalRecordV1 {
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
  value: BackendHostReleaseDispatchJournalRecordV1
): BackendHostReleaseDispatchJournalRecordV1 {
  return Object.freeze({
    ...value,
    remoteOperationIds: Object.freeze([...value.remoteOperationIds])
  })
}

function pendingRecords(
  values: Iterable<BackendHostReleaseDispatchJournalRecordV1>
): readonly BackendHostReleaseDispatchJournalRecordV1[] {
  return Object.freeze(
    [...values]
      .filter((record) => record.outcome === 'pending')
      .sort((left, right) => left.singleFlightKey.localeCompare(right.singleFlightKey, 'en'))
      .map(cloneRecord)
  )
}

export function createMemoryBackendHostReleaseDispatchJournal(): BackendHostReleaseDispatchJournal {
  const records = new Map<string, BackendHostReleaseDispatchJournalRecordV1>()
  const journal: BackendHostReleaseDispatchJournal = {
    async claim(input) {
      const candidate = claimRecord(input)
      const existing = records.get(candidate.singleFlightKey)
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
      },
      idbFactory
    ))

  const journal: BackendHostReleaseDispatchJournal = {
    async claim(input) {
      const candidate = claimRecord(input)
      const db = await database()
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const stored = await reqToPromise(store.get(candidate.singleFlightKey))
      if (stored === undefined) store.add(candidate)
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
      let next: BackendHostReleaseDispatchJournalRecordV1
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
    }
  }
  return Object.freeze(journal)
}
