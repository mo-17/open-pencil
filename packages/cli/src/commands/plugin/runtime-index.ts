import { defineCommand } from 'citty'

import {
  PLUGIN_RUNTIME_INDEX_LIMITS,
  parsePluginTrustTimestamp,
  serializePluginRuntimeIndex,
  signPluginRuntimeIndex,
  verifyPluginRuntimeIndex,
  type PluginRuntimeIndexPayloadV1
} from '@open-pencil/core/plugins'

import {
  importPrivateKey,
  importPublicKey,
  jsonArg,
  optionalNonNegativeInteger,
  outputArg,
  printArtifact,
  printJSON,
  privateKeyArgs,
  publicKeyArgs,
  readBoundedJSON,
  runPluginCommandSafely,
  writeJSONOutput
} from './common'

function runtimeIndexDetails(runtimeIndex: PluginRuntimeIndexPayloadV1, digest?: string) {
  return {
    version: runtimeIndex.version,
    entries: runtimeIndex.entries.length,
    generatedAt: runtimeIndex.generatedAt,
    expiresAt: runtimeIndex.expiresAt,
    ...(digest ? { digest } : {})
  }
}

const build = defineCommand({
  meta: { description: 'Build a bounded root-signed plugin runtime index' },
  args: {
    payload: {
      type: 'positional',
      required: true,
      description: 'Unsigned plugin runtime index payload JSON path'
    },
    ...privateKeyArgs,
    'key-id': {
      type: 'string',
      description: 'Runtime index root signing key id (defaults to indexId)'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const payload = await readBoundedJSON(
        args.payload,
        PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes,
        'Plugin runtime index payload'
      )
      const runtimeIndex = await signPluginRuntimeIndex(
        payload,
        await importPrivateKey(args),
        args['key-id'] ? { keyId: args['key-id'] } : {}
      )
      const output = await writeJSONOutput(
        args.output,
        serializePluginRuntimeIndex(runtimeIndex),
        PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes,
        'Signed plugin runtime index'
      )
      const report = { runtimeIndex, output }
      if (args.json) printJSON(report)
      else {
        printArtifact(
          'Built signed plugin runtime index',
          runtimeIndex.indexId,
          {
            ...runtimeIndexDetails(runtimeIndex, runtimeIndex.integrity.digest),
            keyId: runtimeIndex.integrity.signature.keyId
          },
          output
        )
      }
    })
  }
})

const verify = defineCommand({
  meta: { description: 'Verify a signed plugin runtime index root and validity window' },
  args: {
    index: {
      type: 'positional',
      required: true,
      description: 'Signed plugin runtime index JSON path'
    },
    ...publicKeyArgs,
    'index-id': {
      type: 'string',
      required: true,
      description: 'Expected trusted runtime index id'
    },
    'key-id': {
      type: 'string',
      required: true,
      description: 'Expected trusted runtime index root key id'
    },
    digest: {
      type: 'string',
      required: true,
      description: 'Expected trusted runtime index digest'
    },
    now: { type: 'string', description: 'Verification time as a canonical UTC timestamp' },
    'max-clock-skew-ms': {
      type: 'string',
      description: 'Bounded non-negative clock skew allowance in milliseconds'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const runtimeIndex = await readBoundedJSON(
        args.index,
        PLUGIN_RUNTIME_INDEX_LIMITS.maxJsonBytes,
        'Plugin runtime index'
      )
      const maxClockSkewMilliseconds = optionalNonNegativeInteger(
        args['max-clock-skew-ms'],
        '--max-clock-skew-ms'
      )
      const now = args.now ? parsePluginTrustTimestamp(args.now, '--now') : undefined
      const snapshot = await verifyPluginRuntimeIndex(runtimeIndex, await importPublicKey(args), {
        expectedIndexId: args['index-id'],
        expectedKeyId: args['key-id'],
        expectedDigest: args.digest,
        ...(now ? { now } : {}),
        ...(maxClockSkewMilliseconds === undefined ? {} : { maxClockSkewMilliseconds })
      })
      if (args.json) printJSON(snapshot)
      else {
        printArtifact('Verified plugin runtime index', snapshot.index.indexId, {
          ...runtimeIndexDetails(snapshot.index, snapshot.verifiedDigest),
          keyId: snapshot.verifiedKeyId,
          verifiedAt: snapshot.verifiedAt,
          diagnostics: snapshot.diagnostics.length
        })
      }
    })
  }
})

export default defineCommand({
  meta: { description: 'Build and verify root-signed plugin runtime indexes' },
  subCommands: { build, verify }
})
