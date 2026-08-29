/* eslint-disable max-lines -- Publication verification and root-signing form one atomic trust boundary. */
import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
  PLUGIN_CATALOG_FORMAT,
  PLUGIN_CATALOG_SCHEMA_VERSION,
  PLUGIN_RUNTIME_INDEX_FORMAT,
  PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
  comparePluginCatalogEntries,
  comparePluginRuntimeIndexEntries,
  parseVersionedPluginPackageBytes,
  parsePluginRuntimePackageBytes,
  pluginRuntimePackageCanonicalByteLength,
  serializeMarketplaceSnapshot,
  serializePluginCatalog,
  serializePluginRuntimeIndex,
  signMarketplaceSnapshot,
  signPluginCatalog,
  signPluginRuntimeIndex,
  verifyVersionedPluginPackage,
  verifyPluginRuntimePackage,
  type MarketplacePluginListingV1,
  type MarketplacePublisherDirectoryV1,
  type PluginCatalogPayloadV1,
  type PluginRuntimeIndexPayloadV1,
  type SignedMarketplaceSnapshotV1,
  type SignedPluginCatalogV1,
  type SignedPluginRuntimeIndexV1
} from '@open-pencil/plugin-contracts'
import {
  compareStableSemver,
  importEd25519PublicKeyPem,
  parseSha256Base64URL,
  stableSemverParts,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import type { MarketplaceArtifact, MarketplaceArtifactStore } from './artifacts'
import type {
  MarketplacePublicationCatalogProjectionV1,
  MarketplacePublicationProjectionV1
} from './publication/request'
import { findActiveMarketplacePublisherKey } from './publisher/trust'
import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplacePublicURL,
  parseMarketplaceState,
  parseMarketplaceTimestamp,
  type MarketplacePublicationCatalogV1,
  type MarketplacePublisherKeyV1,
  type MarketplaceReleaseChannel,
  type MarketplaceReleaseV1,
  type MarketplaceStateV1,
  type RecordMarketplacePublicationInput
} from './types'

export const MARKETPLACE_PUBLICATION_LIMITS = Object.freeze({
  defaultValidityMilliseconds: 6 * 24 * 60 * 60 * 1_000,
  maxValidityMilliseconds: 7 * 24 * 60 * 60 * 1_000
})

export interface MarketplacePublicationConfig {
  marketplaceId: string
  rootKeyId: string
  rootPrivateKey: CryptoKey
  publicBaseUrl: string
  now?: () => Date
  validityMilliseconds?: number
}

export type MarketplacePublicationProjectionConfig = Omit<
  MarketplacePublicationConfig,
  'rootPrivateKey'
>

export interface PreparedMarketplaceCatalog {
  channel: MarketplaceReleaseChannel
  catalog: SignedPluginCatalogV1
  artifact: MarketplaceArtifact
}

export interface PreparedMarketplaceRuntimeIndex {
  index: SignedPluginRuntimeIndexV1
  artifact: MarketplaceArtifact
}

export interface PreparedMarketplacePublication {
  sequence: number
  auditSequence: number
  auditHead: string
  snapshot: SignedMarketplaceSnapshotV1
  snapshotArtifact: MarketplaceArtifact
  catalogs: readonly PreparedMarketplaceCatalog[]
  runtimeIndex: PreparedMarketplaceRuntimeIndex | null
  record: RecordMarketplacePublicationInput
}

interface VerifiedRelease {
  release: MarketplaceReleaseV1
  key: MarketplacePublisherKeyV1
  manifest: Awaited<ReturnType<typeof verifyVersionedPluginPackage>>['manifest']
  runtime: {
    digest: string
    url: string
    byteLength: number
    kind: 'wasm' | 'javascript'
  } | null
}

const encoder = new TextEncoder()

function identity(value: string, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function publicationTime(config: { now?: () => Date }): string {
  const date = (config.now ?? (() => new Date()))()
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('Marketplace publication clock must return a valid Date')
  }
  return parseMarketplaceTimestamp(date.toISOString(), 'marketplace publication time')
}

