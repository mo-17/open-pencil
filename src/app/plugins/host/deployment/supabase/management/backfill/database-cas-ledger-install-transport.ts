/* oxlint-disable eslint(max-lines), eslint(complexity), open-pencil(no-mixed-case-acronym-identifiers) -- Keep the fixed-origin CAS-ledger mutation boundary in one auditable module. */

import {
  consumeSupabaseManagementDatabaseWriteCredentialLeaseV1,
  isTestingSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import {
  consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1,
  deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1,
  type SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install'
import type {
  SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
  SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1,
  SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1,
  SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1,
  SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  isSupabaseBackfillDatabaseCASLedgerInstallAuthorityPermitConsumerPairV1,
  trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/install-durable-authority'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'

import type {
  SupabaseManagementBoundedResponse,
  SupabaseManagementRequestLifetime
} from '../transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const MIGRATION_NAME = /^[a-z][a-z0-9_]{0,126}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export const SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxMigrationResponseBytes: 64 * 1024,
  maxMigrationSQLBytes: 1_048_576,
  maxMigrationNameBytes: 127,
  requestTimeoutMs: 180_000
})

export type SupabaseManagementBackfillDatabaseCASLedgerInstallFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome =
  | 'not-dispatched'
  | 'outcome-unknown'

export type SupabaseManagementBackfillDatabaseCASLedgerInstallTransportErrorCode =
  | 'aborted'
  | 'dispatch-already-used'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'journal-permit-invalid'
  | 'network-failed'
  | 'response-too-large'

export class SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError extends Error {
  constructor(
    readonly code: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportErrorCode,
    readonly outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
  ) {
    super(`Supabase Management backfill database CAS ledger install transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError'
  }
}

const knownNotDispatchedProofs = new WeakMap<
  SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError,
  SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1
>()

/**
 * Transfers the same-process durable proof carried by a known pre-POST failure.
 * The proof is deliberately absent from the enumerable/serializable error surface and one-shot.
 */
export function consumeSupabaseManagementBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1(
  error: unknown
): SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 | null {
  if (!(error instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)) {
    return null
  }
  const proof = knownNotDispatchedProofs.get(error) ?? null
  knownNotDispatchedProofs.delete(error)
  return proof
}

export interface SupabaseManagementBackfillDatabaseCASLedgerInstallProjectAuthorityV1 {
  readonly projectRef: string
  readonly organizationId: string
  readonly writeGrantGeneration: string
}

export interface SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1 {
  readonly status: 'verification-required'
  readonly httpStatus: 200
  readonly managementRequestReturned200: true
  readonly migrationName: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
}

export interface SupabaseManagementBackfillDatabaseCASLedgerPreparedMigrationV1 {
  readonly endpoint: string
  readonly name: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly sqlByteLength: number
  readonly exactReviewedSql: true
  readonly requestBodyKeys: readonly ['query', 'name']
  readonly journalPermitRequired: true
  readonly journalPermitAvailable: true
}

export interface SupabaseManagementBackfillDatabaseCASLedgerInstallDispatchOptionsV1 {
  readonly permit: SupabaseBackfillDatabaseCASLedgerInstallTransportPermitV1
  readonly credentialLease: SupabaseManagementDatabaseWriteCredentialLeaseV1
}

export interface SupabaseManagementPreparedBackfillDatabaseCASLedgerInstallV1 {
  readonly projectAuthority: SupabaseManagementBackfillDatabaseCASLedgerInstallProjectAuthorityV1
  readonly migration: SupabaseManagementBackfillDatabaseCASLedgerPreparedMigrationV1
  dispatch(
    options: SupabaseManagementBackfillDatabaseCASLedgerInstallDispatchOptionsV1
  ): Promise<SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1>
  /** Burns an unused preparation and drops the testing probe credential without network I/O. */
  dispose(): boolean
}

export interface SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1 {
  prepareMigration(
    context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
  ): Promise<SupabaseManagementPreparedBackfillDatabaseCASLedgerInstallV1>
}

export interface CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1 {
  /** Testing-only probe PAT used for both fixed project checks and final vault-value equality. */
  readonly personalAccessToken: string
  /** Shared credential generation already bound into the reviewed install context. */
  readonly writeGrantGeneration: string
  readonly fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
  readonly permitConsumer: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
  readonly credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  readonly signal?: AbortSignal
  readonly requestTimeoutMs?: number
}

interface UnknownRecord {
  [key: string]: unknown
}

interface TrustedInstallSnapshotV1 {
  readonly projectRef: string
  readonly accountId: string
  readonly readGrantGeneration: string
  readonly writeGrantGeneration: string
  readonly migrationName: string
  readonly installSql: string
  readonly installReviewDigest: string
  readonly sourceReviewDigest: string
  readonly verificationDigest: string
  readonly ledgerShapeDigest: string
  readonly baseSqlDigest: string
  readonly marker: string
  readonly markerBindingDigest: string
  readonly installSqlDigest: string
  readonly verificationQueryDigest: string
}

type RequestDeadline = SupabaseManagementRequestLifetime

type BoundedResponse = SupabaseManagementBoundedResponse

interface MigrationAttemptSuccessV1 {
  readonly ok: true
}

interface MigrationAttemptFailureV1 {
  readonly ok: false
  readonly code: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportErrorCode
}

type MigrationAttemptResultV1 = MigrationAttemptSuccessV1 | MigrationAttemptFailureV1

interface CredentialLeaseIdentityV1 {
  readonly lease: SupabaseManagementDatabaseWriteCredentialLeaseV1
  readonly bindingDigest: string
  readonly writeCredentialIncarnation: string
  readonly operationLeaseGeneration: string
}

const STATUS_OK = 200 as const
const FACTORY_REQUIRED_KEYS = [
  'personalAccessToken',
  'writeGrantGeneration',
  'fetcher',
  'permitConsumer',
  'credentialIssuer'
] as const
const FACTORY_OPTION_KEYS = [...FACTORY_REQUIRED_KEYS, 'signal', 'requestTimeoutMs'] as const
const DISPATCH_OPTION_KEYS = ['permit', 'credentialLease'] as const
const testingInstallTransports = new WeakMap<
  object,
  Readonly<{
    permitConsumer: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
    credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
  }>
>()

function fail(
  code: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportErrorCode,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): never {
  throw new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(code, outcome)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('invalid-request', 'not-dispatched')
  }
}

function baseSqlFromInstallSql(installSql: string, marker: string): string {
  const markerSuffix = [
    '',
    `COMMENT ON CONSTRAINT "${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_CONSTRAINT}" ON "openpencil_release"."backfill_executions_v1"`,
    `  IS '${marker}';`,
    'COMMIT;\n'
  ].join('\n')
  const markerOffset = installSql.length - markerSuffix.length
  if (
    markerOffset <= 0 ||
    !installSql.endsWith(markerSuffix) ||
    installSql.indexOf(markerSuffix) !== markerOffset
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  return `${installSql.slice(0, markerOffset)}COMMIT;\n`
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    utf8ByteLength(value) <=
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxPATBytes &&
    !/\p{Cc}/u.test(value)
  )
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return value
}

function boundedTimeout(value: unknown): number {
  if (value === undefined) {
    return SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.requestTimeoutMs
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) >
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.requestTimeoutMs
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return value as number
}

function exactFactoryOptions(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-authority', 'not-dispatched')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-authority', 'not-dispatched')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.some(
      (key) => typeof key !== 'string' || !(FACTORY_OPTION_KEYS as readonly string[]).includes(key)
    ) ||
    FACTORY_REQUIRED_KEYS.some((key) => !keys.includes(key))
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  const source = value as UnknownRecord
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('invalid-authority', 'not-dispatched')
    }
  }
  return source
}

function exactDispatchOptions(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-request', 'not-dispatched')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-request', 'not-dispatched')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== DISPATCH_OPTION_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !(DISPATCH_OPTION_KEYS as readonly string[]).includes(key)
    )
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  const source = value as UnknownRecord
  for (const key of DISPATCH_OPTION_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('invalid-request', 'not-dispatched')
    }
  }
  return source
}

function plainRecord(
  value: unknown,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-response', outcome)
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail('invalid-response', outcome)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('invalid-response', outcome)
  }
  return value as UnknownRecord
}

function ownData(
  record: object,
  key: string,
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response',
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key)
  } catch {
    return fail(code, outcome)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code, outcome)
  return descriptor.value
}

function ownKeys(
  record: object,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(record)
  } catch {
    return fail('invalid-response', outcome)
  }
}

function testingCredentialIssuer(
  value: unknown
): SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1 {
  if (!isTestingSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(value)) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return value
}

function testingPermitConsumer(value: unknown): Readonly<{
  consumer: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1
  consume: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['consume']
  markPOSTStarted: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['markPOSTStarted']
  attestKnownNotDispatched: SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['attestKnownNotDispatched']
}> {
  if (!trustedSupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1(value)) {
    return fail('invalid-authority', 'not-dispatched')
  }
  const source: object = value
  let keys: readonly PropertyKey[]
  try {
    keys = Reflect.ownKeys(source)
  } catch {
    return fail('invalid-authority', 'not-dispatched')
  }
  const expectedKeys = [
    'format',
    'version',
    'provenance',
    'consume',
    'markPOSTStarted',
    'attestKnownNotDispatched'
  ] as const
  if (
    keys.length !== expectedKeys.length ||
    keys.some(
      (key) => typeof key !== 'string' || !(expectedKeys as readonly string[]).includes(key)
    )
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  if (
    ownData(source, 'format', 'invalid-authority', 'not-dispatched') !==
      'openpencil.supabase-backfill-database-cas-ledger-install-permit-consumer.v1' ||
    ownData(source, 'version', 'invalid-authority', 'not-dispatched') !== 1 ||
    ownData(source, 'provenance', 'invalid-authority', 'not-dispatched') !== 'testing'
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  const consume = ownData(source, 'consume', 'invalid-authority', 'not-dispatched')
  const markPOSTStarted = ownData(source, 'markPOSTStarted', 'invalid-authority', 'not-dispatched')
  const attestKnownNotDispatched = ownData(
    source,
    'attestKnownNotDispatched',
    'invalid-authority',
    'not-dispatched'
  )
  if (
    typeof consume !== 'function' ||
    typeof markPOSTStarted !== 'function' ||
    typeof attestKnownNotDispatched !== 'function'
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return Object.freeze({
    consumer: value,
    consume: consume as SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['consume'],
    markPOSTStarted:
      markPOSTStarted as SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['markPOSTStarted'],
    attestKnownNotDispatched:
      attestKnownNotDispatched as SupabaseBackfillDatabaseCASLedgerInstallPermitConsumerV1['attestKnownNotDispatched']
  })
}

function exactTrustedRecord(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-request', 'not-dispatched')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-request', 'not-dispatched')
  }
  const expectedKeys: readonly string[] = [
    'projectRef',
    'accountId',
    'readGrantGeneration',
    'writeGrantGeneration',
    'migrationName',
    'installSql',
    'installReviewDigest',
    'sourceReviewDigest',
    'verificationDigest',
    'ledgerShapeDigest',
    'baseSqlDigest',
    'marker',
    'markerBindingDigest',
    'installSqlDigest',
    'verificationQueryDigest'
  ]
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  return value as UnknownRecord
}

function trustedText(source: UnknownRecord, key: string): string {
  const value = ownData(source, key, 'invalid-request', 'not-dispatched')
  if (typeof value !== 'string') return fail('invalid-request', 'not-dispatched')
  return value
}

function wellFormedUTF8(value: string): boolean {
  try {
    return (
      new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value
    )
  } catch {
    return false
  }
}

async function validateTrustedSnapshot(value: unknown): Promise<TrustedInstallSnapshotV1> {
  const source = exactTrustedRecord(value)
  const projectRef = trustedText(source, 'projectRef')
  const accountId = trustedText(source, 'accountId')
  const readGrantGeneration = trustedText(source, 'readGrantGeneration')
  const writeGrantGeneration = trustedText(source, 'writeGrantGeneration')
  const migrationName = trustedText(source, 'migrationName')
  const installSql = trustedText(source, 'installSql')
  const installReviewDigest = trustedText(source, 'installReviewDigest')
  const sourceReviewDigest = trustedText(source, 'sourceReviewDigest')
  const verificationDigest = trustedText(source, 'verificationDigest')
  const ledgerShapeDigest = trustedText(source, 'ledgerShapeDigest')
  const baseSqlDigest = trustedText(source, 'baseSqlDigest')
  const marker = trustedText(source, 'marker')
  const markerBindingDigest = trustedText(source, 'markerBindingDigest')
  const installSqlDigest = trustedText(source, 'installSqlDigest')
  const verificationQueryDigest = trustedText(source, 'verificationQueryDigest')
  if (
    !PROJECT_REF.test(projectRef) ||
    !STABLE_ID.test(accountId) ||
    !STABLE_ID.test(readGrantGeneration) ||
    !STABLE_ID.test(writeGrantGeneration) ||
    readGrantGeneration === writeGrantGeneration ||
    !MIGRATION_NAME.test(migrationName) ||
    utf8ByteLength(migrationName) >
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxMigrationNameBytes ||
    installSql.length === 0 ||
    utf8ByteLength(installSql) >
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxMigrationSQLBytes ||
    !wellFormedUTF8(installSql) ||
    ![
      installReviewDigest,
      sourceReviewDigest,
      verificationDigest,
      ledgerShapeDigest,
      baseSqlDigest,
      markerBindingDigest,
      installSqlDigest,
      verificationQueryDigest
    ].every((digest) => DIGEST.test(digest)) ||
    marker !==
      `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${markerBindingDigest}`
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  const baseSql = baseSqlFromInstallSql(installSql, marker)
  const [observedBaseSqlDigest, observedInstallSqlDigest] = await Promise.all([
    digestSql(baseSql),
    digestSql(installSql)
  ])
  if (observedBaseSqlDigest !== baseSqlDigest || observedInstallSqlDigest !== installSqlDigest) {
    return fail('invalid-request', 'not-dispatched')
  }
  return Object.freeze({
    projectRef,
    accountId,
    readGrantGeneration,
    writeGrantGeneration,
    migrationName,
    installSql,
    installReviewDigest,
    sourceReviewDigest,
    verificationDigest,
    ledgerShapeDigest,
    baseSqlDigest,
    marker,
    markerBindingDigest,
    installSqlDigest,
    verificationQueryDigest
  })
}

function credentialLeaseIdentity(value: unknown): CredentialLeaseIdentityV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-request', 'not-dispatched')
  }
  const bindingDigest = ownData(value, 'bindingDigest', 'invalid-request', 'not-dispatched')
  const writeCredentialIncarnation = ownData(
    value,
    'writeCredentialIncarnation',
    'invalid-request',
    'not-dispatched'
  )
  const operationLeaseGeneration = ownData(
    value,
    'operationLeaseGeneration',
    'invalid-request',
    'not-dispatched'
  )
  if (
    typeof bindingDigest !== 'string' ||
    !DIGEST.test(bindingDigest) ||
    typeof writeCredentialIncarnation !== 'string' ||
    !UUID_V4.test(writeCredentialIncarnation) ||
    typeof operationLeaseGeneration !== 'string' ||
    !UUID_V4.test(operationLeaseGeneration)
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  return Object.freeze({
    lease: value as SupabaseManagementDatabaseWriteCredentialLeaseV1,
    bindingDigest,
    writeCredentialIncarnation,
    operationLeaseGeneration
  })
}

function transportBinding(
  snapshot: TrustedInstallSnapshotV1,
  credential: CredentialLeaseIdentityV1
): SupabaseBackfillDatabaseCASLedgerInstallTransportBindingV1 {
  return Object.freeze({
    providerId: 'supabase' as const,
    projectRef: snapshot.projectRef,
    accountId: snapshot.accountId,
    readGrantGeneration: snapshot.readGrantGeneration,
    writeGrantGeneration: snapshot.writeGrantGeneration,
    migrationName: snapshot.migrationName,
    installReviewDigest: snapshot.installReviewDigest,
    sourceReviewDigest: snapshot.sourceReviewDigest,
    verificationDigest: snapshot.verificationDigest,
    ledgerShapeDigest: snapshot.ledgerShapeDigest,
    baseSqlDigest: snapshot.baseSqlDigest,
    marker: snapshot.marker,
    markerBindingDigest: snapshot.markerBindingDigest,
    installSqlDigest: snapshot.installSqlDigest,
    verificationQueryDigest: snapshot.verificationQueryDigest,
    credentialLeaseBindingDigest: credential.bindingDigest,
    writeCredentialIncarnation: credential.writeCredentialIncarnation,
    operationLeaseGeneration: credential.operationLeaseGeneration
  })
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): void {
  if (signal?.aborted) fail('aborted', outcome)
}

function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) {
    controller.abort(caller.reason)
  } else {
    caller?.addEventListener('abort', onCallerAbort, { once: true })
    timeout = setTimeout(() => {
      controller.abort(
        new DOMException('Supabase Management migration request timed out', 'TimeoutError')
      )
    }, timeoutMs)
  }
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Supabase Management migration request aborted', 'AbortError')
}

function waitForAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([operation, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}

async function boundedBytes(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
      return fail('response-too-large', outcome)
    }
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    let result = await waitForAbortable(reader.read(), signal)
    while (!result.done) {
      length += result.value.byteLength
      if (length > maximum) {
        void reader.cancel().catch(() => undefined)
        return fail('response-too-large', outcome)
      }
      chunks.push(result.value)
      result = await waitForAbortable(reader.read(), signal)
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError) {
      throw cause
    }
    return fail(signal.aborted ? 'aborted' : 'network-failed', outcome)
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function boundedResponse(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  url: string,
  init: RequestInit,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): Promise<BoundedResponse> {
  const deadline = requestDeadline(signal, timeoutMs)
  try {
    throwIfAborted(deadline.signal, outcome)
    let response: Response
    try {
      response = await waitForAbortable(
        fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
        deadline.signal
      )
    } catch (cause) {
      if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError) {
        throw cause
      }
      return fail(deadline.signal.aborted ? 'aborted' : 'network-failed', outcome)
    }
    throwIfAborted(deadline.signal, outcome)
    return Object.freeze({
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType: response.headers.get('content-type'),
      bytes: await boundedBytes(response, maximum, deadline.signal, outcome)
    })
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError) {
      throw cause
    }
    return fail(deadline.signal.aborted ? 'aborted' : 'network-failed', outcome)
  } finally {
    deadline.dispose()
  }
}

async function requestJSON(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportOutcome
): Promise<unknown> {
  const response = await boundedResponse(fetcher, url, init, maximum, timeoutMs, signal, outcome)
  if (response.redirected || response.url !== url || response.status !== expectedStatus) {
    return fail('http-error', outcome)
  }
  if (!response.contentType || !/^application\/json(?:\s*;.*)?$/iu.test(response.contentType)) {
    return fail('invalid-response', outcome)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes))
  } catch {
    return fail('invalid-response', outcome)
  }
}

function projectAuthority(
  value: unknown,
  expected: TrustedInstallSnapshotV1
): SupabaseManagementBackfillDatabaseCASLedgerInstallProjectAuthorityV1 {
  const project = plainRecord(value, 'not-dispatched')
  const ref = ownData(project, 'ref', 'invalid-authority', 'not-dispatched')
  const organizationId = ownData(project, 'organization_id', 'invalid-authority', 'not-dispatched')
  if (
    ref !== expected.projectRef ||
    organizationId !== expected.accountId ||
    typeof organizationId !== 'string' ||
    !STABLE_ID.test(organizationId)
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return Object.freeze({
    projectRef: expected.projectRef,
    organizationId,
    writeGrantGeneration: expected.writeGrantGeneration
  })
}

async function readProjectAuthority(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  projectURL: string,
  authorization: string,
  expected: TrustedInstallSnapshotV1,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<SupabaseManagementBackfillDatabaseCASLedgerInstallProjectAuthorityV1> {
  const value = await requestJSON(
    fetcher,
    projectURL,
    {
      method: 'GET',
      credentials: 'omit',
      headers: Object.freeze({ accept: 'application/json', authorization })
    },
    STATUS_OK,
    SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxProjectResponseBytes,
    timeoutMs,
    signal,
    'not-dispatched'
  )
  return projectAuthority(value, expected)
}

function exactEmptyObject(value: unknown): void {
  const confirmation = plainRecord(value, 'outcome-unknown')
  if (ownKeys(confirmation, 'outcome-unknown').length !== 0) {
    fail('invalid-response', 'outcome-unknown')
  }
}

function migrationAttemptFailure(cause: unknown): MigrationAttemptFailureV1 {
  return Object.freeze({
    ok: false as const,
    code:
      cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError
        ? cause.code
        : ('network-failed' as const)
  })
}

async function consumeStartedMigrationAttempt(
  responsePromise: Promise<Response>,
  migrationURL: string,
  deadline: RequestDeadline
): Promise<MigrationAttemptResultV1> {
  try {
    const response = await waitForAbortable(responsePromise, deadline.signal)
    throwIfAborted(deadline.signal, 'outcome-unknown')
    const bounded = Object.freeze({
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType: response.headers.get('content-type'),
      bytes: await boundedBytes(
        response,
        SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxMigrationResponseBytes,
        deadline.signal,
        'outcome-unknown'
      )
    })
    if (bounded.redirected || bounded.url !== migrationURL || bounded.status !== STATUS_OK) {
      return migrationAttemptFailure(
        new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(
          'http-error',
          'outcome-unknown'
        )
      )
    }
    if (!bounded.contentType || !/^application\/json(?:\s*;.*)?$/iu.test(bounded.contentType)) {
      return migrationAttemptFailure(
        new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(
          'invalid-response',
          'outcome-unknown'
        )
      )
    }
    let value: unknown
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bounded.bytes))
    } catch {
      return migrationAttemptFailure(
        new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(
          'invalid-response',
          'outcome-unknown'
        )
      )
    }
    exactEmptyObject(value)
    return Object.freeze({ ok: true as const })
  } catch (cause) {
    return migrationAttemptFailure(
      deadline.signal.aborted &&
        !(cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError)
        ? new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(
            'aborted',
            'outcome-unknown'
          )
        : cause
    )
  } finally {
    deadline.dispose()
  }
}

function startMigrationAttempt(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerInstallFetch,
  migrationURL: string,
  authorization: string,
  body: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  beforeFetcherCall: () => void,
  onFetcherReturned: () => void
): Promise<MigrationAttemptResultV1> {
  const deadline = requestDeadline(signal, timeoutMs)
  let responsePromise: Promise<Response>
  try {
    throwIfAborted(deadline.signal, 'not-dispatched')
    beforeFetcherCall()
    const started = Reflect.apply(fetcher, undefined, [
      migrationURL,
      {
        method: 'POST',
        credentials: 'omit',
        headers: Object.freeze({
          accept: 'application/json',
          authorization,
          'content-type': 'application/json'
        }),
        body,
        redirect: 'error',
        signal: deadline.signal
      },
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_LIMITS.maxMigrationResponseBytes,
      timeoutMs
    ]) as unknown
    // Returning from an injected fetcher may already have caused an external side effect even if
    // the return value violates its Promise contract. Cross the uncertainty boundary immediately.
    onFetcherReturned()
    if (!(started instanceof Promise)) {
      deadline.dispose()
      return fail('invalid-response', 'outcome-unknown')
    }
    responsePromise = started
  } catch (cause) {
    deadline.dispose()
    if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError) {
      throw cause
    }
    return fail('network-failed', 'not-dispatched')
  }
  return consumeStartedMigrationAttempt(responsePromise, migrationURL, deadline)
}

export function createSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingV1(
  options: CreateSupabaseManagementBackfillDatabaseCASLedgerInstallTransportForTestingOptionsV1
): SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1 {
  const source = exactFactoryOptions(options)
  const personalAccessToken = ownData(
    source,
    'personalAccessToken',
    'invalid-authority',
    'not-dispatched'
  )
  const configuredFetcher = ownData(source, 'fetcher', 'invalid-authority', 'not-dispatched')
  const configuredWriteGrantGeneration = ownData(
    source,
    'writeGrantGeneration',
    'invalid-authority',
    'not-dispatched'
  )
  const configuredPermitConsumer = ownData(
    source,
    'permitConsumer',
    'invalid-authority',
    'not-dispatched'
  )
  const configuredCredentialIssuer = ownData(
    source,
    'credentialIssuer',
    'invalid-authority',
    'not-dispatched'
  )
  const configuredTimeoutMs = Object.hasOwn(source, 'requestTimeoutMs')
    ? ownData(source, 'requestTimeoutMs', 'invalid-authority', 'not-dispatched')
    : undefined
  const configuredSignal = Object.hasOwn(source, 'signal')
    ? ownData(source, 'signal', 'invalid-authority', 'not-dispatched')
    : undefined
  if (
    !validPAT(personalAccessToken) ||
    typeof configuredFetcher !== 'function' ||
    (configuredSignal !== undefined && !(configuredSignal instanceof AbortSignal))
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  const credentialGeneration = stableId(configuredWriteGrantGeneration)
  const permitConsumer = testingPermitConsumer(configuredPermitConsumer)
  const credentialIssuer = testingCredentialIssuer(configuredCredentialIssuer)
  const timeoutMs = boundedTimeout(configuredTimeoutMs)
  let probePAT: string | null = personalAccessToken
  const fetcher = configuredFetcher as SupabaseManagementBackfillDatabaseCASLedgerInstallFetch
  const signal = configuredSignal
  let state: 'ready' | 'preparing' | 'prepared' | 'consumed' = 'ready'

  const currentProbePAT = (): string => {
    if (probePAT === null) return fail('invalid-authority', 'not-dispatched')
    return probePAT
  }

  const currentAuthorization = (): string => `Bearer ${currentProbePAT()}`

  const transport = Object.freeze({
    async prepareMigration(
      context: SupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1
    ): Promise<SupabaseManagementPreparedBackfillDatabaseCASLedgerInstallV1> {
      if (state !== 'ready') return fail('invalid-request', 'not-dispatched')
      state = 'preparing'
      const credentialBinding =
        deriveSupabaseBackfillDatabaseCASLedgerInstallCredentialLeaseBindingV1(context)
      if (credentialBinding === null) {
        state = 'consumed'
        probePAT = null
        return fail('invalid-request', 'not-dispatched')
      }
      let consumed: unknown
      try {
        consumed = consumeTrustedSupabaseBackfillDatabaseCASLedgerInstallDispatchContextV1(context)
      } catch {
        state = 'consumed'
        probePAT = null
        return fail('invalid-request', 'not-dispatched')
      }
      if (consumed === null) {
        state = 'consumed'
        probePAT = null
        return fail('invalid-request', 'not-dispatched')
      }
      let snapshot: TrustedInstallSnapshotV1
      try {
        snapshot = await validateTrustedSnapshot(consumed)
      } catch (cause) {
        state = 'consumed'
        probePAT = null
        throw cause
      }
      if (
        snapshot.writeGrantGeneration !== credentialGeneration ||
        credentialBinding.expectedSharedGrantGeneration !== credentialGeneration
      ) {
        state = 'consumed'
        probePAT = null
        return fail('invalid-authority', 'not-dispatched')
      }
      const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${snapshot.projectRef}`
      let authority: SupabaseManagementBackfillDatabaseCASLedgerInstallProjectAuthorityV1
      try {
        authority = await readProjectAuthority(
          fetcher,
          projectURL,
          currentAuthorization(),
          snapshot,
          timeoutMs,
          signal
        )
      } catch (cause) {
        state = 'consumed'
        probePAT = null
        throw cause
      }
      state = 'prepared'
      let dispatched = false
      let postMarked = false
      const migrationURL = `${MANAGEMENT_ORIGIN}/v1/projects/${snapshot.projectRef}/database/migrations`
      const migration = Object.freeze({
        endpoint: migrationURL,
        name: snapshot.migrationName,
        baseSqlDigest: snapshot.baseSqlDigest,
        marker: snapshot.marker,
        markerBindingDigest: snapshot.markerBindingDigest,
        installSqlDigest: snapshot.installSqlDigest,
        sqlByteLength: utf8ByteLength(snapshot.installSql),
        exactReviewedSql: true as const,
        requestBodyKeys: Object.freeze(['query', 'name'] as const),
        journalPermitRequired: true as const,
        journalPermitAvailable: true as const
      })

      return Object.freeze({
        projectAuthority: authority,
        migration,
        async dispatch(
          dispatchOptions: SupabaseManagementBackfillDatabaseCASLedgerInstallDispatchOptionsV1
        ): Promise<SupabaseManagementBackfillDatabaseCASLedgerInstallAcceptanceV1> {
          if (dispatched || state !== 'prepared') {
            return fail('dispatch-already-used', postMarked ? 'outcome-unknown' : 'not-dispatched')
          }
          dispatched = true
          state = 'consumed'
          let permitPresented = false
          let permit: unknown = null
          try {
            const dispatchSource = exactDispatchOptions(dispatchOptions)
            permit = ownData(dispatchSource, 'permit', 'invalid-request', 'not-dispatched')
            const credentialLease = ownData(
              dispatchSource,
              'credentialLease',
              'invalid-request',
              'not-dispatched'
            )
            const credentialIdentity = credentialLeaseIdentity(credentialLease)
            const binding = transportBinding(snapshot, credentialIdentity)
            let permitted: unknown = false
            permitPresented = true
            try {
              permitted = await Reflect.apply(permitConsumer.consume, permitConsumer.consumer, [
                permit,
                binding
              ])
            } catch {
              permitted = false
            }
            if (permitted !== true) return fail('journal-permit-invalid', 'not-dispatched')
            throwIfAborted(signal, 'not-dispatched')
            const currentAuthority = await readProjectAuthority(
              fetcher,
              projectURL,
              currentAuthorization(),
              snapshot,
              timeoutMs,
              signal
            )
            if (
              currentAuthority.projectRef !== authority.projectRef ||
              currentAuthority.organizationId !== authority.organizationId ||
              currentAuthority.writeGrantGeneration !== authority.writeGrantGeneration
            ) {
              return fail('invalid-authority', 'not-dispatched')
            }

            let consumedCredentialLease
            try {
              consumedCredentialLease = consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
                issuer: credentialIssuer,
                lease: credentialIdentity.lease,
                expectedBinding: credentialBinding
              })
            } catch {
              return fail('invalid-authority', 'not-dispatched')
            }

            let attempt: MigrationAttemptResultV1
            const startBoundary: {
              failureCode: SupabaseManagementBackfillDatabaseCASLedgerInstallTransportErrorCode | null
            } = { failureCode: null }
            try {
              attempt = await runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
                issuer: credentialIssuer,
                consumedLease: consumedCredentialLease,
                startRequest(currentPAT) {
                  if (currentPAT !== currentProbePAT()) {
                    return fail('invalid-authority', 'not-dispatched')
                  }
                  let request: Promise<MigrationAttemptResultV1>
                  try {
                    request = startMigrationAttempt(
                      fetcher,
                      migrationURL,
                      `Bearer ${currentPAT}`,
                      JSON.stringify({ query: snapshot.installSql, name: snapshot.migrationName }),
                      timeoutMs,
                      signal,
                      () => {
                        let marked: unknown = false
                        try {
                          marked = Reflect.apply(
                            permitConsumer.markPOSTStarted,
                            permitConsumer.consumer,
                            [permit]
                          )
                        } catch {
                          marked = false
                        }
                        if (marked !== true) fail('journal-permit-invalid', 'not-dispatched')
                        postMarked = true
                      },
                      () => {
                        // The in-flight RequestInit owns the only remaining authorization string.
                        // Drop the transport's probe before adopting the network result.
                        probePAT = null
                      }
                    )
                  } catch (cause) {
                    if (
                      cause instanceof
                      SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError
                    ) {
                      startBoundary.failureCode = cause.code
                    }
                    throw cause
                  }
                  return request
                }
              })
            } catch {
              return fail(
                postMarked
                  ? (startBoundary.failureCode ?? 'network-failed')
                  : (startBoundary.failureCode ?? 'invalid-authority'),
                postMarked ? 'outcome-unknown' : 'not-dispatched'
              )
            }
            if (!attempt.ok) return fail(attempt.code, 'outcome-unknown')
            return Object.freeze({
              status: 'verification-required' as const,
              httpStatus: STATUS_OK,
              managementRequestReturned200: true as const,
              migrationName: snapshot.migrationName,
              installReviewDigest: snapshot.installReviewDigest,
              sourceReviewDigest: snapshot.sourceReviewDigest,
              verificationDigest: snapshot.verificationDigest,
              ledgerShapeDigest: snapshot.ledgerShapeDigest,
              baseSqlDigest: snapshot.baseSqlDigest,
              marker: snapshot.marker,
              markerBindingDigest: snapshot.markerBindingDigest,
              installSqlDigest: snapshot.installSqlDigest,
              verificationQueryDigest: snapshot.verificationQueryDigest,
              databaseLedgerBound: false as const,
              sourceLedgerBound: false as const,
              releaseReady: false as const
            })
          } catch (cause) {
            const error =
              cause instanceof SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError
                ? cause
                : new SupabaseManagementBackfillDatabaseCASLedgerInstallTransportError(
                    postMarked ? 'network-failed' : 'invalid-authority',
                    postMarked ? 'outcome-unknown' : 'not-dispatched'
                  )
            if (permitPresented && !postMarked && permit !== null) {
              let proof: SupabaseBackfillDatabaseCASLedgerInstallKnownNotDispatchedProofV1 | null =
                null
              try {
                proof = Reflect.apply(
                  permitConsumer.attestKnownNotDispatched,
                  permitConsumer.consumer,
                  [permit]
                )
              } catch {
                proof = null
              }
              if (proof !== null) knownNotDispatchedProofs.set(error, proof)
            }
            throw error
          } finally {
            probePAT = null
          }
        },
        dispose(): boolean {
          if (dispatched || state !== 'prepared') return false
          dispatched = true
          state = 'consumed'
          probePAT = null
          return true
        }
      })
    }
  })
  testingInstallTransports.set(
    transport,
    Object.freeze({ permitConsumer: permitConsumer.consumer, credentialIssuer })
  )
  return transport
}

/** Exact predicate for the injectable testing seam; it never identifies a production transport. */
export function isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1(
  value: unknown
): value is SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1 {
  return value !== null && typeof value === 'object' && testingInstallTransports.has(value)
}

/** Exact testing-composition check; structural clones and cross-wired authorities are rejected. */
export function isTestingSupabaseManagementBackfillDatabaseCASLedgerInstallTransportBoundToV1(
  value: unknown,
  authority: SupabaseBackfillDatabaseCASLedgerInstallDurableAuthorityV1,
  credentialIssuer: SupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
): value is SupabaseManagementBackfillDatabaseCASLedgerInstallTransportV1 {
  if (value === null || typeof value !== 'object') return false
  const binding = testingInstallTransports.get(value)
  return (
    binding?.credentialIssuer === credentialIssuer &&
    isSupabaseBackfillDatabaseCASLedgerInstallAuthorityPermitConsumerPairV1(
      authority,
      binding.permitConsumer
    )
  )
}
