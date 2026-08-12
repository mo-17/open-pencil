import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_MANIFEST_LIMITS,
  parsePluginManifestPayload,
  parsePluginPackageBytes,
  parsePluginPackageJSON,
  serializePluginManifest,
  signPluginManifest,
  validatePluginManifest,
  verifyPluginPackage
} from '@open-pencil/core/plugins'
import {
  canonicalManifestJSON,
  compareStableSemver,
  exportEd25519PublicKeyPem,
  importEd25519PublicKeyPem,
  normalizeStableEngineRange,
  satisfiesStableEngineRange,
  stableSemverParts
} from '@open-pencil/scene-graph'

import { pluginPayload } from '../helpers'

async function keys(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

const V1_GOLDEN_PRIVATE_KEY: JSONWebKey = {
  crv: 'Ed25519',
  d: 'FxJOeRX9SK273eZkGQ8W5ohk1EFWP67CZCSzYL4cNbU',
  ext: true,
  key_ops: ['sign'],
  kty: 'OKP',
  x: '3kDZvtAZuYe78SGOC-rt_sgTMClbZoeR-KYMEAMHwnU'
}
const V1_GOLDEN_DIGEST = 'C2jbOQ2TgFTqjQzk_DFCxCfEKO2-3H1aMA28ZrYLzJ4'
const V1_GOLDEN_SIGNATURE =
  '0IaajlWJCT1h84O4w4NMH0pZIIOysfsdd6PSmo2tKiqCarZambSVbMBd1ic7L1eh3_lCCthfjh-D7F3HlQZTDw'

describe('shared signed manifest primitives', () => {
  test('canonicalizes keys and implements bounded stable SemVer ranges', () => {
    expect(canonicalManifestJSON({ z: 1, a: { d: 2, b: 1 } })).toBe('{"a":{"b":1,"d":2},"z":1}')
    expect(normalizeStableEngineRange('  >=0.13.0   <1.0.0  ')).toBe('>=0.13.0 <1.0.0')
    expect(satisfiesStableEngineRange('0.13.2', '^0.13.0')).toBe(true)
    expect(satisfiesStableEngineRange('0.14.0', '^0.13.0')).toBe(false)
    expect(compareStableSemver(stableSemverParts('1.2.0'), stableSemverParts('1.1.9'))).toBe(1)
  })

  test('round-trips strict Ed25519 public PEM without accepting trailing data', async () => {
    const keyPair = await keys()
    const pem = await exportEd25519PublicKeyPem(keyPair.publicKey)
    const imported = await importEd25519PublicKeyPem(pem)
    expect(imported.algorithm.name).toBe('Ed25519')
    await expect(importEd25519PublicKeyPem(`${pem}trailing`)).rejects.toThrow('PEM data')
  })
})

describe('signed declarative plugin packages', () => {
  test('preserves the schema-v1 canonical digest and signature golden', async () => {
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      V1_GOLDEN_PRIVATE_KEY,
      { name: 'Ed25519' },
      false,
      ['sign']
    )
    const manifest = await signPluginManifest(pluginPayload(), privateKey)
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.integrity.digest).toBe(V1_GOLDEN_DIGEST)
    expect(manifest.integrity.signature.value).toBe(V1_GOLDEN_SIGNATURE)
  })

  test('signs, serializes, parses, and verifies a single bounded JSON package', async () => {
    const keyPair = await keys()
    const manifest = await signPluginManifest(pluginPayload(), keyPair.privateKey)
    const serialized = serializePluginManifest(manifest)
    expect(parsePluginPackageJSON(serialized)).toEqual(manifest)
    expect(parsePluginPackageBytes(new TextEncoder().encode(serialized))).toEqual(manifest)
    const verified = await verifyPluginPackage(manifest, keyPair.publicKey, {
      expectedKeyId: 'acme.release',
      engineVersion: '0.13.2'
    })
    expect(verified.verifiedDigest).toBe(manifest.integrity.digest)
    expect(verified.verifiedKeyId).toBe('acme.release')
  })

  test('fails closed for tampering, untrusted keys, unsupported capabilities, and fields', async () => {
    const keyPair = await keys()
    const manifest = await signPluginManifest(pluginPayload(), keyPair.privateKey)
    const tampered = structuredClone(manifest)
    tampered.plugin.name = 'Tampered'
    await expect(verifyPluginPackage(tampered, keyPair.publicKey)).rejects.toThrow(
      'digest mismatch'
    )
    await expect(
      verifyPluginPackage(manifest, keyPair.publicKey, { expectedKeyId: 'other.release' })
    ).rejects.toThrow('not trusted')
    await expect(
      verifyPluginPackage(manifest, keyPair.publicKey, { engineVersion: '1.0.0' })
    ).rejects.toThrow('requires OpenPencil')
    const unrelatedKeys = await keys()
    await expect(verifyPluginPackage(manifest, unrelatedKeys.publicKey)).rejects.toThrow(
      'signature verification failed'
    )
    expect(() =>
      parsePluginManifestPayload({ ...pluginPayload(), capabilities: ['network'] })
    ).toThrow('capabilities')
    expect(validatePluginManifest({ ...manifest, executable: 'alert(1)' }).ok).toBe(false)
    const noncanonicalSignature = structuredClone(manifest)
    noncanonicalSignature.integrity.signature.value = `${manifest.integrity.signature.value.slice(0, -1)}B`
    expect(validatePluginManifest(noncanonicalSignature).ok).toBe(false)
  })

  test('rejects unsafe declarative fields before signing', () => {
    const unsafePath = pluginPayload()
    unsafePath.contributions.modules[0].fields[0].path = ['__proto__']
    expect(() => parsePluginManifestPayload(unsafePath)).toThrow('safe property key')

    const missingDefault = pluginPayload()
    missingDefault.contributions.modules[0].fields[0].path = ['missing']
    expect(() => parsePluginManifestPayload(missingDefault)).toThrow('does not exist')

    const mismatchedDefault = pluginPayload()
    mismatchedDefault.contributions.modules[0].fields[0].kind = 'boolean'
    expect(() => parsePluginManifestPayload(mismatchedDefault)).toThrow('resolve to a boolean')
  })

  test('keeps module-only manifests compatible and accepts bounded command and exporter contributions', async () => {
    const legacyPayload = pluginPayload()
    const parsedLegacy = parsePluginManifestPayload(legacyPayload)
    expect(parsedLegacy).toEqual(legacyPayload)
    expect(Object.hasOwn(parsedLegacy.contributions, 'commands')).toBe(false)
    expect(Object.hasOwn(parsedLegacy.contributions, 'exporters')).toBe(false)

    const payload = pluginPayload()
    payload.contributions.modules = []
    payload.contributions.commands = [
      {
        commandId: 'copy-as-html',
        name: 'Copy as HTML',
        description: 'Copies the selected nodes as HTML',
        adapterId: 'open-pencil.clipboard.html'
      }
    ]
    payload.contributions.exporters = [
      {
        exporterId: 'tauri-project',
        name: 'Tauri Project',
        description: 'Exports a Tauri project archive',
        adapterId: 'open-pencil.export.tauri',
        fileExtension: '.zip'
      }
    ]

    const parsed = parsePluginManifestPayload(payload)
    expect(parsed.contributions).toEqual(payload.contributions)
    const keyPair = await keys()
    const manifest = await signPluginManifest(payload, keyPair.privateKey)
    expect(parsePluginPackageJSON(serializePluginManifest(manifest))).toEqual(manifest)
    await expect(verifyPluginPackage(manifest, keyPair.publicKey)).resolves.toMatchObject({
      manifest: { contributions: payload.contributions }
    })
  })

  test('strictly validates, bounds, and deduplicates command and exporter contributions', () => {
    const empty = pluginPayload()
    empty.contributions.modules = []
    expect(() => parsePluginManifestPayload(empty)).toThrow('at least one contribution')

    const duplicateCommands = pluginPayload()
    duplicateCommands.contributions.commands = [
      {
        commandId: 'copy',
        name: 'Copy',
        description: '',
        adapterId: 'open-pencil.clipboard.copy'
      },
      {
        commandId: 'copy',
        name: 'Copy again',
        description: '',
        adapterId: 'open-pencil.clipboard.copy-again'
      }
    ]
    expect(() => parsePluginManifestPayload(duplicateCommands)).toThrow('duplicate command IDs')

    const duplicateExporters = pluginPayload()
    duplicateExporters.contributions.exporters = [
      {
        exporterId: 'tauri',
        name: 'Tauri',
        description: '',
        adapterId: 'open-pencil.export.tauri',
        fileExtension: '.zip'
      },
      {
        exporterId: 'tauri',
        name: 'Tauri again',
        description: '',
        adapterId: 'open-pencil.export.tauri-again',
        fileExtension: '.tar.gz'
      }
    ]
    expect(() => parsePluginManifestPayload(duplicateExporters)).toThrow('duplicate exporter IDs')

    const unknownCommandKey = pluginPayload()
    const commandWithUnsupportedField = {
      commandId: 'copy',
      name: 'Copy',
      description: '',
      adapterId: 'open-pencil.clipboard.copy',
      executable: 'alert(1)'
    }
    unknownCommandKey.contributions.commands = [commandWithUnsupportedField]
    expect(() => parsePluginManifestPayload(unknownCommandKey)).toThrow('unsupported fields')

    const unknownExporterKey = pluginPayload()
    const exporterWithUnsupportedField = {
      exporterId: 'tauri',
      name: 'Tauri',
      description: '',
      adapterId: 'open-pencil.export.tauri',
      fileExtension: '.zip',
      shellCommand: 'bun install'
    }
    unknownExporterKey.contributions.exporters = [exporterWithUnsupportedField]
    expect(() => parsePluginManifestPayload(unknownExporterKey)).toThrow('unsupported fields')

    const invalidIdentity = pluginPayload()
    invalidIdentity.contributions.commands = [
      {
        commandId: 'copy selection',
        name: 'Copy',
        description: '',
        adapterId: 'open-pencil.clipboard.copy'
      }
    ]
    expect(() => parsePluginManifestPayload(invalidIdentity)).toThrow('commandId')

    const invalidExporterIdentity = pluginPayload()
    invalidExporterIdentity.contributions.exporters = [
      {
        exporterId: 'Tauri Project',
        name: 'Tauri',
        description: '',
        adapterId: 'open-pencil.export.tauri',
        fileExtension: '.zip'
      }
    ]
    expect(() => parsePluginManifestPayload(invalidExporterIdentity)).toThrow('exporterId')

    const unsafeExtension = pluginPayload()
    unsafeExtension.contributions.exporters = [
      {
        exporterId: 'tauri',
        name: 'Tauri',
        description: '',
        adapterId: 'open-pencil.export.tauri',
        fileExtension: '../zip'
      }
    ]
    expect(() => parsePluginManifestPayload(unsafeExtension)).toThrow('safe file extension')

    const tooManyCommands = pluginPayload()
    tooManyCommands.contributions.commands = Array.from(
      { length: PLUGIN_MANIFEST_LIMITS.maxCommands + 1 },
      (_, index) => ({
        commandId: `command-${index}`,
        name: `Command ${index}`,
        description: '',
        adapterId: `open-pencil.command-${index}`
      })
    )
    expect(() => parsePluginManifestPayload(tooManyCommands)).toThrow('may not contain more than')

    const tooManyExporters = pluginPayload()
    tooManyExporters.contributions.exporters = Array.from(
      { length: PLUGIN_MANIFEST_LIMITS.maxExporters + 1 },
      (_, index) => ({
        exporterId: `exporter-${index}`,
        name: `Exporter ${index}`,
        description: '',
        adapterId: `open-pencil.exporter-${index}`,
        fileExtension: '.zip'
      })
    )
    expect(() => parsePluginManifestPayload(tooManyExporters)).toThrow('may not contain more than')
  })
})
