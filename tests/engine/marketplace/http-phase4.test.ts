import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_ADMIN_ASSERTION_HEADER,
  MARKETPLACE_CONTROL_LIMITS,
  MARKETPLACE_LIMITS,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  digestMarketplaceArtifact,
  parseMarketplaceControlPage,
  parseMarketplaceControlSubmission,
  parseMarketplaceControlSubmissionSummary,
  signMarketplaceOperatorAssertion,
  signMarketplaceRequest,
  MarketplacePublisherMutationAuthorityError,
  type MarketplaceRepository,
  type MarketplaceTransaction,
  type MarketplaceService
} from '@open-pencil/marketplace'
import {
  serializeVersionedPluginManifest,
  signPluginManifest,
  type PluginManifestPayloadV1
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from '../plugins/helpers'

const NOW = '2026-08-05T12:00:00.000Z'
const BEFORE = '2026-08-05T11:59:00.000Z'
const LOOPBACK_ORIGIN = 'http://localhost'
const MARKETPLACE_ID = 'openpencil-marketplace'
const OPERATOR_TOKEN = 'phase4-operator-credential'
const EXPIRED_TOKEN = 'phase4-expired-credential'
const LEGACY_TOKEN = 'l'.repeat(32)
const V2_OPERATOR_ACTOR = `portal:${'A'.repeat(43)}`
const V2_STEP_UP_GRANT_DIGEST = 'A'.repeat(43)
const encoder = new TextEncoder()

interface TestPublisher {
  id: string
  keyId: string
  keyPair: CryptoKeyPair
  pluginId: string
}

interface Phase4AdminPrincipal {
  actor: string
  expiresAt: number
}

interface MarketplaceHttpTestRecord {
  [key: string]: unknown
}

interface MarketplaceHttpTestPage {
  schemaVersion: 1
  items: MarketplaceHttpTestRecord[]
  nextCursor: string | null
}

interface Phase4AdminOptions {
  enabled: boolean
  token?: string
  authenticate?: (request: Request) => Promise<Phase4AdminPrincipal | null>
}

interface Phase4Fixture {
  app: ReturnType<typeof createMarketplaceHttpApp>
  artifacts: ReturnType<typeof createMemoryMarketplaceArtifactStore>
  afterNextPublisherMutationOperation(operation: () => unknown): void
  beforeNextTransaction(operation: (transaction: MarketplaceTransaction) => unknown): void
  createApp(admin?: Phase4AdminOptions): ReturnType<typeof createMarketplaceHttpApp>
  mutateRepository(operation: (transaction: MarketplaceTransaction) => unknown): Promise<unknown>
  nextNonce(): string
  publishers: Record<'alpha' | 'beta', TestPublisher>
  service: MarketplaceService
  submissions: {
    alphaDraftV2: Awaited<ReturnType<MarketplaceService['submit']>>
    alphaDraftV3: Awaited<ReturnType<MarketplaceService['submit']>>
    alphaRelease: Awaited<ReturnType<MarketplaceService['submit']>>
    betaDraft: Awaited<ReturnType<MarketplaceService['submit']>>
  }
}

function payloadFor(
  publisher: TestPublisher,
  version: string,
  moduleName = `${publisher.id} module`
): PluginManifestPayloadV1 {
  const payload = pluginPayload(version, moduleName)
  return {
    ...payload,
    plugin: {
      ...payload.plugin,
      id: publisher.pluginId,
      name: `${publisher.id} plugin`,
      version
    },
    publisher: {
      id: publisher.id,
      name: publisher.id,
      keyId: publisher.keyId
    }
  }
}

function listing(publisherId: string, version: string, description = 'Phase 4 test listing') {
  return {
    displayName: `${publisherId} ${version}`,
    summary: `${publisherId} marketplace submission ${version}`,
    description,
    categories: [`${publisherId}-utility`],
    iconUrl: null,
    homepageUrl: null
  }
}

async function registerPublisher(
  service: MarketplaceService,
  id: string,
  pluginId: string,
  notAfter = '2027-01-01T00:00:00.000Z'
): Promise<TestPublisher> {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publisher = { id, keyId: `${id}.release`, keyPair, pluginId }
  await service.registerPublisher(
    {
      publisher: { id, displayName: `${id} plugins` },
      key: {
        keyId: publisher.keyId,
        publisherId: id,
        publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter
      }
    },
    { actor: `publisher:${id}`, time: BEFORE }
  )
  await service.transitionPublisherKey(publisher.keyId, 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  await service.transitionPublisher(id, 'active', { actor: 'admin:fixture', time: BEFORE })
  await service.requestOwnership(pluginId, id, { actor: `publisher:${id}`, time: BEFORE })
  await service.transitionOwnership(pluginId, 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  return publisher
}

async function submitVersion(
  service: MarketplaceService,
  publisher: TestPublisher,
  id: string,
  version: string,
  moduleName?: string
) {
  const manifest = await signPluginManifest(
    payloadFor(publisher, version, moduleName),
    publisher.keyPair.privateKey
  )
  const submission = await service.submit(
    {
      id,
      publisherId: publisher.id,
      channel: 'stable',
      manifest,
      listing: listing(publisher.id, version)
    },
    { actor: `publisher:${publisher.id}`, time: NOW }
  )
  return { manifest, submission }
}

function principalAdminOptions(): Phase4AdminOptions {
  return {
    enabled: true,
    async authenticate(request) {
      const credential = request.headers.get('authorization')
      if (credential === `Bearer ${OPERATOR_TOKEN}`) {
        return {
          actor: 'admin:operator-alice',
          expiresAt: Date.parse(NOW) + 60_000
        }
      }
      if (credential === `Bearer ${EXPIRED_TOKEN}`) {
        return {
          actor: 'admin:expired-operator',
          expiresAt: Date.parse(NOW) - 1
        }
      }
      return null
    }
  }
}

async function phase4Fixture(
  clocks: { serviceNow?: string; httpNow?: string; publisherKeyNotAfter?: string } = {}
): Promise<Phase4Fixture> {
  const backingRepository = createMemoryMarketplaceRepository()
  let afterNextPublisherMutationOperation: (() => unknown) | null = null
  let beforeNextTransaction: ((transaction: MarketplaceTransaction) => unknown) | null = null
  const repository: MarketplaceRepository = {
    nonces: backingRepository.nonces,
    snapshot: () => backingRepository.snapshot(),
    async immutableSnapshot() {
      return backingRepository.immutableSnapshot
        ? backingRepository.immutableSnapshot()
        : backingRepository.snapshot()
    },
    async transaction(operation) {
      const before = beforeNextTransaction
      beforeNextTransaction = null
      if (before) {
        await backingRepository.transaction(async (transaction) => {
          await before(transaction)
        })
      }
      return backingRepository.transaction(operation)
    },
    inspectPublisherMutation: (request, currentTime) =>
      backingRepository.inspectPublisherMutation(request, currentTime),
    async executePublisherMutation(request, currentTime, operation) {
      const before = beforeNextTransaction
      beforeNextTransaction = null
      if (before) {
        await backingRepository.transaction(async (transaction) => {
          await before(transaction)
        })
      }
      const after = afterNextPublisherMutationOperation
      afterNextPublisherMutationOperation = null
      return backingRepository.executePublisherMutation(
        request,
        currentTime,
        async (transaction) => {
          const result = await operation(transaction)
          if (after) await after()
          return result
        }
      )
    }
  }
  const artifacts = createMemoryMarketplaceArtifactStore()
  const service = createMarketplaceService({
    repository,
    artifacts,
    marketplaceId: MARKETPLACE_ID,
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(clocks.serviceNow ?? NOW)
  })
  const alpha = await registerPublisher(
    service,
    'alpha',
    'alpha.analytics',
    clocks.publisherKeyNotAfter
  )
  const beta = await registerPublisher(service, 'beta', 'beta.toolbox', clocks.publisherKeyNotAfter)

  const alphaReleaseResult = await submitVersion(service, alpha, 'alpha-release-v1', '1.0.0')
  await service.transitionSubmission(alphaReleaseResult.submission.id, 'approved', {
    actor: 'admin:fixture',
    time: NOW
  })
  await service.publishSubmission(alphaReleaseResult.submission.id, {
    actor: 'admin:fixture',
    time: NOW
  })
  const alphaDraftV2 = (await submitVersion(service, alpha, 'alpha-draft-v2', '2.0.0')).submission
  const alphaDraftV3 = (await submitVersion(service, alpha, 'alpha-draft-v3', '3.0.0')).submission
  const betaDraft = (await submitVersion(service, beta, 'beta-draft-v1', '1.0.0')).submission

  let nonce = 0
  const nextNonce = () => `phase4nonce${String(++nonce).padStart(6, '0')}`
  const createApp = (admin?: Phase4AdminOptions) =>
    createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(clocks.httpNow ?? NOW),
      ...(admin
        ? {
            // Fail-first compatibility: Phase 4 adds the trusted authenticator shape.
            admin: admin as never
          }
        : {})
    })
  const app = createApp(principalAdminOptions())
  return {
    app,
    artifacts,
    afterNextPublisherMutationOperation(operation) {
      if (afterNextPublisherMutationOperation) {
        throw new Error('A Publisher mutation operation hook is already armed')
      }
      afterNextPublisherMutationOperation = operation
    },
    beforeNextTransaction(operation) {
      if (beforeNextTransaction) throw new Error('A transaction race hook is already armed')
      beforeNextTransaction = operation
    },
    createApp,
    mutateRepository: (operation) => backingRepository.transaction(operation),
    nextNonce,
    publishers: { alpha, beta },
    service,
    submissions: {
      alphaDraftV2,
      alphaDraftV3,
      alphaRelease: alphaReleaseResult.submission,
      betaDraft
    }
  }
}

function signedHeaderRecord(
  headers: Awaited<ReturnType<typeof signMarketplaceRequest>>,
  hasBody: boolean
): Record<string, string> {
  return {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    'x-openpencil-marketplace-audience': headers.audience,
    'x-openpencil-publisher-id': headers.publisherId,
    'x-openpencil-key-id': headers.keyId,
    'x-openpencil-timestamp': headers.timestamp,
    'x-openpencil-nonce': headers.nonce,
    'x-openpencil-signature': headers.signature
  }
}

async function signedInit(
  fixture: Phase4Fixture,
  publisherId: 'alpha' | 'beta',
  url: string,
  options: { method?: 'GET' | 'POST'; value?: unknown; timestamp?: string; nonce?: string } = {}
): Promise<RequestInit> {
  const publisher = fixture.publishers[publisherId]
  const method = options.method ?? 'GET'
  const body = options.value === undefined ? undefined : JSON.stringify(options.value)
  const signature = await signMarketplaceRequest(
    {
      audience: MARKETPLACE_ID,
      publisherId,
      keyId: publisher.keyId,
      method,
      url,
      timestamp: options.timestamp ?? NOW,
      nonce: options.nonce ?? fixture.nextNonce(),
      body: encoder.encode(body ?? '')
    },
    publisher.keyPair.privateKey
  )
  return {
    method,
    headers: signedHeaderRecord(signature, body !== undefined),
    ...(body === undefined ? {} : { body })
  }
}

async function signedRequest(
  fixture: Phase4Fixture,
  publisherId: 'alpha' | 'beta',
  path: string,
  options: { method?: 'GET' | 'POST'; value?: unknown; timestamp?: string } = {}
): Promise<Response> {
  const url = `${LOOPBACK_ORIGIN}${path}`
  return fixture.app.request(url, await signedInit(fixture, publisherId, url, options))
}

function adminHeaders(token = OPERATOR_TOKEN, additions: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...additions }
}

