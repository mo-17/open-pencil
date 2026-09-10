import type { SupabaseManagementProjectAuthorityV1 } from '@/app/lowcode/supabase/management-client'
/* oxlint-disable eslint(max-lines), open-pencil(no-mixed-case-acronym-identifiers) -- Keep the complete fixed-origin mutation boundary in one auditable module. */
import {
  consumeTrustedSupabaseBackfillWriteBarrierInstallDispatchContextV1,
  type SupabaseBackfillWriteBarrierInstallDispatchContextV1,
  type TrustedSupabaseBackfillWriteBarrierInstallDispatchV1
} from '@/app/plugins/host/deployment/supabase/backfill/write-barrier/install'

import type {
  SupabaseManagementBoundedResponse,
  SupabaseManagementRequestLifetime
} from '../transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MIGRATION_NAME = /^[a-z][a-z0-9_]{0,126}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u

export const SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxProjectResponseBytes: 128 * 1024,
  maxMigrationResponseBytes: 64 * 1024,
  maxMigrationSQLBytes: 1_048_576,
  maxMigrationNameBytes: 127,
  requestTimeoutMs: 180_000
})

export type SupabaseManagementBackfillWriteBarrierInstallFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementBackfillWriteBarrierInstallTransportOutcome =
  | 'not-dispatched'
  | 'outcome-unknown'

export type SupabaseManagementBackfillWriteBarrierInstallTransportErrorCode =
  | 'aborted'
  | 'dispatch-already-used'
  | 'http-error'
  | 'invalid-authority'
  | 'journal-permit-invalid'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'

export class SupabaseManagementBackfillWriteBarrierInstallTransportError extends Error {
  constructor(
    readonly code: SupabaseManagementBackfillWriteBarrierInstallTransportErrorCode,
    readonly outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
  ) {
    super(`Supabase Management backfill write-barrier install transport failed: ${code}.`)
    this.name = 'SupabaseManagementBackfillWriteBarrierInstallTransportError'
  }
}

export type SupabaseManagementBackfillWriteBarrierInstallProjectAuthorityV1 =
  SupabaseManagementProjectAuthorityV1

export interface SupabaseManagementBackfillWriteBarrierInstallConfirmationV1 {
  readonly status: 200
  readonly migrationName: string
  readonly installDigest: string
}

export interface SupabaseManagementPreparedBackfillWriteBarrierInstallV1 {
  readonly projectAuthority: SupabaseManagementBackfillWriteBarrierInstallProjectAuthorityV1
  dispatch(): Promise<SupabaseManagementBackfillWriteBarrierInstallConfirmationV1>
}

export interface SupabaseManagementBackfillWriteBarrierInstallTransportV1 {
  prepareMigration(
    context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
  ): Promise<SupabaseManagementPreparedBackfillWriteBarrierInstallV1>
}

export interface CreateSupabaseManagementBackfillWriteBarrierInstallTransportOptions {
  /** Operation-scoped database-write PAT. It is used only in the Authorization header. */
  readonly personalAccessToken: string
  readonly fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch
  readonly signal?: AbortSignal
  /** Optional stricter deadline; callers cannot exceed the Host maximum. */
  readonly requestTimeoutMs?: number
}

interface UnknownRecord {
  [key: string]: unknown
}

type TrustedInstallSnapshot = TrustedSupabaseBackfillWriteBarrierInstallDispatchV1

type RequestDeadline = SupabaseManagementRequestLifetime

type BoundedResponse = SupabaseManagementBoundedResponse

const STATUS_OK = 200 as const
const trustedInstallTransports = new WeakSet<object>()

function fail(
  code: SupabaseManagementBackfillWriteBarrierInstallTransportErrorCode,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): never {
  throw new SupabaseManagementBackfillWriteBarrierInstallTransportError(code, outcome)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    utf8ByteLength(value) <=
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxPATBytes &&
    !/\p{Cc}/u.test(value)
  )
}

