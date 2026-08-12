import { describe, expect, test } from 'bun:test'

import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  MarketplaceSnapshotTrustError,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  assertMarketplaceSnapshotAdvance,
  createMarketplacePublisherKeyring,
  parseMarketplaceSnapshotBytes,
  parseMarketplaceSnapshotJSON,
  parseMarketplaceSnapshotPayload,
  resolveTrustedPluginKey,
  searchMarketplaceListings,
  serializeMarketplaceSnapshot,
  signMarketplaceSnapshot,
  signPluginCatalog,
  signPluginManifest,
  validateMarketplaceSnapshot,
  verifyMarketplaceCatalog,
  verifyMarketplaceSnapshot,
  type MarketplaceSnapshotPayloadV1,
  type PluginCatalogPayloadV1,
  type PluginManifestV1
} from '@open-pencil/core/plugins'
import { digestCanonicalManifest, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from './helpers'

const GENERATED_AT = '2026-08-05T00:00:00.000Z'
const EXPIRES_AT = '2026-08-10T00:00:00.000Z'
const NOW = '2026-08-06T00:00:00.000Z'
const ROOT_KEY_ID = 'marketplace.root.2026'

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

async function signedCatalog(
  root: CryptoKeyPair,
  manifest: PluginManifestV1,
  catalogId = 'openpencil.marketplace.stable'
) {
  const payload: PluginCatalogPayloadV1 = {
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId,
    version: '1.0.0',
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    entries: [
      {
        pluginId: manifest.plugin.id,
        version: manifest.plugin.version,
        digest: manifest.integrity.digest,
        manifestUrl: `https://plugins.example.com/manifests/${manifest.integrity.digest}.json`,
        publisherId: manifest.publisher.id,
        keyId: manifest.publisher.keyId
      }
    ]
  }
  return signPluginCatalog(payload, root.privateKey, { keyId: ROOT_KEY_ID })
}

async function fixture(options: { runtimeIndex?: boolean } = {}) {
  const root = await keyPair()
  const publisher = await keyPair()
  const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
  const catalog = await signedCatalog(root, manifest)
  const payload: MarketplaceSnapshotPayloadV1 = {
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: 'openpencil.marketplace',
    version: '1.0.0',
    sequence: 7,
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
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
              notBefore: '2026-01-01T00:00:00.000Z',
              notAfter: '2027-01-01T00:00:00.000Z'
            }
          ]
        }
      ],
      ownerships: [
        {
          pluginId: 'acme.analytics',
          publisherId: 'acme',
          status: 'active',
          grantedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    },
    catalogs: [
      {
        channel: 'stable',
        catalogId: catalog.catalogId,
        keyId: ROOT_KEY_ID,
        url: 'https://plugins.example.com/catalogs/stable.json',
        digest: catalog.integrity.digest
      }
    ],
    listings: [
      {
        pluginId: 'acme.analytics',
        publisherId: 'acme',
        name: 'Acme Analytics',
        summary: 'Reviewed charts and analytics modules',
        categories: ['data', 'visualization'],
        keywords: ['analytics', 'chart'],
        releases: [
          { channel: 'stable', version: manifest.plugin.version, digest: manifest.integrity.digest }
        ]
      }
    ],
    auditHead: {
      sequence: 42,
      headDigest: await digestCanonicalManifest({ event: 42 }),
      url: 'https://plugins.example.com/audit/events.json'
    },
    ...(options.runtimeIndex
      ? {
          runtimeIndex: {
            url: 'https://plugins.example.com/runtime/index.json',
            indexId: 'openpencil.marketplace.runtime',
            keyId: ROOT_KEY_ID,
            digest: await digestCanonicalManifest({ runtime: 1 })
          }
        }
      : {})
  }
  const snapshot = await signMarketplaceSnapshot(payload, root.privateKey, { keyId: ROOT_KEY_ID })
  return { root, publisher, manifest, catalog, payload, snapshot }
}

function trustCode(error: unknown): string | undefined {
  return error instanceof MarketplaceSnapshotTrustError ? error.code : undefined
}

async function expectTrustRejection(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    throw new Error('Expected marketplace verification to fail')
  } catch (error) {
    expect(trustCode(error)).toBe(code)
  }
}