async function adminRequest(
  app: ReturnType<typeof createMarketplaceHttpApp>,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    token?: string
    value?: unknown
    headers?: Record<string, string>
    origin?: string
  } = {}
): Promise<Response> {
  const body = options.value === undefined ? undefined : JSON.stringify(options.value)
  return app.request(`${options.origin ?? LOOPBACK_ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...adminHeaders(options.token, options.headers),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(body === undefined ? {} : { body })
  })
}

async function jsonRecord(response: Response): Promise<MarketplaceHttpTestRecord> {
  const value = await response.json()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected an object response')
  }
  return value as MarketplaceHttpTestRecord
}

async function page(response: Response) {
  const value = await jsonRecord(response)
  expect(value.schemaVersion).toBe(1)
  if (!Array.isArray(value.items)) throw new TypeError('Expected page items')
  const items = value.items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('Expected page item object')
    }
    return item as MarketplaceHttpTestRecord
  })
  if (value.nextCursor !== null && typeof value.nextCursor !== 'string') {
    throw new TypeError('Expected nullable page cursor')
  }
  return {
    schemaVersion: 1,
    items,
    nextCursor: value.nextCursor
  } satisfies MarketplaceHttpTestPage
}

function tamperCursor(value: string): string {
  const index = Math.max(0, value.length - 1)
  const replacement = value[index] === 'A' ? 'B' : 'A'
  return `${value.slice(0, index)}${replacement}`
}

describe('marketplace Phase 4 publisher HTTP contract', () => {
  test('serves only the authenticated publisher scope without PEM or draft artifact URL leakage', async () => {
    const fixture = await phase4Fixture()

    const meResponse = await signedRequest(fixture, 'alpha', '/v1/publishers/me')
    expect(meResponse.status).toBe(200)
    expect(meResponse.headers.get('cache-control')).toBe('no-store')
    const me = await jsonRecord(meResponse)
    expect(me).toMatchObject({ schemaVersion: 1, id: 'alpha' })

    const keysResponse = await signedRequest(fixture, 'alpha', '/v1/publishers/me/keys')
    expect(keysResponse.status).toBe(200)
    expect(keysResponse.headers.get('cache-control')).toBe('no-store')
    const keys = await page(keysResponse)
    expect(keys.items).toHaveLength(1)
    expect(keys.items[0]).toMatchObject({ publisherId: 'alpha', keyId: 'alpha.release' })
    const serializedKeys = JSON.stringify(keys)
    expect(serializedKeys).not.toContain('publicKeyPem')
    expect(serializedKeys).not.toContain('BEGIN PUBLIC KEY')
    expect(serializedKeys).toContain('fingerprint')

    const ownerships = await page(
      await signedRequest(fixture, 'alpha', '/v1/publishers/me/ownerships')
    )
    expect(ownerships.items).toHaveLength(1)
    expect(ownerships.items[0]).toMatchObject({ publisherId: 'alpha', pluginId: 'alpha.analytics' })

    const submissionsResponse = await signedRequest(
      fixture,
      'alpha',
      '/v1/publishers/me/submissions'
    )
    expect(submissionsResponse.headers.get('cache-control')).toBe('no-store')
    const submissions = await page(submissionsResponse)
    expect(
      parseMarketplaceControlPage(submissions, parseMarketplaceControlSubmissionSummary).items
    ).toHaveLength(3)
    expect(submissions.items).toHaveLength(3)
    expect(new Set(submissions.items.map(({ publisherId }) => publisherId))).toEqual(
      new Set(['alpha'])
    )
    const serializedSubmissions = JSON.stringify(submissions)
    expect(serializedSubmissions).not.toContain('beta-draft-v1')
    expect(serializedSubmissions).not.toContain('manifestUrl')
    expect(serializedSubmissions).not.toContain('packageUrl')
    expect(serializedSubmissions).not.toContain('artifactDigest')

    const detailResponse = await signedRequest(
      fixture,
      'alpha',
      '/v1/publishers/me/submissions/alpha-draft-v2'
    )
    expect(detailResponse.status).toBe(200)
    expect(detailResponse.headers.get('cache-control')).toBe('no-store')
    const detail = await jsonRecord(detailResponse)
    expect(parseMarketplaceControlSubmission(detail).id).toBe('alpha-draft-v2')
    expect(detail).toMatchObject({
      schemaVersion: 1,
      id: 'alpha-draft-v2',
      publisherId: 'alpha',
      revision: 1
    })
    expect(detail.revisions).toHaveLength(1)

    const crossPublisherDetail = await signedRequest(
      fixture,
      'beta',
      '/v1/publishers/me/submissions/alpha-draft-v2'
    )
    expect(crossPublisherDetail.status).toBe(404)
    expect(crossPublisherDetail.headers.get('cache-control')).toBe('no-store')

    const crossPublisherWithdraw = await signedRequest(
      fixture,
      'alpha',
      '/v1/submissions/beta-draft-v1/withdraw',
      {
        method: 'POST',
        value: { reason: 'Attempt to cross the publisher boundary' }
      }
    )
    expect(crossPublisherWithdraw.status).toBe(404)
    expect(crossPublisherWithdraw.headers.get('cache-control')).toBe('no-store')

    const releases = await page(await signedRequest(fixture, 'alpha', '/v1/publishers/me/releases'))
    expect(releases.items).toHaveLength(1)
    expect(releases.items[0]).toMatchObject({ publisherId: 'alpha' })

    const draftArtifact = await fixture.app.request(
      `${LOOPBACK_ORIGIN}/v1/artifacts/${fixture.submissions.alphaDraftV2.artifactDigest}`
    )
    expect(draftArtifact.status).toBe(404)
    expect(draftArtifact.headers.get('cache-control')).toBe('no-store')
    const publishedArtifact = await fixture.app.request(
      `${LOOPBACK_ORIGIN}/v1/artifacts/${fixture.submissions.alphaRelease.artifactDigest}`
    )
    expect(publishedArtifact.status).toBe(200)
    expect(publishedArtifact.headers.get('cache-control')).toContain('immutable')

    const preflight = await fixture.app.request(`${LOOPBACK_ORIGIN}/v1/publishers/me`, {
      method: 'OPTIONS',
      headers: { origin: 'https://untrusted.example' }
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('binds signed GET to exact path and query and consumes each nonce once', async () => {
    const fixture = await phase4Fixture()

    const replayURL = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const replayInit = await signedInit(fixture, 'alpha', replayURL)
    const accepted = await fixture.app.request(replayURL, replayInit)
    expect(accepted.status).toBe(200)
    expect((await fixture.app.request(replayURL, replayInit)).status).toBe(401)

    const pathInit = await signedInit(fixture, 'alpha', replayURL)
    const pathTamper = await fixture.app.request(
      `${LOOPBACK_ORIGIN}/v1/publishers/me/keys`,
      pathInit
    )
    expect(pathTamper.status).toBe(401)

    const queryURL = `${LOOPBACK_ORIGIN}/v1/publishers/me/submissions?limit=1`
    const queryInit = await signedInit(fixture, 'alpha', queryURL)
    const queryTamper = await fixture.app.request(
      `${LOOPBACK_ORIGIN}/v1/publishers/me/submissions?limit=2`,
      queryInit
    )
    expect(queryTamper.status).toBe(401)

    const expired = await fixture.app.request(
      replayURL,
      await signedInit(fixture, 'alpha', replayURL, {
        timestamp: '2026-08-05T11:00:00.000Z'
      })
    )
    expect(expired.status).toBe(401)
  })

  test('atomically replays one exact Publisher mutation result and rejects nonce collisions', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const nonce = 'phase4atomicnonce01'
    const value = { pluginId: 'alpha.atomic-plugin', publisherId: 'alpha' }
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value,
      nonce
    })

    const first = await fixture.app.request(url, init)
    const firstBody = await first.text()
    expect(first.status).toBe(201)
    const committed = await fixture.service.snapshot()

    const replay = await fixture.app.request(url, init)
    expect({ status: replay.status, body: await replay.text() }).toEqual({
      status: 201,
      body: firstBody
    })
    expect(await fixture.service.snapshot()).toEqual(committed)

    const collision = await fixture.app.request(
      url,
      await signedInit(fixture, 'alpha', url, {
        method: 'POST',
        value: { ...value, pluginId: 'alpha.different-plugin' },
        nonce
      })
    )
    expect(collision.status).toBe(409)
    expect(await collision.text()).not.toBe(firstBody)
    expect(await fixture.service.snapshot()).toEqual(committed)
  })

  test('binds Publisher mutation commit and replay to the captured HTTP verification time', async () => {
    const fixture = await phase4Fixture({
      httpNow: NOW,
      serviceNow: '2026-08-05T12:10:00.000Z'
    })
    const url = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: { pluginId: 'alpha.clock-bound', publisherId: 'alpha' },
      nonce: 'phase4clockbound01'
    })

    const first = await fixture.app.request(url, init)
    const firstBody = await first.text()
    expect(first.status).toBe(201)
    const committed = await fixture.service.snapshot()
    expect(
      committed.ownerships.find(({ pluginId }) => pluginId === 'alpha.clock-bound')?.requestedAt
    ).toBe(NOW)

    const replay = await fixture.app.request(url, init)
    expect({ status: replay.status, body: await replay.text() }).toEqual({
      status: 201,
      body: firstBody
    })
    expect(await fixture.service.snapshot()).toEqual(committed)
  })

  test('does not let a signed read resample time and evict a live Publisher mutation receipt', async () => {
    const fixture = await phase4Fixture()
    const mutationURL = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const mutationInit = await signedInit(fixture, 'alpha', mutationURL, {
      method: 'POST',
      value: { pluginId: 'alpha.read-clock-bound', publisherId: 'alpha' },
      nonce: 'phase4readclock001'
    })
    const committed = await fixture.app.request(mutationURL, mutationInit)
    const committedResult = { status: committed.status, body: await committed.text() }
    expect(committedResult.status).toBe(201)

    let clockCalls = 0
    const readApp = createMarketplaceHttpApp({
      service: fixture.service,
      now: () => {
        clockCalls++
        return clockCalls === 1 ? Date.parse(NOW) : Date.parse(NOW) + 10 * 60_000
      }
    })
    const readURL = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const read = await readApp.request(readURL, await signedInit(fixture, 'alpha', readURL))
    expect(read.status).toBe(200)
    expect(clockCalls).toBe(1)

    const replay = await fixture.app.request(mutationURL, mutationInit)
    expect({ status: replay.status, body: await replay.text() }).toEqual(committedResult)
  })

  test('resolves an active Publisher key at the same trusted time used for its signed read', async () => {
    const keyNotAfter = new Date(Date.parse(NOW) + 1).toISOString()
    const clocks = {
      serviceNow: NOW,
      httpNow: NOW,
      publisherKeyNotAfter: keyNotAfter
    }
    const fixture = await phase4Fixture(clocks)
    clocks.serviceNow = keyNotAfter

    const url = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const response = await fixture.app.request(
      url,
      await signedInit(fixture, 'alpha', url, { nonce: 'phase4keyclock0001' })
    )

    expect(response.status).toBe(200)
  })

  test('keeps Publisher authority storage failures generic and non-consuming', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: { pluginId: 'alpha.authority-recovery', publisherId: 'alpha' },
      nonce: 'phase4authorityfail1'
    })
    const before = await fixture.service.snapshot()
    const unavailableService = new Proxy(fixture.service, {
      get(target, property, receiver) {
        if (property === 'resolvePublisherKey') {
          return async () => {
            throw new Error('SQLITE_IOERR /srv/private/marketplace.db')
          }
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const unavailableApp = createMarketplaceHttpApp({
      service: unavailableService,
      now: () => Date.parse(NOW)
    })

    const failed = await unavailableApp.request(url, init)
    const failedBody = await failed.text()
    expect(failed.status).toBe(503)
    expect(failedBody).toBe('{"error":"Marketplace publisher authority is unavailable"}')
    expect(failedBody).not.toContain('SQLITE_IOERR')
    expect(failedBody).not.toContain('/srv/private')
    expect(await fixture.service.snapshot()).toEqual(before)

    const committed = await fixture.app.request(url, init)
    const committedBody = await committed.text()
    expect(committed.status).toBe(201)
    const replay = await fixture.app.request(url, init)
    expect({ status: replay.status, body: await replay.text() }).toEqual({
      status: 201,
      body: committedBody
    })
  })

  test('keeps signed read authority storage failures generic and non-consuming', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const init = await signedInit(fixture, 'alpha', url, {
      nonce: 'phase4readauthfail1'
    })
    const unavailableService = new Proxy(fixture.service, {
      get(target, property, receiver) {
        if (property === 'resolveActivePublisherKey') {
          return async () => {
            throw new Error('SQLITE_IOERR /srv/private/marketplace.db')
          }
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const unavailableApp = createMarketplaceHttpApp({
      service: unavailableService,
      now: () => Date.parse(NOW)
    })

    const failed = await unavailableApp.request(url, init)
    const failedBody = await failed.text()
    expect(failed.status).toBe(503)
    expect(failedBody).toBe('{"error":"Marketplace publisher authority is unavailable"}')
    expect(failedBody).not.toContain('SQLITE_IOERR')
    expect(failedBody).not.toContain('/srv/private')

    expect((await fixture.app.request(url, init)).status).toBe(200)
    expect((await fixture.app.request(url, init)).status).toBe(401)
  })

  test('maps signed read nonce-store failures to a generic retryable outage', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const init = await signedInit(fixture, 'alpha', url, {
      nonce: 'phase4readnoncefail1'
    })
    const unavailableService = new Proxy(fixture.service, {
      get(target, property, receiver) {
        if (property === 'nonces') {
          return {
            async consume() {
              throw new Error('SQLITE_IOERR /srv/private/marketplace.db')
            }
          }
        }
        return Reflect.get(target, property, receiver)
      }
    })
    const unavailableApp = createMarketplaceHttpApp({
      service: unavailableService,
      now: () => Date.parse(NOW)
    })

    const failed = await unavailableApp.request(url, init)
    const failedBody = await failed.text()
    expect(failed.status).toBe(503)
    expect(failedBody).toBe('{"error":"Marketplace request nonce authority is unavailable"}')
    expect(failedBody).not.toContain('SQLITE_IOERR')
    expect(failedBody).not.toContain('/srv/private')

    expect((await fixture.app.request(url, init)).status).toBe(200)
    expect((await fixture.app.request(url, init)).status).toBe(401)
  })

  test('treats malformed self-registration key material as bad credentials, not storage outage', async () => {
    const fixture = await phase4Fixture()
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const url = `${LOOPBACK_ORIGIN}/v1/publishers/register`
    const body = JSON.stringify({
      publisher: { id: 'malformed-pem-publisher', displayName: 'Malformed PEM Publisher' },
      key: {
        keyId: 'malformed-pem-publisher-2026',
        publisherId: 'malformed-pem-publisher',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n',
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    })
    const signature = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'malformed-pem-publisher',
        keyId: 'malformed-pem-publisher-2026',
        method: 'POST',
        url,
        timestamp: NOW,
        nonce: 'phase4malformedpem1',
        body: encoder.encode(body)
      },
      pair.privateKey
    )

    const response = await fixture.app.request(url, {
      method: 'POST',
      headers: signedHeaderRecord(signature, true),
      body
    })
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('{"error":"Marketplace request authentication failed"}')
  })

  test('does not publish immutable submission artifacts when the mutation callback fails', async () => {
    const fixture = await phase4Fixture()
    const manifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '9.0.0', 'Deferred artifact submission'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const artifactDigest = digestMarketplaceArtifact(
      encoder.encode(serializeVersionedPluginManifest(manifest))
    )
    const url = `${LOOPBACK_ORIGIN}/v1/submissions`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      nonce: 'phase4artifactdefer1',
      value: {
        id: 'alpha-artifact-defer-v9',
        publisherId: 'alpha',
        channel: 'stable',
        manifest,
        listing: listing('alpha', '9.0.0')
      }
    })
    const before = await fixture.service.snapshot()
    fixture.afterNextPublisherMutationOperation(() => {
      throw new Error('injected wrapper failure after callback')
    })

    const failed = await fixture.app.request(url, init)
    expect(failed.status).toBe(500)
    expect(await fixture.service.snapshot()).toEqual(before)
    expect(await fixture.service.artifact(artifactDigest)).toBeNull()

    const committed = await fixture.app.request(url, init)
    expect(committed.status).toBe(201)
    expect(await fixture.service.artifact(artifactDigest)).not.toBeNull()
  })

  test('allows only an exact committed replay after its Publisher key is revoked', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const value = { pluginId: 'alpha.revocation-replay', publisherId: 'alpha' }
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value,
      nonce: 'phase4revokednonce1'
    })
    const committed = await fixture.app.request(url, init)
    const committedBody = await committed.text()
    expect(committed.status).toBe(201)

    await fixture.mutateRepository((transaction) =>
      transaction.transitionPublisherKey('alpha.release', 'revoked', {
        actor: 'admin:security',
        reason: 'Compromised Publisher signing key',
        time: NOW
      })
    )
    const afterRevocation = await fixture.service.snapshot()

    const replay = await fixture.app.request(url, init)
    expect({ status: replay.status, body: await replay.text() }).toEqual({
      status: 201,
      body: committedBody
    })
    expect(await fixture.service.snapshot()).toEqual(afterRevocation)

    const fresh = await signedRequest(fixture, 'alpha', '/v1/ownerships', {
      method: 'POST',
      value: { pluginId: 'alpha.revoked-fresh', publisherId: 'alpha' }
    })
    expect(fresh.status).toBe(401)
    expect(await fixture.service.snapshot()).toEqual(afterRevocation)
  })

  test('uses server time for Publisher mutations instead of the signed freshness timestamp', async () => {
    const fixture = await phase4Fixture()
    const before = await fixture.service.snapshot()
    const registrationURL = `${LOOPBACK_ORIGIN}/v1/publishers/register`
    const register = async (publisherId: string, timestamp: string) => {
      const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
      const keyId = `${publisherId}.release`
      const body = JSON.stringify({
        publisher: { id: publisherId, displayName: `${publisherId} plugins` },
        key: {
          keyId,
          publisherId,
          publicKeyPem: await exportEd25519PublicKeyPem(keyPair.publicKey),
          notBefore: '2026-01-01T00:00:00.000Z',
          notAfter: '2027-01-01T00:00:00.000Z'
        }
      })
      const signature = await signMarketplaceRequest(
        {
          audience: MARKETPLACE_ID,
          publisherId,
          keyId,
          method: 'POST',
          url: registrationURL,
          timestamp,
          nonce: fixture.nextNonce(),
          body: encoder.encode(body)
        },
        keyPair.privateKey
      )
      return fixture.app.request(registrationURL, {
        method: 'POST',
        headers: signedHeaderRecord(signature, true),
        body
      })
    }

    expect((await register('outside-window', '2026-08-05T12:05:01.000Z')).status).toBe(401)
    expect(await fixture.service.snapshot()).toEqual(before)
    expect((await register('future-window', '2026-08-05T12:04:59.000Z')).status).toBe(201)
    expect((await register('current-window', NOW)).status).toBe(201)

    const futureTimestamp = '2026-08-05T12:04:59.000Z'
    expect(
      (
        await signedRequest(fixture, 'alpha', '/v1/ownerships', {
          method: 'POST',
          timestamp: futureTimestamp,
          value: { pluginId: 'alpha.future-owned', publisherId: 'alpha' }
        })
      ).status
    ).toBe(201)

    const nextKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    expect(
      (
        await signedRequest(fixture, 'alpha', '/v1/publisher-keys', {
          method: 'POST',
          timestamp: futureTimestamp,
          value: {
            keyId: 'alpha.future-key',
            publisherId: 'alpha',
            publicKeyPem: await exportEd25519PublicKeyPem(nextKeyPair.publicKey),
            notBefore: NOW,
            notAfter: '2027-08-05T12:00:00.000Z',
            predecessorKeyId: 'alpha.release'
          }
        })
      ).status
    ).toBe(201)

    const manifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '8.0.0', 'Server time submission'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    expect(
      (
        await signedRequest(fixture, 'alpha', '/v1/submissions', {
          method: 'POST',
          timestamp: futureTimestamp,
          value: {
            id: 'alpha-future-v8',
            publisherId: 'alpha',
            channel: 'stable',
            manifest,
            listing: listing('alpha', '8.0.0')
          }
        })
      ).status
    ).toBe(201)
    await fixture.service.transitionSubmission('alpha-future-v8', 'changes_requested', {
      actor: 'admin:fixture',
      reason: 'Exercise server-owned revision time',
      time: NOW
    })
    const revisedManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '8.0.0', 'Server time revised submission'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    expect(
      (
        await signedRequest(fixture, 'alpha', '/v1/submissions/alpha-future-v8/revise', {
          method: 'POST',
          timestamp: futureTimestamp,
          value: {
            publisherId: 'alpha',
            expectedRevision: 1,
            manifest: revisedManifest,
            listing: listing('alpha', '8.0.0', 'Server time revised listing')
          }
        })
      ).status
    ).toBe(200)
    expect(
      (
        await signedRequest(fixture, 'alpha', '/v1/submissions/alpha-future-v8/withdraw', {
          method: 'POST',
          timestamp: futureTimestamp,
          value: { reason: 'Server-owned withdrawal time' }
        })
      ).status
    ).toBe(200)

    const state = await fixture.service.snapshot()
    expect(state.publishers.find(({ id }) => id === 'future-window')?.createdAt).toBe(NOW)
    expect(state.publishers.find(({ id }) => id === 'current-window')?.createdAt).toBe(NOW)
    expect(
      state.ownerships.find(({ pluginId }) => pluginId === 'alpha.future-owned')?.requestedAt
    ).toBe(NOW)
    expect(state.publisherKeys.find(({ keyId }) => keyId === 'alpha.future-key')?.createdAt).toBe(
      NOW
    )
    expect(state.submissions.find(({ id }) => id === 'alpha-future-v8')).toMatchObject({
      revision: 2,
      revisionCreatedAt: NOW,
      submittedAt: NOW,
      updatedAt: NOW,
      status: 'withdrawn',
      revisionHistory: [{ supersededAt: NOW }]
    })
    expect(
      state.auditEvents.slice(before.auditEvents.length).every(({ time }) => time === NOW)
    ).toBe(true)
  })

  test('rejects a formerly valid publisher key immediately after revocation', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/publishers/me`
    const signedBeforeRevocation = await signedInit(fixture, 'alpha', url)
    await fixture.service.transitionPublisherKey('alpha.release', 'revoked', {
      actor: 'admin:security',
      reason: 'Publisher key rotation completed',
      time: NOW
    })
    const response = await fixture.app.request(url, signedBeforeRevocation)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('rejects key rotation when its authenticated predecessor is revoked before the mutation transaction', async () => {
    const fixture = await phase4Fixture()
    const nextKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    const url = `${LOOPBACK_ORIGIN}/v1/publisher-keys`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: {
        keyId: 'alpha.raced-release',
        publisherId: 'alpha',
        publicKeyPem: await exportEd25519PublicKeyPem(nextKeyPair.publicKey),
        notBefore: NOW,
        notAfter: '2027-08-05T12:00:00.000Z',
        predecessorKeyId: 'alpha.release'
      }
    })
    fixture.beforeNextTransaction((transaction) =>
      transaction.transitionPublisherKey('alpha.release', 'revoked', {
        actor: 'admin:security',
        reason: 'Concurrent key revocation',
        time: NOW
      })
    )

    const response = await fixture.app.request(url, init)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const state = await fixture.service.snapshot()
    expect(state.publisherKeys.find(({ keyId }) => keyId === 'alpha.release')?.status).toBe(
      'revoked'
    )
    expect(state.publisherKeys.some(({ keyId }) => keyId === 'alpha.raced-release')).toBe(false)
  })

  test('rejects ownership request when its authenticated Publisher is suspended before the mutation transaction', async () => {
    const fixture = await phase4Fixture()
    const url = `${LOOPBACK_ORIGIN}/v1/ownerships`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: { pluginId: 'alpha.raced-ownership', publisherId: 'alpha' }
    })
    fixture.beforeNextTransaction((transaction) =>
      transaction.transitionPublisher('alpha', 'suspended', {
        actor: 'admin:security',
        reason: 'Concurrent Publisher suspension',
        time: NOW
      })
    )

    const response = await fixture.app.request(url, init)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const state = await fixture.service.snapshot()
    expect(state.publishers.find(({ id }) => id === 'alpha')?.status).toBe('suspended')
    expect(state.ownerships.some(({ pluginId }) => pluginId === 'alpha.raced-ownership')).toBe(
      false
    )
  })

  test('rejects withdrawal when its authenticated key is revoked before the mutation transaction', async () => {
    const fixture = await phase4Fixture()
    const submissionId = fixture.submissions.alphaDraftV2.id
    const url = `${LOOPBACK_ORIGIN}/v1/submissions/${submissionId}/withdraw`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: { reason: 'Withdrawal racing a key revocation' }
    })
    fixture.beforeNextTransaction((transaction) =>
      transaction.transitionPublisherKey('alpha.release', 'revoked', {
        actor: 'admin:security',
        reason: 'Concurrent key revocation',
        time: NOW
      })
    )

    const response = await fixture.app.request(url, init)
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const state = await fixture.service.snapshot()
    expect(state.publisherKeys.find(({ keyId }) => keyId === 'alpha.release')?.status).toBe(
      'revoked'
    )
    expect(state.submissions.find(({ id }) => id === submissionId)?.status).toBe('awaiting_review')
  })

  test('binds Publisher mutation service authority to the exact Publisher and key', async () => {
    const fixture = await phase4Fixture()
    const crossPublisherAuthority = {
      publisherId: fixture.publishers.beta.id,
      keyId: fixture.publishers.beta.keyId
    }
    const alternateKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    await fixture.service.registerPublisherKey(
      {
        keyId: 'alpha.alternate-release',
        publisherId: 'alpha',
        publicKeyPem: await exportEd25519PublicKeyPem(alternateKeyPair.publicKey),
        notBefore: NOW,
        notAfter: '2027-08-05T12:00:00.000Z',
        predecessorKeyId: 'alpha.release'
      },
      { actor: 'admin:fixture', time: NOW }
    )
    await fixture.service.transitionPublisherKey('alpha.alternate-release', 'active', {
      actor: 'admin:fixture',
      time: NOW
    })
    const mismatchedKeyAuthority = {
      publisherId: fixture.publishers.alpha.id,
      keyId: 'alpha.alternate-release'
    }
    const nextKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])

    await expect(
      fixture.service.registerPublisherKey(
        {
          keyId: 'alpha.mismatched-authority',
          publisherId: 'alpha',
          publicKeyPem: await exportEd25519PublicKeyPem(nextKeyPair.publicKey),
          notBefore: NOW,
          notAfter: '2027-08-05T12:00:00.000Z',
          predecessorKeyId: 'alpha.release'
        },
        { actor: 'publisher:alpha', time: NOW },
        mismatchedKeyAuthority
      )
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationAuthorityError)
    const mutableAuthority = { ...crossPublisherAuthority }
    const ownershipRequest = fixture.service.requestOwnership(
      'alpha.mismatched-authority',
      'alpha',
      { actor: 'publisher:alpha', time: NOW },
      mutableAuthority
    )
    mutableAuthority.publisherId = fixture.publishers.alpha.id
    mutableAuthority.keyId = fixture.publishers.alpha.keyId
    await expect(ownershipRequest).rejects.toBeInstanceOf(
      MarketplacePublisherMutationAuthorityError
    )
    await expect(
      fixture.service.withdrawSubmission(
        fixture.submissions.alphaDraftV3.id,
        'alpha',
        'Authority must not cross Publishers',
        { actor: 'publisher:alpha', time: NOW },
        crossPublisherAuthority
      )
    ).rejects.toBeInstanceOf(MarketplacePublisherMutationAuthorityError)

    const state = await fixture.service.snapshot()
    expect(state.publisherKeys.some(({ keyId }) => keyId === 'alpha.mismatched-authority')).toBe(
      false
    )
    expect(state.ownerships.some(({ pluginId }) => pluginId === 'alpha.mismatched-authority')).toBe(
      false
    )
    expect(
      state.submissions.find(({ id }) => id === fixture.submissions.alphaDraftV3.id)?.status
    ).toBe('awaiting_review')
  })

  test('keeps publisher mutation responses private and strips raw key material', async () => {
    const fixture = await phase4Fixture()
    const nextKeyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify'
    ])
    const keyResponse = await signedRequest(fixture, 'alpha', '/v1/publisher-keys', {
      method: 'POST',
      value: {
        keyId: 'alpha.next-release',
        publisherId: 'alpha',
        publicKeyPem: await exportEd25519PublicKeyPem(nextKeyPair.publicKey),
        notBefore: '2026-08-05T12:00:00.000Z',
        notAfter: '2027-08-05T12:00:00.000Z',
        predecessorKeyId: 'alpha.release'
      }
    })
    expect(keyResponse.status).toBe(201)
    expect(keyResponse.headers.get('cache-control')).toBe('no-store')
    const serializedKey = await keyResponse.text()
    expect(serializedKey).not.toContain('publicKeyPem')
    expect(serializedKey).not.toContain('BEGIN PUBLIC KEY')
    expect(serializedKey).toContain('fingerprint')

    const ownershipResponse = await signedRequest(fixture, 'alpha', '/v1/ownerships', {
      method: 'POST',
      value: { pluginId: 'alpha.additional-plugin', publisherId: 'alpha' }
    })
    expect(ownershipResponse.status).toBe(201)
    expect(ownershipResponse.headers.get('cache-control')).toBe('no-store')
  })

  test('uses strict scope-bound cursors and rejects tampered, cross-filter, and stale pagination', async () => {
    const fixture = await phase4Fixture()
    const firstResponse = await signedRequest(
      fixture,
      'alpha',
      '/v1/publishers/me/submissions?limit=1'
    )
    expect(firstResponse.status).toBe(200)
    const first = await page(firstResponse)
    expect(first.items).toHaveLength(1)
    expect(typeof first.nextCursor).toBe('string')
    const cursor = first.nextCursor as string

    const second = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/submissions?limit=1&cursor=${encodeURIComponent(cursor)}`
    )
    expect(second.status).toBe(200)
    const secondPage = await page(second)
    expect(secondPage.items[0]?.id).not.toBe(first.items[0]?.id)

    const tampered = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/submissions?limit=1&cursor=${encodeURIComponent(tamperCursor(cursor))}`
    )
    expect(tampered.status).toBe(400)

    const crossScope = await signedRequest(
      fixture,
      'beta',
      `/v1/publishers/me/submissions?limit=1&cursor=${encodeURIComponent(cursor)}`
    )
    expect(crossScope.status).toBe(400)

    const crossRoute = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/releases?limit=1&cursor=${encodeURIComponent(cursor)}`
    )
    expect(crossRoute.status).toBe(400)

    const filteredFirst = await page(
      await signedRequest(
        fixture,
        'alpha',
        '/v1/publishers/me/submissions?limit=1&status=awaiting_review'
      )
    )
    expect(typeof filteredFirst.nextCursor).toBe('string')
    const crossFilter = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/submissions?limit=1&status=published&cursor=${encodeURIComponent(
        filteredFirst.nextCursor as string
      )}`
    )
    expect(crossFilter.status).toBe(400)

    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'limit=1&limit=2',
      'unknown=true',
      'status=not-a-status',
      `status=${encodeURIComponent('界'.repeat(1_024))}`
    ]) {
      const invalid = await signedRequest(
        fixture,
        'alpha',
        `/v1/publishers/me/submissions?${query}`
      )
      expect(invalid.status).toBe(400)
    }

    const staleFirst = await page(
      await signedRequest(fixture, 'alpha', '/v1/publishers/me/submissions?limit=1')
    )
    expect(typeof staleFirst.nextCursor).toBe('string')
    await fixture.service.requestOwnership('alpha.additional-plugin', 'alpha', {
      actor: 'publisher:alpha',
      time: NOW
    })
    const stale = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/submissions?limit=1&cursor=${encodeURIComponent(
        staleFirst.nextCursor as string
      )}`
    )
    expect(stale.status).toBe(409)
  })
})

describe('marketplace Phase 4 admin HTTP contract', () => {
  test('revalidates control-reader data at the HTTP runtime-schema boundary', async () => {
    const fixture = await phase4Fixture()
    const control = fixture.service.control
    const poisonedControl = {
      ...control,
      async publisher(publisherId: string) {
        const publisher = await control.publisher(publisherId)
        return publisher ? { ...publisher, publicKeyPem: '-----BEGIN PUBLIC KEY-----' } : null
      },
      async publishers(query: Parameters<typeof control.publishers>[0]) {
        const page = await control.publishers(query)
        return {
          ...page,
          items: page.items.map((publisher, index) =>
            index === 0 ? { ...publisher, apiKey: 'server-secret' } : publisher
          )
        }
      }
    }
    const poisonedApp = createMarketplaceHttpApp({
      service: { ...fixture.service, control: poisonedControl } as never,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW),
      admin: principalAdminOptions()
    })
    const before = await fixture.service.snapshot()

    for (const path of ['/admin/publishers/alpha', '/admin/publishers?limit=2']) {
      const response = await adminRequest(poisonedApp, path)
      expect(response.status).toBe(400)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const body = await response.text()
      expect(body).not.toContain('BEGIN PUBLIC KEY')
      expect(body).not.toContain('server-secret')
    }
    expect(await fixture.service.snapshot()).toEqual(before)
  })

  test('requires a live server-derived principal on loopback and returns bounded private DTOs', async () => {
    const fixture = await phase4Fixture()

    const missing = await fixture.app.request(`${LOOPBACK_ORIGIN}/admin/summary`)
    expect(missing.status).toBe(401)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    const wrong = await adminRequest(fixture.app, '/admin/summary', { token: 'wrong-credential' })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('cache-control')).toBe('no-store')
    const expired = await adminRequest(fixture.app, '/admin/summary', { token: EXPIRED_TOKEN })
    expect(expired.status).toBe(401)
    expect(expired.headers.get('cache-control')).toBe('no-store')
    const nonLoopback = await adminRequest(fixture.app, '/admin/summary', {
      origin: 'http://marketplace.example'
    })
    expect(nonLoopback.status).toBe(404)

    const summaryResponse = await adminRequest(fixture.app, '/admin/summary')
    expect(summaryResponse.status).toBe(200)
    expect(summaryResponse.headers.get('cache-control')).toBe('no-store')
    expect(await jsonRecord(summaryResponse)).toMatchObject({ schemaVersion: 1 })

    const listPaths = [
      '/admin/publishers',
      '/admin/publisher-keys',
      '/admin/ownerships',
      '/admin/submissions',
      '/admin/releases',
      '/admin/publications',
      '/admin/audit'
    ]
    const serializedPages: Record<string, string> = {}
    for (const path of listPaths) {
      const response = await adminRequest(fixture.app, `${path}?limit=2`)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const value = await page(response)
      expect(value.items.length).toBeLessThanOrEqual(2)
      serializedPages[path] = JSON.stringify(value)
    }
    expect(serializedPages['/admin/publisher-keys']).not.toContain('publicKeyPem')
    expect(serializedPages['/admin/publisher-keys']).not.toContain('BEGIN PUBLIC KEY')
    expect(serializedPages['/admin/submissions']).not.toContain('manifestUrl')
    expect(serializedPages['/admin/submissions']).not.toContain('packageUrl')
    expect(serializedPages['/admin/releases']).not.toContain('manifestUrl')
    expect(serializedPages['/admin/releases']).not.toContain('packageUrl')

    for (const [path, identity] of [
      ['/admin/publishers/alpha', { id: 'alpha' }],
      ['/admin/publisher-keys/alpha.release', { keyId: 'alpha.release' }],
      ['/admin/ownerships/alpha.analytics', { pluginId: 'alpha.analytics' }],
      ['/admin/submissions/alpha-draft-v2', { id: 'alpha-draft-v2' }]
    ] as const) {
      const response = await adminRequest(fixture.app, path)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await jsonRecord(response)).toMatchObject({ schemaVersion: 1, ...identity })
    }

    for (const [path, identity] of [
      [
        '/admin/releases/stable/alpha.analytics/1.0.0',
        { submissionId: 'alpha-release-v1', submissionRevision: 1 }
      ],
      ['/admin/audit/1', { item: { sequence: 1 } }]
    ] as const) {
      const response = await adminRequest(fixture.app, path)
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await jsonRecord(response)).toMatchObject({ schemaVersion: 1, ...identity })
    }
    expect((await adminRequest(fixture.app, '/admin/publications/1')).status).toBe(404)
    expect((await adminRequest(fixture.app, '/admin/audit/1?unexpected=true')).status).toBe(400)

    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      'limit=1&limit=2',
      'unknown=true',
      'status=not-a-status'
    ]) {
      const invalid = await adminRequest(fixture.app, `/admin/publishers?${query}`)
      expect(invalid.status).toBe(400)
      expect(invalid.headers.get('cache-control')).toBe('no-store')
    }

    const first = await page(await adminRequest(fixture.app, '/admin/publishers?limit=1'))
    expect(typeof first.nextCursor).toBe('string')
    const cursor = first.nextCursor as string
    expect(
      (
        await adminRequest(
          fixture.app,
          `/admin/publishers?limit=1&cursor=${encodeURIComponent(tamperCursor(cursor))}`
        )
      ).status
    ).toBe(400)
    expect(
      (
        await adminRequest(
          fixture.app,
          `/admin/publisher-keys?limit=1&cursor=${encodeURIComponent(cursor)}`
        )
      ).status
    ).toBe(400)
    await fixture.service.requestOwnership('beta.additional-plugin', 'beta', {
      actor: 'publisher:beta',
      time: NOW
    })
    expect(
      (
        await adminRequest(
          fixture.app,
          `/admin/publishers?limit=1&cursor=${encodeURIComponent(cursor)}`
        )
      ).status
    ).toBe(409)

    const preflight = await fixture.app.request(`${LOOPBACK_ORIGIN}/admin/summary`, {
      method: 'OPTIONS',
      headers: { origin: 'https://untrusted.example' }
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()
    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull()
  })

  test('keeps custom and legacy bearer principals read-only across every legacy admin mutation', async () => {
    const fixture = await phase4Fixture()
    let customAuthentications = 0
    const customApp = fixture.createApp({
      enabled: true,
      async authenticate(request) {
        customAuthentications++
        return request.headers.get('authorization') === `Bearer ${OPERATOR_TOKEN}`
          ? {
              actor: 'admin:operator-alice',
              expiresAt: Date.parse(NOW) + 60_000
            }
          : null
      }
    })
    const legacyApp = fixture.createApp({
      enabled: true,
      token: LEGACY_TOKEN
    })

    expect((await adminRequest(customApp, '/admin/summary')).status).toBe(200)
    expect(customAuthentications).toBe(1)
    expect((await adminRequest(legacyApp, '/admin/summary', { token: LEGACY_TOKEN })).status).toBe(
      200
    )

    const before = await fixture.service.snapshot()
    const mutationPaths = [
      '/admin/impact-preview',
      '/admin/publishers/alpha/status',
      '/admin/publisher-keys/alpha.release/status',
      '/admin/ownerships/alpha.analytics/status',
      '/admin/submissions/alpha-draft-v2/status',
      '/admin/submissions/alpha-draft-v2/publish',
      '/admin/releases/yank',
      '/admin/publish'
    ]
    for (const { app, token } of [
      { app: customApp, token: OPERATOR_TOKEN },
      { app: legacyApp, token: LEGACY_TOKEN }
    ]) {
      for (const path of mutationPaths) {
        const response = await adminRequest(app, path, {
          method: 'POST',
          token,
          value: {}
        })
        expect(response.status).toBe(path === '/admin/publish' ? 404 : 401)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({
          error:
            path === '/admin/publish'
              ? 'Online marketplace signing is disabled'
              : 'A V2 operator assertion is required for admin mutations'
        })
      }
    }

    expect(customAuthentications).toBe(1)
    expect(await fixture.service.snapshot()).toEqual(before)
  })

  test('publishes an approved submission only through a V2 operator assertion', async () => {
    const fixture = await phase4Fixture()
    const app = fixture.createApp({ enabled: true, token: LEGACY_TOKEN })
    await fixture.service.transitionSubmission('alpha-draft-v2', 'approved', {
      actor: 'admin:fixture',
      time: NOW
    })
    const preview = await fixture.service.previewImpact({
      operation: 'submission.publish',
      submissionId: 'alpha-draft-v2'
    })
    const body = JSON.stringify({
      reason: 'Release reviewed and approved',
      typedIdentifier: 'submission:alpha-draft-v2',
      authorityDigest: preview.authorityDigest
    })
    const path = '/admin/operator/submissions/alpha-draft-v2/publish'
    const assertion = signMarketplaceOperatorAssertion(
      {
        actor: V2_OPERATOR_ACTOR,
        requestId: 'request_phase4_release_publish',
        correlationId: 'correlation_phase4_release_publish',
        authorization: {
          realm: 'platform',
          role: 'releaser',
          operation: 'release.publish',
          mfaVerifiedAt: BEFORE,
          stepUp: {
            verifiedAt: BEFORE,
            grantIdDigest: V2_STEP_UP_GRANT_DIGEST
          }
        },
        method: 'POST',
        url: `${LOOPBACK_ORIGIN}${path}`,
        timestamp: NOW,
        nonce: fixture.nextNonce(),
        body: encoder.encode(body)
      },
      LEGACY_TOKEN
    )
    const response = await app.request(`${LOOPBACK_ORIGIN}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MARKETPLACE_ADMIN_ASSERTION_HEADER]: assertion
      },
      body
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      schemaVersion: 1,
      submissionId: 'alpha-draft-v2',
      publisherId: 'alpha'
    })
    const state = await fixture.service.snapshot()
    expect(state.submissions.find(({ id }) => id === 'alpha-draft-v2')?.status).toBe('published')
    expect(state.auditEvents.at(-1)).toMatchObject({
      actor: V2_OPERATOR_ACTOR,
      action: 'release.published',
      subject: 'release:alpha.analytics@2.0.0#stable'
    })
  })
})

