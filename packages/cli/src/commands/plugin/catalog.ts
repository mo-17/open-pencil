import { defineCommand } from 'citty'

import {
  PLUGIN_CATALOG_LIMITS,
  parsePluginTrustTimestamp,
  serializePluginCatalog,
  signPluginCatalog,
  verifyPluginCatalog,
  type PluginCatalogPayloadV1
} from '@open-pencil/core/plugins'

import {
  importPrivateKey,
  importPublicKey,
  jsonArg,
  optionalNonNegativeInteger,
  outputArg,
  printArtifact,
  printJson,
  privateKeyArgs,
  publicKeyArgs,
  readBoundedJson,
  runPluginCommandSafely,
  writeJsonOutput
} from './common'

function catalogDetails(catalog: PluginCatalogPayloadV1, digest?: string) {
  return {
    version: catalog.version,
    entries: catalog.entries.length,
    generatedAt: catalog.generatedAt,
    expiresAt: catalog.expiresAt,
    ...(digest ? { digest } : {})
  }
}

const build = defineCommand({
  meta: { description: 'Build a bounded signed plugin catalog without fetching its entries' },
  args: {
    payload: {
      type: 'positional',
      required: true,
      description: 'Unsigned plugin catalog payload JSON path'
    },
    ...privateKeyArgs,
    'key-id': {
      type: 'string',
      description: 'Catalog root signing key id (defaults to catalogId)'
    },
    output: outputArg,
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const payload = await readBoundedJson(
        args.payload,
        PLUGIN_CATALOG_LIMITS.maxJsonBytes,
        'Plugin catalog payload'
      )
      const catalog = await signPluginCatalog(
        payload,
        await importPrivateKey(args),
        args['key-id'] ? { keyId: args['key-id'] } : {}
      )
      const output = await writeJsonOutput(
        args.output,
        serializePluginCatalog(catalog),
        PLUGIN_CATALOG_LIMITS.maxJsonBytes,
        'Signed plugin catalog'
      )
      const report = { catalog, output }
      if (args.json) printJson(report)
      else {
        printArtifact(
          'Built signed plugin catalog',
          catalog.catalogId,
          {
            ...catalogDetails(catalog, catalog.integrity.digest),
            keyId: catalog.integrity.signature.keyId
          },
          output
        )
      }
    })
  }
})

const verify = defineCommand({
  meta: { description: 'Verify a signed plugin catalog root, identity, and validity window' },
  args: {
    catalog: {
      type: 'positional',
      required: true,
      description: 'Signed plugin catalog JSON path'
    },
    ...publicKeyArgs,
    'catalog-id': { type: 'string', description: 'Expected trusted catalog id' },
    'key-id': { type: 'string', description: 'Expected trusted catalog root key id' },
    now: { type: 'string', description: 'Verification time as a canonical UTC timestamp' },
    'max-clock-skew-ms': {
      type: 'string',
      description: 'Bounded non-negative clock skew allowance in milliseconds'
    },
    json: jsonArg
  },
  async run({ args }) {
    await runPluginCommandSafely(async () => {
      const catalog = await readBoundedJson(
        args.catalog,
        PLUGIN_CATALOG_LIMITS.maxJsonBytes,
        'Plugin catalog'
      )
      const maxClockSkewMilliseconds = optionalNonNegativeInteger(
        args['max-clock-skew-ms'],
        '--max-clock-skew-ms'
      )
      const now = args.now ? parsePluginTrustTimestamp(args.now, '--now') : undefined
      const snapshot = await verifyPluginCatalog(catalog, await importPublicKey(args), {
        ...(args['catalog-id'] ? { expectedCatalogId: args['catalog-id'] } : {}),
        ...(args['key-id'] ? { expectedKeyId: args['key-id'] } : {}),
        ...(now ? { now } : {}),
        ...(maxClockSkewMilliseconds === undefined ? {} : { maxClockSkewMilliseconds })
      })
      if (args.json) printJson(snapshot)
      else {
        printArtifact('Verified plugin catalog', snapshot.catalog.catalogId, {
          ...catalogDetails(snapshot.catalog, snapshot.verifiedDigest),
          keyId: snapshot.verifiedKeyId,
          verifiedAt: snapshot.verifiedAt,
          diagnostics: snapshot.diagnostics.length
        })
      }
    })
  }
})

export default defineCommand({
  meta: { description: 'Build and verify signed plugin catalog indexes' },
  subCommands: { build, verify }
})
