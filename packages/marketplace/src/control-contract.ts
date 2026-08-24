/* eslint-disable max-lines -- Private control-plane DTOs, strict parsers, and cursor cryptography form one wire boundary. */
import { Buffer } from 'node:buffer'

import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL,
  webCryptoBuffer
} from '@open-pencil/scene-graph'

import { MARKETPLACE_ARTIFACT_LIMITS } from './artifacts'
import {
  MARKETPLACE_LIMITS,
  MARKETPLACE_AUDIT_ACTIONS,
  MARKETPLACE_PUBLISHER_KEY_STATUSES,
  MARKETPLACE_RUNTIME_KINDS,
  MARKETPLACE_SUBMISSION_STATUSES,
  marketplaceAuditContextDigest,
  marketplaceListingDigest,
  marketplacePublisherPublicKeyDigest,
  parseMarketplaceAuditActor,
  parseMarketplaceCorrelationId,
  parseMarketplaceAuditEvent,
  parseMarketplaceIdentity,
  parseMarketplaceListingMetadata,
  parseMarketplacePublication,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceTimestamp,
  type MarketplaceAuditEventV1,
  type MarketplaceAuditContextV1,
  type MarketplaceAuditAction,
  type MarketplaceListingMetadataV1,
  type MarketplaceOwnershipV1,
  type MarketplacePublicationV1,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherKeyV1,
  type MarketplacePublisherV1,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceReleaseV1,
  type MarketplaceRuntimeCoordinateV1,
  type MarketplaceRuntimeKind,
  type MarketplaceSubmissionStatus,
  type MarketplaceSubmissionV1
} from './types'

export const MARKETPLACE_CONTROL_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_OPERATOR_RECENT_LIMIT = 10 as const
export const MARKETPLACE_OPERATOR_KEY_EXPIRY_WINDOW_MS = 30 * 24 * 60 * 60_000

export const MARKETPLACE_CONTROL_RESOURCES = [
  'publishers',
  'publisher-keys',
  'ownerships',
  'submissions',
  'releases',
  'publications',
  'audit'
] as const

export type MarketplaceControlResource = (typeof MARKETPLACE_CONTROL_RESOURCES)[number]

export const MARKETPLACE_CONTROL_LIMITS = Object.freeze({
  defaultPageLimit: 50,
  maxPageLimit: 100,
  maxQueryBytes: 8 * 1024,
  maxQueryEntries: 32,
  maxQueryKeyBytes: 64,
  maxQueryValueBytes: 512,
  minCursorKeyBytes: 32,
  maxCursorKeyBytes: 1_024,
  maxCursorCharacters: 8 * 1024,
  maxCursorPayloadBytes: 6 * 1024,
  maxCursorFilters: 16,
  maxCursorScopeBytes: 512,
  maxCursorStateTokenBytes: 256,
  maxCursorAfterBytes: 1_024,
  maxResponseJsonBytes: 4 * 1024 * 1024,
  maxWireDepth: 32,
  maxWireEntries: 200_000
})

export type MarketplaceControlPublisherV1 = MarketplacePublisherV1
export type MarketplaceControlOwnershipV1 = MarketplaceOwnershipV1
export type MarketplaceControlPublicationV1 = MarketplacePublicationV1
export type MarketplaceControlListingMetadataV1 = MarketplaceListingMetadataV1

export interface MarketplaceControlAuditEntityV1 {
  readonly type: string
  readonly id: string
}

export interface MarketplaceControlAuditEventV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly sequence: number
  readonly time: string
  readonly actor: string
  readonly action: MarketplaceAuditAction
  readonly entity: MarketplaceControlAuditEntityV1
  readonly reason: string | null
  readonly correlationId: string | null
  readonly contextDigest: string | null
  readonly payloadDigest: string
  readonly previousHash: string | null
  readonly eventHash: string
  readonly chainStatus: 'verified'
}

export interface MarketplaceControlPublisherKeyV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly keyId: string
  readonly publisherId: string
  readonly fingerprint: string
  readonly notBefore: string
  readonly notAfter: string
  readonly predecessorKeyId: string | null
  readonly status: MarketplacePublisherKeyStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly statusReason: string | null
  readonly revokedAt: string | null
  readonly revocationReason: string | null
}

export interface MarketplaceControlRuntimeCoordinateV1 {
  readonly packageDigest: string
  readonly byteLength: number
  readonly kind: MarketplaceRuntimeKind
}

export interface MarketplaceControlSubmissionSummaryV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly id: string
  readonly publisherId: string
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly manifestDigest: string
  readonly listing: MarketplaceControlListingMetadataV1
  readonly listingDigest: string
  readonly runtimeCoordinate: MarketplaceControlRuntimeCoordinateV1 | null
  readonly signingKeyId: string | null
  readonly revision: number
  readonly revisionCreatedAt: string
  readonly status: MarketplaceSubmissionStatus
  readonly submittedAt: string
  readonly updatedAt: string
  readonly statusReason: string | null
}

export interface MarketplaceControlSubmissionRevisionV1 {
  readonly revision: number
  readonly signingKeyId: string | null
  readonly authenticatedRequestKeyId: string | null
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly runtimeCoordinate: MarketplaceControlRuntimeCoordinateV1 | null
  readonly createdAt: string
  readonly supersededAt: string | null
  readonly supersededBy: string | null
  readonly status: MarketplaceSubmissionStatus
  readonly statusReason: string | null
}

export interface MarketplaceControlSubmissionDetailV1 extends MarketplaceControlSubmissionSummaryV1 {
  readonly artifactDigest: string
  readonly authenticatedRequestKeyId: string | null
  readonly revisions: readonly MarketplaceControlSubmissionRevisionV1[]
}

export type MarketplaceControlSubmissionV1 = MarketplaceControlSubmissionDetailV1

export interface MarketplaceControlReleaseV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly submissionId: string
  readonly submissionRevision: number
  readonly publisherId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly runtimeCoordinate: MarketplaceControlRuntimeCoordinateV1 | null
  readonly publishedAt: string
  readonly yankedAt: string | null
  readonly yankReason: string | null
}

export interface MarketplaceControlSummaryV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly publishers: number
  readonly publisherKeys: number
  readonly ownerships: number
  readonly submissions: number
  readonly releases: number
  readonly publications: number
  readonly auditEvents: number
}

export type MarketplaceOperatorAuditAccess = 'available' | 'restricted'

export interface MarketplaceOperatorOverviewV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly source: 'marketplace'
  readonly generatedAt: string
  readonly keyExpiryThresholdAt: string
  readonly pending: {
    readonly publishers: number
    readonly publisherKeys: number
    readonly ownerships: number
    readonly submissions: number
  }
  readonly risk: {
    readonly suspendedPublishers: number
    readonly revokedPublisherKeys: number
    readonly expiringPublisherKeys: number
    readonly yankedReleases: number
  }
  readonly recentPublications: readonly MarketplaceControlPublicationV1[]
  readonly auditAccess: MarketplaceOperatorAuditAccess
  readonly recentAudit: readonly MarketplaceControlAuditEventV1[]
  readonly auditChain: {
    readonly status: 'valid'
    readonly verifiedThroughSequence: number
    readonly head: string | null
    readonly verificationSource: 'marketplace'
  }
}

export interface MarketplaceOperatorPublicationsV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly onlineSigning: {
    readonly enabled: false
    readonly reason: string
  }
  readonly publications: MarketplaceControlPageV1<MarketplaceControlPublicationV1>
}

export interface MarketplaceControlSubmissionValidationV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly valid: true
  readonly publisherId: string
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly signingKeyId: string
  readonly authenticatedRequestKeyId: string
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly runtimePackageDigest: string | null
  readonly runtimeArtifactDigest: string | null
  readonly manifestByteLength: number
  readonly runtimeByteLength: number | null
}

