import type {
  SupabaseBackfillLiveCatalogAuthorityV1,
  SupabaseBackfillLiveCatalogProjectAuthorityV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

import { readBackfillProjectAuthority, sameBackfillReadAuthority } from './project-authority'
import type { createBackfillJSONRequester } from './read-response-runtime'

type JSONRequester = ReturnType<typeof createBackfillJSONRequester>
interface CatalogSessionOptions {
  readonly personalAccessToken: string
  readonly fetcher: Parameters<JSONRequester>[0]
  readonly signal?: AbortSignal
}
interface CatalogSessionPolicy<Request> {
  readonly requestJSON: JSONRequester
  readonly validateAuthority: (value: unknown) => SupabaseBackfillLiveCatalogAuthorityV1
  readonly validatedQueryParameters: (
    value: Request,
    authority: SupabaseBackfillLiveCatalogAuthorityV1
  ) => Promise<readonly unknown[]>
  readonly parseRow: (value: unknown) => unknown
  readonly fail: (code: 'invalid-request' | 'invalid-response' | 'invalid-authority') => never
  readonly sql: string
  readonly maxProjectResponseBytes: number
  readonly maxQueryResponseBytes: number
}

/** One authority read and one fixed read-only query consume the same transport exactly once. */
export function createBackfillCatalogSession<Request>(
  boundAuthority: SupabaseBackfillLiveCatalogAuthorityV1,
  options: CatalogSessionOptions,
  timeoutMs: number,
  policy: CatalogSessionPolicy<Request>
) {
  const authorization = `Bearer ${options.personalAccessToken}`
  const fetcher = options.fetcher
  const signal = options.signal
  let state: 'ready' | 'authority-pending' | 'verified' | 'query-pending' | 'consumed' = 'ready'
  let verifiedAuthority: SupabaseBackfillLiveCatalogAuthorityV1 | null = null

  async function getProjectAuthority(
    request: SupabaseBackfillLiveCatalogAuthorityV1
  ): Promise<SupabaseBackfillLiveCatalogProjectAuthorityV1> {
    if (state !== 'ready') return policy.fail('invalid-request')
    const expected = policy.validateAuthority(request)
    if (!sameBackfillReadAuthority(expected, boundAuthority)) return policy.fail('invalid-request')
    state = 'authority-pending'
    try {
      const value = await policy.requestJSON(
        fetcher,
        `https://api.supabase.com/v1/projects/${expected.projectRef}`,
        {
          method: 'GET',
          credentials: 'omit',
          headers: Object.freeze({ accept: 'application/json', authorization })
        },
        200,
        policy.maxProjectResponseBytes,
        timeoutMs,
        signal
      )
      const authority = readBackfillProjectAuthority(value, expected, policy.fail)
      verifiedAuthority = expected
      state = 'verified'
      return authority
    } catch (cause) {
      state = 'consumed'
      throw cause
    }
  }

  async function runQuery(request: Request): Promise<unknown> {
    if (state !== 'verified' || verifiedAuthority === null) return policy.fail('invalid-request')
    const expected = verifiedAuthority
    state = 'query-pending'
    verifiedAuthority = null
    try {
      const parameters = await policy.validatedQueryParameters(request, expected)
      const value = await policy.requestJSON(
        fetcher,
        `https://api.supabase.com/v1/projects/${expected.projectRef}/database/query/read-only`,
        {
          method: 'POST',
          credentials: 'omit',
          headers: Object.freeze({
            accept: 'application/json',
            authorization,
            'content-type': 'application/json'
          }),
          body: JSON.stringify({ query: policy.sql, parameters })
        },
        201,
        policy.maxQueryResponseBytes,
        timeoutMs,
        signal
      )
      return policy.parseRow(value)
    } finally {
      state = 'consumed'
    }
  }

  return { getProjectAuthority, runQuery }
}
