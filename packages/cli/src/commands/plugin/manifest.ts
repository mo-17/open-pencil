import { defineCommand } from 'citty'

import {
  PLUGIN_MANIFEST_LIMITS,
  parsePluginManifest,
  parsePluginManifestPayload,
  serializePluginManifest,
  signPluginManifest,
  verifyPluginPackage,
  type PluginManifestPayloadV1,
  type PluginManifestV1
} from '@open-pencil/core/plugins'

import {
  importPrivateKey,
  importPublicKey,
  jsonArg,
  outputArg,
  printArtifact,
  printJson,
  privateKeyArgs,
  publicKeyArgs,
  readBoundedJson,
  runPluginCommandSafely,
  writeJsonOutput
} from './common'

const { version: DEFAULT_ENGINE_VERSION } = await import('../../../package.json')

function manifestDetails(manifest: PluginManifestPayloadV1, digest?: string) {
  return {
    pluginId: manifest.plugin.id,
    version: manifest.plugin.version,
    publisher: manifest.publisher.id,
    keyId: manifest.publisher.keyId,
    engineRange: manifest.engineRange,
    modules: manifest.contributions.modules.length,
    ...(digest ? { digest } : {})
  }
}

function parseManifestOrPayload(value: unknown): {
  signed: boolean
  manifest: PluginManifestPayloadV1 | PluginManifestV1
} {
  const signed =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'integrity')
  return {
    signed,
    manifest: signed ? parsePluginManifest(value) : parsePluginManifestPayload(value)
  }
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
        await readBoundedJson(args.manifest, PLUGIN_MANIFEST_LIMITS.maxJsonBytes, 'Plugin manifest')
      )
      const report = { valid: true, signed: parsed.signed, manifest: parsed.manifest }
      if (args.json) printJson(report)
      else {
        printArtifact(
          parsed.signed ? 'Valid signed plugin manifest' : 'Valid plugin manifest payload',
          parsed.manifest.plugin.name,
          manifestDetails(
            parsed.manifest,
            parsed.signed ? (parsed.manifest as PluginManifestV1).integrity.digest : undefined
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
      const payload = await readBoundedJson(
        args.payload,
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Plugin manifest payload'
      )
      const manifest = await signPluginManifest(payload, await importPrivateKey(args))
      const output = await writeJsonOutput(
        args.output,
        serializePluginManifest(manifest),
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Signed plugin manifest'
      )
      const report = { manifest, output }
      if (args.json) printJson(report)
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
      const manifest = await readBoundedJson(
        args.manifest,
        PLUGIN_MANIFEST_LIMITS.maxJsonBytes,
        'Plugin manifest'
      )
      const snapshot = await verifyPluginPackage(manifest, await importPublicKey(args), {
        engineVersion: args['engine-version'],
        ...(args['key-id'] ? { expectedKeyId: args['key-id'] } : {})
      })
      if (args.json) printJson(snapshot)
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
