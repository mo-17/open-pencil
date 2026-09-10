/* oxlint-disable eslint(max-lines), open-pencil(no-mixed-case-acronym-identifiers), typescript-eslint(no-unnecessary-condition) -- This file keeps runtime trust-boundary checks and the operation-scoped Management, Auth, and Storage transport together for auditability. */
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseStagingTestUserInput } from '@/app/lowcode/supabase/credentials'
import type { SupabaseManagementAccountAuthorityV1 } from '@/app/lowcode/supabase/management-client'

import {
  SUPABASE_STORAGE_ISOLATION_LIMITS,
  SupabaseStorageIsolationError,
  type SupabaseStorageActorEvidence,
  type SupabaseStorageBucketEvidence,
  type SupabaseStorageIsolationAuthority,
  type SupabaseStorageIsolationTransport,
  type SupabaseStorageObjectProbeInput,
  type SupabaseStorageObjectProbeResult,
  type SupabaseStorageProbeActor
} from '../storage-isolation-verifier'
import type { SupabaseManagementRequestLifetime } from './transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+*-]{0,126}$/u

export const SUPABASE_MANAGEMENT_STORAGE_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxPublishableKeyBytes: 4_096,
  maxUserAccessTokenBytes: 16 * 1024,
  maxProjectResponseBytes: 128 * 1024,
  maxCatalogResponseBytes: 128 * 1024,
  maxAuthResponseBytes: 128 * 1024,
  maxMutationResponseBytes: 64 * 1024,
  maxDeniedResponseBytes: 64 * 1024,
  requestTimeoutMs: 30_000,
  probeTimeoutMs: 60_000
})

export type SupabaseManagementStorageFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementStorageAuthority = SupabaseManagementAccountAuthorityV1

export type SupabaseStorageTestUser = SupabaseStagingTestUserInput

export interface SupabaseTenantStoragePartitions {
  /** Tenant partition User A is expected to access. */
  readonly allowedPartition: string
  /** Different tenant partition User A and User B must not access in this probe. */
  readonly deniedPartition: string
}

export interface CreateSupabaseManagementStorageIsolationTransportOptions {
  /** Operation-scoped values resolved from the credential vault; never persisted or returned. */
  readonly personalAccessToken: string
  readonly publishableKey: string
  readonly authority: SupabaseManagementStorageAuthority
  readonly userA: SupabaseStorageTestUser
  readonly userB: SupabaseStorageTestUser
  /**
   * Required only for tenant-member path rules. New callers must key entries with
   * `supabaseTenantStoragePartitionKey(bucketName, ruleId)`. A rule-id-only key is
   * accepted for one bucket as a backwards-compatible fallback.
   */
  readonly tenantPartitions?: Readonly<Record<string, SupabaseTenantStoragePartitions>>
  readonly fetcher: SupabaseManagementStorageFetch
  readonly now: () => string
  readonly signal?: AbortSignal
  /** Optional stricter deadline; values cannot exceed the Host maximum. */
  readonly requestTimeoutMs?: number
  /** Optional stricter object-probe deadline; values cannot exceed the Host maximum. */
  readonly probeTimeoutMs?: number
}

interface UnknownRecord {
  [key: string]: unknown
}

interface ActorSession {
  readonly actor: Exclude<SupabaseStorageProbeActor, 'anonymous'>
  readonly expectedUserId: string
  readonly accessToken: string
}

interface BoundedResponse {
  readonly status: number
  readonly bytes: Uint8Array
  readonly contentType: string | null
}

type RequestDeadline = SupabaseManagementRequestLifetime

function fail(code: ConstructorParameters<typeof SupabaseStorageIsolationError>[0]): never {
  throw new SupabaseStorageIsolationError(code)
}

function controlFree(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <= maximum &&
    !/\p{Cc}/u.test(value)
  )
}

function stableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) return fail('invalid-authority')
  return value
}

export function supabaseTenantStoragePartitionKey(bucketName: string, ruleId: string): string {
  return `${stableId(bucketName)}/${stableId(ruleId)}`
}

function boundedTimeout(value: unknown, maximum: number): number {
  if (value === undefined) return maximum
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return fail('invalid-authority')
  }
  return value as number
}

function pathSegment(value: unknown): string {
  if (typeof value !== 'string' || !PATH_SEGMENT.test(value)) return fail('invalid-probe')
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

function ownValue(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('invalid-response')
  }
  return descriptor.value
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail('invalid-response')
  }
  const canonical = new Date(value).toISOString()
  if (canonical !== value) return fail('invalid-response')
  return value
}

