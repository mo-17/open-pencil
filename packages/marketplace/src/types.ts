/* eslint-disable max-lines -- Marketplace schemas, strict parsers, and legal transitions form one versioned protocol boundary. */
import { createHash } from 'node:crypto'

import {
  canonicalManifestValue,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  parseStableSemver,
  validateModuleIdentity
} from '@open-pencil/scene-graph'

export const MARKETPLACE_STATE_FORMAT = 'openpencil-marketplace-state' as const
export const MARKETPLACE_SCHEMA_VERSION = 1 as const

export const MARKETPLACE_LIMITS = Object.freeze({
  maxStateJsonBytes: 32 * 1024 * 1024,
  maxPublishers: 1_024,
  maxPublisherKeys: 4_096,
  maxOwnerships: 8_192,
  maxSubmissions: 32_768,
  maxSubmissionRevisions: 128,
  maxReleases: 16_384,
  maxPublications: 128,
  maxAuditEvents: 100_000,
  maxDisplayNameBytes: 256,
  maxSummaryBytes: 1_024,
  maxDescriptionBytes: 16 * 1024,
  maxReasonBytes: 4 * 1024,
  maxPemBytes: 8 * 1024,
  maxUrlBytes: 2_048,
  maxCategories: 16,
  maxCategoryBytes: 64,
  maxRuntimePackageBytes: 256 * 1024 * 1024,
  maxAuditActorBytes: 256,
  maxAuditSubjectBytes: 512,
  maxAuditPayloadBytes: 64 * 1024,
  maxAuditPayloadDepth: 16,
  maxAuditPayloadEntries: 512,
  maxAuditPayloadStringBytes: 16 * 1024
})

export const MARKETPLACE_PUBLISHER_STATUSES = [
  'pending',
  'active',
  'rejected',
  'suspended'
] as const
export const MARKETPLACE_PUBLISHER_KEY_STATUSES = [
  'pending',
  'active',
  'rejected',
  'revoked'
] as const
export const MARKETPLACE_OWNERSHIP_STATUSES = [
  'requested',
  'active',
  'rejected',
  'revoked'
] as const
export const MARKETPLACE_SUBMISSION_STATUSES = [
  'submitted',
  'validation_failed',
  'awaiting_review',
  'changes_requested',
  'rejected',
  'approved',
  'withdrawn',
  'published',
  'yanked'
] as const
export const MARKETPLACE_RELEASE_CHANNELS = ['stable', 'beta'] as const
export const MARKETPLACE_RUNTIME_KINDS = ['wasm', 'javascript'] as const
export const MARKETPLACE_AUDIT_ACTIONS = [
  'publisher.created',
  'publisher.status_changed',
  'publisher_key.registered',
  'publisher_key.status_changed',
  'ownership.requested',
  'ownership.status_changed',
  'submission.created',
  'submission.revised',
  'submission.signing_key_pinned',
  'submission.status_changed',
  'release.published',
  'release.yanked',
  'publication.reservation_cancelled',
  'publication.recorded'
] as const

export type MarketplacePublisherStatus = (typeof MARKETPLACE_PUBLISHER_STATUSES)[number]
export type MarketplacePublisherKeyStatus = (typeof MARKETPLACE_PUBLISHER_KEY_STATUSES)[number]
export type MarketplaceOwnershipStatus = (typeof MARKETPLACE_OWNERSHIP_STATUSES)[number]
export type MarketplaceSubmissionStatus = (typeof MARKETPLACE_SUBMISSION_STATUSES)[number]
export type MarketplaceReleaseChannel = (typeof MARKETPLACE_RELEASE_CHANNELS)[number]
export type MarketplaceRuntimeKind = (typeof MARKETPLACE_RUNTIME_KINDS)[number]
export type MarketplaceAuditAction = (typeof MARKETPLACE_AUDIT_ACTIONS)[number]

export type MarketplaceJSONValue =
  | null
  | boolean
  | number
  | string
  | readonly MarketplaceJSONValue[]
  | Readonly<{ [key: string]: MarketplaceJSONValue }>

export interface MarketplacePublisherV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  id: string
  displayName: string
  status: MarketplacePublisherStatus
  createdAt: string
  updatedAt: string
  statusReason: string | null
}

export interface MarketplacePublisherKeyV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  keyId: string
  publisherId: string
  publicKeyPem: string
  notBefore: string
  notAfter: string
  predecessorKeyId: string | null
  status: MarketplacePublisherKeyStatus
  createdAt: string
  updatedAt: string
  statusReason: string | null
  revokedAt: string | null
  revocationReason: string | null
}

export interface MarketplaceOwnershipV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  pluginId: string
  publisherId: string
  status: MarketplaceOwnershipStatus
  requestedAt: string
  updatedAt: string
  statusReason: string | null
}

export interface MarketplaceReleaseCoordinateV1 {
  pluginId: string
  version: string
  channel: MarketplaceReleaseChannel
}

export interface MarketplaceRuntimeCoordinateV1 {
  packageDigest: string
  packageUrl: string
  byteLength: number
  kind: MarketplaceRuntimeKind
}

export interface MarketplaceListingMetadataV1 {
  displayName: string
  summary: string
  description: string
  categories: readonly string[]
  iconUrl: string | null
  homepageUrl: string | null
}

export interface MarketplaceSubmissionV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  id: string
  publisherId: string
  coordinate: MarketplaceReleaseCoordinateV1
  manifestDigest: string
  artifactDigest: string
  manifestUrl: string
  listing: MarketplaceListingMetadataV1
  listingDigest: string
  runtimeCoordinate: MarketplaceRuntimeCoordinateV1 | null
  signingKeyId: string | null
  authenticatedRequestKeyId: string | null
  revision: number
  revisionCreatedAt: string
  revisionHistory: readonly MarketplaceSubmissionRevisionV1[]
  status: MarketplaceSubmissionStatus
  submittedAt: string
  updatedAt: string
  statusReason: string | null
}

export interface MarketplaceSubmissionRevisionV1 {
  revision: number
  signingKeyId: string | null
  authenticatedRequestKeyId: string | null
  manifestDigest: string
  artifactDigest: string
  manifestUrl: string
  listing: MarketplaceListingMetadataV1
  listingDigest: string
  runtimeCoordinate: MarketplaceRuntimeCoordinateV1 | null
  createdAt: string
  supersededAt: string
  supersededBy: string
  supersededFromStatus: 'validation_failed' | 'changes_requested'
  supersededReason: string
}

export interface MarketplaceReleaseV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  coordinate: MarketplaceReleaseCoordinateV1
  submissionId: string
  submissionRevision: number
  publisherId: string
  manifestDigest: string
  artifactDigest: string
  manifestUrl: string
  runtimeCoordinate: MarketplaceRuntimeCoordinateV1 | null
  publishedAt: string
  yankedAt: string | null
  yankReason: string | null
}

export interface MarketplacePublicationCatalogV1 {
  channel: MarketplaceReleaseChannel
  catalogDigest: string
  artifactDigest: string
}

export interface MarketplacePublicationV1 {
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  sequence: number
  snapshotDigest: string
  snapshotArtifactDigest: string
  catalogs: readonly MarketplacePublicationCatalogV1[]
  runtimeIndexDigest: string | null
  runtimeIndexArtifactDigest: string | null
  auditSequence: number
  auditHead: string | null
  publishedAt: string
}

export interface RecordMarketplacePublicationInput {
  snapshotDigest: string
  snapshotArtifactDigest: string
  catalogs: readonly MarketplacePublicationCatalogV1[]
  runtimeIndexDigest?: string | null
  runtimeIndexArtifactDigest?: string | null
}

export interface MarketplaceAuditEventV1 {
  sequence: number
  time: string
  actor: string
  action: MarketplaceAuditAction
  subject: string
  payloadDigest: string
  contextDigest?: string
  previousHash: string | null
  eventHash: string
}

export interface MarketplaceAuditContextV1 {
  sequence: number
  reason: string | null
  correlationId: string | null
  contextDigest: string
}

export interface MarketplaceStateV1 {
  format: typeof MARKETPLACE_STATE_FORMAT
  schemaVersion: typeof MARKETPLACE_SCHEMA_VERSION
  publishers: readonly MarketplacePublisherV1[]
  publisherKeys: readonly MarketplacePublisherKeyV1[]
  ownerships: readonly MarketplaceOwnershipV1[]
  submissions: readonly MarketplaceSubmissionV1[]
  releases: readonly MarketplaceReleaseV1[]
  publications: readonly MarketplacePublicationV1[]
  auditEvents: readonly MarketplaceAuditEventV1[]
  auditContexts: readonly MarketplaceAuditContextV1[]
}

export interface CreateMarketplacePublisherInput {
  id: string
  displayName: string
}

export interface RegisterMarketplacePublisherKeyInput {
  keyId: string
  publisherId: string
  publicKeyPem: string
  notBefore: string
  notAfter: string
  predecessorKeyId?: string | null
}

export interface RequestMarketplaceOwnershipInput {
  pluginId: string
  publisherId: string
}

export interface CreateMarketplaceSubmissionInput {
  id: string
  publisherId: string
  coordinate: MarketplaceReleaseCoordinateV1
  manifestDigest: string
  artifactDigest: string
  manifestUrl: string
  listing: MarketplaceListingMetadataV1
  listingDigest: string
  runtimeCoordinate?: MarketplaceRuntimeCoordinateV1 | null
  signingKeyId: string
  authenticatedRequestKeyId: string
}

export interface MarketplaceMutationContext {
  actor: string
  time?: string
  reason?: string
  correlationId?: string
}

