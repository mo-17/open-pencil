import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_RUNTIME_COMPUTE_ABI,
  PLUGIN_RUNTIME_INDEX_FORMAT,
  PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
  PLUGIN_RUNTIME_PACKAGE_FORMAT,
  PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
  PluginRuntimeTrustError,
  TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
  createPluginRuntimeAsset,
  parsePluginRuntimeIndexBytes,
  parsePluginRuntimeIndexJSON,
  parsePluginRuntimeIndexPayload,
  pluginRuntimePackageCanonicalByteLength,
  serializePluginRuntimeIndex,
  signPluginManifest,
  signPluginRuntimeIndex,
  signPluginRuntimePackage,
  signVersionedPluginManifest,
  verifyIndexedPluginRuntimePackage,
  verifyPluginPackage,
  verifyPluginRuntimeIndex,
  verifyVersionedPluginPackage,
  type PluginRuntimeIndexEntryV1,
  type PluginRuntimeIndexPayloadV1,
  type PluginRuntimePackagePayloadV1,
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

function section(id: number, payload: number[]): number[] {
  return [id, payload.length, ...payload]
}

function text(value: string): number[] {
  const bytes = [...new TextEncoder().encode(value)]
  return [bytes.length, ...bytes]
}

function safeWasm(): Uint8Array {
  const exports = [
    [...text('memory'), 2, 0],
    [...text('openpencil_alloc'), 0, 0],
    [...text('openpencil_dealloc'), 0, 1],
    [...text('openpencil_compute'), 0, 2]
  ]
  const bodies = [
    [0, 0x20, 0, 0x0b],
    [0, 0x0b],
    [0, 0x41, 0, 0x0b]
  ]
  return new Uint8Array([
    0,
    0x61,
    0x73,
    0x6d,
    1,
    0,
    0,
    0,
    ...section(
      1,
      [3, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 0, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f]
    ),
    ...section(3, [3, 0, 1, 2]),
    ...section(5, [1, 1, 1, 4]),
    ...section(7, [exports.length, ...exports.flat()]),
    ...section(10, [bodies.length, ...bodies.flatMap((body) => [body.length, ...body])])
  ])
}

function publisherKey(publicKey: CryptoKey): TrustedPluginPublisherKeyV1 {
  return {
    keyId: 'acme.release',
    publisherId: 'acme',
    pluginIds: ['acme.analytics'],
    publicKey,
    notBefore: '2026-01-01T00:00:00.000Z',
    notAfter: '2027-01-01T00:00:00.000Z'
  }
}

function keyring(publicKey: CryptoKey): TrustedPluginKeyringV1 {
  return {
    schemaVersion: TRUSTED_PLUGIN_KEYRING_SCHEMA_VERSION,
    keys: [publisherKey(publicKey)]
  }
}

async function runtimePackagePayload(
  declarativeDigest: string,
  version = '1.0.0'
): Promise<PluginRuntimePackagePayloadV1> {
  return {
    format: PLUGIN_RUNTIME_PACKAGE_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_PACKAGE_SCHEMA_VERSION,
    plugin: { id: 'acme.analytics', version },
    publisher: { id: 'acme', keyId: 'acme.release' },
    declarativeManifestDigest: declarativeDigest,
    runtime: {
      kind: 'wasm',
      abi: PLUGIN_RUNTIME_COMPUTE_ABI,
      capabilities: [],
      limits: {
        timeoutMs: 2_000,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: 256 * 1024,
        maxMemoryPages: 4
      },
      asset: await createPluginRuntimeAsset('wasm', safeWasm())
    }
  }
}

function indexEntry(
  declarativeDigest: string,
  runtimePackage: Awaited<ReturnType<typeof signPluginRuntimePackage>>,
  version = '1.0.0'
): PluginRuntimeIndexEntryV1 {
  return {
    pluginId: 'acme.analytics',
    version,
    publisherId: 'acme',
    keyId: 'acme.release',
    declarativeManifestDigest: declarativeDigest,
    runtimeKind: 'wasm',
    runtimePackageUrl: `https://plugins.example.com/acme.analytics/${version}/runtime.json`,
    runtimePackageDigest: runtimePackage.integrity.digest,
    runtimePackageByteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage)
  }
}

function indexPayload(entries: readonly PluginRuntimeIndexEntryV1[]): PluginRuntimeIndexPayloadV1 {
  return {
    format: PLUGIN_RUNTIME_INDEX_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
    indexId: 'openpencil.marketplace.runtime',
    version: '1.0.0',
    generatedAt: GENERATED_AT,
    expiresAt: EXPIRES_AT,
    entries
  }
}

