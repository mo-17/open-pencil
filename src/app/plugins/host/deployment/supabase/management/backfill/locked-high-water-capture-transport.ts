/* oxlint-disable eslint(max-lines), open-pencil(no-mixed-case-acronym-identifiers) -- Keep the complete fixed-origin locked-read boundary in one auditable module. */
import {
  consumeTrustedSupabaseBackfillLockedHighWaterCaptureRequestV1,
  type SupabaseBackfillLockedHighWaterCaptureHostTransportV1,
  type SupabaseBackfillLockedHighWaterCaptureRequestV1,
  type SupabaseBackfillLockedHighWaterWriteAuthorityV1,
  type TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'

import type { SupabaseManagementRequestDeadline } from '../transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const REQUIRED_OPTION_KEYS = Object.freeze(['personalAccessToken', 'authority', 'fetcher'] as const)
const OPTIONAL_OPTION_KEYS = Object.freeze(['signal', 'requestTimeoutMs'] as const)
const AUTHORITY_KEYS = Object.freeze([
  'projectRef',
  'accountId',
  'grantGeneration',
  'scope',
  'permission'
] as const)
const TRUSTED_REQUEST_KEYS = Object.freeze([
  'projectRef',
  'accountId',
  'grantGeneration',
  'captureSql',
  'queryDigest'
] as const)
const STATUS_OK = 200 as const
const STATUS_CREATED = 201 as const

export const SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxCaptureResponseBytes: 512 * 1024,
  maxCaptureSQLBytes: 1_048_576,
  // The fixed SQL can legitimately spend 5s waiting for its table lock and 15s
  // each in its catalog and aggregate statements. Preserve bounded HTTP margin.
  requestTimeoutMs: 60_000
})

export type SupabaseManagementBackfillLockedHighWaterCaptureFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode =
  | 'aborted'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'
  | 'timeout'

