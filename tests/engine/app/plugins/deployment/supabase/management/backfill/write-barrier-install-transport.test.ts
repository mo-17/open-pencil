/* oxlint-disable eslint/max-lines -- One threat matrix keeps the fixed mutation transport auditable. */
import { describe, expect, test } from 'bun:test'

import { createMemoryBackendHostReleaseDispatchJournal } from '@/app/plugins/host/deployment/backend/release-journal'
import type { SupabaseBackfillWriteBarrierInstallDispatchContextV1 } from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install'
import { dispatchSupabaseBackfillWriteBarrierInstallV1 } from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install-controller'
import {
  createSupabaseManagementBackfillWriteBarrierInstallTransport,
  SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS,
  SupabaseManagementBackfillWriteBarrierInstallTransportError,
  type SupabaseManagementBackfillWriteBarrierInstallFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/write-barrier-install-transport'

import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  BACKFILL_INSTALL_FIXTURE_WRITE_GRANT,
  createBackfillWriteBarrierInstallFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'
import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const PAT = 'sbp_backfill_write_barrier_install_secret_canary_1234567890'
const PROJECT_URL = `https://api.supabase.com/v1/projects/${BACKFILL_INSTALL_FIXTURE_PROJECT_REF}`
const MIGRATION_URL = `${PROJECT_URL}/database/migrations`

interface MigrationBody {
  readonly query: string
  readonly name: string
}

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(
  value: unknown,
  status: number,
  url = '',
  contentType = 'application/json; charset=utf-8'
): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType }
  })
  return url ? withURL(response, url) : response
}

function projectResponse(
  url = PROJECT_URL,
  overrides: Readonly<Record<string, unknown>> = {}
): Response {
  return jsonResponse(
    {
      ref: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organization_id: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      name: 'Backfill staging',
      ...overrides
    },
    200,
    url
  )
}

function successfulFetcher(
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillWriteBarrierInstallFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET' ? projectResponse(url) : jsonResponse({}, 200, url)
  }
}

function clock(start = Date.parse('2026-09-04T02:00:00.000Z')): () => string {
  let current = start
  return () => {
    const result = new Date(current).toISOString()
    current += 1_000
    return result
  }
}

async function dispatchWithController(
  fixture: Awaited<ReturnType<typeof createBackfillWriteBarrierInstallFixture>>,
  transport: ReturnType<typeof createSupabaseManagementBackfillWriteBarrierInstallTransport>,
  suffix: string
) {
  const stableSuffix = suffix.replaceAll(/[^A-Za-z0-9._-]/gu, '-')
  return dispatchSupabaseBackfillWriteBarrierInstallV1({
    context: fixture.context,
    transport,
    journal: createMemoryBackendHostReleaseDispatchJournal(),
    releaseId: `transport-release-${stableSuffix}`,
    ownerId: `transport-owner-${stableSuffix}`,
    now: clock()
  })
}

async function transportError(
  operation: Promise<unknown>
): Promise<SupabaseManagementBackfillWriteBarrierInstallTransportError> {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillWriteBarrierInstallTransportError) {
      return cause
    }
  }
  throw new TypeError('Expected a typed Supabase migration transport error')
}

