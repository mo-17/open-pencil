/* eslint-disable max-lines -- Marketplace lifecycle mutations and transactional rollback share one state-machine boundary. */
import { importEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import {
  appendMarketplaceAuditEvent,
  marketplaceAuditHead,
  verifyMarketplaceAuditChain
} from './audit'
import {
  MARKETPLACE_LIMITS,
  MARKETPLACE_SCHEMA_VERSION,
  canTransitionMarketplaceOwnership,
  canTransitionMarketplacePublisher,
  canTransitionMarketplacePublisherKey,
  canTransitionMarketplaceSubmission,
  createEmptyMarketplaceState,
  marketplaceReleaseCoordinateKey,
  parseCreateMarketplaceSubmissionInput,
  parseCreateMarketplacePublisherInput,
  parseMarketplaceIdentity,
  parseMarketplacePublication,
  parseMarketplacePublisher,
  parseMarketplacePublisherKey,
  parseMarketplaceRelease,
  parseMarketplaceState,
  parseMarketplaceSubmission,
  parseRecordMarketplacePublicationInput,
  parseRegisterMarketplacePublisherKeyInput,
  parseRequestMarketplaceOwnershipInput,
  resolveMarketplaceMutationContext,
  type CreateMarketplacePublisherInput,
  type CreateMarketplaceSubmissionInput,
  type MarketplaceAuditAction,
  type MarketplaceAuditEventV1,
  type MarketplaceJsonValue,
  type MarketplaceMutationContext,
  type MarketplaceOwnershipStatus,
  type MarketplaceOwnershipV1,
  type MarketplacePublicationV1,
  type MarketplacePublisherKeyStatus,
  type MarketplacePublisherKeyV1,
  type MarketplacePublisherStatus,
  type MarketplacePublisherV1,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceReleaseV1,
  type MarketplaceStateV1,
  type MarketplaceSubmissionStatus,
  type MarketplaceSubmissionV1,
  type RecordMarketplacePublicationInput,
  type RegisterMarketplacePublisherKeyInput,
  type RequestMarketplaceOwnershipInput
} from './types'

export interface MarketplaceMutationResult<Value> {
  state: MarketplaceStateV1
  value: Value
}

export interface MarketplaceRepositoryCapacityLimits {
  maxPublishers: number
  maxPublisherKeys: number
  maxOwnerships: number
  maxSubmissions: number
  maxReleases: number
  maxPublications: number
  maxAuditEvents: number
}

export interface MarketplaceTransaction {
  snapshot(): MarketplaceStateV1
  createPublisher(
    input: CreateMarketplacePublisherInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  transitionPublisher(
    publisherId: string,
    status: MarketplacePublisherStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherV1>
  registerPublisherKey(
    input: RegisterMarketplacePublisherKeyInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherKeyV1>
  transitionPublisherKey(
    keyId: string,
    status: MarketplacePublisherKeyStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublisherKeyV1>
  requestOwnership(
    input: RequestMarketplaceOwnershipInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceOwnershipV1>
  transitionOwnership(
    pluginId: string,
    status: MarketplaceOwnershipStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceOwnershipV1>
  createSubmission(
    input: CreateMarketplaceSubmissionInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  transitionSubmission(
    submissionId: string,
    status: MarketplaceSubmissionStatus,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  publishSubmission(
    submissionId: string,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceReleaseV1>
  yankRelease(
    coordinate: MarketplaceReleaseCoordinateV1,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceReleaseV1>
  recordPublication(
    input: RecordMarketplacePublicationInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublicationV1>
}

export interface MarketplaceRepository {
  snapshot(): Promise<MarketplaceStateV1>
  transaction<Value>(
    operation: (transaction: MarketplaceTransaction) => Value | Promise<Value>
  ): Promise<Value>
}

export interface CreateMemoryMarketplaceRepositoryOptions {
  initialState?: unknown
  capacity?: Partial<MarketplaceRepositoryCapacityLimits>
}

const DEFAULT_CAPACITY: MarketplaceRepositoryCapacityLimits = Object.freeze({
  maxPublishers: MARKETPLACE_LIMITS.maxPublishers,
  maxPublisherKeys: MARKETPLACE_LIMITS.maxPublisherKeys,
  maxOwnerships: MARKETPLACE_LIMITS.maxOwnerships,
  maxSubmissions: MARKETPLACE_LIMITS.maxSubmissions,
  maxReleases: MARKETPLACE_LIMITS.maxReleases,
  maxPublications: MARKETPLACE_LIMITS.maxPublications,
  maxAuditEvents: MARKETPLACE_LIMITS.maxAuditEvents
})

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

function isolatedState(value: MarketplaceStateV1): MarketplaceStateV1 {
  return parseMarketplaceState(structuredClone(value))
}

function requireEntity<Value>(value: Value | undefined, label: string): Value {
  if (value === undefined) throw new TypeError(`${label} does not exist`)
  return value
}

function requireChronological(previous: string, next: string, path: string): void {
  if (Date.parse(next) < Date.parse(previous)) {
    throw new TypeError(`${path} must not move backwards`)
  }
}

function transitionReason(
  status: string,
  reasonedStatuses: ReadonlySet<string>,
  context: ReturnType<typeof resolveMarketplaceMutationContext>
): string | null {
  if (!reasonedStatuses.has(status)) return null
  if (!context.reason) throw new TypeError(`Transition to ${status} requires a reason`)
  return context.reason
}

function activePublisher(state: MarketplaceStateV1, publisherId: string): MarketplacePublisherV1 {
  const publisher = requireEntity(
    state.publishers.find(({ id }) => id === publisherId),
    `Publisher ${publisherId}`
  )
  if (publisher.status !== 'active') throw new TypeError(`Publisher ${publisherId} is not active`)
  return publisher
}

function activeOwnership(
  state: MarketplaceStateV1,
  pluginId: string,
  publisherId: string
): MarketplaceOwnershipV1 {
  const ownership = requireEntity(
    state.ownerships.find((candidate) => candidate.pluginId === pluginId),
    `Ownership for ${pluginId}`
  )
  if (ownership.publisherId !== publisherId) {
    throw new TypeError(`Plugin ownership cannot be transferred to another publisher`)
  }
  if (ownership.status !== 'active') throw new TypeError(`Ownership for ${pluginId} is not active`)
  return ownership
}

function stateWithAudit(
  parsed: MarketplaceStateV1,
  auditEvents: readonly MarketplaceAuditEventV1[]
): MarketplaceStateV1 {
  return Object.freeze({ ...parsed, auditEvents })
}

async function commitMutation<Value>(
  state: MarketplaceStateV1,
  changes: Partial<
    Pick<
      MarketplaceStateV1,
      'publishers' | 'publisherKeys' | 'ownerships' | 'submissions' | 'releases' | 'publications'
    >
  >,
  value: Value,
  audit: {
    action: MarketplaceAuditAction
    subject: string
    payload: MarketplaceJsonValue
    context: ReturnType<typeof resolveMarketplaceMutationContext>
  }
): Promise<MarketplaceMutationResult<Value>> {
  const appended = await appendMarketplaceAuditEvent(state.auditEvents, {
    time: audit.context.time,
    actor: audit.context.actor,
    action: audit.action,
    subject: audit.subject,
    payload: audit.payload
  })
  const parsed = parseMarketplaceState({
    ...state,
    ...changes,
    auditEvents: appended.events
  })
  return Object.freeze({ state: stateWithAudit(parsed, appended.events), value })
}

export async function createMarketplacePublisher(
  value: MarketplaceStateV1,
  inputValue: CreateMarketplacePublisherInput,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplacePublisherV1>> {
  const state = parseMarketplaceState(value)
  const input = parseCreateMarketplacePublisherInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  if (state.publishers.some(({ id }) => id === input.id)) {
    throw new TypeError(`Publisher ${input.id} already exists`)
  }
  const publisher = parseMarketplacePublisher({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    id: input.id,
    displayName: input.displayName,
    status: 'pending',
    createdAt: context.time,
    updatedAt: context.time,
    statusReason: null
  })
  return commitMutation(state, { publishers: [...state.publishers, publisher] }, publisher, {
    action: 'publisher.created',
    subject: `publisher:${publisher.id}`,
    payload: { publisherId: publisher.id, status: publisher.status },
    context
  })
}

export async function transitionMarketplacePublisher(
  value: MarketplaceStateV1,
  publisherIdValue: string,
  status: MarketplacePublisherStatus,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplacePublisherV1>> {
  const state = parseMarketplaceState(value)
  const publisherId = parseMarketplaceIdentity(publisherIdValue, 'publisherId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.publishers.find(({ id }) => id === publisherId),
    `Publisher ${publisherId}`
  )
  if (!canTransitionMarketplacePublisher(current.status, status)) {
    throw new TypeError(`Publisher cannot transition from ${current.status} to ${status}`)
  }
  requireChronological(current.updatedAt, context.time, 'publisher.updatedAt')
  if (
    status === 'active' &&
    !state.publisherKeys.some((key) => key.publisherId === publisherId && key.status === 'active')
  ) {
    throw new TypeError(`Publisher ${publisherId} requires an active public key`)
  }
  const next = parseMarketplacePublisher({
    ...current,
    status,
    updatedAt: context.time,
    statusReason: transitionReason(status, REASONED_PUBLISHER_STATUSES, context)
  })
  const publishers = state.publishers.map((publisher) =>
    publisher.id === publisherId ? next : publisher
  )
  return commitMutation(state, { publishers }, next, {
    action: 'publisher.status_changed',
    subject: `publisher:${publisherId}`,
    payload: { from: current.status, publisherId, reason: next.statusReason, to: status },
    context
  })
}

export async function registerMarketplacePublisherKey(
  value: MarketplaceStateV1,
  inputValue: RegisterMarketplacePublisherKeyInput,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplacePublisherKeyV1>> {
  const state = parseMarketplaceState(value)
  const input = parseRegisterMarketplacePublisherKeyInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  const publisher = requireEntity(
    state.publishers.find(({ id }) => id === input.publisherId),
    `Publisher ${input.publisherId}`
  )
  if (publisher.status === 'rejected' || publisher.status === 'suspended') {
    throw new TypeError(
      `Publisher ${input.publisherId} cannot register keys while ${publisher.status}`
    )
  }
  if (state.publisherKeys.some(({ keyId }) => keyId === input.keyId)) {
    throw new TypeError(`Publisher key ${input.keyId} already exists`)
  }
  if (input.predecessorKeyId) {
    const predecessor = requireEntity(
      state.publisherKeys.find(({ keyId }) => keyId === input.predecessorKeyId),
      `Predecessor key ${input.predecessorKeyId}`
    )
    if (predecessor.publisherId !== input.publisherId) {
      throw new TypeError(`Publisher key rotation cannot change publisher ownership`)
    }
    if (Date.parse(predecessor.notBefore) >= Date.parse(input.notBefore)) {
      throw new TypeError(`Publisher key rotation must advance notBefore`)
    }
  }
  await importEd25519PublicKeyPem(input.publicKeyPem)
  const key = parseMarketplacePublisherKey({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    keyId: input.keyId,
    publisherId: input.publisherId,
    publicKeyPem: input.publicKeyPem,
    notBefore: input.notBefore,
    notAfter: input.notAfter,
    predecessorKeyId: input.predecessorKeyId ?? null,
    status: 'pending',
    createdAt: context.time,
    updatedAt: context.time,
    statusReason: null,
    revokedAt: null,
    revocationReason: null
  })
  return commitMutation(state, { publisherKeys: [...state.publisherKeys, key] }, key, {
    action: 'publisher_key.registered',
    subject: `publisher-key:${key.keyId}`,
    payload: {
      keyId: key.keyId,
      notAfter: key.notAfter,
      notBefore: key.notBefore,
      predecessorKeyId: key.predecessorKeyId,
      publisherId: key.publisherId
    },
    context
  })
}

export async function transitionMarketplacePublisherKey(
  value: MarketplaceStateV1,
  keyIdValue: string,
  status: MarketplacePublisherKeyStatus,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplacePublisherKeyV1>> {
  const state = parseMarketplaceState(value)
  const keyId = parseMarketplaceIdentity(keyIdValue, 'keyId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.publisherKeys.find((key) => key.keyId === keyId),
    `Publisher key ${keyId}`
  )
  if (!canTransitionMarketplacePublisherKey(current.status, status)) {
    throw new TypeError(`Publisher key cannot transition from ${current.status} to ${status}`)
  }
  requireChronological(current.updatedAt, context.time, 'publisherKey.updatedAt')
  const publisher = requireEntity(
    state.publishers.find(({ id }) => id === current.publisherId),
    `Publisher ${current.publisherId}`
  )
  if (
    status === 'active' &&
    (publisher.status === 'rejected' || publisher.status === 'suspended')
  ) {
    throw new TypeError(`Publisher ${publisher.id} cannot activate keys while ${publisher.status}`)
  }
  const reason = transitionReason(status, REASONED_PUBLISHER_KEY_STATUSES, context)
  const next = parseMarketplacePublisherKey({
    ...current,
    status,
    updatedAt: context.time,
    statusReason: status === 'rejected' ? reason : null,
    revokedAt: status === 'revoked' ? context.time : null,
    revocationReason: status === 'revoked' ? reason : null
  })
  const publisherKeys = state.publisherKeys.map((key) => (key.keyId === keyId ? next : key))
  return commitMutation(state, { publisherKeys }, next, {
    action: 'publisher_key.status_changed',
    subject: `publisher-key:${keyId}`,
    payload: {
      from: current.status,
      keyId,
      publisherId: current.publisherId,
      reason,
      to: status
    },
    context
  })
}

export async function requestMarketplaceOwnership(
  value: MarketplaceStateV1,
  inputValue: RequestMarketplaceOwnershipInput,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceOwnershipV1>> {
  const state = parseMarketplaceState(value)
  const input = parseRequestMarketplaceOwnershipInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  if (state.ownerships.some(({ pluginId }) => pluginId === input.pluginId)) {
    throw new TypeError(
      `Plugin ${input.pluginId} already has immutable ownership and cannot be transferred`
    )
  }
  activePublisher(state, input.publisherId)
  const ownership = Object.freeze({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    pluginId: input.pluginId,
    publisherId: input.publisherId,
    status: 'requested' as const,
    requestedAt: context.time,
    updatedAt: context.time,
    statusReason: null
  })
  const parsedState = parseMarketplaceState({
    ...state,
    ownerships: [...state.ownerships, ownership]
  })
  const parsedOwnership = requireEntity(
    parsedState.ownerships.find(({ pluginId }) => pluginId === ownership.pluginId),
    `Ownership for ${ownership.pluginId}`
  )
  return commitMutation(
    state,
    { ownerships: [...state.ownerships, parsedOwnership] },
    parsedOwnership,
    {
      action: 'ownership.requested',
      subject: `ownership:${ownership.pluginId}`,
      payload: { pluginId: ownership.pluginId, publisherId: ownership.publisherId },
      context
    }
  )
}

export async function transitionMarketplaceOwnership(
  value: MarketplaceStateV1,
  pluginIdValue: string,
  status: MarketplaceOwnershipStatus,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceOwnershipV1>> {
  const state = parseMarketplaceState(value)
  const pluginId = parseMarketplaceIdentity(pluginIdValue, 'pluginId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.ownerships.find((ownership) => ownership.pluginId === pluginId),
    `Ownership for ${pluginId}`
  )
  if (!canTransitionMarketplaceOwnership(current.status, status)) {
    throw new TypeError(`Ownership cannot transition from ${current.status} to ${status}`)
  }
  requireChronological(current.updatedAt, context.time, 'ownership.updatedAt')
  if (status === 'active') activePublisher(state, current.publisherId)
  const reason = transitionReason(status, REASONED_OWNERSHIP_STATUSES, context)
  const next = Object.freeze({
    ...current,
    status,
    updatedAt: context.time,
    statusReason: reason
  })
  const parsedState = parseMarketplaceState({
    ...state,
    ownerships: state.ownerships.map((ownership) =>
      ownership.pluginId === pluginId ? next : ownership
    )
  })
  const parsedOwnership = requireEntity(
    parsedState.ownerships.find((ownership) => ownership.pluginId === pluginId),
    `Ownership for ${pluginId}`
  )
  return commitMutation(
    state,
    {
      ownerships: state.ownerships.map((ownership) =>
        ownership.pluginId === pluginId ? parsedOwnership : ownership
      )
    },
    parsedOwnership,
    {
      action: 'ownership.status_changed',
      subject: `ownership:${pluginId}`,
      payload: {
        from: current.status,
        pluginId,
        publisherId: current.publisherId,
        reason,
        to: status
      },
      context
    }
  )
}

export async function createMarketplaceSubmission(
  value: MarketplaceStateV1,
  inputValue: CreateMarketplaceSubmissionInput,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceSubmissionV1>> {
  const state = parseMarketplaceState(value)
  const input = parseCreateMarketplaceSubmissionInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  activePublisher(state, input.publisherId)
  activeOwnership(state, input.coordinate.pluginId, input.publisherId)
  if (
    !state.publisherKeys.some(
      (key) => key.publisherId === input.publisherId && key.status === 'active'
    )
  ) {
    throw new TypeError(`Publisher ${input.publisherId} has no active signing key`)
  }
  if (state.submissions.some(({ id }) => id === input.id)) {
    throw new TypeError(`Submission ${input.id} already exists`)
  }
  const coordinateKey = marketplaceReleaseCoordinateKey(input.coordinate)
  if (
    state.submissions.some(
      ({ coordinate }) => marketplaceReleaseCoordinateKey(coordinate) === coordinateKey
    )
  ) {
    throw new TypeError(`Release coordinate ${coordinateKey} already has a submission`)
  }
  const submission = parseMarketplaceSubmission({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    id: input.id,
    publisherId: input.publisherId,
    coordinate: input.coordinate,
    manifestDigest: input.manifestDigest,
    artifactDigest: input.artifactDigest,
    manifestUrl: input.manifestUrl,
    listing: input.listing,
    runtimeCoordinate: input.runtimeCoordinate ?? null,
    status: 'submitted',
    submittedAt: context.time,
    updatedAt: context.time,
    statusReason: null
  })
  return commitMutation(state, { submissions: [...state.submissions, submission] }, submission, {
    action: 'submission.created',
    subject: `submission:${submission.id}`,
    payload: {
      artifactDigest: submission.artifactDigest,
      coordinate: coordinateKey,
      manifestDigest: submission.manifestDigest,
      publisherId: submission.publisherId,
      runtimePackageDigest: submission.runtimeCoordinate?.packageDigest ?? null,
      submissionId: submission.id
    },
    context
  })
}

async function transitionSubmissionOnly(
  state: MarketplaceStateV1,
  current: MarketplaceSubmissionV1,
  status: Exclude<MarketplaceSubmissionStatus, 'published' | 'yanked'>,
  context: ReturnType<typeof resolveMarketplaceMutationContext>
): Promise<MarketplaceMutationResult<MarketplaceSubmissionV1>> {
  if (!canTransitionMarketplaceSubmission(current.status, status)) {
    throw new TypeError(`Submission cannot transition from ${current.status} to ${status}`)
  }
  requireChronological(current.updatedAt, context.time, 'submission.updatedAt')
  if (status === 'approved') {
    activePublisher(state, current.publisherId)
    activeOwnership(state, current.coordinate.pluginId, current.publisherId)
  }
  const reason = transitionReason(status, REASONED_SUBMISSION_STATUSES, context)
  const next = parseMarketplaceSubmission({
    ...current,
    status,
    updatedAt: context.time,
    statusReason: reason
  })
  const submissions = state.submissions.map((submission) =>
    submission.id === current.id ? next : submission
  )
  return commitMutation(state, { submissions }, next, {
    action: 'submission.status_changed',
    subject: `submission:${current.id}`,
    payload: {
      from: current.status,
      reason,
      submissionId: current.id,
      to: status
    },
    context
  })
}

export async function publishMarketplaceSubmission(
  value: MarketplaceStateV1,
  submissionIdValue: string,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceReleaseV1>> {
  const state = parseMarketplaceState(value)
  const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submissionId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.submissions.find(({ id }) => id === submissionId),
    `Submission ${submissionId}`
  )
  if (!canTransitionMarketplaceSubmission(current.status, 'published')) {
    throw new TypeError(`Submission cannot transition from ${current.status} to published`)
  }
  requireChronological(current.updatedAt, context.time, 'submission.updatedAt')
  activePublisher(state, current.publisherId)
  activeOwnership(state, current.coordinate.pluginId, current.publisherId)
  const coordinateKey = marketplaceReleaseCoordinateKey(current.coordinate)
  if (
    state.releases.some(
      ({ coordinate }) => marketplaceReleaseCoordinateKey(coordinate) === coordinateKey
    )
  ) {
    throw new TypeError(`Release ${coordinateKey} already exists and cannot be replaced`)
  }
  const submission = parseMarketplaceSubmission({
    ...current,
    status: 'published',
    updatedAt: context.time,
    statusReason: null
  })
  const release = parseMarketplaceRelease({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    coordinate: submission.coordinate,
    submissionId,
    publisherId: submission.publisherId,
    manifestDigest: submission.manifestDigest,
    artifactDigest: submission.artifactDigest,
    manifestUrl: submission.manifestUrl,
    runtimeCoordinate: submission.runtimeCoordinate,
    publishedAt: context.time,
    yankedAt: null,
    yankReason: null
  })
  return commitMutation(
    state,
    {
      submissions: state.submissions.map((candidate) =>
        candidate.id === submissionId ? submission : candidate
      ),
      releases: [...state.releases, release]
    },
    release,
    {
      action: 'release.published',
      subject: `release:${coordinateKey}`,
      payload: {
        artifactDigest: release.artifactDigest,
        coordinate: coordinateKey,
        manifestDigest: release.manifestDigest,
        submissionId
      },
      context
    }
  )
}

export async function yankMarketplaceRelease(
  value: MarketplaceStateV1,
  coordinateValue: MarketplaceReleaseCoordinateV1,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceReleaseV1>> {
  const state = parseMarketplaceState(value)
  const coordinateKey = marketplaceReleaseCoordinateKey(coordinateValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  if (!context.reason) throw new TypeError('Yanking a release requires a reason')
  const currentRelease = requireEntity(
    state.releases.find(
      ({ coordinate }) => marketplaceReleaseCoordinateKey(coordinate) === coordinateKey
    ),
    `Release ${coordinateKey}`
  )
  if (currentRelease.yankedAt) throw new TypeError(`Release ${coordinateKey} is already yanked`)
  const currentSubmission = requireEntity(
    state.submissions.find(({ id }) => id === currentRelease.submissionId),
    `Submission ${currentRelease.submissionId}`
  )
  if (!canTransitionMarketplaceSubmission(currentSubmission.status, 'yanked')) {
    throw new TypeError(`Submission cannot transition from ${currentSubmission.status} to yanked`)
  }
  requireChronological(currentRelease.publishedAt, context.time, 'release.yankedAt')
  const submission = parseMarketplaceSubmission({
    ...currentSubmission,
    status: 'yanked',
    updatedAt: context.time,
    statusReason: context.reason
  })
  const release = parseMarketplaceRelease({
    ...currentRelease,
    yankedAt: context.time,
    yankReason: context.reason
  })
  return commitMutation(
    state,
    {
      submissions: state.submissions.map((candidate) =>
        candidate.id === submission.id ? submission : candidate
      ),
      releases: state.releases.map((candidate) =>
        marketplaceReleaseCoordinateKey(candidate.coordinate) === coordinateKey
          ? release
          : candidate
      )
    },
    release,
    {
      action: 'release.yanked',
      subject: `release:${coordinateKey}`,
      payload: {
        coordinate: coordinateKey,
        reason: context.reason,
        submissionId: submission.id
      },
      context
    }
  )
}

export async function transitionMarketplaceSubmission(
  value: MarketplaceStateV1,
  submissionIdValue: string,
  status: MarketplaceSubmissionStatus,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceSubmissionV1>> {
  if (status === 'published') {
    const result = await publishMarketplaceSubmission(value, submissionIdValue, contextValue)
    const submission = requireEntity(
      result.state.submissions.find(({ id }) => id === submissionIdValue),
      `Submission ${submissionIdValue}`
    )
    return Object.freeze({ state: result.state, value: submission })
  }
  if (status === 'yanked') {
    const state = parseMarketplaceState(value)
    const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submissionId')
    const submission = requireEntity(
      state.submissions.find(({ id }) => id === submissionId),
      `Submission ${submissionId}`
    )
    const result = await yankMarketplaceRelease(state, submission.coordinate, contextValue)
    const next = requireEntity(
      result.state.submissions.find(({ id }) => id === submissionId),
      `Submission ${submissionId}`
    )
    return Object.freeze({ state: result.state, value: next })
  }
  const state = parseMarketplaceState(value)
  const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submissionId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.submissions.find(({ id }) => id === submissionId),
    `Submission ${submissionId}`
  )
  return transitionSubmissionOnly(state, current, status, context)
}

export async function recordMarketplacePublication(
  value: MarketplaceStateV1,
  inputValue: RecordMarketplacePublicationInput,
  contextValue: MarketplaceMutationContext,
  retentionLimit: number = MARKETPLACE_LIMITS.maxPublications
): Promise<MarketplaceMutationResult<MarketplacePublicationV1>> {
  const state = parseMarketplaceState(value)
  const input = parseRecordMarketplacePublicationInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  if (!Number.isSafeInteger(retentionLimit) || retentionLimit <= 0) {
    throw new TypeError('publication retentionLimit must be a positive safe integer')
  }
  const previous = state.publications.at(-1)
  if (previous) requireChronological(previous.publishedAt, context.time, 'publication.publishedAt')
  const publication = parseMarketplacePublication({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    sequence: (previous?.sequence ?? 0) + 1,
    snapshotDigest: input.snapshotDigest,
    snapshotArtifactDigest: input.snapshotArtifactDigest,
    catalogs: input.catalogs,
    runtimeIndexDigest: input.runtimeIndexDigest ?? null,
    runtimeIndexArtifactDigest: input.runtimeIndexArtifactDigest ?? null,
    auditSequence: state.auditEvents.length,
    auditHead: marketplaceAuditHead(state.auditEvents),
    publishedAt: context.time
  })
  const publications = [...state.publications, publication].slice(-retentionLimit)
  return commitMutation(state, { publications }, publication, {
    action: 'publication.recorded',
    subject: 'publication:global',
    payload: {
      auditHead: publication.auditHead,
      auditSequence: publication.auditSequence,
      sequence: publication.sequence,
      snapshotArtifactDigest: publication.snapshotArtifactDigest,
      snapshotDigest: publication.snapshotDigest
    },
    context
  })
}

function boundedCapacity(
  value: unknown,
  fallback: number,
  globalMaximum: number,
  path: string
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > globalMaximum) {
    throw new TypeError(`${path} must be a positive safe integer no larger than ${globalMaximum}`)
  }
  return value as number
}

function resolveCapacity(
  value: Partial<MarketplaceRepositoryCapacityLimits> | undefined
): MarketplaceRepositoryCapacityLimits {
  return Object.freeze({
    maxPublishers: boundedCapacity(
      value?.maxPublishers,
      DEFAULT_CAPACITY.maxPublishers,
      MARKETPLACE_LIMITS.maxPublishers,
      'capacity.maxPublishers'
    ),
    maxPublisherKeys: boundedCapacity(
      value?.maxPublisherKeys,
      DEFAULT_CAPACITY.maxPublisherKeys,
      MARKETPLACE_LIMITS.maxPublisherKeys,
      'capacity.maxPublisherKeys'
    ),
    maxOwnerships: boundedCapacity(
      value?.maxOwnerships,
      DEFAULT_CAPACITY.maxOwnerships,
      MARKETPLACE_LIMITS.maxOwnerships,
      'capacity.maxOwnerships'
    ),
    maxSubmissions: boundedCapacity(
      value?.maxSubmissions,
      DEFAULT_CAPACITY.maxSubmissions,
      MARKETPLACE_LIMITS.maxSubmissions,
      'capacity.maxSubmissions'
    ),
    maxReleases: boundedCapacity(
      value?.maxReleases,
      DEFAULT_CAPACITY.maxReleases,
      MARKETPLACE_LIMITS.maxReleases,
      'capacity.maxReleases'
    ),
    maxPublications: boundedCapacity(
      value?.maxPublications,
      DEFAULT_CAPACITY.maxPublications,
      MARKETPLACE_LIMITS.maxPublications,
      'capacity.maxPublications'
    ),
    maxAuditEvents: boundedCapacity(
      value?.maxAuditEvents,
      DEFAULT_CAPACITY.maxAuditEvents,
      MARKETPLACE_LIMITS.maxAuditEvents,
      'capacity.maxAuditEvents'
    )
  })
}

function assertCapacity(
  state: MarketplaceStateV1,
  capacity: MarketplaceRepositoryCapacityLimits
): void {
  const counts: readonly [keyof MarketplaceRepositoryCapacityLimits, number][] = [
    ['maxPublishers', state.publishers.length],
    ['maxPublisherKeys', state.publisherKeys.length],
    ['maxOwnerships', state.ownerships.length],
    ['maxSubmissions', state.submissions.length],
    ['maxReleases', state.releases.length],
    ['maxPublications', state.publications.length],
    ['maxAuditEvents', state.auditEvents.length]
  ]
  for (const [key, count] of counts) {
    if (count > capacity[key]) throw new RangeError(`Marketplace repository exceeded ${key}`)
  }
}

async function verifyPublisherKeyMaterial(state: MarketplaceStateV1): Promise<void> {
  for (const key of state.publisherKeys) await importEd25519PublicKeyPem(key.publicKeyPem)
}

function marketplaceMutationError(value: unknown): Error {
  if (value instanceof Error) return value
  return typeof value === 'string'
    ? new Error(value)
    : new Error('Marketplace transaction mutation failed')
}

function createTransaction(
  initialState: MarketplaceStateV1,
  capacity: MarketplaceRepositoryCapacityLimits
): MarketplaceTransaction & {
  close(): Promise<MarketplaceStateV1>
  abort(): Promise<void>
} {
  let state = initialState
  let active = true
  let mutationTail: Promise<void> = Promise.resolve()
  let mutationFailure: unknown = null

  function assertActive(): void {
    if (!active) throw new Error('Marketplace transaction is no longer active')
  }

  function mutate<Value>(
    operation: (current: MarketplaceStateV1) => Promise<MarketplaceMutationResult<Value>>
  ): Promise<Value> {
    assertActive()
    const running = mutationTail.then(async () => {
      const result = await operation(state)
      assertCapacity(result.state, capacity)
      state = result.state
      return result.value
    })
    mutationTail = running.then(
      () => undefined,
      (error) => {
        mutationFailure ??= error
      }
    )
    return running.then((value) => structuredClone(value))
  }

  const transaction: MarketplaceTransaction & {
    close(): Promise<MarketplaceStateV1>
    abort(): Promise<void>
  } = {
    snapshot() {
      assertActive()
      return isolatedState(state)
    },
    createPublisher(input, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        createMarketplacePublisher(current, isolatedInput, isolatedContext)
      )
    },
    transitionPublisher(publisherId, status, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        transitionMarketplacePublisher(current, publisherId, status, isolatedContext)
      )
    },
    registerPublisherKey(input, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        registerMarketplacePublisherKey(current, isolatedInput, isolatedContext)
      )
    },
    transitionPublisherKey(keyId, status, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        transitionMarketplacePublisherKey(current, keyId, status, isolatedContext)
      )
    },
    requestOwnership(input, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        requestMarketplaceOwnership(current, isolatedInput, isolatedContext)
      )
    },
    transitionOwnership(pluginId, status, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        transitionMarketplaceOwnership(current, pluginId, status, isolatedContext)
      )
    },
    createSubmission(input, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        createMarketplaceSubmission(current, isolatedInput, isolatedContext)
      )
    },
    transitionSubmission(submissionId, status, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        transitionMarketplaceSubmission(current, submissionId, status, isolatedContext)
      )
    },
    publishSubmission(submissionId, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        publishMarketplaceSubmission(current, submissionId, isolatedContext)
      )
    },
    yankRelease(coordinate, context) {
      const isolatedCoordinate = structuredClone(coordinate)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        yankMarketplaceRelease(current, isolatedCoordinate, isolatedContext)
      )
    },
    recordPublication(input, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        recordMarketplacePublication(
          current,
          isolatedInput,
          isolatedContext,
          capacity.maxPublications
        )
      )
    },
    async close() {
      assertActive()
      active = false
      await mutationTail
      if (mutationFailure) throw marketplaceMutationError(mutationFailure)
      return state
    },
    async abort() {
      if (!active) return
      active = false
      await mutationTail
    }
  }
  return transaction
}

export function createMemoryMarketplaceRepository(
  options: CreateMemoryMarketplaceRepositoryOptions = {}
): MarketplaceRepository {
  const capacity = resolveCapacity(options.capacity)
  let state =
    options.initialState === undefined
      ? createEmptyMarketplaceState()
      : parseMarketplaceState(options.initialState)
  assertCapacity(state, capacity)
  const initialization = Promise.all([
    verifyMarketplaceAuditChain(state.auditEvents),
    verifyPublisherKeyMaterial(state)
  ]).then(() => undefined)
  let queue: Promise<void> = Promise.resolve()

  function enqueue<Value>(operation: () => Promise<Value>): Promise<Value> {
    const running = queue.then(async () => {
      await initialization
      return operation()
    })
    queue = running.then(
      () => undefined,
      () => undefined
    )
    return running
  }

  return {
    snapshot() {
      return enqueue(async () => isolatedState(state))
    },
    transaction(operation) {
      return enqueue(async () => {
        const transaction = createTransaction(state, capacity)
        let result: Awaited<ReturnType<typeof operation>>
        try {
          result = await operation(transaction)
          const next = await transaction.close()
          state = next
        } catch (error) {
          await transaction.abort()
          throw error
        }
        return structuredClone(result)
      })
    }
  }
}
