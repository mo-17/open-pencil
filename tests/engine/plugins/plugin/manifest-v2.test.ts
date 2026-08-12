import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_MANIFEST_SCHEMA_VERSION_V2,
  PLUGIN_MANIFEST_LIMITS,
  parsePluginManifestPayload,
  parseVersionedPluginPackageBytes,
  parseVersionedPluginPackageJSON,
  parseVersionedPluginManifestPayload,
  parseVerifiedPluginPackageSnapshot,
  serializeVersionedPluginManifest,
  signVersionedPluginManifest,
  validateVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifestPayloadV2
} from '@open-pencil/core/plugins'

import {
  pluginConnectorContract,
  pluginPayload,
  pluginPayloadV2,
  pluginStorageProviderContribution
} from '../helpers'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function firstCommand(payload: PluginManifestPayloadV2) {
  const command = payload.contributions.commands?.[0]
  if (!command) throw new Error('Expected command fixture')
  return command
}

function firstExporter(payload: PluginManifestPayloadV2) {
  const exporter = payload.contributions.exporters?.[0]
  if (!exporter) throw new Error('Expected exporter fixture')
  return exporter
}

function firstOutput(payload: PluginManifestPayloadV2) {
  const output = firstExporter(payload).outputs[0]
  if (!output) throw new Error('Expected exporter output fixture')
  return output
}