const PUBLISHER_KEYS = new Set([
  'schemaVersion',
  'id',
  'displayName',
  'status',
  'createdAt',
  'updatedAt',
  'statusReason'
])
const PUBLISHER_KEY_KEYS = new Set([
  'schemaVersion',
  'keyId',
  'publisherId',
  'publicKeyPem',
  'notBefore',
  'notAfter',
  'predecessorKeyId',
  'status',
  'createdAt',
  'updatedAt',
  'statusReason',
  'revokedAt',
  'revocationReason'
])
const OWNERSHIP_KEYS = new Set([
  'schemaVersion',
  'pluginId',
  'publisherId',
  'status',
  'requestedAt',
  'updatedAt',
  'statusReason'
])
const COORDINATE_KEYS = new Set(['pluginId', 'version', 'channel'])
const RUNTIME_COORDINATE_KEYS = new Set(['packageDigest', 'packageUrl', 'byteLength', 'kind'])
const LISTING_KEYS = new Set([
  'displayName',
  'summary',
  'description',
  'categories',
  'iconUrl',
  'homepageUrl'
])
const SUBMISSION_KEYS = new Set([
  'schemaVersion',
  'id',
  'publisherId',
  'coordinate',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'listing',
  'listingDigest',
  'runtimeCoordinate',
  'signingKeyId',
  'authenticatedRequestKeyId',
  'revision',
  'revisionCreatedAt',
  'revisionHistory',
  'status',
  'submittedAt',
  'updatedAt',
  'statusReason'
])
const LEGACY_SUBMISSION_KEYS = new Set([
  'schemaVersion',
  'id',
  'publisherId',
  'coordinate',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'listing',
  'runtimeCoordinate',
  'status',
  'submittedAt',
  'updatedAt',
  'statusReason'
])
const SUBMISSION_REVISION_KEYS = new Set([
  'revision',
  'signingKeyId',
  'authenticatedRequestKeyId',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'listing',
  'listingDigest',
  'runtimeCoordinate',
  'createdAt',
  'supersededAt',
  'supersededBy',
  'supersededFromStatus',
  'supersededReason'
])
const RELEASE_KEYS = new Set([
  'schemaVersion',
  'coordinate',
  'submissionId',
  'submissionRevision',
  'publisherId',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'runtimeCoordinate',
  'publishedAt',
  'yankedAt',
  'yankReason'
])
const LEGACY_RELEASE_KEYS = new Set([
  'schemaVersion',
  'coordinate',
  'submissionId',
  'publisherId',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'runtimeCoordinate',
  'publishedAt',
  'yankedAt',
  'yankReason'
])
const AUDIT_EVENT_KEYS = new Set([
  'sequence',
  'time',
  'actor',
  'action',
  'subject',
  'payloadDigest',
  'contextDigest',
  'previousHash',
  'eventHash'
])
const AUDIT_EVENT_REQUIRED_KEYS = new Set([
  'sequence',
  'time',
  'actor',
  'action',
  'subject',
  'payloadDigest',
  'previousHash',
  'eventHash'
])
const AUDIT_CONTEXT_KEYS = new Set(['sequence', 'reason', 'correlationId', 'contextDigest'])
const PUBLICATION_CATALOG_KEYS = new Set(['channel', 'catalogDigest', 'artifactDigest'])
const PUBLICATION_KEYS = new Set([
  'schemaVersion',
  'sequence',
  'snapshotDigest',
  'snapshotArtifactDigest',
  'catalogs',
  'runtimeIndexDigest',
  'runtimeIndexArtifactDigest',
  'auditSequence',
  'auditHead',
  'publishedAt'
])
const RECORD_PUBLICATION_KEYS = new Set([
  'snapshotDigest',
  'snapshotArtifactDigest',
  'catalogs',
  'runtimeIndexDigest',
  'runtimeIndexArtifactDigest'
])
const RECORD_PUBLICATION_REQUIRED_KEYS = new Set([
  'snapshotDigest',
  'snapshotArtifactDigest',
  'catalogs'
])
const STATE_KEYS = new Set([
  'format',
  'schemaVersion',
  'publishers',
  'publisherKeys',
  'ownerships',
  'submissions',
  'releases',
  'publications',
  'auditEvents',
  'auditContexts'
])
const STATE_REQUIRED_KEYS = new Set([
  'format',
  'schemaVersion',
  'publishers',
  'publisherKeys',
  'ownerships',
  'submissions',
  'releases',
  'publications',
  'auditEvents'
])
const CREATE_PUBLISHER_KEYS = new Set(['id', 'displayName'])
const REGISTER_PUBLISHER_KEY_KEYS = new Set([
  'keyId',
  'publisherId',
  'publicKeyPem',
  'notBefore',
  'notAfter',
  'predecessorKeyId'
])
const REGISTER_PUBLISHER_KEY_REQUIRED_KEYS = new Set([
  'keyId',
  'publisherId',
  'publicKeyPem',
  'notBefore',
  'notAfter'
])
const REQUEST_OWNERSHIP_KEYS = new Set(['pluginId', 'publisherId'])
const CREATE_SUBMISSION_KEYS = new Set([
  'id',
  'publisherId',
  'coordinate',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'listing',
  'listingDigest',
  'runtimeCoordinate',
  'signingKeyId',
  'authenticatedRequestKeyId'
])
const CREATE_SUBMISSION_REQUIRED_KEYS = new Set([
  'id',
  'publisherId',
  'coordinate',
  'manifestDigest',
  'artifactDigest',
  'manifestUrl',
  'listing',
  'listingDigest',
  'signingKeyId',
  'authenticatedRequestKeyId'
])
const MUTATION_CONTEXT_KEYS = new Set(['actor', 'time', 'reason', 'correlationId'])
const MUTATION_CONTEXT_REQUIRED_KEYS = new Set(['actor'])

const NEGATIVE_PUBLISHER_STATUSES = new Set<MarketplacePublisherStatus>(['rejected', 'suspended'])
const NEGATIVE_PUBLISHER_KEY_STATUSES = new Set<MarketplacePublisherKeyStatus>(['rejected'])
const NEGATIVE_OWNERSHIP_STATUSES = new Set<MarketplaceOwnershipStatus>(['rejected', 'revoked'])
const NEGATIVE_SUBMISSION_STATUSES = new Set<MarketplaceSubmissionStatus>([
  'validation_failed',
  'changes_requested',
  'rejected',
  'withdrawn',
  'yanked'
])

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function schemaVersion(value: unknown, path: string): typeof MARKETPLACE_SCHEMA_VERSION {
  if (value !== MARKETPLACE_SCHEMA_VERSION) {
    throw new TypeError(`${path} must be ${MARKETPLACE_SCHEMA_VERSION}`)
  }
  return MARKETPLACE_SCHEMA_VERSION
}

export function parseMarketplaceIdentity(value: unknown, path: string): string {
  const reason = validateModuleIdentity(value, path)
  if (reason) throw new TypeError(reason)
  return value as string
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

export function parseMarketplaceReason(value: unknown, path: string): string {
  return boundedText(value, path, MARKETPLACE_LIMITS.maxReasonBytes)
}

function nullableReason(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplaceReason(value, path)
}

export function parseMarketplaceTimestamp(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 32) {
    throw new TypeError(`${path} must be a canonical UTC timestamp`)
  }
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${path} must be a valid canonical UTC timestamp`)
  }
  return value
}

export function parseMarketplacePublicURL(value: unknown, path: string): string {
  if (typeof value !== 'string' || byteLength(value) > MARKETPLACE_LIMITS.maxUrlBytes) {
    throw new TypeError(`${path} must be a bounded canonical public HTTPS URL`)
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError(`${path} must be a valid canonical public HTTPS URL`)
  }
  const hostname = url.hostname.toLowerCase()
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  const ipv6 = hostname.startsWith('[') && hostname.endsWith(']')
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (url.port !== '' && url.port !== '443') ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    ipv4 ||
    ipv6 ||
    url.href !== value
  ) {
    throw new TypeError(
      `${path} must be a canonical public HTTPS URL without credentials or fragments`
    )
  }
  return value
}

function nullablePublicURL(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplacePublicURL(value, path)
}

function enumValue<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  path: string
): Value {
  if (typeof value !== 'string' || !values.includes(value as Value)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as Value
}

function positiveSafeInteger(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new TypeError(`${path} must be a positive bounded safe integer`)
  }
  return value as number
}

function assertChronological(start: string, end: string, path: string): void {
  if (Date.parse(end) < Date.parse(start)) throw new TypeError(`${path} must not move backwards`)
}

function assertReasonForStatus(
  status: string,
  reason: string | null,
  negativeStatuses: ReadonlySet<string>,
  path: string
): void {
  if (negativeStatuses.has(status) !== (reason !== null)) {
    throw new TypeError(`${path} must be present exactly when status requires an explanation`)
  }
}

export function parseMarketplacePublisher(
  value: unknown,
  path = 'marketplace.publishers[0]'
): MarketplacePublisherV1 {
  const source = parseExactManifestRecord(value, path, PUBLISHER_KEYS)
  const createdAt = parseMarketplaceTimestamp(source.createdAt, `${path}.createdAt`)
  const updatedAt = parseMarketplaceTimestamp(source.updatedAt, `${path}.updatedAt`)
  assertChronological(createdAt, updatedAt, `${path}.updatedAt`)
  const status = enumValue(source.status, MARKETPLACE_PUBLISHER_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  assertReasonForStatus(status, statusReason, NEGATIVE_PUBLISHER_STATUSES, `${path}.statusReason`)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    id: parseMarketplaceIdentity(source.id, `${path}.id`),
    displayName: boundedText(
      source.displayName,
      `${path}.displayName`,
      MARKETPLACE_LIMITS.maxDisplayNameBytes
    ),
    status,
    createdAt,
    updatedAt,
    statusReason
  })
}

function publicKeyPem(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
    !value.endsWith('\n-----END PUBLIC KEY-----\n') ||
    byteLength(value) > MARKETPLACE_LIMITS.maxPemBytes
  ) {
    throw new TypeError(`${path} must be a bounded PEM public key`)
  }
  return value
}

export function parseMarketplacePublisherKey(
  value: unknown,
  path = 'marketplace.publisherKeys[0]'
): MarketplacePublisherKeyV1 {
  const source = parseExactManifestRecord(value, path, PUBLISHER_KEY_KEYS)
  const notBefore = parseMarketplaceTimestamp(source.notBefore, `${path}.notBefore`)
  const notAfter = parseMarketplaceTimestamp(source.notAfter, `${path}.notAfter`)
  if (Date.parse(notAfter) <= Date.parse(notBefore)) {
    throw new TypeError(`${path}.notAfter must be later than notBefore`)
  }
  const createdAt = parseMarketplaceTimestamp(source.createdAt, `${path}.createdAt`)
  const updatedAt = parseMarketplaceTimestamp(source.updatedAt, `${path}.updatedAt`)
  assertChronological(createdAt, updatedAt, `${path}.updatedAt`)
  const status = enumValue(source.status, MARKETPLACE_PUBLISHER_KEY_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  assertReasonForStatus(
    status,
    statusReason,
    NEGATIVE_PUBLISHER_KEY_STATUSES,
    `${path}.statusReason`
  )
  const revokedAt =
    source.revokedAt === null
      ? null
      : parseMarketplaceTimestamp(source.revokedAt, `${path}.revokedAt`)
  const revocationReason = nullableReason(source.revocationReason, `${path}.revocationReason`)
  if (status === 'revoked') {
    if (!revokedAt || !revocationReason) {
      throw new TypeError(`${path} revoked keys require revokedAt and revocationReason`)
    }
    if (updatedAt !== revokedAt) {
      throw new TypeError(`${path}.updatedAt must equal revokedAt for a revoked key`)
    }
  } else if (revokedAt !== null || revocationReason !== null) {
    throw new TypeError(`${path} non-revoked keys must not contain revocation details`)
  }
  const predecessorKeyId =
    source.predecessorKeyId === null
      ? null
      : parseMarketplaceIdentity(source.predecessorKeyId, `${path}.predecessorKeyId`)
  const keyId = parseMarketplaceIdentity(source.keyId, `${path}.keyId`)
  if (predecessorKeyId === keyId) {
    throw new TypeError(`${path}.predecessorKeyId must identify a different key`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    keyId,
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    publicKeyPem: publicKeyPem(source.publicKeyPem, `${path}.publicKeyPem`),
    notBefore,
    notAfter,
    predecessorKeyId,
    status,
    createdAt,
    updatedAt,
    statusReason,
    revokedAt,
    revocationReason
  })
}

export function parseMarketplaceOwnership(
  value: unknown,
  path = 'marketplace.ownerships[0]'
): MarketplaceOwnershipV1 {
  const source = parseExactManifestRecord(value, path, OWNERSHIP_KEYS)
  const requestedAt = parseMarketplaceTimestamp(source.requestedAt, `${path}.requestedAt`)
  const updatedAt = parseMarketplaceTimestamp(source.updatedAt, `${path}.updatedAt`)
  assertChronological(requestedAt, updatedAt, `${path}.updatedAt`)
  const status = enumValue(source.status, MARKETPLACE_OWNERSHIP_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  assertReasonForStatus(status, statusReason, NEGATIVE_OWNERSHIP_STATUSES, `${path}.statusReason`)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    pluginId: parseMarketplaceIdentity(source.pluginId, `${path}.pluginId`),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    status,
    requestedAt,
    updatedAt,
    statusReason
  })
}

export function parseMarketplaceReleaseCoordinate(
  value: unknown,
  path = 'marketplace.coordinate'
): MarketplaceReleaseCoordinateV1 {
  const source = parseExactManifestRecord(value, path, COORDINATE_KEYS)
  return Object.freeze({
    pluginId: parseMarketplaceIdentity(source.pluginId, `${path}.pluginId`),
    version: parseStableSemver(source.version, `${path}.version`),
    channel: enumValue(source.channel, MARKETPLACE_RELEASE_CHANNELS, `${path}.channel`)
  })
}

export function marketplaceReleaseCoordinateKey(
  coordinate: MarketplaceReleaseCoordinateV1
): string {
  const parsed = parseMarketplaceReleaseCoordinate(coordinate)
  return `${parsed.pluginId}@${parsed.version}#${parsed.channel}`
}

