/* oxlint-disable eslint/max-lines -- One threat matrix keeps the fixed locked-read transport auditable. */
import { describe, expect, test } from 'bun:test'

import {
  captureSupabaseBackfillLockedHighWaterV1,
  SupabaseBackfillLockedHighWaterCaptureError,
  type CaptureSupabaseBackfillLockedHighWaterOptionsV1,
  type SupabaseBackfillLockedHighWaterCaptureHostTransportV1,
  type SupabaseBackfillLockedHighWaterCaptureRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  createSupabaseManagementBackfillLockedHighWaterCaptureTransport,
  SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS,
  SupabaseManagementBackfillLockedHighWaterCaptureTransportError,
  trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1,
  type CreateSupabaseManagementBackfillLockedHighWaterCaptureTransportOptionsV1,
  type SupabaseManagementBackfillLockedHighWaterCaptureFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/locked-high-water-capture-transport'

import {
  BACKFILL_CAPTURE_FIXTURE_GRANT,
  BACKFILL_CAPTURE_FIXTURE_PAT,
  BACKFILL_CAPTURE_READ_AUTHORITY,
  createBackfillLockedHighWaterCaptureFixture,
  INSTALL_PROJECT_URL,
  lockedHighWaterResponse,
  type BackfillLockedHighWaterCaptureFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'
import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

const QUERY_URL = `${INSTALL_PROJECT_URL}/database/query`

interface CaptureRequestBody {
  readonly query: string
  readonly read_only: boolean
}

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(
  value: unknown,
  status: number,
  url: string,
  contentType = 'application/json; charset=utf-8'
): Response {
  return withURL(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': contentType }
    }),
    url
  )
}

function projectResponse(
  fixture: BackfillLockedHighWaterCaptureFixture,
  url: string,
  organizationId = fixture.writeAuthority.accountId
): Response {
  return jsonResponse(
    {
      ref: fixture.writeAuthority.projectRef,
      organization_id: organizationId,
      name: 'Locked high-water staging'
    },
    200,
    url
  )
}

function successfulFetcher(
  fixture: BackfillLockedHighWaterCaptureFixture,
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillLockedHighWaterCaptureFetch {
  return async (input, init, maximum, timeout) => {
    const url = String(input)
    requests.push({ url, init: init ?? {}, maximum, timeout })
    return init?.method === 'GET'
      ? projectResponse(fixture, url)
      : jsonResponse([lockedHighWaterResponse(fixture)], 201, url)
  }
}

function transport(
  fixture: BackfillLockedHighWaterCaptureFixture,
  fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch = successfulFetcher(fixture),
  overrides: Partial<CreateSupabaseManagementBackfillLockedHighWaterCaptureTransportOptionsV1> = {}
) {
  return createSupabaseManagementBackfillLockedHighWaterCaptureTransport({
    personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
    authority: fixture.writeAuthority,
    fetcher,
    ...overrides
  })
}

function captureOptions(
  fixture: BackfillLockedHighWaterCaptureFixture,
  captureTransport: SupabaseBackfillLockedHighWaterCaptureHostTransportV1
): CaptureSupabaseBackfillLockedHighWaterOptionsV1 {
  return {
    captureReview: fixture.captureReview,
    stagingTargetBinding: fixture.install.stagingBinding,
    confirmation: fixture.confirmation,
    readCurrentCompilerInput: () => fixture.install.input,
    readCurrentReadAuthority: () => BACKFILL_CAPTURE_READ_AUTHORITY,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.install.stagingBinding,
    transport: captureTransport
  }
}

async function transportError(
  operation: Promise<unknown>
): Promise<SupabaseManagementBackfillLockedHighWaterCaptureTransportError> {
  try {
    await operation
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillLockedHighWaterCaptureTransportError) {
      return cause
    }
  }
  throw new TypeError('Expected a typed locked high-water Management transport error')
}

async function expectCaptureTransportFailure(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillLockedHighWaterCaptureError)
    expect(cause).toMatchObject({
      code: 'supabase-backfill-locked-high-water-transport-failed'
    })
    return
  }
  throw new TypeError('Expected the Host capture to reject the transport result')
}

function forgedRequest(
  fixture: BackfillLockedHighWaterCaptureFixture
): SupabaseBackfillLockedHighWaterCaptureRequestV1 {
  return Object.freeze({
    format: 'openpencil.supabase-backfill-locked-high-water-capture-request.v1',
    version: 1,
    providerId: 'supabase',
    environment: 'staging',
    projectRef: fixture.writeAuthority.projectRef,
    accountId: fixture.writeAuthority.accountId,
    grantGeneration: fixture.writeAuthority.grantGeneration,
    reviewDigest: fixture.captureReview.reviewDigest,
    queryId: 'backfill-locked-high-water-capture',
    queryVersion: 'openpencil-supabase-backfill-locked-high-water-capture-v1',
    queryDigest: fixture.captureReview.review.query.digest,
    statementCount: 10,
    accessMode: 'read-write-locked-read',
    snapshotScope: 'explicit-serializable-transaction',
    lockMode: 'share-row-exclusive'
  })
}