describe('plugin manifest schema version 2', () => {
  test('parses a strict versioned payload without changing the v1 parser boundary', () => {
    const payload = pluginPayloadV2()
    expect(parseVersionedPluginManifestPayload(payload)).toEqual(payload)
    expect(() => parsePluginManifestPayload(payload)).toThrow('schemaVersion')
  })

  test('binds connector contracts to the signed v2 plugin identity', () => {
    const payload = pluginPayloadV2()
    payload.contributions.connectors = [pluginConnectorContract()]
    expect(parseVersionedPluginManifestPayload(payload).contributions.connectors).toEqual(
      payload.contributions.connectors
    )

    const mismatched = structuredClone(payload)
    const connector = mismatched.contributions.connectors?.[0]
    if (!connector) throw new Error('Expected connector fixture')
    Reflect.set(connector, 'pluginId', 'acme.other')
    expect(() => parseVersionedPluginManifestPayload(mismatched)).toThrow(
      'must match manifest.plugin.id'
    )

    const duplicated = structuredClone(payload)
    duplicated.contributions.connectors = [pluginConnectorContract(), pluginConnectorContract()]
    expect(() => parseVersionedPluginManifestPayload(duplicated)).toThrow('duplicate connector IDs')

    const legacy = pluginPayload()
    Reflect.set(legacy.contributions, 'connectors', [pluginConnectorContract()])
    expect(() => parsePluginManifestPayload(legacy)).toThrow('unsupported fields')
    Reflect.deleteProperty(legacy.contributions, 'connectors')
    Reflect.set(legacy.contributions, 'storageProviders', [pluginStorageProviderContribution()])
    expect(() => parsePluginManifestPayload(legacy)).toThrow('unsupported fields')
  })

  test('strictly bounds storage-provider declarations without accepting implementation config', () => {
    const payload = pluginPayloadV2()
    payload.contributions.storageProviders = [pluginStorageProviderContribution()]
    expect(parseVersionedPluginManifestPayload(payload).contributions.storageProviders).toEqual(
      payload.contributions.storageProviders
    )

    const duplicateProvider = structuredClone(payload)
    duplicateProvider.contributions.storageProviders = [
      pluginStorageProviderContribution(),
      pluginStorageProviderContribution('Duplicate')
    ]
    expect(() => parseVersionedPluginManifestPayload(duplicateProvider)).toThrow(
      'duplicate provider IDs'
    )

    const duplicateCapability = structuredClone(payload)
    Reflect.set(duplicateCapability.contributions.storageProviders?.[0] ?? {}, 'capabilities', [
      'documents.read',
      'documents.read'
    ])
    expect(() => parseVersionedPluginManifestPayload(duplicateCapability)).toThrow(
      'must not contain duplicates'
    )

    const unsupportedCapability = structuredClone(payload)
    Reflect.set(unsupportedCapability.contributions.storageProviders?.[0] ?? {}, 'capabilities', [
      'network.configure'
    ])
    expect(() => parseVersionedPluginManifestPayload(unsupportedCapability)).toThrow(
      'is not supported'
    )

    for (const forbidden of ['oauth', 'network', 'code'] as const) {
      const unsafe = structuredClone(payload)
      Reflect.set(unsafe.contributions.storageProviders?.[0] ?? {}, forbidden, {})
      expect(() => parseVersionedPluginManifestPayload(unsafe)).toThrow('unsupported fields')
    }

    const tooMany = structuredClone(payload)
    tooMany.contributions.storageProviders = Array.from(
      { length: PLUGIN_MANIFEST_LIMITS.maxStorageProviders + 1 },
      (_, index) => ({ ...pluginStorageProviderContribution(), providerId: `provider-${index}` })
    )
    expect(() => parseVersionedPluginManifestPayload(tooMany)).toThrow('may not contain more than')
  })

  test('signs, serializes, parses, and verifies v2 bytes', async () => {
    const keyPair = await keys()
    const payload = pluginPayloadV2()
    payload.contributions.storageProviders = [pluginStorageProviderContribution()]
    const manifest = await signVersionedPluginManifest(payload, keyPair.privateKey)
    if (manifest.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION_V2) {
      throw new Error('Expected schema-v2 manifest')
    }
    const serialized = serializeVersionedPluginManifest(manifest)
    expect(parseVersionedPluginPackageJSON(serialized)).toEqual(manifest)
    expect(parseVersionedPluginPackageBytes(new TextEncoder().encode(serialized))).toEqual(manifest)
    const verified = await verifyVersionedPluginPackage(manifest, keyPair.publicKey, {
      expectedKeyId: 'acme.release',
      engineVersion: '0.13.2'
    })
    expect(verified).toMatchObject({
      manifest: { schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION_V2 },
      verifiedDigest: manifest.integrity.digest,
      verifiedKeyId: 'acme.release'
    })
    expect(parseVerifiedPluginPackageSnapshot(verified)).toEqual(verified)
  })

  test('rejects undeclared authority, unsafe outputs, open schemas, and tampering', async () => {
    const unknownPermission = structuredClone(pluginPayloadV2())
    Reflect.set(firstCommand(unknownPermission), 'permissions', ['network'])
    expect(() => parseVersionedPluginManifestPayload(unknownPermission)).toThrow('host permission')

    const legacyExtension = structuredClone(pluginPayloadV2())
    Reflect.set(firstExporter(legacyExtension), 'fileExtension', '.json')
    expect(() => parseVersionedPluginManifestPayload(legacyExtension)).toThrow('unsupported fields')

    const unsafeMime = structuredClone(pluginPayloadV2())
    Reflect.set(firstOutput(unsafeMime), 'mimeType', 'text/html; charset=utf-8')
    expect(() => parseVersionedPluginManifestPayload(unsafeMime)).toThrow('safe MIME type')

    const duplicateExtension = structuredClone(pluginPayloadV2())
    Reflect.set(firstExporter(duplicateExtension), 'outputs', [
      { extension: '.JSON', mimeType: 'application/json' },
      { extension: '.json', mimeType: 'text/json' }
    ])
    expect(() => parseVersionedPluginManifestPayload(duplicateExtension)).toThrow(
      'unique file extensions'
    )

    const openParameters = structuredClone(pluginPayloadV2())
    Reflect.set(firstCommand(openParameters).parameters.schema, 'additionalProperties', true)
    expect(() => parseVersionedPluginManifestPayload(openParameters)).toThrow('must be false')

    const reservedTarget = structuredClone(pluginPayloadV2())
    Reflect.set(firstCommand(reservedTarget).parameters.schema.properties, 'document_id', {
      type: 'string'
    })
    expect(() => parseVersionedPluginManifestPayload(reservedTarget)).toThrow(
      'reserved automation target'
    )

    const keyPair = await keys()
    const manifest = await signVersionedPluginManifest(pluginPayloadV2(), keyPair.privateKey)
    if (manifest.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION_V2) {
      throw new Error('Expected schema-v2 manifest')
    }
    const tampered = structuredClone(manifest)
    Reflect.set(firstOutput(tampered), 'extension', '.txt')
    await expect(verifyVersionedPluginPackage(tampered, keyPair.publicKey)).rejects.toThrow(
      'digest mismatch'
    )
  })

  test('fails closed for unknown schema versions and signed unsupported fields', async () => {
    expect(() =>
      parseVersionedPluginManifestPayload({ ...pluginPayloadV2(), schemaVersion: 3 })
    ).toThrow('schemaVersion')

    const keyPair = await keys()
    const manifest = await signVersionedPluginManifest(pluginPayloadV2(), keyPair.privateKey)
    expect(validateVersionedPluginManifest({ ...manifest, executable: 'alert(1)' }).ok).toBe(false)
  })
})
