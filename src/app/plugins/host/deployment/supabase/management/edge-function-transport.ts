/* oxlint-disable eslint(max-lines), typescript-eslint(no-unnecessary-condition), typescript-eslint(no-unnecessary-boolean-literal-compare) -- Host transport inputs are runtime trust-boundary data despite their literal TypeScript fields; its release flow stays together for auditability. */
import { zipSync, type Zippable } from 'fflate'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type { SupabaseManagementAccountAuthorityV1 } from '@/app/lowcode/supabase/management-client'

import {
  SupabaseEdgeFunctionReleaseError,
  type SupabaseEdgeFunctionDeployInput,
  type SupabaseEdgeFunctionDeployResult,
  type SupabaseEdgeFunctionHealthEvidence,
  type SupabaseEdgeFunctionHealthInput,
  type SupabaseEdgeFunctionReleaseAuthority,
  type SupabaseEdgeFunctionReleaseTransports,
  type SupabaseEdgeFunctionSecretInspectionEvidence,
  type SupabaseEdgeFunctionSecretInspectionInput
} from '../edge-function-release'
import type { SupabaseManagementRequestDeadline } from './transport-runtime'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const SHA256 = /^[A-Za-z0-9_-]{43}$/u
const FUNCTION_SLUG = /^[a-z](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u
// Supabase injects both values for every hosted Edge Function. Only application-defined names
// need to be proven through the Management secrets inventory.
const DEFAULT_EDGE_SECRETS = new Set(['SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_URL'])
const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')

export const SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS = Object.freeze({
  maxPATBytes: 4_096,
  maxPublishableKeyBytes: 4_096,
  maxUserAccessTokenBytes: 16 * 1024,
  maxProjectResponseBytes: 128 * 1024,
  maxSecretsResponseBytes: 256 * 1024,
  maxDeployResponseBytes: 256 * 1024,
  maxHealthResponseBytes: 64 * 1024,
  maxSecretCount: 256,
  maxServerBundleBytes: 5 * 1024 * 1024,
  requestTimeoutMs: 180_000,
  healthTimeoutMs: 15_000
})

export type SupabaseManagementEdgeFunctionFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementEdgeFunctionAuthority = SupabaseManagementAccountAuthorityV1

export interface CreateSupabaseManagementEdgeFunctionTransportOptions {
  /** Operation-scoped values resolved from the credential vault; never persisted by this module. */
  readonly personalAccessToken: string
  readonly publishableKey: string
  readonly userAccessToken: string
  readonly authority: SupabaseManagementEdgeFunctionAuthority
  readonly fetcher: SupabaseManagementEdgeFunctionFetch
  readonly now: () => string
  readonly signal?: AbortSignal
  /** Optional stricter deadline; values cannot exceed the Host maximum. */
  readonly requestTimeoutMs?: number
  /** Optional stricter health deadline; values cannot exceed the Host maximum. */
  readonly healthTimeoutMs?: number
}

export type SupabaseManagementEdgeFunctionTransport = SupabaseEdgeFunctionReleaseTransports

interface UnknownRecord {
  [key: string]: unknown
}

type RequestDeadline = SupabaseManagementRequestDeadline

function releaseError(
  code: ConstructorParameters<typeof SupabaseEdgeFunctionReleaseError>[0],
  message: string = code
): never {
  throw new SupabaseEdgeFunctionReleaseError(code, message)
}

function controlFree(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    new TextEncoder().encode(value).byteLength <= maximum &&
    !/\p{Cc}/u.test(value)
  )
}

function stableId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) {
    return releaseError('invalid-authority', `${name} is invalid`)
  }
  return value
}

function boundedTimeout(value: unknown, maximum: number): number {
  if (value === undefined) return maximum
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    return releaseError('invalid-authority', 'request deadline is invalid')
  }
  return value as number
}

function plainRecord(value: unknown): UnknownRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return releaseError('invalid-response')
  }
  return value as UnknownRecord
}