export interface MarketplaceControlPageV1<Item> {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly items: readonly Item[]
  readonly nextCursor: string | null
}

export interface MarketplaceControlPublisherAuditPageV1 {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly publisherId: string
  readonly items: readonly MarketplaceAuditEventV1[]
  readonly nextCursor: string | null
}

export interface MarketplaceControlDetailV1<Item> {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly item: Item
}

export type MarketplaceControlItemParser<Item> = (value: unknown, path: string) => Item

const PUBLISHER_KEY_VIEW_KEYS = new Set([
  'schemaVersion',
  'keyId',
  'publisherId',
  'fingerprint',
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
const RUNTIME_VIEW_KEYS = new Set(['packageDigest', 'byteLength', 'kind'])
const SUBMISSION_SUMMARY_VIEW_KEYS = new Set([
  'schemaVersion',
  'id',
  'publisherId',
  'coordinate',
  'manifestDigest',
  'listing',
  'listingDigest',
  'runtimeCoordinate',
  'signingKeyId',
  'revision',
  'revisionCreatedAt',
  'status',
  'submittedAt',
  'updatedAt',
  'statusReason'
])
const SUBMISSION_DETAIL_VIEW_KEYS = new Set([
  ...SUBMISSION_SUMMARY_VIEW_KEYS,
  'artifactDigest',
  'authenticatedRequestKeyId',
  'revisions'
])
const SUBMISSION_REVISION_VIEW_KEYS = new Set([
  'revision',
  'signingKeyId',
  'authenticatedRequestKeyId',
  'manifestDigest',
  'artifactDigest',
  'listingDigest',
  'runtimeCoordinate',
  'createdAt',
  'supersededAt',
  'supersededBy',
  'status',
  'statusReason'
])
const RELEASE_VIEW_KEYS = new Set([
  'schemaVersion',
  'coordinate',
  'submissionId',
  'submissionRevision',
  'publisherId',
  'manifestDigest',
  'artifactDigest',
  'runtimeCoordinate',
  'publishedAt',
  'yankedAt',
  'yankReason'
])
const SUMMARY_KEYS = new Set([
  'schemaVersion',
  'publishers',
  'publisherKeys',
  'ownerships',
  'submissions',
  'releases',
  'publications',
  'auditEvents'
])
const SUBMISSION_VALIDATION_KEYS = new Set([
  'schemaVersion',
  'valid',
  'publisherId',
  'coordinate',
  'signingKeyId',
  'authenticatedRequestKeyId',
  'manifestDigest',
  'artifactDigest',
  'listingDigest',
  'runtimePackageDigest',
  'runtimeArtifactDigest',
  'manifestByteLength',
  'runtimeByteLength'
])
const PAGE_KEYS = new Set(['schemaVersion', 'items', 'nextCursor'])
const PUBLISHER_AUDIT_PAGE_KEYS = new Set(['schemaVersion', 'publisherId', 'items', 'nextCursor'])
const DETAIL_KEYS = new Set(['schemaVersion', 'item'])
const AUDIT_ENTITY_KEYS = new Set(['type', 'id'])
const AUDIT_VIEW_KEYS = new Set([
  'schemaVersion',
  'sequence',
  'time',
  'actor',
  'action',
  'entity',
  'reason',
  'correlationId',
  'contextDigest',
  'payloadDigest',
  'previousHash',
  'eventHash',
  'chainStatus'
])
const OPERATOR_OVERVIEW_KEYS = new Set([
  'schemaVersion',
  'source',
  'generatedAt',
  'keyExpiryThresholdAt',
  'pending',
  'risk',
  'recentPublications',
  'auditAccess',
  'recentAudit',
  'auditChain'
])
const OPERATOR_PENDING_KEYS = new Set(['publishers', 'publisherKeys', 'ownerships', 'submissions'])
const OPERATOR_RISK_KEYS = new Set([
  'suspendedPublishers',
  'revokedPublisherKeys',
  'expiringPublisherKeys',
  'yankedReleases'
])
const OPERATOR_AUDIT_CHAIN_KEYS = new Set([
  'status',
  'verifiedThroughSequence',
  'head',
  'verificationSource'
])
const OPERATOR_PUBLICATIONS_KEYS = new Set(['schemaVersion', 'onlineSigning', 'publications'])
const OPERATOR_ONLINE_SIGNING_KEYS = new Set(['enabled', 'reason'])
const CURSOR_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'resource',
  'scope',
  'sort',
  'filters',
  'stateToken',
  'after'
])
const NEGATIVE_SUBMISSION_STATUSES = new Set<MarketplaceSubmissionStatus>([
  'validation_failed',
  'changes_requested',
  'rejected',
  'withdrawn',
  'yanked'
])
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function byteLength(value: string): number {
  return encoder.encode(value).byteLength
}

