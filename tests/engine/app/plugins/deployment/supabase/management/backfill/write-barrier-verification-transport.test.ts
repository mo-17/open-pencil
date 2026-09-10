/* eslint-disable max-lines -- one transport threat matrix stays auditable in one fixture */

import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseBackfillLiveCatalogAuthorityV1 } from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'
import {
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
  SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL,
  type SupabaseBackfillWriteBarrierVerificationRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/verifier'
import {
  createSupabaseManagementBackfillWriteBarrierVerificationTransport,
  SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS,
  SupabaseManagementBackfillWriteBarrierVerificationTransportError,
  type CreateSupabaseManagementBackfillWriteBarrierVerificationTransportOptions,
  type SupabaseManagementBackfillWriteBarrierVerificationFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-verification-transport'

import type {
  QueryBody,
  RecordedRequest
} from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account-1'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_backfill_write_barrier_verification_secret_canary_1234567890'
const SUBJECT_DIGEST = 'A'.repeat(43)
const REVIEW_DIGEST = 'B'.repeat(43)

const AUTHORITY: SupabaseBackfillLiveCatalogAuthorityV1 = Object.freeze({
  projectRef: PROJECT_REF,
  accountId: ACCOUNT_ID,
  grantGeneration: GRANT_GENERATION
})

function createTransport(
  options: Omit<
    CreateSupabaseManagementBackfillWriteBarrierVerificationTransportOptions,
    'authority'
  >
) {
  return createSupabaseManagementBackfillWriteBarrierVerificationTransport({
    ...options,
    authority: AUTHORITY
  })
}

type TamperedVerificationParameters = Omit<
  SupabaseBackfillWriteBarrierVerificationRequestV1['parameters'],
  'projectRef' | 'reviewDigest' | 'targetSubId'
> & {
  projectRef: string
  reviewDigest: string
  targetSubId: number
  extension?: string
}

type TamperedVerificationRequest = Omit<
  SupabaseBackfillWriteBarrierVerificationRequestV1,
  'accessMode' | 'parameters' | 'queryDigest' | 'reviewDigest' | 'statementCount'
> & {
  accessMode: string
  parameters: TamperedVerificationParameters
  queryDigest: string
  reviewDigest: string
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
      name: 'Backfill barrier staging',
      ...overrides
    },
    200,
    url
  )
}

async function verificationRequest(): Promise<SupabaseBackfillWriteBarrierVerificationRequestV1> {
  const queryDigest = await digestCanonicalManifest(
    SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY
  )
  return {
    queryId: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
    queryDigest,
    subjectDigest: SUBJECT_DIGEST,
    reviewDigest: REVIEW_DIGEST,
    ...AUTHORITY,
    statementCount: 1,
    catalogOnly: true,
    accessMode: 'read-only',
    snapshotScope: 'single-statement',
    parameters: {
      schema: 'public',
      table: 'accounts',
      entityMarker: 'openpencil:v1:entity:accounts',
      tableOid: '16384',
      targetField: 'status',
      targetMarker: 'openpencil:v1:field:account-status',
      targetSubId: 4,
      targetTypeOid: '25',
      constraintName: 'openpencil_accounts_status_not_null',
      barrierMarker: 'openpencil:v1:backfill-write-barrier:accounts:status',
      subjectDigest: SUBJECT_DIGEST,
      reviewDigest: REVIEW_DIGEST,
      projectRef: PROJECT_REF,
      accountId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION,
      queryVersion: SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_QUERY_VERSION,
      queryDigest
    }
  }
}

function successfulFetcher(
  row: Readonly<Record<string, unknown>>,
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillWriteBarrierVerificationFetch {
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
      cause instanceof SupabaseManagementBackfillWriteBarrierVerificationTransportError
        ? cause.code
        : undefined
  )
}

async function transportError(operation: Promise<unknown>) {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillWriteBarrierVerificationTransportError) {
      return cause
    }
  }
  throw new TypeError('Expected a typed write-barrier verification transport error')
}

