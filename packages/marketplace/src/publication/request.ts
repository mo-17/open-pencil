/* eslint-disable max-lines -- The offline publication envelope, exact parsers, review diff, and emergency monotonicity checks form one trust boundary. */
import { createHash } from 'node:crypto'

import {
  parseMarketplaceSnapshotPayload,
  parsePluginCatalogPayload,
  parsePluginRuntimeIndexPayload,
  type MarketplaceSnapshotPayloadV1,
  type PluginCatalogPayloadV1,
  type PluginRuntimeIndexPayloadV1
} from '@open-pencil/plugin-contracts'
import {
  canonicalManifestJSON,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

import {
  MARKETPLACE_RELEASE_CHANNELS,
  parseMarketplacePublicURL,
  parseMarketplaceState,
  parseMarketplaceTimestamp,
  type MarketplaceReleaseChannel,
  type MarketplaceStateV1
} from '../types'

export const MARKETPLACE_PUBLICATION_REQUEST_FORMAT =
  'openpencil-marketplace-publication-request' as const
export const MARKETPLACE_PUBLICATION_REQUEST_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_PUBLICATION_REQUEST_PURPOSES = [
  'routine',
  'emergency-revocation',
  'revocation-recovery'
] as const

export const MARKETPLACE_PUBLICATION_REQUEST_LIMITS = Object.freeze({
  maxJsonBytes: 32 * 1024 * 1024,
  maxReviewChanges: 32_768,
  maxReviewSubjectBytes: 512,
  maxReviewDescriptionBytes: 1_024,
  maxValidityMilliseconds: 7 * 24 * 60 * 60 * 1_000
})

export type MarketplacePublicationRequestPurpose =
  (typeof MARKETPLACE_PUBLICATION_REQUEST_PURPOSES)[number]

export interface MarketplacePublicationCatalogProjectionV1 {
  channel: MarketplaceReleaseChannel
  catalog: PluginCatalogPayloadV1
}

/**
 * The signer-independent part of a snapshot. Catalog/runtime references are
 * intentionally absent: their immutable URLs and digests exist only after the
 * offline signer has produced exact signed artifact bytes.
 */
export type MarketplacePublicationSnapshotProjectionV1 = Omit<
  MarketplaceSnapshotPayloadV1,
  'catalogs' | 'runtimeIndex'
>

export interface MarketplacePublicationProjectionV1 {
  catalogs: readonly MarketplacePublicationCatalogProjectionV1[]
  runtimeIndex: PluginRuntimeIndexPayloadV1 | null
  snapshot: MarketplacePublicationSnapshotProjectionV1
}

export const MARKETPLACE_PUBLICATION_REVIEW_RESOURCES = [
  'publisher',
  'publisher-key',
  'ownership',
  'catalog-entry',
  'listing',
  'listing-release',
  'runtime-entry'
] as const
export const MARKETPLACE_PUBLICATION_REVIEW_OPERATIONS = [
  'add',
  'remove',
  'restrict',
  'replace'
] as const

export type MarketplacePublicationReviewResource =
  (typeof MARKETPLACE_PUBLICATION_REVIEW_RESOURCES)[number]
export type MarketplacePublicationReviewOperation =
  (typeof MARKETPLACE_PUBLICATION_REVIEW_OPERATIONS)[number]

export interface MarketplacePublicationReviewChangeV1 {
  resource: MarketplacePublicationReviewResource
  operation: MarketplacePublicationReviewOperation
  subject: string
  description: string
  beforeDigest: string | null
  afterDigest: string | null
}

export interface MarketplacePublicationReviewV1 {
  changes: readonly MarketplacePublicationReviewChangeV1[]
}

/**
 * This envelope is the exact input to a later offline signer, not a signed
 * publication. The importer must independently verify that `baseline` was
 * reconstructed from the signed snapshot/artifacts named by
 * `previousPublicationSnapshotDigest` before relying on the review diff. This
 * pure module cannot close that proof without signature verification and
 * artifact reads; it deliberately performs neither.
 */
export interface MarketplacePublicationRequestV1 {
  format: typeof MARKETPLACE_PUBLICATION_REQUEST_FORMAT
  schemaVersion: typeof MARKETPLACE_PUBLICATION_REQUEST_SCHEMA_VERSION
  purpose: MarketplacePublicationRequestPurpose
  marketplaceId: string
  rootKeyId: string
  publicBaseUrl: string
  expectedNextSequence: number
  previousPublicationSnapshotDigest: string | null
  previousPublicationSnapshotArtifactDigest: string | null
  auditSequence: number
  auditHead: string
  stateDigest: string
  planDigest: string
  baselineDigest: string | null
  generatedAt: string
  expiresAt: string
  baseline: MarketplacePublicationProjectionV1 | null
  plan: MarketplacePublicationProjectionV1
  review: MarketplacePublicationReviewV1
}

export interface CreateMarketplacePublicationRequestInput {
  state: MarketplaceStateV1
  purpose: MarketplacePublicationRequestPurpose
  marketplaceId: string
  rootKeyId: string
  publicBaseUrl: string
  baseline: MarketplacePublicationProjectionV1 | null
  plan: MarketplacePublicationProjectionV1
}

const REQUEST_KEYS = new Set([
  'format',
  'schemaVersion',
  'purpose',
  'marketplaceId',
  'rootKeyId',
  'publicBaseUrl',
  'expectedNextSequence',
  'previousPublicationSnapshotDigest',
  'previousPublicationSnapshotArtifactDigest',
  'auditSequence',
  'auditHead',
  'stateDigest',
  'planDigest',
  'baselineDigest',
  'generatedAt',
  'expiresAt',
  'baseline',
  'plan',
  'review'
])
const PROJECTION_KEYS = new Set(['catalogs', 'runtimeIndex', 'snapshot'])
const CATALOG_PROJECTION_KEYS = new Set(['channel', 'catalog'])
const SNAPSHOT_PROJECTION_KEYS = new Set([
  'format',
  'schemaVersion',
  'marketplaceId',
  'version',
  'sequence',
  'generatedAt',
  'expiresAt',
  'publisherDirectory',
  'listings',
  'auditHead'
])
const REVIEW_KEYS = new Set(['changes'])
const REVIEW_CHANGE_KEYS = new Set([
  'resource',
  'operation',
  'subject',
  'description',
  'beforeDigest',
  'afterDigest'
])
const PURPOSES = new Set<string>(MARKETPLACE_PUBLICATION_REQUEST_PURPOSES)
const REVIEW_RESOURCES = new Set<string>(MARKETPLACE_PUBLICATION_REVIEW_RESOURCES)
const REVIEW_OPERATIONS = new Set<string>(MARKETPLACE_PUBLICATION_REVIEW_OPERATIONS)
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

interface ProjectionContext {
  marketplaceId: string
  rootKeyId: string
  publicBaseURL: string
  expectedSequence?: number
  expectedGeneratedAt?: string
  expectedExpiresAt?: string
  expectedAuditSequence?: number
  expectedAuditHead?: string
  label: string
}

interface ReviewItem {
  resource: MarketplacePublicationReviewResource
  subject: string
  value: unknown
}

interface RevocableReviewValue {
  readonly [key: string]: unknown
  readonly revokedAt?: unknown
  readonly revocationReason?: unknown
  readonly status?: unknown
}

type CatalogProjectionEntry = PluginCatalogPayloadV1['entries'][number] & {
  channel: MarketplaceReleaseChannel
}

interface CatalogProjectionBindings {
  entries: ReadonlyMap<string, CatalogProjectionEntry>
  coordinates: ReadonlyMap<string, PluginCatalogPayloadV1['entries'][number]>
}

function digestBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function digestValue(value: unknown): string {
  return digestBytes(encoder.encode(canonicalManifestJSON(value)))
}

function identity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) as number
    if (code <= 31 || code === 127) return true
  }
  return false
}

