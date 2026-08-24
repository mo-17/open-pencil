import {
  digestCanonicalManifest,
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL
} from '@open-pencil/scene-graph'

import { findActiveMarketplacePublisherKey } from './publisher-trust'
import {
  canTransitionMarketplaceOwnership,
  canTransitionMarketplacePublisher,
  canTransitionMarketplacePublisherKey,
  canTransitionMarketplaceSubmission,
  marketplaceReleaseCoordinateKey,
  parseMarketplaceIdentity,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceTimestamp,
  type MarketplaceOwnershipStatus,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherStatus,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceStateV1,
  type MarketplaceSubmissionStatus
} from './types'

export const MARKETPLACE_IMPACT_SCHEMA_VERSION = 1 as const

export const MARKETPLACE_IMPACT_OPERATIONS = [
  'publisher.status',
  'publisher-key.status',
  'ownership.status',
  'submission.status',
  'submission.publish',
  'release.yank',
  'marketplace.publish'
] as const

const IMPACT_PREVIEW_KEYS = new Set([
  'schemaVersion',
  'operation',
  'subject',
  'authorityDigest',
  'auditSequence',
  'auditHead',
  'allowed',
  'blockers'
])
const REASONED_PUBLISHER_STATUSES = new Set<MarketplacePublisherStatus>(['rejected', 'suspended'])
const REASONED_PUBLISHER_KEY_STATUSES = new Set<MarketplacePublisherKeyStatus>([
  'rejected',
  'revoked'
])
const REASONED_OWNERSHIP_STATUSES = new Set<MarketplaceOwnershipStatus>(['rejected', 'revoked'])
const REASONED_SUBMISSION_STATUSES = new Set<MarketplaceSubmissionStatus>([
  'validation_failed',
  'changes_requested',
  'rejected',
  'withdrawn',
  'yanked'
])

export type MarketplaceImpactRequest =
  | {
      operation: 'publisher.status'
      publisherId: string
      status: MarketplacePublisherStatus
      reason: string | null
    }
  | {
      operation: 'publisher-key.status'
      keyId: string
      status: MarketplacePublisherKeyStatus
      reason: string | null
    }
  | {
      operation: 'ownership.status'
      pluginId: string
      status: MarketplaceOwnershipStatus
      reason: string | null
    }
  | {
      operation: 'submission.status'
      submissionId: string
      status: MarketplaceSubmissionStatus
      reason: string | null
    }
  | { operation: 'submission.publish'; submissionId: string }
  | { operation: 'release.yank'; coordinate: MarketplaceReleaseCoordinateV1; reason: string }
  | { operation: 'marketplace.publish' }

export interface MarketplaceImpactPreviewV1 {
  readonly schemaVersion: typeof MARKETPLACE_IMPACT_SCHEMA_VERSION
  readonly operation: MarketplaceImpactRequest['operation']
  readonly subject: string
  readonly authorityDigest: string
  readonly auditSequence: number
  readonly auditHead: string | null
  readonly allowed: boolean
  readonly blockers: readonly string[]
}

export class MarketplaceImpactAuthorityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketplaceImpactAuthorityError'
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