describe('root-signed marketplace snapshot', () => {
  test('round-trips, verifies the dynamic publisher directory, and binds its catalog', async () => {
    const data = await fixture({ runtimeIndex: true })
    const serialized = serializeMarketplaceSnapshot(data.snapshot)
    expect(parseMarketplaceSnapshotJSON(serialized)).toEqual(data.snapshot)
    expect(parseMarketplaceSnapshotBytes(new TextEncoder().encode(serialized))).toEqual(
      data.snapshot
    )
    expect(validateMarketplaceSnapshot(data.snapshot)).toEqual({ ok: true, value: data.snapshot })

    const verified = await verifyMarketplaceSnapshot(data.snapshot, data.root.publicKey, {
      expectedMarketplaceId: 'openpencil.marketplace',
      expectedKeyId: ROOT_KEY_ID,
      now: NOW
    })
    expect(verified.verifiedDigest).toBe(data.snapshot.integrity.digest)
    expect(verified.snapshot.runtimeIndex).toMatchObject({
      indexId: 'openpencil.marketplace.runtime',
      keyId: ROOT_KEY_ID
    })
    expect(
      resolveTrustedPluginKey(verified.publisherKeyring, {
        pluginId: data.manifest.plugin.id,
        publisherId: data.manifest.publisher.id,
        keyId: data.manifest.publisher.keyId,
        now: NOW
      }).key.publicKey.type
    ).toBe('public')

    const bound = await verifyMarketplaceCatalog(data.catalog, {
      snapshot: verified,
      channel: 'stable',
      now: NOW
    })
    expect(bound.reference.digest).toBe(bound.catalog.verifiedDigest)
    expect(
      searchMarketplaceListings(verified, { query: 'chart' }).map(({ pluginId }) => pluginId)
    ).toEqual(['acme.analytics'])
  })

  test('rejects tampering, wrong roots, expired snapshots, and cloned verification claims', async () => {
    const data = await fixture()
    const tampered = structuredClone(data.snapshot)
    tampered.listings[0].summary = 'Tampered metadata'
    await expectTrustRejection(
      verifyMarketplaceSnapshot(tampered, data.root.publicKey, { now: NOW }),
      'marketplace-integrity-invalid'
    )

    const unrelated = await keyPair()
    await expectTrustRejection(
      verifyMarketplaceSnapshot(data.snapshot, unrelated.publicKey, { now: NOW }),
      'marketplace-integrity-invalid'
    )
    await expectTrustRejection(
      verifyMarketplaceSnapshot(data.snapshot, data.root.publicKey, { now: EXPIRES_AT }),
      'marketplace-expired'
    )

    const verified = await verifyMarketplaceSnapshot(data.snapshot, data.root.publicKey, {
      now: NOW
    })
    expect(() => searchMarketplaceListings(structuredClone(verified))).toThrow(
      'must be verified in this process'
    )
  })

  test('fails closed when a valid catalog differs from the root-bound digest', async () => {
    const data = await fixture()
    const differentCatalogPayload = structuredClone(data.catalog)
    differentCatalogPayload.version = '1.0.1'
    Reflect.deleteProperty(differentCatalogPayload, 'integrity')
    const differentCatalog = await signPluginCatalog(
      differentCatalogPayload,
      data.root.privateKey,
      { keyId: ROOT_KEY_ID }
    )
    const verified = await verifyMarketplaceSnapshot(data.snapshot, data.root.publicKey, {
      now: NOW
    })
    await expectTrustRejection(
      verifyMarketplaceCatalog(differentCatalog, {
        snapshot: verified,
        channel: 'stable',
        now: NOW
      }),
      'marketplace-catalog-mismatch'
    )
  })

  test('requires every searchable release to match a currently trusted catalog coordinate', async () => {
    const data = await fixture()
    const payload = structuredClone(data.payload)
    payload.listings[0].releases[0].version = '2.0.0'
    payload.listings[0].releases[0].digest = await digestCanonicalManifest({ missing: true })
    const snapshot = await signMarketplaceSnapshot(payload, data.root.privateKey, {
      keyId: ROOT_KEY_ID
    })
    const verified = await verifyMarketplaceSnapshot(snapshot, data.root.publicKey, { now: NOW })
    await expectTrustRejection(
      verifyMarketplaceCatalog(data.catalog, { snapshot: verified, channel: 'stable', now: NOW }),
      'marketplace-catalog-mismatch'
    )
  })

  test('detects snapshot rollback and same-sequence audit-head rewrites', async () => {
    const data = await fixture()
    const previous = await verifyMarketplaceSnapshot(data.snapshot, data.root.publicKey, {
      now: NOW
    })
    const advancedPayload = structuredClone(data.payload)
    advancedPayload.sequence = 8
    advancedPayload.version = '1.0.1'
    const advancedSnapshot = await signMarketplaceSnapshot(advancedPayload, data.root.privateKey, {
      keyId: ROOT_KEY_ID
    })
    const advanced = await verifyMarketplaceSnapshot(advancedSnapshot, data.root.publicKey, {
      now: NOW
    })
    expect(assertMarketplaceSnapshotAdvance(previous, advanced)).toBe(advanced)
    expect(() => assertMarketplaceSnapshotAdvance(advanced, previous)).toThrow(
      'advance sequence and version'
    )

    const rewrittenPayload = structuredClone(advancedPayload)
    rewrittenPayload.sequence = 9
    rewrittenPayload.version = '1.0.2'
    rewrittenPayload.auditHead.headDigest = await digestCanonicalManifest({ rewritten: true })
    const rewritten = await verifyMarketplaceSnapshot(
      await signMarketplaceSnapshot(rewrittenPayload, data.root.privateKey, {
        keyId: ROOT_KEY_ID
      }),
      data.root.publicKey,
      { now: NOW }
    )
    expect(() => assertMarketplaceSnapshotAdvance(advanced, rewritten)).toThrow(
      'append-only audit head'
    )
  })
})