export function parseMarketplaceRuntimeCoordinate(
  value: unknown,
  path = 'marketplace.runtimeCoordinate'
): MarketplaceRuntimeCoordinateV1 {
  const source = parseExactManifestRecord(value, path, RUNTIME_COORDINATE_KEYS)
  return Object.freeze({
    packageDigest: parseSha256Base64URL(source.packageDigest, `${path}.packageDigest`),
    packageUrl: parseMarketplacePublicURL(source.packageUrl, `${path}.packageUrl`),
    byteLength: positiveSafeInteger(
      source.byteLength,
      `${path}.byteLength`,
      MARKETPLACE_LIMITS.maxRuntimePackageBytes
    ),
    kind: enumValue(source.kind, MARKETPLACE_RUNTIME_KINDS, `${path}.kind`)
  })
}

export function parseMarketplaceListingMetadata(
  value: unknown,
  path = 'marketplace.listing'
): MarketplaceListingMetadataV1 {
  const source = parseExactManifestRecord(value, path, LISTING_KEYS)
  const categories = parseBoundedManifestArray(
    source.categories,
    `${path}.categories`,
    MARKETPLACE_LIMITS.maxCategories
  ).map((category, index) =>
    boundedText(category, `${path}.categories[${index}]`, MARKETPLACE_LIMITS.maxCategoryBytes)
  )
  if (new Set(categories).size !== categories.length) {
    throw new TypeError(`${path}.categories must not contain duplicates`)
  }
  return Object.freeze({
    displayName: boundedText(
      source.displayName,
      `${path}.displayName`,
      MARKETPLACE_LIMITS.maxDisplayNameBytes
    ),
    summary: boundedText(source.summary, `${path}.summary`, MARKETPLACE_LIMITS.maxSummaryBytes),
    description: boundedText(
      source.description,
      `${path}.description`,
      MARKETPLACE_LIMITS.maxDescriptionBytes
    ),
    categories: Object.freeze(categories),
    iconUrl: nullablePublicURL(source.iconUrl, `${path}.iconUrl`),
    homepageUrl: nullablePublicURL(source.homepageUrl, `${path}.homepageUrl`)
  })
}

export function marketplaceListingDigest(value: MarketplaceListingMetadataV1): string {
  const listing = parseMarketplaceListingMetadata(value)
  return createHash('sha256')
    .update(JSON.stringify(canonicalManifestValue(listing)))
    .digest('base64url')
}

export function marketplacePublisherPublicKeyDigest(value: string): string {
  const parsed = publicKeyPem(value, 'marketplace.publisherPublicKey')
  return createHash('sha256').update(parsed).digest('base64url')
}

export function marketplaceSubmissionRevisionPayloadDigest(
  value: MarketplaceSubmissionV1 | MarketplaceSubmissionRevisionV1
): string {
  const createdAt = 'createdAt' in value ? value.createdAt : value.revisionCreatedAt
  return createHash('sha256')
    .update(
      JSON.stringify(
        canonicalManifestValue({
          signingKeyId: value.signingKeyId,
          authenticatedRequestKeyId: value.authenticatedRequestKeyId,
          manifestDigest: value.manifestDigest,
          artifactDigest: value.artifactDigest,
          manifestUrl: value.manifestUrl,
          createdAt,
          listing: value.listing,
          listingDigest: value.listingDigest,
          runtimeCoordinate: value.runtimeCoordinate
        })
      )
    )
    .digest('base64url')
}

function nullableMarketplaceIdentity(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplaceIdentity(value, path)
}

function parseMarketplaceSubmissionRevision(
  value: unknown,
  path: string
): MarketplaceSubmissionRevisionV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_REVISION_KEYS)
  const listing = parseMarketplaceListingMetadata(source.listing, `${path}.listing`)
  const listingDigest = parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`)
  if (listingDigest !== marketplaceListingDigest(listing)) {
    throw new TypeError(`${path}.listingDigest does not match listing`)
  }
  const createdAt = parseMarketplaceTimestamp(source.createdAt, `${path}.createdAt`)
  const supersededAt = parseMarketplaceTimestamp(source.supersededAt, `${path}.supersededAt`)
  assertChronological(createdAt, supersededAt, `${path}.supersededAt`)
  const supersededFromStatus = enumValue(
    source.supersededFromStatus,
    ['validation_failed', 'changes_requested'] as const,
    `${path}.supersededFromStatus`
  )
  return Object.freeze({
    revision: positiveSafeInteger(
      source.revision,
      `${path}.revision`,
      MARKETPLACE_LIMITS.maxSubmissionRevisions
    ),
    signingKeyId: nullableMarketplaceIdentity(source.signingKeyId, `${path}.signingKeyId`),
    authenticatedRequestKeyId: nullableMarketplaceIdentity(
      source.authenticatedRequestKeyId,
      `${path}.authenticatedRequestKeyId`
    ),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    manifestUrl: parseMarketplacePublicURL(source.manifestUrl, `${path}.manifestUrl`),
    listing,
    listingDigest,
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceRuntimeCoordinate(source.runtimeCoordinate, `${path}.runtimeCoordinate`),
    createdAt,
    supersededAt,
    supersededBy: parseMarketplaceAuditActor(source.supersededBy, `${path}.supersededBy`),
    supersededFromStatus,
    supersededReason: parseMarketplaceReason(source.supersededReason, `${path}.supersededReason`)
  })
}

export function parseMarketplaceSubmission(
  value: unknown,
  path = 'marketplace.submissions[0]'
): MarketplaceSubmissionV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_KEYS, LEGACY_SUBMISSION_KEYS)
  const submittedAt = parseMarketplaceTimestamp(source.submittedAt, `${path}.submittedAt`)
  const updatedAt = parseMarketplaceTimestamp(source.updatedAt, `${path}.updatedAt`)
  assertChronological(submittedAt, updatedAt, `${path}.updatedAt`)
  const status = enumValue(source.status, MARKETPLACE_SUBMISSION_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  assertReasonForStatus(status, statusReason, NEGATIVE_SUBMISSION_STATUSES, `${path}.statusReason`)
  const listing = parseMarketplaceListingMetadata(source.listing, `${path}.listing`)
  const listingDigest =
    source.listingDigest === undefined
      ? marketplaceListingDigest(listing)
      : parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`)
  if (listingDigest !== marketplaceListingDigest(listing)) {
    throw new TypeError(`${path}.listingDigest does not match listing`)
  }
  const revisionHistory = Object.freeze(
    (source.revisionHistory === undefined
      ? []
      : parseBoundedManifestArray(
          source.revisionHistory,
          `${path}.revisionHistory`,
          MARKETPLACE_LIMITS.maxSubmissionRevisions - 1
        )
    ).map((entry, index) => {
      const revision = parseMarketplaceSubmissionRevision(
        entry,
        `${path}.revisionHistory[${index}]`
      )
      if (revision.revision !== index + 1) {
        throw new TypeError(`${path}.revisionHistory must use contiguous one-based revisions`)
      }
      if (index > 0) {
        const previous = parseMarketplaceSubmissionRevision(
          (source.revisionHistory as readonly unknown[])[index - 1],
          `${path}.revisionHistory[${index - 1}]`
        )
        if (previous.supersededAt !== revision.createdAt) {
          throw new TypeError(
            `${path}.revisionHistory revisions must be created at the exact supersession time`
          )
        }
      }
      return revision
    })
  )
  const revision =
    source.revision === undefined
      ? 1
      : positiveSafeInteger(
          source.revision,
          `${path}.revision`,
          MARKETPLACE_LIMITS.maxSubmissionRevisions
        )
  if (revision !== revisionHistory.length + 1) {
    throw new TypeError(`${path}.revision must immediately follow revisionHistory`)
  }
  const revisionCreatedAt =
    source.revisionCreatedAt === undefined
      ? submittedAt
      : parseMarketplaceTimestamp(source.revisionCreatedAt, `${path}.revisionCreatedAt`)
  assertChronological(submittedAt, revisionCreatedAt, `${path}.revisionCreatedAt`)
  assertChronological(revisionCreatedAt, updatedAt, `${path}.updatedAt`)
  const latestHistoricalRevision = revisionHistory.at(-1)
  if (latestHistoricalRevision?.supersededAt !== undefined) {
    if (latestHistoricalRevision.supersededAt !== revisionCreatedAt) {
      throw new TypeError(
        `${path}.revisionCreatedAt must equal the latest revision supersession time`
      )
    }
  }
  const signingKeyId = nullableMarketplaceIdentity(
    source.signingKeyId === undefined ? null : source.signingKeyId,
    `${path}.signingKeyId`
  )
  const authenticatedRequestKeyId = nullableMarketplaceIdentity(
    source.authenticatedRequestKeyId === undefined ? null : source.authenticatedRequestKeyId,
    `${path}.authenticatedRequestKeyId`
  )
  if (revision > 1 && (signingKeyId === null || authenticatedRequestKeyId === null)) {
    throw new TypeError(`${path} revised payloads require exact signing key identities`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    id: parseMarketplaceIdentity(source.id, `${path}.id`),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    coordinate: parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    manifestUrl: parseMarketplacePublicURL(source.manifestUrl, `${path}.manifestUrl`),
    listing,
    listingDigest,
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceRuntimeCoordinate(source.runtimeCoordinate, `${path}.runtimeCoordinate`),
    signingKeyId,
    authenticatedRequestKeyId,
    revision,
    revisionCreatedAt,
    revisionHistory,
    status,
    submittedAt,
    updatedAt,
    statusReason
  })
}