function schemaVersion(value: unknown, path: string): typeof MARKETPLACE_CONTROL_SCHEMA_VERSION {
  if (value !== MARKETPLACE_CONTROL_SCHEMA_VERSION) {
    throw new TypeError(`${path} must be ${MARKETPLACE_CONTROL_SCHEMA_VERSION}`)
  }
  return MARKETPLACE_CONTROL_SCHEMA_VERSION
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
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

function nullableReason(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplaceReason(value, path)
}

function nullableIdentity(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplaceIdentity(value, path)
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

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value as number
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

function nullableTimestamp(value: unknown, path: string): string | null {
  return value === null ? null : parseMarketplaceTimestamp(value, path)
}

function safeRuntimeCoordinate(
  value: MarketplaceRuntimeCoordinateV1 | null
): MarketplaceControlRuntimeCoordinateV1 | null {
  if (value === null) return null
  return Object.freeze({
    packageDigest: value.packageDigest,
    byteLength: value.byteLength,
    kind: value.kind
  })
}

function auditEntityFromSubject(subject: string): MarketplaceControlAuditEntityV1 {
  const separator = subject.indexOf(':')
  if (separator <= 0 || separator === subject.length - 1) {
    throw new TypeError('marketplace control audit subject must contain an entity type and id')
  }
  return Object.freeze({
    type: boundedText(subject.slice(0, separator), 'marketplaceControl.audit.entity.type', 128),
    id: boundedText(
      subject.slice(separator + 1),
      'marketplaceControl.audit.entity.id',
      MARKETPLACE_LIMITS.maxAuditSubjectBytes
    )
  })
}

export function toMarketplaceControlAuditEvent(
  eventValue: MarketplaceAuditEventV1,
  contextValue: MarketplaceAuditContextV1 | null = null
): MarketplaceControlAuditEventV1 {
  const event = parseMarketplaceAuditEvent(eventValue)
  if (
    (event.contextDigest === undefined) !== (contextValue === null) ||
    (contextValue !== null &&
      (contextValue.sequence !== event.sequence ||
        contextValue.contextDigest !== event.contextDigest))
  ) {
    throw new TypeError('marketplace control audit context does not match its event')
  }
  return parseMarketplaceControlAuditEvent({
    schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
    sequence: event.sequence,
    time: event.time,
    actor: event.actor,
    action: event.action,
    entity: auditEntityFromSubject(event.subject),
    reason: contextValue?.reason ?? null,
    correlationId: contextValue?.correlationId ?? null,
    contextDigest: event.contextDigest ?? null,
    payloadDigest: event.payloadDigest,
    previousHash: event.previousHash,
    eventHash: event.eventHash,
    chainStatus: 'verified'
  })
}

export function toMarketplaceControlPublisherKey(
  value: MarketplacePublisherKeyV1
): MarketplaceControlPublisherKeyV1 {
  const parsed = value
  return parseMarketplaceControlPublisherKey({
    schemaVersion: parsed.schemaVersion,
    keyId: parsed.keyId,
    publisherId: parsed.publisherId,
    fingerprint: marketplacePublisherPublicKeyDigest(parsed.publicKeyPem),
    notBefore: parsed.notBefore,
    notAfter: parsed.notAfter,
    predecessorKeyId: parsed.predecessorKeyId,
    status: parsed.status,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    statusReason: parsed.statusReason,
    revokedAt: parsed.revokedAt,
    revocationReason: parsed.revocationReason
  })
}

export function toMarketplaceControlSubmissionSummary(
  value: MarketplaceSubmissionV1
): MarketplaceControlSubmissionSummaryV1 {
  return parseMarketplaceControlSubmissionSummary({
    schemaVersion: value.schemaVersion,
    id: value.id,
    publisherId: value.publisherId,
    coordinate: value.coordinate,
    manifestDigest: value.manifestDigest,
    listing: value.listing,
    listingDigest: value.listingDigest,
    runtimeCoordinate: safeRuntimeCoordinate(value.runtimeCoordinate),
    signingKeyId: value.signingKeyId,
    revision: value.revision,
    revisionCreatedAt: value.revisionCreatedAt,
    status: value.status,
    submittedAt: value.submittedAt,
    updatedAt: value.updatedAt,
    statusReason: value.statusReason
  })
}

export function toMarketplaceControlSubmission(
  value: MarketplaceSubmissionV1
): MarketplaceControlSubmissionDetailV1 {
  const revisions = [
    ...value.revisionHistory.map((revision) => ({
      revision: revision.revision,
      signingKeyId: revision.signingKeyId,
      authenticatedRequestKeyId: revision.authenticatedRequestKeyId,
      manifestDigest: revision.manifestDigest,
      artifactDigest: revision.artifactDigest,
      listingDigest: revision.listingDigest,
      runtimeCoordinate: safeRuntimeCoordinate(revision.runtimeCoordinate),
      createdAt: revision.createdAt,
      supersededAt: revision.supersededAt,
      supersededBy: revision.supersededBy,
      status: revision.supersededFromStatus,
      statusReason: revision.supersededReason
    })),
    {
      revision: value.revision,
      signingKeyId: value.signingKeyId,
      authenticatedRequestKeyId: value.authenticatedRequestKeyId,
      manifestDigest: value.manifestDigest,
      artifactDigest: value.artifactDigest,
      listingDigest: value.listingDigest,
      runtimeCoordinate: safeRuntimeCoordinate(value.runtimeCoordinate),
      createdAt: value.revisionCreatedAt,
      supersededAt: null,
      supersededBy: null,
      status: value.status,
      statusReason: value.statusReason
    }
  ]
  return parseMarketplaceControlSubmission({
    ...toMarketplaceControlSubmissionSummary(value),
    artifactDigest: value.artifactDigest,
    authenticatedRequestKeyId: value.authenticatedRequestKeyId,
    revisions
  })
}

export function toMarketplaceControlRelease(
  value: MarketplaceReleaseV1
): MarketplaceControlReleaseV1 {
  return parseMarketplaceControlRelease({
    schemaVersion: value.schemaVersion,
    coordinate: value.coordinate,
    submissionId: value.submissionId,
    submissionRevision: value.submissionRevision,
    publisherId: value.publisherId,
    manifestDigest: value.manifestDigest,
    artifactDigest: value.artifactDigest,
    runtimeCoordinate: safeRuntimeCoordinate(value.runtimeCoordinate),
    publishedAt: value.publishedAt,
    yankedAt: value.yankedAt,
    yankReason: value.yankReason
  })
}

export function parseMarketplaceControlPublisherKey(
  value: unknown,
  path = 'marketplaceControl.publisherKeys[0]'
): MarketplaceControlPublisherKeyV1 {
  const source = parseExactManifestRecord(value, path, PUBLISHER_KEY_VIEW_KEYS)
  const keyId = parseMarketplaceIdentity(source.keyId, `${path}.keyId`)
  const predecessorKeyId =
    source.predecessorKeyId === null
      ? null
      : parseMarketplaceIdentity(source.predecessorKeyId, `${path}.predecessorKeyId`)
  if (predecessorKeyId === keyId) {
    throw new TypeError(`${path}.predecessorKeyId must identify a different key`)
  }
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
  if ((status === 'rejected') !== (statusReason !== null)) {
    throw new TypeError(`${path}.statusReason must be present exactly for a rejected key`)
  }
  const revokedAt = nullableTimestamp(source.revokedAt, `${path}.revokedAt`)
  const revocationReason = nullableReason(source.revocationReason, `${path}.revocationReason`)
  if (status === 'revoked') {
    if (revokedAt === null || revocationReason === null || updatedAt !== revokedAt) {
      throw new TypeError(`${path} revoked keys require matching revocation details`)
    }
  } else if (revokedAt !== null || revocationReason !== null) {
    throw new TypeError(`${path} non-revoked keys must not contain revocation details`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    keyId,
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    fingerprint: parseSha256Base64URL(source.fingerprint, `${path}.fingerprint`),
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

export function parseMarketplaceControlRuntimeCoordinate(
  value: unknown,
  path = 'marketplaceControl.runtimeCoordinate'
): MarketplaceControlRuntimeCoordinateV1 {
  const source = parseExactManifestRecord(value, path, RUNTIME_VIEW_KEYS)
  return Object.freeze({
    packageDigest: parseSha256Base64URL(source.packageDigest, `${path}.packageDigest`),
    byteLength: positiveSafeInteger(
      source.byteLength,
      `${path}.byteLength`,
      MARKETPLACE_LIMITS.maxRuntimePackageBytes
    ),
    kind: enumValue(source.kind, MARKETPLACE_RUNTIME_KINDS, `${path}.kind`)
  })
}

export function parseMarketplaceControlSubmissionSummary(
  value: unknown,
  path = 'marketplaceControl.submissions[0]'
): MarketplaceControlSubmissionSummaryV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_SUMMARY_VIEW_KEYS)
  const submittedAt = parseMarketplaceTimestamp(source.submittedAt, `${path}.submittedAt`)
  const updatedAt = parseMarketplaceTimestamp(source.updatedAt, `${path}.updatedAt`)
  const revisionCreatedAt = parseMarketplaceTimestamp(
    source.revisionCreatedAt,
    `${path}.revisionCreatedAt`
  )
  assertChronological(submittedAt, revisionCreatedAt, `${path}.revisionCreatedAt`)
  assertChronological(revisionCreatedAt, updatedAt, `${path}.updatedAt`)
  const status = enumValue(source.status, MARKETPLACE_SUBMISSION_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  if (NEGATIVE_SUBMISSION_STATUSES.has(status) !== (statusReason !== null)) {
    throw new TypeError(`${path}.statusReason does not match status`)
  }
  const listing = parseMarketplaceListingMetadata(source.listing, `${path}.listing`)
  const listingDigest = parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`)
  if (marketplaceListingDigest(listing) !== listingDigest) {
    throw new TypeError(`${path}.listingDigest does not match listing`)
  }
  const revision = positiveSafeInteger(
    source.revision,
    `${path}.revision`,
    MARKETPLACE_LIMITS.maxSubmissionRevisions
  )
  const signingKeyId = nullableIdentity(source.signingKeyId, `${path}.signingKeyId`)
  if (revision > 1 && signingKeyId === null) {
    throw new TypeError(`${path} revised submissions require a signingKeyId`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    id: parseMarketplaceIdentity(source.id, `${path}.id`),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    coordinate: parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    listing,
    listingDigest,
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceControlRuntimeCoordinate(
            source.runtimeCoordinate,
            `${path}.runtimeCoordinate`
          ),
    signingKeyId,
    revision,
    revisionCreatedAt,
    status,
    submittedAt,
    updatedAt,
    statusReason
  })
}

export function parseMarketplaceControlSubmissionRevision(
  value: unknown,
  path = 'marketplaceControl.submission.revisions[0]'
): MarketplaceControlSubmissionRevisionV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_REVISION_VIEW_KEYS)
  const listingDigest = parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`)
  const createdAt = parseMarketplaceTimestamp(source.createdAt, `${path}.createdAt`)
  const supersededAt = nullableTimestamp(source.supersededAt, `${path}.supersededAt`)
  const supersededBy =
    source.supersededBy === null
      ? null
      : parseMarketplaceAuditActor(source.supersededBy, `${path}.supersededBy`)
  if ((supersededAt === null) !== (supersededBy === null)) {
    throw new TypeError(`${path}.supersededAt and supersededBy must be present together`)
  }
  if (supersededAt !== null) assertChronological(createdAt, supersededAt, `${path}.supersededAt`)
  const status = enumValue(source.status, MARKETPLACE_SUBMISSION_STATUSES, `${path}.status`)
  const statusReason = nullableReason(source.statusReason, `${path}.statusReason`)
  if (NEGATIVE_SUBMISSION_STATUSES.has(status) !== (statusReason !== null)) {
    throw new TypeError(`${path}.statusReason does not match status`)
  }
  if (supersededAt !== null && status !== 'validation_failed' && status !== 'changes_requested') {
    throw new TypeError(`${path} superseded revisions require a revisable status`)
  }
  const revision = positiveSafeInteger(
    source.revision,
    `${path}.revision`,
    MARKETPLACE_LIMITS.maxSubmissionRevisions
  )
  const signingKeyId = nullableIdentity(source.signingKeyId, `${path}.signingKeyId`)
  const authenticatedRequestKeyId = nullableIdentity(
    source.authenticatedRequestKeyId,
    `${path}.authenticatedRequestKeyId`
  )
  if (revision > 1 && (signingKeyId === null || authenticatedRequestKeyId === null)) {
    throw new TypeError(`${path} revised payloads require exact key identities`)
  }
  if (signingKeyId === null && authenticatedRequestKeyId !== null) {
    throw new TypeError(`${path} authenticated request key requires a signing key`)
  }
  return Object.freeze({
    revision,
    signingKeyId,
    authenticatedRequestKeyId,
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    listingDigest,
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceControlRuntimeCoordinate(
            source.runtimeCoordinate,
            `${path}.runtimeCoordinate`
          ),
    createdAt,
    supersededAt,
    supersededBy,
    status,
    statusReason
  })
}

function parseMarketplaceControlSubmissionRevisions(
  value: unknown,
  expectedRevision: number,
  path: string
): readonly MarketplaceControlSubmissionRevisionV1[] {
  const revisions = parseBoundedManifestArray(
    value,
    `${path}.revisions`,
    MARKETPLACE_LIMITS.maxSubmissionRevisions
  ).map((revision, index) =>
    parseMarketplaceControlSubmissionRevision(revision, `${path}.revisions[${index}]`)
  )
  if (revisions.length !== expectedRevision) {
    throw new TypeError(`${path}.revisions must contain every revision through revision`)
  }
  for (const [index, revision] of revisions.entries()) {
    if (revision.revision !== index + 1) {
      throw new TypeError(`${path}.revisions must be contiguous from revision 1`)
    }
    const isCurrent = index === revisions.length - 1
    if (isCurrent !== (revision.supersededAt === null)) {
      throw new TypeError(`${path}.revisions must end in exactly one current revision`)
    }
    if (index > 0) {
      const previous = revisions.at(index - 1)
      if (!previous || previous.supersededAt !== revision.createdAt) {
        throw new TypeError(`${path}.revisions must advance at the exact supersession time`)
      }
    }
  }
  return Object.freeze(revisions)
}

function assertMarketplaceControlCurrentRevision(
  current: MarketplaceControlSubmissionRevisionV1 | undefined,
  summary: MarketplaceControlSubmissionSummaryV1,
  artifactDigest: string,
  authenticatedRequestKeyId: string | null,
  path: string
): void {
  const runtimeMatches =
    JSON.stringify(current?.runtimeCoordinate) === JSON.stringify(summary.runtimeCoordinate)
  if (
    !current ||
    current.manifestDigest !== summary.manifestDigest ||
    current.artifactDigest !== artifactDigest ||
    current.listingDigest !== summary.listingDigest ||
    !runtimeMatches ||
    current.signingKeyId !== summary.signingKeyId ||
    current.authenticatedRequestKeyId !== authenticatedRequestKeyId ||
    current.createdAt !== summary.revisionCreatedAt ||
    current.status !== summary.status ||
    current.statusReason !== summary.statusReason
  ) {
    throw new TypeError(`${path}.revisions current identity does not match the submission`)
  }
  if (summary.signingKeyId === null && authenticatedRequestKeyId !== null) {
    throw new TypeError(`${path} authenticated request key requires a signing key`)
  }
}

export function parseMarketplaceControlSubmission(
  value: unknown,
  path = 'marketplaceControl.submission'
): MarketplaceControlSubmissionDetailV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_DETAIL_VIEW_KEYS)
  const summary = parseMarketplaceControlSubmissionSummary(
    Object.fromEntries([...SUBMISSION_SUMMARY_VIEW_KEYS].map((key) => [key, source[key]])),
    path
  )
  const revisions = parseMarketplaceControlSubmissionRevisions(
    source.revisions,
    summary.revision,
    path
  )
  const current = revisions.at(-1)
  const artifactDigest = parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`)
  const authenticatedRequestKeyId = nullableIdentity(
    source.authenticatedRequestKeyId,
    `${path}.authenticatedRequestKeyId`
  )
  assertMarketplaceControlCurrentRevision(
    current,
    summary,
    artifactDigest,
    authenticatedRequestKeyId,
    path
  )
  return Object.freeze({
    ...summary,
    artifactDigest,
    authenticatedRequestKeyId,
    revisions
  })
}

export function parseMarketplaceControlRelease(
  value: unknown,
  path = 'marketplaceControl.releases[0]'
): MarketplaceControlReleaseV1 {
  const source = parseExactManifestRecord(value, path, RELEASE_VIEW_KEYS)
  const publishedAt = parseMarketplaceTimestamp(source.publishedAt, `${path}.publishedAt`)
  const yankedAt = nullableTimestamp(source.yankedAt, `${path}.yankedAt`)
  const yankReason = nullableReason(source.yankReason, `${path}.yankReason`)
  if ((yankedAt === null) !== (yankReason === null)) {
    throw new TypeError(`${path}.yankedAt and yankReason must be present together`)
  }
  if (yankedAt !== null) assertChronological(publishedAt, yankedAt, `${path}.yankedAt`)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    coordinate: parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`),
    submissionId: parseMarketplaceIdentity(source.submissionId, `${path}.submissionId`),
    submissionRevision: positiveSafeInteger(
      source.submissionRevision,
      `${path}.submissionRevision`,
      MARKETPLACE_LIMITS.maxSubmissionRevisions
    ),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    runtimeCoordinate:
      source.runtimeCoordinate === null
        ? null
        : parseMarketplaceControlRuntimeCoordinate(
            source.runtimeCoordinate,
            `${path}.runtimeCoordinate`
          ),
    publishedAt,
    yankedAt,
    yankReason
  })
}

