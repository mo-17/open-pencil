import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PluginTrustError,
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  authorizeTrustedPluginKeyTransition,
  parsePluginCatalogBytes,
  parsePluginCatalogJSON,
  parsePluginCatalogPayload,
  parseTrustedPluginKeyring,
  resolveTrustedPluginKey,
  serializePluginCatalog,
  signPluginCatalog,
  signPluginManifest,
  signVersionedPluginManifest,
  traceTrustedPluginKeyTransition,
  validatePluginCatalog,
  verifyCatalogPluginPackage,
  verifyPluginCatalog,
  type PluginCatalogEntryV1,
  type PluginCatalogPayloadV1,
  type PluginManifest,
  type TrustedPluginKeyringV1,
  type TrustedPluginPublisherKeyV1
} from '@open-pencil/plugin-contracts'

import { pluginBackendProviderContribution, pluginPayload, pluginPayloadV2 } from './helpers'

const GENERATED_AT = '2026-08-05T00:00:00.000Z'
const EXPIRES_AT = '2026-08-10T00:00:00.000Z'
const NOW = '2026-08-06T00:00:00.000Z'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function catalogEntry(manifest: PluginManifest): PluginCatalogEntryV1 {
  return {
    pluginId: manifest.plugin.id,
    version: manifest.plugin.version,
    digest: manifest.integrity.digest,
    manifestUrl: `https://plugins.example.com/${manifest.plugin.id}/${manifest.plugin.version}/manifest.json`,
    publisherId: manifest.publisher.id,
    keyId: manifest.publisher.keyId
  }
}

function catalogPayload(entries: readonly PluginCatalogEntryV1[]): PluginCatalogPayloadV1 {
  return {
    format: PLUGIN_CATALOG_FORMAT,
    schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
    catalogId: 'openpencil.marketplace',
    version: '1.0.0',
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    entries
  }
}

function publisherKey(
  publicKey: CryptoKey,
  overrides: Partial<TrustedPluginPublisherKeyV1> = {}
): TrustedPluginPublisherKeyV1 {
  return {
    keyId: 'acme.release',
    publisherId: 'acme',
    pluginIds: ['acme.analytics'],
    publicKey,
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z',
    ...overrides
  }
}

function keyring(keys: readonly TrustedPluginPublisherKeyV1[]): TrustedPluginKeyringV1 {
  return { schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION, keys }
}

function expectTrustCode(error: unknown, code: PluginTrustError['code']): void {
  expect(error).toBeInstanceOf(PluginTrustError)
  expect((error as PluginTrustError).code).toBe(code)
}

async function expectRejectedTrust(
  promise: Promise<unknown>,
  code: PluginTrustError['code']
): Promise<void> {
  try {
    await promise
    throw new Error('Expected trust verification to fail')
  } catch (error) {
    expectTrustCode(error, code)
  }
}

