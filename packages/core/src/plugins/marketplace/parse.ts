import {
  canonicalManifestValue,
  parseSha256Base64Url,
  parseSignedManifestIntegrity,
  parseStableSemver
} from '@open-pencil/scene-graph'

import { parsePluginTrustTimestamp } from '#core/plugins/keyring'

import { parseMarketplacePublisherDirectory } from './directory'
import {
  assertMarketplaceSorted,
  compareMarketplaceText,
  marketplaceChannel,
  marketplaceChannelRank,
  marketplaceIdentity,
  marketplacePositiveInteger,
  marketplacePublicHttpsUrl,
  marketplaceStringList,
  marketplaceText,
  parseBoundedManifestArray,
  parseExactManifestRecord
} from './parse-helpers'
import {
  MARKETPLACE_SNAPSHOT_FORMAT,
  MARKETPLACE_SNAPSHOT_LIMITS,
  MARKETPLACE_SNAPSHOT_SCHEMA_VERSION
} from './types'
import type {
  MarketplaceAuditHeadV1,
  MarketplaceCatalogReferenceV1,
  MarketplaceListingReleaseV1,
  MarketplacePluginListingV1,
  MarketplaceRuntimeIndexReferenceV1,
  MarketplaceReleaseChannelV1,
  MarketplaceSnapshotPayloadV1,
  MarketplaceSnapshotValidationResult,
  SignedMarketplaceSnapshotV1
} from './types'

const PAYLOAD_KEYS = new Set([
  'format',
  'schemaVersion',
  'marketplaceId',
  'version',
  'sequence',
  'generatedAt',
  'expiresAt',
  'publisherDirectory',
  'catalogs',
  'listings',
  'auditHead',
  'runtimeIndex'
])
const REQUIRED_PAYLOAD_KEYS = new Set([...PAYLOAD_KEYS].filter((key) => key !== 'runtimeIndex'))
const SNAPSHOT_KEYS = new Set([...PAYLOAD_KEYS, 'integrity'])
const REQUIRED_SNAPSHOT_KEYS = new Set([...REQUIRED_PAYLOAD_KEYS, 'integrity'])
const CATALOG_KEYS = new Set(['channel', 'catalogId', 'keyId', 'url', 'digest'])
const RELEASE_KEYS = new Set(['channel', 'version', 'digest'])
const LISTING_KEYS = new Set([
  'pluginId',
  'publisherId',
  'name',
  'summary',
  'categories',
  'keywords',
  'releases'
])
const AUDIT_KEYS = new Set(['sequence', 'headDigest', 'url'])
const RUNTIME_INDEX_KEYS = new Set(['url', 'indexId', 'keyId', 'digest'])

function catalogReference(value: unknown, index: number): MarketplaceCatalogReferenceV1 {
  const path = `marketplaceSnapshot.catalogs[${index}]`
  const source = parseExactManifestRecord(value, path, CATALOG_KEYS, CATALOG_KEYS)
  return Object.freeze({
    channel: marketplaceChannel(source.channel, `${path}.channel`),
    catalogId: marketplaceIdentity(source.catalogId, `${path}.catalogId`),
    keyId: marketplaceIdentity(source.keyId, `${path}.keyId`),
    url: marketplacePublicHttpsUrl(source.url, `${path}.url`),
    digest: parseSha256Base64Url(source.digest, `${path}.digest`)
  })
}

function catalogReferences(value: unknown): readonly MarketplaceCatalogReferenceV1[] {
  const path = 'marketplaceSnapshot.catalogs'
  const catalogs = parseBoundedManifestArray(
    value,
    path,
    MARKETPLACE_SNAPSHOT_LIMITS.maxCatalogs
  ).map(catalogReference)
  if (!catalogs.some(({ channel }) => channel === 'stable')) {
    throw new TypeError(`${path} must bind a stable catalog`)
  }
  assertMarketplaceSorted(
    catalogs,
    path,
    (left, right) => marketplaceChannelRank(left.channel) - marketplaceChannelRank(right.channel)
  )
  return Object.freeze(catalogs)
}

function listingRelease(value: unknown, path: string): MarketplaceListingReleaseV1 {
  const source = parseExactManifestRecord(value, path, RELEASE_KEYS, RELEASE_KEYS)
  return Object.freeze({
    channel: marketplaceChannel(source.channel, `${path}.channel`),
    version: parseStableSemver(source.version, `${path}.version`),
    digest: parseSha256Base64Url(source.digest, `${path}.digest`)
  })
}

