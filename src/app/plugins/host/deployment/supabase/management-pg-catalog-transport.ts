import {
  SUPABASE_PG_CATALOG_FIXED_QUERIES,
  SUPABASE_PG_CATALOG_QUERY_IDS,
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  type SupabasePgCatalogHostTransport,
  type SupabasePgCatalogProjectAuthority,
  type SupabasePgCatalogProjectAuthorityRequest,
  type SupabasePgCatalogReadRequest,
  type SupabasePgCatalogReadResult
} from './pg-catalog-inspector'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const AUTHORITY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MAX_PROJECT_RESPONSE_BYTES = 128 * 1024
const MAX_CATALOG_RESPONSE_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const MAX_PAT_LENGTH = 4_096

type FixedQuery = (typeof SUPABASE_PG_CATALOG_FIXED_QUERIES)[number]

export type SupabaseManagementDesktopFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementPgCatalogTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'

export class SupabaseManagementPgCatalogTransportError extends Error {
  constructor(readonly code: SupabaseManagementPgCatalogTransportErrorCode) {
    super(`Supabase Management catalog transport failed: ${code}.`)
    this.name = 'SupabaseManagementPgCatalogTransportError'
  }
}

export interface CreateSupabaseManagementPgCatalogTransportOptions {
  /** Ephemeral runtime value. The returned transport must remain operation-scoped. */
  readonly personalAccessToken: string
  readonly fetcher: SupabaseManagementDesktopFetch
  readonly signal?: AbortSignal
}

interface UnknownRecord {
  [key: string]: unknown
}

function fail(code: SupabaseManagementPgCatalogTransportErrorCode): never {
  throw new SupabaseManagementPgCatalogTransportError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function validPAT(value: string): boolean {
  return value.length >= 16 && value.length <= MAX_PAT_LENGTH && !/\p{Cc}/u.test(value)
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !AUTHORITY_ID.test(value)) fail('invalid-authority')
  return value
}

function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    /\p{Cc}/u.test(value)
  ) {
    return fail('invalid-response')
  }
  return value
}

function plainRecord(value: unknown): UnknownRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return fail('invalid-response')
  }
  return value as UnknownRecord
}

function dataField(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('invalid-response')
  }
  return descriptor.value
}

function exactKeys(record: UnknownRecord, keys: readonly string[]): void {
  const ownKeys = Reflect.ownKeys(record)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    fail('invalid-response')
  }
  for (const key of keys) dataField(record, key)
}

function runtimeField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key)
}

function renumberParameters(sql: string, queryIndex: number): string {
  const offset = queryIndex * 2
  return sql.replace(/\$(1|2)(?!\d)/gu, (_match, position: string) => {
    return `$${offset + Number(position)}`
  })
}

function cteName(queryId: string): string {
  return `openpencil_${queryId.replaceAll('-', '_')}`
}

function aggregateSQL(queries: readonly FixedQuery[]): string {
  const ctes = queries.map(
    (query, index) => `"${cteName(query.queryId)}" AS (\n${renumberParameters(query.sql, index)}\n)`
  )
  const resultPairs = queries.flatMap((query) => {
    const name = cteName(query.queryId)
    return [
      `'${query.queryId}'`,
      `COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "${name}" AS row_data), '[]'::jsonb)`
    ]
  })
  return `WITH\n${ctes.join(',\n')}\nSELECT\n  pg_catalog.txid_current_snapshot()::text AS "snapshotMarker",\n  pg_catalog.to_char(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",\n  pg_catalog.jsonb_build_object(\n    ${resultPairs.join(',\n    ')}\n  ) AS "queryResults"`
}

/** One immutable SQL statement; callers can choose only whether to execute it. */
export const SUPABASE_PG_CATALOG_AGGREGATE_SQL = aggregateSQL(SUPABASE_PG_CATALOG_FIXED_QUERIES)

const AGGREGATE_PARAMETERS = Object.freeze(
  SUPABASE_PG_CATALOG_FIXED_QUERIES.flatMap((query) => ['public', query.maximumRows + 1])
)

async function boundedJSON(response: Response, maximum: number): Promise<unknown> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0) fail('invalid-response')
    if (parsed > maximum) fail('response-too-large')
  }
  if (!response.body) fail('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    let chunk = await reader.read()
    while (!chunk.done) {
      byteLength += chunk.value.byteLength
      if (byteLength > maximum) {
        await reader.cancel()
        fail('response-too-large')
      }
      chunks.push(chunk.value)
      chunk = await reader.read()
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return fail('invalid-response')
  }
}

async function requestJSON(
  fetcher: SupabaseManagementDesktopFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  signal: AbortSignal | undefined
): Promise<unknown> {
  throwIfAborted(signal)
  let response: Response
  try {
    response = await fetcher(
      url,
      { ...init, redirect: 'error', signal },
      maximum,
      REQUEST_TIMEOUT_MS
    )
  } catch {
    throwIfAborted(signal)
    return fail('network-failed')
  }
  throwIfAborted(signal)
  if (response.redirected || (response.url !== '' && response.url !== url)) {
    fail('http-error')
  }
  if (response.status !== expectedStatus) fail('http-error')
  return boundedJSON(response, maximum)
}

