import { timingSafeEqual } from 'node:crypto'

import { Hono, type Context } from 'hono'

import { importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  MARKETPLACE_REQUEST_AUTH_LIMITS,
  verifyMarketplaceRequest,
  type MarketplaceNonceStore,
  type MarketplaceSignedRequestHeaders
} from './auth'
import type { MarketplaceService, RegisterMarketplacePublisherInput } from './service'
import {
  MARKETPLACE_RELEASE_CHANNELS,
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
  onlinePublishing?: boolean
}

export interface CreateMarketplaceHttpAppOptions {
  service: MarketplaceService
  nonces: MarketplaceNonceStore
  admin?: MarketplaceHttpAdminOptions
  now?: () => number
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

async function boundedJson(context: Context): Promise<ParsedBody> {
  const contentType = context.req.header('content-type')?.toLowerCase() ?? ''
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
    throw new TypeError('Request Content-Type must be application/json')
  }
  const contentLength = context.req.header('content-length')
  if (contentLength) {
    const parsed = Number(contentLength)
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 0 ||
      parsed > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes
    ) {
      throw new TypeError('Marketplace request body exceeds the byte limit')
    }
  }
  const bytes = new Uint8Array(await context.req.raw.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MARKETPLACE_REQUEST_AUTH_LIMITS.maxBodyBytes) {
    throw new TypeError('Marketplace request body must be non-empty and bounded')
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

function signedHeaders(context: Context): MarketplaceSignedRequestHeaders {
  const header = (name: string) => stringValue(context.req.header(name), `header ${name}`)
  return {
    publisherId: header('x-openpencil-publisher-id'),
    keyId: header('x-openpencil-key-id'),
    timestamp: header('x-openpencil-timestamp'),
    nonce: header('x-openpencil-nonce'),
    signature: header('x-openpencil-signature')
  }
}

async function authenticate(
  context: Context,
  body: Uint8Array,
  options: CreateMarketplaceHttpAppOptions,
  resolvePublicKey?: (publisherId: string, keyId: string) => Promise<CryptoKey | null>
) {
  try {
    return await verifyMarketplaceRequest(
      {
        method: context.req.method,
        url: context.req.url,
        body,
        headers: signedHeaders(context)
      },
      {
        ...(options.now ? { now: options.now } : {}),
        nonces: options.nonces,
        resolvePublicKey:
          resolvePublicKey ??
          ((publisherId, keyId) => options.service.resolveActivePublisherKey(publisherId, keyId))
      }
    )
  } catch (error) {
    throw new HttpError(
      401,
      error instanceof Error ? error.message : 'Marketplace request authentication failed'
    )
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

function assertAdmin(context: Context, admin: MarketplaceHttpAdminOptions | undefined): void {
  if (!admin?.enabled) throw new HttpError(404, 'Admin HTTP routes are disabled')
  if (typeof admin.token !== 'string' || admin.token.length < 32 || admin.token.length > 512) {
    throw new HttpError(503, 'Admin HTTP authentication is not configured')
  }
  const provided = bearerToken(context)
  if (!provided || !equalToken(provided, admin.token)) {
    throw new HttpError(401, 'Admin bearer token is invalid')
  }
}

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 404 | 409 | 413 | 415 | 500 | 503,
    message: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
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

export function createMarketplaceHttpApp(options: CreateMarketplaceHttpAppOptions): Hono {
  const app = new Hono()

  app.onError((error, context) => {
    let status: HttpError['status'] = 500
    if (error instanceof HttpError) status = error.status
    else if (error instanceof TypeError) status = 400
    else if (/already|cannot|changed|conflict/i.test(error.message)) status = 409
    return context.json(
      { error: status === 500 ? 'Internal marketplace server error' : error.message },
      status
    )
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

  app.get('/v1/artifacts/:digest', async (context) =>
    artifactResponse(await options.service.artifact(context.req.param('digest')))
  )

  app.get('/v1/plugins', async (context) => {
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
    const pluginId = context.req.param('pluginId')
    const listing = await options.service.listing(pluginId)
    if (!listing) throw new HttpError(404, 'Marketplace plugin was not found')
    return context.json(listing)
  })

  app.get('/v1/audit', async (context) => {
    const auditEvents = (await options.service.snapshot()).auditEvents
    context.header('cache-control', 'no-store')
    return context.json({ events: auditEvents, head: auditEvents.at(-1)?.eventHash ?? null })
  })

  app.post('/v1/publishers/register', async (context) => {
    const body = await boundedJson(context)
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
    const authenticated = await authenticate(
      context,
      body.bytes,
      options,
      async (publisherId, keyId) => {
        if (
          input.publisher.id !== publisherId ||
          input.key.keyId !== keyId ||
          input.key.publisherId !== publisherId
        ) {
          return null
        }
        return importEd25519PublicKeyPem(input.key.publicKeyPem)
      }
    )
    const value = await options.service.registerPublisher(input, {
      actor: `publisher:${authenticated.publisherId}`,
      time: signedHeaders(context).timestamp
    })
    return context.json(value, 201)
  })

  app.post('/v1/ownerships', async (context) => {
    const body = await boundedJson(context)
    const source = exactRecord(body.value, 'ownership request', ['pluginId', 'publisherId'])
    const authenticated = await authenticate(context, body.bytes, options)
    if (source.publisherId !== authenticated.publisherId) {
      throw new HttpError(401, 'Ownership request publisher does not match its signature')
    }
    const ownership = await options.service.requestOwnership(
      stringValue(source.pluginId, 'ownership plugin id'),
      authenticated.publisherId,
      { actor: `publisher:${authenticated.publisherId}`, time: signedHeaders(context).timestamp }
    )
    return context.json(ownership, 201)
  })

  app.post('/v1/publisher-keys', async (context) => {
    const body = await boundedJson(context)
    const input = parseRegisterMarketplacePublisherKeyInput(body.value)
    const authenticated = await authenticate(context, body.bytes, options)
    if (
      input.publisherId !== authenticated.publisherId ||
      input.predecessorKeyId !== authenticated.keyId
    ) {
      throw new HttpError(
        401,
        'Publisher key rotation must be signed by its exact active predecessor key'
      )
    }
    const key = await options.service.registerPublisherKey(input, {
      actor: `publisher:${authenticated.publisherId}`,
      time: signedHeaders(context).timestamp
    })
    return context.json(key, 201)
  })

  app.post('/v1/submissions', async (context) => {
    const body = await boundedJson(context)
    const source = exactRecord(
      body.value,
      'plugin submission',
      ['id', 'publisherId', 'channel', 'manifest', 'listing', 'runtimePackage'],
      ['id', 'publisherId', 'channel', 'manifest', 'listing']
    )
    const authenticated = await authenticate(context, body.bytes, options)
    if (source.publisherId !== authenticated.publisherId) {
      throw new HttpError(401, 'Submission publisher does not match its signature')
    }
    const submission = await options.service.submit(
      {
        id: stringValue(source.id, 'submission id'),
        publisherId: authenticated.publisherId,
        channel: channel(stringValue(source.channel, 'submission channel')),
        manifest: source.manifest,
        listing: source.listing as never,
        ...(Object.hasOwn(source, 'runtimePackage')
          ? { runtimePackage: source.runtimePackage }
          : {})
      },
      { actor: `publisher:${authenticated.publisherId}`, time: signedHeaders(context).timestamp }
    )
    return context.json(submission, 201)
  })

  app.post('/v1/submissions/:submissionId/withdraw', async (context) => {
    const body = await boundedJson(context)
    const source = exactRecord(body.value, 'submission withdrawal', ['reason'])
    const authenticated = await authenticate(context, body.bytes, options)
    const submission = await options.service.withdrawSubmission(
      context.req.param('submissionId'),
      authenticated.publisherId,
      stringValue(source.reason, 'withdrawal reason'),
      { actor: `publisher:${authenticated.publisherId}`, time: signedHeaders(context).timestamp }
    )
    return context.json(submission)
  })

  app.post('/admin/publishers/:publisherId/status', async (context) => {
    assertAdmin(context, options.admin)
    const body = exactRecord(
      (await boundedJson(context)).value,
      'publisher status',
      ['status', 'reason'],
      ['status']
    )
    return context.json(
      await options.service.transitionPublisher(
        context.req.param('publisherId'),
        statusValue(body.status, PUBLISHER_STATUSES, 'publisher status'),
        mutationContext(body, 'admin:http')
      )
    )
  })

  app.post('/admin/publisher-keys/:keyId/status', async (context) => {
    assertAdmin(context, options.admin)
    const body = exactRecord(
      (await boundedJson(context)).value,
      'publisher key status',
      ['status', 'reason'],
      ['status']
    )
    return context.json(
      await options.service.transitionPublisherKey(
        context.req.param('keyId'),
        statusValue(body.status, PUBLISHER_KEY_STATUSES, 'publisher key status'),
        mutationContext(body, 'admin:http')
      )
    )
  })

  app.post('/admin/ownerships/:pluginId/status', async (context) => {
    assertAdmin(context, options.admin)
    const body = exactRecord(
      (await boundedJson(context)).value,
      'ownership status',
      ['status', 'reason'],
      ['status']
    )
    return context.json(
      await options.service.transitionOwnership(
        context.req.param('pluginId'),
        statusValue(body.status, OWNERSHIP_STATUSES, 'ownership status'),
        mutationContext(body, 'admin:http')
      )
    )
  })

  app.post('/admin/submissions/:submissionId/status', async (context) => {
    assertAdmin(context, options.admin)
    const body = exactRecord(
      (await boundedJson(context)).value,
      'submission status',
      ['status', 'reason'],
      ['status']
    )
    return context.json(
      await options.service.transitionSubmission(
        context.req.param('submissionId'),
        statusValue(body.status, SUBMISSION_STATUSES, 'submission status'),
        mutationContext(body, 'admin:http')
      )
    )
  })

  app.post('/admin/releases/yank', async (context) => {
    assertAdmin(context, options.admin)
    const body = exactRecord((await boundedJson(context)).value, 'release yank', [
      'pluginId',
      'version',
      'channel',
      'reason'
    ])
    return context.json(
      await options.service.yankRelease(
        {
          pluginId: stringValue(body.pluginId, 'release plugin id'),
          version: stringValue(body.version, 'release version'),
          channel: channel(stringValue(body.channel, 'release channel'))
        },
        { actor: 'admin:http', reason: stringValue(body.reason, 'yank reason') }
      )
    )
  })

  app.post('/admin/publish', async (context) => {
    assertAdmin(context, options.admin)
    if (!options.admin?.onlinePublishing) {
      throw new HttpError(404, 'Online marketplace signing is disabled')
    }
    exactRecord((await boundedJson(context)).value, 'marketplace publication', [], [])
    const result = await options.service.publish({ actor: 'admin:http' })
    return context.json(result.publication, 201)
  })

  return app
}