function listing(value: unknown, index: number): MarketplacePluginListingV1 {
  const path = `marketplaceSnapshot.listings[${index}]`
  const source = parseExactManifestRecord(value, path, LISTING_KEYS, LISTING_KEYS)
  const releases = parseBoundedManifestArray(
    source.releases,
    `${path}.releases`,
    MARKETPLACE_SNAPSHOT_LIMITS.maxReleasesPerListing
  ).map((entry, releaseIndex) => listingRelease(entry, `${path}.releases[${releaseIndex}]`))
  if (releases.length === 0) throw new TypeError(`${path}.releases must not be empty`)
  assertMarketplaceSorted(
    releases,
    `${path}.releases`,
    (left, right) => marketplaceChannelRank(left.channel) - marketplaceChannelRank(right.channel)
  )
  return Object.freeze({
    pluginId: marketplaceIdentity(source.pluginId, `${path}.pluginId`),
    publisherId: marketplaceIdentity(source.publisherId, `${path}.publisherId`),
    name: marketplaceText(source.name, `${path}.name`, MARKETPLACE_SNAPSHOT_LIMITS.maxNameLength),
    summary: marketplaceText(
      source.summary,
      `${path}.summary`,
      MARKETPLACE_SNAPSHOT_LIMITS.maxSummaryLength
    ),
    categories: marketplaceStringList(
      source.categories,
      `${path}.categories`,
      MARKETPLACE_SNAPSHOT_LIMITS.maxCategoriesPerListing,
      MARKETPLACE_SNAPSHOT_LIMITS.maxCategoryLength,
      true
    ),
    keywords: marketplaceStringList(
      source.keywords,
      `${path}.keywords`,
      MARKETPLACE_SNAPSHOT_LIMITS.maxKeywordsPerListing,
      MARKETPLACE_SNAPSHOT_LIMITS.maxKeywordLength
    ),
    releases: Object.freeze(releases)
  })
}

function pluginListings(value: unknown): readonly MarketplacePluginListingV1[] {
  const path = 'marketplaceSnapshot.listings'
  const listings = parseBoundedManifestArray(
    value,
    path,
    MARKETPLACE_SNAPSHOT_LIMITS.maxListings
  ).map(listing)
  assertMarketplaceSorted(listings, path, (left, right) =>
    compareMarketplaceText(left.pluginId, right.pluginId)
  )
  return Object.freeze(listings)
}

function auditHead(value: unknown): MarketplaceAuditHeadV1 {
  const path = 'marketplaceSnapshot.auditHead'
  const source = parseExactManifestRecord(value, path, AUDIT_KEYS, AUDIT_KEYS)
  return Object.freeze({
    sequence: marketplacePositiveInteger(source.sequence, `${path}.sequence`),
    headDigest: parseSha256Base64Url(source.headDigest, `${path}.headDigest`),
    url: marketplacePublicHttpsUrl(source.url, `${path}.url`)
  })
}

function runtimeIndex(value: unknown): MarketplaceRuntimeIndexReferenceV1 {
  const path = 'marketplaceSnapshot.runtimeIndex'
  const source = parseExactManifestRecord(value, path, RUNTIME_INDEX_KEYS, RUNTIME_INDEX_KEYS)
  return Object.freeze({
    url: marketplacePublicHttpsUrl(source.url, `${path}.url`),
    indexId: marketplaceIdentity(source.indexId, `${path}.indexId`),
    keyId: marketplaceIdentity(source.keyId, `${path}.keyId`),
    digest: parseSha256Base64Url(source.digest, `${path}.digest`)
  })
}

function assertSnapshotSize(value: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalManifestValue(value))).byteLength
  if (bytes > MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `marketplaceSnapshot may not exceed ${MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes} bytes`
    )
  }
}

function validateListingRelationships(payload: MarketplaceSnapshotPayloadV1): void {
  const publishers = new Map(
    payload.publisherDirectory.publishers.map((publisher) => [publisher.publisherId, publisher])
  )
  const ownerships = new Map(
    payload.publisherDirectory.ownerships.map((ownership) => [ownership.pluginId, ownership])
  )
  const channels = new Set(payload.catalogs.map(({ channel }) => channel))
  for (const entry of payload.listings) {
    const publisher = publishers.get(entry.publisherId)
    if (publisher?.status !== 'active') {
      throw new TypeError(`marketplaceSnapshot listing ${entry.pluginId} has no active publisher`)
    }
    const ownership = ownerships.get(entry.pluginId)
    if (ownership?.status !== 'active' || ownership.publisherId !== entry.publisherId) {
      throw new TypeError(`marketplaceSnapshot listing ${entry.pluginId} has no active ownership`)
    }
    if (entry.releases.some(({ channel }) => !channels.has(channel))) {
      throw new TypeError(`marketplaceSnapshot listing ${entry.pluginId} uses an unbound channel`)
    }
  }
}

