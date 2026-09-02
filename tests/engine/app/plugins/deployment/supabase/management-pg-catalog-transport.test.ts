// Supabase deployment-domain transport tests.
import { describe, expect, test } from 'bun:test'

import {
  createSupabaseManagementPgCatalogTransport,
  SUPABASE_PG_CATALOG_AGGREGATE_SQL,
  SupabaseManagementPgCatalogTransportError,
  type SupabaseManagementDesktopFetch
} from '@/app/plugins/host/deployment/supabase/management-pg-catalog-transport'
import {
  SUPABASE_PG_CATALOG_FIXED_QUERIES,
  SUPABASE_PG_CATALOG_QUERY_IDS,
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  type SupabasePgCatalogReadRequest
} from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ORGANIZATION_ID = 'org-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const PAT = 'sbp_transport_secret_canary_1234567890'
const SNAPSHOT_MARKER = '123:123:'
const OBSERVED_AT = '2026-08-30T10:00:00.000Z'

interface SupabaseReadOnlyQueryBody {
  readonly query: string
  readonly parameters: readonly unknown[]
}

function readRequest(): SupabasePgCatalogReadRequest {
  return {
    projectRef: PROJECT_REF,
    accountId: ORGANIZATION_ID,
    grantGeneration: GRANT_GENERATION,
    queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
    schema: 'public',
    snapshotScope: 'single-statement',
    accessMode: 'read-only',
    queries: SUPABASE_PG_CATALOG_FIXED_QUERIES.map((query) => ({
      queryId: query.queryId,
      parameters: { schema: 'public', rowLimit: query.maximumRows + 1 }
    }))
  }
}

function aggregateResponse(overrides: Record<string, unknown> = {}): unknown {
  return [
    {
      snapshotMarker: SNAPSHOT_MARKER,
      observedAt: OBSERVED_AT,
      queryResults: Object.fromEntries(SUPABASE_PG_CATALOG_QUERY_IDS.map((id) => [id, []])),
      ...overrides
    }
  ]
}

function jsonResponse(value: unknown, status = 200, url = ''): Response {
  const response = new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
  if (url) Object.defineProperty(response, 'url', { value: url })
  return response
}

function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  return operation.then(
    () => undefined,
    (cause) => (cause instanceof SupabaseManagementPgCatalogTransportError ? cause.code : undefined)
  )
}