export class SupabaseManagementBackfillLockedHighWaterCaptureTransportError extends Error {
  constructor(readonly code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode) {
    super(`Supabase Management backfill locked high-water capture transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillLockedHighWaterCaptureTransportError'
  }
}

export interface CreateSupabaseManagementBackfillLockedHighWaterCaptureTransportOptionsV1 {
  /** Operation-scoped database-write PAT. It is used only in the Authorization header. */
  readonly personalAccessToken: string
  readonly authority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
  readonly fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch
  readonly signal?: AbortSignal
  /** Optional stricter deadline; callers cannot exceed the Host maximum. */
  readonly requestTimeoutMs?: number
}

export type SupabaseManagementBackfillLockedHighWaterCaptureTransportV1 =
  SupabaseBackfillLockedHighWaterCaptureHostTransportV1

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface ParsedOptions {
  readonly personalAccessToken: string
  readonly authority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
  readonly fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch
  readonly signal: AbortSignal | undefined
  readonly requestTimeoutMs: number
}

type RequestDeadline = SupabaseManagementRequestDeadline

const trustedCaptureTransports = new WeakSet<object>()

function fail(code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode): never {
  throw new SupabaseManagementBackfillLockedHighWaterCaptureTransportError(code)
}

function ownKeys(
  value: object,
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(value)
  } catch {
    return fail(code)
  }
}

function ownData(
  value: object,
  key: PropertyKey,
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
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

function plainRecord(
  value: unknown,
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail(code)
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail(code)
  }
  if (prototype !== Object.prototype && prototype !== null) return fail(code)
  const record = value as UnknownRecord
  for (const key of ownKeys(record, code)) {
    if (typeof key !== 'string') return fail(code)
    ownData(record, key, code)
  }
  return record
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
): UnknownRecord {
  const record = plainRecord(value, code)
  const keys = ownKeys(record, code)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return fail(code)
  }
  return record
}

function exactOptions(value: unknown): UnknownRecord {
  const record = plainRecord(value, 'invalid-authority')
  const keys = ownKeys(record, 'invalid-authority')
  const allowed = new Set<string>([...REQUIRED_OPTION_KEYS, ...OPTIONAL_OPTION_KEYS])
  if (
    REQUIRED_OPTION_KEYS.some((key) => !keys.includes(key)) ||
    keys.some((key) => typeof key !== 'string' || !allowed.has(key))
  ) {
    return fail('invalid-authority')
  }
  return record
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    utf8ByteLength(value) <=
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxPATBytes &&
    !/\p{Cc}/u.test(value)
  )
}

function stableId(
  value: unknown,
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) return fail(code)
  return value
}

function projectRef(
  value: unknown,
  code: SupabaseManagementBackfillLockedHighWaterCaptureTransportErrorCode
): string {
  if (typeof value !== 'string' || !PROJECT_REF.test(value)) return fail(code)
  return value
}

function parseAuthority(value: unknown): SupabaseBackfillLockedHighWaterWriteAuthorityV1 {
  const source = exactRecord(value, AUTHORITY_KEYS, 'invalid-authority')
  const scope = ownData(source, 'scope', 'invalid-authority')
  const permission = ownData(source, 'permission', 'invalid-authority')
  if (scope !== 'database:write' || permission !== 'database_write') {
    return fail('invalid-authority')
  }
  return Object.freeze({
    projectRef: projectRef(ownData(source, 'projectRef', 'invalid-authority'), 'invalid-authority'),
    accountId: stableId(ownData(source, 'accountId', 'invalid-authority'), 'invalid-authority'),
    grantGeneration: stableId(
      ownData(source, 'grantGeneration', 'invalid-authority'),
      'invalid-authority'
    ),
    scope: 'database:write' as const,
    permission: 'database_write' as const
  })
}

function parseSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined
  if (typeof AbortSignal === 'undefined' || !(value instanceof AbortSignal)) {
    return fail('invalid-authority')
  }
  return value
}

function boundedTimeout(value: unknown): number {
  if (value === undefined) {
    return SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.requestTimeoutMs
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) >
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.requestTimeoutMs
  ) {
    return fail('invalid-authority')
  }
  return value as number
}

function optionsSnapshot(value: unknown): ParsedOptions {
  const source = exactOptions(value)
  const personalAccessToken = ownData(source, 'personalAccessToken', 'invalid-authority')
  const fetcher = ownData(source, 'fetcher', 'invalid-authority')
  if (!validPAT(personalAccessToken) || typeof fetcher !== 'function') {
    return fail('invalid-authority')
  }
  return Object.freeze({
    personalAccessToken,
    authority: parseAuthority(ownData(source, 'authority', 'invalid-authority')),
    fetcher: fetcher as SupabaseManagementBackfillLockedHighWaterCaptureFetch,
    signal: parseSignal(
      ownKeys(source, 'invalid-authority').includes('signal')
        ? ownData(source, 'signal', 'invalid-authority')
        : undefined
    ),
    requestTimeoutMs: boundedTimeout(
      ownKeys(source, 'invalid-authority').includes('requestTimeoutMs')
        ? ownData(source, 'requestTimeoutMs', 'invalid-authority')
        : undefined
    )
  })
}

function sameAuthority(
  left: SupabaseBackfillLockedHighWaterWriteAuthorityV1,
  right: SupabaseBackfillLockedHighWaterWriteAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function wellFormedUTF8(value: string): boolean {
  try {
    return (
      new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value
    )
  } catch {
    return false
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestSQL(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('invalid-request')
  }
}

async function trustedRequestSnapshot(
  value: TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1,
  authority: SupabaseBackfillLockedHighWaterWriteAuthorityV1
): Promise<TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1> {
  const source = exactRecord(value, TRUSTED_REQUEST_KEYS, 'invalid-request')
  const captureSql = ownData(source, 'captureSql', 'invalid-request')
  const queryDigest = ownData(source, 'queryDigest', 'invalid-request')
  if (
    typeof captureSql !== 'string' ||
    captureSql.length === 0 ||
    captureSql.includes('\0') ||
    utf8ByteLength(captureSql) >
      SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxCaptureSQLBytes ||
    !wellFormedUTF8(captureSql) ||
    typeof queryDigest !== 'string' ||
    !DIGEST.test(queryDigest)
  ) {
    return fail('invalid-request')
  }
  const requestAuthority = Object.freeze({
    projectRef: projectRef(ownData(source, 'projectRef', 'invalid-request'), 'invalid-request'),
    accountId: stableId(ownData(source, 'accountId', 'invalid-request'), 'invalid-request'),
    grantGeneration: stableId(
      ownData(source, 'grantGeneration', 'invalid-request'),
      'invalid-request'
    ),
    scope: 'database:write' as const,
    permission: 'database_write' as const
  })
  if (!sameAuthority(requestAuthority, authority)) return fail('invalid-authority')
  if ((await digestSQL(captureSql)) !== queryDigest) return fail('invalid-request')
  return Object.freeze({
    projectRef: requestAuthority.projectRef,
    accountId: requestAuthority.accountId,
    grantGeneration: requestAuthority.grantGeneration,
    captureSql,
    queryDigest
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) return fail('aborted')
}

function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController()
  let timedOut = false
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) controller.abort(caller.reason)
  else caller?.addEventListener('abort', onCallerAbort, { once: true })
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(
      new DOMException('Supabase Management locked high-water request timed out', 'TimeoutError')
    )
  }, timeoutMs)
  return Object.freeze({
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Supabase Management locked high-water request aborted', 'AbortError')
}

function waitForAbortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal))
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([operation, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}

function abortFailure(deadline: RequestDeadline, caller: AbortSignal | undefined): never {
  if (deadline.timedOut()) return fail('timeout')
  if (caller?.aborted || deadline.signal.aborted) return fail('aborted')
  return fail('network-failed')
}

async function boundedBytes(
  response: Response,
  maximum: number,
  deadline: RequestDeadline,
  caller: AbortSignal | undefined
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    if (!/^\d+$/u.test(declared)) return fail('invalid-response')
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed)) return fail('invalid-response')
    if (parsed > maximum) {
      void response.body?.cancel().catch(() => undefined)
      return fail('response-too-large')
    }
  }
  if (!response.body) return fail('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    let result = await waitForAbortable(reader.read(), deadline.signal)
    while (!result.done) {
      length += result.value.byteLength
      if (length > maximum) {
        void reader.cancel().catch(() => undefined)
        return fail('response-too-large')
      }
      chunks.push(result.value)
      result = await waitForAbortable(reader.read(), deadline.signal)
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    if (cause instanceof SupabaseManagementBackfillLockedHighWaterCaptureTransportError) {
      throw cause
    }
    return abortFailure(deadline, caller)
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function validJSONMediaType(value: string | null): boolean {
  return value !== null && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value.trim())
}

async function requestJSON(
  fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  caller: AbortSignal | undefined
): Promise<unknown> {
  const deadline = requestDeadline(caller, timeoutMs)
  try {
    if (deadline.signal.aborted) return abortFailure(deadline, caller)
    let response: Response
    try {
      response = await waitForAbortable(
        fetcher(
          url,
          Object.freeze({ ...init, redirect: 'error' as const, signal: deadline.signal }),
          maximum,
          timeoutMs
        ),
        deadline.signal
      )
    } catch (cause) {
      if (cause instanceof SupabaseManagementBackfillLockedHighWaterCaptureTransportError) {
        throw cause
      }
      return abortFailure(deadline, caller)
    }
    if (
      response.redirected ||
      (response.url !== '' && response.url !== url) ||
      response.status !== expectedStatus
    ) {
      void response.body?.cancel().catch(() => undefined)
      return fail('http-error')
    }
    if (!validJSONMediaType(response.headers.get('content-type'))) {
      void response.body?.cancel().catch(() => undefined)
      return fail('invalid-response')
    }
    const bytes = await boundedBytes(response, maximum, deadline, caller)
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      return fail('invalid-response')
    }
  } finally {
    deadline.dispose()
  }
}

async function readProjectAuthority(
  fetcher: SupabaseManagementBackfillLockedHighWaterCaptureFetch,
  url: string,
  authorization: string,
  expected: TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<void> {
  const value = await requestJSON(
    fetcher,
    url,
    {
      method: 'GET',
      credentials: 'omit',
      headers: Object.freeze({ accept: 'application/json', authorization })
    },
    STATUS_OK,
    SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxProjectResponseBytes,
    timeoutMs,
    signal
  )
  const project = plainRecord(value, 'invalid-response')
  if (
    ownData(project, 'ref', 'invalid-response') !== expected.projectRef ||
    ownData(project, 'organization_id', 'invalid-response') !== expected.accountId
  ) {
    return fail('invalid-authority')
  }
}

function exactSingleCaptureRow(value: unknown): UnknownRecord {
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

/** Create one credential- and grant-bound transport for exactly one locked capture request. */
export function createSupabaseManagementBackfillLockedHighWaterCaptureTransport(
  options: CreateSupabaseManagementBackfillLockedHighWaterCaptureTransportOptionsV1
): SupabaseManagementBackfillLockedHighWaterCaptureTransportV1 {
  const parsed = optionsSnapshot(options)
  const authorization = `Bearer ${parsed.personalAccessToken}`
  let state: 'ready' | 'consumed' = 'ready'

  const transport = Object.freeze({
    async runLockedHighWaterCapture(
      request: SupabaseBackfillLockedHighWaterCaptureRequestV1
    ): Promise<unknown> {
      if (state !== 'ready') return fail('invalid-request')
      state = 'consumed'
      throwIfAborted(parsed.signal)

      let consumed: TrustedSupabaseBackfillLockedHighWaterCaptureRequestV1 | null
      try {
        consumed = consumeTrustedSupabaseBackfillLockedHighWaterCaptureRequestV1(request)
      } catch {
        return fail('invalid-request')
      }
      if (!consumed) return fail('invalid-request')
      const snapshot = await trustedRequestSnapshot(consumed, parsed.authority)
      throwIfAborted(parsed.signal)

      const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${snapshot.projectRef}`
      await readProjectAuthority(
        parsed.fetcher,
        projectURL,
        authorization,
        snapshot,
        parsed.requestTimeoutMs,
        parsed.signal
      )
      throwIfAborted(parsed.signal)

      const queryURL = `${projectURL}/database/query`
      const value = await requestJSON(
        parsed.fetcher,
        queryURL,
        {
          method: 'POST',
          credentials: 'omit',
          headers: Object.freeze({
            accept: 'application/json',
            authorization,
            'content-type': 'application/json'
          }),
          body: JSON.stringify({ query: snapshot.captureSql, read_only: false })
        },
        STATUS_CREATED,
        SUPABASE_MANAGEMENT_BACKFILL_LOCKED_HIGH_WATER_CAPTURE_LIMITS.maxCaptureResponseBytes,
        parsed.requestTimeoutMs,
        parsed.signal
      )
      const row = exactSingleCaptureRow(value)
      throwIfAborted(parsed.signal)
      await readProjectAuthority(
        parsed.fetcher,
        projectURL,
        authorization,
        snapshot,
        parsed.requestTimeoutMs,
        parsed.signal
      )
      throwIfAborted(parsed.signal)
      return row
    }
  }) satisfies SupabaseManagementBackfillLockedHighWaterCaptureTransportV1

  trustedCaptureTransports.add(transport)
  return transport
}

/** Only factory-created fixed-origin transports may cross the capture boundary. */
export function trustedSupabaseManagementBackfillLockedHighWaterCaptureTransportV1(
  value: unknown
): value is SupabaseManagementBackfillLockedHighWaterCaptureTransportV1 {
  return value !== null && typeof value === 'object' && trustedCaptureTransports.has(value)
}