function boundedText(value: unknown, path: string, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    containsControlCharacter(value) ||
    byteLength(value) > maximumBytes
  ) {
    throw new TypeError(`${path} must be non-empty bounded text without control characters`)
  }
  return value
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

function purpose(value: unknown): MarketplacePublicationRequestPurpose {
  if (typeof value !== 'string' || !PURPOSES.has(value)) {
    throw new TypeError('marketplacePublicationRequest.purpose is not supported')
  }
  return value as MarketplacePublicationRequestPurpose
}

function baseURL(value: unknown): string {
  const parsed = new URL(
    parseMarketplacePublicURL(value, 'marketplacePublicationRequest.publicBaseUrl')
  )
  if (parsed.pathname !== '/' || parsed.search !== '') {
    throw new TypeError(
      'marketplacePublicationRequest.publicBaseUrl must be an HTTPS origin without a path or query'
    )
  }
  return parsed.href
}

function publicURL(base: string, path: string): string {
  return new URL(path.replace(/^\//u, ''), base).href
}

function artifactURL(base: string, digest: string): string {
  return publicURL(base, `/v1/artifacts/${digest}`)
}

function assertArtifactURL(value: string, base: string, path: string): void {
  const prefix = publicURL(base, '/v1/artifacts/')
  if (!value.startsWith(prefix)) {
    throw new TypeError(`${path} must use this marketplace's immutable artifact origin`)
  }
  const suffix = value.slice(prefix.length)
  if (suffix.includes('/') || suffix.includes('?')) {
    throw new TypeError(`${path} must be an immutable marketplace artifact URL`)
  }
  parseSha256Base64URL(suffix, `${path} artifact digest`)
}

function nullableDigest(value: unknown, path: string): string | null {
  return value === null ? null : parseSha256Base64URL(value, path)
}

function publicationVersion(sequence: number): string {
  return `1.0.${sequence}`
}

function parseCatalogProjections(
  value: unknown,
  context: ProjectionContext
): readonly MarketplacePublicationCatalogProjectionV1[] {
  const catalogs = parseBoundedManifestArray(
    value,
    `${context.label}.catalogs`,
    MARKETPLACE_RELEASE_CHANNELS.length
  ).map((entry, index) => {
    const path = `${context.label}.catalogs[${index}]`
    const source = parseExactManifestRecord(
      entry,
      path,
      CATALOG_PROJECTION_KEYS,
      CATALOG_PROJECTION_KEYS
    )
    const channel = MARKETPLACE_RELEASE_CHANNELS[index]
    if (source.channel !== channel) {
      throw new TypeError(`${context.label}.catalogs must be ordered stable then beta`)
    }
    return Object.freeze({
      channel,
      catalog: parsePluginCatalogPayload(source.catalog)
    })
  })
  if (catalogs.length !== MARKETPLACE_RELEASE_CHANNELS.length) {
    throw new TypeError(`${context.label}.catalogs must contain stable and beta projections`)
  }
  return Object.freeze(catalogs)
}

function parseSnapshotProjection(
  value: unknown,
  catalogs: readonly MarketplacePublicationCatalogProjectionV1[],
  runtimeIndex: PluginRuntimeIndexPayloadV1 | null,
  context: ProjectionContext
): MarketplacePublicationSnapshotProjectionV1 {
  const source = parseExactManifestRecord(
    value,
    `${context.label}.snapshot`,
    SNAPSHOT_PROJECTION_KEYS,
    SNAPSHOT_PROJECTION_KEYS
  )
  const catalogReferences = catalogs.map(({ channel, catalog }) => {
    const digest = digestValue({ placeholder: context.label, channel })
    return {
      channel,
      catalogId: catalog.catalogId,
      keyId: context.rootKeyId,
      url: artifactURL(context.publicBaseURL, digest),
      digest
    }
  })
  const parsed = parseMarketplaceSnapshotPayload({
    ...source,
    catalogs: catalogReferences,
    ...(runtimeIndex
      ? {
          runtimeIndex: {
            url: artifactURL(
              context.publicBaseURL,
              digestValue({ placeholder: context.label, runtime: true })
            ),
            indexId: runtimeIndex.indexId,
            keyId: context.rootKeyId,
            digest: digestValue({ placeholder: context.label, runtimeIndex: true })
          }
        }
      : {})
  })
  return Object.freeze({
    format: parsed.format,
    schemaVersion: parsed.schemaVersion,
    marketplaceId: parsed.marketplaceId,
    version: parsed.version,
    sequence: parsed.sequence,
    generatedAt: parsed.generatedAt,
    expiresAt: parsed.expiresAt,
    publisherDirectory: parsed.publisherDirectory,
    listings: parsed.listings,
    auditHead: parsed.auditHead
  })
}

function catalogEntryKey(channel: string, pluginId: string, version: string): string {
  return `${channel}\u0000${pluginId}\u0000${version}`
}

function coordinateKey(pluginId: string, version: string): string {
  return `${pluginId}\u0000${version}`
}

function assertSnapshotBindings(
  snapshot: MarketplacePublicationSnapshotProjectionV1,
  context: ProjectionContext
): void {
  if (snapshot.marketplaceId !== context.marketplaceId) {
    throw new TypeError(`${context.label}.snapshot.marketplaceId does not match the request`)
  }
  if (context.expectedSequence !== undefined && snapshot.sequence !== context.expectedSequence) {
    throw new TypeError(`${context.label}.snapshot.sequence does not match the request`)
  }
  if (snapshot.version !== publicationVersion(snapshot.sequence)) {
    throw new TypeError(`${context.label}.snapshot.version does not match its sequence`)
  }
  if (
    context.expectedGeneratedAt !== undefined &&
    snapshot.generatedAt !== context.expectedGeneratedAt
  ) {
    throw new TypeError(`${context.label}.snapshot.generatedAt does not match the request`)
  }
  if (context.expectedExpiresAt !== undefined && snapshot.expiresAt !== context.expectedExpiresAt) {
    throw new TypeError(`${context.label}.snapshot.expiresAt does not match the request`)
  }
  if (
    context.expectedAuditSequence !== undefined &&
    snapshot.auditHead.sequence !== context.expectedAuditSequence
  ) {
    throw new TypeError(`${context.label}.snapshot.auditHead.sequence does not match the request`)
  }
  if (
    context.expectedAuditHead !== undefined &&
    snapshot.auditHead.headDigest !== context.expectedAuditHead
  ) {
    throw new TypeError(`${context.label}.snapshot.auditHead.headDigest does not match the request`)
  }
  if (snapshot.auditHead.url !== publicURL(context.publicBaseURL, '/v1/audit')) {
    throw new TypeError(`${context.label}.snapshot.auditHead.url does not match the marketplace`)
  }
}

function assertCatalogEntryAuthority(
  entry: PluginCatalogPayloadV1['entries'][number],
  snapshot: MarketplacePublicationSnapshotProjectionV1,
  generatedAt: number,
  context: ProjectionContext
): void {
  const publisher = snapshot.publisherDirectory.publishers.find(
    ({ publisherId }) => publisherId === entry.publisherId
  )
  const ownership = snapshot.publisherDirectory.ownerships.find(
    ({ pluginId }) => pluginId === entry.pluginId
  )
  const key = publisher?.keys.find(({ keyId }) => keyId === entry.keyId)
  if (publisher?.status !== 'active') {
    throw new TypeError(`${context.label} catalog entry has no active publisher`)
  }
  if (ownership?.status !== 'active' || ownership.publisherId !== entry.publisherId) {
    throw new TypeError(`${context.label} catalog entry has no active ownership`)
  }
  if (
    !key ||
    key.revokedAt !== undefined ||
    generatedAt < Date.parse(key.notBefore) ||
    generatedAt >= Date.parse(key.notAfter)
  ) {
    throw new TypeError(`${context.label} catalog entry has no active publisher key`)
  }
}

function collectCatalogBindings(
  projection: MarketplacePublicationProjectionV1,
  context: ProjectionContext
): CatalogProjectionBindings {
  const entries = new Map<string, CatalogProjectionEntry>()
  const coordinates = new Map<string, PluginCatalogPayloadV1['entries'][number]>()
  for (const { channel, catalog } of projection.catalogs) {
    if (
      catalog.catalogId !== `${context.marketplaceId}-${channel}` ||
      catalog.version !== projection.snapshot.version ||
      catalog.generatedAt !== projection.snapshot.generatedAt ||
      catalog.expiresAt !== projection.snapshot.expiresAt
    ) {
      throw new TypeError(`${context.label}.${channel} catalog does not match the snapshot plan`)
    }
    for (const entry of catalog.entries) {
      assertArtifactURL(
        entry.manifestUrl,
        context.publicBaseURL,
        `${context.label}.${channel} catalog entry ${entry.pluginId}@${entry.version}.manifestUrl`
      )
      assertCatalogEntryAuthority(
        entry,
        projection.snapshot,
        Date.parse(projection.snapshot.generatedAt),
        context
      )
      entries.set(catalogEntryKey(channel, entry.pluginId, entry.version), {
        ...entry,
        channel
      })
      const coordinate = coordinateKey(entry.pluginId, entry.version)
      const previous = coordinates.get(coordinate)
      if (previous && canonicalManifestJSON(previous) !== canonicalManifestJSON(entry)) {
        throw new TypeError(`${context.label} catalog coordinate differs across channels`)
      }
      coordinates.set(coordinate, entry)
    }
  }
  return { entries, coordinates }
}

function assertListingBindings(
  snapshot: MarketplacePublicationSnapshotProjectionV1,
  entries: ReadonlyMap<string, CatalogProjectionEntry>,
  context: ProjectionContext
): void {
  for (const listing of snapshot.listings) {
    for (const release of listing.releases) {
      const entry = entries.get(catalogEntryKey(release.channel, listing.pluginId, release.version))
      if (!entry || entry.publisherId !== listing.publisherId || entry.digest !== release.digest) {
        throw new TypeError(`${context.label} listing release is not bound by its catalog`)
      }
    }
  }
}

function assertRuntimeBindings(
  runtimeIndex: PluginRuntimeIndexPayloadV1 | null,
  snapshot: MarketplacePublicationSnapshotProjectionV1,
  coordinates: ReadonlyMap<string, PluginCatalogPayloadV1['entries'][number]>,
  context: ProjectionContext
): void {
  if (!runtimeIndex) return
  if (
    runtimeIndex.indexId !== `${context.marketplaceId}-runtime` ||
    runtimeIndex.version !== snapshot.version ||
    runtimeIndex.generatedAt !== snapshot.generatedAt ||
    runtimeIndex.expiresAt !== snapshot.expiresAt
  ) {
    throw new TypeError(`${context.label}.runtimeIndex does not match the snapshot plan`)
  }
  for (const entry of runtimeIndex.entries) {
    assertArtifactURL(
      entry.runtimePackageUrl,
      context.publicBaseURL,
      `${context.label} runtime entry ${entry.pluginId}@${entry.version}.runtimePackageUrl`
    )
    const catalog = coordinates.get(coordinateKey(entry.pluginId, entry.version))
    if (
      !catalog ||
      catalog.publisherId !== entry.publisherId ||
      catalog.keyId !== entry.keyId ||
      catalog.digest !== entry.declarativeManifestDigest
    ) {
      throw new TypeError(`${context.label} runtime entry is not bound by a catalog entry`)
    }
  }
}

function assertProjectionRelationships(
  projection: MarketplacePublicationProjectionV1,
  context: ProjectionContext
): void {
  assertSnapshotBindings(projection.snapshot, context)
  const catalogs = collectCatalogBindings(projection, context)
  assertListingBindings(projection.snapshot, catalogs.entries, context)
  assertRuntimeBindings(projection.runtimeIndex, projection.snapshot, catalogs.coordinates, context)
}

function parseProjection(
  value: unknown,
  context: ProjectionContext
): MarketplacePublicationProjectionV1 {
  const source = parseExactManifestRecord(value, context.label, PROJECTION_KEYS, PROJECTION_KEYS)
  const catalogs = parseCatalogProjections(source.catalogs, context)
  const runtimeIndex =
    source.runtimeIndex === null ? null : parsePluginRuntimeIndexPayload(source.runtimeIndex)
  const snapshot = parseSnapshotProjection(source.snapshot, catalogs, runtimeIndex, context)
  const projection = Object.freeze({ catalogs, runtimeIndex, snapshot })
  assertProjectionRelationships(projection, context)
  return projection
}

function reviewItems(projection: MarketplacePublicationProjectionV1): readonly ReviewItem[] {
  const items: ReviewItem[] = []
  for (const publisher of projection.snapshot.publisherDirectory.publishers) {
    const { keys, ...authority } = publisher
    items.push({
      resource: 'publisher',
      subject: `publisher:${publisher.publisherId}`,
      value: authority
    })
    for (const key of keys) {
      items.push({
        resource: 'publisher-key',
        subject: `publisher-key:${publisher.publisherId}/${key.keyId}`,
        value: { publisherId: publisher.publisherId, ...key }
      })
    }
  }
  for (const ownership of projection.snapshot.publisherDirectory.ownerships) {
    items.push({
      resource: 'ownership',
      subject: `ownership:${ownership.pluginId}`,
      value: ownership
    })
  }
  for (const { channel, catalog } of projection.catalogs) {
    for (const entry of catalog.entries) {
      items.push({
        resource: 'catalog-entry',
        subject: `catalog-entry:${channel}/${entry.pluginId}@${entry.version}`,
        value: { channel, ...entry }
      })
    }
  }
  for (const listing of projection.snapshot.listings) {
    const { releases, ...metadata } = listing
    items.push({
      resource: 'listing',
      subject: `listing:${listing.pluginId}`,
      value: metadata
    })
    for (const release of releases) {
      items.push({
        resource: 'listing-release',
        subject: `listing-release:${listing.pluginId}/${release.channel}`,
        value: { pluginId: listing.pluginId, publisherId: listing.publisherId, ...release }
      })
    }
  }
  for (const entry of projection.runtimeIndex?.entries ?? []) {
    items.push({
      resource: 'runtime-entry',
      subject: `runtime-entry:${entry.pluginId}@${entry.version}`,
      value: entry
    })
  }
  return Object.freeze(items)
}

function isPublisherRestriction(before: unknown, after: unknown): boolean {
  if (!isRevocableReviewValue(before) || !isRevocableReviewValue(after)) return false
  return (
    before.status === 'active' &&
    after.status === 'suspended' &&
    canonicalManifestJSON({ ...before, status: 'suspended' }) === canonicalManifestJSON(after)
  )
}

function isRevocableReviewValue(value: unknown): value is RevocableReviewValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function withoutRevocation(value: RevocableReviewValue): RevocableReviewValue {
  const result = { ...value }
  Reflect.deleteProperty(result, 'revokedAt')
  Reflect.deleteProperty(result, 'revocationReason')
  return result
}

function isRevocationRestriction(before: unknown, after: unknown): boolean {
  if (!isRevocableReviewValue(before) || !isRevocableReviewValue(after)) return false
  return (
    !Object.hasOwn(before, 'revokedAt') &&
    typeof after.revokedAt === 'string' &&
    typeof after.revocationReason === 'string' &&
    canonicalManifestJSON(before) === canonicalManifestJSON(withoutRevocation(after))
  )
}

function isOwnershipRestriction(before: unknown, after: unknown): boolean {
  if (!isRevocableReviewValue(before) || !isRevocableReviewValue(after)) return false
  return (
    before.status === 'active' &&
    after.status === 'revoked' &&
    !Object.hasOwn(before, 'revokedAt') &&
    typeof after.revokedAt === 'string' &&
    typeof after.revocationReason === 'string' &&
    canonicalManifestJSON({ ...before, status: 'revoked' }) ===
      canonicalManifestJSON(withoutRevocation(after))
  )
}

function restriction(
  resource: MarketplacePublicationReviewResource,
  before: unknown,
  after: unknown
): boolean {
  if (resource === 'publisher') return isPublisherRestriction(before, after)
  if (resource === 'publisher-key') return isRevocationRestriction(before, after)
  if (resource === 'ownership') return isOwnershipRestriction(before, after)
  return false
}

function reviewDescription(
  operation: MarketplacePublicationReviewOperation,
  resource: MarketplacePublicationReviewResource
): string {
  if (operation === 'add') return `Add ${resource}`
  if (operation === 'remove') return `Remove ${resource}`
  if (operation === 'restrict') return `Revoke or suspend ${resource}`
  return `Replace ${resource}`
}

function reviewOperationFor(
  resource: MarketplacePublicationReviewResource,
  previous: ReviewItem | undefined,
  next: ReviewItem | undefined
): MarketplacePublicationReviewOperation {
  if (!previous) return 'add'
  if (!next) return 'remove'
  return restriction(resource, previous.value, next.value) ? 'restrict' : 'replace'
}

function buildReviewChanges(
  baseline: MarketplacePublicationProjectionV1 | null,
  plan: MarketplacePublicationProjectionV1
): readonly MarketplacePublicationReviewChangeV1[] {
  const before = new Map(
    (baseline ? reviewItems(baseline) : []).map((item) => [item.subject, item])
  )
  const after = new Map(reviewItems(plan).map((item) => [item.subject, item]))
  const subjects = [...new Set([...before.keys(), ...after.keys()])].sort()
  const changes: MarketplacePublicationReviewChangeV1[] = []
  for (const subject of subjects) {
    const previous = before.get(subject)
    const next = after.get(subject)
    if (
      previous &&
      next &&
      canonicalManifestJSON(previous.value) === canonicalManifestJSON(next.value)
    ) {
      continue
    }
    const resource = (previous ?? next)?.resource
    if (!resource) throw new TypeError('Marketplace publication review item is unavailable')
    const operation = reviewOperationFor(resource, previous, next)
    changes.push(
      Object.freeze({
        resource,
        operation,
        subject,
        description: reviewDescription(operation, resource),
        beforeDigest: previous ? digestValue(previous.value) : null,
        afterDigest: next ? digestValue(next.value) : null
      })
    )
  }
  return Object.freeze(changes)
}

function reviewResource(value: unknown, path: string): MarketplacePublicationReviewResource {
  if (typeof value !== 'string' || !REVIEW_RESOURCES.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplacePublicationReviewResource
}

function reviewOperation(value: unknown, path: string): MarketplacePublicationReviewOperation {
  if (typeof value !== 'string' || !REVIEW_OPERATIONS.has(value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplacePublicationReviewOperation
}

function parseReviewChange(value: unknown, index: number): MarketplacePublicationReviewChangeV1 {
  const path = `marketplacePublicationRequest.review.changes[${index}]`
  const source = parseExactManifestRecord(value, path, REVIEW_CHANGE_KEYS, REVIEW_CHANGE_KEYS)
  const operation = reviewOperation(source.operation, `${path}.operation`)
  const beforeDigest = nullableDigest(source.beforeDigest, `${path}.beforeDigest`)
  const afterDigest = nullableDigest(source.afterDigest, `${path}.afterDigest`)
  if (
    (operation === 'add' && (beforeDigest !== null || afterDigest === null)) ||
    (operation === 'remove' && (beforeDigest === null || afterDigest !== null)) ||
    ((operation === 'restrict' || operation === 'replace') &&
      (beforeDigest === null || afterDigest === null))
  ) {
    throw new TypeError(`${path} digests do not match its operation`)
  }
  return Object.freeze({
    resource: reviewResource(source.resource, `${path}.resource`),
    operation,
    subject: boundedText(
      source.subject,
      `${path}.subject`,
      MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxReviewSubjectBytes
    ),
    description: boundedText(
      source.description,
      `${path}.description`,
      MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxReviewDescriptionBytes
    ),
    beforeDigest,
    afterDigest
  })
}

function parseReview(value: unknown): MarketplacePublicationReviewV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplacePublicationRequest.review',
    REVIEW_KEYS,
    REVIEW_KEYS
  )
  const changes = parseBoundedManifestArray(
    source.changes,
    'marketplacePublicationRequest.review.changes',
    MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxReviewChanges
  ).map(parseReviewChange)
  if (new Set(changes.map(({ subject }) => subject)).size !== changes.length) {
    throw new TypeError('marketplacePublicationRequest.review.changes contains duplicate subjects')
  }
  return Object.freeze({ changes: Object.freeze(changes) })
}

function assertExactReview(
  review: MarketplacePublicationReviewV1,
  baseline: MarketplacePublicationProjectionV1 | null,
  plan: MarketplacePublicationProjectionV1
): void {
  const expected = buildReviewChanges(baseline, plan)
  if (canonicalManifestJSON(review.changes) !== canonicalManifestJSON(expected)) {
    throw new TypeError('marketplacePublicationRequest.review is not the exact derived plan diff')
  }
}

function assertEmergencyReduction(
  review: MarketplacePublicationReviewV1,
  plan: MarketplacePublicationProjectionV1
): void {
  if (review.changes.length === 0) {
    throw new TypeError('Emergency revocation publication must contain a concrete reduction')
  }
  const planItems = new Map(reviewItems(plan).map((item) => [item.subject, item]))
  const generatedAt = Date.parse(plan.snapshot.generatedAt)
  for (const change of review.changes) {
    if (change.operation !== 'remove' && change.operation !== 'restrict') {
      throw new TypeError(
        `Emergency revocation publication may not add or expand ${change.subject}`
      )
    }
    if (
      change.operation === 'restrict' &&
      change.resource !== 'publisher' &&
      change.resource !== 'publisher-key' &&
      change.resource !== 'ownership'
    ) {
      throw new TypeError(
        `Emergency revocation publication may not replace distribution ${change.subject}`
      )
    }
    if (
      change.operation === 'restrict' &&
      (change.resource === 'publisher-key' || change.resource === 'ownership')
    ) {
      const value = planItems.get(change.subject)?.value
      if (
        !isRevocableReviewValue(value) ||
        typeof value.revokedAt !== 'string' ||
        Date.parse(value.revokedAt) > generatedAt
      ) {
        throw new TypeError(
          `Emergency revocation ${change.subject} must be effective by plan generation`
        )
      }
    }
  }
}

/**
 * Proves that an already parsed candidate projection can only reduce another
 * already parsed projection. The offline signer uses this a second time
 * against the projection independently reconstructed from current state, so
 * an emergency request cannot resurrect authority that was revoked after the
 * previous signed baseline.
 */
export function assertMarketplaceEmergencyPublicationReduction(
  baseline: MarketplacePublicationProjectionV1,
  plan: MarketplacePublicationProjectionV1
): void {
  assertEmergencyReduction({ changes: buildReviewChanges(baseline, plan) }, plan)
}

/**
 * Allows equality or a monotonic emergency reduction. Metadata that is not a
 * review resource is deliberately ignored here and remains bound by the
 * projection parser/request state checks.
 */
export function assertMarketplacePublicationNoExpansion(
  baseline: MarketplacePublicationProjectionV1,
  plan: MarketplacePublicationProjectionV1
): void {
  const changes = buildReviewChanges(baseline, plan)
  if (changes.length === 0) return
  assertEmergencyReduction({ changes }, plan)
}

function canonicalRequestText(value: MarketplacePublicationRequestV1): string {
  return `${JSON.stringify(JSON.parse(canonicalManifestJSON(value)), null, 2)}\n`
}

function assertRequestSize(value: MarketplacePublicationRequestV1): void {
  if (
    byteLength(canonicalRequestText(value)) > MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes
  ) {
    throw new TypeError(
      `Marketplace publication request may not exceed ${MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes} bytes`
    )
  }
}

export function marketplacePublicationStateDigest(state: unknown): string {
  return digestValue(parseMarketplaceState(state))
}

export function parseMarketplacePublicationRequest(
  value: unknown
): MarketplacePublicationRequestV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplacePublicationRequest',
    REQUEST_KEYS,
    REQUEST_KEYS
  )
  if (source.format !== MARKETPLACE_PUBLICATION_REQUEST_FORMAT) {
    throw new TypeError('marketplacePublicationRequest.format is not supported')
  }
  if (source.schemaVersion !== MARKETPLACE_PUBLICATION_REQUEST_SCHEMA_VERSION) {
    throw new TypeError('marketplacePublicationRequest.schemaVersion is not supported')
  }
  const parsedPurpose = purpose(source.purpose)
  const marketplaceId = identity(
    source.marketplaceId,
    'marketplacePublicationRequest.marketplaceId'
  )
  const rootKeyId = identity(source.rootKeyId, 'marketplacePublicationRequest.rootKeyId')
  const publicBaseURL = baseURL(source.publicBaseUrl)
  const expectedNextSequence = positiveSafeInteger(
    source.expectedNextSequence,
    'marketplacePublicationRequest.expectedNextSequence'
  )
  const previousPublicationSnapshotDigest = nullableDigest(
    source.previousPublicationSnapshotDigest,
    'marketplacePublicationRequest.previousPublicationSnapshotDigest'
  )
  const previousPublicationSnapshotArtifactDigest = nullableDigest(
    source.previousPublicationSnapshotArtifactDigest,
    'marketplacePublicationRequest.previousPublicationSnapshotArtifactDigest'
  )
  if (
    (expectedNextSequence === 1) !== (previousPublicationSnapshotDigest === null) ||
    (expectedNextSequence === 1) !== (previousPublicationSnapshotArtifactDigest === null)
  ) {
    throw new TypeError(
      'marketplacePublicationRequest previous snapshot digests must match its expected sequence'
    )
  }
  const auditSequence = positiveSafeInteger(
    source.auditSequence,
    'marketplacePublicationRequest.auditSequence'
  )
  const auditHead = parseSha256Base64URL(
    source.auditHead,
    'marketplacePublicationRequest.auditHead'
  )
  const stateDigest = parseSha256Base64URL(
    source.stateDigest,
    'marketplacePublicationRequest.stateDigest'
  )
  const planDigest = parseSha256Base64URL(
    source.planDigest,
    'marketplacePublicationRequest.planDigest'
  )
  const baselineDigest = nullableDigest(
    source.baselineDigest,
    'marketplacePublicationRequest.baselineDigest'
  )
  const generatedAt = parseMarketplaceTimestamp(
    source.generatedAt,
    'marketplacePublicationRequest.generatedAt'
  )
  const expiresAt = parseMarketplaceTimestamp(
    source.expiresAt,
    'marketplacePublicationRequest.expiresAt'
  )
  const validity = Date.parse(expiresAt) - Date.parse(generatedAt)
  if (validity <= 0 || validity > MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxValidityMilliseconds) {
    throw new TypeError(
      'marketplacePublicationRequest validity must be positive and no longer than 7 days'
    )
  }
  const projectionContext = {
    marketplaceId,
    rootKeyId,
    publicBaseURL,
    expectedSequence: expectedNextSequence,
    expectedGeneratedAt: generatedAt,
    expectedExpiresAt: expiresAt,
    expectedAuditSequence: auditSequence,
    expectedAuditHead: auditHead,
    label: 'marketplacePublicationRequest.plan'
  }
  const plan = parseProjection(source.plan, projectionContext)
  if (digestValue(plan) !== planDigest) {
    throw new TypeError('marketplacePublicationRequest.planDigest does not match the exact plan')
  }
  const baseline =
    source.baseline === null
      ? null
      : parseProjection(source.baseline, {
          marketplaceId,
          rootKeyId,
          publicBaseURL,
          expectedSequence: expectedNextSequence - 1,
          label: 'marketplacePublicationRequest.baseline'
        })
  if ((expectedNextSequence === 1) !== (baseline === null)) {
    throw new TypeError('marketplacePublicationRequest baseline must match its expected sequence')
  }
  if ((baseline === null) !== (baselineDigest === null)) {
    throw new TypeError('marketplacePublicationRequest baselineDigest must match its baseline')
  }
  if (baseline && digestValue(baseline) !== baselineDigest) {
    throw new TypeError(
      'marketplacePublicationRequest.baselineDigest does not match the exact baseline'
    )
  }
  if (baseline && Date.parse(baseline.snapshot.generatedAt) >= Date.parse(generatedAt)) {
    throw new TypeError('marketplacePublicationRequest baseline must predate the new plan')
  }
  const review = parseReview(source.review)
  assertExactReview(review, baseline, plan)
  if (parsedPurpose === 'emergency-revocation') {
    if (!baseline) {
      throw new TypeError('Emergency revocation publication requires a prior publication baseline')
    }
    assertMarketplaceEmergencyPublicationReduction(baseline, plan)
  }
  if (parsedPurpose === 'revocation-recovery' && !baseline) {
    throw new TypeError('Revocation recovery publication requires a prior publication baseline')
  }
  const request = Object.freeze({
    format: MARKETPLACE_PUBLICATION_REQUEST_FORMAT,
    schemaVersion: MARKETPLACE_PUBLICATION_REQUEST_SCHEMA_VERSION,
    purpose: parsedPurpose,
    marketplaceId,
    rootKeyId,
    publicBaseUrl: publicBaseURL,
    expectedNextSequence,
    previousPublicationSnapshotDigest,
    previousPublicationSnapshotArtifactDigest,
    auditSequence,
    auditHead,
    stateDigest,
    planDigest,
    baselineDigest,
    generatedAt,
    expiresAt,
    baseline,
    plan,
    review
  })
  assertRequestSize(request)
  return request
}

export function serializeMarketplacePublicationRequest(value: unknown): string {
  return canonicalRequestText(parseMarketplacePublicationRequest(value))
}

export function marketplacePublicationRequestBytes(value: unknown): Uint8Array {
  return encoder.encode(serializeMarketplacePublicationRequest(value))
}

export function marketplacePublicationRequestDigest(value: unknown): string {
  return digestBytes(marketplacePublicationRequestBytes(value))
}

export function parseMarketplacePublicationRequestJSON(
  source: string
): MarketplacePublicationRequestV1 {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    byteLength(source) > MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes
  ) {
    throw new TypeError('Marketplace publication request JSON must be non-empty bounded text')
  }
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    throw new TypeError('Marketplace publication request must contain valid JSON')
  }
  const request = parseMarketplacePublicationRequest(value)
  if (serializeMarketplacePublicationRequest(request) !== source) {
    throw new TypeError(
      'Marketplace publication request must use the exact canonical JSON encoding'
    )
  }
  return request
}

