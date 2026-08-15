import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  parseTrustedPluginKeyring,
  signPluginCatalog,
  signPluginManifest,
  type PluginCatalogPayloadV1
} from '@open-pencil/plugin-contracts'

import {
  createMemoryRemotePluginCacheStorage,
  createRemotePluginCatalogClient,
  remotePluginCatalogEntries
} from '@/app/plugins'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const NOW = Date.parse('2026-08-05T00:00:00.000Z')
const CATALOG_URL = 'https://plugins.example/catalog.json'
const MANIFEST_URL = 'https://plugins.example/acme.analytics/1.0.0.json'

async function fixture(revoked = false) {
  const catalogKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publisherKeys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify'
  ])
  const manifest = await signPluginManifest(pluginPayload(), publisherKeys.privateKey)
  const catalogPayload: PluginCatalogPayloadV1 = {
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId: 'open-pencil.catalog',
    version: '1.0.0',
    generatedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-31T00:00:00.000Z',
    entries: [
      {
        pluginId: manifest.plugin.id,
        version: manifest.plugin.version,
        digest: manifest.integrity.digest,
        manifestUrl: MANIFEST_URL,
        publisherId: manifest.publisher.id,
        keyId: manifest.publisher.keyId
      }
    ]
  }
  const catalog = await signPluginCatalog(catalogPayload, catalogKeys.privateKey, {
    keyId: 'catalog.root'
  })
  const publisherKeyring = parseTrustedPluginKeyring({
    schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
    keys: [
      {
        keyId: manifest.publisher.keyId,
        publisherId: manifest.publisher.id,
        pluginIds: [manifest.plugin.id],
        publicKey: publisherKeys.publicKey,
        notBefore: '2026-08-01T00:00:00.000Z',
        notAfter: '2027-08-01T00:00:00.000Z',
        ...(revoked
          ? {
              revokedAt: '2026-08-04T00:00:00.000Z',
              revocationReason: 'Compromised release key'
            }
          : {})
      }
    ]
  })
  return { catalogKeys, manifest, catalog, publisherKeyring }
}

function fresh(value: unknown, url: string) {
  return {
    status: 'fresh' as const,
    url,
    json: value,
    rawJson: JSON.stringify(value),
    etag: '"v1"',
    lastModified: null
  }
}

describe('remote plugin catalog client', () => {
  test('verifies the signed catalog and publisher package before caching them', async () => {
    const data = await fixture()
    const cache = createMemoryRemotePluginCacheStorage()
    const client = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      cache,
      now: () => NOW,
      transport: {
        loadCatalog: async () => fresh(data.catalog, CATALOG_URL),
        loadManifest: async () => fresh(data.manifest, MANIFEST_URL)
      }
    })

    const result = await client.load()

    expect(result).toMatchObject({ status: 'fresh', refreshError: null, issues: [] })
    expect(result.catalog?.catalog.catalogId).toBe('open-pencil.catalog')
    expect(result.packages[0]?.verification.verifiedPackage.manifest.plugin.id).toBe(
      'acme.analytics'
    )
    expect(await cache.list()).toHaveLength(2)
    expect(remotePluginCatalogEntries(result)[0]).toMatchObject({
      trustSource: 'publisher-signature',
      expectedPluginId: 'acme.analytics',
      remoteCatalog: {
        catalogId: 'open-pencil.catalog',
        catalogDigest: result.catalog?.verifiedDigest,
        source: 'network'
      }
    })
  })

  test('re-verifies a still-valid cache offline and marks an expired cache stale', async () => {
    const data = await fixture()
    const cache = createMemoryRemotePluginCacheStorage()
    const online = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      cache,
      now: () => NOW,
      transport: {
        loadCatalog: async () => fresh(data.catalog, CATALOG_URL),
        loadManifest: async () => fresh(data.manifest, MANIFEST_URL)
      }
    })
    expect((await online.load()).status).toBe('fresh')

    const offlineTransport = {
      loadCatalog: async (): Promise<never> => {
        throw new Error('offline')
      },
      loadManifest: async (): Promise<never> => {
        throw new Error('offline')
      }
    }
    const offline = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      cache,
      now: () => NOW,
      transport: offlineTransport
    })
    const cached = await offline.load()
    expect(cached.status).toBe('cached')
    expect(cached.packages).toHaveLength(1)
    expect(cached.refreshError?.message).toBe('offline')

    const partiallyOffline = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      cache,
      now: () => NOW,
      transport: {
        loadCatalog: async () => ({
          status: 'not-modified' as const,
          url: CATALOG_URL,
          etag: '"v1"',
          lastModified: null
        }),
        loadManifest: async (): Promise<never> => {
          throw new Error('manifest refresh failed')
        }
      }
    })
    const packageFallback = await partiallyOffline.load()
    expect(packageFallback.status).toBe('cached')
    expect(packageFallback.packages).toHaveLength(1)
    expect(packageFallback.refreshError?.message).toBe('manifest refresh failed')

    const expired = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      cache,
      now: () => Date.parse('2026-09-01T00:00:00.000Z'),
      transport: offlineTransport
    })
    const stale = await expired.load()
    expect(stale.status).toBe('stale')
    expect(stale.catalog).toBeNull()
    expect(stale.packages).toEqual([])
    expect(stale.refreshError?.message).toContain('expired')
  })

  test('surfaces publisher revocation and never exposes the revoked package', async () => {
    const data = await fixture(true)
    const client = createRemotePluginCatalogClient({
      catalogUrl: CATALOG_URL,
      expectedCatalogId: data.catalog.catalogId,
      expectedCatalogKeyId: data.catalog.integrity.signature.keyId,
      catalogPublicKey: data.catalogKeys.publicKey,
      publisherKeyring: data.publisherKeyring,
      engineVersion: '0.13.2',
      now: () => NOW,
      transport: {
        loadCatalog: async () => fresh(data.catalog, CATALOG_URL),
        loadManifest: async () => fresh(data.manifest, MANIFEST_URL)
      }
    })

    const result = await client.load()

    expect(result.status).toBe('fresh')
    expect(result.packages).toEqual([])
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.error).toMatchObject({ code: 'publisher-key-revoked' })
  })
})