export function parseMarketplaceRelease(
  value: unknown,
  path = 'marketplace.releases[0]'
): MarketplaceReleaseV1 {
  const source = parseExactManifestRecord(value, path, RELEASE_KEYS, LEGACY_RELEASE_KEYS)
  const publishedAt = parseMarketplaceTimestamp(source.publishedAt, `${path}.publishedAt`)
  const yankedAt =
    source.yankedAt === null ? null : parseMarketplaceTimestamp(source.yankedAt, `${path}.yankedAt`)
  const yankReason = nullableReason(source.yankReason, `${path}.yankReason`)
  if ((yankedAt === null) !== (yankReason === null)) {
    throw new TypeError(`${path}.yankedAt and yankReason must be present together`)
  }
  if (yankedAt) assertChronological(publishedAt, yankedAt, `${path}.yankedAt`)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    coordinate: parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`),
    submissionId: parseMarketplaceIdentity(source.submissionId, `${path}.submissionId`),
    submissionRevision:
      source.submissionRevision === undefined
        ? 1
        : positiveSafeInteger(
            source.submissionRevision,
            `${path}.submissionRevision`,
            MARKETPLACE_LIMITS.maxSubmissionRevisions
          ),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    manifestUrl: parseMarketplacePublicURL(source.manifestUrl, `${path}.manifestUrl`),
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceRuntimeCoordinate(source.runtimeCoordinate, `${path}.runtimeCoordinate`),
    publishedAt,
    yankedAt,
    yankReason
  })
}

function parseMarketplacePublicationCatalog(
  value: unknown,
  path: string
): MarketplacePublicationCatalogV1 {
  const source = parseExactManifestRecord(value, path, PUBLICATION_CATALOG_KEYS)
  return Object.freeze({
    channel: enumValue(source.channel, MARKETPLACE_RELEASE_CHANNELS, `${path}.channel`),
    catalogDigest: parseSha256Base64URL(source.catalogDigest, `${path}.catalogDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`)
  })
}

function parsePublicationCatalogs(
  value: unknown,
  path: string
): readonly MarketplacePublicationCatalogV1[] {
  const catalogs = parseBoundedManifestArray(value, path, 2).map((catalog, index) =>
    parseMarketplacePublicationCatalog(catalog, `${path}[${index}]`)
  )
  if (catalogs.length === 0) throw new TypeError(`${path} must not be empty`)
  if (new Set(catalogs.map(({ channel }) => channel)).size !== catalogs.length) {
    throw new TypeError(`${path} must not contain duplicate channels`)
  }
  const expectedOrder = ['stable', 'beta'] as const
  if (catalogs.some(({ channel }, index) => channel !== expectedOrder[index])) {
    throw new TypeError(`${path} must be ordered stable then beta`)
  }
  return Object.freeze(catalogs)
}

function nullableDigest(value: unknown, path: string): string | null {
  return value === null ? null : parseSha256Base64URL(value, path)
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value as number
}

export function parseMarketplacePublication(
  value: unknown,
  path = 'marketplace.publications[0]'
): MarketplacePublicationV1 {
  const source = parseExactManifestRecord(value, path, PUBLICATION_KEYS)
  const runtimeIndexDigest = nullableDigest(source.runtimeIndexDigest, `${path}.runtimeIndexDigest`)
  const runtimeIndexArtifactDigest = nullableDigest(
    source.runtimeIndexArtifactDigest,
    `${path}.runtimeIndexArtifactDigest`
  )
  if ((runtimeIndexDigest === null) !== (runtimeIndexArtifactDigest === null)) {
    throw new TypeError(`${path} runtime index digests must be present together`)
  }
  const auditSequence = nonNegativeSafeInteger(source.auditSequence, `${path}.auditSequence`)
  const auditHead = nullableDigest(source.auditHead, `${path}.auditHead`)
  if ((auditSequence === 0) !== (auditHead === null)) {
    throw new TypeError(`${path}.auditHead must match whether auditSequence is zero`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    sequence: positiveSafeInteger(source.sequence, `${path}.sequence`, Number.MAX_SAFE_INTEGER),
    snapshotDigest: parseSha256Base64URL(source.snapshotDigest, `${path}.snapshotDigest`),
    snapshotArtifactDigest: parseSha256Base64URL(
      source.snapshotArtifactDigest,
      `${path}.snapshotArtifactDigest`
    ),
    catalogs: parsePublicationCatalogs(source.catalogs, `${path}.catalogs`),
    runtimeIndexDigest,
    runtimeIndexArtifactDigest,
    auditSequence,
    auditHead,
    publishedAt: parseMarketplaceTimestamp(source.publishedAt, `${path}.publishedAt`)
  })
}

export function parseMarketplaceAuditActor(value: unknown, path = 'audit.actor'): string {
  return boundedText(value, path, MARKETPLACE_LIMITS.maxAuditActorBytes)
}

export function parseMarketplaceAuditSubject(value: unknown, path = 'audit.subject'): string {
  return boundedText(value, path, MARKETPLACE_LIMITS.maxAuditSubjectBytes)
}

export function parseMarketplaceCorrelationId(
  value: unknown,
  path = 'audit.correlationId'
): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new TypeError(`${path} must be bounded base64url identifier text`)
  }
  return value
}

export function marketplaceAuditContextDigest(value: {
  reason: string | null
  correlationId: string | null
}): string {
  const reason =
    value.reason === null ? null : parseMarketplaceReason(value.reason, 'audit.context.reason')
  const correlationId =
    value.correlationId === null
      ? null
      : parseMarketplaceCorrelationId(value.correlationId, 'audit.context.correlationId')
  return createHash('sha256')
    .update(JSON.stringify(canonicalManifestValue({ reason, correlationId })), 'utf8')
    .digest('base64url')
}

export function parseMarketplaceAuditContext(
  value: unknown,
  path = 'marketplace.auditContexts[0]'
): MarketplaceAuditContextV1 {
  const source = parseExactManifestRecord(value, path, AUDIT_CONTEXT_KEYS)
  const reason =
    source.reason === null ? null : parseMarketplaceReason(source.reason, `${path}.reason`)
  const correlationId =
    source.correlationId === null
      ? null
      : parseMarketplaceCorrelationId(source.correlationId, `${path}.correlationId`)
  const contextDigest = parseSha256Base64URL(source.contextDigest, `${path}.contextDigest`)
  if (contextDigest !== marketplaceAuditContextDigest({ reason, correlationId })) {
    throw new TypeError(`${path}.contextDigest does not match its audit context`)
  }
  return Object.freeze({
    sequence: positiveSafeInteger(
      source.sequence,
      `${path}.sequence`,
      MARKETPLACE_LIMITS.maxAuditEvents
    ),
    reason,
    correlationId,
    contextDigest
  })
}

export function parseMarketplaceAuditEvent(
  value: unknown,
  path = 'marketplace.auditEvents[0]'
): MarketplaceAuditEventV1 {
  const source = parseExactManifestRecord(value, path, AUDIT_EVENT_KEYS, AUDIT_EVENT_REQUIRED_KEYS)
  const sequence = positiveSafeInteger(
    source.sequence,
    `${path}.sequence`,
    MARKETPLACE_LIMITS.maxAuditEvents
  )
  const contextDigest =
    source.contextDigest === undefined
      ? undefined
      : parseSha256Base64URL(source.contextDigest, `${path}.contextDigest`)
  return Object.freeze({
    sequence,
    time: parseMarketplaceTimestamp(source.time, `${path}.time`),
    actor: parseMarketplaceAuditActor(source.actor, `${path}.actor`),
    action: enumValue(source.action, MARKETPLACE_AUDIT_ACTIONS, `${path}.action`),
    subject: parseMarketplaceAuditSubject(source.subject, `${path}.subject`),
    payloadDigest: parseSha256Base64URL(source.payloadDigest, `${path}.payloadDigest`),
    ...(contextDigest === undefined ? {} : { contextDigest }),
    previousHash:
      source.previousHash === null
        ? null
        : parseSha256Base64URL(source.previousHash, `${path}.previousHash`),
    eventHash: parseSha256Base64URL(source.eventHash, `${path}.eventHash`)
  })
}

function uniqueBy<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
  path: string
): void {
  const keys = values.map(key)
  if (new Set(keys).size !== keys.length) throw new TypeError(`${path} contains duplicate records`)
}

function assertPublisherKeyReferences(
  publisherKeys: readonly MarketplacePublisherKeyV1[],
  publishers: ReadonlyMap<string, MarketplacePublisherV1>
): void {
  const keys = new Map(publisherKeys.map((key) => [key.keyId, key]))
  for (const key of publisherKeys) {
    if (!publishers.has(key.publisherId)) {
      throw new TypeError(
        `marketplace.publisherKeys references unknown publisher ${key.publisherId}`
      )
    }
    if (!key.predecessorKeyId) continue
    const predecessor = keys.get(key.predecessorKeyId)
    if (!predecessor || predecessor.publisherId !== key.publisherId) {
      throw new TypeError(`marketplace.publisherKeys predecessor must belong to the same publisher`)
    }
    if (Date.parse(predecessor.notBefore) >= Date.parse(key.notBefore)) {
      throw new TypeError(`marketplace.publisherKeys rotations must advance notBefore`)
    }
    const seen = new Set([key.keyId])
    let current: MarketplacePublisherKeyV1 | undefined = predecessor
    while (current) {
      if (seen.has(current.keyId)) {
        throw new TypeError(`marketplace.publisherKeys contains a rotation cycle`)
      }
      seen.add(current.keyId)
      current = current.predecessorKeyId ? keys.get(current.predecessorKeyId) : undefined
    }
  }
}

function assertOwnershipReferences(
  ownerships: readonly MarketplaceOwnershipV1[],
  publishers: ReadonlyMap<string, MarketplacePublisherV1>
): void {
  for (const ownership of ownerships) {
    if (!publishers.has(ownership.publisherId)) {
      throw new TypeError(`marketplace.ownerships references unknown publisher`)
    }
  }
}

function assertSubmissionReferences(
  submissions: readonly MarketplaceSubmissionV1[],
  publishers: ReadonlyMap<string, MarketplacePublisherV1>,
  ownerships: ReadonlyMap<string, MarketplaceOwnershipV1>,
  releases: ReadonlyMap<string, MarketplaceReleaseV1>
): void {
  for (const submission of submissions) {
    if (!publishers.has(submission.publisherId)) {
      throw new TypeError(`marketplace.submissions references unknown publisher`)
    }
    const ownership = ownerships.get(submission.coordinate.pluginId)
    if (!ownership || ownership.publisherId !== submission.publisherId) {
      throw new TypeError(`marketplace.submissions violates immutable plugin ownership`)
    }
    const release = releases.get(marketplaceReleaseCoordinateKey(submission.coordinate))
    if (submission.status === 'published' || submission.status === 'yanked') {
      if (!release || release.submissionId !== submission.id) {
        throw new TypeError(`marketplace published submissions require their exact release`)
      }
      if ((submission.status === 'yanked') !== (release.yankedAt !== null)) {
        throw new TypeError(`marketplace submission and release yank status must match`)
      }
    } else if (release?.submissionId === submission.id) {
      throw new TypeError(`marketplace unpublished submissions must not own a release`)
    }
  }
}

function assertReleaseReferences(
  releases: readonly MarketplaceReleaseV1[],
  submissions: ReadonlyMap<string, MarketplaceSubmissionV1>
): void {
  for (const release of releases) {
    const submission = submissions.get(release.submissionId)
    if (
      !submission ||
      submission.revision !== release.submissionRevision ||
      submission.publisherId !== release.publisherId ||
      marketplaceReleaseCoordinateKey(submission.coordinate) !==
        marketplaceReleaseCoordinateKey(release.coordinate) ||
      submission.manifestDigest !== release.manifestDigest ||
      submission.artifactDigest !== release.artifactDigest ||
      submission.manifestUrl !== release.manifestUrl ||
      JSON.stringify(submission.runtimeCoordinate) !== JSON.stringify(release.runtimeCoordinate)
    ) {
      throw new TypeError(`marketplace.releases does not match its immutable submission snapshot`)
    }
  }
}

function assertEntityReferences(
  publishers: readonly MarketplacePublisherV1[],
  publisherKeys: readonly MarketplacePublisherKeyV1[],
  ownerships: readonly MarketplaceOwnershipV1[],
  submissions: readonly MarketplaceSubmissionV1[],
  releases: readonly MarketplaceReleaseV1[]
): void {
  const publisherById = new Map(publishers.map((publisher) => [publisher.id, publisher]))
  const ownershipByPlugin = new Map(ownerships.map((ownership) => [ownership.pluginId, ownership]))
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]))
  const releaseByCoordinate = new Map(
    releases.map((release) => [marketplaceReleaseCoordinateKey(release.coordinate), release])
  )
  assertPublisherKeyReferences(publisherKeys, publisherById)
  assertOwnershipReferences(ownerships, publisherById)
  assertSubmissionReferences(submissions, publisherById, ownershipByPlugin, releaseByCoordinate)
  assertReleaseReferences(releases, submissionById)
}

function assertAuditLinks(events: readonly MarketplaceAuditEventV1[]): void {
  let previousHash: string | null = null
  let previousTime = Number.NEGATIVE_INFINITY
  for (const [index, event] of events.entries()) {
    if (event.sequence !== index + 1) {
      throw new TypeError(`marketplace.auditEvents must use contiguous one-based sequences`)
    }
    if (event.previousHash !== previousHash) {
      throw new TypeError(`marketplace.auditEvents previousHash linkage is invalid`)
    }
    const time = Date.parse(event.time)
    if (time < previousTime) {
      throw new TypeError(`marketplace.auditEvents timestamps must not move backwards`)
    }
    previousHash = event.eventHash
    previousTime = time
  }
}

function marketplaceAuditPayloadDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalManifestValue(value)))
    .digest('base64url')
}

interface MarketplaceAuthorityAuditEvidence {
  readonly creation: ReadonlyMap<string, readonly MarketplaceAuditEventV1[]>
  readonly status: ReadonlyMap<string, readonly MarketplaceAuditEventV1[]>
}

function authorityAuditEventsBySubject(
  identities: ReadonlySet<string>,
  events: readonly MarketplaceAuditEventV1[],
  creationAction: MarketplaceAuditAction,
  statusAction: MarketplaceAuditAction,
  subjectPrefix: string,
  label: string
): MarketplaceAuthorityAuditEvidence {
  const creation = new Map<string, MarketplaceAuditEventV1[]>()
  const status = new Map<string, MarketplaceAuditEventV1[]>()
  for (const event of events) {
    let target: Map<string, MarketplaceAuditEventV1[]> | undefined
    if (event.action === creationAction) target = creation
    else if (event.action === statusAction) target = status
    if (!target) continue
    if (!event.subject.startsWith(subjectPrefix)) {
      throw new TypeError(`marketplace ${label} audit subject is invalid`)
    }
    const identity = event.subject.slice(subjectPrefix.length)
    if (!identities.has(identity)) {
      throw new TypeError(`marketplace ${label} audit references an unknown ${label}`)
    }
    const current = target.get(identity) ?? []
    current.push(event)
    target.set(identity, current)
  }
  return Object.freeze({ creation, status })
}

function assertAuthorityAuditTimeline(
  creation: MarketplaceAuditEventV1,
  statusEvents: readonly MarketplaceAuditEventV1[],
  updatedAt: string,
  label: string
): MarketplaceAuditEventV1 {
  if (statusEvents.some(({ sequence }) => sequence <= creation.sequence)) {
    throw new TypeError(`marketplace ${label} audit timeline is invalid`)
  }
  const latest = statusEvents.at(-1) ?? creation
  if (latest.time !== updatedAt) {
    throw new TypeError(`marketplace ${label} current status audit time is invalid`)
  }
  return latest
}

function publisherStatusAuditMatches(
  publisher: MarketplacePublisherV1,
  event: MarketplaceAuditEventV1
): boolean {
  return MARKETPLACE_PUBLISHER_STATUSES.some(
    (from) =>
      canTransitionMarketplacePublisher(from, publisher.status) &&
      event.payloadDigest ===
        marketplaceAuditPayloadDigest({
          from,
          publisherId: publisher.id,
          reason: publisher.statusReason,
          to: publisher.status
        })
  )
}

function assertPublisherAuditEvidence(
  publishers: readonly MarketplacePublisherV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  const evidence = authorityAuditEventsBySubject(
    new Set(publishers.map(({ id }) => id)),
    events,
    'publisher.created',
    'publisher.status_changed',
    'publisher:',
    'publisher'
  )
  for (const publisher of publishers) {
    const creationEvents = evidence.creation.get(publisher.id) ?? []
    if (creationEvents.length !== 1) {
      throw new TypeError(`marketplace publisher ${publisher.id} requires one creation audit event`)
    }
    const creation = creationEvents[0]
    if (
      creation.time !== publisher.createdAt ||
      creation.payloadDigest !==
        marketplaceAuditPayloadDigest({
          displayName: publisher.displayName,
          publisherId: publisher.id,
          status: 'pending'
        })
    ) {
      throw new TypeError(`marketplace publisher ${publisher.id} creation audit is invalid`)
    }
    const latest = assertAuthorityAuditTimeline(
      creation,
      evidence.status.get(publisher.id) ?? [],
      publisher.updatedAt,
      `publisher ${publisher.id}`
    )
    const matches =
      latest.action === 'publisher.created'
        ? publisher.status === 'pending' && publisher.statusReason === null
        : latest.action === 'publisher.status_changed' &&
          publisherStatusAuditMatches(publisher, latest)
    if (!matches) {
      throw new TypeError(`marketplace publisher ${publisher.id} current status audit is invalid`)
    }
  }
}

function publisherKeyStatusReason(key: MarketplacePublisherKeyV1): string | null {
  return key.status === 'revoked' ? key.revocationReason : key.statusReason
}

function publisherKeyStatusAuditMatches(
  key: MarketplacePublisherKeyV1,
  event: MarketplaceAuditEventV1
): boolean {
  return MARKETPLACE_PUBLISHER_KEY_STATUSES.some(
    (from) =>
      canTransitionMarketplacePublisherKey(from, key.status) &&
      event.payloadDigest ===
        marketplaceAuditPayloadDigest({
          from,
          keyId: key.keyId,
          publisherId: key.publisherId,
          reason: publisherKeyStatusReason(key),
          to: key.status
        })
  )
}

function assertPublisherKeyAuditEvidence(
  publisherKeys: readonly MarketplacePublisherKeyV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  const evidence = authorityAuditEventsBySubject(
    new Set(publisherKeys.map(({ keyId }) => keyId)),
    events,
    'publisher_key.registered',
    'publisher_key.status_changed',
    'publisher-key:',
    'publisher key'
  )
  for (const key of publisherKeys) {
    const creationEvents = evidence.creation.get(key.keyId) ?? []
    if (creationEvents.length !== 1) {
      throw new TypeError(`marketplace publisher key ${key.keyId} requires one registration audit`)
    }
    const creation = creationEvents[0]
    if (
      creation.time !== key.createdAt ||
      creation.payloadDigest !==
        marketplaceAuditPayloadDigest({
          keyId: key.keyId,
          notAfter: key.notAfter,
          notBefore: key.notBefore,
          predecessorKeyId: key.predecessorKeyId,
          publicKeyDigest: marketplacePublisherPublicKeyDigest(key.publicKeyPem),
          publisherId: key.publisherId
        })
    ) {
      throw new TypeError(`marketplace publisher key ${key.keyId} registration audit is invalid`)
    }
    const latest = assertAuthorityAuditTimeline(
      creation,
      evidence.status.get(key.keyId) ?? [],
      key.updatedAt,
      `publisher key ${key.keyId}`
    )
    const matches =
      latest.action === 'publisher_key.registered'
        ? key.status === 'pending' && publisherKeyStatusReason(key) === null
        : latest.action === 'publisher_key.status_changed' &&
          publisherKeyStatusAuditMatches(key, latest)
    if (!matches) {
      throw new TypeError(`marketplace publisher key ${key.keyId} current status audit is invalid`)
    }
  }
}

function ownershipStatusAuditMatches(
  ownership: MarketplaceOwnershipV1,
  event: MarketplaceAuditEventV1
): boolean {
  return MARKETPLACE_OWNERSHIP_STATUSES.some(
    (from) =>
      canTransitionMarketplaceOwnership(from, ownership.status) &&
      event.payloadDigest ===
        marketplaceAuditPayloadDigest({
          from,
          pluginId: ownership.pluginId,
          publisherId: ownership.publisherId,
          reason: ownership.statusReason,
          to: ownership.status
        })
  )
}

function assertOwnershipAuditEvidence(
  ownerships: readonly MarketplaceOwnershipV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  const evidence = authorityAuditEventsBySubject(
    new Set(ownerships.map(({ pluginId }) => pluginId)),
    events,
    'ownership.requested',
    'ownership.status_changed',
    'ownership:',
    'ownership'
  )
  for (const ownership of ownerships) {
    const creationEvents = evidence.creation.get(ownership.pluginId) ?? []
    if (creationEvents.length !== 1) {
      throw new TypeError(`marketplace ownership ${ownership.pluginId} requires one request audit`)
    }
    const creation = creationEvents[0]
    if (
      creation.time !== ownership.requestedAt ||
      creation.payloadDigest !==
        marketplaceAuditPayloadDigest({
          pluginId: ownership.pluginId,
          publisherId: ownership.publisherId
        })
    ) {
      throw new TypeError(`marketplace ownership ${ownership.pluginId} request audit is invalid`)
    }
    const latest = assertAuthorityAuditTimeline(
      creation,
      evidence.status.get(ownership.pluginId) ?? [],
      ownership.updatedAt,
      `ownership ${ownership.pluginId}`
    )
    const matches =
      latest.action === 'ownership.requested'
        ? ownership.status === 'requested' && ownership.statusReason === null
        : latest.action === 'ownership.status_changed' &&
          ownershipStatusAuditMatches(ownership, latest)
    if (!matches) {
      throw new TypeError(
        `marketplace ownership ${ownership.pluginId} current status audit is invalid`
      )
    }
  }
}

function assertAuthorityAuditEvidence(
  publishers: readonly MarketplacePublisherV1[],
  publisherKeys: readonly MarketplacePublisherKeyV1[],
  ownerships: readonly MarketplaceOwnershipV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  assertPublisherAuditEvidence(publishers, events)
  assertPublisherKeyAuditEvidence(publisherKeys, events)
  assertOwnershipAuditEvidence(ownerships, events)
}

function submissionAuditEventsById(
  submissions: readonly MarketplaceSubmissionV1[],
  releases: readonly MarketplaceReleaseV1[],
  events: readonly MarketplaceAuditEventV1[]
): Readonly<{
  creation: ReadonlyMap<string, readonly MarketplaceAuditEventV1[]>
  pin: ReadonlyMap<string, readonly MarketplaceAuditEventV1[]>
  revision: ReadonlyMap<string, readonly MarketplaceAuditEventV1[]>
  latestLifecycle: ReadonlyMap<string, MarketplaceAuditEventV1>
}> {
  const submissionsById = new Set(submissions.map(({ id }) => id))
  const submissionByReleaseSubject = new Map(
    releases.map((release) => [
      `release:${marketplaceReleaseCoordinateKey(release.coordinate)}`,
      release.submissionId
    ])
  )
  const creation = new Map<string, MarketplaceAuditEventV1[]>()
  const pin = new Map<string, MarketplaceAuditEventV1[]>()
  const revision = new Map<string, MarketplaceAuditEventV1[]>()
  const latestLifecycle = new Map<string, MarketplaceAuditEventV1>()
  for (const event of events) {
    let target: Map<string, MarketplaceAuditEventV1[]> | undefined
    if (event.action === 'submission.created') target = creation
    if (event.action === 'submission.signing_key_pinned') target = pin
    if (event.action === 'submission.revised') target = revision
    const submissionLifecycle = target !== undefined || event.action === 'submission.status_changed'
    if (submissionLifecycle) {
      const prefix = 'submission:'
      if (!event.subject.startsWith(prefix)) {
        throw new TypeError('marketplace submission audit subject is invalid')
      }
      const submissionId = event.subject.slice(prefix.length)
      if (!submissionsById.has(submissionId)) {
        throw new TypeError('marketplace submission audit references an unknown submission')
      }
      if (target) {
        const current = target.get(submissionId) ?? []
        current.push(event)
        target.set(submissionId, current)
      }
      latestLifecycle.set(submissionId, event)
      continue
    }
    if (event.action === 'release.published' || event.action === 'release.yanked') {
      const submissionId = submissionByReleaseSubject.get(event.subject)
      if (submissionId !== undefined) latestLifecycle.set(submissionId, event)
    }
  }
  return Object.freeze({ creation, pin, revision, latestLifecycle })
}

function releaseAuditEventsByCoordinate(
  releases: readonly MarketplaceReleaseV1[],
  events: readonly MarketplaceAuditEventV1[]
): ReadonlyMap<
  string,
  Readonly<{
    published: readonly MarketplaceAuditEventV1[]
    yanked: readonly MarketplaceAuditEventV1[]
  }>
> {
  const indexed = new Map<
    string,
    { published: MarketplaceAuditEventV1[]; yanked: MarketplaceAuditEventV1[] }
  >(
    releases.map((release) => [
      marketplaceReleaseCoordinateKey(release.coordinate),
      { published: [], yanked: [] }
    ])
  )
  for (const event of events) {
    if (event.action !== 'release.published' && event.action !== 'release.yanked') continue
    const prefix = 'release:'
    if (!event.subject.startsWith(prefix)) {
      throw new TypeError('marketplace release audit subject is invalid')
    }
    const coordinate = event.subject.slice(prefix.length)
    const target = indexed.get(coordinate)
    if (!target) throw new TypeError('marketplace release audit references an unknown release')
    if (event.action === 'release.published') target.published.push(event)
    else target.yanked.push(event)
  }
  return indexed
}

function assertReleaseAuditEvidence(
  releases: readonly MarketplaceReleaseV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  const indexed = releaseAuditEventsByCoordinate(releases, events)
  for (const release of releases) {
    const coordinate = marketplaceReleaseCoordinateKey(release.coordinate)
    const evidence = indexed.get(coordinate)
    const published = evidence?.published ?? []
    if (published.length !== 1) {
      throw new TypeError(
        `marketplace release ${coordinate} must match one publication audit event`
      )
    }
    const publicationEvent = published[0]
    const publicationPayload = {
      artifactDigest: release.artifactDigest,
      coordinate,
      manifestDigest: release.manifestDigest,
      submissionId: release.submissionId
    }
    if (
      publicationEvent.time !== release.publishedAt ||
      publicationEvent.payloadDigest !== marketplaceAuditPayloadDigest(publicationPayload)
    ) {
      throw new TypeError(`marketplace release ${coordinate} publication audit is invalid`)
    }
    const yanked = evidence?.yanked ?? []
    const expectedYankEvents = release.yankedAt === null ? 0 : 1
    if (yanked.length !== expectedYankEvents) {
      throw new TypeError(`marketplace release ${coordinate} yank audit count is invalid`)
    }
    const yankEvent = yanked.at(0)
    if (
      yankEvent &&
      (release.yankedAt === null ||
        release.yankReason === null ||
        yankEvent.time !== release.yankedAt ||
        yankEvent.payloadDigest !==
          marketplaceAuditPayloadDigest({
            coordinate,
            reason: release.yankReason,
            submissionId: release.submissionId
          }))
    ) {
      throw new TypeError(`marketplace release ${coordinate} yank audit is invalid`)
    }
  }
}

function statusChangeAuditMatches(
  submission: MarketplaceSubmissionV1,
  event: MarketplaceAuditEventV1
): boolean {
  return MARKETPLACE_SUBMISSION_STATUSES.some(
    (from) =>
      canTransitionMarketplaceSubmission(from, submission.status) &&
      event.payloadDigest ===
        marketplaceAuditPayloadDigest({
          from,
          reason: submission.statusReason,
          submissionId: submission.id,
          to: submission.status
        })
  )
}

function assertSubmissionCurrentStatusAudit(
  submission: MarketplaceSubmissionV1,
  release: MarketplaceReleaseV1 | undefined,
  event: MarketplaceAuditEventV1 | undefined
): void {
  if (!event || event.time !== submission.updatedAt) {
    throw new TypeError(
      `marketplace submission ${submission.id} current status audit time is invalid`
    )
  }
  let matches = false
  if (event.action === 'submission.created') {
    matches = submission.status === 'submitted' && submission.statusReason === null
  } else if (event.action === 'submission.status_changed') {
    matches = statusChangeAuditMatches(submission, event)
  } else if (event.action === 'submission.revised') {
    matches = submission.status === 'submitted' && submission.statusReason === null
  } else if (event.action === 'submission.signing_key_pinned') {
    matches = submission.status === 'approved' && submission.statusReason === null
  } else if (event.action === 'release.published') {
    matches =
      release !== undefined &&
      submission.status === 'published' &&
      submission.statusReason === null &&
      event.time === release.publishedAt
  } else if (event.action === 'release.yanked') {
    matches =
      release !== undefined &&
      submission.status === 'yanked' &&
      submission.statusReason === release.yankReason &&
      event.time === release.yankedAt
  }
  if (!matches) {
    throw new TypeError(`marketplace submission ${submission.id} current status audit is invalid`)
  }
}

function permitsLegacyCreationEvidence(
  submission: MarketplaceSubmissionV1,
  pinEventCount: number
): boolean {
  if (
    submission.revision !== 1 ||
    submission.revisionHistory.length !== 0 ||
    submission.authenticatedRequestKeyId !== null
  ) {
    return false
  }
  const hasStrongPin = pinEventCount === 1
  if ((submission.status === 'published' || submission.status === 'yanked') && !hasStrongPin) {
    return false
  }
  return (
    (submission.signingKeyId === null && pinEventCount === 0) ||
    (submission.signingKeyId !== null && hasStrongPin)
  )
}

function assertSubmissionCreationAudit(
  submission: MarketplaceSubmissionV1,
  events: readonly MarketplaceAuditEventV1[],
  pinEvents: readonly MarketplaceAuditEventV1[]
): void {
  if (events.length !== 1) {
    throw new TypeError(
      `marketplace submission ${submission.id} must match exactly one creation audit event`
    )
  }
  const event = events[0]
  const original = submission.revisionHistory.at(0) ?? submission
  const originalCreatedAt =
    'createdAt' in original ? original.createdAt : original.revisionCreatedAt
  if (event.time !== submission.submittedAt || originalCreatedAt !== submission.submittedAt) {
    throw new TypeError(`marketplace submission ${submission.id} creation audit time is invalid`)
  }
  const legacyPayload = {
    artifactDigest: original.artifactDigest,
    coordinate: marketplaceReleaseCoordinateKey(submission.coordinate),
    manifestDigest: original.manifestDigest,
    publisherId: submission.publisherId,
    runtimePackageDigest: original.runtimeCoordinate?.packageDigest ?? null,
    submissionId: submission.id
  }
  const currentPayload = {
    ...legacyPayload,
    authenticatedRequestKeyId: original.authenticatedRequestKeyId,
    listingDigest: original.listingDigest,
    revision: 1,
    revisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(original),
    signingKeyId: original.signingKeyId
  }
  if (event.payloadDigest === marketplaceAuditPayloadDigest(currentPayload)) return
  // Phase 0 omitted revision/key evidence from this exact creation payload. It
  // is accepted only while both identities remain absent, or when the sole
  // strong pin event below binds the complete revision before publication.
  if (
    !permitsLegacyCreationEvidence(submission, pinEvents.length) ||
    event.payloadDigest !== marketplaceAuditPayloadDigest(legacyPayload)
  ) {
    throw new TypeError(`marketplace submission ${submission.id} creation audit payload is invalid`)
  }
}

function assertSubmissionPinAudit(
  submission: MarketplaceSubmissionV1,
  events: readonly MarketplaceAuditEventV1[]
): void {
  if (events.length > 1) {
    throw new TypeError(
      `marketplace submission ${submission.id} has duplicate signing-key pin audit events`
    )
  }
  const event = events.at(0)
  if (!event) return
  if (
    submission.revision !== 1 ||
    submission.revisionHistory.length !== 0 ||
    submission.signingKeyId === null ||
    submission.authenticatedRequestKeyId !== null ||
    Date.parse(event.time) < Date.parse(submission.submittedAt) ||
    Date.parse(event.time) > Date.parse(submission.updatedAt)
  ) {
    throw new TypeError(
      `marketplace submission ${submission.id} signing-key pin audit identity is invalid`
    )
  }
  const beforePin = { ...submission, signingKeyId: null, authenticatedRequestKeyId: null }
  const payload = {
    artifactDigest: submission.artifactDigest,
    authenticatedRequestKeyId: submission.authenticatedRequestKeyId,
    coordinate: marketplaceReleaseCoordinateKey(submission.coordinate),
    manifestDigest: submission.manifestDigest,
    newRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(submission),
    oldRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(beforePin),
    publisherId: submission.publisherId,
    revision: submission.revision,
    signingKeyId: submission.signingKeyId,
    submissionId: submission.id
  }
  if (event.payloadDigest !== marketplaceAuditPayloadDigest(payload)) {
    throw new TypeError(
      `marketplace submission ${submission.id} signing-key pin audit payload is invalid`
    )
  }
}

function assertSubmissionRevisionAudit(
  submission: MarketplaceSubmissionV1,
  events: readonly MarketplaceAuditEventV1[]
): void {
  if (events.length !== submission.revisionHistory.length) {
    throw new TypeError(
      `marketplace submission ${submission.id} revision history must match its audit events`
    )
  }
  for (const [index, revision] of submission.revisionHistory.entries()) {
    const event = events.at(index)
    const nextRevision = submission.revisionHistory[index + 1] ?? submission
    const expectedPayloadDigest = marketplaceAuditPayloadDigest({
      coordinate: marketplaceReleaseCoordinateKey(submission.coordinate),
      fromReason: revision.supersededReason,
      fromRevision: revision.revision,
      fromStatus: revision.supersededFromStatus,
      newArtifactDigest: nextRevision.artifactDigest,
      newAuthenticatedRequestKeyId: nextRevision.authenticatedRequestKeyId,
      newListingDigest: nextRevision.listingDigest,
      newManifestDigest: nextRevision.manifestDigest,
      newRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(nextRevision),
      newRuntimePackageDigest: nextRevision.runtimeCoordinate?.packageDigest ?? null,
      oldArtifactDigest: revision.artifactDigest,
      oldAuthenticatedRequestKeyId: revision.authenticatedRequestKeyId,
      oldListingDigest: revision.listingDigest,
      oldManifestDigest: revision.manifestDigest,
      oldRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(revision),
      oldRuntimePackageDigest: revision.runtimeCoordinate?.packageDigest ?? null,
      oldSigningKeyId: revision.signingKeyId,
      publisherId: submission.publisherId,
      signingKeyId: nextRevision.signingKeyId,
      submissionId: submission.id,
      toRevision: nextRevision.revision,
      toStatus: 'submitted'
    })
    if (!event || event.time !== revision.supersededAt || event.actor !== revision.supersededBy) {
      throw new TypeError(
        `marketplace submission ${submission.id} revision history audit identity is invalid`
      )
    }
    if (event.payloadDigest !== expectedPayloadDigest) {
      throw new TypeError(
        `marketplace submission ${submission.id} revision history audit payload is invalid`
      )
    }
  }
}

function assertSubmissionAuditEvidence(
  submissions: readonly MarketplaceSubmissionV1[],
  releases: readonly MarketplaceReleaseV1[],
  events: readonly MarketplaceAuditEventV1[]
): void {
  const evidence = submissionAuditEventsById(submissions, releases, events)
  const releasesBySubmissionId = new Map(releases.map((release) => [release.submissionId, release]))
  for (const submission of submissions) {
    const pinEvents = evidence.pin.get(submission.id) ?? []
    assertSubmissionCreationAudit(submission, evidence.creation.get(submission.id) ?? [], pinEvents)
    assertSubmissionPinAudit(submission, pinEvents)
    assertSubmissionRevisionAudit(submission, evidence.revision.get(submission.id) ?? [])
    assertSubmissionCurrentStatusAudit(
      submission,
      releasesBySubmissionId.get(submission.id),
      evidence.latestLifecycle.get(submission.id)
    )
  }
}

function assertPublicationLinks(
  publications: readonly MarketplacePublicationV1[],
  auditEvents: readonly MarketplaceAuditEventV1[]
): void {
  let previousSequence = 0
  let previousTime = Number.NEGATIVE_INFINITY
  let previousAuditSequence = 0
  for (const publication of publications) {
    if (previousSequence !== 0 && publication.sequence !== previousSequence + 1) {
      throw new TypeError(`marketplace.publications sequences must be contiguous`)
    }
    const publishedAt = Date.parse(publication.publishedAt)
    if (publishedAt < previousTime || publication.auditSequence < previousAuditSequence) {
      throw new TypeError(`marketplace.publications checkpoints must not move backwards`)
    }
    if (publication.auditSequence > auditEvents.length) {
      throw new TypeError(`marketplace.publications references an unknown audit sequence`)
    }
    const expectedHead =
      publication.auditSequence === 0
        ? null
        : (auditEvents[publication.auditSequence - 1]?.eventHash ?? null)
    if (publication.auditHead !== expectedHead) {
      throw new TypeError(`marketplace.publications audit checkpoint is invalid`)
    }
    previousSequence = publication.sequence
    previousTime = publishedAt
    previousAuditSequence = publication.auditSequence
  }
}

function parseStateArray<Value>(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, entryPath: string) => Value
): readonly Value[] {
  return Object.freeze(
    parseBoundedManifestArray(value, path, maximum).map((entry, index) =>
      parse(entry, `${path}[${index}]`)
    )
  )
}

function assertStateSize(state: MarketplaceStateV1): void {
  const json = JSON.stringify(canonicalManifestValue(state))
  if (byteLength(json) > MARKETPLACE_LIMITS.maxStateJsonBytes) {
    throw new TypeError(
      `marketplace state may not exceed ${MARKETPLACE_LIMITS.maxStateJsonBytes} bytes`
    )
  }
}

function assertAuditContexts(
  auditEvents: readonly MarketplaceAuditEventV1[],
  auditContexts: readonly MarketplaceAuditContextV1[]
): void {
  uniqueBy(auditContexts, ({ sequence }) => String(sequence), 'marketplace.auditContexts')
  const contexts = new Map(auditContexts.map((context) => [context.sequence, context]))
  for (const event of auditEvents) {
    const context = contexts.get(event.sequence)
    if (event.contextDigest === undefined) {
      if (context) {
        throw new TypeError(
          `marketplace.auditContexts contains an orphan context for audit event ${event.sequence}`
        )
      }
      continue
    }
    if (!context || context.contextDigest !== event.contextDigest) {
      throw new TypeError(
        `marketplace audit event ${event.sequence} does not have matching context metadata`
      )
    }
  }
  for (const context of auditContexts) {
    if (!auditEvents[context.sequence - 1]) {
      throw new TypeError(
        `marketplace.auditContexts contains an unknown audit sequence ${context.sequence}`
      )
    }
  }
}

export function parseMarketplaceState(value: unknown): MarketplaceStateV1 {
  const source = parseExactManifestRecord(value, 'marketplace', STATE_KEYS, STATE_REQUIRED_KEYS)
  if (source.format !== MARKETPLACE_STATE_FORMAT) {
    throw new TypeError(`marketplace.format must be ${MARKETPLACE_STATE_FORMAT}`)
  }
  schemaVersion(source.schemaVersion, 'marketplace.schemaVersion')
  const publishers = parseStateArray(
    source.publishers,
    'marketplace.publishers',
    MARKETPLACE_LIMITS.maxPublishers,
    parseMarketplacePublisher
  )
  const publisherKeys = parseStateArray(
    source.publisherKeys,
    'marketplace.publisherKeys',
    MARKETPLACE_LIMITS.maxPublisherKeys,
    parseMarketplacePublisherKey
  )
  const ownerships = parseStateArray(
    source.ownerships,
    'marketplace.ownerships',
    MARKETPLACE_LIMITS.maxOwnerships,
    parseMarketplaceOwnership
  )
  const submissions = parseStateArray(
    source.submissions,
    'marketplace.submissions',
    MARKETPLACE_LIMITS.maxSubmissions,
    parseMarketplaceSubmission
  )
  const releases = parseStateArray(
    source.releases,
    'marketplace.releases',
    MARKETPLACE_LIMITS.maxReleases,
    parseMarketplaceRelease
  )
  const publications = parseStateArray(
    source.publications,
    'marketplace.publications',
    MARKETPLACE_LIMITS.maxPublications,
    parseMarketplacePublication
  )
  const auditEvents = parseStateArray(
    source.auditEvents,
    'marketplace.auditEvents',
    MARKETPLACE_LIMITS.maxAuditEvents,
    parseMarketplaceAuditEvent
  )
  const auditContexts =
    source.auditContexts === undefined
      ? Object.freeze([] as MarketplaceAuditContextV1[])
      : parseStateArray(
          source.auditContexts,
          'marketplace.auditContexts',
          MARKETPLACE_LIMITS.maxAuditEvents,
          parseMarketplaceAuditContext
        )
  uniqueBy(publishers, ({ id }) => id, 'marketplace.publishers')
  uniqueBy(publisherKeys, ({ keyId }) => keyId, 'marketplace.publisherKeys')
  uniqueBy(ownerships, ({ pluginId }) => pluginId, 'marketplace.ownerships')
  uniqueBy(submissions, ({ id }) => id, 'marketplace.submissions')
  uniqueBy(
    submissions,
    ({ coordinate }) => marketplaceReleaseCoordinateKey(coordinate),
    'marketplace submission coordinates'
  )
  uniqueBy(
    releases,
    ({ coordinate }) => marketplaceReleaseCoordinateKey(coordinate),
    'marketplace.releases'
  )
  uniqueBy(releases, ({ submissionId }) => submissionId, 'marketplace release submissions')
  assertEntityReferences(publishers, publisherKeys, ownerships, submissions, releases)
  assertAuditLinks(auditEvents)
  assertAuditContexts(auditEvents, auditContexts)
  assertAuthorityAuditEvidence(publishers, publisherKeys, ownerships, auditEvents)
  assertReleaseAuditEvidence(releases, auditEvents)
  assertSubmissionAuditEvidence(submissions, releases, auditEvents)
  assertPublicationLinks(publications, auditEvents)
  const state = Object.freeze({
    format: MARKETPLACE_STATE_FORMAT,
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    publishers,
    publisherKeys,
    ownerships,
    submissions,
    releases,
    publications,
    auditEvents,
    auditContexts
  })
  assertStateSize(state)
  return state
}

export function createEmptyMarketplaceState(): MarketplaceStateV1 {
  return parseMarketplaceState({
    format: MARKETPLACE_STATE_FORMAT,
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    publishers: [],
    publisherKeys: [],
    ownerships: [],
    submissions: [],
    releases: [],
    publications: [],
    auditEvents: [],
    auditContexts: []
  })
}

export function parseRecordMarketplacePublicationInput(
  value: unknown
): RecordMarketplacePublicationInput {
  const source = parseExactManifestRecord(
    value,
    'recordMarketplacePublicationInput',
    RECORD_PUBLICATION_KEYS,
    RECORD_PUBLICATION_REQUIRED_KEYS
  )
  const runtimeIndexDigest =
    source.runtimeIndexDigest === undefined
      ? null
      : nullableDigest(
          source.runtimeIndexDigest,
          'recordMarketplacePublicationInput.runtimeIndexDigest'
        )
  const runtimeIndexArtifactDigest =
    source.runtimeIndexArtifactDigest === undefined
      ? null
      : nullableDigest(
          source.runtimeIndexArtifactDigest,
          'recordMarketplacePublicationInput.runtimeIndexArtifactDigest'
        )
  if ((runtimeIndexDigest === null) !== (runtimeIndexArtifactDigest === null)) {
    throw new TypeError(
      `recordMarketplacePublicationInput runtime index digests must be present together`
    )
  }
  return Object.freeze({
    snapshotDigest: parseSha256Base64URL(
      source.snapshotDigest,
      'recordMarketplacePublicationInput.snapshotDigest'
    ),
    snapshotArtifactDigest: parseSha256Base64URL(
      source.snapshotArtifactDigest,
      'recordMarketplacePublicationInput.snapshotArtifactDigest'
    ),
    catalogs: parsePublicationCatalogs(
      source.catalogs,
      'recordMarketplacePublicationInput.catalogs'
    ),
    runtimeIndexDigest,
    runtimeIndexArtifactDigest
  })
}

export function parseCreateMarketplacePublisherInput(
  value: unknown
): CreateMarketplacePublisherInput {
  const source = parseExactManifestRecord(
    value,
    'createMarketplacePublisherInput',
    CREATE_PUBLISHER_KEYS
  )
  return Object.freeze({
    id: parseMarketplaceIdentity(source.id, 'createMarketplacePublisherInput.id'),
    displayName: boundedText(
      source.displayName,
      'createMarketplacePublisherInput.displayName',
      MARKETPLACE_LIMITS.maxDisplayNameBytes
    )
  })
}

export function parseRegisterMarketplacePublisherKeyInput(
  value: unknown
): RegisterMarketplacePublisherKeyInput {
  const source = parseExactManifestRecord(
    value,
    'registerMarketplacePublisherKeyInput',
    REGISTER_PUBLISHER_KEY_KEYS,
    REGISTER_PUBLISHER_KEY_REQUIRED_KEYS
  )
  const notBefore = parseMarketplaceTimestamp(
    source.notBefore,
    'registerMarketplacePublisherKeyInput.notBefore'
  )
  const notAfter = parseMarketplaceTimestamp(
    source.notAfter,
    'registerMarketplacePublisherKeyInput.notAfter'
  )
  if (Date.parse(notAfter) <= Date.parse(notBefore)) {
    throw new TypeError(
      `registerMarketplacePublisherKeyInput.notAfter must be later than notBefore`
    )
  }
  return Object.freeze({
    keyId: parseMarketplaceIdentity(source.keyId, 'registerMarketplacePublisherKeyInput.keyId'),
    publisherId: parseMarketplaceIdentity(
      source.publisherId,
      'registerMarketplacePublisherKeyInput.publisherId'
    ),
    publicKeyPem: publicKeyPem(
      source.publicKeyPem,
      'registerMarketplacePublisherKeyInput.publicKeyPem'
    ),
    notBefore,
    notAfter,
    predecessorKeyId:
      source.predecessorKeyId === undefined || source.predecessorKeyId === null
        ? null
        : parseMarketplaceIdentity(
            source.predecessorKeyId,
            'registerMarketplacePublisherKeyInput.predecessorKeyId'
          )
  })
}

export function parseRequestMarketplaceOwnershipInput(
  value: unknown
): RequestMarketplaceOwnershipInput {
  const source = parseExactManifestRecord(
    value,
    'requestMarketplaceOwnershipInput',
    REQUEST_OWNERSHIP_KEYS
  )
  return Object.freeze({
    pluginId: parseMarketplaceIdentity(
      source.pluginId,
      'requestMarketplaceOwnershipInput.pluginId'
    ),
    publisherId: parseMarketplaceIdentity(
      source.publisherId,
      'requestMarketplaceOwnershipInput.publisherId'
    )
  })
}

export function parseCreateMarketplaceSubmissionInput(
  value: unknown
): CreateMarketplaceSubmissionInput {
  const source = parseExactManifestRecord(
    value,
    'createMarketplaceSubmissionInput',
    CREATE_SUBMISSION_KEYS,
    CREATE_SUBMISSION_REQUIRED_KEYS
  )
  const listing = parseMarketplaceListingMetadata(
    source.listing,
    'createMarketplaceSubmissionInput.listing'
  )
  const listingDigest = parseSha256Base64URL(
    source.listingDigest,
    'createMarketplaceSubmissionInput.listingDigest'
  )
  if (listingDigest !== marketplaceListingDigest(listing)) {
    throw new TypeError('createMarketplaceSubmissionInput.listingDigest does not match listing')
  }
  return Object.freeze({
    id: parseMarketplaceIdentity(source.id, 'createMarketplaceSubmissionInput.id'),
    publisherId: parseMarketplaceIdentity(
      source.publisherId,
      'createMarketplaceSubmissionInput.publisherId'
    ),
    coordinate: parseMarketplaceReleaseCoordinate(
      source.coordinate,
      'createMarketplaceSubmissionInput.coordinate'
    ),
    manifestDigest: parseSha256Base64URL(
      source.manifestDigest,
      'createMarketplaceSubmissionInput.manifestDigest'
    ),
    artifactDigest: parseSha256Base64URL(
      source.artifactDigest,
      'createMarketplaceSubmissionInput.artifactDigest'
    ),
    manifestUrl: parseMarketplacePublicURL(
      source.manifestUrl,
      'createMarketplaceSubmissionInput.manifestUrl'
    ),
    listing,
    listingDigest,
    runtimeCoordinate:
      source.runtimeCoordinate === undefined || source.runtimeCoordinate === null
        ? null
        : parseMarketplaceRuntimeCoordinate(
            source.runtimeCoordinate,
            'createMarketplaceSubmissionInput.runtimeCoordinate'
          ),
    signingKeyId: parseMarketplaceIdentity(
      source.signingKeyId,
      'createMarketplaceSubmissionInput.signingKeyId'
    ),
    authenticatedRequestKeyId: parseMarketplaceIdentity(
      source.authenticatedRequestKeyId,
      'createMarketplaceSubmissionInput.authenticatedRequestKeyId'
    )
  })
}

export function resolveMarketplaceMutationContext(value: unknown): Required<
  Pick<MarketplaceMutationContext, 'actor' | 'time'>
> & {
  reason: string | null
  correlationId: string | null
} {
  const source = parseExactManifestRecord(
    value,
    'marketplaceMutationContext',
    MUTATION_CONTEXT_KEYS,
    MUTATION_CONTEXT_REQUIRED_KEYS
  )
  return Object.freeze({
    actor: parseMarketplaceAuditActor(source.actor, 'marketplaceMutationContext.actor'),
    time:
      source.time === undefined
        ? new Date().toISOString()
        : parseMarketplaceTimestamp(source.time, 'marketplaceMutationContext.time'),
    reason:
      source.reason === undefined
        ? null
        : parseMarketplaceReason(source.reason, 'marketplaceMutationContext.reason'),
    correlationId:
      source.correlationId === undefined
        ? null
        : parseMarketplaceCorrelationId(
            source.correlationId,
            'marketplaceMutationContext.correlationId'
          )
  })
}

export function canTransitionMarketplacePublisher(
  from: MarketplacePublisherStatus,
  to: MarketplacePublisherStatus
): boolean {
  const transitions: Readonly<
    Record<MarketplacePublisherStatus, readonly MarketplacePublisherStatus[]>
  > = {
    pending: ['active', 'rejected'],
    active: ['suspended'],
    rejected: [],
    suspended: ['active']
  }
  return transitions[from].includes(to)
}

export function canTransitionMarketplacePublisherKey(
  from: MarketplacePublisherKeyStatus,
  to: MarketplacePublisherKeyStatus
): boolean {
  const transitions: Readonly<
    Record<MarketplacePublisherKeyStatus, readonly MarketplacePublisherKeyStatus[]>
  > = {
    pending: ['active', 'rejected'],
    active: ['revoked'],
    rejected: [],
    revoked: []
  }
  return transitions[from].includes(to)
}

export function canTransitionMarketplaceOwnership(
  from: MarketplaceOwnershipStatus,
  to: MarketplaceOwnershipStatus
): boolean {
  const transitions: Readonly<
    Record<MarketplaceOwnershipStatus, readonly MarketplaceOwnershipStatus[]>
  > = {
    requested: ['active', 'rejected'],
    active: ['revoked'],
    rejected: [],
    revoked: []
  }
  return transitions[from].includes(to)
}

export function canTransitionMarketplaceSubmission(
  from: MarketplaceSubmissionStatus,
  to: MarketplaceSubmissionStatus
): boolean {
  const transitions: Readonly<
    Record<MarketplaceSubmissionStatus, readonly MarketplaceSubmissionStatus[]>
  > = {
    submitted: ['validation_failed', 'awaiting_review', 'withdrawn'],
    validation_failed: ['submitted', 'withdrawn'],
    awaiting_review: ['changes_requested', 'rejected', 'approved', 'withdrawn'],
    changes_requested: ['submitted', 'withdrawn'],
    rejected: [],
    approved: ['published', 'withdrawn'],
    withdrawn: [],
    published: ['yanked'],
    yanked: []
  }
  return transitions[from].includes(to)
}