export function parseMarketplacePublicationRequestBytes(
  source: Uint8Array
): MarketplacePublicationRequestV1 {
  if (!(source instanceof Uint8Array) || source.byteLength === 0) {
    throw new TypeError('Marketplace publication request must be non-empty raw bytes')
  }
  if (source.byteLength > MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes) {
    throw new TypeError(
      `Marketplace publication request may not exceed ${MARKETPLACE_PUBLICATION_REQUEST_LIMITS.maxJsonBytes} bytes`
    )
  }
  let text: string
  try {
    text = decoder.decode(source)
  } catch {
    throw new TypeError('Marketplace publication request must contain valid UTF-8')
  }
  return parseMarketplacePublicationRequestJSON(text)
}

function stateBinding(state: MarketplaceStateV1): {
  expectedNextSequence: number
  previousPublicationSnapshotDigest: string | null
  previousPublicationSnapshotArtifactDigest: string | null
  auditSequence: number
  auditHead: string
  stateDigest: string
} {
  const parsed = parseMarketplaceState(state)
  const auditSequence = parsed.auditEvents.length
  const auditHead = parsed.auditEvents.at(-1)?.eventHash
  if (!auditHead || auditSequence === 0) {
    throw new TypeError('Marketplace publication request requires a non-empty verified audit chain')
  }
  const previous = parsed.publications.at(-1)
  return {
    expectedNextSequence: (previous?.sequence ?? 0) + 1,
    previousPublicationSnapshotDigest: previous?.snapshotDigest ?? null,
    previousPublicationSnapshotArtifactDigest: previous?.snapshotArtifactDigest ?? null,
    auditSequence,
    auditHead,
    stateDigest: marketplacePublicationStateDigest(parsed)
  }
}