function ownValue(record: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return releaseError('invalid-response')
  }
  return descriptor.value
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) releaseError('aborted')
}

function requestDeadline(caller: AbortSignal | undefined, timeoutMs: number): RequestDeadline {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let timeoutReached = false
  const onCallerAbort = () => controller.abort(caller?.reason)
  if (caller?.aborted) {
    controller.abort(caller.reason)
  } else {
    caller?.addEventListener('abort', onCallerAbort, { once: true })
    timeout = setTimeout(() => {
      timeoutReached = true
      controller.abort(new DOMException('Supabase Edge Function request timed out', 'TimeoutError'))
    }, timeoutMs)
  }
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      if (timeout !== undefined) clearTimeout(timeout)
      caller?.removeEventListener('abort', onCallerAbort)
    }
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Supabase Edge Function request aborted', 'AbortError')
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

function fetchFailure(cause: unknown, signal: AbortSignal | undefined): never {
  if (signal?.aborted) return releaseError('aborted')
  if (cause instanceof SupabaseEdgeFunctionReleaseError) throw cause
  if (
    cause instanceof DOMException &&
    (cause.name === 'TimeoutError' || cause.name === 'AbortError')
  ) {
    return releaseError(cause.name === 'TimeoutError' ? 'timeout' : 'aborted')
  }
  return releaseError('network-failed')
}

async function boundedJSON(
  response: Response,
  maximum: number,
  signal: AbortSignal
): Promise<unknown> {
  const contentType = response.headers.get('content-type')
  if (!contentType || !/^application\/json(?:\s*;.*)?$/iu.test(contentType)) {
    return releaseError('invalid-response')
  }
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const parsed = Number(declared)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
      return releaseError('invalid-response')
    }
  }
  if (!response.body) return releaseError('invalid-response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    let result = await waitForAbortable(reader.read(), signal)
    while (!result.done) {
      length += result.value.byteLength
      if (length > maximum) {
        void reader.cancel().catch(() => undefined)
        return releaseError('invalid-response')
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
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return releaseError('invalid-response')
  }
}

async function requestJSON(
  fetcher: SupabaseManagementEdgeFunctionFetch,
  url: string,
  init: RequestInit,
  expectedStatus: number,
  maximum: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  dispatched: boolean
): Promise<unknown> {
  const deadline = requestDeadline(signal, timeoutMs)
  try {
    throwIfAborted(deadline.signal)
    const response = await waitForAbortable(
      fetcher(url, { ...init, redirect: 'error', signal: deadline.signal }, maximum, timeoutMs),
      deadline.signal
    )
    throwIfAborted(deadline.signal)
    if (response.redirected || (response.url !== '' && response.url !== url)) {
      return releaseError(dispatched ? 'network-failed' : 'provider-rejected')
    }
    if (response.status !== expectedStatus) {
      const knownRejection =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429
      return releaseError(knownRejection ? 'provider-rejected' : 'network-failed')
    }
    return await boundedJSON(response, maximum, deadline.signal)
  } catch (cause) {
    if (deadline.timedOut()) return releaseError('timeout')
    return fetchFailure(cause, signal)
  } finally {
    deadline.dispose()
  }
}

function sameAuthority(
  actual: SupabaseManagementEdgeFunctionAuthority,
  expected: SupabaseManagementEdgeFunctionAuthority
): boolean {
  return (
    actual.projectRef === expected.projectRef &&
    actual.accountId === expected.accountId &&
    actual.grantGeneration === expected.grantGeneration
  )
}

function validateExpectedAuthority(value: SupabaseManagementEdgeFunctionAuthority): void {
  if (!PROJECT_REF.test(value.projectRef)) releaseError('invalid-authority')
  stableId(value.accountId, 'accountId')
  stableId(value.grantGeneration, 'grantGeneration')
}

function authorityFromRelease(
  authority: SupabaseEdgeFunctionReleaseAuthority
): SupabaseManagementEdgeFunctionAuthority {
  return {
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.grantGeneration
  }
}

function authorityFromDeploy(
  input: SupabaseEdgeFunctionDeployInput
): SupabaseManagementEdgeFunctionAuthority {
  return {
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration
  }
}

function authorityFromSecretInspection(
  input: SupabaseEdgeFunctionSecretInspectionInput
): SupabaseManagementEdgeFunctionAuthority {
  return {
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration
  }
}

function authorityFromHealth(
  input: SupabaseEdgeFunctionHealthInput
): SupabaseManagementEdgeFunctionAuthority {
  return {
    projectRef: input.projectRef,
    accountId: input.accountId,
    grantGeneration: input.grantGeneration
  }
}

function validateProject(value: unknown, expected: SupabaseManagementEdgeFunctionAuthority): void {
  const project = plainRecord(value)
  const ref = ownValue(project, 'ref')
  const accountId = ownValue(project, 'organization_id')
  if (ref !== expected.projectRef || accountId !== expected.accountId) {
    releaseError('invalid-authority', 'project authority changed')
  }
}

function fileBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content)
}