function boundedTimeout(value: unknown): number {
  if (value === undefined) {
    return SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.requestTimeoutMs
  }
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.requestTimeoutMs
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return value as number
}

function plainRecord(
  value: unknown,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-response', outcome)
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return fail('invalid-response', outcome)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail('invalid-response', outcome)
  }
  return value as UnknownRecord
}

function ownData(
  record: UnknownRecord,
  key: string,
  code: 'invalid-authority' | 'invalid-request' | 'invalid-response',
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(record, key)
  } catch {
    return fail(code, outcome)
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code, outcome)
  return descriptor.value
}

function ownKeys(
  record: UnknownRecord,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): readonly PropertyKey[] {
  try {
    return Reflect.ownKeys(record)
  } catch {
    return fail('invalid-response', outcome)
  }
}

function exactTrustedRecord(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-request', 'not-dispatched')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-request', 'not-dispatched')
  }
  const expectedKeys: readonly string[] = [
    'projectRef',
    'accountId',
    'grantGeneration',
    'migrationName',
    'installSql',
    'installDigest'
  ]
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  return value as UnknownRecord
}

function trustedText(source: UnknownRecord, key: string): string {
  const value = ownData(source, key, 'invalid-request', 'not-dispatched')
  if (typeof value !== 'string') return fail('invalid-request', 'not-dispatched')
  return value
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

function validateTrustedSnapshot(value: unknown): TrustedInstallSnapshot {
  const source = exactTrustedRecord(value)
  const projectRef = trustedText(source, 'projectRef')
  const accountId = trustedText(source, 'accountId')
  const grantGeneration = trustedText(source, 'grantGeneration')
  const migrationName = trustedText(source, 'migrationName')
  const installSql = trustedText(source, 'installSql')
  const installDigest = trustedText(source, 'installDigest')
  if (
    !PROJECT_REF.test(projectRef) ||
    !STABLE_ID.test(accountId) ||
    !STABLE_ID.test(grantGeneration) ||
    !MIGRATION_NAME.test(migrationName) ||
    utf8ByteLength(migrationName) >
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxMigrationNameBytes ||
    installSql.length === 0 ||
    utf8ByteLength(installSql) >
      SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxMigrationSQLBytes ||
    !DIGEST.test(installDigest) ||
    !wellFormedUTF8(installSql)
  ) {
    return fail('invalid-request', 'not-dispatched')
  }
  return Object.freeze({
    projectRef,
    accountId,
    grantGeneration,
    migrationName,
    installSql,
    installDigest
  })
}

function throwIfAborted(
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): void {
  if (signal?.aborted) fail('aborted', outcome)
}

function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) {
    controller.abort(caller.reason)
  } else {
    caller?.addEventListener('abort', onCallerAbort, { once: true })
    timeout = setTimeout(() => {
      controller.abort(
        new DOMException('Supabase Management migration request timed out', 'TimeoutError')
      )
    }, timeoutMs)
  }
  return Object.freeze({
    signal: controller.signal,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  })
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Supabase Management migration request aborted', 'AbortError')
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

async function boundedBytes(
  response: Response,
  maximum: number,
  signal: AbortSignal,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
      return fail('response-too-large', outcome)
    }
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    let result = await waitForAbortable(reader.read(), signal)
    while (!result.done) {
      length += result.value.byteLength
      if (length > maximum) {
        void reader.cancel().catch(() => undefined)
        return fail('response-too-large', outcome)
      }
      chunks.push(result.value)
      result = await waitForAbortable(reader.read(), signal)
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined)
    if (cause instanceof SupabaseManagementBackfillWriteBarrierInstallTransportError) {
      throw cause
    }
    return fail(signal.aborted ? 'aborted' : 'network-failed', outcome)
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