describe('marketplace Phase 4 submission validation and revision HTTP contract', () => {
  test('enforces media type and streamed body bounds before authentication', async () => {
    const fixture = await phase4Fixture()
    const wrongMediaType = await fixture.app.request(`${LOOPBACK_ORIGIN}/v1/submissions/validate`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}'
    })
    expect(wrongMediaType.status).toBe(415)
    expect(wrongMediaType.headers.get('cache-control')).toBe('no-store')

    const oversized = new Request(`${LOOPBACK_ORIGIN}/v1/submissions/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Uint8Array(4 * 1024 * 1024 + 1)
    })
    expect(oversized.headers.get('content-length')).toBeNull()
    const response = await fixture.app.request(oversized)
    expect(response.status).toBe(413)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  test('validates a signed submission without state, audit, or artifact side effects', async () => {
    const fixture = await phase4Fixture()
    const manifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '9.0.0', 'Validation only module'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const artifactDigest = digestMarketplaceArtifact(
      encoder.encode(serializeVersionedPluginManifest(manifest))
    )
    const before = await fixture.service.snapshot()
    expect(await fixture.service.artifact(artifactDigest)).toBeNull()

    const response = await signedRequest(fixture, 'alpha', '/v1/submissions/validate', {
      method: 'POST',
      value: {
        id: 'alpha-validation-v9',
        publisherId: 'alpha',
        channel: 'stable',
        manifest,
        listing: listing('alpha', '9.0.0')
      }
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await jsonRecord(response)).toMatchObject({
      schemaVersion: 1,
      valid: true,
      coordinate: { pluginId: 'alpha.analytics', version: '9.0.0', channel: 'stable' }
    })
    expect(await fixture.service.snapshot()).toEqual(before)
    expect(await fixture.service.artifact(artifactDigest)).toBeNull()
    expect(
      (await fixture.app.request(`${LOOPBACK_ORIGIN}/v1/artifacts/${artifactDigest}`)).status
    ).toBe(404)

    const occupiedManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '2.0.0', 'Occupied coordinate'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const occupied = await signedRequest(fixture, 'alpha', '/v1/submissions/validate', {
      method: 'POST',
      value: {
        id: 'alpha-validation-occupied',
        publisherId: 'alpha',
        channel: 'stable',
        manifest: occupiedManifest,
        listing: listing('alpha', '2.0.0')
      }
    })
    expect(occupied.status).toBe(409)
    expect(await fixture.service.snapshot()).toEqual(before)
  })

  test('replays an authenticated revision conflict after state changes would make it valid', async () => {
    const fixture = await phase4Fixture()
    const revisedManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '2.0.0', 'Terminal conflict replay'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const url = `${LOOPBACK_ORIGIN}/v1/submissions/alpha-draft-v2/revise`
    const init = await signedInit(fixture, 'alpha', url, {
      method: 'POST',
      value: {
        publisherId: 'alpha',
        expectedRevision: 1,
        manifest: revisedManifest,
        listing: listing('alpha', '2.0.0', 'Terminal conflict replay')
      }
    })

    const rejected = await fixture.app.request(url, init)
    const exactFailure = { status: rejected.status, body: await rejected.text() }
    expect(exactFailure.status).toBe(409)
    expect(
      (await fixture.service.snapshot()).submissions.find(({ id }) => id === 'alpha-draft-v2')
    ).toMatchObject({ revision: 1, status: 'awaiting_review' })

    await fixture.service.transitionSubmission('alpha-draft-v2', 'changes_requested', {
      actor: 'admin:fixture',
      reason: 'The same revision would now be accepted without its terminal receipt',
      time: NOW
    })
    const replayed = await fixture.app.request(url, init)
    expect({ status: replayed.status, body: await replayed.text() }).toEqual(exactFailure)
    expect(
      (await fixture.service.snapshot()).submissions.find(({ id }) => id === 'alpha-draft-v2')
    ).toMatchObject({ revision: 1, status: 'changes_requested' })
  })

  test('returns the transaction result without an out-of-boundary control-reader read', async () => {
    const fixture = await phase4Fixture()
    await fixture.service.transitionSubmission('alpha-draft-v2', 'changes_requested', {
      actor: 'admin:fixture',
      reason: 'Exercise the transaction-return response boundary',
      time: NOW
    })
    const before = await fixture.service.snapshot()
    const control = fixture.service.control
    let submissionReads = 0
    const app = createMarketplaceHttpApp({
      service: {
        ...fixture.service,
        control: {
          ...control,
          async submission(...args: Parameters<typeof control.submission>) {
            submissionReads += 1
            if (submissionReads > 1) throw new Error('post-commit reader must not run')
            return control.submission(...args)
          }
        }
      } as never,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW)
    })
    const revisedManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '2.0.0', 'Transaction result module'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const url = `${LOOPBACK_ORIGIN}/v1/submissions/alpha-draft-v2/revise`
    const response = await app.request(
      url,
      await signedInit(fixture, 'alpha', url, {
        method: 'POST',
        value: {
          publisherId: 'alpha',
          expectedRevision: 1,
          manifest: revisedManifest,
          listing: listing('alpha', '2.0.0', 'Transaction result listing')
        }
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(parseMarketplaceControlSubmissionSummary(await jsonRecord(response))).toMatchObject({
      id: 'alpha-draft-v2',
      revision: 2
    })
    expect(submissionReads).toBe(0)
    const state = await fixture.service.snapshot()
    expect(state.auditEvents).toHaveLength(before.auditEvents.length + 1)
    expect(state.auditEvents.at(-1)?.action).toBe('submission.revised')
  })

  test('revises only the original publisher and coordinate with one optimistic append-only revision', async () => {
    const fixture = await phase4Fixture()
    await fixture.service.transitionSubmission('alpha-draft-v2', 'changes_requested', {
      actor: 'admin:fixture',
      reason: 'Please revise the listing and module metadata',
      time: NOW
    })
    const detailBeforeResponse = await signedRequest(
      fixture,
      'alpha',
      '/v1/publishers/me/submissions/alpha-draft-v2'
    )
    expect(detailBeforeResponse.status).toBe(200)
    const detailBefore = await jsonRecord(detailBeforeResponse)
    expect(detailBefore.revision).toBe(1)
    expect(detailBefore.revisions).toHaveLength(1)

    const coercedRevision = await signedRequest(
      fixture,
      'alpha',
      '/v1/submissions/alpha-draft-v2/revise',
      {
        method: 'POST',
        value: {
          publisherId: 'alpha',
          expectedRevision: '1',
          manifest: await signPluginManifest(
            payloadFor(fixture.publishers.alpha, '2.0.0', 'Coerced revision attack'),
            fixture.publishers.alpha.keyPair.privateKey
          ),
          listing: listing('alpha', '2.0.0', 'Coerced revision attack')
        }
      }
    )
    expect(coercedRevision.status).toBe(400)

    const revisedManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '2.0.0', 'Revised module'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const revisedBody = {
      publisherId: 'alpha',
      expectedRevision: detailBefore.revision,
      manifest: revisedManifest,
      listing: listing('alpha', '2.0.0', 'Revised after operator feedback')
    }

    const crossPublisher = await signedRequest(
      fixture,
      'beta',
      '/v1/submissions/alpha-draft-v2/revise',
      { method: 'POST', value: revisedBody }
    )
    expect(crossPublisher.status).toBe(404)

    const changedCoordinateManifest = await signPluginManifest(
      payloadFor(fixture.publishers.alpha, '2.1.0', 'Changed coordinate'),
      fixture.publishers.alpha.keyPair.privateKey
    )
    const changedCoordinate = await signedRequest(
      fixture,
      'alpha',
      '/v1/submissions/alpha-draft-v2/revise',
      {
        method: 'POST',
        value: { ...revisedBody, manifest: changedCoordinateManifest }
      }
    )
    expect(changedCoordinate.status).toBe(409)
    const extraChannel = await signedRequest(
      fixture,
      'alpha',
      '/v1/submissions/alpha-draft-v2/revise',
      { method: 'POST', value: { ...revisedBody, channel: 'beta' } }
    )
    expect(extraChannel.status).toBe(400)

    const reviseURL = `${LOOPBACK_ORIGIN}/v1/submissions/alpha-draft-v2/revise`
    const signedOriginal = await signedInit(fixture, 'alpha', reviseURL, {
      method: 'POST',
      value: revisedBody
    })
    const signedBodyTamper = await fixture.app.request(reviseURL, {
      ...signedOriginal,
      body: JSON.stringify({
        ...revisedBody,
        listing: listing('alpha', '2.0.0', 'Body changed after signing')
      })
    })
    expect(signedBodyTamper.status).toBe(401)

    const firstInit = await signedInit(fixture, 'alpha', reviseURL, {
      method: 'POST',
      value: revisedBody
    })
    const concurrentInit = await signedInit(fixture, 'alpha', reviseURL, {
      method: 'POST',
      value: revisedBody
    })
    const accepted = await fixture.app.request(reviseURL, firstInit)
    expect(accepted.status).toBe(200)
    expect(accepted.headers.get('cache-control')).toBe('no-store')
    const revised = await jsonRecord(accepted)
    const parsedRevised = parseMarketplaceControlSubmissionSummary(revised)
    expect(revised).toMatchObject({
      schemaVersion: 1,
      id: 'alpha-draft-v2',
      publisherId: 'alpha',
      revision: 2,
      status: 'submitted',
      manifestDigest: revisedManifest.integrity.digest
    })
    expect(parsedRevised.revision).toBe(2)

    const staleConcurrent = await fixture.app.request(reviseURL, concurrentInit)
    expect(staleConcurrent.status).toBe(409)
    const state = await fixture.service.snapshot()
    expect(state.auditEvents.at(-1)).toMatchObject({
      actor: 'publisher:alpha',
      action: 'submission.revised',
      subject: 'submission:alpha-draft-v2'
    })

    const detailAfter = await jsonRecord(
      await signedRequest(fixture, 'alpha', '/v1/publishers/me/submissions/alpha-draft-v2')
    )
    expect(detailAfter.revision).toBe(2)
    expect(detailAfter.revisions).toHaveLength(2)
  })

  test('keeps maximum revision mutation and detail responses bounded after commit', async () => {
    const fixture = await phase4Fixture()
    const submissionId = 'alpha-draft-v2'
    const publisher = fixture.publishers.alpha
    const maximumListing = {
      ...listing('alpha', '2.0.0'),
      description: '\\'.repeat(MARKETPLACE_LIMITS.maxDescriptionBytes)
    }
    const maximumReason = '\\'.repeat(MARKETPLACE_LIMITS.maxReasonBytes)
    for (let expectedRevision = 1; expectedRevision < 127; expectedRevision += 1) {
      if (expectedRevision > 1) {
        await fixture.service.transitionSubmission(submissionId, 'awaiting_review', {
          actor: 'system:max-revision-validation',
          time: NOW
        })
      }
      await fixture.service.transitionSubmission(submissionId, 'changes_requested', {
        actor: 'admin:max-revision-fixture',
        reason: maximumReason,
        time: NOW
      })
      const manifest = await signPluginManifest(
        payloadFor(publisher, '2.0.0', `Max revision ${expectedRevision + 1}`),
        publisher.keyPair.privateKey
      )
      await fixture.service.reviseSubmission(
        submissionId,
        {
          publisherId: publisher.id,
          expectedRevision,
          channel: 'stable',
          manifest,
          listing: maximumListing
        },
        {
          actor: `publisher:${publisher.id}`,
          authenticatedRequestKeyId: publisher.keyId,
          time: NOW
        }
      )
    }
    await fixture.service.transitionSubmission(submissionId, 'awaiting_review', {
      actor: 'system:max-revision-validation',
      time: NOW
    })
    await fixture.service.transitionSubmission(submissionId, 'changes_requested', {
      actor: 'admin:max-revision-fixture',
      reason: maximumReason,
      time: NOW
    })
    const finalManifest = await signPluginManifest(
      payloadFor(publisher, '2.0.0', 'Max revision 128'),
      publisher.keyPair.privateKey
    )
    const before = await fixture.service.snapshot()
    const response = await signedRequest(
      fixture,
      'alpha',
      `/v1/submissions/${submissionId}/revise`,
      {
        method: 'POST',
        value: {
          publisherId: publisher.id,
          expectedRevision: 127,
          manifest: finalManifest,
          listing: maximumListing
        }
      }
    )
    expect(response.status).toBe(200)
    const responseSource = await response.text()
    expect(encoder.encode(responseSource).byteLength).toBeLessThanOrEqual(
      MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
    )
    const responseValue = JSON.parse(responseSource) as MarketplaceHttpTestRecord
    expect(Object.hasOwn(responseValue, 'revisions')).toBe(false)
    expect(parseMarketplaceControlSubmissionSummary(responseValue).revision).toBe(128)
    const after = await fixture.service.snapshot()
    expect(after.submissions.find(({ id }) => id === submissionId)?.revision).toBe(128)
    expect(after.auditEvents).toHaveLength(before.auditEvents.length + 1)
    expect(after.auditEvents.at(-1)?.action).toBe('submission.revised')

    const detailResponse = await signedRequest(
      fixture,
      'alpha',
      `/v1/publishers/me/submissions/${submissionId}`
    )
    expect(detailResponse.status).toBe(200)
    const detailSource = await detailResponse.text()
    expect(encoder.encode(detailSource).byteLength).toBeLessThanOrEqual(
      MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
    )
    expect(parseMarketplaceControlSubmission(JSON.parse(detailSource)).revisions).toHaveLength(128)
  }, 120_000)
})
