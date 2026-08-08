import {
  parseMarketplaceSnapshotBytes,
  parsePluginRuntimePackage,
  pluginRuntimePackageCanonicalByteLength,
  searchMarketplaceListings,
  serializePluginManifest,
  serializePluginRuntimePackage,
  verifyMarketplaceSnapshot,
  verifyPluginPackage,
  verifyPluginRuntimePackage,
  type MarketplaceListingSearchOptions,
  type MarketplacePluginListingV1,
  type SignedMarketplaceSnapshotV1,
  type VerifiedMarketplaceSnapshot
} from '@open-pencil/core/plugins'
import {
  exportEd25519PublicKeyPem,
  importEd25519PublicKeyPem,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import type { MarketplaceArtifact, MarketplaceArtifactStore } from './artifacts'
import {
  prepareMarketplacePublication,
  type MarketplacePublicationConfig,
  type PreparedMarketplacePublication
} from './publication'
import { findActiveMarketplacePublisherKey } from './publisher-trust'
import type { MarketplaceRepository } from './repository'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplaceIdentity,
  parseMarketplaceListingMetadata,
  parseMarketplacePublicUrl,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceTimestamp,
  parseRegisterMarketplacePublisherKeyInput,
  type MarketplaceListingMetadataV1,
  type MarketplaceMutationContext,
  type MarketplaceOwnershipV1,
  type MarketplaceOwnershipStatus,
  type MarketplacePublicationV1,
  type MarketplacePublisherKeyV1,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherStatus,
  type MarketplacePublisherV1,
  type MarketplaceReleaseChannel,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceReleaseV1,
  type MarketplaceStateV1,
  type MarketplaceSubmissionStatus,
  type MarketplaceSubmissionV1,
  type RegisterMarketplacePublisherKeyInput
} from './types'

export interface MarketplaceRootTrust {
  keyId: string
  publicKey?: CryptoKey
  privateKey?: CryptoKey
}

export interface CreateMarketplaceServiceOptions {
  repository: MarketplaceRepository
  artifacts: MarketplaceArtifactStore
  marketplaceId: string
  publicBaseUrl: string
  root?: MarketplaceRootTrust
  now?: () => Date
  publicationValidityMilliseconds?: number
}

export interface RegisterMarketplacePublisherInput {
  publisher: { id: string; displayName: string }
  key: RegisterMarketplacePublisherKeyInput
}

export interface SubmitMarketplacePluginInput {
  id: string
  publisherId: string
  channel: MarketplaceReleaseChannel
  manifest: unknown
  listing: MarketplaceListingMetadataV1
  runtimePackage?: unknown
}