async function boundedResponse(
  fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch,
  url: string,
  init: RequestInit,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): Promise<BoundedResponse> {
  const deadline = requestDeadline(signal, timeoutMs)
  try {
    throwIfAborted(deadline.signal, outcome)
    let response: Response
    try {
      response = await waitForAbortable(
        fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
        deadline.signal
      )
    } catch (cause) {
      if (cause instanceof SupabaseManagementBackfillWriteBarrierInstallTransportError) {
        throw cause
      }
      return fail(deadline.signal.aborted ? 'aborted' : 'network-failed', outcome)
    }
    throwIfAborted(deadline.signal, outcome)
    return Object.freeze({
      status: response.status,
      url: response.url,
      redirected: response.redirected,
      contentType: response.headers.get('content-type'),
      bytes: await boundedBytes(response, maximum, deadline.signal, outcome)
    })
  } catch (cause) {
    if (cause instanceof SupabaseManagementBackfillWriteBarrierInstallTransportError) {
      throw cause
    }
    return fail(deadline.signal.aborted ? 'aborted' : 'network-failed', outcome)
  } finally {
    deadline.dispose()
  }
}

async function requestJSON(
  fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  outcome: SupabaseManagementBackfillWriteBarrierInstallTransportOutcome
): Promise<unknown> {
  const response = await boundedResponse(fetcher, url, init, maximum, timeoutMs, signal, outcome)
  if (
    response.redirected ||
    (response.url !== '' && response.url !== url) ||
    response.status !== expectedStatus
  ) {
    return fail('http-error', outcome)
  }
  if (!response.contentType || !/^application\/json(?:\s*;.*)?$/iu.test(response.contentType)) {
    return fail('invalid-response', outcome)
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes))
  } catch {
    return fail('invalid-response', outcome)
  }
}

function projectAuthority(
  value: unknown,
  expected: TrustedInstallSnapshot
): SupabaseManagementBackfillWriteBarrierInstallProjectAuthorityV1 {
  const project = plainRecord(value, 'not-dispatched')
  const ref = ownData(project, 'ref', 'invalid-authority', 'not-dispatched')
  const organizationId = ownData(project, 'organization_id', 'invalid-authority', 'not-dispatched')
  if (
    ref !== expected.projectRef ||
    organizationId !== expected.accountId ||
    typeof organizationId !== 'string' ||
    !STABLE_ID.test(organizationId)
  ) {
    return fail('invalid-authority', 'not-dispatched')
  }
  return Object.freeze({
    projectRef: expected.projectRef,
    organizationId,
    grantGeneration: expected.grantGeneration
  })
}

