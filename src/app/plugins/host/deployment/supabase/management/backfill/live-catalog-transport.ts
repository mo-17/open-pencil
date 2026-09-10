import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY,
  SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
  SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
  SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
  type SupabaseBackfillLiveCatalogAuthorityV1,
  type SupabaseBackfillLiveCatalogHostTransportV1,
  type SupabaseBackfillLiveCatalogProjectAuthorityV1,
  type SupabaseBackfillLiveCatalogRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/live-inspector'

import type { SupabaseManagementRequestDeadline } from '../transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u

export const SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxCatalogResponseBytes: 512 * 1024,
  requestTimeoutMs: 30_000
})

export type SupabaseManagementBackfillLiveCatalogFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillLiveCatalogTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'
  | 'timeout'

export class SupabaseManagementBackfillLiveCatalogTransportError extends Error {
  constructor(readonly code: SupabaseManagementBackfillLiveCatalogTransportErrorCode) {
    super(`Supabase Management backfill catalog transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillLiveCatalogTransportError'
  }
}

export interface CreateSupabaseManagementBackfillLiveCatalogTransportOptions {
  /** Ephemeral runtime value. Create a new transport for every inspection operation. */
  readonly personalAccessToken: string
  /** Authority generation resolved atomically with this credential value by the Host vault. */
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly fetcher: SupabaseManagementBackfillLiveCatalogFetch
  readonly signal?: AbortSignal
  /** Tests and stricter hosts may shorten, but never extend, the fixed Host deadline. */
  readonly requestTimeoutMs?: number
}

export type SupabaseManagementBackfillLiveCatalogTransport =
  SupabaseBackfillLiveCatalogHostTransportV1

interface UnknownRecord {
  [key: string]: unknown
}

type RequestDeadline = SupabaseManagementRequestDeadline

const REQUEST_KEYS = Object.freeze([
  'queryId',
  'queryVersion',
  'queryDigest',
  'subjectDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'statementCount',
  'catalogOnly',
  'accessMode',
  'snapshotScope',
  'parameters'
] as const)

function fail(code: SupabaseManagementBackfillLiveCatalogTransportErrorCode): never {
  throw new SupabaseManagementBackfillLiveCatalogTransportError(code)
}

function boundedTimeout(value: unknown): number {
  if (value === undefined) return SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.requestTimeoutMs
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.requestTimeoutMs
  ) {
    return fail('invalid-authority')
  }
  return value as number
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <=
      SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxPATBytes &&
    !/\p{Cc}/u.test(value)
  )
}

function plainRecord(value: unknown, code: 'invalid-request' | 'invalid-response'): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail(code)
  }
  if (prototype !== Object.prototype && prototype !== null) return fail(code)
  return value as UnknownRecord
}

function ownData(
  value: object,
  key: PropertyKey,
  code: 'invalid-request' | 'invalid-response'
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function ownKeys(
  value: object,
  code: 'invalid-request' | 'invalid-response'
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = ownKeys(value, 'invalid-request')
  return (
    keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
  )
}

function stableId(value: unknown, code: 'invalid-request' | 'invalid-authority'): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) return fail(code)
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) return fail('invalid-request')
  return value
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) return fail('invalid-request')
  return value
}

function boundedParameterText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 8_192 ||
    /\p{Cc}/u.test(value)
  ) {
    return fail('invalid-request')
  }
  return value
}

function validateAuthority(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  const source = plainRecord(value, 'invalid-request')
  if (!hasExactKeys(source, ['projectRef', 'accountId', 'grantGeneration'])) {
    return fail('invalid-request')
  }
  const projectRef = ownData(source, 'projectRef', 'invalid-request')
  if (typeof projectRef !== 'string' || !PROJECT_REF.test(projectRef))
    return fail('invalid-request')
  return Object.freeze({
    projectRef,
    accountId: stableId(ownData(source, 'accountId', 'invalid-request'), 'invalid-request'),
    grantGeneration: stableId(
      ownData(source, 'grantGeneration', 'invalid-request'),
      'invalid-request'
    )
  })
}

function sameAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

async function validatedQueryParameters(
  value: unknown,
  expectedAuthority: SupabaseBackfillLiveCatalogAuthorityV1
): Promise<readonly unknown[]> {
  const source = plainRecord(value, 'invalid-request')
  if (!hasExactKeys(source, REQUEST_KEYS)) return fail('invalid-request')

  if (
    ownData(source, 'queryId', 'invalid-request') !== SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID ||
    ownData(source, 'queryVersion', 'invalid-request') !==
      SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION ||
    ownData(source, 'statementCount', 'invalid-request') !== 1 ||
    ownData(source, 'catalogOnly', 'invalid-request') !== true ||
    ownData(source, 'accessMode', 'invalid-request') !== 'read-only' ||
    ownData(source, 'snapshotScope', 'invalid-request') !== 'single-statement'
  ) {
    return fail('invalid-request')
  }

  const queryDigest = digest(ownData(source, 'queryDigest', 'invalid-request'))
  const subjectDigest = digest(ownData(source, 'subjectDigest', 'invalid-request'))
  if (queryDigest !== (await digestCanonicalManifest(SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY))) {
    return fail('invalid-request')
  }
  for (const key of ['projectRef', 'accountId', 'grantGeneration'] as const) {
    if (ownData(source, key, 'invalid-request') !== expectedAuthority[key]) {
      return fail('invalid-request')
    }
  }
  const parameters = plainRecord(
    ownData(source, 'parameters', 'invalid-request'),
    'invalid-request'
  )
  if (!hasExactKeys(parameters, SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER)) {
    return fail('invalid-request')
  }
  const parsed = Object.freeze({
    schema: ownData(parameters, 'schema', 'invalid-request'),
    table: identifier(ownData(parameters, 'table', 'invalid-request')),
    entityMarker: boundedParameterText(ownData(parameters, 'entityMarker', 'invalid-request')),
    cursorField: identifier(ownData(parameters, 'cursorField', 'invalid-request')),
    cursorMarker: boundedParameterText(ownData(parameters, 'cursorMarker', 'invalid-request')),
    primaryKeyMarker: boundedParameterText(
      ownData(parameters, 'primaryKeyMarker', 'invalid-request')
    ),
    targetField: identifier(ownData(parameters, 'targetField', 'invalid-request')),
    targetMarker: boundedParameterText(ownData(parameters, 'targetMarker', 'invalid-request')),
    subjectDigest: digest(ownData(parameters, 'subjectDigest', 'invalid-request')),
    projectRef: ownData(parameters, 'projectRef', 'invalid-request'),
    accountId: ownData(parameters, 'accountId', 'invalid-request'),
    grantGeneration: ownData(parameters, 'grantGeneration', 'invalid-request'),
    queryVersion: ownData(parameters, 'queryVersion', 'invalid-request'),
    queryDigest: digest(ownData(parameters, 'queryDigest', 'invalid-request'))
  })
  if (
    parsed.schema !== 'public' ||
    parsed.subjectDigest !== subjectDigest ||
    parsed.projectRef !== expectedAuthority.projectRef ||
    parsed.accountId !== expectedAuthority.accountId ||
    parsed.grantGeneration !== expectedAuthority.grantGeneration ||
    parsed.queryVersion !== SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION ||
    parsed.queryDigest !== queryDigest
  ) {
    return fail('invalid-request')
  }
  return Object.freeze(SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER.map((key) => parsed[key]))
}

function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) controller.abort(caller.reason)
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new DOMException('Backfill catalog request timed out', 'TimeoutError'))
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  }
}

function abortReason(): Error {
  return new DOMException('Supabase backfill catalog request aborted', 'AbortError')
}

function waitForAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason())
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([operation, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}

function validJSONMediaType(response: Response): boolean {
  const value = response.headers.get('content-type')?.trim().toLowerCase()
  return value !== undefined && /^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(value)
}

async function boundedJSON(
  response: Response,
  maximum: number,
  signal: AbortSignal
): Promise<unknown> {
  if (!validJSONMediaType(response)) return fail('invalid-response')
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) return fail('invalid-response')
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed)) return fail('invalid-response')
    if (parsed > maximum) {
      void response.body?.cancel().catch(() => undefined)
      return fail('response-too-large')
    }
  }
  if (!response.body) return fail('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    let chunk = await waitForAbortable(reader.read(), signal)
    while (!chunk.done) {
      byteLength += chunk.value.byteLength
      if (byteLength > maximum) {
        await reader.cancel().catch(() => undefined)
        return fail('response-too-large')
      }
      chunks.push(chunk.value)
      chunk = await waitForAbortable(reader.read(), signal)
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined)
    throw cause
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
  fetcher: SupabaseManagementBackfillLiveCatalogFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined
): Promise<unknown> {
  if (callerSignal?.aborted) return fail('aborted')
  const deadline = requestDeadline(callerSignal, timeoutMs)
  try {
    const response = await waitForAbortable(
      fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
      deadline.signal
    )
    if (response.redirected || (response.url !== '' && response.url !== url)) {
      return fail('http-error')
    }
    if (response.status !== expectedStatus) return fail('http-error')
    return await boundedJSON(response, maximum, deadline.signal)
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillLiveCatalogTransportError) throw cause
    if (deadline.timedOut()) return fail('timeout')
    if (callerSignal?.aborted) return fail('aborted')
    return fail('network-failed')
  } finally {
    deadline.dispose()
  }
}

function parseProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): SupabaseBackfillLiveCatalogProjectAuthorityV1 {
  const project = plainRecord(value, 'invalid-response')
  const ref = ownData(project, 'ref', 'invalid-response')
  const accountId = ownData(project, 'organization_id', 'invalid-response')
  if (ref !== expected.projectRef || accountId !== expected.accountId) {
    return fail('invalid-authority')
  }
  return Object.freeze({
    projectRef: expected.projectRef,
    organizationId: expected.accountId,
    grantGeneration: expected.grantGeneration
  })
}

function parseSingleCatalogRow(value: unknown): UnknownRecord {
  if (!Array.isArray(value) || value.length !== 1) return fail('invalid-response')
  const keys = ownKeys(value, 'invalid-response')
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail('invalid-response')
  }
  if (
    keys.length !== 2 ||
    !keys.includes('0') ||
    !keys.includes('length') ||
    lengthDescriptor?.enumerable !== false ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    lengthDescriptor.value !== 1
  ) {
    return fail('invalid-response')
  }
  return plainRecord(ownData(value, '0', 'invalid-response'), 'invalid-response')
}

export function createSupabaseManagementBackfillLiveCatalogTransport(
  options: CreateSupabaseManagementBackfillLiveCatalogTransportOptions
): SupabaseBackfillLiveCatalogHostTransportV1 {
  if (!validPAT(options.personalAccessToken)) fail('invalid-authority')
  if (typeof options.fetcher !== 'function') fail('invalid-authority')
  let boundAuthority: SupabaseBackfillLiveCatalogAuthorityV1
  try {
    boundAuthority = validateAuthority(options.authority)
  } catch {
    return fail('invalid-authority')
  }
  const timeoutMs = boundedTimeout(options.requestTimeoutMs)
  const authorization = `Bearer ${options.personalAccessToken}`
  const fetcher = options.fetcher
  const signal = options.signal
  let state: 'ready' | 'authority-pending' | 'verified' | 'query-pending' | 'consumed' = 'ready'
  let verifiedAuthority: SupabaseBackfillLiveCatalogAuthorityV1 | null = null

  return Object.freeze({
    async getProjectAuthority(
      request: SupabaseBackfillLiveCatalogAuthorityV1
    ): Promise<SupabaseBackfillLiveCatalogProjectAuthorityV1> {
      if (state !== 'ready') return fail('invalid-request')
      const expected = validateAuthority(request)
      if (!sameAuthority(expected, boundAuthority)) return fail('invalid-request')
      state = 'authority-pending'
      try {
        const url = `${MANAGEMENT_ORIGIN}/v1/projects/${expected.projectRef}`
        const value = await requestJSON(
          fetcher,
          url,
          {
            method: 'GET',
            credentials: 'omit',
            headers: Object.freeze({ accept: 'application/json', authorization })
          },
          200,
          SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxProjectResponseBytes,
          timeoutMs,
          signal
        )
        const projectAuthority = parseProjectAuthority(value, expected)
        verifiedAuthority = expected
        state = 'verified'
        return projectAuthority
      } catch (cause) {
        state = 'consumed'
        throw cause
      }
    },

    async runReadOnlyBackfillCatalogQuery(
      request: SupabaseBackfillLiveCatalogRequestV1
    ): Promise<unknown> {
      if (state !== 'verified' || verifiedAuthority === null) return fail('invalid-request')
      const expected = verifiedAuthority
      state = 'query-pending'
      verifiedAuthority = null
      try {
        const parameters = await validatedQueryParameters(request, expected)
        const url = `${MANAGEMENT_ORIGIN}/v1/projects/${expected.projectRef}/database/query/read-only`
        const value = await requestJSON(
          fetcher,
          url,
          {
            method: 'POST',
            credentials: 'omit',
            headers: Object.freeze({
              accept: 'application/json',
              authorization,
              'content-type': 'application/json'
            }),
            body: JSON.stringify({
              query: SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
              parameters
            })
          },
          201,
          SUPABASE_MANAGEMENT_BACKFILL_LIVE_CATALOG_LIMITS.maxCatalogResponseBytes,
          timeoutMs,
          signal
        )
        return parseSingleCatalogRow(value)
      } finally {
        state = 'consumed'
      }
    }
  })
}
