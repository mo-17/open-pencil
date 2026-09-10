/* oxlint-disable eslint(max-lines) -- One transport threat matrix stays auditable in one fixture. */

import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA } from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL,
  type SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/verifier'
import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport,
  SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS,
  SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError,
  type CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions,
  type SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/database-cas-ledger-verification-transport'

import type {
  QueryBody,
  RecordedRequest
} from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_database_cas_ledger_verification_secret_canary_1234567890'
const REVIEW_DIGEST = 'A'.repeat(43)
const LEDGER_SHAPE_DIGEST = 'B'.repeat(43)
const SQL_DIGEST = 'C'.repeat(43)

const AUTHORITY: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  grantGeneration: GRANT_GENERATION
})

interface MutableVerificationParameters {
  schemaName: unknown
  reviewDigest: unknown
  ledgerShapeDigest: unknown
  sqlDigest: unknown
  projectRef: unknown
  accountId: unknown
  grantGeneration: unknown
  queryVersion: unknown
  queryDigest: unknown
  extension?: unknown
}

interface MutableVerificationRequest {
  queryId: unknown
  queryVersion: unknown
  queryDigest: unknown
  reviewDigest: unknown
  ledgerShapeDigest: unknown
  sqlDigest: unknown
  projectRef: unknown
  accountId: unknown
  grantGeneration: unknown
  statementCount: unknown
  catalogOnly: unknown
  managedDataRead: unknown
  accessMode: unknown
  snapshotScope: unknown
  parameters: MutableVerificationParameters
  sql?: unknown
  endpoint?: unknown
}

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(
  value: unknown,
  status: number,
  url = '',
  contentType = 'application/json'
): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType }
  })
  return url ? withURL(response, url) : response
}

function projectResponse(
  url = `https://api.supabase.com/v1/projects/${PROJECT_REF}`,
  overrides: Readonly<Record<string, unknown>> = {}
): Response {
  return jsonResponse(
    { ref: PROJECT_REF, organization_id: ACCOUNT_ID, name: 'CAS ledger staging', ...overrides },
    200,
    url
  )
}

async function verificationRequest(): Promise<SupabaseBackfillDatabaseCASLedgerVerificationRequestV1> {
  const queryDigest = await digestCanonicalManifest(
    SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_FIXED_QUERY
  )
  return {
    queryId: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
    queryDigest,
    reviewDigest: REVIEW_DIGEST,
    ledgerShapeDigest: LEDGER_SHAPE_DIGEST,
    sqlDigest: SQL_DIGEST,
    ...AUTHORITY,
    statementCount: 1,
    catalogOnly: true,
    managedDataRead: false,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    parameters: {
      schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
      reviewDigest: REVIEW_DIGEST,
      ledgerShapeDigest: LEDGER_SHAPE_DIGEST,
      sqlDigest: SQL_DIGEST,
      ...AUTHORITY,
      queryVersion: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_QUERY_VERSION,
      queryDigest
    }
  }
}

function mutableVerificationRequest(
  value: SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
): MutableVerificationRequest {
  const cloned = structuredClone(value)
  return { ...cloned, parameters: { ...cloned.parameters } }
}

function createTransport(
  options: Omit<
    CreateSupabaseManagementBackfillDatabaseCASLedgerVerificationTransportOptions,
    'authority'
  >
) {
  return createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport({
    ...options,
    authority: AUTHORITY
  })
}

function successfulFetcher(
  row: Readonly<Record<string, unknown>>,
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET'
      ? projectResponse(url)
      : jsonResponse([row], 201, url, 'application/json; charset=utf-8')
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
  } catch (cause) {
    return cause instanceof SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError
      ? cause.code
      : undefined
  }
  return undefined
}

