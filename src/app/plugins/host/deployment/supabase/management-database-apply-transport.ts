import { digestSupabaseInspectedMigrationReviewManifest } from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  consumeTrustedSupabaseBackendStagingApplyContext,
  type SupabaseBackendStagingApplyContext
} from './backend-release'

const MANAGEMENT_ORIGIN = 'https://api.supabase.com'
const PROJECT_REF = /^[a-z]{20}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const MAX_PAT_LENGTH = 4_096
const REVIEWED_SQL_PREFIX = [
  '-- OpenPencil Supabase inspected migration review v1.',
  '-- Review only. The Compiler has no network, credential, filesystem, or Apply authority.',
  'BEGIN;',
  "SET LOCAL lock_timeout = '5s';",
  "SET LOCAL statement_timeout = '15s';",
  'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
  ''
].join('\n')
const REVIEWED_SQL_SUFFIX = '\nCOMMIT;\n'
const STAGING_OPERATION_KINDS = new Set(['create-enum', 'create-entity'])

export const SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS = Object.freeze({
  maxProjectResponseBytes: 128 * 1024,
  maxApplyResponseBytes: 128 * 1024,
  maxQueryBytes: 1_048_576,
  maxRenderedMigrationOperationIds: 2_048,
  requestTimeoutMs: 180_000
})

export type SupabaseManagementDatabaseApplyFetch = (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  maxResponseBytes: number,
  timeoutMs: number
) => Promise<Response>

export type SupabaseManagementDatabaseApplyTransportErrorCode =
  | 'aborted'
  | 'authority-recheck-failed'
  | 'dispatch-already-used'
  | 'http-error'
  | 'invalid-authority'
  | 'invalid-request'
  | 'invalid-response'
  | 'network-failed'
  | 'response-too-large'

export class SupabaseManagementDatabaseApplyTransportError extends Error {
  constructor(readonly code: SupabaseManagementDatabaseApplyTransportErrorCode) {
    super(`Supabase Management database Apply transport failed: ${code}.`)
    this.name = 'SupabaseManagementDatabaseApplyTransportError'
  }
}

/**
 * Trusted Host context captured inside `SupabaseBackendStagingApplyCapability.prepareApply`.
 * Callers cannot supply SQL or self-assert review flags independently of the complete artifact and
 * Release Core authority that produced it.
 */
export interface SupabaseManagementDatabaseApplyConfirmation {
  readonly provider: 'supabase'
  readonly status: 201
  readonly remoteOperationIds: readonly []
}

export interface SupabaseManagementDatabaseApplyTransport {
  prepareReviewedMigration(
    context: SupabaseBackendStagingApplyContext
  ): Promise<SupabaseManagementPreparedDatabaseApply>
}

export interface SupabaseManagementPreparedDatabaseApply {
  dispatch(): Promise<SupabaseManagementDatabaseApplyConfirmation>
}

export interface CreateSupabaseManagementDatabaseApplyTransportOptions {
  /** Ephemeral runtime value. The returned transport must remain operation-scoped. */
  readonly personalAccessToken: string
  readonly fetcher: SupabaseManagementDatabaseApplyFetch
  readonly signal?: AbortSignal
}

interface UnknownRecord {
  [key: string]: unknown
}

interface ReviewedApplySnapshot {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly renderedMigrationOperationIds: readonly string[]
  readonly sql: string
}

const EMPTY_REMOTE_OPERATION_IDS: readonly [] = Object.freeze([])
const APPLY_CONFIRMATION = Object.freeze({
  provider: 'supabase' as const,
  status: 201 as const,
  remoteOperationIds: EMPTY_REMOTE_OPERATION_IDS
})

function fail(code: SupabaseManagementDatabaseApplyTransportErrorCode): never {
  throw new SupabaseManagementDatabaseApplyTransportError(code)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) fail('aborted')
}

function validPAT(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= MAX_PAT_LENGTH &&
    !/\p{Cc}/u.test(value)
  )
}

function plainRecord(value: unknown, code: 'invalid-request' | 'invalid-response'): UnknownRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return fail(code)
  }
  return value as UnknownRecord
}

