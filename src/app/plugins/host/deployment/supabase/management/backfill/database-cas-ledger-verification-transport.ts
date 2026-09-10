/* oxlint-disable eslint(max-lines) -- Transport validation and bounded response handling remain co-located. */

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
  type SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import type {
  SupabaseBackfillLiveCatalogAuthorityV1,
  SupabaseBackfillLiveCatalogProjectAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

import {
  createBackfillReadDeadline,
  discardUnreadBackfillResponse,
  readBackfillJSON,
  waitForBackfillRead
} from './read-response-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
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

function fail(
  code: SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportErrorCode
): never {
  throw new SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError(code)
}

function ownData(
  value: object,
  key: PropertyKey,
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response'
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function ownKeys(
  value: object,
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response'
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
}

function plainRecord(
  value: unknown,
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response'
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail(code)
  }
  if (prototype !== Object.prototype && prototype !== null) return fail(code)
  return value as UnknownRecord
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
  if (value === undefined) {
    return SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.requestTimeoutMs
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) >
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.requestTimeoutMs
  ) {
    return fail('invalid-authority')
  }
  return value as number
}

function validPAT(value: string): boolean {
  return (
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <=
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxPATBytes &&
    !/\p{Cc}/u.test(value)
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

function sameAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function validateRequestMetadata(source: UnknownRecord): void {
  if (
    ownData(source, 'queryId', 'invalid-request') !==
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID ||
    ownData(source, 'queryVersion', 'invalid-request') !==
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION ||
    ownData(source, 'statementCount', 'invalid-request') !== 1 ||
    ownData(source, 'catalogOnly', 'invalid-request') !== true ||
    ownData(source, 'managedDataRead', 'invalid-request') !== false ||
    ownData(source, 'accessMode', 'invalid-request') !== 'read-only' ||
    ownData(source, 'snapshotScope', 'invalid-request') !== 'single-statement'
  ) {
    fail('invalid-request')
  }
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
  for (const key of ['projectRef', 'accountId', 'grantGeneration'] as const) {
    if (ownData(source, key, 'invalid-request') !== expectedAuthority[key]) {
      return fail('invalid-request')
    }
  }
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

async function requestJSON(
  fetcher: SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined
): Promise<unknown> {
  if (callerSignal?.aborted) return fail('aborted')
  const deadline = createBackfillReadDeadline(
    callerSignal,
    timeoutMs,
    'Database CAS ledger verification timed out'
  )
  try {
    const response = await waitForBackfillRead(
      fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
      deadline.signal,
      READ_ABORT_MESSAGE
    )
    if (
      response.redirected ||
      (response.url !== '' && response.url !== url) ||
      response.status !== expectedStatus
    ) {
      discardUnreadBackfillResponse(response)
      return fail('http-error')
    }
    return await readBackfillJSON(response, maximum, deadline.signal, {
      abortMessage: READ_ABORT_MESSAGE,
      fail
    })
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError) {
      throw cause
    }
    if (deadline.timedOut()) return fail('timeout')
    if (callerSignal?.aborted) return fail('aborted')
    return fail('network-failed')
  } finally {
    deadline.dispose()
  }
}

function parseProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): SupabaseBackfillLiveCatalogProjectAuthorityV1 {
  const project = plainRecord(value, 'invalid-response')
  const ref = ownData(project, 'ref', 'invalid-response')
  const accountId = ownData(project, 'organization_id', 'invalid-response')
  if (ref !== expected.projectRef || accountId !== expected.accountId) {
    return fail('invalid-authority')
  }
  return Object.freeze({
    projectRef: expected.projectRef,
    organizationId: expected.accountId,
    grantGeneration: expected.grantGeneration
  })
}

function parseSingleVerificationRow(value: unknown): UnknownRecord {
  if (!Array.isArray(value) || value.length !== 1) return fail('invalid-response')
  const keys = ownKeys(value, 'invalid-response')
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail('invalid-response')
  }
  if (
    keys.length !== 2 ||
    !keys.includes('0') ||
    !keys.includes('length') ||
    lengthDescriptor?.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== 1
  ) {
    return fail('invalid-response')
  }
  return plainRecord(ownData(value, '0', 'invalid-response'), 'invalid-response')
}

export function createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport(
  rawOptions: CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions
): SupabaseBackfillDatabaseCASLedgerVerificationHostTransportV1 {
  const options = optionSnapshot(rawOptions)
  if (!validPAT(options.personalAccessToken)) fail('invalid-authority')
  const boundAuthority = validateAuthority(options.authority, 'invalid-authority')
  const timeoutMs = boundedTimeout(options.requestTimeoutMs)
  const authorization = `Bearer ${options.personalAccessToken}`
  const fetcher = options.fetcher
  const signal = options.signal
  let state: 'ready' | 'authority-pending' | 'verified' | 'query-pending' | 'consumed' = 'ready'
  let verifiedAuthority: SupabaseBackfillLiveCatalogAuthorityV1 | null = null

  return Object.freeze({
    async getProjectAuthority(request: SupabaseBackfillLiveCatalogAuthorityV1): Promise<unknown> {
      if (state !== 'ready') return fail('invalid-request')
      const expected = validateAuthority(request, 'invalid-request')
      if (!sameAuthority(expected, boundAuthority)) return fail('invalid-request')
      state = 'authority-pending'
      try {
        const url = `${MANAGEMENT_ORIGIN}/v1/projects/${expected.projectRef}`
        const value = await requestJSON(
          fetcher,
          url,
          {
            method: 'GET',
            credentials: 'omit',
            headers: Object.freeze({ accept: 'application/json', authorization })
          },
          200,
          SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxProjectResponseBytes,
          timeoutMs,
          signal
        )
        const projectAuthority = parseProjectAuthority(value, expected)
        verifiedAuthority = expected
        state = 'verified'
        return projectAuthority
      } catch (cause) {
        state = 'consumed'
        throw cause
      }
    },

    async runReadOnlyDatabaseCASLedgerVerificationQuery(
      request: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
    ): Promise<unknown> {
      if (state !== 'verified' || verifiedAuthority === null) return fail('invalid-request')
      const expected = verifiedAuthority
      state = 'query-pending'
      verifiedAuthority = null
      try {
        const parameters = await validatedQueryParameters(request, expected)
        const url = `${MANAGEMENT_ORIGIN}/v1/projects/${expected.projectRef}/database/query/read-only`
        const value = await requestJSON(
          fetcher,
          url,
          {
            method: 'POST',
            credentials: 'omit',
            headers: Object.freeze({
              accept: 'application/json',
              authorization,
              'content-type': 'application/json'
            }),
            body: JSON.stringify({
              query: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
              parameters
            })
          },
          201,
          SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxVerificationResponseBytes,
          timeoutMs,
          signal
        )
        return parseSingleVerificationRow(value)
      } finally {
        state = 'consumed'
      }
    }
  })
}