export function parseMarketplaceControlSubmissionValidation(
  value: unknown,
  path = 'marketplaceControl.submissionValidation'
): MarketplaceControlSubmissionValidationV1 {
  const source = parseExactManifestRecord(value, path, SUBMISSION_VALIDATION_KEYS)
  if (source.valid !== true) throw new TypeError(`${path}.valid must be true`)
  const runtimePackageDigest =
    source.runtimePackageDigest === null
      ? null
      : parseSha256Base64URL(source.runtimePackageDigest, `${path}.runtimePackageDigest`)
  const runtimeArtifactDigest =
    source.runtimeArtifactDigest === null
      ? null
      : parseSha256Base64URL(source.runtimeArtifactDigest, `${path}.runtimeArtifactDigest`)
  const runtimeByteLength =
    source.runtimeByteLength === null
      ? null
      : positiveSafeInteger(
          source.runtimeByteLength,
          `${path}.runtimeByteLength`,
          MARKETPLACE_ARTIFACT_LIMITS.maxBytes
        )
  if (
    (runtimePackageDigest === null) !== (runtimeArtifactDigest === null) ||
    (runtimePackageDigest === null) !== (runtimeByteLength === null)
  ) {
    throw new TypeError(`${path} runtime digest and byte fields must be present together`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    valid: true,
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    coordinate: parseMarketplaceReleaseCoordinate(source.coordinate, `${path}.coordinate`),
    signingKeyId: parseMarketplaceIdentity(source.signingKeyId, `${path}.signingKeyId`),
    authenticatedRequestKeyId: parseMarketplaceIdentity(
      source.authenticatedRequestKeyId,
      `${path}.authenticatedRequestKeyId`
    ),
    manifestDigest: parseSha256Base64URL(source.manifestDigest, `${path}.manifestDigest`),
    artifactDigest: parseSha256Base64URL(source.artifactDigest, `${path}.artifactDigest`),
    listingDigest: parseSha256Base64URL(source.listingDigest, `${path}.listingDigest`),
    runtimePackageDigest,
    runtimeArtifactDigest,
    manifestByteLength: positiveSafeInteger(
      source.manifestByteLength,
      `${path}.manifestByteLength`,
      MARKETPLACE_ARTIFACT_LIMITS.maxBytes
    ),
    runtimeByteLength
  })
}

