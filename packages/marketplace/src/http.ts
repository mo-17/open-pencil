import { timingSafeEqual } from 'node:crypto'

import { Hono, type Context } from 'hono'

import { importEd25519PublicKeyPem, parseSha256Base64URL } from '@open-pencil/scene-graph'

import {
  MARKETPLACE_ADMIN_ASSERTION_HEADER,
  MARKETPLACE_ADMIN_ASSERTION_LIMITS,
  verifyMarketplaceAdminAssertion
} from './admin-assertion'
import {
  MARKETPLACE_NONCE_NAMESPACES,
  MARKETPLACE_REQUEST_AUTH_LIMITS,
  verifyMarketplaceRequestSignature,
  type MarketplaceNonceStore,
  type MarketplaceSignedRequestHeaders
} from './auth'
import {
  MARKETPLACE_CONTROL_SCHEMA_VERSION,
  MarketplaceControlStaleCursorError,
  createRandomMarketplaceControlCursorKey,
  decodeMarketplaceControlCursor,
  encodeMarketplaceControlCursor,
  parseMarketplaceControlDetail,
  parseMarketplaceControlAuditEvent,
  parseMarketplaceControlListQuery,
  parseMarketplaceOperatorOverview,
  parseMarketplaceOperatorPublications,
  parseMarketplaceControlPage,
  parseMarketplaceControlPublisherAuditPage,
  parseMarketplaceControlPublisherKey,
  parseMarketplaceControlRelease,
  parseMarketplaceControlSubmission,
  parseMarketplaceControlSubmissionSummary,
  parseMarketplaceControlSubmissionValidation,
  parseMarketplaceControlSummary,
  serializeMarketplaceControlJSON,
  toMarketplaceControlPublisherKey,
  toMarketplaceControlRelease,
  toMarketplaceControlSubmissionSummary,
  type MarketplaceControlCursorBinding,
  type MarketplaceControlItemParser,
  type MarketplaceControlListQuery,
  type MarketplaceControlResource
} from './control-contract'
import type { MarketplaceControlReadPage } from './control-reader'
import {
  MarketplaceImpactAuthorityError,
  parseMarketplaceImpactPreview,
  type MarketplaceImpactRequest
} from './impact'
import {
  assertMarketplaceOperatorAuthorization,
  assertMarketplaceOperatorImpactPreviewAuthorization,
  type MarketplaceOperatorActionOperation,
  type MarketplaceOperatorAuthorizationV2,
  type MarketplaceOperatorOperation
} from './operator-authorization'
import { parseMarketplaceSubmissionPresentation } from './presentation'
import {
  MarketplacePublisherMutationCapacityError,
  MarketplacePublisherMutationConflictError,
  type MarketplacePublisherMutationExecution,
  type MarketplacePublisherMutationOperation,
  type MarketplaceVerifiedPublisherMutationRequest
} from './publisher/idempotency'
import { MarketplacePublisherMutationAuthorityError } from './repository'
import { parseMarketplaceSubmissionRevisionDiff } from './revision-diff'
import { isMarketplaceLoopbackHost } from './serve-mode'
import {
  MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS,
  type MarketplaceService,
  type RegisterMarketplacePublisherInput
} from './service'
import {
  parseMarketplaceSubmissionCurrentCheckReport,
  parseMarketplaceSubmissionReviewerHistory,
  parseMarketplaceSubmissionReviewerHistoryQuery
} from './submission-assurance'
import {
  MARKETPLACE_AUDIT_ACTIONS,
  MARKETPLACE_OWNERSHIP_STATUSES,
  MARKETPLACE_PUBLISHER_KEY_STATUSES,
  MARKETPLACE_PUBLISHER_STATUSES,
  MARKETPLACE_RELEASE_CHANNELS,
  MARKETPLACE_SUBMISSION_STATUSES,
  parseMarketplaceAuditActor,
  parseMarketplaceOwnership,
  parseMarketplacePublication,
  parseMarketplacePublisher,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceTimestamp,
  parseRegisterMarketplacePublisherKeyInput,
  type MarketplaceOwnershipStatus,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherStatus,
  type MarketplaceReleaseChannel,
  type MarketplaceSubmissionStatus
} from './types'

export interface MarketplaceHttpAdminOptions {
  enabled?: boolean
  token?: string
  requireServiceAssertion?: boolean
  authenticate?: (request: Request) => Promise<{ actor: string; expiresAt: number | string } | null>
}

export interface CreateMarketplaceHttpAppOptions {
  service: MarketplaceService
  /** @deprecated Nonce authority is owned by service.repository and this value is ignored. */
  nonces?: MarketplaceNonceStore
  admin?: MarketplaceHttpAdminOptions
  now?: () => number
  cursorKey?: CryptoKey
}

interface MarketplaceHttpAdminPrincipal {
  actor: string
  source: 'service-v1' | 'operator-v2' | 'custom' | 'legacy'
  requestId?: string
  correlationId?: string
  authorization?: MarketplaceOperatorAuthorizationV2
  assertionTimestamp?: string
}

interface ParsedBody {
  bytes: Uint8Array
  value: unknown
}

interface MarketplaceHttpRecord {
  [key: string]: unknown
}

const encoder = new TextEncoder()
const PUBLISHER_STATUSES = new Set<MarketplacePublisherStatus>([
  'pending',
  'active',
  'rejected',
  'suspended'
])
const PUBLISHER_KEY_STATUSES = new Set<MarketplacePublisherKeyStatus>([
  'pending',
  'active',
  'rejected',
  'revoked'
])
const OWNERSHIP_STATUSES = new Set<MarketplaceOwnershipStatus>([
  'requested',
  'active',
  'rejected',
  'revoked'
])
const SUBMISSION_STATUSES = new Set<MarketplaceSubmissionStatus>([
  'submitted',
  'validation_failed',
  'awaiting_review',
  'changes_requested',
  'rejected',
  'approved',
  'published',
  'withdrawn',
  'yanked'
])
const PUBLISHER_KEY_IMPACT_ACTIONS: Partial<
  Record<MarketplacePublisherKeyStatus, MarketplaceOperatorActionOperation>
> = Object.freeze({
  active: 'publisher-key.approve',
  rejected: 'publisher-key.reject',
  revoked: 'publisher-key.revoke'
})
const OWNERSHIP_IMPACT_ACTIONS: Partial<
  Record<MarketplaceOwnershipStatus, MarketplaceOperatorActionOperation>
> = Object.freeze({
  active: 'ownership.approve',
  rejected: 'ownership.reject'
})
const SUBMISSION_IMPACT_ACTIONS: Partial<
  Record<MarketplaceSubmissionStatus, MarketplaceOperatorActionOperation>
> = Object.freeze({
  approved: 'submission.approve',
  changes_requested: 'submission.request-changes',
  rejected: 'submission.reject'
})