export interface MarketplaceService {
  snapshot(): Promise<MarketplaceStateV1>
  registerPublisher(
    input: RegisterMarketplacePublisherInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  registerPublisherKey(
    input: RegisterMarketplacePublisherKeyInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherKeyV1>
  transitionPublisher(
    publisherId: string,
    status: MarketplacePublisherStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  transitionPublisherKey(
    keyId: string,
    status: MarketplacePublisherKeyStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherKeyV1>
  requestOwnership(
    pluginId: string,
    publisherId: string,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceOwnershipV1>
  transitionOwnership(
    pluginId: string,
    status: MarketplaceOwnershipStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceOwnershipV1>
  submit(
    input: SubmitMarketplacePluginInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  transitionSubmission(
    submissionId: string,
    status: MarketplaceSubmissionStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  withdrawSubmission(
    submissionId: string,
    publisherId: string,
    reason: string,
    context: Omit<MarketplaceMutationContext, 'reason'>
  ): Promise<MarketplaceSubmissionV1>
  publishSubmission(
    submissionId: string,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceReleaseV1>
  yankRelease(
    coordinate: MarketplaceReleaseCoordinateV1,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceReleaseV1>
  publish(context: MarketplaceMutationContext): Promise<{
    publication: MarketplacePublicationV1
    prepared: PreparedMarketplacePublication
  }>
  resolveActivePublisherKey(publisherId: string, keyId: string): Promise<CryptoKey | null>
  artifact(digest: string): Promise<MarketplaceArtifact | null>
  latestSnapshotArtifact(): Promise<MarketplaceArtifact | null>
  latestSnapshot(): Promise<SignedMarketplaceSnapshotV1 | null>
  latestVerifiedSnapshot(): Promise<VerifiedMarketplaceSnapshot | null>
  latestCatalog(channel: MarketplaceReleaseChannel): Promise<MarketplaceArtifact | null>
  latestRuntimeIndex(): Promise<MarketplaceArtifact | null>
  search(
    options?: MarketplaceListingSearchOptions
  ): Promise<ReturnType<typeof searchMarketplaceListings>>
  listing(pluginId: string): Promise<MarketplacePluginListingV1 | null>
}

const encoder = new TextEncoder()

function currentTime(now: (() => Date) | undefined): string {
  const date = (now ?? (() => new Date()))()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Marketplace service clock must return a valid Date')
  }
  return parseMarketplaceTimestamp(date.toISOString(), 'marketplace service time')
}

function normalizedContext(
  context: MarketplaceMutationContext,
  fallbackTime: string
): MarketplaceMutationContext {
  return { ...context, time: context.time ?? fallbackTime }
}

function baseUrl(value: string): string {
  const parsed = new URL(parseMarketplacePublicUrl(value, 'marketplace public base URL'))
  if (parsed.pathname !== '/' || parsed.search !== '') {
    throw new TypeError('Marketplace public base URL must be an HTTPS origin')
  }
  return parsed.href
}

function artifactUrl(publicBaseUrl: string, digest: string): string {
  return new URL(`v1/artifacts/${digest}`, publicBaseUrl).href
}

function assertCategory(value: string, index: number): void {
  const reason = validateModuleIdentity(value, `marketplace listing category ${index}`)
  if (reason) throw new TypeError(reason)
}

function publicListing(value: MarketplaceListingMetadataV1): MarketplaceListingMetadataV1 {
  const listing = parseMarketplaceListingMetadata(value)
  if (listing.displayName.length > 128 || listing.summary.length > 512) {
    throw new TypeError('Marketplace listing name or summary exceeds the public snapshot limit')
  }
  if (listing.categories.length > 8) {
    throw new TypeError('Marketplace listing may contain at most 8 public categories')
  }
  listing.categories.forEach(assertCategory)
  const categories = [...listing.categories].sort()
  if (new Set(categories).size !== categories.length) {
    throw new TypeError('Marketplace listing categories must be unique')
  }
  return parseMarketplaceListingMetadata({ ...listing, categories })
}

function activePublisherKey(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string,
  at: number
) {
  const publisher = state.publishers.find(({ id }) => id === publisherId)
  if (publisher?.status !== 'active') throw new Error(`Publisher ${publisherId} is not active`)
  const ownership = (pluginId: string) =>
    state.ownerships.some(
      (candidate) =>
        candidate.pluginId === pluginId &&
        candidate.publisherId === publisherId &&
        candidate.status === 'active'
    )
  const key = findActiveMarketplacePublisherKey(state, publisherId, keyId, at)
  if (!key) {
    throw new Error(`Publisher key ${keyId} is not active at the submission time`)
  }
  return { key, ownership }
}

async function canonicalPublicKey(input: RegisterMarketplacePublisherKeyInput) {
  const parsed = parseRegisterMarketplacePublisherKeyInput(input)
  const publicKey = await importEd25519PublicKeyPem(parsed.publicKeyPem)
  if ((await exportEd25519PublicKeyPem(publicKey)) !== parsed.publicKeyPem) {
    throw new TypeError('Marketplace publisher key must use canonical Ed25519 SPKI PEM encoding')
  }
  return { input: parsed, publicKey }
}

function publicationConfig(
  options: CreateMarketplaceServiceOptions,
  root: MarketplaceRootTrust
): MarketplacePublicationConfig {
  if (!root.privateKey) throw new Error('Marketplace publication requires a root private key')
  return {
    marketplaceId: options.marketplaceId,
    rootKeyId: root.keyId,
    rootPrivateKey: root.privateKey,
    publicBaseUrl: options.publicBaseUrl,
    ...(options.now ? { now: options.now } : {}),
    ...(options.publicationValidityMilliseconds === undefined
      ? {}
      : { validityMilliseconds: options.publicationValidityMilliseconds })
  }
}

export function createMarketplaceService(
  options: CreateMarketplaceServiceOptions
): MarketplaceService {
  const marketplaceId = parseMarketplaceIdentity(options.marketplaceId, 'marketplace id')
  const publicBaseUrl = baseUrl(options.publicBaseUrl)
  const root = options.root
    ? { ...options.root, keyId: parseMarketplaceIdentity(options.root.keyId, 'root key id') }
    : undefined

  return {
    snapshot: () => options.repository.snapshot(),
    async registerPublisher(input, context) {
      const id = parseMarketplaceIdentity(input.publisher.id, 'publisher id')
      if (input.key.publisherId !== id) {
        throw new TypeError('Initial publisher key must belong to the registered publisher')
      }
      if (input.publisher.displayName.length > 128) {
        throw new TypeError('Publisher display name exceeds the public snapshot limit')
      }
      const canonical = await canonicalPublicKey(input.key)
      const mutationContext = normalizedContext(context, currentTime(options.now))
      return options.repository.transaction(async (transaction) => {
        const publisher = await transaction.createPublisher(
          { id, displayName: input.publisher.displayName },
          mutationContext
        )
        await transaction.registerPublisherKey(canonical.input, mutationContext)
        return publisher
      })
    },
    async registerPublisherKey(input, context) {
      const canonical = await canonicalPublicKey(input)
      return options.repository.transaction((transaction) =>
        transaction.registerPublisherKey(
          canonical.input,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    transitionPublisher(publisherId, status, context) {
      return options.repository.transaction((transaction) =>
        transaction.transitionPublisher(
          publisherId,
          status,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    transitionPublisherKey(keyId, status, context) {
      return options.repository.transaction((transaction) =>
        transaction.transitionPublisherKey(
          keyId,
          status,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    requestOwnership(pluginId, publisherId, context) {
      return options.repository.transaction((transaction) =>
        transaction.requestOwnership(
          { pluginId, publisherId },
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    transitionOwnership(pluginId, status, context) {
      return options.repository.transaction((transaction) =>
        transaction.transitionOwnership(
          pluginId,
          status,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    async submit(input, context) {
      const submissionId = parseMarketplaceIdentity(input.id, 'submission id')
      const publisherId = parseMarketplaceIdentity(input.publisherId, 'publisher id')
      if (!MARKETPLACE_RELEASE_CHANNELS.includes(input.channel)) {
        throw new TypeError('Marketplace submission channel must be stable or beta')
      }
      const submittedAt = context.time ?? currentTime(options.now)
      const submittedAtMilliseconds = Date.parse(
        parseMarketplaceTimestamp(submittedAt, 'submission time')
      )
      const initialState = await options.repository.snapshot()
      const rawManifest = input.manifest
      const parsedPublisher =
        rawManifest !== null && typeof rawManifest === 'object' && 'publisher' in rawManifest
          ? (rawManifest as { publisher?: { keyId?: unknown } }).publisher
          : undefined
      if (typeof parsedPublisher?.keyId !== 'string') {
        throw new TypeError('Plugin manifest must identify its publisher key')
      }
      const trust = activePublisherKey(
        initialState,
        publisherId,
        parsedPublisher.keyId,
        submittedAtMilliseconds
      )
      const publicKey = await importEd25519PublicKeyPem(trust.key.publicKeyPem)
      const verified = await verifyPluginPackage(rawManifest, publicKey, {
        expectedKeyId: trust.key.keyId
      })
      if (verified.manifest.publisher.id !== publisherId) {
        throw new Error('Plugin manifest publisher does not match the authenticated publisher')
      }
      if (!trust.ownership(verified.manifest.plugin.id)) {
        throw new Error('Publisher does not own the submitted plugin id')
      }
      const coordinate = parseMarketplaceReleaseCoordinate({
        pluginId: verified.manifest.plugin.id,
        version: verified.manifest.plugin.version,
        channel: input.channel
      })
      const manifestArtifact = await options.artifacts.put(
        encoder.encode(serializePluginManifest(verified.manifest))
      )
      const listing = publicListing(input.listing)
      let runtimeCoordinate = null
      if (input.runtimePackage !== undefined) {
        const runtimePackage = parsePluginRuntimePackage(input.runtimePackage)
        const verifiedRuntime = await verifyPluginRuntimePackage(runtimePackage, publicKey, {
          expectedPluginId: coordinate.pluginId,
          expectedPluginVersion: coordinate.version,
          expectedPublisherId: publisherId,
          expectedKeyId: trust.key.keyId,
          expectedDeclarativeManifestDigest: verified.verifiedDigest
        })
        const runtimeArtifact = await options.artifacts.put(
          encoder.encode(serializePluginRuntimePackage(runtimePackage))
        )
        runtimeCoordinate = {
          packageDigest: verifiedRuntime.verifiedDigest,
          packageUrl: artifactUrl(publicBaseUrl, runtimeArtifact.digest),
          byteLength: pluginRuntimePackageCanonicalByteLength(runtimePackage),
          kind: runtimePackage.runtime.kind
        }
      }
      const mutationContext = normalizedContext(context, submittedAt)
      return options.repository.transaction(async (transaction) => {
        const current = transaction.snapshot()
        const currentTrust = activePublisherKey(
          current,
          publisherId,
          trust.key.keyId,
          submittedAtMilliseconds
        )
        if (
          currentTrust.key.publicKeyPem !== trust.key.publicKeyPem ||
          !currentTrust.ownership(coordinate.pluginId)
        ) {
          throw new Error('Publisher trust changed while the submission was being verified')
        }
        const submission = await transaction.createSubmission(
          {
            id: submissionId,
            publisherId,
            coordinate,
            manifestDigest: verified.verifiedDigest,
            artifactDigest: manifestArtifact.digest,
            manifestUrl: artifactUrl(publicBaseUrl, manifestArtifact.digest),
            listing,
            runtimeCoordinate
          },
          mutationContext
        )
        await transaction.transitionSubmission(submission.id, 'awaiting_review', mutationContext)
        return transaction
          .snapshot()
          .submissions.find(({ id }) => id === submission.id) as MarketplaceSubmissionV1
      })
    },
    transitionSubmission(submissionId, status, context) {
      return options.repository.transaction((transaction) =>
        transaction.transitionSubmission(
          submissionId,
          status,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    withdrawSubmission(submissionId, publisherId, reason, context) {
      const parsedReason = parseMarketplaceReason(reason, 'withdrawal reason')
      return options.repository.transaction((transaction) => {
        const submission = transaction.snapshot().submissions.find(({ id }) => id === submissionId)
        if (!submission || submission.publisherId !== publisherId) {
          throw new Error('Submission does not belong to the authenticated publisher')
        }
        if (submission.status === 'published' || submission.status === 'yanked') {
          throw new Error(
            'Published submissions cannot be withdrawn; an administrator must yank them'
          )
        }
        return transaction.transitionSubmission(submissionId, 'withdrawn', {
          ...context,
          reason: parsedReason,
          time: context.time ?? currentTime(options.now)
        })
      })
    },
    publishSubmission(submissionId, context) {
      return options.repository.transaction((transaction) =>
        transaction.publishSubmission(
          submissionId,
          normalizedContext(context, currentTime(options.now))
        )
      )
    },
    yankRelease(coordinate, context) {
      return options.repository.transaction((transaction) =>
        transaction.yankRelease(coordinate, normalizedContext(context, currentTime(options.now)))
      )
    },
    async publish(context) {
      if (!root) throw new Error('Marketplace root trust is not configured')
      if (!root.publicKey) {
        throw new Error('Marketplace publication requires the matching root public key')
      }
      const state = await options.repository.snapshot()
      const prepared = await prepareMarketplacePublication(
        state,
        options.artifacts,
        publicationConfig({ ...options, marketplaceId, publicBaseUrl }, root)
      )
      await verifyMarketplaceSnapshot(prepared.snapshot, root.publicKey, {
        expectedMarketplaceId: marketplaceId,
        expectedKeyId: root.keyId,
        now: prepared.snapshot.generatedAt
      })
      const publication = await options.repository.transaction(async (transaction) => {
        const current = transaction.snapshot()
        const auditHead = current.auditEvents.at(-1)?.eventHash
        const nextSequence = (current.publications.at(-1)?.sequence ?? 0) + 1
        if (
          current.auditEvents.length !== prepared.auditSequence ||
          auditHead !== prepared.auditHead ||
          nextSequence !== prepared.sequence
        ) {
          throw new Error('Marketplace state changed while publication artifacts were prepared')
        }
        return transaction.recordPublication(prepared.record, {
          ...context,
          time: prepared.snapshot.generatedAt
        })
      })
      return { publication, prepared }
    },
    async resolveActivePublisherKey(publisherId, keyId) {
      const state = await options.repository.snapshot()
      try {
        const trust = activePublisherKey(
          state,
          publisherId,
          keyId,
          Date.parse(currentTime(options.now))
        )
        return await importEd25519PublicKeyPem(trust.key.publicKeyPem)
      } catch {
        return null
      }
    },
    artifact: (digest) => options.artifacts.get(digest),
    async latestSnapshotArtifact() {
      const publication = (await options.repository.snapshot()).publications.at(-1)
      if (!publication) return null
      const artifact = await options.artifacts.get(publication.snapshotArtifactDigest)
      if (!artifact) throw new Error('Published marketplace snapshot artifact is unavailable')
      return artifact
    },
    async latestSnapshot() {
      const state = await options.repository.snapshot()
      const publication = state.publications.at(-1)
      if (!publication) return null
      const artifact = await options.artifacts.get(publication.snapshotArtifactDigest)
      if (!artifact) throw new Error('Published marketplace snapshot artifact is unavailable')
      const snapshot = parseMarketplaceSnapshotBytes(artifact.bytes)
      if (snapshot.integrity.digest !== publication.snapshotDigest) {
        throw new Error('Published marketplace snapshot digest does not match repository state')
      }
      return snapshot
    },
    async latestVerifiedSnapshot() {
      const snapshot = await this.latestSnapshot()
      if (!snapshot) return null
      if (!root?.publicKey) throw new Error('Marketplace root public key is not configured')
      return verifyMarketplaceSnapshot(snapshot, root.publicKey, {
        expectedMarketplaceId: marketplaceId,
        expectedKeyId: root.keyId,
        now: currentTime(options.now)
      })
    },
    async latestCatalog(channel) {
      if (!MARKETPLACE_RELEASE_CHANNELS.includes(channel)) {
        throw new TypeError('Marketplace catalog channel must be stable or beta')
      }
      const publication = (await options.repository.snapshot()).publications.at(-1)
      const digest = publication?.catalogs.find(
        (catalog) => catalog.channel === channel
      )?.artifactDigest
      return digest ? options.artifacts.get(digest) : null
    },
    async latestRuntimeIndex() {
      const publication = (await options.repository.snapshot()).publications.at(-1)
      return publication?.runtimeIndexArtifactDigest
        ? options.artifacts.get(publication.runtimeIndexArtifactDigest)
        : null
    },
    async search(searchOptions = {}) {
      const snapshot = await this.latestVerifiedSnapshot()
      return snapshot ? searchMarketplaceListings(snapshot, searchOptions) : []
    },
    async listing(pluginId) {
      const id = parseMarketplaceIdentity(pluginId, 'marketplace plugin id')
      const snapshot = await this.latestVerifiedSnapshot()
      return snapshot?.snapshot.listings.find((candidate) => candidate.pluginId === id) ?? null
    }
  }
}
