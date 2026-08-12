import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1
} from '@open-pencil/core/plugins'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  createMarketplaceSnapshotClient,
  createMemoryRemotePluginCacheStorage,
  parseMarketplaceTrustConfig,
  parseMarketplaceTrustConfigJSON
} from '@/app/plugins'

const URL = 'https://plugins.example.com/marketplace.json'
const ROOT_KEY_ID = 'marketplace.root.2026'
const NOW = Date.parse('2026-08-05T00:00:00.000Z')

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function payload(sequence: number): Promise<MarketplaceSnapshotPayloadV1> {
  const catalogDigest = await digestCanonicalManifest({ catalog: sequence })
  return {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: 'openpencil.marketplace',
    version: `1.0.${sequence - 1}`,
    sequence,
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: '2026-08-09T00:00:00.000Z',
    publisherDirectory: { publishers: [], ownerships: [] },
    catalogs: [
      {
        channel: 'stable',
        catalogId: 'openpencil.marketplace.stable',
        keyId: ROOT_KEY_ID,
        url: 'https://plugins.example.com/catalogs/stable.json',
        digest: catalogDigest
      }
    ],
    listings: [],
    auditHead: {
      sequence,
      headDigest: await digestCanonicalManifest({ audit: sequence }),
      url: 'https://plugins.example.com/audit.json'
    }
  }
}

function fresh(value: unknown) {
  return {
    status: 'fresh' as const,
    url: URL,
    json: value,
    rawJson: JSON.stringify(value),
    etag: `"${(value as { sequence: number }).sequence}"`,
    lastModified: null
  }
}

describe('marketplace trust configuration', () => {
  test('imports a pinned Ed25519 root and rejects extra or insecure configuration', async () => {
    const root = await keys()
    const publicKeyPem = await exportEd25519PublicKeyPem(root.publicKey)
    const config = await parseMarketplaceTrustConfigJSON(
      JSON.stringify({
        schemaVersion: 1,
        url: URL,
        marketplaceId: 'openpencil.marketplace',
        keyId: ROOT_KEY_ID,
        publicKeyPem,
        channel: 'beta'
      })
    )
    expect(config).toMatchObject({
      snapshotUrl: URL,
      expectedMarketplaceId: 'openpencil.marketplace',
      expectedKeyId: ROOT_KEY_ID,
      channel: 'beta'
    })
    expect(config.rootPublicKey.type).toBe('public')

    await expect(
      parseMarketplaceTrustConfig({
        schemaVersion: 1,
        url: 'http://plugins.example.com/marketplace.json',
        marketplaceId: 'openpencil.marketplace',
        keyId: ROOT_KEY_ID,
        publicKeyPem
      })
    ).rejects.toThrow('HTTPS')
    await expect(
      parseMarketplaceTrustConfig({
        schemaVersion: 1,
        url: URL,
        marketplaceId: 'openpencil.marketplace',
        keyId: ROOT_KEY_ID,
        publicKeyPem,
        executable: true
      })
    ).rejects.toThrow('unsupported fields')
  })
})

describe('marketplace snapshot client', () => {
  test('re-verifies cache offline and refuses a validly signed rollback', async () => {
    const root = await keys()
    const first = await signMarketplaceSnapshot(await payload(1), root.privateKey, {
      keyId: ROOT_KEY_ID
    })
    const second = await signMarketplaceSnapshot(await payload(2), root.privateKey, {
      keyId: ROOT_KEY_ID
    })
    const cache = createMemoryRemotePluginCacheStorage()
    let response = first
    const client = createMarketplaceSnapshotClient({
      snapshotUrl: URL,
      expectedMarketplaceId: 'openpencil.marketplace',
      expectedKeyId: ROOT_KEY_ID,
      rootPublicKey: root.publicKey,
      cache,
      now: () => NOW,
      transport: { loadMarketplace: async () => fresh(response) }
    })

    expect((await client.load()).snapshot?.snapshot.sequence).toBe(1)
    response = second
    expect((await client.load()).snapshot?.snapshot.sequence).toBe(2)
    response = first
    const rollback = await client.load()
    expect(rollback.status).toBe('cached')
    expect(rollback.snapshot?.snapshot.sequence).toBe(2)
    expect(rollback.refreshError?.message).toContain('advance sequence and version')
  })

  test('returns stale instead of trusting an expired cached snapshot', async () => {
    const root = await keys()
    const snapshot = await signMarketplaceSnapshot(await payload(1), root.privateKey, {
      keyId: ROOT_KEY_ID
    })
    const cache = createMemoryRemotePluginCacheStorage()
    const online = createMarketplaceSnapshotClient({
      snapshotUrl: URL,
      expectedMarketplaceId: 'openpencil.marketplace',
      expectedKeyId: ROOT_KEY_ID,
      rootPublicKey: root.publicKey,
      cache,
      now: () => NOW,
      transport: { loadMarketplace: async () => fresh(snapshot) }
    })
    expect((await online.load()).status).toBe('fresh')

    const offline = createMarketplaceSnapshotClient({
      snapshotUrl: URL,
      expectedMarketplaceId: 'openpencil.marketplace',
      expectedKeyId: ROOT_KEY_ID,
      rootPublicKey: root.publicKey,
      cache,
      now: () => Date.parse('2026-08-10T00:00:00.000Z'),
      transport: {
        loadMarketplace: async () => {
          throw new Error('offline')
        }
      }
    })
    const stale = await offline.load()
    expect(stale.status).toBe('stale')
    expect(stale.snapshot).toBeNull()
  })
})
