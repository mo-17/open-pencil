import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
/* oxlint-disable eslint(max-lines) -- Transport validation and bounded response handling remain co-located. */
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import { createSupabaseDataAdmission } from '@/app/plugins/host/deployment/supabase/data-admission'

import { isSupabaseManagementToken, supabaseManagementTimeout } from '../transport-runtime'
import { createBackfillCatalogSession } from './catalog-session'
import { createBackfillQueryAdmission } from './query-admission'
import { createBackfillJSONRequester } from './read-response-runtime'

const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u

export const SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxVerificationResponseBytes: 512 * 1024,
  requestTimeoutMs: 30_000
})

export type SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'
  | 'timeout'

export class SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError extends Error {
  constructor(
    readonly code: SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportErrorCode
  ) {
    super(
      `Supabase Management backfill database CAS ledger verification transport failed: ${code}.`
    )
    this.name = 'SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError'
  }
}

export interface CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions {
  /** Ephemeral runtime value. A transport is deliberately single-use. */
  readonly personalAccessToken: string
  /** Vault authority generation resolved atomically with the ephemeral PAT. */
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly fetcher: SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch
  readonly signal?: AbortSignal
  /** Tests may shorten, but callers may never extend, the Host deadline. */
  readonly requestTimeoutMs?: number
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

const REQUEST_KEYS = Object.freeze([
  'queryId',
  'queryVersion',
  'queryDigest',
  'reviewDigest',
  'ledgerShapeDigest',
  'sqlDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'statementCount',
  'catalogOnly',
  'managedDataRead',
  'accessMode',
  'snapshotScope',
  'parameters'
] as const)

const dataAdmission = createSupabaseDataAdmission(fail)
const { ownData, ownKeys, plainRecord } = dataAdmission

const queryAdmission = createBackfillQueryAdmission(fail)

function fail(
  code: SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportErrorCode
): never {
  throw new SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError(code)
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response'
): UnknownRecord {
  const source = plainRecord(value, code)
  const actual = ownKeys(source, code)
  if (
    actual.length !== keys.length ||
    actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code)
  }
  for (const key of keys) ownData(source, key, code)
  return source
}

function optionSnapshot(
  value: unknown
): CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions {
  const source = plainRecord(value, 'invalid-authority')
  const allowed = [
    'personalAccessToken',
    'authority',
    'fetcher',
    'signal',
    'requestTimeoutMs'
  ] as const
  const keys = ownKeys(source, 'invalid-authority')
  if (
    keys.length < 3 ||
    keys.length > allowed.length ||
    keys.some((key) => typeof key !== 'string' || !allowed.includes(key as never)) ||
    !['personalAccessToken', 'authority', 'fetcher'].every((key) => keys.includes(key))
  ) {
    return fail('invalid-authority')
  }
  const personalAccessToken = ownData(source, 'personalAccessToken', 'invalid-authority')
  const authority = ownData(source, 'authority', 'invalid-authority')
  const fetcher = ownData(source, 'fetcher', 'invalid-authority')
  const signal = keys.includes('signal')
    ? ownData(source, 'signal', 'invalid-authority')
    : undefined
  const requestTimeoutMs = keys.includes('requestTimeoutMs')
    ? ownData(source, 'requestTimeoutMs', 'invalid-authority')
    : undefined
  if (
    typeof personalAccessToken !== 'string' ||
    authority === null ||
    typeof authority !== 'object' ||
    typeof fetcher !== 'function' ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) {
    return fail('invalid-authority')
  }
  return Object.freeze({
    personalAccessToken,
    authority: authority as SupabaseBackfillLiveCatalogAuthorityV1,
    fetcher: fetcher as SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch,
    ...(signal === undefined ? {} : { signal }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs: requestTimeoutMs as number })
  })
}

function boundedTimeout(value: unknown): number {
  return supabaseManagementTimeout(
    value,
    SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.requestTimeoutMs,
    () => fail('invalid-authority')
  )
}

function validPAT(value: string): boolean {
  return isSupabaseManagementToken(
    value,
    SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxPATBytes
  )
}

function stableId(value: unknown, code: 'invalid-authority' | 'invalid-request'): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) return fail(code)
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail('invalid-request')
  return value
}

function validateAuthority(
  value: unknown,
  code: 'invalid-authority' | 'invalid-request'
): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = exactRecord(value, ['projectRef', 'accountId', 'grantGeneration'], code)
  const projectRef = ownData(source, 'projectRef', code)
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef)) return fail(code)
  return Object.freeze({
    projectRef,
    accountId: stableId(ownData(source, 'accountId', code), code),
    grantGeneration: stableId(ownData(source, 'grantGeneration', code), code)
  })
}

function validateRequestMetadata(source: UnknownRecord): void {
  queryAdmission.metadata(
    source,
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
    false
  )
}