export function parseMarketplaceControlSummary(
  value: unknown,
  path = 'marketplaceControl.summary'
): MarketplaceControlSummaryV1 {
  const source = parseExactManifestRecord(value, path, SUMMARY_KEYS)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    publishers: nonNegativeSafeInteger(source.publishers, `${path}.publishers`),
    publisherKeys: nonNegativeSafeInteger(source.publisherKeys, `${path}.publisherKeys`),
    ownerships: nonNegativeSafeInteger(source.ownerships, `${path}.ownerships`),
    submissions: nonNegativeSafeInteger(source.submissions, `${path}.submissions`),
    releases: nonNegativeSafeInteger(source.releases, `${path}.releases`),
    publications: nonNegativeSafeInteger(source.publications, `${path}.publications`),
    auditEvents: nonNegativeSafeInteger(source.auditEvents, `${path}.auditEvents`)
  })
}

export function parseMarketplaceControlAuditEvent(
  value: unknown,
  path = 'marketplaceControl.auditEvent'
): MarketplaceControlAuditEventV1 {
  const source = parseExactManifestRecord(value, path, AUDIT_VIEW_KEYS)
  const entitySource = parseExactManifestRecord(source.entity, `${path}.entity`, AUDIT_ENTITY_KEYS)
  const entity = Object.freeze({
    type: boundedText(entitySource.type, `${path}.entity.type`, 128),
    id: boundedText(entitySource.id, `${path}.entity.id`, MARKETPLACE_LIMITS.maxAuditSubjectBytes)
  })
  const reason = nullableReason(source.reason, `${path}.reason`)
  const correlationId =
    source.correlationId === null
      ? null
      : parseMarketplaceCorrelationId(source.correlationId, `${path}.correlationId`)
  const contextDigest =
    source.contextDigest === null
      ? null
      : parseSha256Base64URL(source.contextDigest, `${path}.contextDigest`)
  if (contextDigest === null) {
    if (reason !== null || correlationId !== null) {
      throw new TypeError(`${path} plaintext context requires contextDigest`)
    }
  } else if (contextDigest !== marketplaceAuditContextDigest({ reason, correlationId })) {
    throw new TypeError(`${path}.contextDigest does not cover its plaintext context`)
  }
  if (source.chainStatus !== 'verified') {
    throw new TypeError(`${path}.chainStatus must be verified`)
  }
  const event = parseMarketplaceAuditEvent(
    {
      sequence: source.sequence,
      time: source.time,
      actor: source.actor,
      action: source.action,
      subject: `${entity.type}:${entity.id}`,
      payloadDigest: source.payloadDigest,
      ...(contextDigest === null ? {} : { contextDigest }),
      previousHash: source.previousHash,
      eventHash: source.eventHash
    },
    `${path}.event`
  )
  if (!MARKETPLACE_AUDIT_ACTIONS.includes(event.action)) {
    throw new TypeError(`${path}.action is not supported`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    sequence: event.sequence,
    time: event.time,
    actor: parseMarketplaceAuditActor(event.actor, `${path}.actor`),
    action: event.action,
    entity,
    reason,
    correlationId,
    contextDigest,
    payloadDigest: event.payloadDigest,
    previousHash: event.previousHash,
    eventHash: event.eventHash,
    chainStatus: 'verified'
  })
}

export function parseMarketplaceOperatorOverview(
  value: unknown,
  path = 'marketplaceControl.operatorOverview'
): MarketplaceOperatorOverviewV1 {
  const source = parseExactManifestRecord(value, path, OPERATOR_OVERVIEW_KEYS)
  if (source.source !== 'marketplace') throw new TypeError(`${path}.source is not supported`)
  const generatedAt = parseMarketplaceTimestamp(source.generatedAt, `${path}.generatedAt`)
  const keyExpiryThresholdAt = parseMarketplaceTimestamp(
    source.keyExpiryThresholdAt,
    `${path}.keyExpiryThresholdAt`
  )
  if (
    Date.parse(keyExpiryThresholdAt) - Date.parse(generatedAt) !==
    MARKETPLACE_OPERATOR_KEY_EXPIRY_WINDOW_MS
  ) {
    throw new TypeError(`${path}.keyExpiryThresholdAt must be exactly 30 days after generatedAt`)
  }
  const pendingSource = parseExactManifestRecord(
    source.pending,
    `${path}.pending`,
    OPERATOR_PENDING_KEYS
  )
  const riskSource = parseExactManifestRecord(source.risk, `${path}.risk`, OPERATOR_RISK_KEYS)
  const recentPublications = parseBoundedManifestArray(
    source.recentPublications,
    `${path}.recentPublications`,
    MARKETPLACE_OPERATOR_RECENT_LIMIT
  ).map((publication, index) =>
    parseMarketplacePublication(publication, `${path}.recentPublications[${index}]`)
  )
  for (let index = 1; index < recentPublications.length; index++) {
    if (recentPublications[index - 1].sequence <= recentPublications[index].sequence) {
      throw new TypeError(`${path}.recentPublications must be latest-first`)
    }
  }
  if (source.auditAccess !== 'available' && source.auditAccess !== 'restricted') {
    throw new TypeError(`${path}.auditAccess is not supported`)
  }
  const recentAudit = parseBoundedManifestArray(
    source.recentAudit,
    `${path}.recentAudit`,
    MARKETPLACE_OPERATOR_RECENT_LIMIT
  ).map((event, index) => parseMarketplaceControlAuditEvent(event, `${path}.recentAudit[${index}]`))
  if (source.auditAccess === 'restricted' && recentAudit.length !== 0) {
    throw new TypeError(`${path}.recentAudit must be empty when auditAccess is restricted`)
  }
  for (let index = 1; index < recentAudit.length; index++) {
    if (recentAudit[index - 1].sequence <= recentAudit[index].sequence) {
      throw new TypeError(`${path}.recentAudit must be latest-first`)
    }
  }
  const auditChainSource = parseExactManifestRecord(
    source.auditChain,
    `${path}.auditChain`,
    OPERATOR_AUDIT_CHAIN_KEYS
  )
  if (
    auditChainSource.status !== 'valid' ||
    auditChainSource.verificationSource !== 'marketplace'
  ) {
    throw new TypeError(`${path}.auditChain is not Marketplace-verified`)
  }
  const verifiedThroughSequence = nonNegativeSafeInteger(
    auditChainSource.verifiedThroughSequence,
    `${path}.auditChain.verifiedThroughSequence`
  )
  const head =
    auditChainSource.head === null
      ? null
      : parseSha256Base64URL(auditChainSource.head, `${path}.auditChain.head`)
  if ((verifiedThroughSequence === 0) !== (head === null)) {
    throw new TypeError(`${path}.auditChain.head does not match its verified sequence`)
  }
  if (recentAudit.length > 0 && recentAudit[0].sequence !== verifiedThroughSequence) {
    throw new TypeError(`${path}.recentAudit does not start at the verified chain head`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    source: 'marketplace',
    generatedAt,
    keyExpiryThresholdAt,
    pending: Object.freeze({
      publishers: nonNegativeSafeInteger(pendingSource.publishers, `${path}.pending.publishers`),
      publisherKeys: nonNegativeSafeInteger(
        pendingSource.publisherKeys,
        `${path}.pending.publisherKeys`
      ),
      ownerships: nonNegativeSafeInteger(pendingSource.ownerships, `${path}.pending.ownerships`),
      submissions: nonNegativeSafeInteger(pendingSource.submissions, `${path}.pending.submissions`)
    }),
    risk: Object.freeze({
      suspendedPublishers: nonNegativeSafeInteger(
        riskSource.suspendedPublishers,
        `${path}.risk.suspendedPublishers`
      ),
      revokedPublisherKeys: nonNegativeSafeInteger(
        riskSource.revokedPublisherKeys,
        `${path}.risk.revokedPublisherKeys`
      ),
      expiringPublisherKeys: nonNegativeSafeInteger(
        riskSource.expiringPublisherKeys,
        `${path}.risk.expiringPublisherKeys`
      ),
      yankedReleases: nonNegativeSafeInteger(
        riskSource.yankedReleases,
        `${path}.risk.yankedReleases`
      )
    }),
    recentPublications: Object.freeze(recentPublications),
    auditAccess: source.auditAccess,
    recentAudit: Object.freeze(recentAudit),
    auditChain: Object.freeze({
      status: 'valid',
      verifiedThroughSequence,
      head,
      verificationSource: 'marketplace'
    })
  })
}

