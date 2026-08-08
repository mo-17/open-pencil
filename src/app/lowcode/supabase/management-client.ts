import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

export const SUPABASE_MANAGEMENT_API_ORIGIN = 'https://api.supabase.com'
export const SUPABASE_OPENAPI_REQUEST_TIMEOUT_MS = 15_000
export const SUPABASE_OPENAPI_MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export type SupabaseManagementErrorCode =
  | 'invalid-project-url'
  | 'invalid-schema'
  | 'missing-token'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limited'
  | 'not-found'
  | 'response-too-large'
  | 'invalid-response'
  | 'request-failed'

export class SupabaseManagementError extends Error {
  constructor(
    readonly code: SupabaseManagementErrorCode,
    message: string,
    readonly status?: number,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SupabaseManagementError'
  }
}

export interface SupabaseOpenApiRequest {
  projectUrl: string
  schema?: string
  personalAccessToken: string
  signal?: AbortSignal
}

export interface SupabaseOpenApiResponse {
  projectRef: string
  schema: string
  openApi: unknown
}

export interface SupabaseManagementClientOptions {
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
  maxResponseBytes?: number
}

const PROJECT_HOST_PATTERN = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.supabase\.co$/i
const MAX_SCHEMA_NAME_LENGTH = 63

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return true
  }
  return false
}

export function projectRefFromSupabaseUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl.trim())
  } catch {
    throw new SupabaseManagementError(
      'invalid-project-url',
      'Supabase project URL must be a valid HTTPS project URL.'
    )
  }
  const match = PROJECT_HOST_PATTERN.exec(url.hostname)
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    !match
  ) {
    throw new SupabaseManagementError(
      'invalid-project-url',
      'Supabase project URL must use https://<project-ref>.supabase.co with no path, query, or credentials.'
    )
  }
  return match[1].toLowerCase()
}

export function normalizeSupabaseSchemaName(rawSchema: string | undefined): string {
  const schema = (rawSchema ?? 'public').trim()
  if (
    schema.length === 0 ||
    schema.length > MAX_SCHEMA_NAME_LENGTH ||
    hasControlCharacters(schema)
  ) {
    throw new SupabaseManagementError(
      'invalid-schema',
      `Supabase schema name must contain 1-${MAX_SCHEMA_NAME_LENGTH} printable characters.`
    )
  }
  return schema
}

export function supabaseOpenApiUrl(projectRef: string, schema: string): string {
  const url = new URL(
    `/v1/projects/${encodeURIComponent(projectRef)}/database/openapi`,
    SUPABASE_MANAGEMENT_API_ORIGIN
  )
  url.searchParams.set('schema', schema)
  return url.href
}

function parseContentLength(response: Response): number | null {
  const raw = response.headers.get('content-length')
  if (!raw || !/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : Number.POSITIVE_INFINITY
}

function responseTooLarge(maxBytes: number): SupabaseManagementError {
  return new SupabaseManagementError(
    'response-too-large',
    `Supabase schema response exceeds the ${maxBytes}-byte limit.`
  )
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const announced = parseContentLength(response)
  if (announced !== null && announced > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw responseTooLarge(maxBytes)
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw responseTooLarge(maxBytes)
    return new TextDecoder().decode(bytes)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    let next = await reader.read()
    while (!next.done) {
      total += next.value.byteLength
      if (total > maxBytes) throw responseTooLarge(maxBytes)
      chunks.push(next.value)
      next = await reader.read()
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

function retryAfterLabel(response: Response): string {
  const retryAfter = response.headers.get('retry-after')?.trim()
  return retryAfter && /^\d{1,10}$/.test(retryAfter) ? ` Retry after ${retryAfter} seconds.` : ''
}

async function throwForStatus(response: Response): Promise<never> {
  if (response.status === 401) {
    await discardResponse(response)
    throw new SupabaseManagementError(
      'unauthorized',
      'Supabase rejected the personal access token.',
      response.status
    )
  }
  if (response.status === 403) {
    await discardResponse(response)
    throw new SupabaseManagementError(
      'forbidden',
      'The Supabase personal access token does not have permission to inspect this project.',
      response.status
    )
  }
  if (response.status === 404) {
    await discardResponse(response)
    throw new SupabaseManagementError(
      'not-found',
      'Supabase project was not found or is not accessible to this personal access token.',
      response.status
    )
  }
  if (response.status === 429) {
    const retry = retryAfterLabel(response)
    await discardResponse(response)
    throw new SupabaseManagementError(
      'rate-limited',
      `Supabase Management API rate limit reached.${retry}`,
      response.status
    )
  }

  await discardResponse(response)
  throw new SupabaseManagementError(
    'request-failed',
    `Supabase schema request failed with HTTP ${response.status}.`,
    response.status
  )
}

function defaultFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  maxResponseBytes: number,
  timeoutMs: number
): Promise<Response> {
  return isTauri()
    ? tauriFetch(input, init, maxResponseBytes, timeoutMs + 1000)
    : globalThis.fetch(input, init)
}

export async function fetchSupabaseDatabaseOpenApi(
  request: SupabaseOpenApiRequest,
  options: SupabaseManagementClientOptions = {}
): Promise<SupabaseOpenApiResponse> {
  const projectRef = projectRefFromSupabaseUrl(request.projectUrl)
  const schema = normalizeSupabaseSchemaName(request.schema)
  const token = request.personalAccessToken.trim()
  if (!token) {
    throw new SupabaseManagementError(
      'missing-token',
      'A Supabase personal access token is required to inspect the database schema.'
    )
  }

  const timeoutMs = options.timeoutMs ?? SUPABASE_OPENAPI_REQUEST_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? SUPABASE_OPENAPI_MAX_RESPONSE_BYTES
  const controller = new AbortController()
  const timeoutReason = new Error('Supabase schema request timed out')
  const onAbort = () => controller.abort(request.signal?.reason)
  request.signal?.addEventListener('abort', onAbort, { once: true })
  if (request.signal?.aborted) onAbort()
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, timeoutMs)

  try {
    const input = supabaseOpenApiUrl(projectRef, schema)
    const init: RequestInit = {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal
    }
    const response = options.fetchImpl
      ? await options.fetchImpl(input, init)
      : await defaultFetch(input, init, maxResponseBytes, timeoutMs)
    if (!response.ok) await throwForStatus(response)
    const text = await readBoundedResponseText(response, maxResponseBytes)
    let openApi: unknown
    try {
      openApi = JSON.parse(text) as unknown
    } catch (error) {
      throw new SupabaseManagementError(
        'invalid-response',
        'Supabase returned an invalid OpenAPI response.',
        response.status,
        { cause: error }
      )
    }
    return { projectRef, schema, openApi }
  } catch (error) {
    if (error instanceof SupabaseManagementError) throw error
    if (controller.signal.aborted && controller.signal.reason === timeoutReason) {
      throw new SupabaseManagementError(
        'timeout',
        `Supabase schema request timed out after ${timeoutMs}ms.`
      )
    }
    if (request.signal?.aborted) throw request.signal.reason ?? error
    throw new SupabaseManagementError(
      'request-failed',
      'Supabase schema request failed before a response was received.',
      undefined,
      { cause: error }
    )
  } finally {
    clearTimeout(timer)
    request.signal?.removeEventListener('abort', onAbort)
  }
}