describe('Supabase Management locked high-water capture transport', () => {
  test('sends exact preflight GET, query POST, postflight GET and keeps the PAT only in Authorization', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const requests: RecordedRequest[] = []
    const captureTransport = transport(fixture, successfulFetcher(fixture, requests))

    expect(Object.keys(captureTransport)).toEqual(['runLockedHighWaterCapture'])
    expect(Object.isFrozen(captureTransport)).toBe(true)
    expect(
      trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1(captureTransport)
    ).toBe(true)
    expect(
      trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1({ ...captureTransport })
    ).toBe(false)

    const capture = await captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport)
    )

    expect(capture.highWater.capturedHighWater).toBe(42)
    expect(requests.map(({ url }) => url)).toEqual([
      INSTALL_PROJECT_URL,
      QUERY_URL,
      INSTALL_PROJECT_URL
    ])
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'POST', 'GET'])
    expect(requests.map(({ maximum }) => maximum)).toEqual([
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxCaptureResponseBytes,
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxProjectResponseBytes
    ])
    expect(
      requests.every(
        ({ timeout }) =>
          timeout === SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.requestTimeoutMs
      )
    ).toBe(true)
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
    expect(
      requests.every(
        ({ init }) =>
          new Headers(init.headers).get('authorization') ===
          `Bearer ${BACKFILL_CAPTURE_FIXTURE_PAT}`
      )
    ).toBe(true)

    const bodyText = requests[1]?.init.body
    if (typeof bodyText !== 'string') throw new TypeError('Expected exact capture JSON body')
    const body = JSON.parse(bodyText) as CaptureRequestBody
    expect(Object.keys(body)).toEqual(['query', 'read_only'])
    expect(body).toEqual({ query: fixture.captureReview.captureSql, read_only: false })
    expect(bodyText).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)
    expect(requests.some(({ url }) => url.includes(BACKFILL_CAPTURE_FIXTURE_PAT))).toBe(false)
    expect(JSON.stringify(captureTransport)).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)

    const replay = await transportError(
      captureTransport.runLockedHighWaterCapture(forgedRequest(fixture))
    )
    expect(replay.code).toBe('invalid-request')
    expect(requests).toHaveLength(3)
  })

  test('rejects forged requests and cloned transports before any network request', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    let fetchCalls = 0
    const captureTransport = transport(fixture, async () => {
      fetchCalls += 1
      return projectResponse(fixture, INSTALL_PROJECT_URL)
    })
    const error = await transportError(
      captureTransport.runLockedHighWaterCapture(forgedRequest(fixture))
    )

    expect(error.code).toBe('invalid-request')
    expect(error.message).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)
    expect(error.message).not.toContain(fixture.captureReview.captureSql)
    expect(fetchCalls).toBe(0)
    expect(
      trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1({ ...captureTransport })
    ).toBe(false)
    expect(
      (await transportError(captureTransport.runLockedHighWaterCapture(forgedRequest(fixture))))
        .code
    ).toBe('invalid-request')
    expect(fetchCalls).toBe(0)
  })

  test('requires an exact inert factory options and database-write authority record', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const base = {
      personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
      authority: fixture.writeAuthority,
      fetcher: successfulFetcher(fixture)
    }
    let getterCalls = 0
    const accessor = { ...base }
    Object.defineProperty(accessor, 'personalAccessToken', {
      enumerable: true,
      get() {
        getterCalls += 1
        return BACKFILL_CAPTURE_FIXTURE_PAT
      }
    })
    const symbolExtended = { ...base } as Record<PropertyKey, unknown>
    symbolExtended[Symbol('extension')] = true
    const cases: readonly unknown[] = [
      { ...base, extension: true },
      accessor,
      symbolExtended,
      Object.assign(Object.create({ inherited: true }), base),
      { ...base, personalAccessToken: 'short' },
      { ...base, authority: { ...fixture.writeAuthority, scope: 'database:read' } },
      { ...base, authority: { ...fixture.writeAuthority, extension: true } },
      {
        ...base,
        requestTimeoutMs:
          SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.requestTimeoutMs + 1
      },
      { ...base, signal: {} }
    ]

    for (const candidate of cases) {
      expect(() =>
        createSupabaseManagementBackfillLockedHighWaterCaptureTransport(
          candidate as CreateSupabaseManagementBackfillLockedHighWaterCaptureTransportOptionsV1
        )
      ).toThrow(SupabaseManagementBackfillLockedHighWaterCaptureTransportError)
    }
    expect(getterCalls).toBe(0)
  })

  test('binds the private request to the factory grant and rechecks project ownership around POST', async () => {
    const grantDrift = await createBackfillLockedHighWaterCaptureFixture()
    let driftFetchCalls = 0
    const driftedTransport = transport(
      grantDrift,
      async () => {
        driftFetchCalls += 1
        return projectResponse(grantDrift, INSTALL_PROJECT_URL)
      },
      {
        authority: Object.freeze({
          ...grantDrift.writeAuthority,
          grantGeneration: '423e4567-e89b-42d3-a456-426614174000'
        })
      }
    )
    await expectCaptureTransportFailure(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(grantDrift, driftedTransport))
    )
    expect(driftFetchCalls).toBe(0)

    const projectDrift = await createBackfillLockedHighWaterCaptureFixture()
    let getCalls = 0
    let postCalls = 0
    const recheckingTransport = transport(projectDrift, async (input, init) => {
      const url = String(input)
      if (init?.method === 'POST') {
        postCalls += 1
        return jsonResponse([lockedHighWaterResponse(projectDrift)], 201, url)
      }
      getCalls += 1
      return projectResponse(
        projectDrift,
        url,
        getCalls === 2 ? 'different-organization' : projectDrift.writeAuthority.accountId
      )
    })
    await expectCaptureTransportFailure(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(projectDrift, recheckingTransport))
    )
    expect(getCalls).toBe(2)
    expect(postCalls).toBe(1)
  })

  test('rejects non-201, redirected, non-JSON, oversized, malformed, and non-single-row results', async () => {
    const cases: ReadonlyArray<{
      readonly name: string
      readonly response: (fixture: BackfillLockedHighWaterCaptureFixture, url: string) => Response
    }> = [
      {
        name: 'wrong status',
        response: (fixture, url) => jsonResponse([lockedHighWaterResponse(fixture)], 200, url)
      },
      {
        name: 'redirected',
        response: (fixture) =>
          jsonResponse(
            [lockedHighWaterResponse(fixture)],
            201,
            'https://api.supabase.com/redirected'
          )
      },
      {
        name: 'wrong media type',
        response: (fixture, url) =>
          jsonResponse([lockedHighWaterResponse(fixture)], 201, url, 'text/plain')
      },
      {
        name: 'empty row array',
        response: (_fixture, url) => jsonResponse([], 201, url)
      },
      {
        name: 'multiple row array',
        response: (fixture, url) => {
          const row = lockedHighWaterResponse(fixture)
          return jsonResponse([row, row], 201, url)
        }
      },
      {
        name: 'non-array response',
        response: (fixture, url) => jsonResponse(lockedHighWaterResponse(fixture), 201, url)
      },
      {
        name: 'invalid utf8',
        response: (_fixture, url) =>
          withURL(
            new Response(new Uint8Array([0xff]), {
              status: 201,
              headers: { 'content-type': 'application/json' }
            }),
            url
          )
      },
      {
        name: 'oversized response',
        response: (_fixture, url) =>
          withURL(
            new Response('[]', {
              status: 201,
              headers: {
                'content-type': 'application/json',
                'content-length': String(
                  SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxCaptureResponseBytes +
                    1
                )
              }
            }),
            url
          )
      }
    ]

    for (const candidate of cases) {
      const fixture = await createBackfillLockedHighWaterCaptureFixture()
      let postCalls = 0
      const captureTransport = transport(fixture, async (input, init) => {
        const url = String(input)
        if (init?.method === 'GET') return projectResponse(fixture, url)
        postCalls += 1
        return candidate.response(fixture, url)
      })

      await expectCaptureTransportFailure(
        captureSupabaseBackfillLockedHighWaterV1(captureOptions(fixture, captureTransport))
      )
      expect(postCalls, candidate.name).toBe(1)
    }
  })

  test('bounds caller deadlines and burns an aborted attempt without network access', async () => {
    const abortedFixture = await createBackfillLockedHighWaterCaptureFixture()
    const controller = new AbortController()
    controller.abort()
    let abortedFetchCalls = 0
    const abortedTransport = transport(
      abortedFixture,
      async () => {
        abortedFetchCalls += 1
        return projectResponse(abortedFixture, INSTALL_PROJECT_URL)
      },
      { signal: controller.signal }
    )
    await expectCaptureTransportFailure(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(abortedFixture, abortedTransport))
    )
    expect(abortedFetchCalls).toBe(0)

    const timeoutFixture = await createBackfillLockedHighWaterCaptureFixture()
    let timeoutFetchCalls = 0
    const timeoutTransport = transport(
      timeoutFixture,
      async (_input, init) => {
        timeoutFetchCalls += 1
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          const onAbort = () => reject(signal?.reason)
          if (signal?.aborted) onAbort()
          else signal?.addEventListener('abort', onAbort, { once: true })
        })
      },
      { requestTimeoutMs: 1 }
    )
    await expectCaptureTransportFailure(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(timeoutFixture, timeoutTransport))
    )
    expect(timeoutFetchCalls).toBe(1)
  })

  test('does not accept a capture grant aliased to another operation generation', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const aliasedAuthority = Object.freeze({
      ...fixture.writeAuthority,
      grantGeneration: BACKFILL_CAPTURE_FIXTURE_GRANT.replace('323e', '223e')
    })
    const aliased = transport(fixture, successfulFetcher(fixture), {
      authority: aliasedAuthority
    })
    await expectCaptureTransportFailure(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(fixture, aliased))
    )
  })
})