export function parseMarketplaceControlPage<Item>(
  value: unknown,
  parseItem: MarketplaceControlItemParser<Item>,
  path = 'marketplaceControl.page'
): MarketplaceControlPageV1<Item> {
  const source = parseExactManifestRecord(value, path, PAGE_KEYS)
  const items = parseBoundedManifestArray(
    source.items,
    `${path}.items`,
    MARKETPLACE_CONTROL_LIMITS.maxPageLimit
  ).map((item, index) => parseItem(item, `${path}.items[${index}]`))
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    items: Object.freeze(items),
    nextCursor:
      source.nextCursor === null
        ? null
        : parseMarketplaceControlCursorText(source.nextCursor, `${path}.nextCursor`)
  })
}

export function parseMarketplaceOperatorPublications(
  value: unknown,
  path = 'marketplaceControl.operatorPublications'
): MarketplaceOperatorPublicationsV1 {
  const source = parseExactManifestRecord(value, path, OPERATOR_PUBLICATIONS_KEYS)
  const onlineSigning = parseExactManifestRecord(
    source.onlineSigning,
    `${path}.onlineSigning`,
    OPERATOR_ONLINE_SIGNING_KEYS
  )
  if (onlineSigning.enabled !== false) {
    throw new TypeError(`${path}.onlineSigning.enabled must remain false`)
  }
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    onlineSigning: Object.freeze({
      enabled: false,
      reason: boundedText(
        onlineSigning.reason,
        `${path}.onlineSigning.reason`,
        MARKETPLACE_LIMITS.maxReasonBytes
      )
    }),
    publications: parseMarketplaceControlPage(
      source.publications,
      parseMarketplacePublication,
      `${path}.publications`
    )
  })
}

export function parseMarketplaceControlPublisherAuditPage(
  value: unknown,
  path = 'marketplaceControl.publisherAuditPage'
): MarketplaceControlPublisherAuditPageV1 {
  const source = parseExactManifestRecord(value, path, PUBLISHER_AUDIT_PAGE_KEYS)
  const items = parseBoundedManifestArray(
    source.items,
    `${path}.items`,
    MARKETPLACE_CONTROL_LIMITS.maxPageLimit
  ).map((item, index) => parseMarketplaceAuditEvent(item, `${path}.items[${index}]`))
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    publisherId: parseMarketplaceIdentity(source.publisherId, `${path}.publisherId`),
    items: Object.freeze(items),
    nextCursor:
      source.nextCursor === null
        ? null
        : parseMarketplaceControlCursorText(source.nextCursor, `${path}.nextCursor`)
  })
}

export function parseMarketplaceControlDetail<Item>(
  value: unknown,
  parseItem: MarketplaceControlItemParser<Item>,
  path = 'marketplaceControl.detail'
): MarketplaceControlDetailV1<Item> {
  const source = parseExactManifestRecord(value, path, DETAIL_KEYS)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    item: parseItem(source.item, `${path}.item`)
  })
}

export type MarketplaceControlFilterRule =
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'identity' }
  | { readonly kind: 'text'; readonly maxBytes?: number }
  | { readonly kind: 'timestamp' }
  | { readonly kind: 'digest' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'positive-integer'; readonly maximum?: number }
  | { readonly kind: 'non-negative-integer'; readonly maximum?: number }

export interface ParseMarketplaceControlQueryOptions<
  Filter extends string = string,
  Sort extends string = string
> {
  readonly filters?: Readonly<Record<Filter, MarketplaceControlFilterRule>>
  readonly sorts: readonly Sort[]
  readonly defaultSort: Sort
  readonly defaultLimit?: number
}

export interface MarketplaceControlListQuery<
  Filter extends string = string,
  Sort extends string = string
> {
  readonly limit: number
  readonly cursor: string | null
  readonly sort: Sort
  readonly filters: Readonly<Partial<Record<Filter, string>>>
}

function queryParameters(input: string | URLSearchParams): URLSearchParams {
  const source =
    typeof input === 'string' ? (input.startsWith('?') ? input.slice(1) : input) : input.toString()
  if (
    byteLength(source) > MARKETPLACE_CONTROL_LIMITS.maxQueryBytes ||
    source.includes('#') ||
    /%(?![0-9A-Fa-f]{2})/.test(source)
  ) {
    throw new TypeError('Marketplace control query is malformed or exceeds the byte limit')
  }
  return new URLSearchParams(source)
}