export function parseMarketplaceImpactPreview(
  value: unknown,
  path = 'marketplaceImpactPreview'
): MarketplaceImpactPreviewV1 {
  const source = parseExactManifestRecord(value, path, IMPACT_PREVIEW_KEYS)
  if (source.schemaVersion !== MARKETPLACE_IMPACT_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion must be ${MARKETPLACE_IMPACT_SCHEMA_VERSION}`)
  }
  if (
    typeof source.operation !== 'string' ||
    !MARKETPLACE_IMPACT_OPERATIONS.includes(
      source.operation as (typeof MARKETPLACE_IMPACT_OPERATIONS)[number]
    )
  ) {
    throw new TypeError(`${path}.operation is not supported`)
  }
  if (
    typeof source.subject !== 'string' ||
    source.subject.length === 0 ||
    source.subject !== source.subject.trim() ||
    new TextEncoder().encode(source.subject).byteLength > 1_024 ||
    containsControlCharacter(source.subject)
  ) {
    throw new TypeError(`${path}.subject must be bounded text without control characters`)
  }
  if (!Number.isSafeInteger(source.auditSequence) || (source.auditSequence as number) < 0) {
    throw new TypeError(`${path}.auditSequence must be a non-negative safe integer`)
  }
  const blockers = parseBoundedManifestArray(source.blockers, `${path}.blockers`, 64).map(
    (blocker, index) => {
      if (
        typeof blocker !== 'string' ||
        blocker.length === 0 ||
        blocker !== blocker.trim() ||
        new TextEncoder().encode(blocker).byteLength > 4_096 ||
        containsControlCharacter(blocker)
      ) {
        throw new TypeError(`${path}.blockers[${index}] must be bounded safe text`)
      }
      return blocker
    }
  )
  if (typeof source.allowed !== 'boolean' || source.allowed !== (blockers.length === 0)) {
    throw new TypeError(`${path}.allowed must exactly match blockers`)
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_IMPACT_SCHEMA_VERSION,
    operation: source.operation as MarketplaceImpactRequest['operation'],
    subject: source.subject,
    authorityDigest: parseSha256Base64URL(source.authorityDigest, `${path}.authorityDigest`),
    auditSequence: source.auditSequence as number,
    auditHead:
      source.auditHead === null
        ? null
        : parseSha256Base64URL(source.auditHead, `${path}.auditHead`),
    allowed: source.allowed,
    blockers: Object.freeze(blockers)
  })
}

function stateToken(state: MarketplaceStateV1): {
  auditSequence: number
  auditHead: string | null
} {
  return {
    auditSequence: state.auditEvents.length,
    auditHead: state.auditEvents.at(-1)?.eventHash ?? null
  }
}

function activePublisherBlocker(state: MarketplaceStateV1, publisherId: string): string | null {
  const publisher = state.publishers.find(({ id }) => id === publisherId)
  return publisher?.status === 'active' ? null : `Publisher ${publisherId} is not active`
}

function activeOwnershipBlocker(
  state: MarketplaceStateV1,
  pluginId: string,
  publisherId: string
): string | null {
  const ownership = state.ownerships.find((candidate) => candidate.pluginId === pluginId)
  if (ownership?.publisherId === publisherId && ownership.status === 'active') return null
  return `Ownership for ${pluginId} is not active for ${publisherId}`
}

function signingKeyBlocker(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string | null,
  at: string
): string | null {
  if (!keyId) return 'Submission has no pinned signing key identity'
  if (findActiveMarketplacePublisherKey(state, publisherId, keyId, Date.parse(at))) return null
  return `Signing key ${keyId} is not active for ${publisherId}`
}

function normalizedRequest(input: MarketplaceImpactRequest): MarketplaceImpactRequest {
  switch (input.operation) {
    case 'publisher.status':
      return {
        operation: input.operation,
        publisherId: parseMarketplaceIdentity(input.publisherId, 'impact.publisherId'),
        status: input.status,
        reason: input.reason === null ? null : parseMarketplaceReason(input.reason, 'impact.reason')
      }
    case 'publisher-key.status':
      return {
        operation: input.operation,
        keyId: parseMarketplaceIdentity(input.keyId, 'impact.keyId'),
        status: input.status,
        reason: input.reason === null ? null : parseMarketplaceReason(input.reason, 'impact.reason')
      }
    case 'ownership.status':
      return {
        operation: input.operation,
        pluginId: parseMarketplaceIdentity(input.pluginId, 'impact.pluginId'),
        status: input.status,
        reason: input.reason === null ? null : parseMarketplaceReason(input.reason, 'impact.reason')
      }
    case 'submission.status':
      return {
        operation: input.operation,
        submissionId: parseMarketplaceIdentity(input.submissionId, 'impact.submissionId'),
        status: input.status,
        reason: input.reason === null ? null : parseMarketplaceReason(input.reason, 'impact.reason')
      }
    case 'submission.publish':
      return {
        operation: input.operation,
        submissionId: parseMarketplaceIdentity(input.submissionId, 'impact.submissionId')
      }
    case 'release.yank':
      return {
        operation: input.operation,
        coordinate: parseMarketplaceReleaseCoordinate(input.coordinate, 'impact.coordinate'),
        reason: parseMarketplaceReason(input.reason, 'impact.reason')
      }
    case 'marketplace.publish':
      return input
  }
  throw new TypeError('Marketplace impact operation is not supported')
}

interface MarketplaceImpactDetails {
  subject: string
  blockers: string[]
  current: unknown
}

function publisherStatusImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'publisher.status' }>
): MarketplaceImpactDetails {
  const current = state.publishers.find(({ id }) => id === input.publisherId) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Publisher ${input.publisherId} does not exist`)
  else {
    if (!canTransitionMarketplacePublisher(current.status, input.status)) {
      blockers.push(`Publisher cannot transition from ${current.status} to ${input.status}`)
    }
    if (REASONED_PUBLISHER_STATUSES.has(input.status) && input.reason === null) {
      blockers.push(`Publisher status ${input.status} requires a reason`)
    }
    const hasActiveKey = state.publisherKeys.some(
      (key) => key.publisherId === input.publisherId && key.status === 'active'
    )
    if (input.status === 'active' && !hasActiveKey) {
      blockers.push(`Publisher ${input.publisherId} requires an active public key`)
    }
  }
  return { subject: `publisher:${input.publisherId}`, blockers, current }
}

function publisherKeyStatusImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'publisher-key.status' }>
): MarketplaceImpactDetails {
  const current = state.publisherKeys.find(({ keyId }) => keyId === input.keyId) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Publisher key ${input.keyId} does not exist`)
  else {
    if (!canTransitionMarketplacePublisherKey(current.status, input.status)) {
      blockers.push(`Publisher key cannot transition from ${current.status} to ${input.status}`)
    }
    if (REASONED_PUBLISHER_KEY_STATUSES.has(input.status) && input.reason === null) {
      blockers.push(`Publisher key status ${input.status} requires a reason`)
    }
    const publisher = state.publishers.find(({ id }) => id === current.publisherId)
    if (!publisher) blockers.push(`Publisher ${current.publisherId} does not exist`)
    else if (
      input.status === 'active' &&
      (publisher.status === 'rejected' || publisher.status === 'suspended')
    ) {
      blockers.push(`Publisher ${publisher.id} cannot activate keys while ${publisher.status}`)
    }
  }
  return { subject: `publisher-key:${input.keyId}`, blockers, current }
}

function ownershipStatusImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'ownership.status' }>
): MarketplaceImpactDetails {
  const current = state.ownerships.find(({ pluginId }) => pluginId === input.pluginId) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Ownership for ${input.pluginId} does not exist`)
  else {
    if (!canTransitionMarketplaceOwnership(current.status, input.status)) {
      blockers.push(`Ownership cannot transition from ${current.status} to ${input.status}`)
    }
    if (REASONED_OWNERSHIP_STATUSES.has(input.status) && input.reason === null) {
      blockers.push(`Ownership status ${input.status} requires a reason`)
    }
    if (input.status === 'active') {
      const blocker = activePublisherBlocker(state, current.publisherId)
      if (blocker) blockers.push(blocker)
    }
  }
  return { subject: `ownership:${input.pluginId}`, blockers, current }
}

function submissionStatusImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'submission.status' }>
): MarketplaceImpactDetails {
  const current = state.submissions.find(({ id }) => id === input.submissionId) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Submission ${input.submissionId} does not exist`)
  else if (input.status === 'published' || input.status === 'yanked') {
    blockers.push('Submission publish and yank require their dedicated impact operations')
  } else {
    if (!canTransitionMarketplaceSubmission(current.status, input.status)) {
      blockers.push(`Submission cannot transition from ${current.status} to ${input.status}`)
    }
    if (REASONED_SUBMISSION_STATUSES.has(input.status) && input.reason === null) {
      blockers.push(`Submission status ${input.status} requires a reason`)
    }
    if (input.status === 'approved') {
      for (const blocker of [
        activePublisherBlocker(state, current.publisherId),
        activeOwnershipBlocker(state, current.coordinate.pluginId, current.publisherId)
      ]) {
        if (blocker) blockers.push(blocker)
      }
    }
  }
  return { subject: `submission:${input.submissionId}`, blockers, current }
}

function submissionPublishImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'submission.publish' }>,
  at: string
): MarketplaceImpactDetails {
  const current = state.submissions.find(({ id }) => id === input.submissionId) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Submission ${input.submissionId} does not exist`)
  else {
    if (!canTransitionMarketplaceSubmission(current.status, 'published')) {
      blockers.push(`Submission cannot transition from ${current.status} to published`)
    }
    const legacyUnpinned = current.revision === 1 && current.signingKeyId === null
    for (const blocker of [
      activePublisherBlocker(state, current.publisherId),
      activeOwnershipBlocker(state, current.coordinate.pluginId, current.publisherId),
      legacyUnpinned
        ? null
        : signingKeyBlocker(state, current.publisherId, current.signingKeyId, at)
    ]) {
      if (blocker) blockers.push(blocker)
    }
  }
  return { subject: `submission:${input.submissionId}`, blockers, current }
}