describe('Supabase Management database CAS ledger verification transport', () => {
  test('performs one authority GET then one exact fixed 201 query and is permanently consumed', async () => {
    const requests: RecordedRequest[] = []
    const row = Object.freeze({ snapshotMarker: '100:100:', proof: 'catalog-only' })
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(row, requests)
    })
    const request = await verificationRequest()

    const authority = await transport.getProjectAuthority(AUTHORITY)
    const result = await transport.runReadOnlyDatabaseCASLedgerVerificationQuery(request)

    expect(authority).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION
    })
    expect(Object.isFrozen(authority)).toBe(true)
    expect(result).toEqual(row)
    expect(Object.keys(transport)).toEqual([
      'getProjectAuthority',
      'runReadOnlyDatabaseCASLedgerVerificationQuery'
    ])
    expect(Object.isFrozen(transport)).toBe(true)
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'POST'])
    expect(requests.map(({ url }) => url)).toEqual([
      `https://api.supabase.com/v1/projects/${PROJECT_REF}`,
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`
    ])
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
    expect(requests.map(({ maximum }) => maximum)).toEqual([
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxVerificationResponseBytes
    ])
    expect(requests.map(({ timeout }) => timeout)).toEqual([30_000, 30_000])

    const serializedBody = requests[1]?.init.body
    if (typeof serializedBody !== 'string') throw new TypeError('Expected fixed JSON body')
    const body = JSON.parse(serializedBody) as QueryBody
    expect(Object.keys(body)).toEqual(['query', 'parameters'])
    expect(body.query).toBe(SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL)
    expect(body.parameters).toEqual(
      SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_PARAMETER_ORDER.map(
        (key) => request.parameters[key]
      )
    )
    expect(body.query).not.toContain(';')
    expect(body.query).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|ALTER|CREATE|DROP|TRUNCATE|LOCK)\b/iu
    )
    expect(serializedBody).not.toContain(PAT)
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[1]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(await errorCode(transport.runReadOnlyDatabaseCASLedgerVerificationQuery(request))).toBe(
      'invalid-request'
    )
    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
  })

  test('rejects query, digest, authority, parameter, and extension tampering before POST', async () => {
    const mutations: ReadonlyArray<(value: MutableVerificationRequest) => void> = [
      (value) => {
        value.queryDigest = 'Z'.repeat(43)
      },
      (value) => {
        value.statementCount = 2
      },
      (value) => {
        value.managedDataRead = true
      },
      (value) => {
        value.accessMode = 'read-write'
      },
      (value) => {
        value.projectRef = 'differentprojectrefaa'
      },
      (value) => {
        value.parameters.reviewDigest = 'Z'.repeat(43)
      },
      (value) => {
        value.parameters.schemaName = 'public'
      },
      (value) => {
        value.parameters.extension = 'not-allowed'
      },
      (value) => {
        value.sql = `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_SQL}; SELECT 1`
      },
      (value) => {
        value.endpoint = 'https://evil.example/database/query/read-only'
      }
    ]

    for (const mutate of mutations) {
      let postCalls = 0
      const transport = createTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          if (init?.method === 'POST') postCalls += 1
          return projectResponse(String(input))
        }
      })
      await transport.getProjectAuthority(AUTHORITY)
      const request = mutableVerificationRequest(await verificationRequest())
      mutate(request)
      expect(
        await errorCode(
          transport.runReadOnlyDatabaseCASLedgerVerificationQuery(
            request as SupabaseBackfillDatabaseCASLedgerVerificationRequestV1
          )
        )
      ).toBe('invalid-request')
      expect(postCalls).toBe(0)
      expect(
        await errorCode(
          transport.runReadOnlyDatabaseCASLedgerVerificationQuery(await verificationRequest())
        )
      ).toBe('invalid-request')
    }
  })

  test('binds exact project organization and grant before allowing the query', async () => {
    let calls = 0
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input) => {
        calls += 1
        return projectResponse(String(input), { organization_id: 'foreign-account' })
      }
    })
    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-authority')
    expect(calls).toBe(1)
    expect(
      await errorCode(
        transport.runReadOnlyDatabaseCASLedgerVerificationQuery(await verificationRequest())
      )
    ).toBe('invalid-request')
    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(calls).toBe(1)

    let mismatchedCalls = 0
    const mismatched = createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport({
      personalAccessToken: PAT,
      authority: { ...AUTHORITY, grantGeneration: 'different-grant' },
      fetcher: async () => {
        mismatchedCalls += 1
        return projectResponse()
      }
    })
    expect(await errorCode(mismatched.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(mismatchedCalls).toBe(0)
  })

  test('fails closed on status, redirects, media type, row shape, byte bounds, abort, and timeout', async () => {
    const request = await verificationRequest()
    const authorityCases: ReadonlyArray<{
      readonly expected: string
      readonly fetcher: SupabaseManagementBackfillDatabaseCASLedgerVerificationFetch
    }> = [
      { expected: 'http-error', fetcher: async (input) => jsonResponse({}, 201, String(input)) },
      {
        expected: 'http-error',
        fetcher: async (input) => {
          const response = projectResponse(String(input))
          Object.defineProperty(response, 'redirected', { value: true })
          return response
        }
      },
      {
        expected: 'http-error',
        fetcher: async () => projectResponse('https://api.supabase.com/redirected')
      },
      {
        expected: 'invalid-response',
        fetcher: async (input) =>
          withURL(
            new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } }),
            String(input)
          )
      }
    ]
    for (const current of authorityCases) {
      const transport = createTransport({ personalAccessToken: PAT, fetcher: current.fetcher })
      expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe(current.expected)
    }

    const queryCases: ReadonlyArray<{
      readonly expected: string
      readonly response: (url: string) => Response
    }> = [
      { expected: 'http-error', response: (url) => jsonResponse([{}], 200, url) },
      {
        expected: 'invalid-response',
        response: (url) => jsonResponse([{}], 201, url, 'text/plain')
      },
      { expected: 'invalid-response', response: (url) => jsonResponse([], 201, url) },
      { expected: 'invalid-response', response: (url) => jsonResponse([{}, {}], 201, url) },
      {
        expected: 'response-too-large',
        response: (url) => {
          const response = jsonResponse([{}], 201, url)
          response.headers.set(
            'content-length',
            String(
              SUPABASE_MANAGEMENT_BACKFILL_DATABASE_CAS_LEDGER_VERIFICATION_LIMITS.maxVerificationResponseBytes +
                1
            )
          )
          return response
        }
      }
    ]
    for (const current of queryCases) {
      const transport = createTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) =>
          init?.method === 'GET' ? projectResponse(String(input)) : current.response(String(input))
      })
      await transport.getProjectAuthority(AUTHORITY)
      expect(
        await errorCode(transport.runReadOnlyDatabaseCASLedgerVerificationQuery(request))
      ).toBe(current.expected)
    }

    const caller = new AbortController()
    caller.abort()
    const aborted = createTransport({
      personalAccessToken: PAT,
      signal: caller.signal,
      fetcher: async () => projectResponse()
    })
    expect(await errorCode(aborted.getProjectAuthority(AUTHORITY))).toBe('aborted')

    const timedOut = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 5,
      fetcher: () =>
        new Promise<Response>(() => {
          void 0
        })
    })
    expect(await errorCode(timedOut.getProjectAuthority(AUTHORITY))).toBe('timeout')
  })

  test('rejects invalid credentials and hostile option accessors without disclosing the PAT', async () => {
    for (const personalAccessToken of [
      '',
      'short',
      `valid\n${'x'.repeat(20)}`,
      'x'.repeat(4_097)
    ]) {
      expect(() =>
        createTransport({
          personalAccessToken,
          fetcher: async () => {
            throw new Error('must not run')
          }
        })
      ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError)
    }

    let getterCalls = 0
    const hostile = { authority: AUTHORITY, fetcher: async () => projectResponse() }
    Object.defineProperty(hostile, 'personalAccessToken', {
      enumerable: true,
      get() {
        getterCalls += 1
        return PAT
      }
    })
    expect(() =>
      createSupabaseManagementBackfillDatabaseCASLedgerVerificationTransport(hostile as never)
    ).toThrow(SupabaseManagementBackfillDatabaseCASLedgerVerificationTransportError)
    expect(getterCalls).toBe(0)

    try {
      createTransport({ personalAccessToken: 'short', fetcher: async () => projectResponse() })
    } catch (cause) {
      expect(String(cause)).not.toContain(PAT)
    }
  })
})