function payloadRecord(source: Readonly<Record<string, unknown>>): MarketplaceSnapshotPayloadV1 {
  if (source.format !== MARKETPLACE_SNAPSHOT_FORMAT) {
    throw new TypeError('marketplaceSnapshot.format is not supported')
  }
  if (source.schemaVersion !== MARKETPLACE_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError('marketplaceSnapshot.schemaVersion is not supported')
  }
  const generatedAt = parsePluginTrustTimestamp(
    source.generatedAt,
    'marketplaceSnapshot.generatedAt'
  )
  const expiresAt = parsePluginTrustTimestamp(source.expiresAt, 'marketplaceSnapshot.expiresAt')
  const validity = Date.parse(expiresAt) - Date.parse(generatedAt)
  if (validity <= 0 || validity > MARKETPLACE_SNAPSHOT_LIMITS.maxValidityMilliseconds) {
    throw new TypeError('marketplaceSnapshot validity must be positive and no longer than 7 days')
  }
  const payload: MarketplaceSnapshotPayloadV1 = Object.freeze({
    format: MARKETPLACE_SNAPSHOT_FORMAT,
    schemaVersion: MARKETPLACE_SNAPSHOT_SCHEMA_VERSION,
    marketplaceId: marketplaceIdentity(source.marketplaceId, 'marketplaceSnapshot.marketplaceId'),
    version: parseStableSemver(source.version, 'marketplaceSnapshot.version'),
    sequence: marketplacePositiveInteger(source.sequence, 'marketplaceSnapshot.sequence'),
    generatedAt,
    expiresAt,
    publisherDirectory: parseMarketplacePublisherDirectory(source.publisherDirectory),
    catalogs: catalogReferences(source.catalogs),
    listings: pluginListings(source.listings),
    auditHead: auditHead(source.auditHead),
    ...(Object.hasOwn(source, 'runtimeIndex')
      ? { runtimeIndex: runtimeIndex(source.runtimeIndex) }
      : {})
  })
  validateListingRelationships(payload)
  assertSnapshotSize(payload)
  return payload
}

export function parseMarketplaceSnapshotPayload(value: unknown): MarketplaceSnapshotPayloadV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceSnapshot',
    PAYLOAD_KEYS,
    REQUIRED_PAYLOAD_KEYS
  )
  return payloadRecord(source)
}

export function parseMarketplaceSnapshot(value: unknown): SignedMarketplaceSnapshotV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplaceSnapshot',
    SNAPSHOT_KEYS,
    REQUIRED_SNAPSHOT_KEYS
  )
  const payloadSource = { ...source }
  Reflect.deleteProperty(payloadSource, 'integrity')
  const payload = payloadRecord(payloadSource)
  const snapshot = Object.freeze({
    ...payload,
    integrity: parseSignedManifestIntegrity(source.integrity, 'marketplaceSnapshot.integrity')
  })
  assertSnapshotSize(snapshot)
  return snapshot
}

export function validateMarketplaceSnapshot(value: unknown): MarketplaceSnapshotValidationResult {
  try {
    return { ok: true, value: parseMarketplaceSnapshot(value) }
  } catch (error) {
    if (error instanceof TypeError) return { ok: false, reason: error.message }
    throw error
  }
}

export function parseMarketplaceSnapshotJson(source: string): SignedMarketplaceSnapshotV1 {
  if (
    typeof source !== 'string' ||
    new TextEncoder().encode(source).byteLength > MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Marketplace snapshot JSON exceeds the size limit')
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new TypeError('Marketplace snapshot must contain valid JSON')
  }
  return parseMarketplaceSnapshot(value)
}

export function parseMarketplaceSnapshotBytes(source: Uint8Array): SignedMarketplaceSnapshotV1 {
  if (source.byteLength > MARKETPLACE_SNAPSHOT_LIMITS.maxJsonBytes) {
    throw new TypeError('Marketplace snapshot bytes exceed the size limit')
  }
  let json: string
  try {
    json = new TextDecoder('utf-8', { fatal: true }).decode(source)
  } catch {
    throw new TypeError('Marketplace snapshot must contain valid UTF-8')
  }
  return parseMarketplaceSnapshotJson(json)
}

export function serializeMarketplaceSnapshot(value: unknown): string {
  return `${JSON.stringify(canonicalManifestValue(parseMarketplaceSnapshot(value)), null, 2)}\n`
}

export function marketplaceCatalogReference(
  snapshot: MarketplaceSnapshotPayloadV1,
  channel: MarketplaceReleaseChannelV1
): MarketplaceCatalogReferenceV1 {
  const reference = snapshot.catalogs.find((entry) => entry.channel === channel)
  if (!reference) throw new TypeError(`Marketplace snapshot does not bind a ${channel} catalog`)
  return reference
}