function queryInteger(value: string, path: string, minimum: number, maximum: number): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new TypeError(`${path} must be canonical integer text`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${path} is outside the allowed range`)
  }
  return String(parsed)
}

function queryFilter(value: string, name: string, rule: MarketplaceControlFilterRule): string {
  const path = `marketplace control query.${name}`
  if (byteLength(value) > MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes) {
    throw new TypeError(`${path} exceeds the byte limit`)
  }
  switch (rule.kind) {
    case 'enum':
      if (rule.values.length === 0 || !rule.values.includes(value)) {
        throw new TypeError(`${path} is not supported`)
      }
      return value
    case 'identity':
      return parseMarketplaceIdentity(value, path)
    case 'text': {
      const maximum = rule.maxBytes ?? MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes
      if (maximum < 1 || maximum > MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes) {
        throw new TypeError(`${path} has an invalid server-side rule`)
      }
      return boundedText(value, path, maximum)
    }
    case 'timestamp':
      return parseMarketplaceTimestamp(value, path)
    case 'digest':
      return parseSha256Base64URL(value, path)
    case 'boolean':
      if (value !== 'true' && value !== 'false')
        throw new TypeError(`${path} must be true or false`)
      return value
    case 'positive-integer':
      return queryInteger(value, path, 1, rule.maximum ?? Number.MAX_SAFE_INTEGER)
    case 'non-negative-integer':
      return queryInteger(value, path, 0, rule.maximum ?? Number.MAX_SAFE_INTEGER)
  }
  throw new TypeError(`${path} uses an unsupported filter rule`)
}

export function parseMarketplaceControlListQuery<
  const Filter extends string,
  const Sort extends string
>(
  input: string | URLSearchParams,
  options: ParseMarketplaceControlQueryOptions<Filter, Sort>
): MarketplaceControlListQuery<Filter, Sort> {
  const parameters = queryParameters(input)
  const entries = [...parameters.entries()]
  if (entries.length > MARKETPLACE_CONTROL_LIMITS.maxQueryEntries) {
    throw new TypeError('Marketplace control query has too many fields')
  }
  if (options.sorts.length === 0 || !options.sorts.includes(options.defaultSort)) {
    throw new TypeError('Marketplace control query has an invalid server-side sort policy')
  }
  const filterRules =
    options.filters ?? ({} as Readonly<Record<Filter, MarketplaceControlFilterRule>>)
  const allowed = new Set(['limit', 'cursor', 'sort', ...Object.keys(filterRules)])
  const seen = new Set<string>()
  const raw = new Map<string, string>()
  for (const [name, value] of entries) {
    if (
      byteLength(name) > MARKETPLACE_CONTROL_LIMITS.maxQueryKeyBytes ||
      byteLength(value) > MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes ||
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ||
      !allowed.has(name)
    ) {
      throw new TypeError('Marketplace control query contains an unknown or oversized field')
    }
    if (seen.has(name)) throw new TypeError(`Marketplace control query.${name} must not repeat`)
    seen.add(name)
    raw.set(name, value)
  }
  const defaultLimit = options.defaultLimit ?? MARKETPLACE_CONTROL_LIMITS.defaultPageLimit
  if (defaultLimit < 1 || defaultLimit > MARKETPLACE_CONTROL_LIMITS.maxPageLimit) {
    throw new TypeError('Marketplace control query has an invalid server-side default limit')
  }
  const limitValue = raw.get('limit')
  const limit =
    limitValue === undefined
      ? defaultLimit
      : Number(
          queryInteger(
            limitValue,
            'marketplace control query.limit',
            1,
            MARKETPLACE_CONTROL_LIMITS.maxPageLimit
          )
        )
  const sortValue = raw.get('sort') ?? options.defaultSort
  if (!options.sorts.includes(sortValue as Sort)) {
    throw new TypeError('Marketplace control query.sort is not supported')
  }
  const cursorValue = raw.get('cursor')
  const parsedFilters: Partial<Record<Filter, string>> = {}
  for (const name of Object.keys(filterRules).sort() as Filter[]) {
    const value = raw.get(name)
    if (value !== undefined) parsedFilters[name] = queryFilter(value, name, filterRules[name])
  }
  return Object.freeze({
    limit,
    cursor:
      cursorValue === undefined
        ? null
        : parseMarketplaceControlCursorText(cursorValue, 'marketplace control query.cursor'),
    sort: sortValue as Sort,
    filters: Object.freeze(parsedFilters)
  })
}

export interface MarketplaceControlCursorBinding {
  readonly resource: MarketplaceControlResource
  readonly scope: string
  readonly sort: string
  readonly filters: Readonly<Record<string, string>>
  readonly stateToken: string
}

export interface MarketplaceControlCursorPayloadV1 extends MarketplaceControlCursorBinding {
  readonly schemaVersion: typeof MARKETPLACE_CONTROL_SCHEMA_VERSION
  readonly after: string
}

export class MarketplaceControlStaleCursorError extends Error {
  constructor() {
    super('Marketplace control cursor is stale because marketplace state changed')
    this.name = 'MarketplaceControlStaleCursorError'
  }
}

function cursorResource(value: unknown, path: string): MarketplaceControlResource {
  return enumValue(value, MARKETPLACE_CONTROL_RESOURCES, path)
}

function cursorFilters(value: unknown, path: string): Readonly<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const entries = Object.entries(value)
  if (entries.length > MARKETPLACE_CONTROL_LIMITS.maxCursorFilters) {
    throw new TypeError(`${path} has too many fields`)
  }
  const output: Record<string, string> = {}
  for (const [name, filterValue] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (
      !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name) ||
      byteLength(name) > MARKETPLACE_CONTROL_LIMITS.maxQueryKeyBytes
    ) {
      throw new TypeError(`${path} has an invalid field`)
    }
    output[name] = boundedText(
      filterValue,
      `${path}.${name}`,
      MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes
    )
  }
  return Object.freeze(output)
}

function parseCursorPayload(
  value: unknown,
  path = 'marketplace control cursor payload'
): MarketplaceControlCursorPayloadV1 {
  const source = parseExactManifestRecord(value, path, CURSOR_PAYLOAD_KEYS)
  return Object.freeze({
    schemaVersion: schemaVersion(source.schemaVersion, `${path}.schemaVersion`),
    resource: cursorResource(source.resource, `${path}.resource`),
    scope: boundedText(
      source.scope,
      `${path}.scope`,
      MARKETPLACE_CONTROL_LIMITS.maxCursorScopeBytes
    ),
    sort: boundedText(source.sort, `${path}.sort`, MARKETPLACE_CONTROL_LIMITS.maxQueryValueBytes),
    filters: cursorFilters(source.filters, `${path}.filters`),
    stateToken: boundedText(
      source.stateToken,
      `${path}.stateToken`,
      MARKETPLACE_CONTROL_LIMITS.maxCursorStateTokenBytes
    ),
    after: boundedText(
      source.after,
      `${path}.after`,
      MARKETPLACE_CONTROL_LIMITS.maxCursorAfterBytes
    )
  })
}

function canonicalCursorPayload(value: MarketplaceControlCursorPayloadV1): string {
  return JSON.stringify({
    schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
    resource: value.resource,
    scope: value.scope,
    sort: value.sort,
    filters: Object.fromEntries(
      Object.entries(value.filters).sort(([left], [right]) => left.localeCompare(right))
    ),
    stateToken: value.stateToken,
    after: value.after
  })
}

function base64URLBytes(value: string, path: string, maximumBytes: number): Uint8Array {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${path} must be canonical base64url without padding`)
  }
  const bytes = new Uint8Array(Buffer.from(value, 'base64url'))
  if (bytes.byteLength > maximumBytes || Buffer.from(bytes).toString('base64url') !== value) {
    throw new TypeError(`${path} must be canonical bounded base64url`)
  }
  return bytes
}

export function parseMarketplaceControlCursorText(value: unknown, path: string): string {
  if (
    typeof value !== 'string' ||
    value.length > MARKETPLACE_CONTROL_LIMITS.maxCursorCharacters ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new TypeError(`${path} must be a bounded opaque cursor`)
  }
  return value
}

function assertHMACKey(key: CryptoKey, usage: 'sign' | 'verify'): void {
  const algorithm = key.algorithm as HmacKeyAlgorithm
  if (
    key.type !== 'secret' ||
    key.extractable ||
    algorithm.name !== 'HMAC' ||
    algorithm.hash.name !== 'SHA-256' ||
    algorithm.length < MARKETPLACE_CONTROL_LIMITS.minCursorKeyBytes * 8 ||
    !key.usages.includes(usage)
  ) {
    throw new TypeError(
      'Marketplace control cursor requires a non-extractable HMAC-SHA256 key of at least 32 bytes'
    )
  }
}