function sameAuthority(
  actual: SupabaseManagementStorageAuthority,
  expected: SupabaseManagementStorageAuthority
): boolean {
  return (
    actual.projectRef === expected.projectRef &&
    actual.accountId === expected.accountId &&
    actual.grantGeneration === expected.grantGeneration
  )
}

function releaseAuthority(
  authority: SupabaseStorageIsolationAuthority
): SupabaseManagementStorageAuthority {
  return {
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.grantGeneration
  }
}

function validateAuthority(authority: SupabaseManagementStorageAuthority): void {
  if (!PROJECT_REF.test(authority.projectRef)) return fail('invalid-authority')
  stableId(authority.accountId)
  stableId(authority.grantGeneration)
}

function validateProject(value: unknown, expected: SupabaseManagementStorageAuthority): void {
  const project = plainRecord(value)
  if (
    ownValue(project, 'ref') !== expected.projectRef ||
    ownValue(project, 'organization_id') !== expected.accountId
  ) {
    fail('invalid-authority')
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('transport-failed')
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
      controller.abort(new DOMException('Supabase Storage request timed out', 'TimeoutError'))
    }, timeoutMs)
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Supabase Storage request aborted', 'AbortError')
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
  signal: AbortSignal
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
      return fail('invalid-response')
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
        return fail('invalid-response')
      }
      chunks.push(result.value)
      result = await waitForAbortable(reader.read(), signal)
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

async function boundedResponse(
  fetcher: SupabaseManagementStorageFetch,
  url: string,
  init: RequestInit,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<BoundedResponse> {
  const deadline = requestDeadline(signal, timeoutMs)
  try {
    throwIfAborted(deadline.signal)
    const response = await waitForAbortable(
      fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
      deadline.signal
    )
    throwIfAborted(deadline.signal)
    if (response.redirected || (response.url !== '' && response.url !== url)) {
      return fail('transport-failed')
    }
    return {
      status: response.status,
      bytes: await boundedBytes(response, maximum, deadline.signal),
      contentType: response.headers.get('content-type')
    }
  } catch (error) {
    if (error instanceof SupabaseStorageIsolationError) throw error
    return fail('transport-failed')
  } finally {
    deadline.dispose()
  }
}

function parseJSON(response: BoundedResponse, expectedStatus: number): unknown {
  if (
    response.status !== expectedStatus ||
    !response.contentType ||
    !/^application\/json(?:\s*;.*)?$/iu.test(response.contentType)
  ) {
    return fail(
      response.status >= 400 && response.status < 500 ? 'invalid-authority' : 'transport-failed'
    )
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes))
  } catch {
    return fail('invalid-response')
  }
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer
}

function encodePath(value: string): string {
  const segments = value.split('/')
  if (
    segments.length === 0 ||
    segments.some((segment) => !PATH_SEGMENT.test(segment)) ||
    new TextEncoder().encode(value).byteLength > SUPABASE_STORAGE_ISOLATION_LIMITS.maxPathBytes
  ) {
    return fail('invalid-probe')
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/')
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function parsePositiveInteger(value: unknown): number {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    return fail('invalid-response')
  }
  return parsed
}

function parseMimeTypes(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 64 ||
    value.some((entry) => typeof entry !== 'string' || !MIME_TYPE.test(entry)) ||
    new Set(value).size !== value.length
  ) {
    return fail('invalid-response')
  }
  return Object.freeze([...value].sort((left, right) => left.localeCompare(right, 'en')))
}

function verifyUser(value: unknown, expectedUserId: string): string {
  const record = plainRecord(value)
  const id = ownValue(record, 'id')
  if (id !== expectedUserId || typeof id !== 'string' || !PATH_SEGMENT.test(id)) {
    fail('invalid-authority')
  }
  return id
}

function validateProbe(input: SupabaseStorageObjectProbeInput): void {
  stableId(input.bucketName)
  encodePath(input.objectPath)
  if (!MIME_TYPE.test(input.mimeType)) return fail('invalid-probe')
  const expectsContent =
    input.operation === 'create' || input.operation === 'update' || input.operation === 'upsert'
  if (
    (expectsContent && !(input.content instanceof Uint8Array)) ||
    (!expectsContent && input.content !== null) ||
    (input.content?.byteLength ?? 0) > SUPABASE_STORAGE_ISOLATION_LIMITS.maxProbePayloadBytes
  ) {
    return fail('invalid-probe')
  }
}

function actorHeaders(
  actor: SupabaseStorageProbeActor,
  publishableKey: string,
  sessions: Readonly<Record<'user-a' | 'user-b', ActorSession>>
): Record<string, string> {
  const headers: Record<string, string> = { apikey: publishableKey }
  if (actor !== 'anonymous') headers.authorization = `Bearer ${sessions[actor].accessToken}`
  return headers
}

