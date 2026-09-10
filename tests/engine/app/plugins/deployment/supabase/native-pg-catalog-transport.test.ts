import { describe, expect, test } from 'bun:test'

import { encodeBase64URL } from '@open-pencil/scene-graph'

import {
  SUPABASE_PG_CATALOG_AGGREGATE_SQL,
  SUPABASE_PG_CATALOG_AGGREGATE_PARAMETERS,
  SupabaseManagementPgCatalogTransportError
} from '@/app/plugins/host/deployment/supabase/management/pg-catalog-transport'
import {
  createNativeSupabaseManagementPgCatalogTransport,
  createNativeSupabaseManagementPgCatalogTransportForTestingV1,
  isProductionNativeSupabaseManagementPgCatalogTransportV1
} from '@/app/plugins/host/deployment/supabase/native-pg-catalog-transport'
import {
  SUPABASE_PG_CATALOG_FIXED_QUERIES,
  SUPABASE_PG_CATALOG_QUERY_IDS,
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  type SupabasePgCatalogReadRequest
} from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'
import type {
  SupabaseManagementNativeBridge,
  SupabaseManagementPgCatalogInspectRequestV1
} from '@/app/tauri/supabase-management'

const PROJECT_REF = 'enekobitnhobuiuamvqj'
const ORGANIZATION_ID = 'organization-123'
const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
const SNAPSHOT_MARKER = '123:123:'
const OBSERVED_AT = '2026-09-07T10:00:00.000Z'

async function queryDigest(
  parameters: readonly unknown[] = SUPABASE_PG_CATALOG_AGGREGATE_PARAMETERS
): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify({ query: SUPABASE_PG_CATALOG_AGGREGATE_SQL, parameters })
  )
  const source = new Uint8Array(encoded.byteLength)
  source.set(encoded)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
}

