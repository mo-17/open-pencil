import { describe, expect, test } from 'bun:test'

import {
  createMarketplaceHttpApp,
  createMarketplaceService,
  createMemoryMarketplaceArtifactStore,
  createMemoryMarketplaceNonceStore,
  createMemoryMarketplaceRepository,
  signMarketplaceRequest
} from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const NOW = '2026-08-05T12:00:00.000Z'
const MARKETPLACE_ID = 'openpencil-marketplace'
const REGISTRATION_URL = 'http://localhost/v1/publishers/register'
const KEY_ROTATION_URL = 'http://localhost/v1/publisher-keys'

function requestHeaders(headers: Awaited<ReturnType<typeof signMarketplaceRequest>>) {
  return {
    'content-type': 'application/json',
    'x-openpencil-marketplace-audience': headers.audience,
    'x-openpencil-publisher-id': headers.publisherId,
    'x-openpencil-key-id': headers.keyId,
    'x-openpencil-timestamp': headers.timestamp,
    'x-openpencil-nonce': headers.nonce,
    'x-openpencil-signature': headers.signature
  }
}

describe('marketplace HTTP API', () => {
  test('accepts one self-signed publisher registration and rejects its replay', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const repository = createMemoryMarketplaceRepository()
    const service = createMarketplaceService({
      repository,
      artifacts: createMemoryMarketplaceArtifactStore(),
      marketplaceId: MARKETPLACE_ID,
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW)
    })
    const app = createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW)
    })
    const body = JSON.stringify({
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(pair.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    })
    const bytes = new TextEncoder().encode(body)
    const signed = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: 'acme.release',
        method: 'POST',
        url: REGISTRATION_URL,
        timestamp: NOW,
        nonce: 'abcdefghijklmnop',
        body: bytes
      },
      pair.privateKey
    )
    const init = { method: 'POST', headers: requestHeaders(signed), body }

    const accepted = await app.request(REGISTRATION_URL, init)
    expect(accepted.status).toBe(201)
    expect((await accepted.json()).status).toBe('pending')
    expect((await service.snapshot()).publisherKeys).toHaveLength(1)

    const replay = await app.request(REGISTRATION_URL, init)
    expect(replay.status).toBe(401)
    expect(await replay.json()).toEqual({
      error: 'Marketplace request nonce has already been used'
    })

    await service.transitionPublisherKey('acme.release', 'active', {
      actor: 'admin:test',
      time: NOW
    })
    await service.transitionPublisher('acme', 'active', { actor: 'admin:test', time: NOW })
    const nextPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const rotationValue = {
      keyId: 'acme.release.2027',
      publisherId: 'acme',
      publicKeyPem: await exportEd25519PublicKeyPem(nextPair.publicKey),
      notBefore: '2026-09-01T00:00:00.000Z',
      notAfter: '2027-09-01T00:00:00.000Z',
      predecessorKeyId: 'acme.release'
    }
    const rotationBody = JSON.stringify(rotationValue)
    const rotationBytes = new TextEncoder().encode(rotationBody)
    const rotationHeaders = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: 'acme.release',
        method: 'POST',
        url: KEY_ROTATION_URL,
        timestamp: NOW,
        nonce: 'rotationnonce0001',
        body: rotationBytes
      },
      pair.privateKey
    )
    const rotation = await app.request(KEY_ROTATION_URL, {
      method: 'POST',
      headers: requestHeaders(rotationHeaders),
      body: rotationBody
    })
    expect(rotation.status).toBe(201)
    expect((await rotation.json()).predecessorKeyId).toBe('acme.release')

    const forgedBody = JSON.stringify({
      ...rotationValue,
      keyId: 'acme.release.forged',
      predecessorKeyId: 'unrelated.release'
    })
    const forgedBytes = new TextEncoder().encode(forgedBody)
    const forgedHeaders = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: 'acme.release',
        method: 'POST',
        url: KEY_ROTATION_URL,
        timestamp: NOW,
        nonce: 'rotationnonce0002',
        body: forgedBytes
      },
      pair.privateKey
    )
    const forged = await app.request(KEY_ROTATION_URL, {
      method: 'POST',
      headers: requestHeaders(forgedHeaders),
      body: forgedBody
    })
    expect(forged.status).toBe(401)

    const crossPublisherBody = JSON.stringify({
      ...rotationValue,
      keyId: 'other.release.2027',
      publisherId: 'other'
    })
    const crossPublisherBytes = new TextEncoder().encode(crossPublisherBody)
    const crossPublisherHeaders = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'acme',
        keyId: 'acme.release',
        method: 'POST',
        url: KEY_ROTATION_URL,
        timestamp: NOW,
        nonce: 'rotationnonce0003',
        body: crossPublisherBytes
      },
      pair.privateKey
    )
    const crossPublisher = await app.request(KEY_ROTATION_URL, {
      method: 'POST',
      headers: requestHeaders(crossPublisherHeaders),
      body: crossPublisherBody
    })
    expect(crossPublisher.status).toBe(401)
  })

  test('rejects publisher identity header substitution when public key material is reused', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const publicKeyPem = await exportEd25519PublicKeyPem(pair.publicKey)
    const service = createMarketplaceService({
      repository: createMemoryMarketplaceRepository(),
      artifacts: createMemoryMarketplaceArtifactStore(),
      marketplaceId: MARKETPLACE_ID,
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW)
    })
    for (const publisherId of ['publisher-one', 'publisher-two']) {
      const keyId = `${publisherId}-2026`
      await service.registerPublisher(
        {
          publisher: { id: publisherId, displayName: publisherId },
          key: {
            keyId,
            publisherId,
            publicKeyPem,
            notBefore: '2026-01-01T00:00:00.000Z',
            notAfter: '2027-01-01T00:00:00.000Z'
          }
        },
        { actor: `publisher:${publisherId}` }
      )
      await service.transitionPublisherKey(keyId, 'active', { actor: 'admin:test' })
      await service.transitionPublisher(publisherId, 'active', { actor: 'admin:test' })
    }
    const app = createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(() => Date.parse(NOW)),
      now: () => Date.parse(NOW)
    })
    const url = 'http://localhost/v1/publishers/me'
    const signed = await signMarketplaceRequest(
      {
        audience: MARKETPLACE_ID,
        publisherId: 'publisher-one',
        keyId: 'publisher-one-2026',
        method: 'GET',
        url,
        timestamp: NOW,
        nonce: 'identitynonce001',
        body: new Uint8Array()
      },
      pair.privateKey
    )
    const substituted = await app.request(url, {
      headers: {
        ...requestHeaders(signed),
        'x-openpencil-publisher-id': 'publisher-two',
        'x-openpencil-key-id': 'publisher-two-2026'
      }
    })

    expect(substituted.status).toBe(401)
    expect(await substituted.json()).toEqual({ error: 'Marketplace request signature is invalid' })
  })

  test('keeps admin mutations loopback-gated and does not enable CORS', async () => {
    const service = createMarketplaceService({
      repository: createMemoryMarketplaceRepository(),
      artifacts: createMemoryMarketplaceArtifactStore(),
      marketplaceId: MARKETPLACE_ID,
      publicBaseUrl: 'https://plugins.example.com/'
    })
    const app = createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(),
      admin: { enabled: false, token: 'a'.repeat(32) }
    })
    const admin = await app.request('http://localhost/admin/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${'a'.repeat(32)}`,
        'content-type': 'application/json'
      },
      body: '{}'
    })
    expect(admin.status).toBe(404)

    const onlineDisabledApp = createMarketplaceHttpApp({
      service,
      nonces: createMemoryMarketplaceNonceStore(),
      admin: { enabled: true, token: 'a'.repeat(32), onlinePublishing: false }
    })
    const onlineDisabled = await onlineDisabledApp.request('http://localhost/admin/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${'a'.repeat(32)}`,
        'content-type': 'application/json'
      },
      body: '{}'
    })
    expect(onlineDisabled.status).toBe(404)

    const preflight = await app.request('http://localhost/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://untrusted.example' }
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull()

    const target = {
      pluginId: 'publisher.target',
      publisherId: 'publisher',
      name: 'Target',
      summary: 'Listing after the first hundred results',
      categories: ['utility'],
      keywords: [],
      releases: [{ channel: 'stable' as const, version: '1.0.0', digest: 'A'.repeat(43) }]
    }
    const exactLookupApp = createMarketplaceHttpApp({
      service: {
        ...service,
        search: async () =>
          Array.from({ length: 100 }, (_, index) => ({
            ...target,
            pluginId: `publisher.plugin-${String(index).padStart(3, '0')}`
          })),
        listing: async (pluginId) => (pluginId === target.pluginId ? target : null)
      },
      nonces: createMemoryMarketplaceNonceStore()
    })
    const exactLookup = await exactLookupApp.request(
      `http://localhost/v1/plugins/${target.pluginId}`
    )
    expect(exactLookup.status).toBe(200)
    expect((await exactLookup.json()).pluginId).toBe(target.pluginId)
  })
})
