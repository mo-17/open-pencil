import { defineCommand } from 'citty'

import {
  PLUGIN_RUNTIME_PACKAGE_LIMITS,
  parsePluginRuntimePackage,
  parsePluginRuntimePackagePayload,
  serializePluginRuntimePackage,
  signPluginRuntimePackage,
  validatePluginRuntimeEmbeddedAsset,
  verifyPluginRuntimePackage,
  type PluginRuntimePackagePayloadV1,
  type SignedPluginRuntimePackageV1
} from '@open-pencil/plugin-contracts'

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
  requiredPositiveInteger,
  runPluginCommandSafely,
  writeJSONOutput
} from './common'

function runtimeDetails(runtimePackage: PluginRuntimePackagePayloadV1, digest?: string) {
  return {
    pluginId: runtimePackage.plugin.id,
    version: runtimePackage.plugin.version,
    publisher: runtimePackage.publisher.id,
    keyId: runtimePackage.publisher.keyId,
    kind: runtimePackage.runtime.kind,
    capabilities: runtimePackage.runtime.capabilities.length,
    assetBytes: runtimePackage.runtime.asset.byteLength,
    assetDigest: runtimePackage.runtime.asset.digest,
    ...(digest ? { digest } : {})
  }
}

function parseRuntimeOrPayload(value: unknown): {
  signed: boolean
  runtimePackage: PluginRuntimePackagePayloadV1 | SignedPluginRuntimePackageV1
  payload: PluginRuntimePackagePayloadV1
} {
  const signed =
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'integrity')
  if (!signed) {
    const payload = parsePluginRuntimePackagePayload(value)
    return { signed, runtimePackage: payload, payload }
  }
  const runtimePackage = parsePluginRuntimePackage(value)
  return {
    signed,
    runtimePackage,
    payload: {
      format: runtimePackage.format,
      schemaVersion: runtimePackage.schemaVersion,
      plugin: runtimePackage.plugin,
      publisher: runtimePackage.publisher,
      declarativeManifestDigest: runtimePackage.declarativeManifestDigest,
      runtime: runtimePackage.runtime
    }
  }
}

const validate = defineCommand({
  meta: {
    description: 'Validate a runtime schema and embedded asset envelope without checking signatures'
  },
  args: {
    runtime: {
      type: 'positional',
      required: true,
      description: 'Plugin runtime package or unsigned payload JSON path'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const parsed = parseRuntimeOrPayload(
        await readBoundedJSON(
          args.runtime,
          PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes,
          'Plugin runtime package'
        )
      )
      const wasmSafety = await validatePluginRuntimeEmbeddedAsset(parsed.payload)
      const report = {
        valid: true,
        signed: parsed.signed,
        signatureVerified: false,
        runtimePackage: parsed.runtimePackage,
        wasmSafety
      }
      if (args.json) printJSON(report)
      else {
        printArtifact(
          'Valid runtime asset envelope (signature not checked)',
          `${parsed.runtimePackage.plugin.id}@${parsed.runtimePackage.plugin.version}`,
          {
            ...runtimeDetails(parsed.runtimePackage),
            signaturePresent: parsed.signed,
            signatureVerified: false
          }
        )
      }
    })
  }
})

const sign = defineCommand({
  meta: { description: 'Sign and statically validate a bounded plugin runtime package payload' },
  args: {
    payload: {
      type: 'positional',
      required: true,
      description: 'Unsigned plugin runtime package payload JSON path'
    },
    ...privateKeyArgs,
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const payload = await readBoundedJSON(
        args.payload,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes,
        'Plugin runtime package payload'
      )
      const runtimePackage = await signPluginRuntimePackage(payload, await importPrivateKey(args))
      const output = await writeJSONOutput(
        args.output,
        serializePluginRuntimePackage(runtimePackage),
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes,
        'Signed plugin runtime package'
      )
      const report = { runtimePackage, output }
      if (args.json) printJSON(report)
      else {
        printArtifact(
          'Signed plugin runtime package',
          `${runtimePackage.plugin.id}@${runtimePackage.plugin.version}`,
          runtimeDetails(runtimePackage, runtimePackage.integrity.digest),
          output
        )
      }
    })
  }
})

const verify = defineCommand({
  meta: { description: 'Verify a signed plugin runtime package and its embedded runtime asset' },
  args: {
    runtime: {
      type: 'positional',
      required: true,
      description: 'Signed plugin runtime package JSON path'
    },
    ...publicKeyArgs,
    'plugin-id': { type: 'string', required: true, description: 'Expected trusted plugin id' },
    'plugin-version': {
      type: 'string',
      required: true,
      description: 'Expected trusted plugin version'
    },
    'publisher-id': {
      type: 'string',
      required: true,
      description: 'Expected trusted publisher id'
    },
    'key-id': {
      type: 'string',
      required: true,
      description: 'Expected trusted publisher key id'
    },
    'manifest-digest': {
      type: 'string',
      required: true,
      description: 'Expected verified declarative manifest digest'
    },
    digest: {
      type: 'string',
      required: true,
      description: 'Expected trusted runtime package digest'
    },
    'byte-length': {
      type: 'string',
      required: true,
      description: 'Expected canonical runtime package byte length'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const runtimePackage = await readBoundedJSON(
        args.runtime,
        PLUGIN_RUNTIME_PACKAGE_LIMITS.maxJsonBytes,
        'Plugin runtime package'
      )
      const snapshot = await verifyPluginRuntimePackage(
        runtimePackage,
        await importPublicKey(args),
        {
          expectedPluginId: args['plugin-id'],
          expectedPluginVersion: args['plugin-version'],
          expectedPublisherId: args['publisher-id'],
          expectedKeyId: args['key-id'],
          expectedDeclarativeManifestDigest: args['manifest-digest'],
          expectedDigest: args.digest,
          expectedCanonicalByteLength: requiredPositiveInteger(args['byte-length'], '--byte-length')
        }
      )
      if (args.json) printJSON(snapshot)
      else {
        printArtifact(
          'Verified plugin runtime package',
          `${snapshot.runtimePackage.plugin.id}@${snapshot.runtimePackage.plugin.version}`,
          {
            ...runtimeDetails(snapshot.runtimePackage, snapshot.verifiedDigest),
            executionStatus: snapshot.executionStatus,
            wasmMaximumMemoryPages: snapshot.wasmSafety?.maximumMemoryPages ?? null
          }
        )
      }
    })
  }
})

export default defineCommand({
  meta: { description: 'Validate, sign, and verify publisher-signed plugin runtime packages' },
  subCommands: { validate, sign, verify }
})