function dataField(
  record: UnknownRecord,
  key: string,
  code: 'invalid-request' | 'invalid-response'
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key)
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return fail(code)
  return descriptor.value
}

function exactKeys(
  record: UnknownRecord,
  keys: readonly string[],
  code: 'invalid-request' | 'invalid-response'
): void {
  const ownKeys = Reflect.ownKeys(record)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    fail(code)
  }
  for (const key of keys) dataField(record, key, code)
}

function stableId(value: unknown, code: 'invalid-request' | 'invalid-authority'): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) fail(code)
  return value
}

function responseStableId(value: unknown): string {
  if (typeof value !== 'string' || !STABLE_ID.test(value)) fail('invalid-authority')
  return value
}

function utf8Bytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) fail('invalid-request')
  const bytes = new TextEncoder().encode(value)
  try {
    if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== value) fail('invalid-request')
  } catch {
    return fail('invalid-request')
  }
  return bytes
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestBytes(bytes: Uint8Array): Promise<string> {
  const source = new Uint8Array(bytes.byteLength)
  source.set(bytes)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
}

function reviewedOperationIds(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxRenderedMigrationOperationIds
  ) {
    return fail('invalid-request')
  }
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !OPERATION_ID.test(entry)) fail('invalid-request')
    result.push(entry)
  }
  const unique = new Set(result)
  if (unique.size !== result.length) fail('invalid-request')
  const sorted = [...result].sort((left, right) => left.localeCompare(right, 'en'))
  if (sorted.some((entry, index) => entry !== result[index])) fail('invalid-request')
  return Object.freeze(result)
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function runtimeField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key)
}

