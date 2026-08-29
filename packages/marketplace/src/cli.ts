#!/usr/bin/env bun
/* eslint-disable max-lines -- The operator CLI keeps the complete review/sign/import ceremony visible in one command registry. */
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { info } from 'agentfmt'
import { defineCommand, runMain } from 'citty'

import { importEd25519PrivateKeyPem, importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { createFileMarketplaceArtifactStore, type MarketplaceArtifactStore } from './artifacts'
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
import { printMarketplaceCLIOutput as print } from './cli-output'
import { createMarketplaceHttpApp } from './http'
import {
  createFileMarketplaceOfflineSignerPolicyStore,
  initializeFileMarketplaceOfflineSignerPolicyStore
} from './offline-signer-policy-store'
import { prepareMarketplacePublicationProjection } from './publication'
import {
  MARKETPLACE_PUBLICATION_HANDOFF_LIMITS,
  createMarketplacePublicationHandoff,
  openMarketplacePublicationHandoff,
  parseMarketplacePublicationHandoffBytes,
  writeMarketplacePublicationHandoffFile
} from './publication/handoff'
import {
  MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS,
  createMarketplaceOfflineSignerPolicy,
  createMarketplaceSignedPublicationBundle,
  importMarketplaceSignedPublicationBundle,
  loadMarketplacePreviousPublicationEvidence,
  parseMarketplaceSignedPublicationBundleBytes,
  serializeMarketplaceSignedPublicationBundle,
  signMarketplacePublicationRequest,
  verifyMarketplacePreviousPublicationEvidence
} from './publication/offline'
import {
  MARKETPLACE_PUBLICATION_REQUEST_PURPOSES,
  createMarketplacePublicationRequest,
  marketplacePublicationRequestBytes,
  marketplacePublicationRequestDigest,
  type MarketplacePublicationRequestPurpose
} from './publication/request'
import { marketplacePublicationReservationFromRequest } from './publication/reservation'
import {
  MARKETPLACE_PUBLISHER_REQUEST_MAX_BODY_BYTES,
  createMarketplacePublisherSignedEnvelope,
  marketplacePublisherRequestBodyDigest,
  writeMarketplacePublisherSignedEnvelope,
  type MarketplacePublisherRequestOperation
} from './publisher/request'
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
  artifacts: MarketplaceArtifactStore
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

async function boundedJSON(path: string, label: string): Promise<unknown> {
  return boundedJSONFile(path, MAX_JSON_BYTES, label)
}

async function boundedJSONFile(path: string, maximum: number, label: string): Promise<unknown> {
  try {
    return JSON.parse(await boundedText(path, maximum, label))
  } catch (error) {
    if (error instanceof Error && error.message.includes('must contain valid UTF-8')) throw error
    throw new Error(`${label} must contain valid JSON`)
  }
}

async function writeExclusiveText(path: string, text: string, label: string): Promise<string> {
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true, mode: 0o700 })
  let created = false
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(absolute, 'wx', 0o600)
    created = true
    await handle.writeFile(text, 'utf8')
    await handle.sync()
    return absolute
  } catch (cause) {
    if (created) await unlink(absolute).catch(() => undefined)
    const code = (cause as NodeJS.ErrnoException).code
    if (code === 'EEXIST') throw new Error(`${label} already exists: ${absolute}`)
    throw cause
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function publicationPurpose(value: string): MarketplacePublicationRequestPurpose {
  if (!(MARKETPLACE_PUBLICATION_REQUEST_PURPOSES as readonly string[]).includes(value)) {
    throw new Error(
      `Publication purpose must be one of ${MARKETPLACE_PUBLICATION_REQUEST_PURPOSES.join(', ')}`
    )
  }
  return value as MarketplacePublicationRequestPurpose
}

function approvedDigest(actual: string, approved: string, label: string): void {
  if (approved !== actual) {
    throw new Error(`${label} approval digest does not match the exact reviewed bytes`)
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

function assertOwnerOnlyPrivateKeyMetadata(metadata: Stats): void {
  const userId = process.getuid?.()
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    metadata.size <= 0 ||
    metadata.size > MAX_KEY_BYTES ||
    (userId !== undefined && metadata.uid !== userId) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(
      `Private-key file must be a non-empty, owner-only regular file with one link and no more than ${MAX_KEY_BYTES} bytes`
    )
  }
}

function samePrivateKeyFile(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

async function ownerOnlyPrivateKeyText(path: string): Promise<string> {
  if (process.platform === 'win32') {
    throw new Error(
      'Private-key file permissions cannot be verified on Windows; use a named environment variable'
    )
  }
  const absolute = resolve(path)
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    const pathBeforeOpen = await lstat(absolute)
    assertOwnerOnlyPrivateKeyMetadata(pathBeforeOpen)
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    const beforeRead = await handle.stat()
    assertOwnerOnlyPrivateKeyMetadata(beforeRead)
    if (!samePrivateKeyFile(pathBeforeOpen, beforeRead)) {
      throw new Error('Private-key file changed while it was opened')
    }
    const boundedBytes = new Uint8Array(beforeRead.size + 1)
    let byteLength = 0
    while (byteLength < boundedBytes.byteLength) {
      const { bytesRead } = await handle.read(
        boundedBytes,
        byteLength,
        boundedBytes.byteLength - byteLength,
        byteLength
      )
      if (bytesRead === 0) break
      byteLength += bytesRead
    }
    const afterRead = await handle.stat()
    const pathAfterRead = await lstat(absolute)
    assertOwnerOnlyPrivateKeyMetadata(afterRead)
    assertOwnerOnlyPrivateKeyMetadata(pathAfterRead)
    if (
      byteLength !== beforeRead.size ||
      byteLength !== afterRead.size ||
      !samePrivateKeyFile(beforeRead, afterRead) ||
      !samePrivateKeyFile(afterRead, pathAfterRead)
    ) {
      throw new Error('Private-key file changed while it was read')
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(boundedBytes.subarray(0, byteLength))
    } catch {
      throw new Error('Private-key file must contain valid UTF-8')
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function publisherRequestPrivateKey(args: PrivateKeyArguments): Promise<CryptoKey> {
  if ((args['private-key'] ? 1 : 0) + (args['private-key-env'] ? 1 : 0) !== 1) {
    throw new Error('Provide exactly one private key file or named environment variable')
  }
  const encoded = args['private-key']
    ? await ownerOnlyPrivateKeyText(args['private-key'])
    : environmentValue(args['private-key-env'] as string, 'private key')
  if (new TextEncoder().encode(encoded).byteLength > MAX_KEY_BYTES) {
    throw new Error(`Private key exceeds ${MAX_KEY_BYTES} bytes`)
  }
  try {
    return await importEd25519PrivateKeyPem(encoded)
  } catch {
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
  const artifacts = createFileMarketplaceArtifactStore(args.artifacts)
  return {
    repository,
    artifacts,
    service: createMarketplaceService({
      repository,
      artifacts,
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

const requestSign = defineCommand({
  meta: {
    name: 'sign',
    description: 'Create an exact local Publisher signed-request envelope without sending it'
  },
  args: {
    operation: { type: 'string', required: true },
    audience: { type: 'string', required: true },
    publisher: { type: 'string', required: true },
    'key-id': { type: 'string', required: true },
    body: { type: 'string', required: true },
    submission: { type: 'string' },
    output: { type: 'string', required: true },
    ...privateKeyArgs
  },
  async run({ args }) {
    const body = await boundedFile(
      args.body,
      MARKETPLACE_PUBLISHER_REQUEST_MAX_BODY_BYTES,
      'publisher request body'
    )
    const envelope = await createMarketplacePublisherSignedEnvelope(
      {
        operation: args.operation as MarketplacePublisherRequestOperation,
        audience: args.audience,
        publisherId: args.publisher,
        keyId: args['key-id'],
        body,
        ...(args.submission ? { submissionId: args.submission } : {})
      },
      await publisherRequestPrivateKey(args)
    )
    const output = resolve(args.output)
    await writeMarketplacePublisherSignedEnvelope(output, envelope)
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        operation: envelope.operation,
        target: envelope.target,
        bodyDigest: marketplacePublisherRequestBodyDigest(body),
        output,
        signedAt: envelope.headers.timestamp
      })}\n`
    )
  }
})

const request = defineCommand({
  meta: {
    name: 'request',
    description: 'Prepare Publisher-authenticated requests for an identity-aware server hand-off'
  },
  subCommands: { sign: requestSign }
})

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
    const manifest = await boundedJSON(args.manifest, 'plugin manifest')
    const listing = parseMarketplaceListingMetadata(
      await boundedJSON(args.listing, 'plugin listing')
    )
    const runtimePackage = args.runtime
      ? await boundedJSON(args.runtime, 'plugin runtime package')
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

async function publicationHandoff(path: string) {
  const encoded = await boundedFile(
    path,
    MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxJsonBytes,
    'publication handoff'
  )
  return openMarketplacePublicationHandoff(parseMarketplacePublicationHandoffBytes(encoded))
}

const publicationRequestCreate = defineCommand({
  meta: {
    name: 'request',
    description: 'Freeze one exact online state and signer-independent publication review'
  },
  args: {
    ...storageArgs,
    ...publicKeyArgs,
    'root-key-id': { type: 'string' },
    purpose: { type: 'string', default: 'routine' },
    'emergency-plan': {
      type: 'string',
      description: 'Explicit reviewed shrink-only projection for emergency-revocation'
    },
    output: { type: 'string', required: true }
  },
  async run({ args }) {
    const purpose = publicationPurpose(args.purpose)
    if ((purpose === 'emergency-revocation') !== Boolean(args['emergency-plan'])) {
      throw new Error(
        'Exactly emergency-revocation requests require an explicit --emergency-plan projection'
      )
    }
    const rootPublicKey = await publicKey(args)
    await withMarketplace(args, async ({ repository, artifacts }) => {
      const state = await repository.snapshot()
      const previousPublication = await loadMarketplacePreviousPublicationEvidence(state, artifacts)
      const authority = {
        marketplaceId: args['marketplace-id'],
        rootKeyId: rootKeyId(args['root-key-id'], args['marketplace-id']),
        publicBaseUrl: args['public-base-url']
      }
      const baseline = previousPublication
        ? await verifyMarketplacePreviousPublicationEvidence(
            { state, previousPublication, ...authority },
            rootPublicKey
          )
        : null
      const derivedPlan = await prepareMarketplacePublicationProjection(state, artifacts, authority)
      const plan = args['emergency-plan']
        ? await boundedJSONFile(
            args['emergency-plan'],
            MARKETPLACE_PUBLICATION_HANDOFF_LIMITS.maxRequestJsonBytes,
            'emergency publication plan'
          )
        : derivedPlan
      const request = createMarketplacePublicationRequest({
        state,
        purpose,
        baseline,
        plan: plan as typeof derivedPlan,
        ...authority
      })
      const handoff = createMarketplacePublicationHandoff({ request, state })
      const output = await writeMarketplacePublicationHandoffFile(args.output, handoff)
      const reservation = await repository.reservePublication(
        marketplacePublicationReservationFromRequest(request)
      )
      print(args.json, {
        output,
        reservation: reservation.source,
        purpose,
        sequence: request.expectedNextSequence,
        requestDigest: marketplacePublicationRequestDigest(request),
        stateDigest: request.stateDigest,
        reviewChanges: request.review.changes.length
      })
    })
  }
})

const publicationInspect = defineCommand({
  meta: { name: 'inspect', description: 'Inspect an exact offline publication handoff' },
  args: {
    handoff: { type: 'string', required: true },
    json: { type: 'boolean', default: false }
  },
  async run({ args }) {
    const opened = await publicationHandoff(args.handoff)
    print(args.json, {
      marketplaceId: opened.request.marketplaceId,
      rootKeyId: opened.request.rootKeyId,
      publicBaseUrl: opened.request.publicBaseUrl,
      purpose: opened.request.purpose,
      sequence: opened.request.expectedNextSequence,
      requestDigest: marketplacePublicationRequestDigest(opened.request),
      stateDigest: opened.request.stateDigest,
      generatedAt: opened.request.generatedAt,
      expiresAt: opened.request.expiresAt,
      changes: opened.request.review.changes
    })
  }
})

const publicationReserve = defineCommand({
  meta: {
    name: 'reserve',
    description: 'Idempotently reserve the exact online state captured by an existing handoff'
  },
  args: {
    ...storageArgs,
    handoff: { type: 'string', required: true }
  },
  async run({ args }) {
    const opened = await publicationHandoff(args.handoff)
    if (
      opened.request.marketplaceId !== args['marketplace-id'] ||
      opened.request.publicBaseUrl !== new URL(args['public-base-url']).href
    ) {
      throw new Error('Publication handoff authority does not match the selected marketplace')
    }
    await withMarketplace(args, async ({ repository }) => {
      const execution = await repository.reservePublication(
        marketplacePublicationReservationFromRequest(opened.request)
      )
      print(args.json, {
        source: execution.source,
        requestDigest: execution.reservation.requestDigest,
        stateDigest: execution.reservation.stateDigest,
        sequence: execution.reservation.expectedNextSequence
      })
    })
  }
})

const publicationCancel = defineCommand({
  meta: {
    name: 'cancel',
    description: 'Explicitly cancel one exact stuck publication reservation with audit evidence'
  },
  args: {
    ...storageArgs,
    'approve-request-digest': { type: 'string', required: true },
    reason: { type: 'string', required: true },
    actor: { type: 'string' }
  },
  async run({ args }) {
    await withMarketplace(args, async ({ repository }) => {
      const reservation = await repository.inspectPublicationReservation()
      if (!reservation) throw new Error('No active publication reservation exists')
      approvedDigest(
        reservation.requestDigest,
        args['approve-request-digest'],
        'Publication cancellation request'
      )
      const event = await repository.cancelPublication(
        reservation,
        args['approve-request-digest'],
        {
          actor: actor(args.actor),
          reason: args.reason,
          correlationId: reservation.requestDigest
        }
      )
      print(args.json, {
        cancelled: true,
        requestDigest: reservation.requestDigest,
        stateDigest: reservation.stateDigest,
        sequence: reservation.expectedNextSequence,
        auditSequence: event.sequence,
        auditHead: event.eventHash
      })
    })
  }
})

const publicationSignerInit = defineCommand({
  meta: {
    name: 'signer-init',
    description: 'Pin the first reviewed state and Root authority in an owner-only signer policy'
  },
  args: {
    handoff: { type: 'string', required: true },
    policy: { type: 'string', required: true },
    'approve-state-digest': { type: 'string', required: true },
    ...publicKeyArgs,
    json: { type: 'boolean', default: false }
  },
  async run({ args }) {
    const opened = await publicationHandoff(args.handoff)
    approvedDigest(
      opened.request.stateDigest,
      args['approve-state-digest'],
      'Signer bootstrap state'
    )
    const policy = await createMarketplaceOfflineSignerPolicy({
      marketplaceId: opened.request.marketplaceId,
      rootKeyId: opened.request.rootKeyId,
      publicBaseUrl: opened.request.publicBaseUrl,
      rootPublicKey: await publicKey(args),
      bootstrapState: opened.state
    })
    await initializeFileMarketplaceOfflineSignerPolicyStore(args.policy, policy)
    print(args.json, {
      policy: resolve(args.policy),
      marketplaceId: policy.marketplaceId,
      rootKeyId: policy.rootKeyId,
      stateDigest: policy.bootstrap.stateDigest,
      auditSequence: policy.bootstrap.auditSequence,
      auditHead: policy.bootstrap.auditHead
    })
  }
})

const publicationSign = defineCommand({
  meta: { name: 'sign', description: 'Sign one exact reviewed handoff with the offline Root key' },
  args: {
    handoff: { type: 'string', required: true },
    artifacts: { type: 'string', required: true },
    policy: { type: 'string', required: true },
    output: { type: 'string', required: true },
    'approve-request-digest': { type: 'string', required: true },
    ...privateKeyArgs,
    ...publicKeyArgs,
    json: { type: 'boolean', default: false }
  },
  async run({ args }) {
    const opened = await publicationHandoff(args.handoff)
    const requestDigest = marketplacePublicationRequestDigest(opened.request)
    approvedDigest(requestDigest, args['approve-request-digest'], 'Publication request')
    const artifacts = createFileMarketplaceArtifactStore(args.artifacts)
    const previousPublication = await loadMarketplacePreviousPublicationEvidence(
      opened.state,
      artifacts
    )
    const signed = await signMarketplacePublicationRequest({
      requestBytes: marketplacePublicationRequestBytes(opened.request),
      state: opened.state,
      previousPublication,
      rootPublicKey: await publicKey(args),
      rootPrivateKey: await publisherRequestPrivateKey(args),
      artifacts,
      policyStore: createFileMarketplaceOfflineSignerPolicyStore(args.policy)
    })
    const output = await writeExclusiveText(
      args.output,
      serializeMarketplaceSignedPublicationBundle(createMarketplaceSignedPublicationBundle(signed)),
      'signed publication bundle output'
    )
    print(args.json, {
      output,
      sequence: signed.sequence,
      requestDigest: signed.requestDigest,
      stateDigest: signed.stateDigest,
      snapshotDigest: signed.record.snapshotDigest,
      snapshotArtifactDigest: signed.record.snapshotArtifactDigest
    })
  }
})

const publicationImport = defineCommand({
  meta: {
    name: 'import',
    description: 'Verify and atomically import one Root-authorized signed publication bundle'
  },
  args: {
    ...storageArgs,
    bundle: { type: 'string', required: true },
    ...publicKeyArgs,
    actor: { type: 'string' }
  },
  async run({ args }) {
    const bundle = parseMarketplaceSignedPublicationBundleBytes(
      await boundedFile(
        args.bundle,
        MARKETPLACE_SIGNED_PUBLICATION_BUNDLE_LIMITS.maxJsonBytes,
        'signed publication bundle'
      )
    )
    const rootPublicKey = await publicKey(args)
    await withMarketplace(args, async ({ repository, artifacts }) => {
      const imported = await importMarketplaceSignedPublicationBundle({
        bundle,
        repository,
        artifacts,
        rootPublicKey,
        actor: actor(args.actor)
      })
      print(args.json, imported.publication, 'Imported marketplace publication')
    })
  }
})

const publication = defineCommand({
  meta: {
    name: 'publication',
    description: 'Operate the reserved online review, offline Root signer, and import workflow'
  },
  subCommands: {
    request: publicationRequestCreate,
    reserve: publicationReserve,
    cancel: publicationCancel,
    inspect: publicationInspect,
    'signer-init': publicationSignerInit,
    sign: publicationSign,
    import: publicationImport
  }
})

const publish = defineCommand({
  meta: {
    name: 'publish',
    description: 'Deprecated direct Root-signing entrypoint (always fails closed)'
  },
  args: {
    ...storageArgs,
    ...privateKeyArgs,
    ...publicKeyArgs,
    'root-key-id': { type: 'string' },
    actor: { type: 'string' }
  },
  run() {
    throw new Error(
      'Direct marketplace publishing is disabled; use publication request, inspect, signer-init/sign, then publication import'
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
      description: 'Opt in to loopback-only admin routes'
    },
    'enable-online-signing': {
      type: 'boolean',
      default: false,
      description: 'Deprecated compatibility flag; online HTTP root signing is disabled'
    },
    'require-admin-assertion': {
      type: 'boolean',
      default: false,
      description:
        'Require versioned Portal assertions for admin reads; mutations always require V2 operator assertions'
    },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '43121' },
    'admin-token-env': {
      type: 'string',
      default: 'OPENPENCIL_MARKETPLACE_ADMIN_TOKEN',
      description:
        'Named environment variable containing the assertion secret (legacy bearer reads only)'
    }
  },
  async run({ args }) {
    const mode = resolveMarketplaceServeMode(
      args.host,
      args['enable-admin'],
      args['enable-online-signing']
    )
    if (mode.onlineSigning) {
      throw new Error(
        'Online marketplace signing over HTTP is disabled; use the publication request/sign/import workflow'
      )
    }
    const token = mode.adminEnabled
      ? environmentValue(args['admin-token-env'], 'admin token')
      : undefined
    if (token !== undefined && (token.length < 32 || token.length > 512)) {
      throw new Error('Admin token must contain between 32 and 512 characters')
    }
    if (args['private-key'] || args['private-key-env']) {
      throw new Error(
        'Marketplace serve does not accept private keys; use the offline publication signer'
      )
    }
    const root: MarketplaceRootTrust = {
      keyId: rootKeyId(args['root-key-id'], args['marketplace-id']),
      publicKey: await publicKey(args)
    }
    const marketplace = openMarketplace(args, root)
    const app = createMarketplaceHttpApp({
      service: marketplace.service,
      nonces: marketplace.repository.nonces,
      admin: {
        enabled: mode.adminEnabled,
        ...(token === undefined ? {} : { token }),
        requireServiceAssertion: args['require-admin-assertion']
      }
    })
    const server = Bun.serve({
      hostname: args.host,
      port: positiveMarketplacePort(args.port),
      fetch: app.fetch
    })
    process.stdout.write(
      `${info(`OpenPencil marketplace listening on http://${args.host}:${server.port} (admin HTTP ${mode.adminEnabled ? 'enabled' : 'disabled'}, online signing disabled)`)}\n`
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
  subCommands: { request, init, publisher, submission, review, publication, publish, audit, serve }
})

if (import.meta.main) await runMain(marketplaceCommand)