describe('Supabase Management backfill write-barrier install transport', () => {
  test('rejects clones and bare dispatch, while the controller sends exact GET, GET, migration POST', async () => {
    const forgedFixture = await createBackfillWriteBarrierInstallFixture()
    const clone = structuredClone(
      forgedFixture.context
    ) as SupabaseBackfillWriteBarrierInstallDispatchContextV1
    let forgedFetchCalls = 0
    const forgedTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        forgedFetchCalls += 1
        return projectResponse()
      }
    })
    const forgedError = await transportError(forgedTransport.prepareMigration(clone))
    expect(forgedError).toMatchObject({ code: 'invalid-request', outcome: 'not-dispatched' })
    expect(forgedFetchCalls).toBe(0)

    const bareFixture = await createBackfillWriteBarrierInstallFixture()
    const bareRequests: RecordedRequest[] = []
    const bareTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(bareRequests)
    })
    const barePrepared = await bareTransport.prepareMigration(bareFixture.context)

    expect(Object.keys(bareTransport)).toEqual(['prepareMigration'])
    expect(Object.isFrozen(bareTransport)).toBe(true)
    expect(Object.keys(barePrepared)).toEqual(['projectAuthority', 'dispatch'])
    expect(Object.isFrozen(barePrepared)).toBe(true)
    expect(barePrepared.projectAuthority).toEqual({
      projectRef: BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      organizationId: BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      grantGeneration: BACKFILL_INSTALL_FIXTURE_WRITE_GRANT
    })
    expect(Object.isFrozen(barePrepared.projectAuthority)).toBe(true)
    expect(bareRequests.map(({ url }) => url)).toEqual([PROJECT_URL])

    const bareError = await transportError(barePrepared.dispatch())
    expect(bareError).toMatchObject({
      code: 'journal-permit-invalid',
      outcome: 'not-dispatched'
    })
    expect(bareRequests.map(({ url }) => url)).toEqual([PROJECT_URL])
    expect((await transportError(barePrepared.dispatch())).code).toBe('dispatch-already-used')
    expect(bareRequests.filter(({ init }) => init.method === 'POST')).toHaveLength(0)

    const fixture = await createBackfillWriteBarrierInstallFixture()
    const requests: RecordedRequest[] = []
    const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(requests)
    })
    const result = await dispatchWithController(fixture, transport, 'exact-request')

    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL, PROJECT_URL, MIGRATION_URL])
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'GET', 'POST'])
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
    expect(requests.every(({ timeout }) => timeout === 180_000)).toBe(true)
    expect(requests.map(({ maximum }) => maximum)).toEqual([
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxMigrationResponseBytes
    ])
    const bodyText = requests[2]?.init.body
    if (typeof bodyText !== 'string') throw new TypeError('Expected exact migration JSON body')
    const body = JSON.parse(bodyText) as MigrationBody
    expect(Object.keys(body)).toEqual(['query', 'name'])
    expect(body).toEqual({
      query: fixture.installReview.installSql,
      name: fixture.installReview.review.migration.name
    })
    expect(bodyText).not.toContain(PAT)
    expect(bodyText).not.toContain('rollback')
    expect(bodyText).not.toContain('read_only')
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[2]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(result).toMatchObject({
      status: 'verification-required',
      automaticRetryAllowed: false,
      claim: { outcome: 'outcome-unknown' },
      confirmation: {
        status: 200,
        migrationName: fixture.installReview.review.migration.name,
        installDigest: fixture.installReview.review.bindings.installDigest
      }
    })
    expect(Object.isFrozen(result.confirmation)).toBe(true)
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)

    let replayFetchCalls = 0
    const replayTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        replayFetchCalls += 1
        return projectResponse()
      }
    })
    const consumed = await transportError(replayTransport.prepareMigration(fixture.context))
    expect(consumed).toMatchObject({ code: 'invalid-request', outcome: 'not-dispatched' })
    expect(replayFetchCalls).toBe(0)
  })

  test('burns the attempt without POST when the immediate authority recheck fails or aborts', async () => {
    for (const mode of ['transferred', 'aborted'] as const) {
      const fixture = await createBackfillWriteBarrierInstallFixture()
      const controller = new AbortController()
      let getCalls = 0
      let postCalls = 0
      const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
        personalAccessToken: PAT,
        signal: controller.signal,
        fetcher: async (input, init) => {
          const url = String(input)
          if (init?.method === 'POST') {
            postCalls += 1
            return jsonResponse({}, 200, url)
          }
          getCalls += 1
          if (getCalls === 2 && mode === 'aborted') controller.abort()
          return projectResponse(
            url,
            getCalls === 2 && mode === 'transferred'
              ? { organization_id: 'different-organization' }
              : {}
          )
        }
      })
      const result = await dispatchWithController(fixture, transport, `pre-post-${mode}`)

      expect(result).toMatchObject({
        status: 'not-dispatched',
        automaticRetryAllowed: false,
        code: 'supabase-backfill-write-barrier-not-dispatched',
        claim: { outcome: 'failed' }
      })
      expect(getCalls).toBe(2)
      expect(postCalls).toBe(0)
    }
  })

  test('requires the controller permit before any dispatch-side network request', async () => {
    const fixture = await createBackfillWriteBarrierInstallFixture()
    const requests: RecordedRequest[] = []
    const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(requests)
    })
    const prepared = await transport.prepareMigration(fixture.context)

    const error = await transportError(prepared.dispatch())

    expect(error).toMatchObject({ code: 'journal-permit-invalid', outcome: 'not-dispatched' })
    expect(requests.map(({ url }) => url)).toEqual([PROJECT_URL])
    expect((await transportError(prepared.dispatch())).code).toBe('dispatch-already-used')
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(0)
  })

  test('classifies every failure after the POST boundary as outcome unknown', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly response: (url: string) => Response | Promise<Response>
    }> = [
      {
        name: 'network rejection',
        response: async () => {
          throw new Error(`ambiguous migration ${PAT}`)
        }
      },
      {
        name: 'wrong status',
        response: (url) => jsonResponse({}, 201, url)
      },
      {
        name: 'redirected URL',
        response: () => jsonResponse({}, 200, 'https://api.supabase.com/redirected')
      },
      {
        name: 'wrong media type',
        response: (url) => jsonResponse({}, 200, url, 'text/plain')
      },
      {
        name: 'non-empty object',
        response: (url) => jsonResponse({ id: 'untrusted' }, 200, url)
      },
      {
        name: 'array response',
        response: (url) => jsonResponse([], 200, url)
      },
      {
        name: 'oversized response',
        response: (url) =>
          withURL(
            new Response('{}', {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'content-length': String(
                  SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxMigrationResponseBytes +
                    1
                )
              }
            }),
            url
          )
      }
    ]

    for (const candidate of cases) {
      const fixture = await createBackfillWriteBarrierInstallFixture()
      let postCalls = 0
      const transport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          const url = String(input)
          if (init?.method === 'GET') return projectResponse(url)
          postCalls += 1
          return candidate.response(url)
        }
      })
      const result = await dispatchWithController(fixture, transport, `post-${candidate.name}`)

      expect(result.status, candidate.name).toBe('outcome-unknown')
      expect(result.code, candidate.name).toBe(
        'supabase-backfill-write-barrier-dispatch-outcome-unknown'
      )
      expect(result.automaticRetryAllowed, candidate.name).toBe(false)
      expect(result.claim?.outcome, candidate.name).toBe('outcome-unknown')
      expect(JSON.stringify(result), candidate.name).not.toContain(PAT)
      expect(postCalls).toBe(1)
    }
  })

  test('bounds authority responses and rejects invalid credentials or pre-dispatch aborts', async () => {
    expect(() =>
      createSupabaseManagementBackfillWriteBarrierInstallTransport({
        personalAccessToken: 'short',
        fetcher: successfulFetcher()
      })
    ).toThrow(SupabaseManagementBackfillWriteBarrierInstallTransportError)
    expect(() =>
      createSupabaseManagementBackfillWriteBarrierInstallTransport({
        personalAccessToken: PAT,
        requestTimeoutMs:
          SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.requestTimeoutMs + 1,
        fetcher: successfulFetcher()
      })
    ).toThrow(SupabaseManagementBackfillWriteBarrierInstallTransportError)

    const oversizedFixture = await createBackfillWriteBarrierInstallFixture()
    const oversizedTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      fetcher: async (input) =>
        withURL(
          new Response('{}', {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-length': String(
                SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxProjectResponseBytes +
                  1
              )
            }
          }),
          String(input)
        )
    })
    const oversized = await transportError(
      oversizedTransport.prepareMigration(oversizedFixture.context)
    )
    expect(oversized).toMatchObject({
      code: 'response-too-large',
      outcome: 'not-dispatched'
    })

    const abortedFixture = await createBackfillWriteBarrierInstallFixture()
    const controller = new AbortController()
    controller.abort()
    let fetchCalls = 0
    const abortedTransport = createSupabaseManagementBackfillWriteBarrierInstallTransport({
      personalAccessToken: PAT,
      signal: controller.signal,
      fetcher: async () => {
        fetchCalls += 1
        return projectResponse()
      }
    })
    const aborted = await transportError(abortedTransport.prepareMigration(abortedFixture.context))
    expect(aborted).toMatchObject({ code: 'aborted', outcome: 'not-dispatched' })
    expect(fetchCalls).toBe(0)
  })
})