function validateReadRequest(
  request: SupabasePgCatalogReadRequest,
  authority: SupabasePgCatalogProjectAuthority | null
): void {
  if (
    !authority ||
    request.projectRef !== authority.projectRef ||
    request.accountId !== authority.organizationId ||
    request.grantGeneration !== authority.grantGeneration ||
    runtimeField(request, 'queryVersion') !== SUPABASE_PG_CATALOG_QUERY_VERSION ||
    runtimeField(request, 'schema') !== 'public' ||
    runtimeField(request, 'snapshotScope') !== 'single-statement' ||
    runtimeField(request, 'accessMode') !== 'read-only' ||
    request.queries.length !== SUPABASE_PG_CATALOG_FIXED_QUERIES.length
  ) {
    fail('invalid-request')
  }
  for (const [index, query] of request.queries.entries()) {
    const fixed = SUPABASE_PG_CATALOG_FIXED_QUERIES.at(index)
    if (
      !fixed ||
      query.queryId !== fixed.queryId ||
      runtimeField(query.parameters, 'schema') !== 'public' ||
      query.parameters.rowLimit !== fixed.maximumRows + 1
    ) {
      fail('invalid-request')
    }
  }
}

function parseAggregateResult(
  value: unknown,
  request: SupabasePgCatalogReadRequest
): SupabasePgCatalogReadResult {
  if (!Array.isArray(value) || value.length !== 1) fail('invalid-response')
  const envelope = plainRecord(value[0])
  exactKeys(envelope, ['snapshotMarker', 'observedAt', 'queryResults'])
  const snapshotMarker = boundedText(dataField(envelope, 'snapshotMarker'), 256)
  const observedAt = dataField(envelope, 'observedAt')
  if (
    typeof observedAt !== 'string' ||
    observedAt.length > 64 ||
    !Number.isFinite(Date.parse(observedAt))
  ) {
    fail('invalid-response')
  }
  const queryResults = plainRecord(dataField(envelope, 'queryResults'))
  exactKeys(queryResults, SUPABASE_PG_CATALOG_QUERY_IDS)
  const results = SUPABASE_PG_CATALOG_FIXED_QUERIES.map((fixed) => {
    const rows = dataField(queryResults, fixed.queryId)
    if (!Array.isArray(rows) || rows.length > fixed.maximumRows + 1) fail('invalid-response')
    for (const row of rows) plainRecord(row)
    return Object.freeze({
      queryId: fixed.queryId,
      snapshotMarker,
      complete: true as const,
      truncated: false as const,
      rows: Object.freeze([...rows])
    })
  })
  return Object.freeze({
    projectRef: request.projectRef,
    accountId: request.accountId,
    grantGeneration: request.grantGeneration,
    queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
    schema: 'public',
    snapshotScope: 'single-statement',
    accessMode: 'read-only',
    snapshotMarker,
    observedAt,
    results: Object.freeze(results)
  })
}

export function createSupabaseManagementPgCatalogTransport(
  options: CreateSupabaseManagementPgCatalogTransportOptions
): SupabasePgCatalogHostTransport {
  if (!validPAT(options.personalAccessToken)) fail('invalid-authority')
  const authorization = `Bearer ${options.personalAccessToken}`
  let verifiedAuthority: SupabasePgCatalogProjectAuthority | null = null

  return Object.freeze({
    async getProjectAuthority(
      request: SupabasePgCatalogProjectAuthorityRequest
    ): Promise<SupabasePgCatalogProjectAuthority> {
      if (!PROJECT_REF.test(request.projectRef)) fail('invalid-request')
      const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${request.projectRef}`
      const value = await requestJSON(
        options.fetcher,
        projectURL,
        {
          method: 'GET',
          credentials: 'omit',
          headers: Object.freeze({
            accept: 'application/json',
            authorization
          })
        },
        200,
        MAX_PROJECT_RESPONSE_BYTES,
        options.signal
      )
      const project = plainRecord(value)
      const ref = dataField(project, 'ref')
      const organizationId = stableId(dataField(project, 'organization_id'))
      stableId(dataField(project, 'organization_slug'))
      if (ref !== request.projectRef) fail('invalid-authority')
      verifiedAuthority = Object.freeze({
        projectRef: request.projectRef,
        organizationId,
        grantGeneration: request.grantGeneration
      })
      return verifiedAuthority
    },

    async runReadOnlyCatalogQueries(
      request: SupabasePgCatalogReadRequest
    ): Promise<SupabasePgCatalogReadResult> {
      validateReadRequest(request, verifiedAuthority)
      const queryURL = `${MANAGEMENT_ORIGIN}/v1/projects/${request.projectRef}/database/query/read-only`
      const value = await requestJSON(
        options.fetcher,
        queryURL,
        {
          method: 'POST',
          credentials: 'omit',
          headers: Object.freeze({
            accept: 'application/json',
            authorization,
            'content-type': 'application/json'
          }),
          body: JSON.stringify({
            query: SUPABASE_PG_CATALOG_AGGREGATE_SQL,
            parameters: AGGREGATE_PARAMETERS
          })
        },
        201,
        MAX_CATALOG_RESPONSE_BYTES,
        options.signal
      )
      return parseAggregateResult(value, request)
    }
  })
}
