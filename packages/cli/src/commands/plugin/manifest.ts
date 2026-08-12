import { defineCommand } from 'citty'

import {
  PLUGIN_MANIFEST_LIMITS,
  parseVersionedPluginManifest,
  parseVersionedPluginManifestPayload,
  serializeVersionedPluginManifest,
  signVersionedPluginManifest,
  verifyVersionedPluginPackage,
  type PluginManifest,
  type PluginManifestPayload
} from '@open-pencil/core/plugins'

import {
  importPrivateKey,
  importPublicKey,
  jsonArg,
  outputArg,
  printArtifact,
  printJSON,
  privateKeyArgs,
  publicKeyArgs,
  readBoundedJSON,
  runPluginCommandSafely,
  writeJSONOutput
} from './common'

const { version: DEFAULT_ENGINE_VERSION } = await import('../../../package.json')

function manifestDetails(manifest: PluginManifestPayload, digest?: string) {
  return {
    pluginId: manifest.plugin.id,
    version: manifest.plugin.version,
    schemaVersion: manifest.schemaVersion,
    publisher: manifest.publisher.id,
    keyId: manifest.publisher.keyId,
    engineRange: manifest.engineRange,
    modules: manifest.contributions.modules.length,
    commands: manifest.contributions.commands?.length ?? 0,
    exporters: manifest.contributions.exporters?.length ?? 0,
    connectors: manifest.schemaVersion === 2 ? (manifest.contributions.connectors?.length ?? 0) : 0,
    ...(digest ? { digest } : {})
  }
}

type ParsedManifestOrPayload =
  | { signed: false; manifest: PluginManifestPayload }
  | { signed: true; manifest: PluginManifest }

function parseManifestOrPayload(value: unknown): ParsedManifestOrPayload {
  const signed =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'integrity')
  return signed
    ? { signed, manifest: parseVersionedPluginManifest(value) }
    : { signed, manifest: parseVersionedPluginManifestPayload(value) }
}

const validate = defineCommand({
  meta: { description: 'Validate a bounded declarative plugin manifest or unsigned payload' },
  args: {
    manifest: {
      type: 'positional',
      required: true,
      description: 'Plugin manifest or unsigned payload JSON path'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const parsed = parseManifestOrPayload(
        await readBoundedJSON(args.manifest, PLUGIN_MANIFEST_LIMITS.maxJsonBytes, 'Plugin manifest')
      )
      const report = {
        valid: true,
        signed: parsed.signed,
        schemaVersion: parsed.manifest.schemaVersion,
        manifest: parsed.manifest
      }
      if (args.json) printJSON(report)
      else {
        printArtifact(
          parsed.signed ? 'Valid signed plugin manifest' : 'Valid plugin manifest payload',
          parsed.manifest.plugin.name,
          manifestDetails(
            parsed.manifest,
            parsed.signed ? parsed.manifest.integrity.digest : undefined
          )
        )
      }
    })
  }
})

const sign = defineCommand({
  meta: { description: 'Sign a bounded plugin manifest payload with Ed25519' },
  args: {
    payload: {
      type: 'positional',
      required: true,
      description: 'Unsigned plugin manifest payload JSON path'
    },
    ...privateKeyArgs,
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const payload = await readBoundedJSON(
        args.payload,
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Plugin manifest payload'
      )
      const manifest = await signVersionedPluginManifest(payload, await importPrivateKey(args))
      const output = await writeJSONOutput(
        args.output,
        serializeVersionedPluginManifest(manifest),
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Signed plugin manifest'
      )
      const report = { schemaVersion: manifest.schemaVersion, manifest, output }
      if (args.json) printJSON(report)
      else {
        printArtifact(
          'Signed plugin manifest',
          manifest.plugin.name,
          manifestDetails(manifest, manifest.integrity.digest),
          output
        )
      }
    })
  }
})

const verify = defineCommand({
  meta: { description: 'Verify a signed plugin manifest, publisher key, and engine range' },
  args: {
    manifest: {
      type: 'positional',
      required: true,
      description: 'Signed plugin manifest JSON path'
    },
    ...publicKeyArgs,
    'key-id': { type: 'string', description: 'Expected trusted publisher key id' },
    'engine-version': {
      type: 'string',
      default: DEFAULT_ENGINE_VERSION,
      description: 'OpenPencil engine version used for compatibility verification'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const manifest = await readBoundedJSON(
        args.manifest,
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Plugin manifest'
      )
      const snapshot = await verifyVersionedPluginPackage(manifest, await importPublicKey(args), {
        engineVersion: args['engine-version'],
        ...(args['key-id'] ? { expectedKeyId: args['key-id'] } : {})
      })
      if (args.json) printJSON({ schemaVersion: snapshot.manifest.schemaVersion, ...snapshot })
      else {
        printArtifact(
          'Verified plugin manifest',
          snapshot.manifest.plugin.name,
          manifestDetails(snapshot.manifest, snapshot.verifiedDigest)
        )
      }
    })
  }
})

export default defineCommand({
  meta: { description: 'Validate, sign, and verify declarative plugin manifests' },
  subCommands: { validate, sign, verify }
})