interface ParsedVerificationParameters {
  readonly schemaName: unknown
  readonly reviewDigest: string
  readonly ledgerShapeDigest: string
  readonly sqlDigest: string
  readonly projectRef: unknown
  readonly accountId: unknown
  readonly grantGeneration: unknown
  readonly queryVersion: unknown
  readonly queryDigest: string
}

function validateParameterBindings(
  parsed: ParsedVerificationParameters,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1,
  expected: Readonly<{
    reviewDigest: string
    ledgerShapeDigest: string
    sqlDigest: string
    queryDigest: string
  }>
): void {
  if (
    parsed.schemaName !== SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA ||
    parsed.reviewDigest !== expected.reviewDigest ||
    parsed.ledgerShapeDigest !== expected.ledgerShapeDigest ||
    parsed.sqlDigest !== expected.sqlDigest ||
    parsed.projectRef !== expectedAuthority.projectRef ||
    parsed.accountId !== expectedAuthority.accountId ||
    parsed.grantGeneration !== expectedAuthority.grantGeneration ||
    parsed.queryVersion !== SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION ||
    parsed.queryDigest !== expected.queryDigest
  ) {
    fail('invalid-request')
  }
}

async function validatedQueryParameters(
  value: unknown,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<readonly unknown[]> {
  const source = exactRecord(value, REQUEST_KEYS, 'invalid-request')
  validateRequestMetadata(source)
  const queryDigest = digest(ownData(source, 'queryDigest', 'invalid-request'))
  const reviewDigest = digest(ownData(source, 'reviewDigest', 'invalid-request'))
  const ledgerShapeDigest = digest(ownData(source, 'ledgerShapeDigest', 'invalid-request'))
  const sqlDigest = digest(ownData(source, 'sqlDigest', 'invalid-request'))
  let expectedQueryDigest: string
  try {
    expectedQueryDigest = await digestCanonicalManifest(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY
    )
  } catch {
    return fail('invalid-request')
  }
  if (queryDigest !== expectedQueryDigest) return fail('invalid-request')
  queryAdmission.authority(source, expectedAuthority)
  const parameters = exactRecord(
    ownData(source, 'parameters', 'invalid-request'),
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
    'invalid-request'
  )
  const parsed = Object.freeze({
    schemaName: ownData(parameters, 'schemaName', 'invalid-request'),
    reviewDigest: digest(ownData(parameters, 'reviewDigest', 'invalid-request')),
    ledgerShapeDigest: digest(ownData(parameters, 'ledgerShapeDigest', 'invalid-request')),
    sqlDigest: digest(ownData(parameters, 'sqlDigest', 'invalid-request')),
    projectRef: ownData(parameters, 'projectRef', 'invalid-request'),
    accountId: ownData(parameters, 'accountId', 'invalid-request'),
    grantGeneration: ownData(parameters, 'grantGeneration', 'invalid-request'),
    queryVersion: ownData(parameters, 'queryVersion', 'invalid-request'),
    queryDigest: digest(ownData(parameters, 'queryDigest', 'invalid-request'))
  })
  validateParameterBindings(parsed, expectedAuthority, {
    reviewDigest,
    ledgerShapeDigest,
    sqlDigest,
    queryDigest
  })
  return Object.freeze(
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER.map((key) => parsed[key])
  )
}

const READ_ABORT_MESSAGE = 'Supabase database CAS ledger verification aborted'

const requestJSON = createBackfillJSONRequester({
  abortMessage: READ_ABORT_MESSAGE,
  timeoutMessage: 'Database CAS ledger verification timed out',
  ownsError: (cause) =>
    cause instanceof SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError,
  fail
})

function parseSingleVerificationRow(value: unknown): UnknownRecord {
  return plainRecord(dataAdmission.singleItem(value, 'invalid-response'), 'invalid-response')
}

export function createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport(
  rawOptions: CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  const options = optionSnapshot(rawOptions)
  if (!validPAT(options.personalAccessToken)) fail('invalid-authority')
  const boundAuthority = validateAuthority(options.authority, 'invalid-authority')
  const timeoutMs = boundedTimeout(options.requestTimeoutMs)
  const session =
    createBackfillCatalogSession<SupabaseBackfillDatabaseCASLedgerVerificationRequestV1>(
      boundAuthority,
      options,
      timeoutMs,
      {
        requestJSON,
        validateAuthority: (value) => validateAuthority(value, 'invalid-request'),
        validatedQueryParameters,
        parseRow: parseSingleVerificationRow,
        fail,
        sql: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
        maxProjectResponseBytes:
          SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxProjectResponseBytes,
        maxQueryResponseBytes:
          SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxVerificationResponseBytes
      }
    )
  return Object.freeze({
    getProjectAuthority: session.getProjectAuthority,
    runReadOnlyDatabaseCASLedgerVerificationQuery: session.runQuery
  })
}