describe('signed remote plugin catalog', () => {
  test('signs, serializes, verifies, and resolves a publisher-owned package', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const catalog = await signPluginCatalog(
      catalogPayload([catalogEntry(manifest)]),
      root.privateKey,
      {
        keyId: 'marketplace.root.2026'
      }
    )

    const serialized = serializePluginCatalog(catalog)
    expect(parsePluginCatalogJSON(serialized)).toEqual(catalog)
    expect(parsePluginCatalogBytes(new TextEncoder().encode(serialized))).toEqual(catalog)
    const verifiedCatalog = await verifyPluginCatalog(catalog, root.publicKey, {
      expectedCatalogId: 'openpencil.marketplace',
      expectedKeyId: 'marketplace.root.2026',
      now: NOW
    })
    expect(verifiedCatalog.verifiedDigest).toBe(catalog.integrity.digest)
    expect(verifiedCatalog.diagnostics).toEqual([])

    const verifiedPackage = await verifyCatalogPluginPackage(
      catalog.entries[0],
      manifest,
      keyring([publisherKey(publisher.publicKey)]),
      { catalog: verifiedCatalog, engineVersion: '0.13.2', now: NOW }
    )
    expect(verifiedPackage.verifiedPackage.verifiedDigest).toBe(manifest.integrity.digest)
    expect(verifiedPackage.keyTrust.rotationPath).toEqual(['acme.release'])
    expect(verifiedPackage.diagnostics).toEqual([])
  })

  test('verifies schema-v2 packages and fails closed for unknown manifest versions', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signVersionedPluginManifest(pluginPayloadV2(), publisher.privateKey)
    const catalog = await signPluginCatalog(
      catalogPayload([catalogEntry(manifest)]),
      root.privateKey
    )
    const verifiedCatalog = await verifyPluginCatalog(catalog, root.publicKey, { now: NOW })
    const trustedKeys = keyring([publisherKey(publisher.publicKey)])

    await expect(
      verifyCatalogPluginPackage(catalog.entries[0], manifest, trustedKeys, {
        catalog: verifiedCatalog,
        now: NOW
      })
    ).resolves.toMatchObject({ verifiedPackage: { manifest: { schemaVersion: 2 } } })

    await expect(
      verifyCatalogPluginPackage(
        catalog.entries[0],
        { ...manifest, schemaVersion: 3 },
        trustedKeys,
        { catalog: verifiedCatalog, now: NOW }
      )
    ).rejects.toThrow('schemaVersion')

    const providerPayload = pluginPayloadV2('2.0.1')
    providerPayload.contributions.backendProviders = [pluginBackendProviderContribution()]
    const providerManifest = await signVersionedPluginManifest(
      providerPayload,
      publisher.privateKey
    )
    const providerCatalog = await signPluginCatalog(
      catalogPayload([catalogEntry(providerManifest)]),
      root.privateKey
    )
    const verifiedProviderCatalog = await verifyPluginCatalog(providerCatalog, root.publicKey, {
      now: NOW
    })
    await expect(
      verifyCatalogPluginPackage(providerCatalog.entries[0], providerManifest, trustedKeys, {
        catalog: verifiedProviderCatalog,
        now: NOW
      })
    ).resolves.toMatchObject({
      verifiedPackage: {
        manifest: {
          schemaVersion: 2,
          contributions: { backendProviders: [expect.objectContaining({ providerId: 'supabase' })] }
        }
      }
    })

    const differentProviderPayload = pluginPayloadV2('2.0.1')
    differentProviderPayload.contributions.backendProviders = [
      { ...pluginBackendProviderContribution(), adapterId: 'open-pencil.backend.different' }
    ]
    const differentProviderManifest = await signVersionedPluginManifest(
      differentProviderPayload,
      publisher.privateKey
    )
    await expect(
      verifyCatalogPluginPackage(
        providerCatalog.entries[0],
        differentProviderManifest,
        trustedKeys,
        { catalog: verifiedProviderCatalog, now: NOW }
      )
    ).rejects.toMatchObject({ code: 'catalog-entry-mismatch' })
  })

  test('rejects untrusted roots, tampering, future catalogs, and expiration with stable codes', async () => {
    const root = await keys()
    const unrelated = await keys()
    const publisher = await keys()
    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const payload = catalogPayload([catalogEntry(manifest)])
    const catalog = await signPluginCatalog(payload, root.privateKey)

    await expectRejectedTrust(
      verifyPluginCatalog(catalog, root.publicKey, {
        expectedKeyId: 'other.root',
        now: NOW
      }),
      'catalog-key-untrusted'
    )
    await expectRejectedTrust(
      verifyPluginCatalog(catalog, unrelated.publicKey, { now: NOW }),
      'catalog-integrity-invalid'
    )

    const tampered = structuredClone(catalog)
    tampered.version = '1.0.1'
    await expectRejectedTrust(
      verifyPluginCatalog(tampered, root.publicKey, { now: NOW }),
      'catalog-integrity-invalid'
    )
    await expectRejectedTrust(
      verifyPluginCatalog(catalog, root.publicKey, {
        now: '2026-08-04T00:00:00.000Z'
      }),
      'catalog-not-yet-valid'
    )
    await expectRejectedTrust(
      verifyPluginCatalog(catalog, root.publicKey, { now: EXPIRES_AT }),
      'catalog-expired'
    )
    const expiring = await verifyPluginCatalog(catalog, root.publicKey, {
      now: '2026-08-09T20:00:00.000Z'
    })
    expect(expiring.diagnostics.map(({ code }) => code)).toEqual(['catalog-expiring-soon'])
  })

  test('enforces safe URLs, unique coordinates, publisher ownership, and version ordering', async () => {
    const publisher = await keys()
    const version1 = await signPluginManifest(pluginPayload('1.0.0'), publisher.privateKey)
    const version2 = await signPluginManifest(pluginPayload('2.0.0'), publisher.privateKey)
    const first = catalogEntry(version1)
    const second = catalogEntry(version2)

    expect(() => parsePluginCatalogPayload(catalogPayload([first, second]))).toThrow('sorted')
    expect(() => parsePluginCatalogPayload(catalogPayload([second, second]))).toThrow('duplicate')
    expect(() =>
      parsePluginCatalogPayload(
        catalogPayload([second, { ...first, manifestUrl: second.manifestUrl }])
      )
    ).toThrow('duplicate manifest URLs')
    expect(() =>
      parsePluginCatalogPayload(catalogPayload([second, { ...first, digest: second.digest }]))
    ).toThrow('duplicate manifest digests')
    expect(() =>
      parsePluginCatalogPayload(
        catalogPayload([second, { ...first, publisherId: 'hostile.publisher' }])
      )
    ).toThrow('publisher ownership')
    for (const manifestURL of [
      'http://plugins.example.com/manifest.json',
      'https://user:secret@plugins.example.com/manifest.json',
      'https://localhost/manifest.json',
      'https://127.0.0.1/manifest.json',
      'https://plugins.example.com/manifest.json#unsigned-fragment'
    ]) {
      expect(() =>
        parsePluginCatalogPayload(catalogPayload([{ ...first, manifestUrl: manifestURL }]))
      ).toThrow('canonical public HTTPS URL')
    }

    const malformed = { ...catalogPayload([first]), executable: 'https://evil.example/code.js' }
    expect(validatePluginCatalog(malformed).ok).toBe(false)
  })

  test('binds catalog coordinates and reports engine incompatibility separately from signatures', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const entry = catalogEntry(manifest)
    const trustedKeys = keyring([publisherKey(publisher.publicKey)])
    const signedCatalog = await signPluginCatalog(catalogPayload([entry]), root.privateKey)
    const verifiedCatalog = await verifyPluginCatalog(signedCatalog, root.publicKey, { now: NOW })

    await expectRejectedTrust(
      verifyCatalogPluginPackage({ ...entry, digest: 'A'.repeat(43) }, manifest, trustedKeys, {
        catalog: verifiedCatalog,
        now: NOW
      }),
      'catalog-entry-mismatch'
    )
    await expectRejectedTrust(
      verifyCatalogPluginPackage(entry, manifest, trustedKeys, {
        catalog: verifiedCatalog,
        engineVersion: '1.0.0',
        now: NOW
      }),
      'publisher-engine-incompatible'
    )

    const forbidden = structuredClone(manifest)
    forbidden.capabilities = ['network'] as never
    await expect(
      verifyCatalogPluginPackage(entry, forbidden, trustedKeys, {
        catalog: verifiedCatalog,
        now: NOW
      })
    ).rejects.toThrow('capabilities')

    await expectRejectedTrust(
      verifyCatalogPluginPackage(entry, manifest, trustedKeys, {
        catalog: structuredClone(verifiedCatalog),
        now: NOW
      }),
      'catalog-integrity-invalid'
    )
  })
})