describe('Supabase Management fixed pg_catalog transport', () => {
  test('uses GET authority plus exactly one fixed read-only aggregate POST', async () => {
    const requests: Array<Readonly<{ url: string; init: RequestInit; maximum: number }>> = []
    const fetcher: SupabaseManagementDesktopFetch = async (input, init, maximum) => {
      const url = String(input)
      requests.push({ url, init: init ?? {}, maximum })
      if (url.endsWith(`/v1/projects/${PROJECT_REF}`)) {
        return jsonResponse(
          {
            ref: PROJECT_REF,
            organization_id: ORGANIZATION_ID,
            organization_slug: 'open-pencil-staging',
            name: 'Staging'
          },
          200,
          url
        )
      }
      return jsonResponse(aggregateResponse(), 201, url)
    }
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher
    })

    const authority = await transport.getProjectAuthority({
      projectRef: PROJECT_REF,
      grantGeneration: GRANT_GENERATION
    })
    const result = await transport.runReadOnlyCatalogQueries(readRequest())

    expect(authority).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ORGANIZATION_ID,
      grantGeneration: GRANT_GENERATION
    })
    expect(result.results).toHaveLength(SUPABASE_PG_CATALOG_QUERY_IDS.length)
    expect(new Set(result.results.map((entry) => entry.snapshotMarker))).toEqual(
      new Set([SNAPSHOT_MARKER])
    )
    expect(requests).toHaveLength(2)
    expect(requests.filter(({ init }) => init.method === 'POST')).toHaveLength(1)
    const post = requests[1]
    expect(post?.url).toBe(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query/read-only`
    )
    const serializedBody = post?.init.body
    expect(typeof serializedBody).toBe('string')
    if (typeof serializedBody !== 'string') throw new TypeError('Expected a JSON request body.')
    const body = JSON.parse(serializedBody) as SupabaseReadOnlyQueryBody
    expect(Object.keys(body)).toEqual(['query', 'parameters'])
    expect(body.query).toBe(SUPABASE_PG_CATALOG_AGGREGATE_SQL)
    expect(body.parameters).toHaveLength(SUPABASE_PG_CATALOG_QUERY_IDS.length * 2)
    expect(body.query).toContain('$20')
    expect(body.query).toContain('acl_attribute.attacl IS NOT NULL')
    expect(body.query).not.toContain(PAT)
    expect(String(post?.url)).not.toContain(PAT)
    expect(new Headers(post?.init.headers).get('authorization')).toBe(`Bearer ${PAT}`)
  })

  test('requires verified project authority before the aggregate statement', async () => {
    let fetchCalls = 0
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        fetchCalls += 1
        return jsonResponse({})
      }
    })

    expect(await errorCode(transport.runReadOnlyCatalogQueries(readRequest()))).toBe(
      'invalid-request'
    )
    expect(fetchCalls).toBe(0)
  })

  test('rejects a digit-bearing project ref before network dispatch', async () => {
    let fetchCalls = 0
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        fetchCalls += 1
        return jsonResponse({})
      }
    })

    expect(
      await errorCode(
        transport.getProjectAuthority({
          projectRef: 'enekobitnhobuiuamvq1',
          grantGeneration: GRANT_GENERATION
        })
      )
    ).toBe('invalid-request')
    expect(fetchCalls).toBe(0)
  })

  test('rejects request tampering without dispatching another POST', async () => {
    let postCalls = 0
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher: async (input, init) => {
        if (init?.method === 'POST') postCalls += 1
        return jsonResponse({
          ref: PROJECT_REF,
          organization_id: ORGANIZATION_ID,
          organization_slug: 'open-pencil-staging'
        })
      }
    })
    await transport.getProjectAuthority({
      projectRef: PROJECT_REF,
      grantGeneration: GRANT_GENERATION
    })
    const request = structuredClone(readRequest())
    Reflect.set(request.queries[0]?.parameters ?? {}, 'rowLimit', 1)

    expect(await errorCode(transport.runReadOnlyCatalogQueries(request))).toBe('invalid-request')
    expect(postCalls).toBe(0)
  })

  test('fails closed on foreign or incomplete project authority', async () => {
    for (const project of [
      {
        ref: 'differentprojectref01',
        organization_id: ORGANIZATION_ID,
        organization_slug: 'open-pencil-staging'
      },
      { ref: PROJECT_REF, organization_id: '', organization_slug: 'open-pencil-staging' },
      { ref: PROJECT_REF, organization_id: ORGANIZATION_ID, organization_slug: '' }
    ]) {
      const transport = createSupabaseManagementPgCatalogTransport({
        personalAccessToken: PAT,
        fetcher: async () => jsonResponse(project)
      })
      expect(
        await errorCode(
          transport.getProjectAuthority({
            projectRef: PROJECT_REF,
            grantGeneration: GRANT_GENERATION
          })
        )
      ).toBe('invalid-authority')
    }
  })

  test('accepts only the single-row aggregate response shape', async () => {
    const invalidResponses = [
      [],
      [aggregateResponse()[0], aggregateResponse()[0]],
      aggregateResponse({ extra: true }),
      aggregateResponse({ queryResults: { provenance: [] } })
    ]
    for (const invalidResponse of invalidResponses) {
      const transport = createSupabaseManagementPgCatalogTransport({
        personalAccessToken: PAT,
        fetcher: async (_input, init) =>
          init?.method === 'GET'
            ? jsonResponse({
                ref: PROJECT_REF,
                organization_id: ORGANIZATION_ID,
                organization_slug: 'open-pencil-staging'
              })
            : jsonResponse(invalidResponse, 201)
      })
      await transport.getProjectAuthority({
        projectRef: PROJECT_REF,
        grantGeneration: GRANT_GENERATION
      })
      expect(await errorCode(transport.runReadOnlyCatalogQueries(readRequest()))).toBe(
        'invalid-response'
      )
    }
  })

  test('requires the documented 201 status for the aggregate response', async () => {
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher: async (_input, init) =>
        init?.method === 'GET'
          ? jsonResponse({
              ref: PROJECT_REF,
              organization_id: ORGANIZATION_ID,
              organization_slug: 'open-pencil-staging'
            })
          : jsonResponse(aggregateResponse(), 200)
    })
    await transport.getProjectAuthority({
      projectRef: PROJECT_REF,
      grantGeneration: GRANT_GENERATION
    })

    expect(await errorCode(transport.runReadOnlyCatalogQueries(readRequest()))).toBe('http-error')
  })

  test('never echoes the PAT in transport errors', async () => {
    const transport = createSupabaseManagementPgCatalogTransport({
      personalAccessToken: PAT,
      fetcher: async () => {
        throw new Error(`network leaked ${PAT}`)
      }
    })
    let error: Error | undefined
    try {
      await transport.getProjectAuthority({
        projectRef: PROJECT_REF,
        grantGeneration: GRANT_GENERATION
      })
    } catch (cause) {
      if (cause instanceof Error) error = cause
    }
    expect(error).toBeInstanceOf(SupabaseManagementPgCatalogTransportError)
    expect(error?.message).not.toContain(PAT)
  })
})
