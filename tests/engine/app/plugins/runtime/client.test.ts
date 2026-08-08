import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_INDEX_FORMAT,
  PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  pluginRuntimePackageCanonicalByteLength,
  signMarketplaceSnapshot,
  signPluginManifest,
  signPluginRuntimeIndex,
  signPluginRuntimePackage,
  verifyMarketplaceSnapshot,
  verifyPluginPackage,
  type MarketplaceSnapshotPayloadV1,
  type PluginRuntimeIndexPayloadV1,
  type PluginRuntimePackagePayloadV1
} from '@open-pencil/core/plugins'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { createMemoryRemotePluginCacheStorage, createPluginRuntimeClient } from '@/app/plugins'

import { pluginPayload } from '#tests/engine/plugins/helpers'

const NOW = Date.parse('2026-08-05T00:00:00.000Z')
const INDEX_URL = 'https://plugins.example.com/runtime/index.json'
const PACKAGE_URL = 'https://plugins.example.com/runtime/acme.analytics-1.0.0.json'
const ROOT_KEY_ID = 'marketplace.root.2026'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
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

async function fixture(
  options: {
    indexExpiresAt?: string
    marketplaceExpiresAt?: string
    publisherNotAfter?: string
  } = {}
) {
  const root = await keys()
  const publisher = await keys()
  const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
  const declarativePackage = await verifyPluginPackage(manifest, publisher.publicKey, {
    engineVersion: '0.13.2'
  })
  const runtimePayload: PluginRuntimePackagePayloadV1 = {
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: { id: manifest.plugin.id, version: manifest.plugin.version },
    publisher: { id: manifest.publisher.id, keyId: manifest.publisher.keyId },
    declarativeManifestDigest: declarativePackage.verifiedDigest,
    runtime: {
      kind: 'javascript',
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: [],
      limits: {
        timeoutMs: 2_000,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: 256 * 1024,
        maxMemoryPages: 4
      },
      asset: await createPluginRuntimeAsset(
        'javascript',
        new TextEncoder().encode('export function compute(input) { return input }\n')
      )
    }
  }
  const runtimePackage = await signPluginRuntimePackage(runtimePayload, publisher.privateKey)
  const indexPayload: PluginRuntimeIndexPayloadV1 = {
    format: PLUGIN_RUNTIME_INDEX_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
    indexId: 'openpencil.marketplace.runtime',
    version: '1.0.0',
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: options.indexExpiresAt ?? '2026-08-09T00:00:00.000Z',
    entries: [
      {
        pluginId: manifest.plugin.id,
        version: manifest.plugin.version,
        publisherId: manifest.publisher.id,
        keyId: manifest.publisher.keyId,
        declarativeManifestDigest: declarativePackage.verifiedDigest,
        runtimeKind: 'javascript',
        runtimePackageUrl: PACKAGE_URL,
        runtimePackageDigest: runtimePackage.integrity.digest,
        runtimePackageByteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage)
      }
    ]
  }
  const runtimeIndex = await signPluginRuntimeIndex(indexPayload, root.privateKey, {
    keyId: ROOT_KEY_ID
  })
  const marketplacePayload: MarketplaceSnapshotPayloadV1 = {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: 'openpencil.marketplace',
    version: '1.0.0',
    sequence: 1,
    generatedAt: '2026-08-04T00:00:00.000Z',
    expiresAt: options.marketplaceExpiresAt ?? '2026-08-09T00:00:00.000Z',
    publisherDirectory: {
      publishers: [
        {
          publisherId: 'acme',
          name: 'Acme',
          status: 'active',
          keys: [
            {
              keyId: 'acme.release',
              publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
              notBefore: '2026-08-01T00:00:00.000Z',
              notAfter: options.publisherNotAfter ?? '2027-08-01T00:00:00.000Z'
            }
          ]
        }
      ],
      ownerships: [
        {
          pluginId: 'acme.analytics',
          publisherId: 'acme',
          status: 'active',
          grantedAt: '2026-08-01T00:00:00.000Z'
        }
      ]
    },
    catalogs: [
      {
        channel: 'stable',
        catalogId: 'openpencil.marketplace.stable',
        keyId: ROOT_KEY_ID,
        url: 'https://plugins.example.com/catalogs/stable.json',
        digest: await digestCanonicalManifest({ catalog: 1 })
      }
    ],
    listings: [],
    auditHead: {
      sequence: 1,
      headDigest: await digestCanonicalManifest({ audit: 1 }),
      url: 'https://plugins.example.com/audit.json'
    },
    runtimeIndex: {
      url: INDEX_URL,
      indexId: runtimeIndex.indexId,
      keyId: ROOT_KEY_ID,
      digest: runtimeIndex.integrity.digest
    }
  }
  const marketplace = await verifyMarketplaceSnapshot(
    await signMarketplaceSnapshot(marketplacePayload, root.privateKey, { keyId: ROOT_KEY_ID }),
    root.publicKey,
    { now: NOW }
  )
  return {
    root,
    marketplace,
    marketplacePayload,
    declarativePackage,
    runtimeIndex,
    runtimePackage
  }
}