export function assertMarketplacePublicationRequestState(
  request: unknown,
  state: MarketplaceStateV1
): MarketplacePublicationRequestV1 {
  const parsed = parseMarketplacePublicationRequest(request)
  const trustedState = parseMarketplaceState(state)
  const binding = stateBinding(trustedState)
  if (
    parsed.expectedNextSequence !== binding.expectedNextSequence ||
    parsed.previousPublicationSnapshotDigest !== binding.previousPublicationSnapshotDigest ||
    parsed.previousPublicationSnapshotArtifactDigest !==
      binding.previousPublicationSnapshotArtifactDigest ||
    parsed.auditSequence !== binding.auditSequence ||
    parsed.auditHead !== binding.auditHead ||
    parsed.stateDigest !== binding.stateDigest
  ) {
    throw new TypeError('Marketplace publication request is not bound to the current trusted state')
  }
  const latestAuditEvent = trustedState.auditEvents.at(-1)
  if (latestAuditEvent && Date.parse(parsed.generatedAt) < Date.parse(latestAuditEvent.time)) {
    throw new TypeError(
      'Marketplace publication request time must not precede the latest trusted audit event'
    )
  }
  return parsed
}

export function createMarketplacePublicationRequest(
  input: CreateMarketplacePublicationRequestInput
): MarketplacePublicationRequestV1 {
  const marketplaceId = identity(input.marketplaceId, 'marketplacePublicationRequest.marketplaceId')
  const rootKeyId = identity(input.rootKeyId, 'marketplacePublicationRequest.rootKeyId')
  const publicBaseURL = baseURL(input.publicBaseUrl)
  const binding = stateBinding(input.state)
  const plan = parseProjection(input.plan, {
    marketplaceId,
    rootKeyId,
    publicBaseURL,
    expectedSequence: binding.expectedNextSequence,
    expectedAuditSequence: binding.auditSequence,
    expectedAuditHead: binding.auditHead,
    label: 'marketplacePublicationRequest.plan'
  })
  const baseline =
    input.baseline === null
      ? null
      : parseProjection(input.baseline, {
          marketplaceId,
          rootKeyId,
          publicBaseURL,
          expectedSequence: binding.expectedNextSequence - 1,
          label: 'marketplacePublicationRequest.baseline'
        })
  return assertMarketplacePublicationRequestState(
    {
      format: MARKETPLACE_PUBLICATION_REQUEST_FORMAT,
      schemaVersion: MARKETPLACE_PUBLICATION_REQUEST_SCHEMA_VERSION,
      purpose: input.purpose,
      marketplaceId,
      rootKeyId,
      publicBaseUrl: publicBaseURL,
      ...binding,
      planDigest: digestValue(plan),
      baselineDigest: baseline ? digestValue(baseline) : null,
      generatedAt: plan.snapshot.generatedAt,
      expiresAt: plan.snapshot.expiresAt,
      baseline,
      plan,
      review: { changes: buildReviewChanges(baseline, plan) }
    },
    input.state
  )
}