function serverBundle(input: SupabaseEdgeFunctionDeployInput): Uint8Array {
  const prefix = `backend/supabase/functions/${input.functionSlug}/`
  const entries: Zippable = {}
  for (const file of [...input.files].sort((left, right) => left.path.localeCompare(right.path))) {
    const relativePath = file.path.slice(prefix.length)
    if (!file.path.startsWith(prefix) || !relativePath || Object.hasOwn(entries, relativePath)) {
      return releaseError('invalid-artifact')
    }
    entries[relativePath] = [fileBytes(file.content), { level: 0, mtime: FIXED_ZIP_TIME }]
  }
  const bundle = zipSync(entries, { level: 0, mtime: FIXED_ZIP_TIME })
  if (bundle.byteLength > SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxServerBundleBytes) {
    return releaseError('invalid-artifact', 'server-side bundle exceeds the platform limit')
  }
  return bundle
}

function formData(input: SupabaseEdgeFunctionDeployInput): FormData {
  const bundle = new Uint8Array(serverBundle(input))
  const form = new FormData()
  form.append(
    'metadata',
    JSON.stringify({
      name: input.functionSlug,
      entrypoint_path: 'index.ts',
      verify_jwt: true
    })
  )
  form.append(
    'file',
    new Blob([bundle.buffer], { type: 'application/zip' }),
    `${input.functionSlug}.zip`
  )
  return form
}

async function operationId(prefix: string, evidence: unknown): Promise<string> {
  const digest = await digestCanonicalManifest(evidence)
  return `${prefix}-${digest.slice(0, 32)}`
}

function validateDeployResponse(
  value: unknown,
  input: SupabaseEdgeFunctionDeployInput
): { readonly id: string; readonly version: number } {
  const response = plainRecord(value)
  const id = ownValue(response, 'id')
  const slug = ownValue(response, 'slug')
  const status = ownValue(response, 'status')
  const version = ownValue(response, 'version')
  const verifyJwt = ownValue(response, 'verify_jwt')
  if (
    typeof id !== 'string' ||
    !STABLE_ID.test(id) ||
    slug !== input.functionSlug ||
    status !== 'ACTIVE' ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    verifyJwt !== true
  ) {
    return releaseError('invalid-response')
  }
  return { id, version }
}

function parseSecretNames(value: unknown): ReadonlySet<string> {
  if (
    !Array.isArray(value) ||
    value.length > SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxSecretCount
  ) {
    return releaseError('invalid-response')
  }
  const names = new Set<string>()
  for (const entry of value) {
    const name = ownValue(plainRecord(entry), 'name')
    if (typeof name !== 'string' || !SECRET_NAME.test(name) || names.has(name)) {
      return releaseError('invalid-response')
    }
    names.add(name)
  }
  return names
}