function releaseYankImpact(
  state: MarketplaceStateV1,
  input: Extract<MarketplaceImpactRequest, { operation: 'release.yank' }>
): MarketplaceImpactDetails {
  const coordinate = marketplaceReleaseCoordinateKey(input.coordinate)
  const current =
    state.releases.find(
      (release) => marketplaceReleaseCoordinateKey(release.coordinate) === coordinate
    ) ?? null
  const blockers: string[] = []
  if (!current) blockers.push(`Release ${coordinate} does not exist`)
  else if (current.yankedAt) blockers.push(`Release ${coordinate} is already yanked`)
  return { subject: `release:${coordinate}`, blockers, current }
}

function impactDetails(
  state: MarketplaceStateV1,
  input: MarketplaceImpactRequest,
  at: string
): MarketplaceImpactDetails {
  switch (input.operation) {
    case 'publisher.status':
      return publisherStatusImpact(state, input)
    case 'publisher-key.status':
      return publisherKeyStatusImpact(state, input)
    case 'ownership.status':
      return ownershipStatusImpact(state, input)
    case 'submission.status':
      return submissionStatusImpact(state, input)
    case 'submission.publish':
      return submissionPublishImpact(state, input, at)
    case 'release.yank':
      return releaseYankImpact(state, input)
    case 'marketplace.publish':
      return {
        subject: 'publication:global',
        blockers: [],
        current: {
          releases: state.releases.length,
          publications: state.publications.length
        }
      }
  }
  throw new TypeError('Marketplace impact operation is not supported')
}

export async function createMarketplaceImpactPreview(
  state: MarketplaceStateV1,
  inputValue: MarketplaceImpactRequest,
  atValue: string
): Promise<MarketplaceImpactPreviewV1> {
  const input = normalizedRequest(inputValue)
  const at = parseMarketplaceTimestamp(atValue, 'impact.time')
  const token = stateToken(state)
  const details = impactDetails(state, input, at)
  const authorityDigest = await digestCanonicalManifest({
    schemaVersion: MARKETPLACE_IMPACT_SCHEMA_VERSION,
    input,
    subject: details.subject,
    ...token,
    current: details.current
  })
  return parseMarketplaceImpactPreview({
    schemaVersion: MARKETPLACE_IMPACT_SCHEMA_VERSION,
    operation: input.operation,
    subject: details.subject,
    authorityDigest,
    ...token,
    allowed: details.blockers.length === 0,
    blockers: details.blockers
  })
}

export async function assertMarketplaceImpactAuthority(
  state: MarketplaceStateV1,
  input: MarketplaceImpactRequest,
  at: string,
  expectedAuthorityDigest: string | undefined
): Promise<MarketplaceImpactPreviewV1> {
  const preview = await createMarketplaceImpactPreview(state, input, at)
  if (
    expectedAuthorityDigest !== undefined &&
    preview.authorityDigest !== expectedAuthorityDigest
  ) {
    throw new MarketplaceImpactAuthorityError(
      'Marketplace impact authority is stale or does not match this operation'
    )
  }
  if (preview.blockers.length > 0) {
    throw new MarketplaceImpactAuthorityError(preview.blockers.join('; '))
  }
  return preview
}