function validityMilliseconds(value: number | undefined): number {
  const resolved = value ?? MARKETPLACE_PUBLICATION_LIMITS.defaultValidityMilliseconds
  if (
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > MARKETPLACE_PUBLICATION_LIMITS.maxValidityMilliseconds
  ) {
    throw new TypeError('Marketplace publication validity must be a positive duration up to 7 days')
  }
  return resolved
}

function baseURL(value: string): string {
  const parsed = new URL(parseMarketplacePublicURL(value, 'marketplace public base URL'))
  if (parsed.pathname !== '/' || parsed.search !== '') {
    throw new TypeError(
      'Marketplace public base URL must be an HTTPS origin without a path or query'
    )
  }
  return parsed.href
}

function publicURL(base: string, path: string): string {
  return new URL(path.replace(/^\//, ''), base).href
}

function artifactURL(base: string, digest: string): string {
  return publicURL(base, `/v1/artifacts/${digest}`)
}

function artifactDigestFromURL(value: string, base: string): string {
  const prefix = publicURL(base, '/v1/artifacts/')
  if (!value.startsWith(prefix)) {
    throw new Error('Runtime package URL is not owned by this marketplace artifact store')
  }
  const suffix = value.slice(prefix.length)
  if (suffix.includes('/') || suffix.includes('?')) {
    throw new Error('Runtime package URL must be an immutable marketplace artifact URL')
  }
  return parseSha256Base64URL(suffix, 'runtime package artifact digest')
}

function currentPublicationSequence(state: MarketplaceStateV1): number {
  return (state.publications.at(-1)?.sequence ?? 0) + 1
}

function activeKey(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string,
  at: number
): MarketplacePublisherKeyV1 | null {
  const publisher = state.publishers.find(({ id }) => id === publisherId)
  if (publisher?.status !== 'active') return null
  return findActiveMarketplacePublisherKey(state, publisherId, keyId, at)
}

function hasActiveOwnership(
  state: MarketplaceStateV1,
  pluginId: string,
  publisherId: string
): boolean {
  return state.ownerships.some(
    (ownership) =>
      ownership.pluginId === pluginId &&
      ownership.publisherId === publisherId &&
      ownership.status === 'active'
  )
}

function ownershipGrantedAt(state: MarketplaceStateV1, pluginId: string): string {
  const subject = `ownership:${pluginId}`
  const event = state.auditEvents.find(
    (candidate) => candidate.action === 'ownership.status_changed' && candidate.subject === subject
  )
  if (!event) {
    throw new Error(`Ownership ${pluginId} has no activation event in the verified audit chain`)
  }
  return event.time
}

async function requiredArtifact(
  artifacts: MarketplaceArtifactStore,
  digest: string,
  label: string
): Promise<MarketplaceArtifact> {
  const artifact = await artifacts.get(digest)
  if (!artifact) throw new Error(`${label} artifact is unavailable: ${digest}`)
  return artifact
}

async function verifyRelease(
  state: MarketplaceStateV1,
  release: MarketplaceReleaseV1,
  artifacts: MarketplaceArtifactStore,
  publicBaseURL: string,
  now: number
): Promise<VerifiedRelease | null> {
  if (
    release.yankedAt ||
    !hasActiveOwnership(state, release.coordinate.pluginId, release.publisherId)
  ) {
    return null
  }
  if (release.manifestUrl !== artifactURL(publicBaseURL, release.artifactDigest)) {
    throw new Error(
      `Release ${release.submissionId} manifest URL is not its immutable artifact URL`
    )
  }
  const artifact = await requiredArtifact(artifacts, release.artifactDigest, 'Plugin manifest')
  const manifest = parseVersionedPluginPackageBytes(artifact.bytes)
  const key = activeKey(state, release.publisherId, manifest.publisher.keyId, now)
  if (!key) return null
  if (
    manifest.plugin.id !== release.coordinate.pluginId ||
    manifest.plugin.version !== release.coordinate.version ||
    manifest.publisher.id !== release.publisherId
  ) {
    throw new Error(`Release ${release.submissionId} does not match its signed manifest`)
  }
  const publicKey = await importEd25519PublicKeyPem(key.publicKeyPem)
  const verified = await verifyVersionedPluginPackage(manifest, publicKey, {
    expectedKeyId: key.keyId
  })
  if (verified.verifiedDigest !== release.manifestDigest) {
    throw new Error(`Release ${release.submissionId} manifest digest does not match its state`)
  }

  let runtime: VerifiedRelease['runtime'] = null
  if (release.runtimeCoordinate) {
    const runtimeArtifactDigest = artifactDigestFromURL(
      release.runtimeCoordinate.packageUrl,
      publicBaseURL
    )
    const runtimeArtifact = await requiredArtifact(
      artifacts,
      runtimeArtifactDigest,
      'Plugin runtime package'
    )
    const runtimePackage = parsePluginRuntimePackageBytes(runtimeArtifact.bytes)
    const verifiedRuntime = await verifyPluginRuntimePackage(runtimePackage, publicKey, {
      expectedPluginId: manifest.plugin.id,
      expectedPluginVersion: manifest.plugin.version,
      expectedPublisherId: manifest.publisher.id,
      expectedKeyId: manifest.publisher.keyId,
      expectedDeclarativeManifestDigest: verified.verifiedDigest
    })
    const canonicalByteLength = pluginRuntimePackageCanonicalByteLength(runtimePackage)
    if (
      verifiedRuntime.verifiedDigest !== release.runtimeCoordinate.packageDigest ||
      runtimePackage.runtime.kind !== release.runtimeCoordinate.kind ||
      canonicalByteLength !== release.runtimeCoordinate.byteLength
    ) {
      throw new Error(
        `Release ${release.submissionId} runtime coordinate does not match its package`
      )
    }
    runtime = {
      digest: verifiedRuntime.verifiedDigest,
      url: release.runtimeCoordinate.packageUrl,
      byteLength: canonicalByteLength,
      kind: runtimePackage.runtime.kind
    }
  }
  return { release, key, manifest: verified.manifest, runtime }
}

async function verifiedReleases(
  state: MarketplaceStateV1,
  artifacts: MarketplaceArtifactStore,
  publicBaseURL: string,
  now: number
): Promise<readonly VerifiedRelease[]> {
  const releases = await Promise.all(
    state.releases.map((release) => verifyRelease(state, release, artifacts, publicBaseURL, now))
  )
  return releases.filter((release): release is VerifiedRelease => release !== null)
}

function publisherDirectory(state: MarketplaceStateV1): MarketplacePublisherDirectoryV1 {
  const publishableKeys = state.publisherKeys.filter(
    ({ status }) => status === 'active' || status === 'revoked'
  )
  const publishers = state.publishers
    .filter(({ status }) => status === 'active' || status === 'suspended')
    .map((publisher) => {
      const keys = publishableKeys
        .filter(({ publisherId }) => publisherId === publisher.id)
        .sort((left, right) => compareText(left.keyId, right.keyId))
      const availableKeyIds = new Set(keys.map(({ keyId }) => keyId))
      return {
        publisherId: publisher.id,
        name: publisher.displayName,
        status: publisher.status as 'active' | 'suspended',
        keys: keys.map((key) => ({
          keyId: key.keyId,
          publicKeyPem: key.publicKeyPem,
          notBefore: key.notBefore,
          notAfter: key.notAfter,
          ...(key.predecessorKeyId && availableKeyIds.has(key.predecessorKeyId)
            ? { predecessorKeyId: key.predecessorKeyId }
            : {}),
          ...(key.revokedAt
            ? {
                revokedAt: key.revokedAt,
                revocationReason: key.revocationReason as string
              }
            : {})
        }))
      }
    })
    .filter(({ keys }) => keys.length > 0)
    .sort((left, right) => compareText(left.publisherId, right.publisherId))
  const publisherIds = new Set(publishers.map(({ publisherId }) => publisherId))
  const ownerships = state.ownerships
    .filter(
      ({ publisherId, status }) =>
        publisherIds.has(publisherId) && (status === 'active' || status === 'revoked')
    )
    .map((ownership) => ({
      pluginId: ownership.pluginId,
      publisherId: ownership.publisherId,
      status: ownership.status as 'active' | 'revoked',
      grantedAt: ownershipGrantedAt(state, ownership.pluginId),
      ...(ownership.status === 'revoked'
        ? {
            revokedAt: ownership.updatedAt,
            revocationReason: ownership.statusReason as string
          }
        : {})
    }))
    .sort((left, right) => compareText(left.pluginId, right.pluginId))
  return { publishers, ownerships }
}

function latestByChannel(releases: readonly VerifiedRelease[]): readonly VerifiedRelease[] {
  const latest = new Map<MarketplaceReleaseChannel, VerifiedRelease>()
  for (const release of releases) {
    const channel = release.release.coordinate.channel
    const previous = latest.get(channel)
    if (
      !previous ||
      compareStableSemver(
        stableSemverParts(release.release.coordinate.version),
        stableSemverParts(previous.release.coordinate.version)
      ) > 0
    ) {
      latest.set(channel, release)
    }
  }
  return MARKETPLACE_RELEASE_CHANNELS.flatMap((channel) => {
    const release = latest.get(channel)
    return release ? [release] : []
  })
}

function listings(
  state: MarketplaceStateV1,
  releases: readonly VerifiedRelease[]
): readonly MarketplacePluginListingV1[] {
  const byPlugin = new Map<string, VerifiedRelease[]>()
  for (const release of releases) {
    const entries = byPlugin.get(release.release.coordinate.pluginId) ?? []
    entries.push(release)
    byPlugin.set(release.release.coordinate.pluginId, entries)
  }
  return [...byPlugin.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([pluginId, entries]) => {
      const current = latestByChannel(entries)
      const metadataRelease = [...current].sort(
        (left, right) =>
          -compareStableSemver(
            stableSemverParts(left.release.coordinate.version),
            stableSemverParts(right.release.coordinate.version)
          )
      )[0]
      const submission = state.submissions.find(
        ({ id }) => id === metadataRelease.release.submissionId
      )
      if (!submission) throw new Error(`Published release ${pluginId} has no submission metadata`)
      return {
        pluginId,
        publisherId: metadataRelease.release.publisherId,
        name: submission.listing.displayName,
        summary: submission.listing.summary,
        categories: [...submission.listing.categories].sort(),
        keywords: [],
        releases: current.map(({ release }) => ({
          channel: release.coordinate.channel,
          version: release.coordinate.version,
          digest: release.manifestDigest
        }))
      }
    })
}

function publicationCatalogProjections(
  releases: readonly VerifiedRelease[],
  marketplaceId: string,
  sequence: number,
  generatedAt: string,
  expiresAt: string
): readonly MarketplacePublicationCatalogProjectionV1[] {
  return Object.freeze(
    MARKETPLACE_RELEASE_CHANNELS.map((channel) => {
      const entries = releases
        .filter(({ release }) => release.coordinate.channel === channel)
        .map(({ release, key }) => ({
          pluginId: release.coordinate.pluginId,
          version: release.coordinate.version,
          digest: release.manifestDigest,
          manifestUrl: release.manifestUrl,
          publisherId: release.publisherId,
          keyId: key.keyId
        }))
        .sort(comparePluginCatalogEntries)
      return Object.freeze({
        channel,
        catalog: Object.freeze({
          format: PLUGIN_CATALOG_FORMAT,
          schemaVersion: PLUGIN_CATALOG_SCHEMA_VERSION,
          catalogId: identity(`${marketplaceId}-${channel}`, 'marketplace catalog id'),
          version: `1.0.${sequence}`,
          generatedAt,
          expiresAt,
          entries
        } satisfies PluginCatalogPayloadV1)
      })
    })
  )
}

async function prepareCatalogs(
  projections: readonly MarketplacePublicationCatalogProjectionV1[],
  artifacts: MarketplaceArtifactStore,
  config: MarketplacePublicationConfig
): Promise<readonly PreparedMarketplaceCatalog[]> {
  const result: PreparedMarketplaceCatalog[] = []
  for (const { channel, catalog: payload } of projections) {
    const catalog = await signPluginCatalog(payload, config.rootPrivateKey, {
      keyId: config.rootKeyId
    })
    const artifact = await artifacts.put(encoder.encode(serializePluginCatalog(catalog)))
    result.push({ channel, catalog, artifact })
  }
  return Object.freeze(result)
}

function publicationRuntimeIndexProjection(
  releases: readonly VerifiedRelease[],
  marketplaceId: string,
  sequence: number,
  generatedAt: string,
  expiresAt: string
): PluginRuntimeIndexPayloadV1 | null {
  const entriesByCoordinate = new Map<string, ReturnType<typeof runtimeEntry>>()
  for (const release of releases) {
    if (!release.runtime) continue
    const entry = runtimeEntry(release)
    const coordinate = `${entry.pluginId}@${entry.version}`
    const previous = entriesByCoordinate.get(coordinate)
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
      throw new Error(`Runtime package coordinate ${coordinate} differs across release channels`)
    }
    entriesByCoordinate.set(coordinate, entry)
  }
  if (entriesByCoordinate.size === 0) return null
  return Object.freeze({
    format: PLUGIN_RUNTIME_INDEX_FORMAT,
    schemaVersion: PLUGIN_RUNTIME_INDEX_SCHEMA_VERSION,
    indexId: identity(`${marketplaceId}-runtime`, 'marketplace runtime index id'),
    version: `1.0.${sequence}`,
    generatedAt,
    expiresAt,
    entries: [...entriesByCoordinate.values()].sort(comparePluginRuntimeIndexEntries)
  })
}

async function prepareRuntimeIndex(
  projection: PluginRuntimeIndexPayloadV1 | null,
  artifacts: MarketplaceArtifactStore,
  config: MarketplacePublicationConfig
): Promise<PreparedMarketplaceRuntimeIndex | null> {
  if (!projection) return null
  const index = await signPluginRuntimeIndex(projection, config.rootPrivateKey, {
    keyId: config.rootKeyId
  })
  const artifact = await artifacts.put(encoder.encode(serializePluginRuntimeIndex(index)))
  return { index, artifact }
}

function runtimeEntry(release: VerifiedRelease) {
  if (!release.runtime) throw new Error('Runtime entry requires a verified runtime package')
  return {
    pluginId: release.release.coordinate.pluginId,
    version: release.release.coordinate.version,
    publisherId: release.release.publisherId,
    keyId: release.key.keyId,
    declarativeManifestDigest: release.release.manifestDigest,
    runtimeKind: release.runtime.kind,
    runtimePackageUrl: release.runtime.url,
    runtimePackageDigest: release.runtime.digest,
    runtimePackageByteLength: release.runtime.byteLength
  }
}

export async function prepareMarketplacePublicationProjection(
  stateValue: MarketplaceStateV1,
  artifacts: MarketplaceArtifactStore,
  config: MarketplacePublicationProjectionConfig
): Promise<MarketplacePublicationProjectionV1> {
  const state = parseMarketplaceState(stateValue)
  const publicBaseURL = baseURL(config.publicBaseUrl)
  const marketplaceId = identity(config.marketplaceId, 'marketplace id')
  identity(config.rootKeyId, 'marketplace root key id')
  const generatedAt = publicationTime(config)
  const generatedAtMilliseconds = Date.parse(generatedAt)
  const expiresAt = new Date(
    generatedAtMilliseconds + validityMilliseconds(config.validityMilliseconds)
  ).toISOString()
  const auditSequence = state.auditEvents.length
  const auditHead = state.auditEvents.at(-1)?.eventHash
  if (!auditHead || auditSequence === 0) {
    throw new Error('Marketplace publication requires a non-empty verified audit chain')
  }
  const sequence = currentPublicationSequence(state)
  const releases = await verifiedReleases(state, artifacts, publicBaseURL, generatedAtMilliseconds)
  const catalogs = publicationCatalogProjections(
    releases,
    marketplaceId,
    sequence,
    generatedAt,
    expiresAt
  )
  const runtimeIndex = publicationRuntimeIndexProjection(
    releases,
    marketplaceId,
    sequence,
    generatedAt,
    expiresAt
  )
  return Object.freeze({
    catalogs,
    runtimeIndex,
    snapshot: Object.freeze({
      format: MARKETPLACE_SNAPSHOT_FORMAT,
      schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
      marketplaceId,
      version: `1.0.${sequence}`,
      sequence,
      generatedAt,
      expiresAt,
      publisherDirectory: publisherDirectory(state),
      listings: listings(state, releases),
      auditHead: {
        sequence: auditSequence,
        headDigest: auditHead,
        url: publicURL(publicBaseURL, '/v1/audit')
      }
    })
  })
}

export async function prepareMarketplacePublication(
  state: MarketplaceStateV1,
  artifacts: MarketplaceArtifactStore,
  config: MarketplacePublicationConfig
): Promise<PreparedMarketplacePublication> {
  const publicBaseURL = baseURL(config.publicBaseUrl)
  const projection = await prepareMarketplacePublicationProjection(state, artifacts, config)
  const { sequence, auditHead: snapshotAuditHead } = projection.snapshot
  const auditSequence = snapshotAuditHead.sequence
  const auditHead = snapshotAuditHead.headDigest
  const catalogs = await prepareCatalogs(projection.catalogs, artifacts, config)
  const runtimeIndex = await prepareRuntimeIndex(projection.runtimeIndex, artifacts, config)
  const snapshot = await signMarketplaceSnapshot(
    {
      ...projection.snapshot,
      catalogs: catalogs.map(({ channel, catalog, artifact }) => ({
        channel,
        catalogId: catalog.catalogId,
        keyId: config.rootKeyId,
        url: artifactURL(publicBaseURL, artifact.digest),
        digest: catalog.integrity.digest
      })),
      ...(runtimeIndex
        ? {
            runtimeIndex: {
              url: artifactURL(publicBaseURL, runtimeIndex.artifact.digest),
              indexId: runtimeIndex.index.indexId,
              keyId: config.rootKeyId,
              digest: runtimeIndex.index.integrity.digest
            }
          }
        : {})
    },
    config.rootPrivateKey,
    { keyId: config.rootKeyId }
  )
  const snapshotArtifact = await artifacts.put(
    encoder.encode(serializeMarketplaceSnapshot(snapshot))
  )
  const publicationCatalogs: readonly MarketplacePublicationCatalogV1[] = catalogs.map(
    ({ channel, catalog, artifact }) => ({
      channel,
      catalogDigest: catalog.integrity.digest,
      artifactDigest: artifact.digest
    })
  )
  const record: RecordMarketplacePublicationInput = {
    snapshotDigest: snapshot.integrity.digest,
    snapshotArtifactDigest: snapshotArtifact.digest,
    catalogs: publicationCatalogs,
    runtimeIndexDigest: runtimeIndex?.index.integrity.digest ?? null,
    runtimeIndexArtifactDigest: runtimeIndex?.artifact.digest ?? null
  }
  return Object.freeze({
    sequence,
    auditSequence,
    auditHead,
    snapshot,
    snapshotArtifact,
    catalogs,
    runtimeIndex,
    record
  })
}