async function readProjectAuthority(
  fetcher: SupabaseManagementBackfillWriteBarrierInstallFetch,
  projectURL: string,
  authorization: string,
  expected: TrustedInstallSnapshot,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<SupabaseManagementBackfillWriteBarrierInstallProjectAuthorityV1> {
  const value = await requestJSON(
    fetcher,
    projectURL,
    {
      method: 'GET',
      credentials: 'omit',
      headers: Object.freeze({ accept: 'application/json', authorization })
    },
    STATUS_OK,
    SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxProjectResponseBytes,
    timeoutMs,
    signal,
    'not-dispatched'
  )
  return projectAuthority(value, expected)
}

function exactEmptyObject(value: unknown): void {
  const confirmation = plainRecord(value, 'outcome-unknown')
  if (ownKeys(confirmation, 'outcome-unknown').length !== 0) {
    fail('invalid-response', 'outcome-unknown')
  }
}

async function consumeControllerJournalPermit(
  context: object,
  expected: Readonly<{
    projectRef: string
    accountId: string
    grantGeneration: string
    migrationName: string
    installDigest: string
  }>
): Promise<boolean> {
  try {
    const controller =
      await import('@/app/plugins/host/deployment/supabase/backfill/write-barrier/install-controller')
    return await controller.consumeTrustedSupabaseBackfillWriteBarrierJournalPermitV1(
      context,
      expected
    )
  } catch {
    return false
  }
}

export function createSupabaseManagementBackfillWriteBarrierInstallTransport(
  options: CreateSupabaseManagementBackfillWriteBarrierInstallTransportOptions
): SupabaseManagementBackfillWriteBarrierInstallTransportV1 {
  if (!validPAT(options.personalAccessToken) || typeof options.fetcher !== 'function') {
    return fail('invalid-authority', 'not-dispatched')
  }
  const timeoutMs = boundedTimeout(options.requestTimeoutMs)
  const authorization = `Bearer ${options.personalAccessToken}`
  const fetcher = options.fetcher
  const signal = options.signal
  let state: 'ready' | 'preparing' | 'prepared' | 'consumed' = 'ready'

  const transport = Object.freeze({
    async prepareMigration(
      context: SupabaseBackfillWriteBarrierInstallDispatchContextV1
    ): Promise<SupabaseManagementPreparedBackfillWriteBarrierInstallV1> {
      if (state !== 'ready') return fail('invalid-request', 'not-dispatched')
      state = 'preparing'
      let consumed: unknown
      try {
        consumed = consumeTrustedSupabaseBackfillWriteBarrierInstallDispatchContextV1(context)
      } catch {
        state = 'consumed'
        return fail('invalid-request', 'not-dispatched')
      }
      if (consumed === null) {
        state = 'consumed'
        return fail('invalid-request', 'not-dispatched')
      }
      const snapshot = validateTrustedSnapshot(consumed)
      const permitContext = context as object
      const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${snapshot.projectRef}`
      let authority: SupabaseManagementBackfillWriteBarrierInstallProjectAuthorityV1
      try {
        authority = await readProjectAuthority(
          fetcher,
          projectURL,
          authorization,
          snapshot,
          timeoutMs,
          signal
        )
      } catch (cause) {
        state = 'consumed'
        throw cause
      }
      state = 'prepared'
      let dispatched = false
      const body = JSON.stringify({ query: snapshot.installSql, name: snapshot.migrationName })

      return Object.freeze({
        projectAuthority: authority,
        async dispatch(): Promise<SupabaseManagementBackfillWriteBarrierInstallConfirmationV1> {
          if (dispatched || state !== 'prepared') {
            return fail('dispatch-already-used', 'outcome-unknown')
          }
          dispatched = true
          state = 'consumed'
          if (
            !(await consumeControllerJournalPermit(
              permitContext,
              Object.freeze({
                projectRef: snapshot.projectRef,
                accountId: snapshot.accountId,
                grantGeneration: snapshot.grantGeneration,
                migrationName: snapshot.migrationName,
                installDigest: snapshot.installDigest
              })
            ))
          ) {
            return fail('journal-permit-invalid', 'not-dispatched')
          }
          throwIfAborted(signal, 'not-dispatched')
          await readProjectAuthority(
            fetcher,
            projectURL,
            authorization,
            snapshot,
            timeoutMs,
            signal
          )
          throwIfAborted(signal, 'not-dispatched')
          const url = `${MANAGEMENT_ORIGIN}/v1/projects/${snapshot.projectRef}/database/migrations`
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
              body
            },
            STATUS_OK,
            SUPABASE_MANAGEMENT_BACKFILL_WRITE_BARRIER_INSTALL_LIMITS.maxMigrationResponseBytes,
            timeoutMs,
            signal,
            'outcome-unknown'
          )
          exactEmptyObject(value)
          return Object.freeze({
            status: STATUS_OK,
            migrationName: snapshot.migrationName,
            installDigest: snapshot.installDigest
          })
        }
      })
    }
  })
  trustedInstallTransports.add(transport)
  return transport
}

/** Only factory-created fixed-origin transports may cross the Host controller boundary. */
export function trustedSupabaseManagementBackfillWriteBarrierInstallTransportV1(
  value: unknown
): value is SupabaseManagementBackfillWriteBarrierInstallTransportV1 {
  return value !== null && typeof value === 'object' && trustedInstallTransports.has(value)
}