function queryResponse(): unknown {
  return [
    {
      snapshotMarker: SNAPSHOT_MARKER,
      observedAt: OBSERVED_AT,
      queryResults: Object.fromEntries(
        SUPABASE_PG_CATALOG_QUERY_IDS.map((queryId) => [queryId, []])
      )
    }
  ]
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

function bridge(
  requests: SupabaseManagementPgCatalogInspectRequestV1[],
  digest: string
): SupabaseManagementNativeBridge {
  return Object.freeze({
    async inspectPgCatalogV1(request: SupabaseManagementPgCatalogInspectRequestV1) {
      requests.push(request)
      return {
        projectRef: PROJECT_REF,
        organizationId: ORGANIZATION_ID,
        grantGeneration: GRANT_GENERATION,
        queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
        queryDigest: digest,
        queryResponse: queryResponse()
      }
    }
  })
}

describe('native Supabase Management pg_catalog transport', () => {
  test('adapts one composite native inspection without exposing SQL or credentials', async () => {
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    expect(await queryDigest()).toBe('jwBPA-A8dfd9Xz36lHlgoYFr_jVfppNhm1vl8bPSeNw')
    const transport = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: bridge(requests, await queryDigest())
    })

    expect(
      await transport.getProjectAuthority({
        projectRef: PROJECT_REF,
        grantGeneration: GRANT_GENERATION
      })
    ).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ORGANIZATION_ID,
      grantGeneration: GRANT_GENERATION
    })
    const result = await transport.runReadOnlyCatalogQueries(readRequest())
    expect(result.results).toHaveLength(SUPABASE_PG_CATALOG_QUERY_IDS.length)
    expect(requests).toEqual([
      {
        projectRef: PROJECT_REF,
        expectedOrganizationId: ORGANIZATION_ID,
        expectedGrantGeneration: GRANT_GENERATION
      }
    ])
    expect(JSON.stringify(requests)).not.toContain('SELECT')
    expect(JSON.stringify(requests)).not.toContain('personalAccessToken')
  })

  test('fails closed on native query drift and consumes the transport', async () => {
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    const transport = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: bridge(requests, 'A'.repeat(43))
    })

    await expect(
      transport.getProjectAuthority({ projectRef: PROJECT_REF, grantGeneration: GRANT_GENERATION })
    ).rejects.toMatchObject({ code: 'invalid-authority' })
    await expect(
      transport.getProjectAuthority({ projectRef: PROJECT_REF, grantGeneration: GRANT_GENERATION })
    ).rejects.toBeInstanceOf(SupabaseManagementPgCatalogTransportError)
    expect(requests).toHaveLength(1)
  })

  test('fails closed when one fixed native query parameter drifts', async () => {
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    const alteredParameters = [...SUPABASE_PG_CATALOG_AGGREGATE_PARAMETERS]
    alteredParameters[1] = 3
    const transport = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: bridge(requests, await queryDigest(alteredParameters))
    })

    await expect(
      transport.getProjectAuthority({ projectRef: PROJECT_REF, grantGeneration: GRANT_GENERATION })
    ).rejects.toMatchObject({ code: 'invalid-authority' })
    expect(requests).toHaveLength(1)
  })

  test('rejects request drift before invoking the native authority', async () => {
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    const transport = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: bridge(requests, await queryDigest())
    })

    await expect(
      transport.getProjectAuthority({
        projectRef: 'enekobitnhobuiuamvq1',
        grantGeneration: GRANT_GENERATION
      })
    ).rejects.toMatchObject({ code: 'invalid-request' })
    expect(requests).toHaveLength(0)
  })

  test('brands only the fixed-singleton production factory by exact identity', async () => {
    const production = createNativeSupabaseManagementPgCatalogTransport({
      expectedOrganizationId: ORGANIZATION_ID
    })
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    const testing = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: bridge(requests, await queryDigest())
    })

    expect(isProductionNativeSupabaseManagementPgCatalogTransportV1(production)).toBe(true)
    expect(isProductionNativeSupabaseManagementPgCatalogTransportV1({ ...production })).toBe(false)
    expect(isProductionNativeSupabaseManagementPgCatalogTransportV1(testing)).toBe(false)
  })

  test('supports explicit review-only organization discovery through the native result', async () => {
    const requests: SupabaseManagementPgCatalogInspectRequestV1[] = []
    const transport = createNativeSupabaseManagementPgCatalogTransportForTestingV1({
      expectedOrganizationId: null,
      bridge: bridge(requests, await queryDigest())
    })

    expect(
      await transport.getProjectAuthority({
        projectRef: PROJECT_REF,
        grantGeneration: GRANT_GENERATION
      })
    ).toEqual({
      projectRef: PROJECT_REF,
      organizationId: ORGANIZATION_ID,
      grantGeneration: GRANT_GENERATION
    })
    expect(requests[0]?.expectedOrganizationId).toBeNull()
    expect((await transport.runReadOnlyCatalogQueries(readRequest())).accountId).toBe(
      ORGANIZATION_ID
    )
  })

  test('rejects injected, inherited, accessor and proxied production options', async () => {
    const fakeBridge = bridge([], await queryDigest())
    expect(() =>
      createNativeSupabaseManagementPgCatalogTransport({
        expectedOrganizationId: ORGANIZATION_ID,
        bridge: fakeBridge
      } as never)
    ).toThrow(SupabaseManagementPgCatalogTransportError)

    const inherited = Object.create({ expectedOrganizationId: ORGANIZATION_ID })
    expect(() => createNativeSupabaseManagementPgCatalogTransport(inherited)).toThrow(
      SupabaseManagementPgCatalogTransportError
    )

    let getterCalls = 0
    const accessor = Object.create(null)
    Object.defineProperty(accessor, 'expectedOrganizationId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return ORGANIZATION_ID
      }
    })
    expect(() => createNativeSupabaseManagementPgCatalogTransport(accessor as never)).toThrow(
      SupabaseManagementPgCatalogTransportError
    )
    expect(getterCalls).toBe(0)

    const proxy = new Proxy(
      { expectedOrganizationId: ORGANIZATION_ID },
      {
        ownKeys() {
          throw new Error('trap')
        }
      }
    )
    expect(() => createNativeSupabaseManagementPgCatalogTransport(proxy)).toThrow(
      SupabaseManagementPgCatalogTransportError
    )
  })

  test('strictly snapshots testing options without invoking accessors', async () => {
    const fakeBridge = bridge([], await queryDigest())
    expect(() =>
      createNativeSupabaseManagementPgCatalogTransportForTestingV1({
        expectedOrganizationId: ORGANIZATION_ID,
        bridge: fakeBridge,
        extra: true
      } as never)
    ).toThrow(SupabaseManagementPgCatalogTransportError)

    let getterCalls = 0
    const accessor = Object.create(null)
    Object.defineProperties(accessor, {
      expectedOrganizationId: {
        enumerable: true,
        value: ORGANIZATION_ID
      },
      bridge: {
        enumerable: true,
        get() {
          getterCalls += 1
          return fakeBridge
        }
      }
    })
    expect(() =>
      createNativeSupabaseManagementPgCatalogTransportForTestingV1(accessor as never)
    ).toThrow(SupabaseManagementPgCatalogTransportError)
    expect(getterCalls).toBe(0)

    const inherited = Object.assign(Object.create({ testing: true }), {
      expectedOrganizationId: ORGANIZATION_ID,
      bridge: fakeBridge
    })
    expect(() => createNativeSupabaseManagementPgCatalogTransportForTestingV1(inherited)).toThrow(
      SupabaseManagementPgCatalogTransportError
    )
  })
})