function isRecord(value: unknown): value is MarketplaceHttpRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function record(value: unknown, path: string): MarketplaceHttpRecord {
  if (!isRecord(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  return value
}

function exactRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
  required: readonly string[] = allowed
): MarketplaceHttpRecord {
  const source = record(value, path)
  const keys = Object.keys(source)
  if (keys.some((key) => !allowed.includes(key))) {
    throw new TypeError(`${path} contains unknown fields`)
  }
  if (required.some((key) => !Object.hasOwn(source, key))) {
    throw new TypeError(`${path} is missing required fields`)
  }
  return source
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`)
  }
  return value
}

function positiveSafeIntegerValue(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value
}

function optionalReason(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null
  return stringValue(value, path)
}

async function boundedJSON(context: Context): Promise<ParsedBody> {
  const contentType = context.req.header('content-type')?.toLowerCase() ?? ''
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
    throw new HttpError(415, 'Request Content-Type must be application/json')
  }
  const contentLength = context.req.header('content-length')
  if (contentLength) {
    const parsed = Number(contentLength)
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes
    ) {
      throw new HttpError(413, 'Marketplace request body exceeds the byte limit')
    }
  }
  const reader = context.req.raw.body?.getReader()
  if (!reader) throw new TypeError('Marketplace request body must be non-empty')
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes) {
        await reader.cancel('Marketplace request body exceeds the byte limit')
        throw new HttpError(413, 'Marketplace request body exceeds the byte limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (byteLength === 0) {
    throw new TypeError('Marketplace request body must be non-empty')
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new TypeError('Marketplace request body must contain valid UTF-8')
  }
  try {
    return { bytes, value: JSON.parse(text) }
  } catch {
    throw new TypeError('Marketplace request body must contain valid JSON')
  }
}

async function boundedAdminAssertionBody(request: Request): Promise<Uint8Array> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxBodyBytes
    ) {
      throw new HttpError(413, 'Marketplace admin assertion body exceeds the byte limit')
    }
  }
  const reader = request.clone().body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MARKETPLACE_ADMIN_ASSERTION_LIMITS.maxBodyBytes) {
        await reader.cancel('Marketplace admin assertion body exceeds the byte limit')
        throw new HttpError(413, 'Marketplace admin assertion body exceeds the byte limit')
      }
      chunks.push(value)
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
  return bytes
}

function signedHeaders(context: Context): MarketplaceSignedRequestHeaders {
  const header = (name: string) => stringValue(context.req.header(name), `header ${name}`)
  return {
    audience: header('x-openpencil-marketplace-audience'),
    publisherId: header('x-openpencil-publisher-id'),
    keyId: header('x-openpencil-key-id'),
    timestamp: header('x-openpencil-timestamp'),
    nonce: header('x-openpencil-nonce'),
    signature: header('x-openpencil-signature')
  }
}

class MarketplacePublisherAuthorityResolutionFailureError extends Error {
  constructor() {
    super('Marketplace publisher authority resolution failed')
    this.name = 'MarketplacePublisherAuthorityResolutionFailureError'
  }
}

async function authenticate(
  context: Context,
  body: Uint8Array,
  options: CreateMarketplaceHttpAppOptions,
  resolvePublicKey?: (
    publisherId: string,
    keyId: string,
    verifiedAt: number
  ) => Promise<CryptoKey | null>
) {
  const verifiedAt = (options.now ?? Date.now)()
  if (!Number.isSafeInteger(verifiedAt)) {
    throw new HttpError(503, 'Marketplace authentication clock is unavailable')
  }
  const resolve = async (publisherId: string, keyId: string): Promise<CryptoKey | null> => {
    try {
      return await (
        resolvePublicKey ??
        ((resolvedPublisherId, resolvedKeyId) =>
          options.service.resolveActivePublisherKey(resolvedPublisherId, resolvedKeyId, verifiedAt))
      )(publisherId, keyId, verifiedAt)
    } catch {
      throw new MarketplacePublisherAuthorityResolutionFailureError()
    }
  }
  let proof
  try {
    proof = await verifyMarketplaceRequestSignature(
      {
        method: context.req.method,
        url: context.req.url,
        body,
        headers: signedHeaders(context)
      },
      {
        audience: options.service.marketplaceId,
        now: () => verifiedAt,
        resolvePublicKey: resolve
      }
    )
  } catch (error) {
    if (error instanceof MarketplacePublisherAuthorityResolutionFailureError) {
      throw new HttpError(503, 'Marketplace publisher authority is unavailable')
    }
    throw new HttpError(401, 'Marketplace request authentication failed')
  }
  let consumed: boolean
  try {
    consumed = await options.service.nonces.consume(
      MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
      proof.publisherId,
      proof.nonce,
      proof.freshUntil,
      verifiedAt
    )
  } catch {
    throw new HttpError(503, 'Marketplace request nonce authority is unavailable')
  }
  if (!consumed) throw new HttpError(401, 'Marketplace request authentication failed')
  return { publisherId: proof.publisherId, keyId: proof.keyId }
}

async function authenticatePublisherMutation(
  context: Context,
  body: Uint8Array,
  options: CreateMarketplaceHttpAppOptions,
  operation: MarketplacePublisherMutationOperation,
  resolvePublicKey?: (publisherId: string, keyId: string) => Promise<CryptoKey | null>
): Promise<
  MarketplaceVerifiedPublisherMutationRequest & {
    readonly verifiedAt: number
  }
> {
  const verifiedAt = (options.now ?? Date.now)()
  if (!Number.isSafeInteger(verifiedAt)) {
    throw new HttpError(503, 'Marketplace authentication clock is unavailable')
  }
  const resolve = async (publisherId: string, keyId: string): Promise<CryptoKey | null> => {
    try {
      return await (
        resolvePublicKey ??
        ((resolvedPublisherId, resolvedKeyId) =>
          options.service.resolvePublisherKey(resolvedPublisherId, resolvedKeyId))
      )(publisherId, keyId)
    } catch {
      throw new MarketplacePublisherAuthorityResolutionFailureError()
    }
  }
  try {
    const proof = await verifyMarketplaceRequestSignature(
      {
        method: context.req.method,
        url: context.req.url,
        body,
        headers: signedHeaders(context)
      },
      {
        audience: options.service.marketplaceId,
        now: () => verifiedAt,
        resolvePublicKey: resolve
      }
    )
    return Object.freeze({ ...proof, operation, verifiedAt })
  } catch (error) {
    if (error instanceof MarketplacePublisherAuthorityResolutionFailureError) {
      throw new HttpError(503, 'Marketplace publisher authority is unavailable')
    }
    throw new HttpError(401, 'Marketplace request authentication failed')
  }
}

function bearerToken(context: Context): string | null {
  const authorization = context.req.header('authorization')
  const match = /^Bearer ([\x21-\x7e]+)$/.exec(authorization ?? '')
  return match?.[1] ?? null
}

function equalToken(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

function configuredAdminToken(admin: MarketplaceHttpAdminOptions): string {
  if (typeof admin.token !== 'string' || admin.token.length < 32 || admin.token.length > 512) {
    throw new HttpError(503, 'Admin HTTP authentication is not configured')
  }
  return admin.token
}

async function authenticateAdminServiceAssertion(
  context: Context,
  assertion: string,
  secret: string,
  now: () => number,
  nonces: MarketplaceNonceStore
): Promise<MarketplaceHttpAdminPrincipal> {
  if (context.req.header('authorization') !== undefined) {
    throw new HttpError(401, 'Admin service assertion is invalid')
  }
  try {
    const principal = await verifyMarketplaceAdminAssertion(
      {
        assertion,
        method: context.req.method,
        url: context.req.url,
        body: await boundedAdminAssertionBody(context.req.raw)
      },
      { token: secret, nonces, now }
    )
    const pathname = new URL(context.req.url).pathname
    if (principal.authorization === undefined) {
      if (context.req.method !== 'GET' || pathname.startsWith('/admin/operator/')) {
        throw new HttpError(401, 'V1 admin service assertions are restricted to legacy reads')
      }
      return {
        actor: principal.actor,
        source: 'service-v1',
        requestId: principal.requestId,
        correlationId: principal.correlationId
      }
    }
    if (!pathname.startsWith('/admin/operator/') || !principal.assertionTimestamp) {
      throw new HttpError(401, 'V2 operator assertions are restricted to operator routes')
    }
    return {
      actor: principal.actor,
      source: 'operator-v2',
      requestId: principal.requestId,
      correlationId: principal.correlationId,
      authorization: principal.authorization,
      assertionTimestamp: principal.assertionTimestamp
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'Admin service assertion is invalid')
  }
}

async function authenticateAdmin(
  context: Context,
  admin: MarketplaceHttpAdminOptions | undefined,
  now: () => number,
  nonces: MarketplaceNonceStore
): Promise<MarketplaceHttpAdminPrincipal> {
  if (!admin?.enabled) throw new HttpError(404, 'Admin HTTP routes are disabled')
  const hostname = new URL(context.req.url).hostname.replace(/^\[|\]$/g, '')
  if (!isMarketplaceLoopbackHost(hostname)) {
    throw new HttpError(404, 'Admin HTTP routes are only available on loopback')
  }
  const assertion = context.req.header(MARKETPLACE_ADMIN_ASSERTION_HEADER)
  if (context.req.method !== 'GET' && context.req.method !== 'HEAD' && assertion === undefined) {
    throw new HttpError(401, 'A V2 operator assertion is required for admin mutations')
  }
  if (assertion !== undefined) {
    return authenticateAdminServiceAssertion(
      context,
      assertion,
      configuredAdminToken(admin),
      now,
      nonces
    )
  }
  if (admin.requireServiceAssertion) {
    throw new HttpError(401, 'Admin service assertion is required')
  }
  if (admin.authenticate) {
    const principal = await admin.authenticate(context.req.raw)
    if (!principal) throw new HttpError(401, 'Admin principal is invalid')
    const actor = parseMarketplaceAuditActor(principal.actor, 'admin principal actor')
    const expiresAt =
      typeof principal.expiresAt === 'number'
        ? principal.expiresAt
        : Date.parse(parseMarketplaceTimestamp(principal.expiresAt, 'admin principal expiry'))
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now()) {
      throw new HttpError(401, 'Admin principal is expired')
    }
    return { actor, source: 'custom' }
  }
  const secret = configuredAdminToken(admin)
  const provided = bearerToken(context)
  if (!provided || !equalToken(provided, secret)) {
    throw new HttpError(401, 'Admin bearer token is invalid')
  }
  return { actor: 'admin:legacy-loopback', source: 'legacy' }
}

async function authenticateOperator(
  context: Context,
  options: CreateMarketplaceHttpAppOptions,
  now: () => number,
  expectedOperation: MarketplaceOperatorOperation
): Promise<
  MarketplaceHttpAdminPrincipal & {
    source: 'operator-v2'
    correlationId: string
    authorization: MarketplaceOperatorAuthorizationV2
    assertionTimestamp: string
  }
> {
  const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
  if (
    principal.source !== 'operator-v2' ||
    !principal.authorization ||
    !principal.assertionTimestamp ||
    !principal.correlationId
  ) {
    throw new HttpError(401, 'A V2 operator assertion is required')
  }
  try {
    assertMarketplaceOperatorAuthorization(principal.authorization, expectedOperation, {
      assertionTimestamp: principal.assertionTimestamp,
      now: now()
    })
  } catch {
    throw new HttpError(403, 'Marketplace operator authorization is invalid')
  }
  return principal as MarketplaceHttpAdminPrincipal & {
    source: 'operator-v2'
    correlationId: string
    authorization: MarketplaceOperatorAuthorizationV2
    assertionTimestamp: string
  }
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 500 | 503,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

async function publisherMutation<Value>(operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof MarketplacePublisherMutationAuthorityError) {
      throw new HttpError(401, error.message)
    }
    if (error instanceof MarketplacePublisherMutationConflictError) {
      throw new HttpError(409, error.message)
    }
    if (error instanceof MarketplacePublisherMutationCapacityError) {
      throw new HttpError(503, error.message)
    }
    throw new HttpError(500, 'Internal marketplace server error')
  }
}

function publisherMutationResponse(execution: MarketplacePublisherMutationExecution): Response {
  return new Response(execution.response.json, {
    status: execution.response.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff'
    }
  })
}

function artifactResponse(
  artifact: Awaited<ReturnType<MarketplaceService['artifact']>>,
  immutable = true
): Response {
  if (!artifact) throw new HttpError(404, 'Marketplace artifact was not found')
  return new Response(new Uint8Array(artifact.bytes).buffer, {
    status: 200,
    headers: {
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-store',
      'content-length': String(artifact.byteLength),
      'content-type': 'application/json; charset=utf-8',
      etag: `"${artifact.digest}"`,
      'x-content-type-options': 'nosniff'
    }
  })
}

function channel(value: string): MarketplaceReleaseChannel {
  if (!MARKETPLACE_RELEASE_CHANNELS.includes(value as MarketplaceReleaseChannel)) {
    throw new HttpError(404, 'Marketplace catalog channel was not found')
  }
  return value as MarketplaceReleaseChannel
}

function statusValue<Value extends string>(
  value: unknown,
  values: ReadonlySet<Value>,
  path: string
): Value {
  if (typeof value !== 'string' || !values.has(value as Value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as Value
}

function mutationContext(source: MarketplaceHttpRecord, actor: string) {
  return {
    actor,
    ...(typeof source.reason === 'string' ? { reason: source.reason } : {})
  }
}

function operatorMutationContext(
  source: MarketplaceHttpRecord,
  principal: MarketplaceHttpAdminPrincipal & { correlationId: string }
) {
  return {
    actor: principal.actor,
    reason: parseMarketplaceReason(source.reason, 'operator mutation reason'),
    correlationId: principal.correlationId
  }
}

function assertTypedIdentifier(
  value: unknown,
  expected: string,
  path = 'operator mutation typedIdentifier'
): void {
  if (value !== expected) throw new TypeError(`${path} does not exactly match the affected subject`)
}

async function prospectiveOperatorAction(
  service: MarketplaceService,
  request: MarketplaceImpactRequest
): Promise<MarketplaceOperatorActionOperation> {
  switch (request.operation) {
    case 'publisher.status': {
      const publisher = await service.control.publisher(request.publisherId)
      if (!publisher) throw new TypeError('Impact preview publisher does not exist')
      if (request.status === 'active') {
        return publisher.status === 'suspended' ? 'publisher.reactivate' : 'publisher.approve'
      }
      if (request.status === 'rejected') return 'publisher.reject'
      if (request.status === 'suspended') return 'publisher.suspend'
      break
    }
    case 'publisher-key.status': {
      const action = PUBLISHER_KEY_IMPACT_ACTIONS[request.status]
      if (action) return action
      break
    }
    case 'ownership.status': {
      const action = OWNERSHIP_IMPACT_ACTIONS[request.status]
      if (action) return action
      break
    }
    case 'submission.status': {
      const action = SUBMISSION_IMPACT_ACTIONS[request.status]
      if (action) return action
      break
    }
    case 'submission.publish':
      return 'release.publish'
    case 'release.yank':
      return 'release.yank'
    case 'marketplace.publish':
      return 'publication.publish'
  }
  throw new TypeError('Impact preview does not map to a supported operator action')
}

function privateJSON(value: unknown, status = 200): Response {
  return new Response(serializeMarketplaceControlJSON(value), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff'
    }
  })
}

function authorityDigest(value: unknown, path = 'authorityDigest'): string {
  return parseSha256Base64URL(value, path)
}

function queryFilters(query: MarketplaceControlListQuery): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [name, value] of Object.entries(query.filters)) {
    if (value !== undefined) filters[name] = value
  }
  return Object.fromEntries(
    Object.entries(filters).sort(([left], [right]) => left.localeCompare(right))
  )
}

function positivePathSequence(value: string, path: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError(`${path} must be a positive integer`)
  const sequence = Number(value)
  if (!Number.isSafeInteger(sequence)) throw new TypeError(`${path} is outside the safe range`)
  return sequence
}

function rejectQuery(context: Context, resource: string): void {
  if (new URL(context.req.url).search !== '') {
    throw new TypeError(`${resource} does not accept query fields`)
  }
}

function publicAuditPageQuery(context: Context): { after?: number; limit?: number } {
  const parameters = new URL(context.req.url).searchParams
  for (const key of parameters.keys()) {
    if (key !== 'after' && key !== 'limit') {
      throw new TypeError('Public audit query contains unknown fields')
    }
  }
  for (const key of ['after', 'limit'] as const) {
    if (parameters.getAll(key).length > 1) {
      throw new TypeError(`Public audit ${key} must not be repeated`)
    }
  }
  const afterValue = parameters.get('after')
  const limitValue = parameters.get('limit')
  if (afterValue !== null && !/^(?:0|[1-9][0-9]*)$/.test(afterValue)) {
    throw new TypeError('Public audit after must be a non-negative integer')
  }
  if (limitValue !== null && !/^[1-9][0-9]*$/.test(limitValue)) {
    throw new TypeError('Public audit limit must be a positive integer')
  }
  const after = afterValue === null ? undefined : Number(afterValue)
  const limit = limitValue === null ? undefined : Number(limitValue)
  if (after !== undefined && !Number.isSafeInteger(after)) {
    throw new TypeError('Public audit after is outside the safe range')
  }
  if (
    limit !== undefined &&
    (!Number.isSafeInteger(limit) || limit > MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize)
  ) {
    throw new TypeError(
      `Public audit limit must be between 1 and ${MARKETPLACE_PUBLIC_AUDIT_PAGE_LIMITS.maxPageSize}`
    )
  }
  return {
    ...(after === undefined ? {} : { after }),
    ...(limit === undefined ? {} : { limit })
  }
}

function statusQuery<const Value extends string>(values: readonly Value[]) {
  return { kind: 'enum' as const, values }
}

function enumQueryFilter<const Value extends string>(
  value: string | undefined,
  values: readonly Value[],
  path: string
): Value | undefined {
  if (value === undefined) return undefined
  const matched = values.find((candidate) => candidate === value)
  if (!matched) throw new TypeError(`${path} is not supported`)
  return matched
}

function impactRequest(value: unknown): MarketplaceImpactRequest {
  const source = exactRecord(value, 'impact preview', ['operation', 'subject', 'target'])
  const operation = stringValue(source.operation, 'impact preview operation')
  const subject = record(source.subject, 'impact preview subject')
  const target = record(source.target, 'impact preview target')
  switch (operation) {
    case 'publisher.status':
      exactRecord(subject, 'impact preview subject', ['publisherId'])
      exactRecord(target, 'impact preview target', ['status', 'reason'], ['status'])
      return {
        operation,
        publisherId: stringValue(subject.publisherId, 'impact preview publisher id'),
        status: statusValue(target.status, PUBLISHER_STATUSES, 'impact preview publisher status'),
        reason: optionalReason(target.reason, 'impact preview reason')
      }
    case 'publisher-key.status':
      exactRecord(subject, 'impact preview subject', ['keyId'])
      exactRecord(target, 'impact preview target', ['status', 'reason'], ['status'])
      return {
        operation,
        keyId: stringValue(subject.keyId, 'impact preview key id'),
        status: statusValue(
          target.status,
          PUBLISHER_KEY_STATUSES,
          'impact preview publisher key status'
        ),
        reason: optionalReason(target.reason, 'impact preview reason')
      }
    case 'ownership.status':
      exactRecord(subject, 'impact preview subject', ['pluginId'])
      exactRecord(target, 'impact preview target', ['status', 'reason'], ['status'])
      return {
        operation,
        pluginId: stringValue(subject.pluginId, 'impact preview plugin id'),
        status: statusValue(target.status, OWNERSHIP_STATUSES, 'impact preview ownership status'),
        reason: optionalReason(target.reason, 'impact preview reason')
      }
    case 'submission.status':
      exactRecord(subject, 'impact preview subject', ['submissionId'])
      exactRecord(target, 'impact preview target', ['status', 'reason'], ['status'])
      return {
        operation,
        submissionId: stringValue(subject.submissionId, 'impact preview submission id'),
        status: statusValue(target.status, SUBMISSION_STATUSES, 'impact preview submission status'),
        reason: optionalReason(target.reason, 'impact preview reason')
      }
    case 'submission.publish':
      exactRecord(subject, 'impact preview subject', ['submissionId'])
      exactRecord(target, 'impact preview target', [], [])
      return {
        operation,
        submissionId: stringValue(subject.submissionId, 'impact preview submission id')
      }
    case 'release.yank':
      exactRecord(subject, 'impact preview subject', ['pluginId', 'version', 'channel'])
      exactRecord(target, 'impact preview target', ['reason'])
      return {
        operation,
        coordinate: {
          pluginId: stringValue(subject.pluginId, 'impact preview plugin id'),
          version: stringValue(subject.version, 'impact preview version'),
          channel: channel(stringValue(subject.channel, 'impact preview channel'))
        },
        reason: stringValue(target.reason, 'impact preview reason')
      }
    case 'marketplace.publish':
      exactRecord(subject, 'impact preview subject', [], [])
      exactRecord(target, 'impact preview target', [], [])
      return { operation }
    default:
      throw new TypeError('impact preview operation is not supported')
  }
}

export function createMarketplaceHttpApp(options: CreateMarketplaceHttpAppOptions): Hono {
  const app = new Hono()
  const cursorKey = options.cursorKey
    ? Promise.resolve(options.cursorKey)
    : createRandomMarketplaceControlCursorKey()
  const now = options.now ?? Date.now

  async function paginatedValue<Item>(
    context: Context,
    resource: MarketplaceControlResource,
    scope: string,
    query: MarketplaceControlListQuery,
    parseItem: MarketplaceControlItemParser<Item>,
    read: (
      page: MarketplaceControlReadPage & { expectedStateToken: string }
    ) => Promise<{ items: readonly Item[]; nextAfter: string | null; stateToken: string }>
  ) {
    const stateToken = await options.service.control.stateToken()
    const binding: MarketplaceControlCursorBinding = {
      resource,
      scope,
      sort: query.sort,
      filters: queryFilters(query),
      stateToken
    }
    const decoded = query.cursor
      ? await decodeMarketplaceControlCursor(query.cursor, await cursorKey, binding)
      : null
    const result = await read({
      limit: query.limit,
      ...(decoded ? { after: decoded.after } : {}),
      expectedStateToken: stateToken
    })
    const nextCursor = result.nextAfter
      ? await encodeMarketplaceControlCursor(
          {
            schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
            ...binding,
            stateToken: result.stateToken,
            after: result.nextAfter
          },
          await cursorKey
        )
      : null
    return parseMarketplaceControlPage(
      {
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        items: result.items,
        nextCursor
      },
      parseItem
    )
  }

  async function paginated<Item>(
    context: Context,
    resource: MarketplaceControlResource,
    scope: string,
    query: MarketplaceControlListQuery,
    parseItem: MarketplaceControlItemParser<Item>,
    read: (
      page: MarketplaceControlReadPage & { expectedStateToken: string }
    ) => Promise<{ items: readonly Item[]; nextAfter: string | null; stateToken: string }>
  ): Promise<Response> {
    return privateJSON(await paginatedValue(context, resource, scope, query, parseItem, read))
  }

  async function publisherAuditPage(
    context: Context,
    publisherId: string,
    query: MarketplaceControlListQuery
  ): Promise<Response> {
    const stateToken = await options.service.control.stateToken()
    const binding: MarketplaceControlCursorBinding = {
      resource: 'audit',
      scope: `publisher:${publisherId}`,
      sort: query.sort,
      filters: queryFilters(query),
      stateToken
    }
    const decoded = query.cursor
      ? await decodeMarketplaceControlCursor(query.cursor, await cursorKey, binding)
      : null
    const result = await options.service.control.publisherAudit(publisherId, {
      limit: query.limit,
      ...(decoded ? { after: decoded.after } : {}),
      expectedStateToken: stateToken,
      ...(query.filters.action
        ? {
            action: enumQueryFilter(
              query.filters.action,
              MARKETPLACE_AUDIT_ACTIONS,
              'publisher audit action filter'
            )
          }
        : {})
    })
    const nextCursor = result.nextAfter
      ? await encodeMarketplaceControlCursor(
          {
            schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
            ...binding,
            stateToken: result.stateToken,
            after: result.nextAfter
          },
          await cursorKey
        )
      : null
    return privateJSON(
      parseMarketplaceControlPublisherAuditPage({
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        publisherId,
        items: result.items,
        nextCursor
      })
    )
  }

  app.onError((error, context) => {
    let status: HttpError['status'] = 500
    if (error instanceof HttpError) status = error.status
    else if (error instanceof MarketplacePublisherMutationConflictError) status = 409
    else if (error instanceof MarketplacePublisherMutationCapacityError) status = 503
    else if (error instanceof MarketplaceControlStaleCursorError) status = 409
    else if (error instanceof MarketplaceImpactAuthorityError) status = 409
    else if (/already|cannot|changed|conflict/i.test(error.message)) status = 409
    else if (error instanceof TypeError) status = 400
    return context.json(
      { error: status === 500 ? 'Internal marketplace server error' : error.message },
      status
    )
  })

  app.use('/v1/publishers/*', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })
  app.use('/v1/submissions/*', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })
  app.use('/v1/submissions', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })
  app.use('/v1/ownerships', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })
  app.use('/v1/publisher-keys', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })
  app.use('/admin/*', async (context, next) => {
    context.header('cache-control', 'no-store')
    await next()
  })

  app.get('/health', (context) => context.json({ ok: true, service: 'openpencil-marketplace' }))

  app.get('/v1/snapshot', async () =>
    artifactResponse(await options.service.latestSnapshotArtifact(), false)
  )

  app.get('/v1/catalogs/:channel', async (context) =>
    artifactResponse(
      await options.service.latestCatalog(channel(context.req.param('channel'))),
      false
    )
  )

  app.get('/v1/runtime-index', async () =>
    artifactResponse(await options.service.latestRuntimeIndex(), false)
  )

  app.get('/v1/artifacts/:digest', async (context) => {
    const artifact = await options.service.publicArtifact(context.req.param('digest'))
    if (!artifact) {
      context.header('cache-control', 'no-store')
      throw new HttpError(404, 'Marketplace artifact was not found')
    }
    return artifactResponse(artifact)
  })

  app.get('/v1/plugins', async (context) => {
    context.header('cache-control', 'no-store')
    const limitValue = context.req.query('limit')
    const limit = limitValue === undefined ? undefined : Number(limitValue)
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100)) {
      throw new TypeError('Plugin search limit must be between 1 and 100')
    }
    const channelValue = context.req.query('channel')
    return context.json(
      await options.service.search({
        ...(context.req.query('q') ? { query: context.req.query('q') } : {}),
        ...(context.req.query('category') ? { category: context.req.query('category') } : {}),
        ...(channelValue ? { channel: channel(channelValue) } : {}),
        ...(limit === undefined ? {} : { limit })
      })
    )
  })

  app.get('/v1/plugins/:pluginId', async (context) => {
    context.header('cache-control', 'no-store')
    const pluginId = context.req.param('pluginId')
    const listing = await options.service.listing(pluginId)
    if (!listing) throw new HttpError(404, 'Marketplace plugin was not found')
    return context.json(listing)
  })

  app.get('/v1/audit', async (context) => {
    const page = await options.service.publicAuditPage(publicAuditPageQuery(context))
    context.header('cache-control', 'no-store')
    return context.json({
      events: page.events.map((event) => ({
        sequence: event.sequence,
        time: event.time,
        actor: event.actor,
        action: event.action,
        subject: event.subject,
        payloadDigest: event.payloadDigest,
        ...(event.contextDigest === undefined ? {} : { contextDigest: event.contextDigest }),
        previousHash: event.previousHash,
        eventHash: event.eventHash
      })),
      head: page.head,
      ...(page.nextAfter === null ? {} : { nextAfter: page.nextAfter })
    })
  })

  app.get('/v1/publishers/me', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Publisher profile does not accept query fields')
    }
    const publisher = await options.service.control.publisher(authenticated.publisherId)
    if (!publisher) throw new HttpError(404, 'Marketplace publisher was not found')
    return privateJSON(parseMarketplacePublisher(publisher))
  })

  app.get('/v1/publishers/me/keys', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: { status: statusQuery(MARKETPLACE_PUBLISHER_KEY_STATUSES) }
    })
    return paginated(
      context,
      'publisher-keys',
      `publisher:${authenticated.publisherId}`,
      query,
      parseMarketplaceControlPublisherKey,
      (page) =>
        options.service.control.publisherKeys({
          ...page,
          publisherId: authenticated.publisherId,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_PUBLISHER_KEY_STATUSES,
                  'publisher key status filter'
                )
              }
            : {})
        })
    )
  })

  app.get('/v1/publishers/me/ownerships', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: { status: statusQuery(MARKETPLACE_OWNERSHIP_STATUSES) }
    })
    return paginated(
      context,
      'ownerships',
      `publisher:${authenticated.publisherId}`,
      query,
      parseMarketplaceOwnership,
      (page) =>
        options.service.control.ownerships({
          ...page,
          publisherId: authenticated.publisherId,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_OWNERSHIP_STATUSES,
                  'ownership status filter'
                )
              }
            : {})
        })
    )
  })

  app.get('/v1/publishers/me/submissions', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_SUBMISSION_STATUSES),
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'submissions',
      `publisher:${authenticated.publisherId}`,
      query,
      parseMarketplaceControlSubmissionSummary,
      (page) =>
        options.service.control.submissions({
          ...page,
          publisherId: authenticated.publisherId,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_SUBMISSION_STATUSES,
                  'submission status filter'
                )
              }
            : {}),
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'submission channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.get('/v1/publishers/me/submissions/:submissionId', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Submission detail does not accept query fields')
    }
    const submission = await options.service.control.submission(
      context.req.param('submissionId'),
      authenticated.publisherId
    )
    if (!submission) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceControlSubmission(submission))
  })

  app.get('/v1/publishers/me/releases', async (context) => {
    const authenticated = await authenticate(context, new Uint8Array(), options)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['published'],
      defaultSort: 'published',
      filters: {
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'releases',
      `publisher:${authenticated.publisherId}`,
      query,
      parseMarketplaceControlRelease,
      (page) =>
        options.service.control.releases({
          ...page,
          publisherId: authenticated.publisherId,
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'release channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.post('/v1/publishers/register', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(body.value, 'publisher registration', ['publisher', 'key'])
    const publisher = exactRecord(source.publisher, 'publisher registration.publisher', [
      'id',
      'displayName'
    ])
    const key = record(source.key, 'publisher registration.key')
    const input: RegisterMarketplacePublisherInput = {
      publisher: {
        id: stringValue(publisher.id, 'publisher id'),
        displayName: stringValue(publisher.displayName, 'publisher display name')
      },
      key: parseRegisterMarketplacePublisherKeyInput(key)
    }
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'publisher.register',
      async (publisherId, keyId) => {
        if (
          input.publisher.id !== publisherId ||
          input.key.keyId !== keyId ||
          input.key.publisherId !== publisherId
        ) {
          return null
        }
        try {
          return await importEd25519PublicKeyPem(input.key.publicKeyPem)
        } catch {
          return null
        }
      }
    )
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'publisher.register',
            input
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.post('/v1/ownerships', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(body.value, 'ownership request', ['pluginId', 'publisherId'])
    const pluginId = stringValue(source.pluginId, 'ownership plugin id')
    const publisherId = stringValue(source.publisherId, 'ownership publisher id')
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'ownership.request'
    )
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'ownership.request',
            pluginId,
            publisherId
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.post('/v1/publisher-keys', async (context) => {
    const body = await boundedJSON(context)
    const input = parseRegisterMarketplacePublisherKeyInput(body.value)
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'key.rotate'
    )
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'key.rotate',
            input
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.post('/v1/submissions', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(
      body.value,
      'plugin submission',
      ['id', 'publisherId', 'channel', 'manifest', 'listing', 'runtimePackage'],
      ['id', 'publisherId', 'channel', 'manifest', 'listing']
    )
    const input = {
      id: stringValue(source.id, 'submission id'),
      publisherId: stringValue(source.publisherId, 'submission publisher id'),
      channel: channel(stringValue(source.channel, 'submission channel')),
      manifest: source.manifest,
      listing: source.listing as never,
      ...(Object.hasOwn(source, 'runtimePackage') ? { runtimePackage: source.runtimePackage } : {})
    }
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'submission.create'
    )
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'submission.create',
            input: {
              ...input,
              authenticatedRequestKeyId: authenticated.keyId
            }
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.post('/v1/submissions/validate', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(
      body.value,
      'submission validation',
      ['id', 'publisherId', 'channel', 'manifest', 'listing', 'runtimePackage'],
      ['id', 'publisherId', 'channel', 'manifest', 'listing']
    )
    const authenticated = await authenticate(context, body.bytes, options)
    if (source.publisherId !== authenticated.publisherId) {
      throw new HttpError(401, 'Submission publisher does not match its signature')
    }
    const validation = await options.service.validateSubmission({
      id: stringValue(source.id, 'submission id'),
      publisherId: authenticated.publisherId,
      channel: channel(stringValue(source.channel, 'submission channel')),
      manifest: source.manifest,
      listing: source.listing as never,
      ...(Object.hasOwn(source, 'runtimePackage') ? { runtimePackage: source.runtimePackage } : {}),
      authenticatedRequestKeyId: authenticated.keyId
    })
    return privateJSON(
      parseMarketplaceControlSubmissionValidation({
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        ...validation
      })
    )
  })

  app.post('/v1/submissions/:submissionId/revise', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(
      body.value,
      'submission revision',
      ['publisherId', 'expectedRevision', 'manifest', 'listing', 'runtimePackage'],
      ['publisherId', 'expectedRevision', 'manifest', 'listing']
    )
    const input = {
      publisherId: stringValue(source.publisherId, 'submission publisher id'),
      expectedRevision: positiveSafeIntegerValue(
        source.expectedRevision,
        'submission expectedRevision'
      ),
      manifest: source.manifest,
      listing: source.listing as never,
      ...(Object.hasOwn(source, 'runtimePackage') ? { runtimePackage: source.runtimePackage } : {})
    }
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'submission.revise'
    )
    const submissionId = context.req.param('submissionId')
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'submission.revise',
            submissionId,
            input
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.post('/v1/submissions/:submissionId/withdraw', async (context) => {
    const body = await boundedJSON(context)
    const source = exactRecord(body.value, 'submission withdrawal', ['reason'])
    const reason = stringValue(source.reason, 'withdrawal reason')
    const authenticated = await authenticatePublisherMutation(
      context,
      body.bytes,
      options,
      'submission.withdraw'
    )
    return publisherMutationResponse(
      await publisherMutation(() =>
        options.service.executePublisherMutation(
          authenticated,
          {
            type: 'submission.withdraw',
            submissionId: context.req.param('submissionId'),
            publisherId: authenticated.publisherId,
            reason
          },
          authenticated.verifiedAt
        )
      )
    )
  })

  app.get('/admin/operator/overview', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.overview.read')
    rejectQuery(context, 'Operator overview')
    const auditAccess =
      principal.authorization.role === 'security_admin' ||
      principal.authorization.role === 'super_admin'
        ? 'available'
        : 'restricted'
    return privateJSON(
      parseMarketplaceOperatorOverview(await options.service.control.overview(auditAccess))
    )
  })

  app.get('/admin/operator/publishers', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.publishers.read')
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: { status: statusQuery(MARKETPLACE_PUBLISHER_STATUSES) }
    })
    return paginated(
      context,
      'publishers',
      `operator:${principal.actor}`,
      query,
      parseMarketplacePublisher,
      (page) =>
        options.service.control.publishers({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_PUBLISHER_STATUSES,
                  'publisher status filter'
                )
              }
            : {})
        })
    )
  })

  app.get('/admin/operator/publishers/:publisherId', async (context) => {
    await authenticateOperator(context, options, now, 'operator.publisher.read')
    rejectQuery(context, 'Operator publisher detail')
    const publisher = await options.service.control.publisher(context.req.param('publisherId'))
    if (!publisher) throw new HttpError(404, 'Marketplace publisher was not found')
    return privateJSON(parseMarketplacePublisher(publisher))
  })

  app.get('/admin/operator/publishers/:publisherId/audit', async (context) => {
    await authenticateOperator(context, options, now, 'operator.audit.read')
    const publisherId = context.req.param('publisherId')
    if (!(await options.service.control.publisher(publisherId))) {
      throw new HttpError(404, 'Marketplace publisher was not found')
    }
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence',
      filters: { action: statusQuery(MARKETPLACE_AUDIT_ACTIONS) }
    })
    return publisherAuditPage(context, publisherId, query)
  })

  app.get(
    '/admin/operator/publishers/:publisherId/submissions/:submissionId/presentation',
    async (context) => {
      await authenticateOperator(context, options, now, 'operator.submission.presentation.read')
      rejectQuery(context, 'Operator submission presentation')
      const presentation = await options.service.submissionPresentation(
        context.req.param('submissionId'),
        context.req.param('publisherId')
      )
      if (!presentation) throw new HttpError(404, 'Marketplace submission was not found')
      return privateJSON(parseMarketplaceSubmissionPresentation(presentation))
    }
  )

  app.get(
    '/admin/operator/publishers/:publisherId/submissions/:submissionId/revision-diff/:fromRevision/:toRevision',
    async (context) => {
      await authenticateOperator(context, options, now, 'operator.submission.revision-diff.read')
      rejectQuery(context, 'Operator submission revision diff')
      const diff = await options.service.submissionRevisionDiff(
        context.req.param('submissionId'),
        context.req.param('publisherId'),
        positivePathSequence(context.req.param('fromRevision'), 'from submission revision'),
        positivePathSequence(context.req.param('toRevision'), 'to submission revision')
      )
      if (!diff) throw new HttpError(404, 'Marketplace submission was not found')
      return privateJSON(parseMarketplaceSubmissionRevisionDiff(diff))
    }
  )

  app.get('/admin/operator/submissions/:submissionId/presentation', async (context) => {
    await authenticateOperator(context, options, now, 'operator.submission.presentation.read')
    rejectQuery(context, 'Operator submission presentation')
    const submissionId = context.req.param('submissionId')
    const submission = await options.service.control.submission(submissionId)
    if (!submission) throw new HttpError(404, 'Marketplace submission was not found')
    const presentation = await options.service.submissionPresentation(
      submissionId,
      submission.publisherId
    )
    if (!presentation) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceSubmissionPresentation(presentation))
  })

  app.get(
    '/admin/operator/submissions/:submissionId/revision-diff/:fromRevision/:toRevision',
    async (context) => {
      await authenticateOperator(context, options, now, 'operator.submission.revision-diff.read')
      rejectQuery(context, 'Operator submission revision diff')
      const submissionId = context.req.param('submissionId')
      const submission = await options.service.control.submission(submissionId)
      if (!submission) throw new HttpError(404, 'Marketplace submission was not found')
      const diff = await options.service.submissionRevisionDiff(
        submissionId,
        submission.publisherId,
        positivePathSequence(context.req.param('fromRevision'), 'from submission revision'),
        positivePathSequence(context.req.param('toRevision'), 'to submission revision')
      )
      if (!diff) throw new HttpError(404, 'Marketplace submission was not found')
      return privateJSON(parseMarketplaceSubmissionRevisionDiff(diff))
    }
  )

  app.get('/admin/operator/submissions/:submissionId/current-check-report', async (context) => {
    await authenticateOperator(
      context,
      options,
      now,
      'operator.submission.current-check-report.read'
    )
    rejectQuery(context, 'Operator submission current check report')
    const report = await options.service.submissionCurrentCheckReport(
      context.req.param('submissionId')
    )
    if (!report) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceSubmissionCurrentCheckReport(report))
  })

  app.get('/admin/operator/submissions/:submissionId/reviewer-history', async (context) => {
    await authenticateOperator(context, options, now, 'operator.submission.reviewer-history.read')
    const history = await options.service.submissionReviewerHistory(
      context.req.param('submissionId'),
      parseMarketplaceSubmissionReviewerHistoryQuery(new URL(context.req.url).search)
    )
    if (!history) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceSubmissionReviewerHistory(history))
  })

  app.get('/admin/operator/publisher-keys', async (context) => {
    const principal = await authenticateOperator(
      context,
      options,
      now,
      'operator.publisher-keys.read'
    )
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_PUBLISHER_KEY_STATUSES),
        publisherId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'publisher-keys',
      `operator:${principal.actor}`,
      query,
      parseMarketplaceControlPublisherKey,
      (page) =>
        options.service.control.publisherKeys({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_PUBLISHER_KEY_STATUSES,
                  'publisher key status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {})
        })
    )
  })

  app.get('/admin/operator/publisher-keys/:keyId', async (context) => {
    await authenticateOperator(context, options, now, 'operator.publisher-key.read')
    rejectQuery(context, 'Operator publisher key detail')
    const key = await options.service.control.publisherKey(context.req.param('keyId'))
    if (!key) throw new HttpError(404, 'Marketplace publisher key was not found')
    return privateJSON(parseMarketplaceControlPublisherKey(key))
  })

  app.get('/admin/operator/ownerships', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.ownerships.read')
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_OWNERSHIP_STATUSES),
        publisherId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'ownerships',
      `operator:${principal.actor}`,
      query,
      parseMarketplaceOwnership,
      (page) =>
        options.service.control.ownerships({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_OWNERSHIP_STATUSES,
                  'ownership status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {})
        })
    )
  })

  app.get('/admin/operator/ownerships/:pluginId', async (context) => {
    await authenticateOperator(context, options, now, 'operator.ownership.read')
    rejectQuery(context, 'Operator ownership detail')
    const ownership = await options.service.control.ownership(context.req.param('pluginId'))
    if (!ownership) throw new HttpError(404, 'Marketplace ownership was not found')
    return privateJSON(parseMarketplaceOwnership(ownership))
  })

  app.get('/admin/operator/submissions', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.submissions.read')
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_SUBMISSION_STATUSES),
        publisherId: { kind: 'identity' },
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'submissions',
      `operator:${principal.actor}`,
      query,
      parseMarketplaceControlSubmissionSummary,
      (page) =>
        options.service.control.submissions({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_SUBMISSION_STATUSES,
                  'submission status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {}),
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'submission channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.get('/admin/operator/submissions/:submissionId', async (context) => {
    await authenticateOperator(context, options, now, 'operator.submission.read')
    rejectQuery(context, 'Operator submission detail')
    const submission = await options.service.control.submission(context.req.param('submissionId'))
    if (!submission) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceControlSubmission(submission))
  })

  app.get('/admin/operator/releases', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.releases.read')
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['published'],
      defaultSort: 'published',
      filters: {
        publisherId: { kind: 'identity' },
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'releases',
      `operator:${principal.actor}`,
      query,
      parseMarketplaceControlRelease,
      (page) =>
        options.service.control.releases({
          ...page,
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {}),
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'release channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.get('/admin/operator/releases/:channel/:pluginId/:version', async (context) => {
    await authenticateOperator(context, options, now, 'operator.release.read')
    rejectQuery(context, 'Operator release detail')
    const release = await options.service.control.release(
      parseMarketplaceReleaseCoordinate({
        channel: channel(context.req.param('channel')),
        pluginId: context.req.param('pluginId'),
        version: context.req.param('version')
      })
    )
    if (!release) throw new HttpError(404, 'Marketplace release was not found')
    return privateJSON(parseMarketplaceControlRelease(release))
  })

  app.get('/admin/operator/publications', async (context) => {
    const principal = await authenticateOperator(
      context,
      options,
      now,
      'operator.publications.read'
    )
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence'
    })
    const publications = await paginatedValue(
      context,
      'publications',
      `operator:${principal.actor}`,
      query,
      parseMarketplacePublication,
      (page) => options.service.control.publications(page)
    )
    return privateJSON(
      parseMarketplaceOperatorPublications({
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        onlineSigning: {
          enabled: false,
          reason: 'Online root signing is disabled; use the offline publication workflow'
        },
        publications
      })
    )
  })

  app.get('/admin/operator/publications/:sequence', async (context) => {
    await authenticateOperator(context, options, now, 'operator.publication.read')
    rejectQuery(context, 'Operator publication detail')
    const publication = await options.service.control.publication(
      positivePathSequence(context.req.param('sequence'), 'publication sequence')
    )
    if (!publication) throw new HttpError(404, 'Marketplace publication was not found')
    return privateJSON(parseMarketplacePublication(publication))
  })

  app.get('/admin/operator/audit', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.audit.read')
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence',
      filters: {
        action: statusQuery(MARKETPLACE_AUDIT_ACTIONS),
        actor: { kind: 'text', maxBytes: 256 }
      }
    })
    return paginated(
      context,
      'audit',
      `operator:${principal.actor}`,
      query,
      parseMarketplaceControlAuditEvent,
      (page) =>
        options.service.control.audit({
          ...page,
          ...(query.filters.action
            ? {
                action: enumQueryFilter(
                  query.filters.action,
                  MARKETPLACE_AUDIT_ACTIONS,
                  'audit action filter'
                )
              }
            : {}),
          ...(query.filters.actor ? { actor: query.filters.actor } : {})
        })
    )
  })

  app.get('/admin/operator/audit/:sequence', async (context) => {
    await authenticateOperator(context, options, now, 'operator.audit-event.read')
    rejectQuery(context, 'Operator audit event detail')
    const event = await options.service.control.auditEvent(
      positivePathSequence(context.req.param('sequence'), 'audit sequence')
    )
    if (!event) throw new HttpError(404, 'Marketplace audit event was not found')
    return privateJSON(
      parseMarketplaceControlDetail(
        { schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION, item: event },
        parseMarketplaceControlAuditEvent
      )
    )
  })

  app.get('/admin/summary', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Admin summary does not accept query fields')
    }
    return privateJSON(parseMarketplaceControlSummary(await options.service.control.summary()))
  })

  app.get('/admin/publishers', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: { status: statusQuery(MARKETPLACE_PUBLISHER_STATUSES) }
    })
    return paginated(
      context,
      'publishers',
      `admin:${principal.actor}`,
      query,
      parseMarketplacePublisher,
      (page) =>
        options.service.control.publishers({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_PUBLISHER_STATUSES,
                  'publisher status filter'
                )
              }
            : {})
        })
    )
  })

  app.get('/admin/publishers/:publisherId', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    rejectQuery(context, 'Admin publisher detail')
    const publisher = await options.service.control.publisher(context.req.param('publisherId'))
    if (!publisher) throw new HttpError(404, 'Marketplace publisher was not found')
    return privateJSON(parseMarketplacePublisher(publisher))
  })

  app.get('/admin/publishers/:publisherId/audit', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const publisherId = context.req.param('publisherId')
    if (!(await options.service.control.publisher(publisherId))) {
      throw new HttpError(404, 'Marketplace publisher was not found')
    }
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence',
      filters: { action: statusQuery(MARKETPLACE_AUDIT_ACTIONS) }
    })
    return publisherAuditPage(context, publisherId, query)
  })

  app.get(
    '/admin/publishers/:publisherId/submissions/:submissionId/presentation',
    async (context) => {
      await authenticateAdmin(context, options.admin, now, options.service.nonces)
      rejectQuery(context, 'Admin submission presentation')
      const presentation = await options.service.submissionPresentation(
        context.req.param('submissionId'),
        context.req.param('publisherId')
      )
      if (!presentation) throw new HttpError(404, 'Marketplace submission was not found')
      return privateJSON(parseMarketplaceSubmissionPresentation(presentation))
    }
  )

  app.get(
    '/admin/publishers/:publisherId/submissions/:submissionId/revision-diff/:fromRevision/:toRevision',
    async (context) => {
      await authenticateAdmin(context, options.admin, now, options.service.nonces)
      rejectQuery(context, 'Admin submission revision diff')
      const diff = await options.service.submissionRevisionDiff(
        context.req.param('submissionId'),
        context.req.param('publisherId'),
        positivePathSequence(context.req.param('fromRevision'), 'from submission revision'),
        positivePathSequence(context.req.param('toRevision'), 'to submission revision')
      )
      if (!diff) throw new HttpError(404, 'Marketplace submission was not found')
      return privateJSON(parseMarketplaceSubmissionRevisionDiff(diff))
    }
  )

  app.get('/admin/publisher-keys', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_PUBLISHER_KEY_STATUSES),
        publisherId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'publisher-keys',
      `admin:${principal.actor}`,
      query,
      parseMarketplaceControlPublisherKey,
      (page) =>
        options.service.control.publisherKeys({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_PUBLISHER_KEY_STATUSES,
                  'publisher key status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {})
        })
    )
  })

  app.get('/admin/publisher-keys/:keyId', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    rejectQuery(context, 'Admin publisher key detail')
    const key = await options.service.control.publisherKey(context.req.param('keyId'))
    if (!key) throw new HttpError(404, 'Marketplace publisher key was not found')
    return privateJSON(parseMarketplaceControlPublisherKey(key))
  })

  app.get('/admin/ownerships', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_OWNERSHIP_STATUSES),
        publisherId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'ownerships',
      `admin:${principal.actor}`,
      query,
      parseMarketplaceOwnership,
      (page) =>
        options.service.control.ownerships({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_OWNERSHIP_STATUSES,
                  'ownership status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {})
        })
    )
  })

  app.get('/admin/ownerships/:pluginId', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    rejectQuery(context, 'Admin ownership detail')
    const ownership = await options.service.control.ownership(context.req.param('pluginId'))
    if (!ownership) throw new HttpError(404, 'Marketplace ownership was not found')
    return privateJSON(parseMarketplaceOwnership(ownership))
  })

  app.get('/admin/submissions', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['created'],
      defaultSort: 'created',
      filters: {
        status: statusQuery(MARKETPLACE_SUBMISSION_STATUSES),
        publisherId: { kind: 'identity' },
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'submissions',
      `admin:${principal.actor}`,
      query,
      parseMarketplaceControlSubmissionSummary,
      (page) =>
        options.service.control.submissions({
          ...page,
          ...(query.filters.status
            ? {
                status: enumQueryFilter(
                  query.filters.status,
                  MARKETPLACE_SUBMISSION_STATUSES,
                  'submission status filter'
                )
              }
            : {}),
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {}),
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'submission channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.get('/admin/submissions/:submissionId', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    rejectQuery(context, 'Admin submission detail')
    const submission = await options.service.control.submission(context.req.param('submissionId'))
    if (!submission) throw new HttpError(404, 'Marketplace submission was not found')
    return privateJSON(parseMarketplaceControlSubmission(submission))
  })

  app.get('/admin/releases', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['published'],
      defaultSort: 'published',
      filters: {
        publisherId: { kind: 'identity' },
        channel: statusQuery(MARKETPLACE_RELEASE_CHANNELS),
        pluginId: { kind: 'identity' }
      }
    })
    return paginated(
      context,
      'releases',
      `admin:${principal.actor}`,
      query,
      parseMarketplaceControlRelease,
      (page) =>
        options.service.control.releases({
          ...page,
          ...(query.filters.publisherId ? { publisherId: query.filters.publisherId } : {}),
          ...(query.filters.channel
            ? {
                channel: enumQueryFilter(
                  query.filters.channel,
                  MARKETPLACE_RELEASE_CHANNELS,
                  'release channel filter'
                )
              }
            : {}),
          ...(query.filters.pluginId ? { pluginId: query.filters.pluginId } : {})
        })
    )
  })

  app.get('/admin/releases/:channel/:pluginId/:version', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Admin release detail does not accept query fields')
    }
    const release = await options.service.control.release(
      parseMarketplaceReleaseCoordinate({
        channel: channel(context.req.param('channel')),
        pluginId: context.req.param('pluginId'),
        version: context.req.param('version')
      })
    )
    if (!release) throw new HttpError(404, 'Marketplace release was not found')
    return privateJSON(parseMarketplaceControlRelease(release))
  })

  app.get('/admin/publications', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence'
    })
    return paginated(
      context,
      'publications',
      `admin:${principal.actor}`,
      query,
      parseMarketplacePublication,
      (page) => options.service.control.publications(page)
    )
  })

  app.get('/admin/publications/:sequence', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Admin publication detail does not accept query fields')
    }
    const publication = await options.service.control.publication(
      positivePathSequence(context.req.param('sequence'), 'publication sequence')
    )
    if (!publication) throw new HttpError(404, 'Marketplace publication was not found')
    return privateJSON(parseMarketplacePublication(publication))
  })

  app.get('/admin/audit', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const query = parseMarketplaceControlListQuery(new URL(context.req.url).search, {
      sorts: ['sequence'],
      defaultSort: 'sequence',
      filters: {
        action: statusQuery(MARKETPLACE_AUDIT_ACTIONS),
        actor: { kind: 'text', maxBytes: 256 }
      }
    })
    return paginated(
      context,
      'audit',
      `admin:${principal.actor}`,
      query,
      parseMarketplaceControlAuditEvent,
      (page) =>
        options.service.control.audit({
          ...page,
          ...(query.filters.action
            ? {
                action: enumQueryFilter(
                  query.filters.action,
                  MARKETPLACE_AUDIT_ACTIONS,
                  'audit action filter'
                )
              }
            : {}),
          ...(query.filters.actor ? { actor: query.filters.actor } : {})
        })
    )
  })

  app.get('/admin/audit/:sequence', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    if (new URL(context.req.url).search !== '') {
      throw new TypeError('Admin audit detail does not accept query fields')
    }
    const event = await options.service.control.auditEvent(
      positivePathSequence(context.req.param('sequence'), 'audit sequence')
    )
    if (!event) throw new HttpError(404, 'Marketplace audit event was not found')
    return privateJSON(
      parseMarketplaceControlDetail(
        { schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION, item: event },
        parseMarketplaceControlAuditEvent
      )
    )
  })

  app.post('/admin/operator/impact-preview', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'operator.impact.preview')
    const body = await boundedJSON(context)
    const request = impactRequest(body.value)
    const prospective = await prospectiveOperatorAction(options.service, request)
    try {
      assertMarketplaceOperatorImpactPreviewAuthorization(principal.authorization, prospective, {
        assertionTimestamp: principal.assertionTimestamp,
        now: now()
      })
    } catch {
      throw new HttpError(403, 'Marketplace operator cannot preview this action')
    }
    return privateJSON(parseMarketplaceImpactPreview(await options.service.previewImpact(request)))
  })

  app.post('/admin/operator/publishers/:publisherId/approve', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'publisher.approve')
    const body = exactRecord((await boundedJSON(context)).value, 'publisher approve', [
      'reason',
      'authorityDigest'
    ])
    return privateJSON(
      parseMarketplacePublisher(
        await options.service.transitionPublisher(
          context.req.param('publisherId'),
          'active',
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest),
          'approve'
        )
      )
    )
  })

  for (const action of ['reject', 'suspend', 'reactivate'] as const) {
    const operation = `publisher.${action}` as const
    let status: MarketplacePublisherStatus = 'active'
    if (action === 'reject') status = 'rejected'
    else if (action === 'suspend') status = 'suspended'
    app.post(`/admin/operator/publishers/:publisherId/${action}`, async (context) => {
      const principal = await authenticateOperator(context, options, now, operation)
      const body = exactRecord((await boundedJSON(context)).value, `publisher ${action}`, [
        'reason',
        'typedIdentifier',
        'authorityDigest'
      ])
      assertTypedIdentifier(body.typedIdentifier, `publisher:${context.req.param('publisherId')}`)
      return privateJSON(
        parseMarketplacePublisher(
          await options.service.transitionPublisher(
            context.req.param('publisherId'),
            status,
            operatorMutationContext(body, principal),
            authorityDigest(body.authorityDigest),
            action === 'reactivate' ? 'reactivate' : undefined
          )
        )
      )
    })
  }

  app.post('/admin/operator/publisher-keys/:keyId/approve', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'publisher-key.approve')
    const body = exactRecord((await boundedJSON(context)).value, 'publisher key approve', [
      'reason',
      'authorityDigest'
    ])
    return privateJSON(
      toMarketplaceControlPublisherKey(
        await options.service.transitionPublisherKey(
          context.req.param('keyId'),
          'active',
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  for (const action of ['reject', 'revoke'] as const) {
    const operation = `publisher-key.${action}` as const
    const status = action === 'reject' ? 'rejected' : 'revoked'
    app.post(`/admin/operator/publisher-keys/:keyId/${action}`, async (context) => {
      const principal = await authenticateOperator(context, options, now, operation)
      const body = exactRecord((await boundedJSON(context)).value, `publisher key ${action}`, [
        'reason',
        'typedIdentifier',
        'authorityDigest'
      ])
      assertTypedIdentifier(body.typedIdentifier, `publisher-key:${context.req.param('keyId')}`)
      return privateJSON(
        toMarketplaceControlPublisherKey(
          await options.service.transitionPublisherKey(
            context.req.param('keyId'),
            status,
            operatorMutationContext(body, principal),
            authorityDigest(body.authorityDigest)
          )
        )
      )
    })
  }

  app.post('/admin/operator/ownerships/:pluginId/approve', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'ownership.approve')
    const body = exactRecord((await boundedJSON(context)).value, 'ownership approve', [
      'reason',
      'authorityDigest'
    ])
    return privateJSON(
      parseMarketplaceOwnership(
        await options.service.transitionOwnership(
          context.req.param('pluginId'),
          'active',
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/operator/ownerships/:pluginId/reject', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'ownership.reject')
    const body = exactRecord((await boundedJSON(context)).value, 'ownership reject', [
      'reason',
      'typedIdentifier',
      'authorityDigest'
    ])
    assertTypedIdentifier(body.typedIdentifier, `ownership:${context.req.param('pluginId')}`)
    return privateJSON(
      parseMarketplaceOwnership(
        await options.service.transitionOwnership(
          context.req.param('pluginId'),
          'rejected',
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  const submissionDecisions = [
    ['approve', 'submission.approve', 'approved'],
    ['request-changes', 'submission.request-changes', 'changes_requested'],
    ['reject', 'submission.reject', 'rejected']
  ] as const
  for (const [action, operation, status] of submissionDecisions) {
    app.post(`/admin/operator/submissions/:submissionId/${action}`, async (context) => {
      const principal = await authenticateOperator(context, options, now, operation)
      const highRisk = action === 'reject'
      const body = exactRecord(
        (await boundedJSON(context)).value,
        `submission ${action}`,
        highRisk ? ['reason', 'typedIdentifier', 'authorityDigest'] : ['reason', 'authorityDigest']
      )
      if (highRisk) {
        assertTypedIdentifier(
          body.typedIdentifier,
          `submission:${context.req.param('submissionId')}`
        )
      }
      return privateJSON(
        toMarketplaceControlSubmissionSummary(
          await options.service.transitionSubmission(
            context.req.param('submissionId'),
            status,
            operatorMutationContext(body, principal),
            authorityDigest(body.authorityDigest)
          )
        )
      )
    })
  }

  app.post('/admin/operator/submissions/:submissionId/publish', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'release.publish')
    const body = exactRecord((await boundedJSON(context)).value, 'submission publish', [
      'reason',
      'typedIdentifier',
      'authorityDigest'
    ])
    assertTypedIdentifier(body.typedIdentifier, `submission:${context.req.param('submissionId')}`)
    return privateJSON(
      toMarketplaceControlRelease(
        await options.service.publishSubmission(
          context.req.param('submissionId'),
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/operator/releases/yank', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'release.yank')
    const body = exactRecord((await boundedJSON(context)).value, 'release yank', [
      'pluginId',
      'version',
      'channel',
      'reason',
      'typedIdentifier',
      'authorityDigest'
    ])
    const coordinate = parseMarketplaceReleaseCoordinate({
      pluginId: body.pluginId,
      version: body.version,
      channel: body.channel
    })
    assertTypedIdentifier(
      body.typedIdentifier,
      `release:${coordinate.pluginId}@${coordinate.version}#${coordinate.channel}`
    )
    return privateJSON(
      toMarketplaceControlRelease(
        await options.service.yankRelease(
          coordinate,
          operatorMutationContext(body, principal),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/operator/publications/publish', async (context) => {
    const principal = await authenticateOperator(context, options, now, 'publication.publish')
    const body = exactRecord((await boundedJSON(context)).value, 'publication publish', [
      'reason',
      'typedIdentifier',
      'authorityDigest'
    ])
    operatorMutationContext(body, principal)
    assertTypedIdentifier(body.typedIdentifier, 'publication:global')
    authorityDigest(body.authorityDigest)
    throw new HttpError(404, 'Online marketplace root signing is disabled')
  })

  app.post('/admin/impact-preview', async (context) => {
    await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = await boundedJSON(context)
    return privateJSON(
      parseMarketplaceImpactPreview(await options.service.previewImpact(impactRequest(body.value)))
    )
  })

  app.post('/admin/publishers/:publisherId/status', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord(
      (await boundedJSON(context)).value,
      'publisher status',
      ['status', 'reason', 'authorityDigest'],
      ['status', 'authorityDigest']
    )
    return privateJSON(
      parseMarketplacePublisher(
        await options.service.transitionPublisher(
          context.req.param('publisherId'),
          statusValue(body.status, PUBLISHER_STATUSES, 'publisher status'),
          mutationContext(body, principal.actor),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/publisher-keys/:keyId/status', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord(
      (await boundedJSON(context)).value,
      'publisher key status',
      ['status', 'reason', 'authorityDigest'],
      ['status', 'authorityDigest']
    )
    return privateJSON(
      toMarketplaceControlPublisherKey(
        await options.service.transitionPublisherKey(
          context.req.param('keyId'),
          statusValue(body.status, PUBLISHER_KEY_STATUSES, 'publisher key status'),
          mutationContext(body, principal.actor),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/ownerships/:pluginId/status', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord(
      (await boundedJSON(context)).value,
      'ownership status',
      ['status', 'reason', 'authorityDigest'],
      ['status', 'authorityDigest']
    )
    return privateJSON(
      parseMarketplaceOwnership(
        await options.service.transitionOwnership(
          context.req.param('pluginId'),
          statusValue(body.status, OWNERSHIP_STATUSES, 'ownership status'),
          mutationContext(body, principal.actor),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/submissions/:submissionId/status', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord(
      (await boundedJSON(context)).value,
      'submission status',
      ['status', 'reason', 'authorityDigest'],
      ['status', 'authorityDigest']
    )
    const status = statusValue(body.status, SUBMISSION_STATUSES, 'submission status')
    if (status === 'published' || status === 'yanked') {
      throw new TypeError('Submission publish and yank require their dedicated release routes')
    }
    return privateJSON(
      toMarketplaceControlSubmissionSummary(
        await options.service.transitionSubmission(
          context.req.param('submissionId'),
          status,
          mutationContext(body, principal.actor),
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/submissions/:submissionId/publish', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord((await boundedJSON(context)).value, 'submission publish', [
      'authorityDigest'
    ])
    return privateJSON(
      toMarketplaceControlRelease(
        await options.service.publishSubmission(
          context.req.param('submissionId'),
          { actor: principal.actor },
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/releases/yank', async (context) => {
    const principal = await authenticateAdmin(context, options.admin, now, options.service.nonces)
    const body = exactRecord((await boundedJSON(context)).value, 'release yank', [
      'pluginId',
      'version',
      'channel',
      'reason',
      'authorityDigest'
    ])
    return privateJSON(
      toMarketplaceControlRelease(
        await options.service.yankRelease(
          {
            pluginId: stringValue(body.pluginId, 'release plugin id'),
            version: stringValue(body.version, 'release version'),
            channel: channel(stringValue(body.channel, 'release channel'))
          },
          { actor: principal.actor, reason: stringValue(body.reason, 'yank reason') },
          authorityDigest(body.authorityDigest)
        )
      )
    )
  })

  app.post('/admin/publish', () => {
    throw new HttpError(404, 'Online marketplace signing is disabled')
  })

  return app
}
