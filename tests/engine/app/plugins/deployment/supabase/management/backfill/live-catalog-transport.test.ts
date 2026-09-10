import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY,
  SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
  SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  createSupabaseManagementBackfillLiveCatalogTransport,
  SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS,
  SupabaseManagementBackfillLiveCatalogTransportError,
  type CreateSupabaseManagementBackfillLiveCatalogTransportOptions,
  type SupabaseManagementBackfillLiveCatalogFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/live-catalog-transport'

import type {
  QueryBody,
  RecordedRequest
} from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_backfill_transport_secret_canary_1234567890'
const SUBJECT_DIGEST = 'A'.repeat(43)

const AUTHORITY: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  grantGeneration: GRANT_GENERATION
})

function createTransport(
  options: Omit<CreateSupabaseManagementBackfillLiveCatalogTransportOptions, 'authority'>
) {
  return createSupabaseManagementBackfillLiveCatalogTransport({ ...options, authority: AUTHORITY })
}

type TamperedBackfillLiveCatalogParameters = Omit<
  SupabaseBackfillLiveCatalogRequestV1['parameters'],
  'projectRef'
> & {
  projectRef: string
}

type TamperedBackfillLiveCatalogRequest = Omit<
  SupabaseBackfillLiveCatalogRequestV1,
  'accessMode' | 'parameters' | 'statementCount'
> & {
  accessMode: string
  parameters: TamperedBackfillLiveCatalogParameters
  statementCount: number
  endpoint?: string
  parameterOrder?: readonly string[]
  sql?: string
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
    {
      ref: PROJECT_REF,
      organization_id: ACCOUNT_ID,
      name: 'Backfill staging',
      ...overrides
    },
    200,
    url
  )
}

async function readRequest(): Promise<SupabaseBackfillLiveCatalogRequestV1> {
  const queryDigest = await digestCanonicalManifest(SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY)
  // sql and parameterOrder intentionally stay absent. The transport owns both values.
  return {
    queryId: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
    queryDigest,
    subjectDigest: SUBJECT_DIGEST,
    ...AUTHORITY,
    statementCount: 1,
    catalogOnly: true,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    parameters: {
      schema: 'public',
      table: 'accounts',
      entityMarker: 'openpencil:v1:entity:accounts',
      cursorField: 'id',
      cursorMarker: 'openpencil:v1:field:account-id',
      primaryKeyMarker: 'openpencil:v1:primary-key:accounts',
      targetField: 'status',
      targetMarker: 'openpencil:v1:field:account-status',
      subjectDigest: SUBJECT_DIGEST,
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      queryVersion: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
      queryDigest
    }
  }
}

function successfulFetcher(
  row: Readonly<Record<string, unknown>>,
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillLiveCatalogFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET'
      ? projectResponse(url)
      : jsonResponse([row], 201, url, 'application/json; charset=utf-8')
  }
}

function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  return operation.then(
    () => undefined,
    (cause) =>
      cause instanceof SupabaseManagementBackfillLiveCatalogTransportError ? cause.code : undefined
  )
}

async function transportError(operation: Promise<unknown>) {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillLiveCatalogTransportError) return cause
  }
  throw new TypeError('Expected a typed Supabase Management backfill catalog transport error')
}

