#!/usr/bin/env bun
import { stat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { info } from 'agentfmt'
import { defineCommand, runMain } from 'citty'

import { importEd25519PrivateKeyPem, importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { createFileMarketplaceArtifactStore } from './artifacts'
import {
  idStatusTransitionArgs,
  pluginStatusTransitionArgs,
  privateKeyArgs,
  publicKeyArgs,
  publisherKeyValidityArgs,
  publisherSigningKeyArgs,
  storageArgs,
  type PrivateKeyArguments,
  type PublicKeyArguments,
  type PublisherKeyArguments,
  type PublisherKeyMutationArguments,
  type StatusTransitionArguments,
  type StorageArguments
} from './cli-args'
import { printMarketplaceCliOutput as print } from './cli-output'
import { createMarketplaceHttpApp } from './http'
import { positiveMarketplacePort, resolveMarketplaceServeMode } from './serve-mode'
import { createMarketplaceService, type MarketplaceRootTrust } from './service'
import {
  createSqliteMarketplaceRepository,
  type SqliteMarketplaceRepository
} from './sqlite-repository'
import {
  parseMarketplaceListingMetadata,
  type MarketplaceOwnershipStatus,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherStatus,
  type MarketplaceSubmissionStatus
} from './types'

const MAX_JSON_BYTES = 4 * 1024 * 1024
const MAX_KEY_BYTES = 32 * 1024
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

interface OpenMarketplace {
  repository: SqliteMarketplaceRepository
  service: ReturnType<typeof createMarketplaceService>
}

type MarketplaceService = OpenMarketplace['service']

async function boundedFile(path: string, maximum: number, label: string): Promise<Uint8Array> {
  const absolute = resolve(path)
  const metadata = await stat(absolute)
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximum) {
    throw new Error(`${label} must be a non-empty file no larger than ${maximum} bytes`)
  }
  const bytes = new Uint8Array(await readFile(absolute))
  if (bytes.byteLength > maximum) throw new Error(`${label} exceeds ${maximum} bytes`)
  return bytes
}

async function boundedText(path: string, maximum: number, label: string): Promise<string> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(await boundedFile(path, maximum, label))
  } catch (error) {
    if (error instanceof Error && error.message.includes(label)) throw error
    throw new Error(`${label} must contain valid UTF-8`)
  }
}

async function boundedJson(path: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await boundedText(path, MAX_JSON_BYTES, label))
  } catch (error) {
    if (error instanceof Error && error.message.includes('must contain valid UTF-8')) throw error
    throw new Error(`${label} must contain valid JSON`)
  }
}

function environmentValue(name: string, label: string): string {
  if (!ENVIRONMENT_NAME.test(name)) {
    throw new Error(`${label} environment reference must be a valid variable name`)
  }
  const value = process.env[name]
  if (!value) throw new Error(`${label} environment variable ${name} is not set`)
  return value
}

async function referencedKey(
  file: string | undefined,
  environment: string | undefined,
  label: string
): Promise<string> {
  if ((file ? 1 : 0) + (environment ? 1 : 0) !== 1) {
    throw new Error(`Provide exactly one ${label} file or named environment variable`)
  }
  const value = file
    ? await boundedText(file, MAX_KEY_BYTES, label)
    : environmentValue(environment as string, label)
  if (new TextEncoder().encode(value).byteLength > MAX_KEY_BYTES) {
    throw new Error(`${label} exceeds ${MAX_KEY_BYTES} bytes`)
  }
  return value
}