describe('remote plugin runtime client', () => {
  test('double-verifies root index, publisher package, declarative digest, and offline cache', async () => {
    const data = await fixture()
    const cache = createMemoryRemotePluginCacheStorage()
    const online = createPluginRuntimeClient({
      cache,
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => fresh(data.runtimeIndex, INDEX_URL),
        loadRuntimePackage: async () => fresh(data.runtimePackage, PACKAGE_URL)
      }
    })
    const loaded = await online.load({
      marketplace: data.marketplace,
      declarativePackage: data.declarativePackage
    })
    expect(loaded.source).toBe('network')
    expect(loaded.runtime.verifiedRuntimePackage).toMatchObject({
      executionStatus: 'runtime-unavailable',
      runtimePackage: {
        declarativeManifestDigest: data.declarativePackage.verifiedDigest,
        runtime: { kind: 'javascript' }
      }
    })
    expect(await cache.list()).toHaveLength(2)

    const offline = createPluginRuntimeClient({
      cache,
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => {
          throw new Error('offline')
        },
        loadRuntimePackage: async () => {
          throw new Error('offline')
        }
      }
    })
    const cached = await offline.load({
      marketplace: data.marketplace,
      declarativePackage: data.declarativePackage
    })
    expect(cached.source).toBe('cache')
    expect(cached.refreshError?.message).toBe('offline')
    const records = await cache.list()
    expect(records.find(({ kind }) => kind === 'runtime-index')?.expiresAt).toBe(
      Date.parse(data.marketplace.snapshot.expiresAt)
    )
    expect(records.find(({ kind }) => kind === 'runtime-package')?.expiresAt).toBe(
      Date.parse(data.marketplace.snapshot.expiresAt)
    )
  })

  test('rejects a runtime package that no longer matches its signed index digest', async () => {
    const data = await fixture()
    const tampered = structuredClone(data.runtimePackage)
    tampered.runtime.asset.data = `${tampered.runtime.asset.data}A`
    const client = createPluginRuntimeClient({
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => fresh(data.runtimeIndex, INDEX_URL),
        loadRuntimePackage: async () => fresh(tampered, PACKAGE_URL)
      }
    })
    await expect(
      client.load({
        marketplace: data.marketplace,
        declarativePackage: data.declarativePackage
      })
    ).rejects.toThrow()
  })

  test('requires the exact marketplace snapshot verified in this process', async () => {
    const data = await fixture()
    let transportCalls = 0
    const client = createPluginRuntimeClient({
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => {
          transportCalls += 1
          return fresh(data.runtimeIndex, INDEX_URL)
        },
        loadRuntimePackage: async () => {
          transportCalls += 1
          return fresh(data.runtimePackage, PACKAGE_URL)
        }
      }
    })

    await expect(
      client.load({
        marketplace: structuredClone(data.marketplace),
        declarativePackage: data.declarativePackage
      })
    ).rejects.toThrow('verified in this process')
    expect(transportCalls).toBe(0)
  })

  test('rejects a branded marketplace snapshot after its validity window', async () => {
    const data = await fixture()
    let transportCalls = 0
    const client = createPluginRuntimeClient({
      now: () => Date.parse(data.marketplace.snapshot.expiresAt),
      transport: {
        loadRuntimeIndex: async () => {
          transportCalls += 1
          return fresh(data.runtimeIndex, INDEX_URL)
        },
        loadRuntimePackage: async () => {
          transportCalls += 1
          return fresh(data.runtimePackage, PACKAGE_URL)
        }
      }
    })

    await expect(
      client.load({
        marketplace: data.marketplace,
        declarativePackage: data.declarativePackage
      })
    ).rejects.toMatchObject({ code: 'marketplace-expired' })
    expect(transportCalls).toBe(0)
  })

  test('rejects a runtime index whose validity exceeds its root snapshot', async () => {
    const data = await fixture({ indexExpiresAt: '2026-08-10T00:00:00.000Z' })
    const client = createPluginRuntimeClient({
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => fresh(data.runtimeIndex, INDEX_URL),
        loadRuntimePackage: async () => fresh(data.runtimePackage, PACKAGE_URL)
      }
    })

    await expect(
      client.load({
        marketplace: data.marketplace,
        declarativePackage: data.declarativePackage
      })
    ).rejects.toMatchObject({ code: 'marketplace-subordinate-validity-invalid' })
  })

  test('applies a replacement snapshot publisher revocation to verified cached runtimes', async () => {
    const data = await fixture()
    const cache = createMemoryRemotePluginCacheStorage()
    const online = createPluginRuntimeClient({
      cache,
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => fresh(data.runtimeIndex, INDEX_URL),
        loadRuntimePackage: async () => fresh(data.runtimePackage, PACKAGE_URL)
      }
    })
    await online.load({
      marketplace: data.marketplace,
      declarativePackage: data.declarativePackage
    })

    const replacementPayload = structuredClone(data.marketplacePayload)
    replacementPayload.sequence = 2
    replacementPayload.version = '1.0.1'
    replacementPayload.auditHead.sequence = 2
    replacementPayload.auditHead.headDigest = await digestCanonicalManifest({ audit: 2 })
    replacementPayload.publisherDirectory.publishers[0].keys[0].revokedAt =
      '2026-08-05T00:00:00.000Z'
    replacementPayload.publisherDirectory.publishers[0].keys[0].revocationReason =
      'Publisher key was rotated after compromise'
    const replacement = await verifyMarketplaceSnapshot(
      await signMarketplaceSnapshot(replacementPayload, data.root.privateKey, {
        keyId: ROOT_KEY_ID
      }),
      data.root.publicKey,
      { now: NOW }
    )
    const offline = createPluginRuntimeClient({
      cache,
      now: () => NOW,
      transport: {
        loadRuntimeIndex: async () => {
          throw new Error('offline')
        },
        loadRuntimePackage: async () => {
          throw new Error('offline')
        }
      }
    })

    await expect(
      offline.load({
        marketplace: replacement,
        declarativePackage: data.declarativePackage
      })
    ).rejects.toThrow('Runtime network and cache verification failed')
  })
})
