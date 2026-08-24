import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  signMarketplaceSnapshot,
  signPluginCatalog,
  type MarketplaceSnapshotPayloadV1,
  type PluginCatalogPayloadV1
} from '@open-pencil/plugin-contracts'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  createMarketplaceSourceManager,
  createMarketplaceSourceRuntime,
  createMemoryMarketplaceSourceStorage,
  createMemoryRemotePluginCacheStorage,
  parseMarketplaceSourceStateJSON
} from '@/app/plugins'

const NOW = Date.parse('2026-08-05T00:00:00.000Z')
const SNAPSHOT_URL = 'https://plugins.example.com/marketplace.json'
const MIRROR_URL = 'https://mirror.example.com/marketplace.json'
const CATALOG_URL = 'https://plugins.example.com/catalog.json'
const MIRROR_CATALOG_URL = 'https://mirror.example.com/catalog.json'
const ROOT_KEY_ID = 'marketplace.root.2026'
const NEXT_ROOT_KEY_ID = 'marketplace.root.2027'

interface FixtureOptions {
  keyId?: string
  version?: string
  sequence?: number
  catalogExpiresAt?: string
  snapshotExpiresAt?: string
  snapshotURL?: string
  catalogURL?: string
}

async function fixture(options: FixtureOptions = {}) {
  const keyId = options.keyId ?? ROOT_KEY_ID
  const version = options.version ?? '1.4.0'
  const sequence = options.sequence ?? 14
  const catalogExpiresAt = options.catalogExpiresAt ?? '2026-08-09T00:00:00.000Z'
  const snapshotExpiresAt = options.snapshotExpiresAt ?? '2026-08-09T00:00:00.000Z'
  const snapshotURL = options.snapshotURL ?? SNAPSHOT_URL
  const catalogURL = options.catalogURL ?? CATALOG_URL
  const root = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const catalogPayload: PluginCatalogPayloadV1 = {
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId: 'openpencil.marketplace.stable',
    version,
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: catalogExpiresAt,
    entries: []
  }
  const catalog = await signPluginCatalog(catalogPayload, root.privateKey, {
    keyId
  })
  const snapshotPayload: MarketplaceSnapshotPayloadV1 = {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: 'openpencil.marketplace',
    version,
    sequence,
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: snapshotExpiresAt,
    publisherDirectory: { publishers: [], ownerships: [] },
    catalogs: [
      {
        channel: 'stable',
        catalogId: catalog.catalogId,
        keyId,
        url: catalogURL,
        digest: catalog.integrity.digest
      }
    ],
    listings: [],
    auditHead: {
      sequence: sequence * 3,
      headDigest: await digestCanonicalManifest({ audit: sequence * 3 }),
      url: 'https://plugins.example.com/audit.json'
    }
  }
  const snapshot = await signMarketplaceSnapshot(snapshotPayload, root.privateKey, {
    keyId
  })
  const source = {
    schemaVersion: 1,
    url: snapshotURL,
    marketplaceId: snapshot.marketplaceId,
    keyId,
    publicKeyPem: await exportEd25519PublicKeyPem(root.publicKey),
    channel: 'stable' as const
  }
  return { root, catalog, snapshot, source }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

describe('marketplace source runtime', () => {
  test('reviews exact verified authority and activates that same staged snapshot without refetch', async () => {
    const data = await fixture()
    let failNetwork = false
    let requests = 0
    const fetchImpl: typeof fetch = async (input) => {
      requests += 1
      if (failNetwork) throw new Error('offline')
      const url = input instanceof Request ? input.url : input.toString()
      if (url === SNAPSHOT_URL) return jsonResponse(data.snapshot)
      if (url === CATALOG_URL) return jsonResponse(data.catalog)
      throw new Error(`Unexpected URL: ${url}`)
    }
    let id = 0
    const manager = createMarketplaceSourceManager({
      storage: createMemoryMarketplaceSourceStorage(),
      now: () => NOW,
      idFactory: (kind) => `${kind}:${++id}`
    })
    await manager.load()
    const runtime = createMarketplaceSourceRuntime({
      manager,
      cache: createMemoryRemotePluginCacheStorage(),
      engineVersion: '0.13.2',
      transportOptions: { fetchImpl }
    })

    const review = await runtime.reviewUserSource(data.source)
    expect(review).toMatchObject({
      snapshotUrl: SNAPSHOT_URL,
      marketplaceId: 'openpencil.marketplace',
      rootKeyId: ROOT_KEY_ID,
      snapshotVersion: '1.4.0',
      snapshotSequence: 14,
      expiresAt: '2026-08-09T00:00:00.000Z',
      auditSequence: 42,
      listingCount: 0,
      catalogId: 'openpencil.marketplace.stable',
      catalogVersion: '1.4.0',
      catalogDigest: data.catalog.integrity.digest
    })
    expect(review.snapshotDigest).toBe(data.snapshot.integrity.digest)
    expect(review.auditHeadDigest).toBe(data.snapshot.auditHead.headDigest)

    failNetwork = true
    await expect(runtime.reviewUserSource({ ...data.source, url: MIRROR_URL })).rejects.toThrow(
      'offline'
    )
    await expect(
      runtime.activateReviewedSource(review.stageId, review.rootFingerprint)
    ).rejects.toThrow('missing or stale')

    failNetwork = false
    const accepted = await runtime.reviewUserSource(data.source)
    const requestsAfterReview = requests
    const committed = await runtime.activateReviewedSource(
      accepted.stageId,
      accepted.rootFingerprint
    )
    expect(committed.active).not.toBeNull()
    failNetwork = true
    const bundle = await runtime.loadActiveTrustBundle()
    expect(requests).toBe(requestsAfterReview)
    expect(bundle?.lease).toMatchObject({
      marketplaceId: 'openpencil.marketplace',
      snapshotVersion: '1.4.0',
      snapshotSequence: 14,
      snapshotDigest: data.snapshot.integrity.digest
    })
    expect(bundle?.lease.authority).toEqual({
      sourceId: committed.active?.sourceId,
      trustDomainId: committed.active?.trustDomainId,
      sourceGeneration: committed.active?.sourceGeneration,
      rootKeySpkiSha256: committed.active?.rootKeySpkiSha256
    })
  })

  test('rejects an expired reviewed catalog before committing source or root rotation', async () => {
    let clock = NOW
    let served = await fixture()
    const storage = createMemoryMarketplaceSourceStorage()
    const fetchImpl: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url === served.source.url) return jsonResponse(served.snapshot)
      if (url === served.snapshot.catalogs[0].url) return jsonResponse(served.catalog)
      throw new Error(`Unexpected URL: ${url}`)
    }
    let id = 0
    const manager = createMarketplaceSourceManager({
      storage,
      now: () => clock,
      idFactory: (kind) => `${kind}:${++id}`
    })
    await manager.load()
    const runtime = createMarketplaceSourceRuntime({
      manager,
      cache: createMemoryRemotePluginCacheStorage(),
      engineVersion: '0.13.2',
      transportOptions: { fetchImpl }
    })

    const initialReview = await runtime.reviewUserSource(served.source)
    await runtime.activateReviewedSource(initialReview.stageId, initialReview.rootFingerprint)
    const initialActive = manager.snapshot().active
    if (!initialActive) throw new Error('Expected initial Marketplace source')

    served = await fixture({
      keyId: NEXT_ROOT_KEY_ID,
      version: '1.5.0',
      sequence: 15,
      catalogExpiresAt: '2026-08-06T00:00:00.000Z',
      snapshotExpiresAt: '2026-08-10T00:00:00.000Z',
      snapshotURL: MIRROR_URL,
      catalogURL: MIRROR_CATALOG_URL
    })
    const rotationReview = await runtime.reviewUserSource(served.source)
    expect(rotationReview.isRootRotation).toBe(true)
    clock = Date.parse('2026-08-07T00:00:00.000Z')

    await expect(
      runtime.activateReviewedSource(rotationReview.stageId, rotationReview.rootFingerprint)
    ).rejects.toThrow('expired')
    expect(manager.snapshot().active).toEqual(initialActive)

    const persistedJSON = storage.value()
    if (!persistedJSON) throw new Error('Expected persisted Marketplace source state')
    const persisted = await parseMarketplaceSourceStateJSON(persistedJSON)
    expect(persisted.trustDomains[0]).toMatchObject({
      currentRootFingerprint: initialActive.rootKeySpkiSha256,
      retiredRootFingerprints: [],
      highWater: { snapshotSequence: 14 }
    })
    expect(
      persisted.sources.some(
        ({ rootKeySpkiSha256 }) => rootKeySpkiSha256 === rotationReview.rootFingerprint
      )
    ).toBe(false)
  })
})
