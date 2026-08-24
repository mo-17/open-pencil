import { describe, expect, test } from 'bun:test'
import { createHash, createHmac } from 'node:crypto'

import {
  MARKETPLACE_ADMIN_ASSERTION_AUDIENCE,
  MARKETPLACE_ADMIN_ASSERTION_HEADER,
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  createSqliteMarketplaceRepository,
  signMarketplaceAdminAssertion,
  verifyMarketplaceAdminAssertion
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const NOW = '2026-08-22T08:00:00.000Z'
const BEFORE = '2026-08-22T07:59:00.000Z'
const LOOPBACK_ORIGIN = 'http://127.0.0.1:43121'
const ADMIN_TOKEN = 'phase5-admin-token-that-is-kept-server-side-only'
const ACTOR = 'portal:user-01j5operator'
const REQUEST_ID = 'request_01j5phase5admin'
const CORRELATION_ID = 'correlation_01j5phase5'
const encoder = new TextEncoder()

function assertionInput(
  nonce: string,
  body: Uint8Array,
  overrides: Partial<Parameters<typeof signMarketplaceAdminAssertion>[0]> = {}
) {
  return {
    actor: ACTOR,
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID,
    method: 'POST',
    url: `${LOOPBACK_ORIGIN}/admin/publishers/acme/status?review=exact%2Fbytes`,
    timestamp: NOW,
    nonce,
    body,
    ...overrides
  }
}

describe('marketplace Phase 5 Portal service assertion', () => {
  test('round-trips one versioned assertion and consumes its nonce once', async () => {
    const body = encoder.encode('{"status":"suspended", "reason":"exact bytes"}')
    const input = assertionInput('phase5assertionnonce0001', body)
    const assertion = signMarketplaceAdminAssertion(input, ADMIN_TOKEN)
    const nonces = createMemoryMarketplaceNonceStore(() => Date.parse(NOW))

    expect(assertion).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(assertion).not.toContain(ADMIN_TOKEN)
    const [version, payload, signature] = assertion.split('.')
    expect(version).toBe('v1')
    expect(signature).toBe(
      createHmac('sha256', encoder.encode(ADMIN_TOKEN))
        .update(`OPENPENCIL-MARKETPLACE-ADMIN-ASSERTION-V1\n${payload}`)
        .digest('base64url')
    )
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toEqual({
      version: 1,
      audience: 'openpencil-marketplace-admin',
      actor: ACTOR,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      method: input.method,
      target: '/admin/publishers/acme/status?review=exact%2Fbytes',
      timestamp: NOW,
      nonce: input.nonce,
      bodyDigest: createHash('sha256').update(body).digest('base64url')
    })
    await expect(
      verifyMarketplaceAdminAssertion(
        {
          assertion,
          method: input.method,
          url: input.url,
          body
        },
        {
          token: ADMIN_TOKEN,
          nonces,
          now: () => Date.parse(NOW)
        }
      )
    ).resolves.toEqual({
      actor: ACTOR,
      requestId: REQUEST_ID,
      correlationId: CORRELATION_ID,
      expiresAt: Date.parse(NOW) + 60_000
    })
    await expect(
      verifyMarketplaceAdminAssertion(
        {
          assertion,
          method: input.method,
          url: input.url,
          body
        },
        {
          token: ADMIN_TOKEN,
          nonces,
          now: () => Date.parse(NOW)
        }
      )
    ).rejects.toThrow(/nonce/i)
  })

  test('binds exact method, admin target/query, raw body, audience, and clock window', async () => {
    const body = encoder.encode('{"a":1, "b":2}')
    const input = assertionInput('phase5assertionnonce0002', body)
    const assertion = signMarketplaceAdminAssertion(input, ADMIN_TOKEN)
    const verify = (overrides: {
      method?: string
      url?: string
      body?: Uint8Array
      audience?: string
      now?: number
    }) =>
      verifyMarketplaceAdminAssertion(
        {
          assertion,
          method: overrides.method ?? input.method,
          url: overrides.url ?? input.url,
          body: overrides.body ?? body
        },
        {
          token: ADMIN_TOKEN,
          nonces: createMemoryMarketplaceNonceStore(() => overrides.now ?? Date.parse(NOW)),
          now: () => overrides.now ?? Date.parse(NOW),
          ...(overrides.audience ? { audience: overrides.audience } : {})
        }
      )

    await expect(verify({ method: 'GET' })).rejects.toThrow(/method/i)
    await expect(
      verify({ url: input.url.replace('review=exact%2Fbytes', 'review=exact%2fbytes') })
    ).rejects.toThrow(/target/i)
    await expect(verify({ body: encoder.encode('{"a":1,"b":2}') })).rejects.toThrow(/body/i)
    await expect(verify({ audience: 'another-private-service' })).rejects.toThrow(/audience/i)
    await expect(verify({ now: Date.parse(NOW) + 60_001 })).rejects.toThrow(/clock/i)
    expect(() =>
      signMarketplaceAdminAssertion(
        assertionInput('phase5assertionnonce0003', body, {
          url: `${LOOPBACK_ORIGIN}/v1/plugins`
        }),
        ADMIN_TOKEN
      )
    ).toThrow(/admin/i)
  })

  test('atomically accepts only one concurrent verification in SQLite', async () => {
    const repository = createSqliteMarketplaceRepository({
      path: ':memory:',
      now: () => Date.parse(NOW)
    })
    try {
      const body = encoder.encode('{}')
      const input = assertionInput('phase5assertionnonce0004', body)
      const assertion = signMarketplaceAdminAssertion(input, ADMIN_TOKEN)
      const verify = () =>
        verifyMarketplaceAdminAssertion(
          { assertion, method: input.method, url: input.url, body },
          {
            token: ADMIN_TOKEN,
            nonces: repository.nonces,
            now: () => Date.parse(NOW)
          }
        )
      const results = await Promise.allSettled([verify(), verify()])
      expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    } finally {
      await repository.close()
    }
  })
})

async function httpFixture() {
  const repository = createMemoryMarketplaceRepository()
  const service = createMarketplaceService({
    repository,
    artifacts: createMemoryMarketplaceArtifactStore(),
    marketplaceId: 'openpencil-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  await service.registerPublisher(
    {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: 'admin:fixture', time: BEFORE }
  )
  await service.transitionPublisherKey('acme.release', 'active', {
    actor: 'admin:fixture',
    time: BEFORE
  })
  await service.transitionPublisher('acme', 'active', { actor: 'admin:fixture', time: BEFORE })
  const app = createMarketplaceHttpApp({
    service,
    nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
    now: () => Date.parse(NOW),
    admin: { enabled: true, token: ADMIN_TOKEN, requireServiceAssertion: true }
  })
  return { app, service }
}

describe('marketplace Phase 5 Portal assertion HTTP boundary', () => {
  test('keeps V1 assertions read-only and rejects mutation actor overrides', async () => {
    const { app, service } = await httpFixture()
    const reason = 'Portal operator suspended publisher after review'
    const preview = await service.previewImpact({
      operation: 'publisher.status',
      publisherId: 'acme',
      status: 'suspended',
      reason
    })
    const url = `${LOOPBACK_ORIGIN}/admin/publishers/acme/status`

    const spoofBody = JSON.stringify({
      status: 'suspended',
      reason,
      authorityDigest: preview.authorityDigest,
      actor: 'admin:browser-forged'
    })
    const spoofAssertion = signMarketplaceAdminAssertion(
      assertionInput('phase5assertionnonce0005', encoder.encode(spoofBody), { url }),
      ADMIN_TOKEN
    )
    const auditBeforeSpoof = (await service.snapshot()).auditEvents.length
    const rejectedSpoof = await app.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MARKETPLACE_ADMIN_ASSERTION_HEADER]: spoofAssertion
      },
      body: spoofBody
    })
    expect(rejectedSpoof.status).toBe(401)
    expect((await service.snapshot()).auditEvents).toHaveLength(auditBeforeSpoof)

    const body = JSON.stringify({
      status: 'suspended',
      reason,
      authorityDigest: preview.authorityDigest
    })
    const assertion = signMarketplaceAdminAssertion(
      assertionInput('phase5assertionnonce0006', encoder.encode(body), { url }),
      ADMIN_TOKEN
    )
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MARKETPLACE_ADMIN_ASSERTION_HEADER]: assertion,
        'x-openpencil-actor': 'admin:browser-forged',
        'x-openpencil-request-id': 'browser-forged-request'
      },
      body
    }
    const rejectedMutation = await app.request(url, init)
    expect(rejectedMutation.status).toBe(401)
    expect((await service.snapshot()).auditEvents).toHaveLength(auditBeforeSpoof)

    const replay = await app.request(url, init)
    expect(replay.status).toBe(401)
    expect(await replay.json()).toEqual({ error: 'Admin service assertion is invalid' })
  })

  test('keeps valid Portal assertions unavailable outside loopback admin routes', async () => {
    const { app } = await httpFixture()
    const url = `${LOOPBACK_ORIGIN}/admin/summary`
    const legacyBearer = await app.request(url, {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    })
    expect(legacyBearer.status).toBe(401)
    expect(await legacyBearer.json()).toEqual({ error: 'Admin service assertion is required' })
    const assertion = signMarketplaceAdminAssertion(
      assertionInput('phase5assertionnonce0007', new Uint8Array(), {
        method: 'GET',
        url
      }),
      ADMIN_TOKEN
    )
    const leakedRawToken = await app.request(url, {
      headers: {
        [MARKETPLACE_ADMIN_ASSERTION_HEADER]: assertion,
        authorization: `Bearer ${ADMIN_TOKEN}`
      }
    })
    expect(leakedRawToken.status).toBe(401)
    const response = await app.request('http://marketplace.example/admin/summary', {
      headers: { [MARKETPLACE_ADMIN_ASSERTION_HEADER]: assertion }
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(MARKETPLACE_ADMIN_ASSERTION_AUDIENCE).toBe('openpencil-marketplace-admin')
  })
})