// oxlint-disable-next-line eslint(complexity) -- One auditable predicate binds every trusted artifact, release, authority, operation, and SQL invariant.
async function validateApplyContext(
  context: SupabaseBackendStagingApplyContext
): Promise<ReviewedApplySnapshot> {
  try {
    if (!consumeTrustedSupabaseBackendStagingApplyContext(context)) fail('invalid-authority')
    const source = plainRecord(context, 'invalid-request')
    exactKeys(source, ['artifact', 'release'], 'invalid-request')
    const artifact = dataField(source, 'artifact', 'invalid-request') as
      | SupabaseBackendStagingApplyContext['artifact']
      | undefined
    const release = dataField(source, 'release', 'invalid-request') as
      | SupabaseBackendStagingApplyContext['release']
      | undefined
    if (!artifact || !release) fail('invalid-request')
    const manifest = artifact.manifest
    const reviewed = artifact.inspectedReview
    const reviewedManifest = reviewed.manifest
    const authority = release.plan.authority
    const projectRef = manifest.remoteAuthority.projectRef
    const accountId = stableId(manifest.remoteAuthority.accountId, 'invalid-request')
    const grantGeneration = stableId(manifest.remoteAuthority.grantGeneration, 'invalid-request')
    const operations = reviewedManifest.migrationPlan.operations
    const currentModel = reviewed.snapshot.currentModel
    const renderedMigrationOperationIds = reviewedOperationIds(
      [...reviewedManifest.renderedMigrationOperationIds].sort((left, right) =>
        left.localeCompare(right, 'en')
      )
    )
    const plannedOperationIds = operations
      .map((entry) => entry.operation.id)
      .sort((left, right) => left.localeCompare(right, 'en'))
    const releaseOperationIds = release.plan.migration.operations
      .map((entry) => entry.operationId)
      .sort((left, right) => left.localeCompare(right, 'en'))
    const sql = reviewed.sql
    const queryBytes = utf8Bytes(sql)
    const computedSQLDigest = await digestBytes(queryBytes)
    const computedReviewedManifestDigest =
      digestSupabaseInspectedMigrationReviewManifest(reviewedManifest)
    const computedArtifactManifestDigest = await digestCanonicalManifest(manifest)
    if (
      runtimeField(artifact, 'format') !== 'openpencil.supabase-backend-review-artifact.v1' ||
      runtimeField(artifact, 'version') !== 1 ||
      runtimeField(manifest, 'format') !== 'openpencil.supabase-backend-host-review.v1' ||
      runtimeField(manifest, 'version') !== 1 ||
      manifest.environment !== 'staging' ||
      authority.environment !== 'staging' ||
      typeof projectRef !== 'string' ||
      !PROJECT_REF.test(projectRef) ||
      computedArtifactManifestDigest !== artifact.manifestDigest ||
      computedReviewedManifestDigest !== reviewed.manifestDigest ||
      manifest.inspectedReview.manifestDigest !== reviewed.manifestDigest ||
      manifest.inspectedReview.migrationPlanDigest !== reviewedManifest.migrationPlanDigest ||
      manifest.inspectedReview.targetModelDigest !== reviewedManifest.targetModelDigest ||
      manifest.inspectedReview.reviewReady !== reviewedManifest.reviewReady ||
      runtimeField(manifest.inspectedReview, 'applyAllowed') !== false ||
      runtimeField(manifest.inspectedReview, 'releaseReady') !== false ||
      runtimeField(reviewedManifest, 'applyAllowed') !== false ||
      runtimeField(reviewedManifest, 'releaseReady') !== false ||
      !reviewedManifest.reviewReady ||
      reviewedManifest.blockers.length !== 0 ||
      currentModel.entities.length !== 0 ||
      currentModel.enums.length !== 0 ||
      currentModel.relations.length !== 0 ||
      reviewed.snapshot.objects.some((entry) => entry.management === 'managed') ||
      operations.length === 0 ||
      operations.some(
        (entry) => entry.risk !== 'low' || !STAGING_OPERATION_KINDS.has(entry.operation.kind)
      ) ||
      !sameValue(renderedMigrationOperationIds, plannedOperationIds) ||
      !sameValue(renderedMigrationOperationIds, releaseOperationIds) ||
      !sameValue(release.migrationPlan, reviewedManifest.migrationPlan) ||
      release.artifacts.schemaArtifactDigest !== artifact.manifestDigest ||
      release.review.planDigest !== release.plan.planDigest ||
      release.review.backupRequired ||
      release.review.destructiveOperationIds.length !== 0 ||
      release.confirmations.length !== 0 ||
      !sameValue(release.authority, authority) ||
      manifest.documentDigest !== authority.documentDigest ||
      manifest.compilerVersion !== authority.compilerVersion ||
      manifest.target !== authority.target ||
      manifest.compiler.applicationDigest !== authority.irDigest ||
      reviewedManifest.applicationDigest !== authority.irDigest ||
      reviewedManifest.inspectionCaptureDigest !== reviewed.snapshot.captureDigest ||
      !sameValue(reviewedManifest.inspectionProvenance, reviewed.snapshot.provenance) ||
      reviewedManifest.inspectedSchemaDigest !== authority.inspectedSchemaDigest ||
      manifest.remoteAuthority.inspectedSchemaDigest !== authority.inspectedSchemaDigest ||
      projectRef !== authority.projectId ||
      accountId !== authority.accountId ||
      grantGeneration !== authority.grantGeneration ||
      !sameValue(manifest.backendProvider, authority.backendProvider) ||
      queryBytes.byteLength > SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxQueryBytes ||
      !sql.startsWith(REVIEWED_SQL_PREFIX) ||
      !sql.endsWith(REVIEWED_SQL_SUFFIX) ||
      /(^|[^A-Za-z])DROP([^A-Za-z]|$)/iu.test(sql) ||
      computedSQLDigest !== reviewedManifest.sqlDigest
    ) {
      fail('invalid-request')
    }
    return Object.freeze({
      projectRef,
      accountId,
      grantGeneration,
      renderedMigrationOperationIds,
      sql
    })
  } catch (cause) {
    if (cause instanceof SupabaseManagementDatabaseApplyTransportError) throw cause
    return fail('invalid-request')
  }
}