describe('Supabase Management backfill write-barrier verification transport', () => {
  test('runs one authority GET followed by one exact fixed read-only verification POST', async () => {
    const row = Object.freeze({ snapshotMarker: '123:123:', proof: 'single-row' })
    const requests: RecordedRequest[] = []
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(row, requests)
    })
    const request = await verificationRequest()

    const authority = await transport.getProjectAuthority(AUTHORITY)
    const result = await transport.runReadOnlyWriteBarrierVerificationQuery(request)

    expect(authority).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ACCOUNT_ID,
      grantGeneration: GRANT_GENERATION
    })
    expect(Object.isFrozen(authority)).toBe(true)
    expect(result).toEqual(row)
    expect(Object.keys(transport)).toEqual([
      'getProjectAuthority',
      'runReadOnlyWriteBarrierVerificationQuery'
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
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxVerificationResponseBytes
    ])
    expect(requests.map(({ timeout }) => timeout)).toEqual([30_000, 30_000])

    const serializedBody = requests[1]?.init.body
    if (typeof serializedBody !== 'string') throw new TypeError('Expected an exact JSON body')
    const body = JSON.parse(serializedBody) as QueryBody
    expect(Object.keys(body)).toEqual(['query', 'parameters'])
    expect(body.query).toBe(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL)
    expect(body.parameters).toEqual(
      SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER.map(
        (key) => request.parameters[key]
      )
    )
    expect(request.queryDigest).toBe(
      await digestCanonicalManifest(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_FIXED_QUERY)
    )
    expect(body.query).not.toContain(';')
    expect(body.query).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|COPY|ALTER|CREATE|DROP|TRUNCATE|LOCK)\b/iu
    )
    expect(body.query).toContain('pg_catalog')
    expect(body.query).toContain('txid_current_snapshot')
    expect(serializedBody).not.toContain(PAT)
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[1]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(await errorCode(transport.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
      'invalid-request'
    )
    expect(await errorCode(transport.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
  })

  test('rejects SQL, order, digest, authority, parameter, and extension tampering before POST', async () => {
    const mutations: ReadonlyArray<(value: TamperedVerificationRequest) => void> = [
      (value) => {
        value.sql = `${SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL};\nSELECT 1`
        value.parameterOrder = SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER
      },
      (value) => {
        value.sql = SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL
        value.parameterOrder = [
          ...SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_PARAMETER_ORDER
        ].reverse()
      },
      (value) => {
        value.statementCount = 2
      },
      (value) => {
        value.accessMode = 'read-write'
      },
      (value) => {
        value.queryDigest = 'C'.repeat(43)
      },
      (value) => {
        value.reviewDigest = 'C'.repeat(43)
      },
      (value) => {
        value.parameters.projectRef = 'differentprojectrefaa'
      },
      (value) => {
        value.parameters.reviewDigest = 'C'.repeat(43)
      },
      (value) => {
        value.parameters.targetSubId = 0
      },
      (value) => {
        value.parameters.extension = 'not-allowed'
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
      const request = structuredClone(await verificationRequest()) as TamperedVerificationRequest
      mutate(request)

      expect(
        await errorCode(
          transport.runReadOnlyWriteBarrierVerificationQuery(
            request as SupabaseBackfillWriteBarrierVerificationRequestV1
          )
        )
      ).toBe('invalid-request')
      expect(postCalls).toBe(0)
      expect(
        await errorCode(
          transport.runReadOnlyWriteBarrierVerificationQuery(await verificationRequest())
        )
      ).toBe('invalid-request')
    }
  })

  test('requires a fresh exact project authority and consumes failed authority operations', async () => {
    const request = await verificationRequest()
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
    expect(await errorCode(transport.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
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
    expect(await errorCode(noAuthority.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
      'invalid-request'
    )

    let mismatchedGrantFetchCalls = 0
    const mismatchedGrant = createSupabaseManagementBackfillWriteBarrierVerificationTransport({
      personalAccessToken: PAT,
      authority: { ...AUTHORITY, grantGeneration: 'different-grant-generation' },
      fetcher: async () => {
        mismatchedGrantFetchCalls += 1
        return projectResponse()
      }
    })
    expect(await errorCode(mismatchedGrant.getProjectAuthority(AUTHORITY))).toBe('invalid-request')
    expect(mismatchedGrantFetchCalls).toBe(0)

    let extensionFetchCalls = 0
    const authorityExtension = createTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        extensionFetchCalls += 1
        return projectResponse()
      }
    })
    expect(
      await errorCode(
        authorityExtension.getProjectAuthority({
          ...AUTHORITY,
          endpoint: 'https://evil.example'
        } as SupabaseBackfillLiveCatalogAuthorityV1)
      )
    ).toBe('invalid-request')
    expect(extensionFetchCalls).toBe(0)
  })

  test('fails closed on exact status, redirect, URL, media type, and response shape', async () => {
    const request = await verificationRequest()
    const authorityCases: ReadonlyArray<{
      readonly expected: string
      readonly fetcher: SupabaseManagementBackfillWriteBarrierVerificationFetch
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
        expected: 'http-error',
        fetcher: async () => projectResponse('https://api.supabase.com/redirected')
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
      },
      {
        expected: 'invalid-response',
        fetcher: async (input) => withURL(new Response(null, { status: 200 }), String(input))
      }
    ]
    for (const entry of authorityCases) {
      const transport = createTransport({ personalAccessToken: PAT, fetcher: entry.fetcher })
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
        expected: 'http-error',
        response: (url) => {
          const response = jsonResponse([{}], 201, url)
          Object.defineProperty(response, 'redirected', { value: true })
          return response
        }
      },
      {
        expected: 'invalid-response',
        response: (url) => withURL(new Response('{}', { status: 201 }), url)
      },
      {
        expected: 'invalid-response',
        response: (url) => jsonResponse([{}], 201, url, 'application/problem+json')
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
      expect(await errorCode(transport.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
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
              SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxProjectResponseBytes +
                1
            )
          }
        })
    })
    expect(await errorCode(projectOversize.getProjectAuthority(AUTHORITY))).toBe(
      'response-too-large'
    )

    const request = await verificationRequest()
    const declaredOversize = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) =>
        init?.method === 'GET'
          ? projectResponse(String(input))
          : withURL(
              new Response('[]', {
                status: 201,
                headers: {
                  'content-type': 'application/json',
                  'content-length': String(
                    SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxVerificationResponseBytes +
                      1
                  )
                }
              }),
              String(input)
            )
    })
    await declaredOversize.getProjectAuthority(AUTHORITY)
    expect(
      await errorCode(declaredOversize.runReadOnlyWriteBarrierVerificationQuery(request))
    ).toBe('response-too-large')

    let cancelled = false
    const streamedOversize = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        if (init?.method === 'GET') return projectResponse(String(input))
        return withURL(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new Uint8Array(
                    SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.maxVerificationResponseBytes +
                      1
                  )
                )
              },
              cancel() {
                cancelled = true
              }
            }),
            { status: 201, headers: { 'content-type': 'application/json' } }
          ),
          String(input)
        )
      }
    })
    await streamedOversize.getProjectAuthority(AUTHORITY)
    expect(
      await errorCode(streamedOversize.runReadOnlyWriteBarrierVerificationQuery(request))
    ).toBe('response-too-large')
    await Promise.resolve()
    expect(cancelled).toBe(true)

    const invalidUTF8 = createTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) =>
        init?.method === 'GET'
          ? projectResponse(String(input))
          : withURL(
              new Response(new Uint8Array([0xff]), {
                status: 201,
                headers: { 'content-type': 'application/json' }
              }),
              String(input)
            )
    })
    await invalidUTF8.getProjectAuthority(AUTHORITY)
    expect(await errorCode(invalidUTF8.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
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

    const stalledBody = (status: number, url = '') => {
      const response = new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
        status,
        headers: { 'content-type': 'application/json' }
      })
      return url ? withURL(response, url) : response
    }
    const timedBody = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 10,
      fetcher: async () => stalledBody(200)
    })
    expect(await errorCode(timedBody.getProjectAuthority(AUTHORITY))).toBe('timeout')

    const request = await verificationRequest()
    const timedQuery = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 10,
      fetcher: (input, init) =>
        init?.method === 'GET'
          ? Promise.resolve(projectResponse(String(input)))
          : new Promise<Response>(() => {
              // Intentionally never settles; the query deadline must win.
            })
    })
    await timedQuery.getProjectAuthority(AUTHORITY)
    expect(await errorCode(timedQuery.runReadOnlyWriteBarrierVerificationQuery(request))).toBe(
      'timeout'
    )

    const controller = new AbortController()
    let markPostStarted: () => void = () => undefined
    const postStarted = new Promise<void>((resolve) => {
      markPostStarted = resolve
    })
    const aborted = createTransport({
      personalAccessToken: PAT,
      requestTimeoutMs: 1_000,
      signal: controller.signal,
      fetcher: async (input, init) => {
        if (init?.method === 'GET') return projectResponse(String(input))
        markPostStarted()
        return stalledBody(201, String(input))
      }
    })
    await aborted.getProjectAuthority(AUTHORITY)
    const pending = aborted.runReadOnlyWriteBarrierVerificationQuery(request)
    await postStarted
    controller.abort(new Error(`caller secret ${PAT}`))
    expect(await errorCode(pending)).toBe('aborted')

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

  test('maps failures to static typed errors without retaining secret or query text', async () => {
    const transport = createTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        throw new Error(
          `provider leaked ${PAT} ${PROJECT_REF} ${SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL}`
        )
      }
    })

    const error = await transportError(transport.getProjectAuthority(AUTHORITY))
    expect(error.code).toBe('network-failed')
    expect(error.message).toBe(
      'Supabase Management backfill write-barrier verification transport failed: network-failed.'
    )
    expect(error.message).not.toContain(PAT)
    expect(error.message).not.toContain(PROJECT_REF)
    expect(error.message).not.toContain(SUPABASE_BACKFILL_WRITE_BARRIER_VERIFICATION_SQL)
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
    ).toThrow(SupabaseManagementBackfillWriteBarrierVerificationTransportError)
    expect(fetchCalls).toBe(0)

    expect(() =>
      createTransport({
        personalAccessToken: PAT,
        requestTimeoutMs:
          SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_VERIFICATION_LIMITS.requestTimeoutMs + 1,
        fetcher: successfulFetcher({})
      })
    ).toThrow(SupabaseManagementBackfillWriteBarrierVerificationTransportError)
  })
})
