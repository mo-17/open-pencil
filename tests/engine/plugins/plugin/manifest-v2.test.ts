import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_MANIFEST_SCHEMA_VERSION_V2,
  parsePluginManifestPayload,
  parseVersionedPluginPackageBytes,
  parseVersionedPluginPackageJson,
  parseVersionedPluginManifestPayload,
  parseVerifiedPluginPackageSnapshot,
  serializeVersionedPluginManifest,
  signVersionedPluginManifest,
  validateVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifestPayloadV2
} from '@open-pencil/core/plugins'

import { pluginPayloadV2 } from '../helpers'

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

  test('signs, serializes, parses, and verifies v2 bytes', async () => {
    const keyPair = await keys()
    const manifest = await signVersionedPluginManifest(pluginPayloadV2(), keyPair.privateKey)
    if (manifest.schemaVersion !== PLUGIN_MANIFEST_SCHEMA_VERSION_V2) {
      throw new Error('Expected schema-v2 manifest')
    }
    const serialized = serializeVersionedPluginManifest(manifest)
    expect(parseVersionedPluginPackageJson(serialized)).toEqual(manifest)
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