export function createSupabaseManagementEdgeFunctionTransport(
  options: CreateSupabaseManagementEdgeFunctionTransportOptions
): SupabaseManagementEdgeFunctionTransport {
  validateExpectedAuthority(options.authority)
  const requestTimeoutMs = boundedTimeout(
    options.requestTimeoutMs,
    SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.requestTimeoutMs
  )
  const healthTimeoutMs = boundedTimeout(
    options.healthTimeoutMs,
    SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.healthTimeoutMs
  )
  if (
    !controlFree(
      options.personalAccessToken,
      SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxPATBytes
    ) ||
    !controlFree(
      options.publishableKey,
      SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxPublishableKeyBytes
    ) ||
    !options.publishableKey.startsWith('sb_publishable_') ||
    !controlFree(
      options.userAccessToken,
      SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxUserAccessTokenBytes
    ) ||
    typeof options.fetcher !== 'function' ||
    typeof options.now !== 'function'
  ) {
    releaseError('invalid-authority')
  }

  const authorization = `Bearer ${options.personalAccessToken}`
  const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${options.authority.projectRef}`
  const projectHeaders = Object.freeze({ accept: 'application/json', authorization })

  const recheckProject = async (): Promise<void> => {
    const project = await requestJSON(
      options.fetcher,
      projectURL,
      { method: 'GET', credentials: 'omit', headers: projectHeaders },
      200,
      SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxProjectResponseBytes,
      requestTimeoutMs,
      options.signal,
      false
    )
    validateProject(project, options.authority)
  }

  return Object.freeze({
    async inspectRequiredSecrets(
      input: SupabaseEdgeFunctionSecretInspectionInput
    ): Promise<SupabaseEdgeFunctionSecretInspectionEvidence> {
      const required = [...input.requiredSecretNames]
      const sorted = [...required].sort((left, right) => left.localeCompare(right, 'en'))
      if (
        input.providerId !== 'supabase' ||
        !sameAuthority(authorityFromSecretInspection(input), options.authority) ||
        !FUNCTION_SLUG.test(input.functionSlug) ||
        !SHA256.test(input.artifactDigest) ||
        required.length === 0 ||
        new Set(required).size !== required.length ||
        required.some((name) => !SECRET_NAME.test(name)) ||
        required.some((name, index) => name !== sorted[index])
      ) {
        return releaseError('invalid-authority')
      }
      await recheckProject()
      const custom = required.filter((name) => !DEFAULT_EDGE_SECRETS.has(name))
      let configured = new Set<string>()
      if (custom.length > 0) {
        const secrets = await requestJSON(
          options.fetcher,
          `${MANAGEMENT_ORIGIN}/v1/projects/${options.authority.projectRef}/secrets`,
          { method: 'GET', credentials: 'omit', headers: projectHeaders },
          200,
          SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxSecretsResponseBytes,
          requestTimeoutMs,
          options.signal,
          false
        )
        configured = new Set(parseSecretNames(secrets))
      }
      if (custom.some((name) => !configured.has(name))) return releaseError('missing-secrets')
      const checkedAt = options.now()
      const evidenceDigest = await digestCanonicalManifest({
        format: 'openpencil.supabase-edge-secret-inspection-evidence.v1',
        version: 1,
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration,
        providerId: 'supabase',
        functionSlug: input.functionSlug,
        artifactDigest: input.artifactDigest,
        requiredSecretNames: required,
        checkedAt
      })
      return Object.freeze({
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration,
        providerId: 'supabase' as const,
        functionSlug: input.functionSlug,
        artifactDigest: input.artifactDigest,
        requiredSecretNames: Object.freeze(required),
        evidenceDigest,
        checkedAt
      })
    },

    async recheckAuthority(authority: SupabaseEdgeFunctionReleaseAuthority) {
      if (!sameAuthority(authorityFromRelease(authority), options.authority)) {
        releaseError('invalid-authority')
      }
      await recheckProject()
    },

    async deploy(
      input: SupabaseEdgeFunctionDeployInput
    ): Promise<SupabaseEdgeFunctionDeployResult> {
      if (
        input.providerId !== 'supabase' ||
        input.verifyJwt !== true ||
        !sameAuthority(authorityFromDeploy(input), options.authority)
      ) {
        return releaseError('invalid-authority')
      }
      const url = `${MANAGEMENT_ORIGIN}/v1/projects/${input.projectRef}/functions/deploy?slug=${encodeURIComponent(input.functionSlug)}`
      const response = await requestJSON(
        options.fetcher,
        url,
        {
          method: 'POST',
          credentials: 'omit',
          headers: Object.freeze({ accept: 'application/json', authorization }),
          body: formData(input)
        },
        201,
        SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxDeployResponseBytes,
        requestTimeoutMs,
        options.signal,
        true
      )
      const deployed = validateDeployResponse(response, input)
      return Object.freeze({
        projectRef: input.projectRef,
        functionSlug: input.functionSlug,
        functionId: deployed.id,
        versionId: String(deployed.version),
        operationId: await operationId('edge-deploy', {
          projectRef: input.projectRef,
          functionSlug: input.functionSlug,
          functionId: deployed.id,
          version: deployed.version,
          artifactDigest: input.artifactDigest
        })
      })
    },

    async invokeAuthenticated(
      input: SupabaseEdgeFunctionHealthInput
    ): Promise<SupabaseEdgeFunctionHealthEvidence> {
      if (
        input.providerId !== 'supabase' ||
        input.authenticated !== true ||
        !SHA256.test(input.expectedHealthIdentity) ||
        !sameAuthority(authorityFromHealth(input), options.authority)
      ) {
        return releaseError('invalid-authority')
      }
      const url = `https://${input.projectRef}.supabase.co/functions/v1/${input.functionSlug}`
      const response = await requestJSON(
        options.fetcher,
        url,
        {
          method: 'POST',
          credentials: 'omit',
          headers: Object.freeze({
            accept: 'application/json',
            apikey: options.publishableKey,
            authorization: `Bearer ${options.userAccessToken}`,
            'content-type': 'application/json'
          }),
          body: JSON.stringify({ workflowId: '__openpencil_health_v1', args: {} })
        },
        200,
        SUPABASE_MANAGEMENT_EDGE_FUNCTION_LIMITS.maxHealthResponseBytes,
        healthTimeoutMs,
        options.signal,
        true
      )
      const health = plainRecord(response)
      const keys = Reflect.ownKeys(health)
      if (
        keys.length !== 3 ||
        !keys.includes('healthy') ||
        !keys.includes('authenticated') ||
        !keys.includes('buildIdentity') ||
        ownValue(health, 'healthy') !== true ||
        ownValue(health, 'authenticated') !== true ||
        ownValue(health, 'buildIdentity') !== input.expectedHealthIdentity
      ) {
        return releaseError('health-check-failed')
      }
      const checkedAt = options.now()
      const evidenceDigest = await digestCanonicalManifest({
        format: 'openpencil.supabase-edge-health-evidence.v1',
        version: 1,
        projectRef: input.projectRef,
        accountId: input.accountId,
        grantGeneration: input.grantGeneration,
        functionSlug: input.functionSlug,
        functionId: input.functionId,
        versionId: input.versionId,
        expectedHealthIdentity: input.expectedHealthIdentity,
        authenticated: true,
        healthy: true,
        checkedAt
      })
      return Object.freeze({
        status: 200,
        authenticated: true,
        healthy: true,
        healthIdentity: input.expectedHealthIdentity,
        evidenceDigest,
        operationId: `edge-health-${evidenceDigest.slice(0, 32)}`,
        checkedAt
      })
    }
  })
}