describe('marketplace snapshot schema', () => {
  test('enforces exact fields, public HTTPS coordinates, canonical order, and active ownership', async () => {
    const data = await fixture()
    const extra = { ...data.payload, executable: 'https://evil.example/code.js' }
    expect(() => parseMarketplaceSnapshotPayload(extra)).toThrow('unsupported fields')

    const insecure = structuredClone(data.payload)
    insecure.catalogs[0].url = 'http://plugins.example.com/stable.json'
    expect(() => parseMarketplaceSnapshotPayload(insecure)).toThrow('public HTTPS')

    const unsorted = structuredClone(data.payload)
    unsorted.listings[0].categories = ['visualization', 'data']
    expect(() => parseMarketplaceSnapshotPayload(unsorted)).toThrow('sorted')

    const suspended = structuredClone(data.payload)
    suspended.publisherDirectory.publishers[0].status = 'suspended'
    expect(() => parseMarketplaceSnapshotPayload(suspended)).toThrow('active publisher')

    const unowned = structuredClone(data.payload)
    unowned.publisherDirectory.ownerships[0].publisherId = 'unknown'
    expect(() => parseMarketplaceSnapshotPayload(unowned)).toThrow('unknown publisher')
  })
})

describe('marketplace publisher directory', () => {
  test('imports rotation and revocation into the existing trusted keyring contract', async () => {
    const oldKey = await keyPair()
    const newKey = await keyPair()
    const directory = {
      publishers: [
        {
          publisherId: 'acme',
          name: 'Acme',
          status: 'active',
          keys: [
            {
              keyId: 'acme.release.2025',
              publicKeyPem: await exportEd25519PublicKeyPem(oldKey.publicKey),
              notBefore: '2025-01-01T00:00:00.000Z',
              notAfter: '2027-01-01T00:00:00.000Z',
              revokedAt: '2026-07-01T00:00:00.000Z',
              revocationReason: 'Rotated after a publisher security review'
            },
            {
              keyId: 'acme.release.2026',
              publicKeyPem: await exportEd25519PublicKeyPem(newKey.publicKey),
              notBefore: '2026-06-01T00:00:00.000Z',
              notAfter: '2027-06-01T00:00:00.000Z',
              predecessorKeyId: 'acme.release.2025'
            }
          ]
        }
      ],
      ownerships: [
        {
          pluginId: 'acme.analytics',
          publisherId: 'acme',
          status: 'active',
          grantedAt: '2025-01-01T00:00:00.000Z'
        }
      ]
    }
    const keyring = await createMarketplacePublisherKeyring(directory)
    const resolution = resolveTrustedPluginKey(keyring, {
      pluginId: 'acme.analytics',
      publisherId: 'acme',
      keyId: 'acme.release.2026',
      now: NOW
    })
    expect(resolution.rotationPath).toEqual(['acme.release.2025', 'acme.release.2026'])
    expect(resolution.diagnostics.map(({ code }) => code)).toContain(
      'publisher-key-predecessor-revoked'
    )
    expect(() =>
      resolveTrustedPluginKey(keyring, {
        pluginId: 'acme.analytics',
        publisherId: 'acme',
        keyId: 'acme.release.2025',
        now: NOW
      })
    ).toThrow('revoked')

    const invalid = structuredClone(directory)
    invalid.publishers[0].keys[1].predecessorKeyId = 'acme.unknown'
    await expect(createMarketplacePublisherKeyring(invalid)).rejects.toThrow('unknown predecessor')

    const invalidValidityWindow = structuredClone(directory)
    invalidValidityWindow.publishers[0].keys[1].notAfter = '2026-06-01T00:00:00.000Z'
    await expect(createMarketplacePublisherKeyring(invalidValidityWindow)).rejects.toThrow(
      'notAfter must be later than notBefore'
    )

    const reusedMaterial = structuredClone(directory)
    reusedMaterial.publishers[0].keys[1].publicKeyPem =
      reusedMaterial.publishers[0].keys[0].publicKeyPem
    await expect(createMarketplacePublisherKeyring(reusedMaterial)).rejects.toThrow(
      'public keys must be unique'
    )
  })
})