async function privateKey(args: PrivateKeyArguments): Promise<CryptoKey> {
  try {
    return await importEd25519PrivateKeyPem(
      await referencedKey(args['private-key'], args['private-key-env'], 'private key')
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Provide exactly')) throw error
    throw new Error('Private key reference does not contain a valid Ed25519 PKCS8 key')
  }
}

async function publicKey(args: PublicKeyArguments): Promise<CryptoKey> {
  try {
    return await importEd25519PublicKeyPem(
      await referencedKey(args['public-key'], args['public-key-env'], 'public key')
    )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Provide exactly')) throw error
    throw new Error('Public key reference does not contain a valid Ed25519 SPKI key')
  }
}

function actor(value: string | undefined): string {
  return value ?? 'admin:cli'
}

function rootKeyId(value: string | undefined, marketplaceId: string): string {
  return value ?? `${marketplaceId}-root`
}

function openMarketplace(args: StorageArguments, root?: MarketplaceRootTrust): OpenMarketplace {
  const repository = createSqliteMarketplaceRepository({ path: args.database })
  return {
    repository,
    service: createMarketplaceService({
      repository,
      artifacts: createFileMarketplaceArtifactStore(args.artifacts),
      marketplaceId: args['marketplace-id'],
      publicBaseUrl: args['public-base-url'],
      ...(root ? { root } : {})
    })
  }
}

async function withMarketplace<Value>(
  args: StorageArguments,
  operation: (marketplace: OpenMarketplace) => Promise<Value>,
  root?: MarketplaceRootTrust
): Promise<Value> {
  const marketplace = openMarketplace(args, root)
  try {
    return await operation(marketplace)
  } finally {
    await marketplace.repository.close()
  }
}

async function publisherKeyInput(args: PublisherKeyArguments) {
  return {
    keyId: args['key-id'],
    publicKeyPem: await boundedText(args['public-key'], MAX_KEY_BYTES, 'publisher public key'),
    notBefore: args['not-before'],
    notAfter: args['not-after']
  }
}

async function runPublisherKeyMutation<Value>(
  args: PublisherKeyMutationArguments,
  operation: (
    service: MarketplaceService,
    key: Awaited<ReturnType<typeof publisherKeyInput>>,
    context: { actor: string }
  ) => Promise<Value>,
  label?: string
): Promise<void> {
  const key = await publisherKeyInput(args)
  await withMarketplace(args, async ({ service }) => {
    print(args.json, await operation(service, key, { actor: actor(args.actor) }), label)
  })
}

function statusTransitionContext(args: StatusTransitionArguments) {
  return {
    actor: actor(args.actor),
    ...(args.reason ? { reason: args.reason } : {})
  }
}

async function runStatusTransition<Value>(
  args: StatusTransitionArguments,
  operation: (
    service: MarketplaceService,
    context: ReturnType<typeof statusTransitionContext>
  ) => Promise<Value>
): Promise<void> {
  await withMarketplace(args, async ({ service }) => {
    print(args.json, await operation(service, statusTransitionContext(args)))
  })
}

const init = defineCommand({
  meta: { name: 'init', description: 'Initialize local marketplace state and artifact storage' },
  args: storageArgs,
  async run({ args }) {
    await withMarketplace(args, async ({ service }) => {
      const state = await service.snapshot()
      print(args.json, {
        database: resolve(args.database),
        artifacts: resolve(args.artifacts),
        marketplaceId: args['marketplace-id'],
        schemaVersion: state.schemaVersion
      })
    })
  }
})

const publisherCreate = defineCommand({
  meta: {
    name: 'create',
    description: 'Create a pending publisher with its proof-of-possession key'
  },
  args: {
    ...storageArgs,
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    ...publisherSigningKeyArgs,
    ...publisherKeyValidityArgs,
    actor: { type: 'string' }
  },
  async run({ args }) {
    await runPublisherKeyMutation(args, (service, key, context) =>
      service.registerPublisher(
        {
          publisher: { id: args.id, displayName: args.name },
          key: { ...key, publisherId: args.id }
        },
        context
      )
    )
  }
})

const publisherStatus = defineCommand({
  meta: { name: 'status', description: 'Review or suspend a publisher' },
  args: idStatusTransitionArgs,
  async run({ args }) {
    await runStatusTransition(args, (service, context) =>
      service.transitionPublisher(args.id, args.status as MarketplacePublisherStatus, context)
    )
  }
})

const publisherKeyRegister = defineCommand({
  meta: { name: 'key-register', description: 'Register a pending publisher key rotation' },
  args: {
    ...storageArgs,
    publisher: { type: 'string', required: true },
    ...publisherSigningKeyArgs,
    predecessor: { type: 'string', required: true },
    ...publisherKeyValidityArgs,
    actor: { type: 'string' }
  },
  async run({ args }) {
    await runPublisherKeyMutation(
      args,
      (service, key, context) =>
        service.registerPublisherKey(
          {
            ...key,
            publisherId: args.publisher,
            predecessorKeyId: args.predecessor
          },
          context
        ),
      'Registered publisher key'
    )
  }
})

const publisherKeyStatus = defineCommand({
  meta: { name: 'key-status', description: 'Activate, reject, or revoke a publisher key' },
  args: idStatusTransitionArgs,
  async run({ args }) {
    await runStatusTransition(args, (service, context) =>
      service.transitionPublisherKey(args.id, args.status as MarketplacePublisherKeyStatus, context)
    )
  }
})

const ownershipRequest = defineCommand({
  meta: {
    name: 'ownership-request',
    description: 'Request immutable plugin ownership for a publisher'
  },
  args: {
    ...storageArgs,
    plugin: { type: 'string', required: true },
    publisher: { type: 'string', required: true },
    actor: { type: 'string' }
  },
  async run({ args }) {
    await withMarketplace(args, async ({ service }) => {
      print(
        args.json,
        await service.requestOwnership(args.plugin, args.publisher, {
          actor: actor(args.actor)
        })
      )
    })
  }
})

const ownershipStatus = defineCommand({
  meta: {
    name: 'ownership-status',
    description: 'Review or revoke immutable plugin ownership'
  },
  args: pluginStatusTransitionArgs,
  async run({ args }) {
    await runStatusTransition(args, (service, context) =>
      service.transitionOwnership(args.plugin, args.status as MarketplaceOwnershipStatus, context)
    )
  }
})

const publisher = defineCommand({
  meta: { name: 'publisher', description: 'Manage marketplace publishers, keys, and ownership' },
  subCommands: {
    create: publisherCreate,
    status: publisherStatus,
    'key-register': publisherKeyRegister,
    'key-status': publisherKeyStatus,
    'ownership-request': ownershipRequest,
    'ownership-status': ownershipStatus
  }
})

const submissionImport = defineCommand({
  meta: { name: 'import', description: 'Verify and import a signed plugin submission' },
  args: {
    ...storageArgs,
    id: { type: 'string', required: true },
    publisher: { type: 'string', required: true },
    channel: { type: 'string', required: true },
    manifest: { type: 'string', required: true },
    listing: { type: 'string', required: true },
    runtime: { type: 'string' },
    actor: { type: 'string' }
  },
  async run({ args }) {
    const manifest = await boundedJson(args.manifest, 'plugin manifest')
    const listing = parseMarketplaceListingMetadata(
      await boundedJson(args.listing, 'plugin listing')
    )
    const runtimePackage = args.runtime
      ? await boundedJson(args.runtime, 'plugin runtime package')
      : undefined
    await withMarketplace(args, async ({ service }) => {
      print(
        args.json,
        await service.submit(
          {
            id: args.id,
            publisherId: args.publisher,
            channel: args.channel as 'stable' | 'beta',
            manifest,
            listing,
            ...(runtimePackage === undefined ? {} : { runtimePackage })
          },
          { actor: actor(args.actor) }
        )
      )
    })
  }
})

const submissionList = defineCommand({
  meta: { name: 'list', description: 'List marketplace submissions' },
  args: storageArgs,
  async run({ args }) {
    await withMarketplace(args, async ({ service }) =>
      print(args.json, (await service.snapshot()).submissions, 'Submissions')
    )
  }
})

const submission = defineCommand({
  meta: { name: 'submission', description: 'Import and inspect marketplace submissions' },
  subCommands: { import: submissionImport, list: submissionList }
})

const review = defineCommand({
  meta: { name: 'review', description: 'Move a submission through the review state machine' },
  args: idStatusTransitionArgs,
  async run({ args }) {
    await runStatusTransition(args, (service, context) =>
      service.transitionSubmission(args.id, args.status as MarketplaceSubmissionStatus, context)
    )
  }
})

const publish = defineCommand({
  meta: {
    name: 'publish',
    description: 'Build immutable catalogs and publish a root-signed marketplace snapshot'
  },
  args: {
    ...storageArgs,
    ...privateKeyArgs,
    ...publicKeyArgs,
    'root-key-id': { type: 'string' },
    actor: { type: 'string' }
  },
  async run({ args }) {
    const root: MarketplaceRootTrust = {
      keyId: rootKeyId(args['root-key-id'], args['marketplace-id']),
      privateKey: await privateKey(args),
      publicKey: await publicKey(args)
    }
    await withMarketplace(
      args,
      async ({ service }) => {
        const result = await service.publish({ actor: actor(args.actor) })
        print(args.json, result.publication, 'Published marketplace')
      },
      root
    )
  }
})

const audit = defineCommand({
  meta: { name: 'audit', description: 'Load, verify, and print the append-only audit chain' },
  args: storageArgs,
  async run({ args }) {
    await withMarketplace(args, async ({ service }) => {
      const events = (await service.snapshot()).auditEvents
      print(args.json, { events, head: events.at(-1)?.eventHash ?? null }, 'Verified audit')
    })
  }
})

const serve = defineCommand({
  meta: {
    name: 'serve',
    description: 'Serve the marketplace API with publisher request authentication'
  },
  args: {
    ...storageArgs,
    ...privateKeyArgs,
    ...publicKeyArgs,
    'root-key-id': { type: 'string' },
    'enable-admin': {
      type: 'boolean',
      default: false,
      description: 'Opt in to loopback-only admin mutation routes'
    },
    'enable-online-signing': {
      type: 'boolean',
      default: false,
      description: 'Opt in to loading the root private key and exposing loopback admin publish'
    },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '43121' },
    'admin-token-env': {
      type: 'string',
      default: 'OPENPENCIL_MARKETPLACE_ADMIN_TOKEN',
      description: 'Named environment variable containing the admin bearer token'
    }
  },
  async run({ args }) {
    const mode = resolveMarketplaceServeMode(
      args.host,
      args['enable-admin'],
      args['enable-online-signing']
    )
    const token = mode.adminEnabled
      ? environmentValue(args['admin-token-env'], 'admin token')
      : undefined
    if (token !== undefined && (token.length < 32 || token.length > 512)) {
      throw new Error('Admin token must contain between 32 and 512 characters')
    }
    if (!mode.onlineSigning && (args['private-key'] || args['private-key-env'])) {
      throw new Error('Private key references require explicit --enable-online-signing')
    }
    const root: MarketplaceRootTrust = {
      keyId: rootKeyId(args['root-key-id'], args['marketplace-id']),
      publicKey: await publicKey(args),
      ...(mode.onlineSigning ? { privateKey: await privateKey(args) } : {})
    }
    const marketplace = openMarketplace(args, root)
    const app = createMarketplaceHttpApp({
      service: marketplace.service,
      nonces: marketplace.repository.nonces,
      admin: {
        enabled: mode.adminEnabled,
        ...(token === undefined ? {} : { token }),
        onlinePublishing: mode.onlineSigning
      }
    })
    const server = Bun.serve({
      hostname: args.host,
      port: positiveMarketplacePort(args.port),
      fetch: app.fetch
    })
    process.stdout.write(
      `${info(`OpenPencil marketplace listening on http://${args.host}:${server.port} (admin HTTP ${mode.adminEnabled ? 'enabled' : 'disabled'}, online signing ${mode.onlineSigning ? 'enabled' : 'disabled'})`)}\n`
    )
    await new Promise<void>((resolvePromise) => {
      process.once('SIGINT', resolvePromise)
      process.once('SIGTERM', resolvePromise)
    })
    await server.stop(true)
    await marketplace.repository.close()
  }
})

export const marketplaceCommand = defineCommand({
  meta: {
    name: 'openpencil-marketplace',
    version: '0.0.0',
    description: 'Operate the local-first OpenPencil plugin marketplace control plane'
  },
  subCommands: { init, publisher, submission, review, publish, audit, serve }
})

if (import.meta.main) await runMain(marketplaceCommand)