describe('Supabase Management backfill live catalog transport', () => {
  test('runs one authority GET followed by one exact fixed read-only snapshot POST', async () => {
    const row = Object.freeze({ snapshotMarker: '123:123:', proof: 'single-row' })
    const requests: RecordedRequest[] = []
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(row, requests)
    })
    const request = await readRequest()

    const authority = await transport.getProjectAuthority(AUTHORITY)
    const result = await transport.runReadOnlyBackfillCatalogQuery(request)

    expect(authority).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION
    })
    expect(Object.isFrozen(authority)).toBe(true)
    expect(result).toEqual(row)
    expect(Object.keys(transport)).toEqual([
      'getProjectAuthority',
      'runReadOnlyBackfillCatalogQuery'
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
      SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxCatalogResponseBytes
    ])
    expect(requests.map(({ timeout }) => timeout)).toEqual([30_000, 30_000])

    const serializedBody = requests[1]?.init.body
    if (typeof serializedBody !== 'string') throw new TypeError('Expected an exact JSON body')
    const body = JSON.parse(serializedBody) as QueryBody
    expect(Object.keys(body)).toEqual(['query', 'parameters'])
    expect(body.query).toBe(SUPABASE_BACKFILL_LIVE_CATALOG_SQL)
    expect(body.parameters).toEqual(
      SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER.map((key) => request.parameters[key])
    )
    expect(body.query).not.toContain(';')
    expect(body.query).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|ALTER|CREATE|DROP|TRUNCATE|LOCK)\b/iu
    )
    expect(body.query).toContain("'transaction_read_only'")
    expect(body.query).toContain('pg_is_in_recovery')
    expect(body.query).toContain('CURRENT_USER')
    expect(body.query).toContain('SESSION_USER')
    expect(body.query).toContain("'search_path'")
    expect(body.query).toContain('txid_current_snapshot')
    expect(serializedBody).not.toContain(PAT)
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[1]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(await errorCode(transport.runReadOnlyBackfillCatalogQuery(request))).toBe(
      'invalid-request'
    )
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
  })

  test('rejects SQL, parameter-order, query-binding, and extension tampering before POST', async () => {
    const mutations: ReadonlyArray<(value: TamperedBackfillLiveCatalogRequest) => void> = [
      (value) => {
        value.sql = `${SUPABASE_BACKFILL_LIVE_CATALOG_SQL};\nSELECT 1`
        value.parameterOrder = SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER
      },
      (value) => {
        value.sql = SUPABASE_BACKFILL_LIVE_CATALOG_SQL
        value.parameterOrder = [...SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER].reverse()
      },
      (value) => {
        value.statementCount = 2
      },
      (value) => {
        value.accessMode = 'read-write'
      },
      (value) => {
        value.parameters.projectRef = 'differentprojectrefaa'
      },
      (value) => {
        value.endpoint = 'https://evil.example/database/query'
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
      const request: TamperedBackfillLiveCatalogRequest = structuredClone(await readRequest())
      mutate(request)

      expect(
        await errorCode(
          transport.runReadOnlyBackfillCatalogQuery(request as SupabaseBackfillLiveCatalogRequestV1)
        )
      ).toBe('invalid-request')
      expect(postCalls).toBe(0)
    }
  })

  test('requires a fresh matching project authority and consumes each verified pair', async () => {
    const request = await readRequest()
    let calls = 0
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        calls += 1
        return init?.method === 'GET'
          ? projectResponse(String(input), { organization_id: 'foreign-account' })
          : jsonResponse([{}], 201, String(input))
      }
    })

    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-authority')
    expect(calls).toBe(1)
    expect(await errorCode(transport.runReadOnlyBackfillCatalogQuery(request))).toBe(
      'invalid-request'
    )
    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(calls).toBe(1)

    const noAuthority = createTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        throw new Error('must not dispatch')
      }
    })
    expect(await errorCode(noAuthority.runReadOnlyBackfillCatalogQuery(request))).toBe(
      'invalid-request'
    )

    let mismatchedGrantFetchCalls = 0
    const mismatchedGrant = createSupabaseManagementBackfillLiveCatalogTransport({
      personalAccessToken: PAT,
      authority: { ...AUTHORITY, grantGeneration: 'different-grant-generation' },
      fetcher: async () => {
        mismatchedGrantFetchCalls += 1
        return projectResponse()
      }
    })
    expect(await errorCode(mismatchedGrant.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(mismatchedGrantFetchCalls).toBe(0)
  })

  test('fails closed on exact status, redirect, URL, media type, and response shape', async () => {
    const request = await readRequest()
    const cases: ReadonlyArray<{
      readonly expected: string
      readonly fetcher: SupabaseManagementBackfillLiveCatalogFetch
    }> = [
      {
        expected: 'http-error',
        fetcher: async (input) => jsonResponse({}, 201, String(input))
      },
      {
        expected: 'http-error',
        fetcher: async (input) => {
          const response = projectResponse(String(input))
          Object.defineProperty(response, 'redirected', { value: true })
          return response
        }
      },
      {
        expected: 'invalid-response',
        fetcher: async (input) =>
          withURL(
            new Response('{}', {
              status: 200,
              headers: { 'content-type': 'text/plain' }
            }),
            String(input)
          )
      }
    ]
    for (const entry of cases) {
      const transport = createTransport({
        personalAccessToken: PAT,
        fetcher: entry.fetcher
      })
      expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe(entry.expected)
    }

    const postCases: ReadonlyArray<{
      readonly expected: string
      readonly response: (url: string) => Response
    }> = [
      { expected: 'http-error', response: (url) => jsonResponse([{}], 200, url) },
      {
        expected: 'http-error',
        response: () => jsonResponse([{}], 201, 'https://api.supabase.com/redirected')
      },
      {
        expected: 'invalid-response',
        response: (url) => withURL(new Response('{}', { status: 201 }), url)
      },
      { expected: 'invalid-response', response: (url) => jsonResponse([], 201, url) },
      { expected: 'invalid-response', response: (url) => jsonResponse([{}, {}], 201, url) },
      { expected: 'invalid-response', response: (url) => jsonResponse(['row'], 201, url) }
    ]
    for (const entry of postCases) {
      const transport = createTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) =>
          init?.method === 'GET' ? projectResponse(String(input)) : entry.response(String(input))
      })
      await transport.getProjectAuthority(AUTHORITY)
      expect(await errorCode(transport.runReadOnlyBackfillCatalogQuery(request))).toBe(
        entry.expected
      )
    }
  })

  test('bounds declared and streamed response bytes and rejects invalid UTF-8', async () => {
    const projectOversize = createTransport({
      personalAccessToken: PAT,
      fetcher: async () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(
              SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxProjectResponseBytes + 1
            )
          }
        })
    })
    expect(await errorCode(projectOversize.getProjectAuthority(AUTHORITY))).toBe(
      'response-too-large'
    )

    const request = await readRequest()
    let cancelled = false
    const streamedOversize = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        if (init?.method === 'GET') return projectResponse(String(input))
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new Uint8Array(
                  SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxCatalogResponseBytes + 1
                )
              )
            },
            cancel() {
              cancelled = true
            }
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        )
      }
    })
    await streamedOversize.getProjectAuthority(AUTHORITY)
    expect(await errorCode(streamedOversize.runReadOnlyBackfillCatalogQuery(request))).toBe(
      'response-too-large'
    )
    await Promise.resolve()
    expect(cancelled).toBe(true)

    const invalidUTF8 = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) =>
        init?.method === 'GET'
          ? projectResponse(String(input))
          : new Response(new Uint8Array([0xff]), {
              status: 201,
              headers: { 'content-type': 'application/json' }
            })
    })
    await invalidUTF8.getProjectAuthority(AUTHORITY)
    expect(await errorCode(invalidUTF8.runReadOnlyBackfillCatalogQuery(request))).toBe(
      'invalid-response'
    )
  })

  test('owns fetch and body deadlines while preserving caller abort semantics', async () => {
    const timedFetch = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 10,
      fetcher: () =>
        new Promise<Response>(() => {
          // Intentionally never settles; the transport deadline must win.
        })
    })
    expect(await errorCode(timedFetch.getProjectAuthority(AUTHORITY))).toBe('timeout')

    const stalledBody = (status: number) =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
        status,
        headers: { 'content-type': 'application/json' }
      })
    const timedBody = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 10,
      fetcher: async () => stalledBody(200)
    })
    expect(await errorCode(timedBody.getProjectAuthority(AUTHORITY))).toBe('timeout')

    const controller = new AbortController()
    let fetchCalls = 0
    const aborted = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 1_000,
      signal: controller.signal,
      fetcher: async () => {
        fetchCalls += 1
        return stalledBody(200)
      }
    })
    const pending = aborted.getProjectAuthority(AUTHORITY)
    controller.abort(new Error(`caller secret ${PAT}`))
    expect(await errorCode(pending)).toBe('aborted')
    expect(fetchCalls).toBe(1)

    const preAbortedController = new AbortController()
    preAbortedController.abort()
    let preAbortedFetchCalls = 0
    const preAborted = createTransport({
      personalAccessToken: PAT,
      signal: preAbortedController.signal,
      fetcher: async () => {
        preAbortedFetchCalls += 1
        return projectResponse()
      }
    })
    expect(await errorCode(preAborted.getProjectAuthority(AUTHORITY))).toBe('aborted')
    expect(preAbortedFetchCalls).toBe(0)
  })

  test('maps network failures to static typed errors without retaining secret text', async () => {
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        throw new Error(
          `provider leaked ${PAT} ${PROJECT_REF} ${SUPABASE_BACKFILL_LIVE_CATALOG_SQL}`
        )
      }
    })

    const error = await transportError(transport.getProjectAuthority(AUTHORITY))
    expect(error.code).toBe('network-failed')
    expect(error.message).toBe(
      'Supabase Management backfill catalog transport failed: network-failed.'
    )
    expect(error.message).not.toContain(PAT)
    expect(error.message).not.toContain(PROJECT_REF)
    expect(error.message).not.toContain(SUPABASE_BACKFILL_LIVE_CATALOG_SQL)
    expect(Object.hasOwn(error, 'cause')).toBe(false)
    expect(JSON.stringify(transport)).not.toContain(PAT)

    let fetchCalls = 0
    expect(() =>
      createTransport({
        personalAccessToken: 'short',
        fetcher: async () => {
          fetchCalls += 1
          return projectResponse()
        }
      })
    ).toThrow(SupabaseManagementBackfillLiveCatalogTransportError)
    expect(fetchCalls).toBe(0)
  })
})
