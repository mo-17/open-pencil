// Supabase deployment-domain mutation transport tests.
import { describe, expect, test } from 'bun:test'

import type { SupabaseBackendStagingApplyContext } from '@/app/plugins/host/deployment/supabase/backend-release'
import {
  createSupabaseManagementDatabaseApplyTransport,
  SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS,
  type SupabaseManagementDatabaseApplyFetch
} from '@/app/plugins/host/deployment/supabase/management/database-apply-transport'

import type { RecordedRequest } from '#tests/engine/app/plugins/deployment/supabase/management/helpers'

import {
  captureBrandedApplyContext,
  errorCode,
  jsonResponse,
  PAT,
  PROJECT_REF,
  projectResponse,
  sqlDigest,
  successfulFetcher,
  transportError,
  type DatabaseApplyBody
} from './database-apply/helpers'

describe('Supabase Management trusted database Apply transport', () => {
  test('checks authority at prepare and again before one exact single-use query dispatch', async () => {
    const context = await captureBrandedApplyContext()
    const requests: RecordedRequest[] = []
    const transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: successfulFetcher(requests)
    })

    const prepared = await transport.prepareReviewedMigration(context)

    expect(Object.keys(transport)).toEqual(['prepareReviewedMigration'])
    expect(Object.keys(prepared)).toEqual(['dispatch'])
    expect(Object.isFrozen(prepared)).toBe(true)
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(`https://api.supabase.com/v1/projects/${PROJECT_REF}`)
    expect(requests[0]?.init.method).toBe('GET')

    const result = await prepared.dispatch()

    expect(requests).toHaveLength(3)
    expect(requests[1]?.url).toBe(`https://api.supabase.com/v1/projects/${PROJECT_REF}`)
    expect(requests[1]?.init.method).toBe('GET')
    expect(requests[2]?.url).toBe(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`
    )
    expect(requests[2]?.init.method).toBe('POST')
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ timeout }) => timeout === 180_000)).toBe(true)
    expect(requests.map(({ maximum }) => maximum)).toEqual([
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes
    ])
    const bodyText = requests[2]?.init.body
    if (typeof bodyText !== 'string') throw new TypeError('Expected exact JSON body')
    const body = JSON.parse(bodyText) as DatabaseApplyBody
    expect(Object.keys(body)).toEqual(['query', 'read_only'])
    expect(body).toEqual({ query: context.artifact.inspectedReview.sql, read_only: false })
    expect(body.query).toStartWith(
      [
        '-- OpenPencil Supabase inspected migration review v1.',
        '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
        'BEGIN;',
        "SET LOCAL lock_timeout = '5s';",
        "SET LOCAL statement_timeout = '15s';",
        'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
        ''
      ].join('\n')
    )
    expect(bodyText).not.toContain(PAT)
    expect(requests.some(({ url }) => url.includes(PAT))).toBe(false)
    expect(new Headers(requests[2]?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
    expect(result).toEqual({ provider: 'supabase', status: 201, remoteOperationIds: [] })
    expect(Object.isFrozen(result)).toBe(true)
    expect(await errorCode(prepared.dispatch())).toBe('dispatch-already-used')
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
  })

  test('rejects plain or hand-wrapped SQL contexts without exposing a test mint', async () => {
    const branded = await captureBrandedApplyContext()
    const manualSQL = [
      '-- OpenPencil Supabase inspected migration review v1.',
      '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
      'BEGIN;',
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '15s';",
      'SELECT 1;',
      'COMMIT;',
      ''
    ].join('\n')
    const plainClone = { artifact: branded.artifact, release: branded.release }
    const handWrapped = {
      artifact: {
        ...branded.artifact,
        inspectedReview: {
          ...branded.artifact.inspectedReview,
          sql: manualSQL,
          manifest: {
            ...branded.artifact.inspectedReview.manifest,
            sqlDigest: await sqlDigest(manualSQL)
          }
        }
      },
      release: branded.release
    }
    let fetchCalls = 0
    const transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        fetchCalls += 1
        return projectResponse()
      }
    })

    for (const forged of [plainClone, handWrapped]) {
      expect(
        await errorCode(
          transport.prepareReviewedMigration(forged as SupabaseBackendStagingApplyContext)
        )
      ).toBe('invalid-authority')
    }
    expect(fetchCalls).toBe(0)
  })

  test('fails project authority before any mutation dispatch', async () => {
    for (const overrides of [
      { ref: 'differentprojectrefaa' },
      { organization_id: 'org-foreign' },
      { organization_slug: '' }
    ]) {
      const context = await captureBrandedApplyContext()
      let postCalls = 0
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          if (init?.method === 'POST') postCalls += 1
          return projectResponse(String(input), overrides)
        }
      })

      expect(await errorCode(transport.prepareReviewedMigration(context))).toBe('invalid-authority')
      expect(postCalls).toBe(0)
    }
  })

  test('rechecks project authority immediately before POST and consumes the attempt on failure', async () => {
    for (const failure of ['transferred', 'network'] as const) {
      const context = await captureBrandedApplyContext()
      let getCalls = 0
      let postCalls = 0
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: async (input, init) => {
          if (init?.method === 'POST') {
            postCalls += 1
            return jsonResponse({}, 201, String(input))
          }
          getCalls += 1
          if (getCalls === 2) {
            if (failure === 'network') throw new Error(`authority lookup failed ${PAT}`)
            return projectResponse(String(input), { organization_id: 'org-transferred' })
          }
          return projectResponse(String(input))
        }
      })
      const prepared = await transport.prepareReviewedMigration(context)
      const error = await transportError(prepared.dispatch())
      expect(error.code).toBe('authority-recheck-failed')
      expect(error.message).not.toContain(PAT)
      expect(postCalls).toBe(0)
      expect(await errorCode(prepared.dispatch())).toBe('dispatch-already-used')
    }
  })

  test('requires exact response status, URL, redirect policy, media type, and body', async () => {
    const cases: ReadonlyArray<{
      phase: 'prepare' | 'dispatch'
      expected: string
      fetcher: SupabaseManagementDatabaseApplyFetch
    }> = [
      {
        phase: 'prepare',
        expected: 'http-error',
        fetcher: async (input) => jsonResponse({}, 201, String(input))
      },
      {
        phase: 'prepare',
        expected: 'http-error',
        fetcher: async (input) => {
          const response = projectResponse(String(input))
          Object.defineProperty(response, 'redirected', { value: true })
          return response
        }
      },
      {
        phase: 'dispatch',
        expected: 'http-error',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({}, 200, String(input))
      },
      {
        phase: 'dispatch',
        expected: 'http-error',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({}, 201, 'https://api.supabase.com/redirected')
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : new Response('{}', {
                status: 201,
                headers: { 'content-type': 'text/plain' }
              })
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse({ operation_id: 'untrusted' }, 201, String(input))
      },
      {
        phase: 'dispatch',
        expected: 'invalid-response',
        fetcher: async (input, init) =>
          init?.method === 'GET'
            ? projectResponse(String(input))
            : jsonResponse([{ unexpected: true }], 201, String(input))
      }
    ]

    for (const entry of cases) {
      const context = await captureBrandedApplyContext()
      const transport = createSupabaseManagementDatabaseApplyTransport({
        personalAccessToken: PAT,
        fetcher: entry.fetcher
      })
      if (entry.phase === 'prepare') {
        expect(await errorCode(transport.prepareReviewedMigration(context))).toBe(entry.expected)
      } else {
        const prepared = await transport.prepareReviewedMigration(context)
        expect(await errorCode(prepared.dispatch())).toBe(entry.expected)
      }
    }
  })

  test('bounds project and Apply response bytes and rejects invalid UTF-8 JSON', async () => {
    const oversizedProjectContext = await captureBrandedApplyContext()
    const oversizedProjectTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'content-length': String(
              SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes + 1
            )
          }
        })
    })
    expect(
      await errorCode(oversizedProjectTransport.prepareReviewedMigration(oversizedProjectContext))
    ).toBe('response-too-large')

    const invalidUTF8Context = await captureBrandedApplyContext()
    const invalidUTF8Transport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async () =>
        new Response(new Uint8Array([0xff]), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    })
    expect(await errorCode(invalidUTF8Transport.prepareReviewedMigration(invalidUTF8Context))).toBe(
      'invalid-response'
    )

    const oversizedApplyContext = await captureBrandedApplyContext()
    const oversizedApplyTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) =>
        init?.method === 'GET'
          ? projectResponse(String(input))
          : new Response('{}', {
              status: 201,
              headers: {
                'content-type': 'application/json',
                'content-length': String(
                  SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes + 1
                )
              }
            })
    })
    const prepared = await oversizedApplyTransport.prepareReviewedMigration(oversizedApplyContext)
    expect(await errorCode(prepared.dispatch())).toBe('response-too-large')
  })

  test('maps aborts and network failures to typed secret-free, non-retryable errors', async () => {
    const prepareAbortContext = await captureBrandedApplyContext()
    const prepareController = new AbortController()
    prepareController.abort()
    let abortedFetchCalls = 0
    const prepareAbortTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      signal: prepareController.signal,
      fetcher: async () => {
        abortedFetchCalls += 1
        return projectResponse()
      }
    })
    expect(
      await errorCode(prepareAbortTransport.prepareReviewedMigration(prepareAbortContext))
    ).toBe('aborted')
    expect(abortedFetchCalls).toBe(0)

    const dispatchAbortContext = await captureBrandedApplyContext()
    const dispatchController = new AbortController()
    let abortPostCalls = 0
    const dispatchAbortTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      signal: dispatchController.signal,
      fetcher: async (input, init) => {
        if (init?.method === 'POST') abortPostCalls += 1
        return init?.method === 'GET'
          ? projectResponse(String(input))
          : jsonResponse({}, 201, String(input))
      }
    })
    const abortedPrepared =
      await dispatchAbortTransport.prepareReviewedMigration(dispatchAbortContext)
    dispatchController.abort()
    expect(await errorCode(abortedPrepared.dispatch())).toBe('authority-recheck-failed')
    expect(await errorCode(abortedPrepared.dispatch())).toBe('dispatch-already-used')
    expect(abortPostCalls).toBe(0)

    const networkContext = await captureBrandedApplyContext()
    let postCalls = 0
    const networkTransport = createSupabaseManagementDatabaseApplyTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        if (init?.method === 'GET') return projectResponse(String(input))
        postCalls += 1
        throw new Error(`ambiguous provider outcome ${PAT}`)
      }
    })
    const networkPrepared = await networkTransport.prepareReviewedMigration(networkContext)
    const error = await transportError(networkPrepared.dispatch())
    expect(error.code).toBe('network-failed')
    expect(error.message).not.toContain(PAT)
    expect(error.message).not.toContain(PROJECT_REF)
    expect(await errorCode(networkPrepared.dispatch())).toBe('dispatch-already-used')
    expect(postCalls).toBe(1)
  })
})