async function boundedJSON(response: Response, maximum: number): Promise<unknown> {
  const contentType = response.headers.get('content-type')
  if (!contentType || !/^application\/json(?:\s*;.*)?$/iu.test(contentType)) {
    fail('invalid-response')
  }
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
  fetcher: SupabaseManagementDatabaseApplyFetch,
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
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.requestTimeoutMs
    )
  } catch {
    throwIfAborted(signal)
    return fail('network-failed')
  }
  throwIfAborted(signal)
  if (response.redirected || (response.url !== '' && response.url !== url)) fail('http-error')
  if (response.status !== expectedStatus) fail('http-error')
  return boundedJSON(response, maximum)
}

function validateProjectAuthority(value: unknown, request: ReviewedApplySnapshot): void {
  const project = plainRecord(value, 'invalid-response')
  const ref = dataField(project, 'ref', 'invalid-response')
  const organizationId = responseStableId(dataField(project, 'organization_id', 'invalid-response'))
  responseStableId(dataField(project, 'organization_slug', 'invalid-response'))
  if (ref !== request.projectRef || organizationId !== request.accountId) fail('invalid-authority')
}

async function recheckProjectAuthorityBeforeMutation(
  fetcher: SupabaseManagementDatabaseApplyFetch,
  projectURL: string,
  authorization: string,
  reviewed: ReviewedApplySnapshot,
  signal: AbortSignal | undefined
): Promise<void> {
  try {
    const project = await requestJSON(
      fetcher,
      projectURL,
      {
        method: 'GET',
        credentials: 'omit',
        headers: Object.freeze({ accept: 'application/json', authorization })
      },
      200,
      SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
      signal
    )
    validateProjectAuthority(project, reviewed)
  } catch {
    // This check happens after the durable claim but before the query POST. Its failure therefore
    // has a known no-mutation outcome and must not be collapsed into an ambiguous transport error.
    fail('authority-recheck-failed')
  }
}

function validateApplyConfirmation(value: unknown): void {
  // The current Management API returns an empty row array for transaction-only DDL. Keep the
  // previously documented empty-object response narrow as well because this endpoint is beta.
  if (Array.isArray(value)) {
    if (value.length !== 0) fail('invalid-response')
    return
  }
  const confirmation = plainRecord(value, 'invalid-response')
  exactKeys(confirmation, [], 'invalid-response')
}

export function createSupabaseManagementDatabaseApplyTransport(
  options: CreateSupabaseManagementDatabaseApplyTransportOptions
): SupabaseManagementDatabaseApplyTransport {
  if (!validPAT(options.personalAccessToken) || typeof options.fetcher !== 'function') {
    fail('invalid-authority')
  }
  const authorization = `Bearer ${options.personalAccessToken}`

  return Object.freeze({
    async prepareReviewedMigration(
      context: SupabaseBackendStagingApplyContext
    ): Promise<SupabaseManagementPreparedDatabaseApply> {
      throwIfAborted(options.signal)
      const reviewed = await validateApplyContext(context)
      throwIfAborted(options.signal)
      const projectURL = `${MANAGEMENT_ORIGIN}/v1/projects/${reviewed.projectRef}`
      const project = await requestJSON(
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
        SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxProjectResponseBytes,
        options.signal
      )
      validateProjectAuthority(project, reviewed)
      let dispatched = false
      return Object.freeze({
        async dispatch(): Promise<SupabaseManagementDatabaseApplyConfirmation> {
          if (dispatched) fail('dispatch-already-used')
          dispatched = true
          await recheckProjectAuthorityBeforeMutation(
            options.fetcher,
            projectURL,
            authorization,
            reviewed,
            options.signal
          )
          const queryURL = `${MANAGEMENT_ORIGIN}/v1/projects/${reviewed.projectRef}/database/query`
          const confirmation = await requestJSON(
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
              body: JSON.stringify({ query: reviewed.sql, read_only: false })
            },
            201,
            SUPABASE_MANAGEMENT_DATABASE_APPLY_LIMITS.maxApplyResponseBytes,
            options.signal
          )
          validateApplyConfirmation(confirmation)
          return APPLY_CONFIRMATION
        }
      })
    }
  })
}