function probeRequest(
  input: SupabaseStorageObjectProbeInput,
  origin: string,
  publishableKey: string,
  sessions: Readonly<Record<'user-a' | 'user-b', ActorSession>>
): { readonly url: string; readonly init: RequestInit } {
  const bucket = encodeURIComponent(stableId(input.bucketName))
  const objectPath = encodePath(input.objectPath)
  const headers = actorHeaders(input.actor, publishableKey, sessions)
  if (input.operation === 'delete') {
    return {
      url: `${origin}/storage/v1/object/${bucket}`,
      init: {
        method: 'DELETE',
        credentials: 'omit',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [input.objectPath] })
      }
    }
  }
  const url = `${origin}/storage/v1/object/${bucket}/${objectPath}`
  if (input.operation === 'read') {
    return { url, init: { method: 'GET', credentials: 'omit', headers } }
  }
  return {
    url,
    init: {
      method: input.operation === 'update' ? 'PUT' : 'POST',
      credentials: 'omit',
      headers: {
        ...headers,
        'content-type': input.mimeType,
        ...(input.operation === 'create' || input.operation === 'upsert'
          ? { 'x-upsert': String(input.operation === 'upsert') }
          : {})
      },
      body: ownedBuffer(input.content as Uint8Array)
    }
  }
}

function probeResponseMaximum(
  operation: SupabaseStorageObjectProbeInput['operation'],
  expected: Uint8Array | undefined
): number {
  return operation === 'read'
    ? Math.max(expected?.byteLength ?? 0, SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxDeniedResponseBytes)
    : SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxMutationResponseBytes
}

function objectIdentity(input: SupabaseStorageObjectProbeInput): string {
  return `${input.bucketName}\u0000${input.objectPath}`
}

function invalidJwtResponse(bytes: Uint8Array): boolean {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const record = value as UnknownRecord
    return ['code', 'error', 'error_code'].some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      return (
        descriptor?.enumerable === true &&
        typeof descriptor.value === 'string' &&
        descriptor.value.replaceAll(/[-_\s]/gu, '').toLowerCase() === 'invalidjwt'
      )
    })
  } catch {
    return false
  }
}

function probeOutcome(
  input: SupabaseStorageObjectProbeInput,
  response: BoundedResponse
): 'allowed' | 'denied' {
  if (response.status >= 200 && response.status < 300) return 'allowed'
  if (
    input.actor !== 'anonymous' &&
    (response.status === 401 || invalidJwtResponse(response.bytes))
  ) {
    return fail('invalid-authority')
  }
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return 'denied'
  }
  return fail('transport-failed')
}

function verifyReadResult(
  input: SupabaseStorageObjectProbeInput,
  outcome: 'allowed' | 'denied',
  expected: Uint8Array | undefined,
  response: BoundedResponse
): void {
  if (
    outcome === 'allowed' &&
    input.operation === 'read' &&
    (!expected || !sameBytes(expected, response.bytes))
  ) {
    fail('invalid-response')
  }
}

interface DeleteConfirmationContext {
  readonly input: SupabaseStorageObjectProbeInput
  readonly expected: Uint8Array | undefined
  readonly fetcher: SupabaseManagementStorageFetch
  readonly projectOrigin: string
  readonly publishableKey: string
  readonly sessions: Readonly<Record<'user-a' | 'user-b', ActorSession>>
  readonly timeoutMs: number
  readonly signal: AbortSignal | undefined
}

async function confirmDeletedObject(context: DeleteConfirmationContext): Promise<BoundedResponse> {
  const confirmation = probeRequest(
    { ...context.input, operation: 'read', content: null },
    context.projectOrigin,
    context.publishableKey,
    context.sessions
  )
  const response = await boundedResponse(
    context.fetcher,
    confirmation.url,
    confirmation.init,
    probeResponseMaximum('read', context.expected),
    context.timeoutMs,
    context.signal
  )
  if (response.status === 404) return response
  if (response.status >= 500 || response.status === 408 || response.status === 429) {
    return fail('transport-failed')
  }
  return fail('invalid-response')
}