async function expectRuntimeTrustCode(
  promise: Promise<unknown>,
  code: PluginRuntimeTrustError['code']
): Promise<void> {
  try {
    await promise
    throw new Error('Expected runtime trust verification to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(PluginRuntimeTrustError)
    expect((error as PluginRuntimeTrustError).code).toBe(code)
  }
}

describe('root-signed executable plugin index', () => {
  test('double-binds an indexed publisher runtime to the accepted declarative package', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const declarativePackage = await verifyPluginPackage(manifest, publisher.publicKey)
    const runtimePackage = await signPluginRuntimePackage(
      await runtimePackagePayload(declarativePackage.verifiedDigest),
      publisher.privateKey
    )
    const entry = indexEntry(declarativePackage.verifiedDigest, runtimePackage)
    const index = await signPluginRuntimeIndex(indexPayload([entry]), root.privateKey, {
      keyId: 'marketplace.root.2026'
    })
    const serialized = serializePluginRuntimeIndex(index)
    expect(parsePluginRuntimeIndexJSON(serialized)).toEqual(index)
    expect(parsePluginRuntimeIndexBytes(new TextEncoder().encode(serialized))).toEqual(index)
    const verifiedIndex = await verifyPluginRuntimeIndex(JSON.parse(serialized), root.publicKey, {
      expectedIndexId: 'openpencil.marketplace.runtime',
      expectedKeyId: 'marketplace.root.2026',
      expectedDigest: index.integrity.digest,
      now: NOW
    })
    const verified = await verifyIndexedPluginRuntimePackage(
      entry,
      runtimePackage,
      keyring(publisher.publicKey),
      { index: verifiedIndex, declarativePackage, now: NOW }
    )

    expect(verified.indexDigest).toBe(index.integrity.digest)
    expect(verified.verifiedRuntimePackage.executionStatus).toBe('eligible')
    expect(verified.verifiedRuntimePackage.verifiedDigest).toBe(entry.runtimePackageDigest)
    expect(verified.keyTrust.rotationPath).toEqual(['acme.release'])
  })

  test('double-binds schema-v2 declarative packages and rejects a valid but different digest', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signVersionedPluginManifest(
      pluginPayloadV2('2.0.0'),
      publisher.privateKey
    )
    const declarativePackage = await verifyVersionedPluginPackage(manifest, publisher.publicKey)
    const runtimePackage = await signPluginRuntimePackage(
      await runtimePackagePayload(declarativePackage.verifiedDigest, '2.0.0'),
      publisher.privateKey
    )
    const entry = indexEntry(declarativePackage.verifiedDigest, runtimePackage, '2.0.0')
    const index = await signPluginRuntimeIndex(indexPayload([entry]), root.privateKey)
    const verifiedIndex = await verifyPluginRuntimeIndex(index, root.publicKey, { now: NOW })

    await expect(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage,
        now: NOW
      })
    ).resolves.toMatchObject({ declarativePackage: { manifest: { schemaVersion: 2 } } })

    const differentPayload = pluginPayloadV2('2.0.0')
    differentPayload.plugin.name = 'Different signed package'
    const differentManifest = await signVersionedPluginManifest(
      differentPayload,
      publisher.privateKey
    )
    const differentPackage = await verifyVersionedPluginPackage(
      differentManifest,
      publisher.publicKey
    )
    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage: differentPackage,
        now: NOW
      }),
      'runtime-declarative-package-mismatch'
    )
  })

  test('double-binds a backend-provider declaration and rejects adapter substitution', async () => {
    const root = await keys()
    const publisher = await keys()
    const providerPayload = pluginPayloadV2('2.0.0')
    providerPayload.contributions.backendProviders = [pluginBackendProviderContribution()]
    const manifest = await signVersionedPluginManifest(providerPayload, publisher.privateKey)
    const declarativePackage = await verifyVersionedPluginPackage(manifest, publisher.publicKey)
    const runtimePackage = await signPluginRuntimePackage(
      await runtimePackagePayload(declarativePackage.verifiedDigest, '2.0.0'),
      publisher.privateKey
    )
    const entry = indexEntry(declarativePackage.verifiedDigest, runtimePackage, '2.0.0')
    const index = await signPluginRuntimeIndex(indexPayload([entry]), root.privateKey)
    const verifiedIndex = await verifyPluginRuntimeIndex(index, root.publicKey, { now: NOW })

    await expect(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage,
        now: NOW
      })
    ).resolves.toMatchObject({
      declarativePackage: {
        manifest: {
          contributions: {
            backendProviders: [expect.objectContaining({ providerId: 'supabase' })]
          }
        }
      }
    })

    const differentPayload = pluginPayloadV2('2.0.0')
    differentPayload.contributions.backendProviders = [
      { ...pluginBackendProviderContribution(), adapterId: 'open-pencil.backend.different' }
    ]
    const differentManifest = await signVersionedPluginManifest(
      differentPayload,
      publisher.privateKey
    )
    const differentPackage = await verifyVersionedPluginPackage(
      differentManifest,
      publisher.publicKey
    )
    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage: differentPackage,
        now: NOW
      }),
      'runtime-declarative-package-mismatch'
    )
  })

  test('rejects wrong root coordinates, tampering, future indexes, and expiration', async () => {
    const root = await keys()
    const index = await signPluginRuntimeIndex(indexPayload([]), root.privateKey, {
      keyId: 'marketplace.root.2026'
    })
    await expectRuntimeTrustCode(
      verifyPluginRuntimeIndex(index, root.publicKey, {
        expectedIndexId: 'other.runtime',
        now: NOW
      }),
      'runtime-index-id-mismatch'
    )
    await expectRuntimeTrustCode(
      verifyPluginRuntimeIndex(index, root.publicKey, {
        expectedDigest: 'A'.repeat(43),
        now: NOW
      }),
      'runtime-index-coordinate-mismatch'
    )
    const tampered = structuredClone(index)
    tampered.version = '1.0.1'
    await expectRuntimeTrustCode(
      verifyPluginRuntimeIndex(tampered, root.publicKey, { now: NOW }),
      'runtime-index-integrity-invalid'
    )
    await expectRuntimeTrustCode(
      verifyPluginRuntimeIndex(index, root.publicKey, { now: '2026-08-04T00:00:00.000Z' }),
      'runtime-index-not-yet-valid'
    )
    await expectRuntimeTrustCode(
      verifyPluginRuntimeIndex(index, root.publicKey, { now: EXPIRES_AT }),
      'runtime-index-expired'
    )
  })

  test('fails closed for forged verification brands and coordinate substitution', async () => {
    const root = await keys()
    const publisher = await keys()
    const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
    const declarativePackage = await verifyPluginPackage(manifest, publisher.publicKey)
    const runtimePackage = await signPluginRuntimePackage(
      await runtimePackagePayload(declarativePackage.verifiedDigest),
      publisher.privateKey
    )
    const entry = indexEntry(declarativePackage.verifiedDigest, runtimePackage)
    const index = await signPluginRuntimeIndex(indexPayload([entry]), root.privateKey)
    const verifiedIndex = await verifyPluginRuntimeIndex(index, root.publicKey, { now: NOW })

    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: structuredClone(verifiedIndex),
        declarativePackage,
        now: NOW
      }),
      'runtime-index-integrity-invalid'
    )
    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(
        { ...entry, runtimePackageByteLength: entry.runtimePackageByteLength + 1 },
        runtimePackage,
        keyring(publisher.publicKey),
        { index: verifiedIndex, declarativePackage, now: NOW }
      ),
      'runtime-index-entry-mismatch'
    )
    const otherManifest = await signPluginManifest(pluginPayload('2.0.0'), publisher.privateKey)
    const otherDeclarative = await verifyPluginPackage(otherManifest, publisher.publicKey)
    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage: otherDeclarative,
        now: NOW
      }),
      'runtime-declarative-package-mismatch'
    )
    const tamperedDeclarative = structuredClone(declarativePackage)
    tamperedDeclarative.manifest.plugin.name = 'Tampered after verification'
    await expectRuntimeTrustCode(
      verifyIndexedPluginRuntimePackage(entry, runtimePackage, keyring(publisher.publicKey), {
        index: verifiedIndex,
        declarativePackage: tamperedDeclarative,
        now: NOW
      }),
      'runtime-declarative-package-mismatch'
    )
  })

  test('enforces safe unique sorted index entries', async () => {
    const publisher = await keys()
    const firstManifest = await signPluginManifest(pluginPayload('1.0.0'), publisher.privateKey)
    const secondManifest = await signPluginManifest(pluginPayload('2.0.0'), publisher.privateKey)
    const firstRuntime = await signPluginRuntimePackage(
      await runtimePackagePayload(firstManifest.integrity.digest),
      publisher.privateKey
    )
    const secondPayload = await runtimePackagePayload(secondManifest.integrity.digest)
    secondPayload.plugin.version = '2.0.0'
    const secondRuntime = await signPluginRuntimePackage(secondPayload, publisher.privateKey)
    const first = indexEntry(firstManifest.integrity.digest, firstRuntime)
    const second = {
      ...indexEntry(secondManifest.integrity.digest, secondRuntime),
      version: '2.0.0',
      runtimePackageUrl: 'https://plugins.example.com/acme.analytics/2.0.0/runtime.json'
    }

    expect(() => parsePluginRuntimeIndexPayload(indexPayload([first, second]))).toThrow('sorted')
    expect(() => parsePluginRuntimeIndexPayload(indexPayload([second, second]))).toThrow(
      'duplicate plugin versions'
    )
    expect(() =>
      parsePluginRuntimeIndexPayload(
        indexPayload([{ ...first, runtimePackageUrl: 'http://plugins.example.com/runtime.json' }])
      )
    ).toThrow('canonical public HTTPS URL')
    expect(() =>
      parsePluginRuntimeIndexPayload(indexPayload([{ ...first, executable: true } as never]))
    ).toThrow('unsupported fields')
  })
})