export async function importMarketplaceControlCursorKey(source: Uint8Array): Promise<CryptoKey> {
  if (
    !(source instanceof Uint8Array) ||
    source.byteLength < MARKETPLACE_CONTROL_LIMITS.minCursorKeyBytes ||
    source.byteLength > MARKETPLACE_CONTROL_LIMITS.maxCursorKeyBytes
  ) {
    throw new TypeError('Marketplace control cursor key must contain between 32 and 1024 bytes')
  }
  const copy = Uint8Array.from(source)
  try {
    return await crypto.subtle.importKey(
      'raw',
      webCryptoBuffer(copy),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    )
  } finally {
    copy.fill(0)
  }
}

export async function createRandomMarketplaceControlCursorKey(): Promise<CryptoKey> {
  const source = crypto.getRandomValues(
    new Uint8Array(MARKETPLACE_CONTROL_LIMITS.minCursorKeyBytes)
  )
  try {
    return await importMarketplaceControlCursorKey(source)
  } finally {
    source.fill(0)
  }
}

export async function encodeMarketplaceControlCursor(
  value: MarketplaceControlCursorPayloadV1,
  key: CryptoKey
): Promise<string> {
  assertHMACKey(key, 'sign')
  const parsed = parseCursorPayload(value)
  const payload = encoder.encode(canonicalCursorPayload(parsed))
  if (payload.byteLength > MARKETPLACE_CONTROL_LIMITS.maxCursorPayloadBytes) {
    throw new TypeError('Marketplace control cursor payload exceeds the byte limit')
  }
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, webCryptoBuffer(payload)))
  const cursor = `${Buffer.from(payload).toString('base64url')}.${Buffer.from(signature).toString('base64url')}`
  return parseMarketplaceControlCursorText(cursor, 'marketplace control cursor')
}

function cursorBindingMatches(
  payload: MarketplaceControlCursorPayloadV1,
  expected: MarketplaceControlCursorBinding
): boolean {
  const expectedFilters = cursorFilters(
    expected.filters,
    'marketplace control cursor binding.filters'
  )
  return (
    payload.resource === expected.resource &&
    payload.scope === expected.scope &&
    payload.sort === expected.sort &&
    JSON.stringify(payload.filters) === JSON.stringify(expectedFilters)
  )
}

export async function decodeMarketplaceControlCursor(
  value: unknown,
  key: CryptoKey,
  expected: MarketplaceControlCursorBinding
): Promise<MarketplaceControlCursorPayloadV1> {
  assertHMACKey(key, 'verify')
  const cursor = parseMarketplaceControlCursorText(value, 'marketplace control cursor')
  const [payloadPart, signaturePart] = cursor.split('.') as [string, string]
  const payloadBytes = base64URLBytes(
    payloadPart,
    'marketplace control cursor payload',
    MARKETPLACE_CONTROL_LIMITS.maxCursorPayloadBytes
  )
  const signature = base64URLBytes(signaturePart, 'marketplace control cursor signature', 32)
  if (signature.byteLength !== 32) throw new TypeError('Marketplace control cursor is invalid')
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      key,
      webCryptoBuffer(signature),
      webCryptoBuffer(payloadBytes)
    ))
  ) {
    throw new TypeError('Marketplace control cursor is invalid')
  }
  let text: string
  let raw: unknown
  try {
    text = decoder.decode(payloadBytes)
    raw = JSON.parse(text) as unknown
  } catch {
    throw new TypeError('Marketplace control cursor is invalid')
  }
  const payload = parseCursorPayload(raw)
  if (canonicalCursorPayload(payload) !== text || !cursorBindingMatches(payload, expected)) {
    throw new TypeError('Marketplace control cursor does not match this request')
  }
  if (payload.stateToken !== expected.stateToken) {
    throw new MarketplaceControlStaleCursorError()
  }
  return payload
}

function forbiddenWireKey(value: string): boolean {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  return (
    normalized.includes('privatekey') ||
    normalized.endsWith('key') ||
    normalized.includes('pem') ||
    normalized.includes('secret') ||
    normalized.includes('password') ||
    (normalized.includes('credential') && normalized !== 'credentialkinds') ||
    normalized === 'authorization' ||
    normalized === 'cookie' ||
    normalized.endsWith('token') ||
    normalized === 'rootkey' ||
    (normalized.endsWith('url') && normalized !== 'iconurl' && normalized !== 'homepageurl') ||
    normalized.endsWith('uri') ||
    normalized === 'href' ||
    normalized.endsWith('endpoint') ||
    normalized.endsWith('path') ||
    normalized.includes('filesystem')
  )
}

interface MarketplaceWireTraversalState {
  depth: number
  entries: number
}

function countWireEntry(state: MarketplaceWireTraversalState): void {
  state.entries += 1
  if (state.entries > MARKETPLACE_CONTROL_LIMITS.maxWireEntries) {
    throw new TypeError('Marketplace control response has too many entries')
  }
}

function assertWireSafeArray(
  value: readonly unknown[],
  path: string,
  state: MarketplaceWireTraversalState
): void {
  if (Object.keys(value).length !== value.length) throw new TypeError(`${path} must not be sparse`)
  state.depth += 1
  for (let index = 0; index < value.length; index++) {
    countWireEntry(state)
    assertWireSafe(value[index], `${path}[${index}]`, state)
  }
  state.depth -= 1
}

function assertWireSafeRecord(
  value: object,
  path: string,
  state: MarketplaceWireTraversalState
): void {
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain plain JSON objects only`)
  }
  state.depth += 1
  for (const [key, entry] of Object.entries(value)) {
    countWireEntry(state)
    if (forbiddenWireKey(key)) throw new TypeError(`${path} contains a forbidden secret field`)
    assertWireSafe(entry, `${path}.${key}`, state)
  }
  state.depth -= 1
}

function assertWireSafe(value: unknown, path: string, state: MarketplaceWireTraversalState): void {
  if (state.depth > MARKETPLACE_CONTROL_LIMITS.maxWireDepth) {
    throw new TypeError('Marketplace control response exceeds the depth limit')
  }
  if (value === null || typeof value === 'boolean') return
  // Text fields are untrusted domain content. Secret and internal transport
  // material is excluded structurally by exact DTO mappers and the field-name
  // denylist above; inspecting arbitrary text here would make a committed
  // mutation fail only while serializing its response.
  if (typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain finite JSON numbers`)
    return
  }
  if (Array.isArray(value)) return assertWireSafeArray(value, path, state)
  if (typeof value !== 'object') throw new TypeError(`${path} must contain JSON values only`)
  assertWireSafeRecord(value, path, state)
}

export function serializeMarketplaceControlJSON(
  value: unknown,
  maximumBytes = MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
): string {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
  ) {
    throw new TypeError('Marketplace control response byte limit is invalid')
  }
  assertWireSafe(value, 'marketplaceControl.response', { depth: 0, entries: 0 })
  const source = JSON.stringify(value)
  if (byteLength(source) > maximumBytes) {
    throw new TypeError('Marketplace control response exceeds the JSON byte limit')
  }
  return source
}

export function parseMarketplaceControlJSON<Value>(
  source: string | Uint8Array,
  parse: (value: unknown) => Value,
  maximumBytes = MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
): Value {
  const bytes = typeof source === 'string' ? encoder.encode(source) : source
  if (
    bytes.byteLength > maximumBytes ||
    bytes.byteLength > MARKETPLACE_CONTROL_LIMITS.maxResponseJsonBytes
  ) {
    throw new TypeError('Marketplace control response exceeds the JSON byte limit')
  }
  let text: string
  let value: unknown
  try {
    text = typeof source === 'string' ? source : decoder.decode(source)
    value = JSON.parse(text) as unknown
  } catch {
    throw new TypeError('Marketplace control response must contain valid UTF-8 JSON')
  }
  if (JSON.stringify(value) !== text) {
    throw new TypeError(
      'Marketplace control response must use canonical JSON without duplicate fields'
    )
  }
  assertWireSafe(value, 'marketplaceControl.response', { depth: 0, entries: 0 })
  return parse(value)
}