export function createSupabaseManagementStorageIsolationTransport(
  options: CreateSupabaseManagementStorageIsolationTransportOptions
): SupabaseStorageIsolationTransport {
  validateAuthority(options.authority)
  const requestTimeoutMs = boundedTimeout(
    options.requestTimeoutMs,
    SUPABASE_MANAGEMENT_STORAGE_LIMITS.requestTimeoutMs
  )
  const probeTimeoutMs = boundedTimeout(
    options.probeTimeoutMs,
    SUPABASE_MANAGEMENT_STORAGE_LIMITS.probeTimeoutMs
  )
  const sessions = Object.freeze({
    'user-a': Object.freeze({
      actor: 'user-a' as const,
      expectedUserId: options.userA.userId,
      accessToken: options.userA.accessToken
    }),
    'user-b': Object.freeze({
      actor: 'user-b' as const,
      expectedUserId: options.userB.userId,
      accessToken: options.userB.accessToken
    })
  })
  if (
    !controlFree(options.personalAccessToken, SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxPATBytes) ||
    !controlFree(
      options.publishableKey,
      SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxPublishableKeyBytes
    ) ||
    !options.publishableKey.startsWith('sb_publishable_') ||
    !controlFree(
      sessions['user-a'].accessToken,
      SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxUserAccessTokenBytes
    ) ||
    !controlFree(
      sessions['user-b'].accessToken,
      SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxUserAccessTokenBytes
    ) ||
    sessions['user-a'].accessToken === sessions['user-b'].accessToken ||
    typeof options.fetcher !== 'function' ||
    typeof options.now !== 'function'
  ) {
    return fail('invalid-authority')
  }
  pathSegment(sessions['user-a'].expectedUserId)
  pathSegment(sessions['user-b'].expectedUserId)
  if (sessions['user-a'].expectedUserId === sessions['user-b'].expectedUserId) {
    return fail('invalid-authority')
  }

  const authorization = `Bearer ${options.personalAccessToken}`
  const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${options.authority.projectRef}`
  const projectOrigin = `https://${options.authority.projectRef}.supabase.co`
  const projectHeaders = Object.freeze({ accept: 'application/json', authorization })
  const expectedObjects = new Map<string, Uint8Array>()
  const legacyTenantRuleBuckets = new Map<string, string>()
  let operationSequence = 0

  const evidence = async (kind: string, value: Readonly<Record<string, unknown>>) => {
    const checkedAt = canonicalTimestamp(options.now())
    const evidenceDigest = await digestCanonicalManifest({
      format: 'openpencil.supabase-storage-transport-evidence.v1',
      version: 1,
      kind,
      checkedAt,
      projectRef: options.authority.projectRef,
      accountId: options.authority.accountId,
      grantGeneration: options.authority.grantGeneration,
      ...value
    })
    operationSequence += 1
    return Object.freeze({
      evidenceDigest,
      operationId: `storage-${kind}-${operationSequence}-${evidenceDigest.slice(0, 24)}`
    })
  }

  const recheckProject = async (): Promise<void> => {
    const response = await boundedResponse(
      options.fetcher,
      projectURL,
      { method: 'GET', credentials: 'omit', headers: projectHeaders },
      SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxProjectResponseBytes,
      requestTimeoutMs,
      options.signal
    )
    validateProject(parseJSON(response, 200), options.authority)
  }

  const liveUser = async (session: ActorSession): Promise<string> => {
    const url = `${projectOrigin}/auth/v1/user`
    const response = await boundedResponse(
      options.fetcher,
      url,
      {
        method: 'GET',
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          apikey: options.publishableKey,
          authorization: `Bearer ${session.accessToken}`
        }
      },
      SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxAuthResponseBytes,
      requestTimeoutMs,
      options.signal
    )
    return verifyUser(parseJSON(response, 200), session.expectedUserId)
  }

  return Object.freeze({
    async recheckAuthority(authority: SupabaseStorageIsolationAuthority) {
      if (
        authority.releaseAuthority !== 'host.supabase-storage-isolation.v1' ||
        !sameAuthority(releaseAuthority(authority), options.authority)
      ) {
        fail('invalid-authority')
      }
      await recheckProject()
    },

    async inspectBucket(
      input: Parameters<SupabaseStorageIsolationTransport['inspectBucket']>[0]
    ): Promise<SupabaseStorageBucketEvidence> {
      if (input.projectRef !== options.authority.projectRef) return fail('invalid-authority')
      const bucketName = stableId(input.bucketName)
      const url = `${MANAGEMENT_ORIGIN}/v1/projects/${input.projectRef}/database/query/read-only`
      const query =
        'select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = $1 limit 2'
      const response = await boundedResponse(
        options.fetcher,
        url,
        {
          method: 'POST',
          credentials: 'omit',
          headers: {
            accept: 'application/json',
            authorization,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ query, parameters: [bucketName] })
        },
        SUPABASE_MANAGEMENT_STORAGE_LIMITS.maxCatalogResponseBytes,
        requestTimeoutMs,
        options.signal
      )
      const rows = parseJSON(response, 201)
      if (!Array.isArray(rows) || rows.length !== 1) return fail('invalid-response')
      const row = plainRecord(rows[0])
      if (ownValue(row, 'id') !== bucketName || ownValue(row, 'name') !== bucketName) {
        return fail('invalid-response')
      }
      if (ownValue(row, 'public') !== false) return fail('invalid-response')
      const maxObjectBytes = parsePositiveInteger(ownValue(row, 'file_size_limit'))
      const allowedMimeTypes = parseMimeTypes(ownValue(row, 'allowed_mime_types'))
      const proof = await evidence('bucket', {
        bucketName,
        private: true,
        maxObjectBytes,
        allowedMimeTypes
      })
      return Object.freeze({
        bucketName,
        private: true,
        maxObjectBytes,
        allowedMimeTypes,
        ...proof
      })
    },

    async resolveActors(
      input: Parameters<SupabaseStorageIsolationTransport['resolveActors']>[0]
    ): Promise<SupabaseStorageActorEvidence> {
      if (input.projectRef !== options.authority.projectRef) return fail('invalid-authority')
      stableId(input.bucketName)
      const [userAId, userBId] = await Promise.all([
        liveUser(sessions['user-a']),
        liveUser(sessions['user-b'])
      ])
      if (userAId === userBId) return fail('invalid-authority')
      let allowedPartition: string
      let deniedPartition: string
      if (input.rule.principal.kind === 'owner') {
        allowedPartition = userAId
        deniedPartition = userBId
      } else {
        const ruleId = stableId(input.rule.id)
        const bucketName = stableId(input.bucketName)
        const compoundKey = supabaseTenantStoragePartitionKey(bucketName, ruleId)
        let partitions = options.tenantPartitions?.[compoundKey]
        if (!partitions) {
          partitions = options.tenantPartitions?.[ruleId]
          if (partitions) {
            const previousBucket = legacyTenantRuleBuckets.get(ruleId)
            if (previousBucket && previousBucket !== bucketName) return fail('invalid-authority')
            legacyTenantRuleBuckets.set(ruleId, bucketName)
          }
        }
        if (!partitions) return fail('invalid-authority')
        allowedPartition = pathSegment(partitions.allowedPartition)
        deniedPartition = pathSegment(partitions.deniedPartition)
      }
      if (allowedPartition === deniedPartition) return fail('invalid-authority')
      const proof = await evidence('actors', {
        bucketName: input.bucketName,
        ruleId: input.rule.id,
        principal: input.rule.principal.kind,
        userAId,
        userBId,
        allowedPartition,
        deniedPartition
      })
      return Object.freeze({ userAId, userBId, allowedPartition, deniedPartition, ...proof })
    },

    async probeObject(
      input: SupabaseStorageObjectProbeInput
    ): Promise<SupabaseStorageObjectProbeResult> {
      validateProbe(input)
      const request = probeRequest(input, projectOrigin, options.publishableKey, sessions)
      const expectedObjectKey = objectIdentity(input)
      const expected = expectedObjects.get(expectedObjectKey)
      const response = await boundedResponse(
        options.fetcher,
        request.url,
        request.init,
        probeResponseMaximum(input.operation, expected),
        probeTimeoutMs,
        options.signal
      )
      const outcome = probeOutcome(input, response)
      verifyReadResult(input, outcome, expected, response)
      const cleanupConfirmation =
        outcome === 'allowed' && input.operation === 'delete'
          ? await confirmDeletedObject({
              input,
              expected,
              fetcher: options.fetcher,
              projectOrigin,
              publishableKey: options.publishableKey,
              sessions,
              timeoutMs: probeTimeoutMs,
              signal: options.signal
            })
          : undefined
      if (outcome === 'allowed' && input.content) {
        expectedObjects.set(expectedObjectKey, input.content.slice())
      }
      if (cleanupConfirmation) expectedObjects.delete(expectedObjectKey)
      const proof = await evidence('probe', {
        actor: input.actor,
        operation: input.operation,
        bucketName: input.bucketName,
        objectPath: input.objectPath,
        mimeType: input.mimeType,
        requestByteLength: input.content?.byteLength ?? 0,
        status: response.status,
        responseByteLength: response.bytes.byteLength,
        cleanupConfirmationStatus: cleanupConfirmation?.status ?? null,
        cleanupConfirmationResponseByteLength: cleanupConfirmation?.bytes.byteLength ?? null
      })
      return Object.freeze({
        outcome,
        status: response.status,
        ...proof
      })
    }
  })
}