describe('trusted publisher keyring', () => {
  test('enforces ownership and key validity windows', async () => {
    const publisher = await keys()
    const trustedKeys = keyring([publisherKey(publisher.publicKey)])
    expect(parseTrustedPluginKeyring(trustedKeys).keys).toHaveLength(1)
    expect(
      resolveTrustedPluginKey(trustedKeys, {
        pluginId: 'acme.analytics',
        publisherId: 'acme',
        keyId: 'acme.release',
        now: NOW
      }).key.publicKey
    ).toBe(publisher.publicKey)
    const expiring = resolveTrustedPluginKey(
      keyring([publisherKey(publisher.publicKey, { notAfter: '2026-08-10T00:00:00.000Z' })]),
      {
        pluginId: 'acme.analytics',
        publisherId: 'acme',
        keyId: 'acme.release',
        now: NOW
      }
    )
    expect(expiring.diagnostics.map(({ code }) => code)).toEqual(['publisher-key-expiring-soon'])

    expect(() =>
      parseTrustedPluginKeyring(keyring([publisherKey(publisher.publicKey, { pluginIds: [] })]))
    ).toThrow('at least one plugin id')
    expect(() =>
      parseTrustedPluginKeyring(
        keyring([
          publisherKey(publisher.publicKey, {
            pluginIds: ['acme.analytics', 'acme.analytics']
          })
        ])
      )
    ).toThrow('must not contain duplicate plugin ids')
    expect(() =>
      parseTrustedPluginKeyring(
        keyring([
          publisherKey(publisher.publicKey, {
            pluginIds: ['acme.zeta', 'acme.analytics']
          })
        ])
      )
    ).toThrow('must be sorted in ascending order')
    expect(() =>
      parseTrustedPluginKeyring(
        keyring([
          publisherKey(publisher.publicKey, {
            notAfter: '2026-01-01T00:00:00.000Z'
          })
        ])
      )
    ).toThrow('notAfter must be later than notBefore')

    expect(() =>
      resolveTrustedPluginKey(trustedKeys, {
        pluginId: 'acme.other',
        publisherId: 'acme',
        keyId: 'acme.release',
        now: NOW
      })
    ).toThrow(PluginTrustError)
    for (const [now, code] of [
      ['2025-12-31T23:59:59.999Z', 'publisher-key-not-yet-valid'],
      ['2027-01-01T00:00:00.000Z', 'publisher-key-expired']
    ] as const) {
      try {
        resolveTrustedPluginKey(trustedKeys, {
          pluginId: 'acme.analytics',
          publisherId: 'acme',
          keyId: 'acme.release',
          now
        })
        throw new Error('Expected key validation to fail')
      } catch (error) {
        expectTrustCode(error, code)
      }
    }
  })

  test('accepts explicit rotation chains while preserving revocation diagnostics', async () => {
    const oldPair = await keys()
    const newPair = await keys()
    const oldKey = publisherKey(oldPair.publicKey, {
      notBefore: '2025-01-01T00:00:00.000Z',
      revokedAt: '2026-07-01T00:00:00.000Z',
      revocationReason: 'Scheduled rotation'
    })
    const newKey = publisherKey(newPair.publicKey, {
      keyId: 'acme.release.2026',
      notBefore: '2026-06-01T00:00:00.000Z',
      predecessorKeyId: 'acme.release'
    })
    const resolved = resolveTrustedPluginKey(keyring([oldKey, newKey]), {
      pluginId: 'acme.analytics',
      publisherId: 'acme',
      keyId: 'acme.release.2026',
      now: NOW
    })
    expect(resolved.rotationPath).toEqual(['acme.release', 'acme.release.2026'])
    expect(resolved.diagnostics.map(({ code }) => code)).toContain(
      'publisher-key-predecessor-revoked'
    )

    const transition = {
      pluginId: 'acme.analytics',
      publisherId: 'acme',
      fromKeyId: 'acme.release',
      toKeyId: 'acme.release.2026',
      now: NOW
    }
    expect(traceTrustedPluginKeyTransition(keyring([oldKey, newKey]), transition)).toEqual([
      'acme.release',
      'acme.release.2026'
    ])
    const authorized = authorizeTrustedPluginKeyTransition(keyring([oldKey, newKey]), transition)
    expect(authorized.key.keyId).toBe('acme.release.2026')
    expect(authorized.rotationPath).toEqual(['acme.release', 'acme.release.2026'])
    expect(() =>
      traceTrustedPluginKeyTransition(keyring([oldKey, newKey]), {
        ...transition,
        fromKeyId: 'acme.unrelated'
      })
    ).toThrow('does not rotate')

    expect(() =>
      resolveTrustedPluginKey(keyring([oldKey]), {
        pluginId: 'acme.analytics',
        publisherId: 'acme',
        keyId: 'acme.release',
        now: NOW
      })
    ).toThrow('revoked')
    expect(() =>
      parseTrustedPluginKeyring(
        keyring([oldKey, { ...newKey, pluginIds: ['acme.analytics', 'acme.unowned'] }])
      )
    ).toThrow('broadens predecessor ownership')
  })
})
