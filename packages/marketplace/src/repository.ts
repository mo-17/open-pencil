/* eslint-disable max-lines -- Marketplace lifecycle mutations and transactional rollback share one state-machine boundary. */
import {
  canonicalManifestJSON,
  importEd25519PublicKeyPem,
  parseSha256Base64URL
} from '@open-pencil/scene-graph'

import {
  appendMarketplaceAuditEvent,
  marketplaceAuditHead,
  verifyMarketplaceAuditChain
} from './audit'
import {
  MARKETPLACE_NONCE_NAMESPACES,
  type MarketplaceNonceNamespace,
  type MarketplaceNonceStore
} from './auth'
import {
  MarketplacePublicationCompletionConflictError,
  MarketplacePublicationQuiescedError,
  MarketplacePublicationReservationConflictError,
  assertMarketplacePublicationCompletionReceiptState,
  assertMarketplacePublicationReservationCompletion,
  assertMarketplacePublicationReservationState,
  createMarketplacePublicationCompletionReceipt,
  parseMarketplacePublicationCompletionReceipt,
  parseMarketplacePublicationReservation,
  sameMarketplacePublicationReservation,
  type MarketplacePublicationCompletionExecution,
  type MarketplacePublicationCompletionReceiptV1,
  type MarketplacePublicationReservationExecution,
  type MarketplacePublicationReservationV1
} from './publication/reservation'
import {
  MARKETPLACE_PUBLISHER_MUTATION_LIMITS,
  MarketplacePublisherMutationCommitPlan,
  MarketplacePublisherMutationCapacityError,
  MarketplacePublisherMutationConflictError,
  MarketplacePublisherMutationTerminalError,
  createMarketplacePublisherMutationTerminalResponse,
  parseMarketplacePublisherMutationResponse,
  parseMarketplacePublisherMutationSuccessResponse,
  parseMarketplaceVerifiedPublisherMutationRequest,
  sameMarketplacePublisherMutationRequest,
  type MarketplacePublisherMutationExecution,
  type MarketplacePublisherMutationReceipt,
  type MarketplacePublisherMutationResponse,
  type MarketplacePublisherMutationSuccessResponse,
  type MarketplaceVerifiedPublisherMutationRequest
} from './publisher/idempotency'
import { findActiveMarketplacePublisherKey } from './publisher/trust'
import {
  MARKETPLACE_LIMITS,
  MARKETPLACE_SCHEMA_VERSION,
  canTransitionMarketplaceOwnership,
  canTransitionMarketplacePublisher,
  canTransitionMarketplacePublisherKey,
  canTransitionMarketplaceSubmission,
  createEmptyMarketplaceState,
  marketplacePublisherPublicKeyDigest,
  marketplaceReleaseCoordinateKey,
  marketplaceSubmissionRevisionPayloadDigest,
  parseCreateMarketplaceSubmissionInput,
  parseCreateMarketplacePublisherInput,
  parseMarketplaceIdentity,
  parseMarketplaceOwnership,
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
  type MarketplaceJSONValue,
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

export {
  MarketplacePublicationCompletionConflictError,
  MarketplacePublicationQuiescedError,
  MarketplacePublicationReservationConflictError,
  assertMarketplacePublicationCompletionReceiptState,
  assertMarketplacePublicationReservationCompletion,
  assertMarketplacePublicationReservationState,
  createMarketplacePublicationCompletionReceipt,
  parseMarketplacePublicationCompletionReceipt,
  parseMarketplacePublicationReservation,
  sameMarketplacePublicationReservation,
  type MarketplacePublicationCompletionExecution,
  type MarketplacePublicationCompletionReceiptV1,
  type MarketplacePublicationReservationExecution,
  type MarketplacePublicationReservationV1
} from './publication/reservation'

export interface MarketplaceMutationResult<Value> {
  state: MarketplaceStateV1
  value: Value
}

export interface MarketplacePublisherMutationAuthority {
  readonly publisherId: string
  readonly keyId: string
}

export class MarketplacePublisherMutationAuthorityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MarketplacePublisherMutationAuthorityError'
  }
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
  reviseSubmission(
    input: CreateMarketplaceSubmissionInput,
    expectedRevision: number,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceSubmissionV1>
  pinLegacySubmissionSigningKey(
    submissionId: string,
    signingKeyId: string,
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

export interface MarketplacePublicationCompletionTransaction {
  snapshot(): MarketplaceStateV1
  recordPublication(
    input: RecordMarketplacePublicationInput,
    context: MarketplaceMutationContext
  ): Promise<MarketplacePublicationV1>
}

export interface MarketplaceRepository {
  readonly nonces: MarketplaceNonceStore
  snapshot(): Promise<MarketplaceStateV1>
  /**
   * Returns a deeply immutable, fully verified committed state for trusted
   * read-only projections. The snapshot may remain at the previous committed
   * state while a transaction is in progress, but must never expose uncommitted
   * or mutable repository state.
   */
  immutableSnapshot?(): Promise<MarketplaceStateV1>
  transaction<Value>(
    operation: (transaction: MarketplaceTransaction) => Value | Promise<Value>
  ): Promise<Value>
  inspectPublisherMutation(
    request: MarketplaceVerifiedPublisherMutationRequest,
    currentTime: number
  ): Promise<MarketplacePublisherMutationExecution | null>
  executePublisherMutation(
    request: MarketplaceVerifiedPublisherMutationRequest,
    currentTime: number,
    operation: (
      transaction: MarketplaceTransaction
    ) =>
      | MarketplacePublisherMutationCommitPlan
      | MarketplacePublisherMutationSuccessResponse
      | Promise<
          MarketplacePublisherMutationCommitPlan | MarketplacePublisherMutationSuccessResponse
        >
  ): Promise<MarketplacePublisherMutationExecution>
}

export interface MarketplacePublicationReservationRepository extends MarketplaceRepository {
  inspectPublicationReservation(): Promise<MarketplacePublicationReservationV1 | null>
  inspectPublicationCompletion(
    requestDigest: string,
    bundleDigest: string
  ): Promise<MarketplacePublicationCompletionReceiptV1 | null>
  reservePublication(
    reservation: MarketplacePublicationReservationV1
  ): Promise<MarketplacePublicationReservationExecution>
  completePublication(
    reservation: MarketplacePublicationReservationV1,
    bundleDigest: string,
    operation: (
      transaction: MarketplacePublicationCompletionTransaction
    ) => MarketplacePublicationV1 | Promise<MarketplacePublicationV1>
  ): Promise<MarketplacePublicationCompletionExecution>
  cancelPublication(
    reservation: MarketplacePublicationReservationV1,
    confirmedRequestDigest: string,
    context: MarketplaceMutationContext
  ): Promise<MarketplaceAuditEventV1>
}

export interface CreateMemoryMarketplaceRepositoryOptions {
  initialState?: unknown
  capacity?: Partial<MarketplaceRepositoryCapacityLimits>
  now?: () => number
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

function activeSigningKey(
  state: MarketplaceStateV1,
  publisherId: string,
  keyId: string,
  at: string
): MarketplacePublisherKeyV1 {
  const key = findActiveMarketplacePublisherKey(state, publisherId, keyId, Date.parse(at))
  if (!key) {
    throw new TypeError(`Publisher key ${keyId} is not active for ${publisherId}`)
  }
  return key
}

/**
 * Rechecks the exact Publisher request authority against transaction-local state.
 * Call this only after entering the repository transaction that owns the mutation.
 */
export function assertActiveMarketplacePublisherMutationAuthority(
  state: MarketplaceStateV1,
  authority: MarketplacePublisherMutationAuthority,
  expectedPublisherIdValue: string,
  at: string
): void {
  const publisherId = parseMarketplaceIdentity(authority.publisherId, 'authenticated publisher id')
  const keyId = parseMarketplaceIdentity(authority.keyId, 'authenticated publisher key id')
  const expectedPublisherId = parseMarketplaceIdentity(
    expectedPublisherIdValue,
    'publisher mutation publisher id'
  )
  if (publisherId !== expectedPublisherId) {
    throw new MarketplacePublisherMutationAuthorityError(
      'Authenticated publisher does not match the Publisher mutation target'
    )
  }
  try {
    activePublisher(state, publisherId)
    activeSigningKey(state, publisherId, keyId, at)
  } catch (cause) {
    throw new MarketplacePublisherMutationAuthorityError(
      'Authenticated Publisher mutation authority is no longer active',
      { cause }
    )
  }
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
    payload: MarketplaceJSONValue
    context: ReturnType<typeof resolveMarketplaceMutationContext>
  }
): Promise<MarketplaceMutationResult<Value>> {
  const appended = await appendMarketplaceAuditEvent(state.auditEvents, {
    time: audit.context.time,
    actor: audit.context.actor,
    action: audit.action,
    subject: audit.subject,
    payload: audit.payload,
    ...(audit.context.reason === null && audit.context.correlationId === null
      ? {}
      : {
          context: {
            reason: audit.context.reason,
            correlationId: audit.context.correlationId
          }
        })
  })
  const parsed = parseMarketplaceState({
    ...state,
    ...changes,
    auditEvents: appended.events,
    auditContexts:
      appended.context === null ? state.auditContexts : [...state.auditContexts, appended.context]
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
  if (input.id === 'admin-assertion-v1' || input.id === 'admin-assertion-v2') {
    throw new TypeError('Publisher id is reserved for a Marketplace authority namespace')
  }
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
    payload: {
      displayName: publisher.displayName,
      publisherId: publisher.id,
      status: publisher.status
    },
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
      publicKeyDigest: marketplacePublisherPublicKeyDigest(key.publicKeyPem),
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
  const ownership = parseMarketplaceOwnership({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    pluginId: input.pluginId,
    publisherId: input.publisherId,
    status: 'requested' as const,
    requestedAt: context.time,
    updatedAt: context.time,
    statusReason: null
  })
  return commitMutation(state, { ownerships: [...state.ownerships, ownership] }, ownership, {
    action: 'ownership.requested',
    subject: `ownership:${ownership.pluginId}`,
    payload: { pluginId: ownership.pluginId, publisherId: ownership.publisherId },
    context
  })
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
  const next = parseMarketplaceOwnership({
    ...current,
    status,
    updatedAt: context.time,
    statusReason: reason
  })
  return commitMutation(
    state,
    {
      ownerships: state.ownerships.map((ownership) =>
        ownership.pluginId === pluginId ? next : ownership
      )
    },
    next,
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
  activeSigningKey(state, input.publisherId, input.signingKeyId, context.time)
  activeSigningKey(state, input.publisherId, input.authenticatedRequestKeyId, context.time)
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
    listingDigest: input.listingDigest,
    runtimeCoordinate: input.runtimeCoordinate ?? null,
    signingKeyId: input.signingKeyId,
    authenticatedRequestKeyId: input.authenticatedRequestKeyId,
    revision: 1,
    revisionCreatedAt: context.time,
    revisionHistory: [],
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
      authenticatedRequestKeyId: submission.authenticatedRequestKeyId,
      coordinate: coordinateKey,
      manifestDigest: submission.manifestDigest,
      listingDigest: submission.listingDigest,
      publisherId: submission.publisherId,
      revision: submission.revision,
      revisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(submission),
      signingKeyId: submission.signingKeyId,
      runtimePackageDigest: submission.runtimeCoordinate?.packageDigest ?? null,
      submissionId: submission.id
    },
    context
  })
}

export async function reviseMarketplaceSubmission(
  value: MarketplaceStateV1,
  inputValue: CreateMarketplaceSubmissionInput,
  expectedRevisionValue: number,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceSubmissionV1>> {
  const state = parseMarketplaceState(value)
  const input = parseCreateMarketplaceSubmissionInput(inputValue)
  const context = resolveMarketplaceMutationContext(contextValue)
  if (
    !Number.isSafeInteger(expectedRevisionValue) ||
    expectedRevisionValue < 1 ||
    expectedRevisionValue >= MARKETPLACE_LIMITS.maxSubmissionRevisions
  ) {
    throw new TypeError('expectedRevision must identify a revisable positive revision')
  }
  const current = requireEntity(
    state.submissions.find(({ id }) => id === input.id),
    `Submission ${input.id}`
  )
  if (current.publisherId !== input.publisherId) {
    throw new TypeError('Submission does not belong to the authenticated publisher')
  }
  if (
    marketplaceReleaseCoordinateKey(current.coordinate) !==
    marketplaceReleaseCoordinateKey(input.coordinate)
  ) {
    throw new TypeError('Submission revision cannot change its release coordinate')
  }
  if (current.revision !== expectedRevisionValue) {
    throw new TypeError('Submission revision changed before the update was committed')
  }
  if (current.status !== 'validation_failed' && current.status !== 'changes_requested') {
    throw new TypeError(`Submission cannot be revised from ${current.status}`)
  }
  if (!current.statusReason) {
    throw new TypeError('Revisable submissions must preserve their review reason')
  }
  requireChronological(current.updatedAt, context.time, 'submission.updatedAt')
  activePublisher(state, input.publisherId)
  activeOwnership(state, input.coordinate.pluginId, input.publisherId)
  activeSigningKey(state, input.publisherId, input.signingKeyId, context.time)
  activeSigningKey(state, input.publisherId, input.authenticatedRequestKeyId, context.time)
  if (input.manifestDigest === current.manifestDigest) {
    throw new TypeError('Submission revision must use a newly signed manifest')
  }
  const previousRevision = {
    revision: current.revision,
    signingKeyId: current.signingKeyId,
    authenticatedRequestKeyId: current.authenticatedRequestKeyId,
    manifestDigest: current.manifestDigest,
    artifactDigest: current.artifactDigest,
    manifestUrl: current.manifestUrl,
    listing: current.listing,
    listingDigest: current.listingDigest,
    runtimeCoordinate: current.runtimeCoordinate,
    createdAt: current.revisionCreatedAt,
    supersededAt: context.time,
    supersededBy: context.actor,
    supersededFromStatus: current.status,
    supersededReason: current.statusReason
  } as const
  const next = parseMarketplaceSubmission({
    ...current,
    manifestDigest: input.manifestDigest,
    artifactDigest: input.artifactDigest,
    manifestUrl: input.manifestUrl,
    listing: input.listing,
    listingDigest: input.listingDigest,
    runtimeCoordinate: input.runtimeCoordinate ?? null,
    signingKeyId: input.signingKeyId,
    authenticatedRequestKeyId: input.authenticatedRequestKeyId,
    revision: current.revision + 1,
    revisionCreatedAt: context.time,
    revisionHistory: [...current.revisionHistory, previousRevision],
    status: 'submitted',
    updatedAt: context.time,
    statusReason: null
  })
  return commitMutation(
    state,
    {
      submissions: state.submissions.map((submission) =>
        submission.id === current.id ? next : submission
      )
    },
    next,
    {
      action: 'submission.revised',
      subject: `submission:${current.id}`,
      payload: {
        coordinate: marketplaceReleaseCoordinateKey(current.coordinate),
        fromRevision: current.revision,
        fromStatus: current.status,
        newArtifactDigest: next.artifactDigest,
        newListingDigest: next.listingDigest,
        newManifestDigest: next.manifestDigest,
        newRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(next),
        newRuntimePackageDigest: next.runtimeCoordinate?.packageDigest ?? null,
        newAuthenticatedRequestKeyId: next.authenticatedRequestKeyId,
        oldArtifactDigest: current.artifactDigest,
        oldAuthenticatedRequestKeyId: current.authenticatedRequestKeyId,
        oldListingDigest: current.listingDigest,
        oldManifestDigest: current.manifestDigest,
        oldRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(current),
        oldRuntimePackageDigest: current.runtimeCoordinate?.packageDigest ?? null,
        oldSigningKeyId: current.signingKeyId,
        publisherId: current.publisherId,
        fromReason: current.statusReason,
        signingKeyId: next.signingKeyId,
        submissionId: current.id,
        toRevision: next.revision,
        toStatus: next.status
      },
      context
    }
  )
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

export async function pinLegacyMarketplaceSubmissionSigningKey(
  value: MarketplaceStateV1,
  submissionIdValue: string,
  signingKeyIdValue: string,
  contextValue: MarketplaceMutationContext
): Promise<MarketplaceMutationResult<MarketplaceSubmissionV1>> {
  const state = parseMarketplaceState(value)
  const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submissionId')
  const signingKeyId = parseMarketplaceIdentity(signingKeyIdValue, 'signingKeyId')
  const context = resolveMarketplaceMutationContext(contextValue)
  const current = requireEntity(
    state.submissions.find(({ id }) => id === submissionId),
    `Submission ${submissionId}`
  )
  if (
    current.revision !== 1 ||
    current.revisionHistory.length !== 0 ||
    current.signingKeyId !== null ||
    current.authenticatedRequestKeyId !== null ||
    current.status !== 'approved'
  ) {
    throw new TypeError('Only one legacy approved submission may have its signer pinned')
  }
  requireChronological(current.updatedAt, context.time, 'submission.updatedAt')
  activePublisher(state, current.publisherId)
  activeOwnership(state, current.coordinate.pluginId, current.publisherId)
  activeSigningKey(state, current.publisherId, signingKeyId, context.time)
  const next = parseMarketplaceSubmission({
    ...current,
    signingKeyId,
    updatedAt: context.time
  })
  const beforePin = parseMarketplaceSubmission({
    ...current,
    signingKeyId: null,
    authenticatedRequestKeyId: null
  })
  return commitMutation(
    state,
    {
      submissions: state.submissions.map((submission) =>
        submission.id === current.id ? next : submission
      )
    },
    next,
    {
      action: 'submission.signing_key_pinned',
      subject: `submission:${current.id}`,
      payload: {
        artifactDigest: current.artifactDigest,
        authenticatedRequestKeyId: next.authenticatedRequestKeyId,
        coordinate: marketplaceReleaseCoordinateKey(current.coordinate),
        manifestDigest: current.manifestDigest,
        newRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(next),
        oldRevisionPayloadDigest: marketplaceSubmissionRevisionPayloadDigest(beforePin),
        publisherId: current.publisherId,
        revision: current.revision,
        signingKeyId,
        submissionId: current.id
      },
      context
    }
  )
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
  if (!current.signingKeyId) {
    throw new TypeError('Submission is missing its signing key identity and cannot be published')
  }
  activeSigningKey(state, current.publisherId, current.signingKeyId, context.time)
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
    submissionRevision: submission.revision,
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

interface MarketplaceCommittedNonce {
  readonly namespace: MarketplaceNonceNamespace
  readonly subjectId: string
  readonly nonce: string
  readonly expiresAt: number
}

function marketplaceNonceNamespace(value: unknown): MarketplaceNonceNamespace {
  if (
    typeof value !== 'string' ||
    !(Object.values(MARKETPLACE_NONCE_NAMESPACES) as readonly string[]).includes(value)
  ) {
    throw new TypeError('Marketplace nonce namespace is invalid')
  }
  return value as MarketplaceNonceNamespace
}

function marketplaceNonceKey(
  namespaceValue: MarketplaceNonceNamespace,
  subjectIdValue: string,
  nonceValue: string
): string {
  const namespace = marketplaceNonceNamespace(namespaceValue)
  const subjectId = parseMarketplaceIdentity(subjectIdValue, 'marketplace nonce subject id')
  if (typeof nonceValue !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonceValue)) {
    throw new TypeError('Marketplace nonce must be bounded base64url text')
  }
  return JSON.stringify([namespace, subjectId, nonceValue])
}

function marketplaceNonceExpiry(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError('Marketplace nonce expiry must be a positive safe integer')
  }
  return value
}

function marketplaceClock(now: (() => number) | undefined): number {
  const value = (now ?? Date.now)()
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Marketplace clock is invalid')
  }
  return value
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
    reviseSubmission(input, expectedRevision, context) {
      const isolatedInput = structuredClone(input)
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        reviseMarketplaceSubmission(current, isolatedInput, expectedRevision, isolatedContext)
      )
    },
    pinLegacySubmissionSigningKey(submissionId, signingKeyId, context) {
      const isolatedContext = structuredClone(context)
      return mutate((current) =>
        pinLegacyMarketplaceSubmissionSigningKey(
          current,
          submissionId,
          signingKeyId,
          isolatedContext
        )
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

function createPublicationCompletionTransaction(
  transaction: MarketplaceTransaction,
  reservation: MarketplacePublicationReservationV1
): {
  readonly transaction: MarketplacePublicationCompletionTransaction
  assertExactlyRecorded(): void
} {
  let recordCalls = 0
  let violation = false

  function reject(): never {
    violation = true
    throw new MarketplacePublicationReservationConflictError()
  }

  return Object.freeze({
    transaction: Object.freeze({
      snapshot() {
        return transaction.snapshot()
      },
      recordPublication(
        input: RecordMarketplacePublicationInput,
        context: MarketplaceMutationContext
      ) {
        recordCalls++
        if (recordCalls !== 1) reject()
        const isolatedContext = structuredClone(context)
        if (
          isolatedContext.correlationId !== reservation.requestDigest ||
          (isolatedContext.reason ?? null) !== null
        ) {
          reject()
        }
        return transaction.recordPublication(structuredClone(input), isolatedContext)
      }
    }),
    assertExactlyRecorded() {
      if (violation || recordCalls !== 1) reject()
    }
  })
}

export function createMemoryMarketplaceRepository(
  options: CreateMemoryMarketplaceRepositoryOptions = {}
): MarketplacePublicationReservationRepository {
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
  const committedNonces = new Map<string, MarketplaceCommittedNonce>()
  const publisherReceipts = new Map<string, MarketplacePublisherMutationReceipt>()
  const publicationCompletions = new Map<string, MarketplacePublicationCompletionReceiptV1>()
  let publicationReservation: MarketplacePublicationReservationV1 | null = null

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

  function cleanupExpiredRequests(now: number): void {
    for (const [key, nonce] of committedNonces) {
      if (nonce.expiresAt < now) {
        committedNonces.delete(key)
        publisherReceipts.delete(key)
      }
    }
  }

  function prunePublicationCompletions(): void {
    const retainedSequences = new Set(state.publications.map(({ sequence }) => sequence))
    for (const [requestDigest, receipt] of publicationCompletions) {
      if (!retainedSequences.has(receipt.publication.sequence)) {
        publicationCompletions.delete(requestDigest)
      }
    }
  }

  function publicationCompletion(
    requestDigestValue: unknown,
    bundleDigestValue: unknown
  ): MarketplacePublicationCompletionReceiptV1 | null {
    const requestDigest = parseSha256Base64URL(
      requestDigestValue,
      'marketplace publication completion request digest'
    )
    const bundleDigest = parseSha256Base64URL(
      bundleDigestValue,
      'marketplace publication completion bundle digest'
    )
    const receipt = publicationCompletions.get(requestDigest)
    if (!receipt) return null
    if (receipt.bundleDigest !== bundleDigest) {
      throw new MarketplacePublicationCompletionConflictError()
    }
    return assertMarketplacePublicationCompletionReceiptState(receipt, state)
  }

  function receiptExecution(
    receipt: MarketplacePublisherMutationReceipt,
    request: MarketplaceVerifiedPublisherMutationRequest
  ): MarketplacePublisherMutationExecution {
    if (!sameMarketplacePublisherMutationRequest(receipt, request)) {
      const key = marketplaceNonceKey(
        MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
        request.publisherId,
        request.nonce
      )
      const existing = committedNonces.get(key)
      if (existing && request.freshUntil > existing.expiresAt) {
        committedNonces.set(key, Object.freeze({ ...existing, expiresAt: request.freshUntil }))
      }
      throw new MarketplacePublisherMutationConflictError()
    }
    return Object.freeze({
      source: 'replayed' as const,
      response: structuredClone(
        parseMarketplacePublisherMutationResponse(receipt.operation, receipt.response)
      )
    })
  }

  function assertRequestCapacity(request: MarketplaceVerifiedPublisherMutationRequest): void {
    if (publisherReceipts.size >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceipts) {
      throw new MarketplacePublisherMutationCapacityError(
        'Marketplace Publisher mutation receipt capacity is exhausted'
      )
    }
    let publisherReceiptCount = 0
    let subjectNonceCount = 0
    let aggregateResponseBytes = 0
    for (const receipt of publisherReceipts.values()) {
      aggregateResponseBytes += receipt.response.byteLength
      if (receipt.publisherId === request.publisherId) publisherReceiptCount++
    }
    for (const nonce of committedNonces.values()) {
      if (
        nonce.namespace === MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2 &&
        nonce.subjectId === request.publisherId
      ) {
        subjectNonceCount++
      }
    }
    if (
      publisherReceiptCount >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxReceiptsPerPublisher ||
      subjectNonceCount >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNoncesPerSubject ||
      committedNonces.size >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNonces ||
      aggregateResponseBytes >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes
    ) {
      throw new MarketplacePublisherMutationCapacityError(
        'Marketplace Publisher request capacity is exhausted'
      )
    }
  }

  const nonces: MarketplaceNonceStore = {
    consume(namespaceValue, subjectId, nonce, expiresAtValue, currentTime) {
      return enqueue(async () => {
        const namespace = marketplaceNonceNamespace(namespaceValue)
        const expiresAt = marketplaceNonceExpiry(expiresAtValue)
        const now = currentTime ?? marketplaceClock(options.now)
        if (!Number.isSafeInteger(now) || now < 0) {
          throw new TypeError('Marketplace nonce current time is invalid')
        }
        cleanupExpiredRequests(now)
        const key = marketplaceNonceKey(namespace, subjectId, nonce)
        const existing = committedNonces.get(key)
        if (existing) {
          if (expiresAt > existing.expiresAt) {
            committedNonces.set(key, Object.freeze({ ...existing, expiresAt }))
          }
          return false
        }
        if (committedNonces.size >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNonces) {
          throw new MarketplacePublisherMutationCapacityError(
            'Marketplace nonce capacity is exhausted'
          )
        }
        let subjectCount = 0
        for (const value of committedNonces.values()) {
          if (value.namespace === namespace && value.subjectId === subjectId) subjectCount++
        }
        if (subjectCount >= MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxLiveNoncesPerSubject) {
          throw new MarketplacePublisherMutationCapacityError(
            'Marketplace nonce subject capacity is exhausted'
          )
        }
        committedNonces.set(key, Object.freeze({ namespace, subjectId, nonce, expiresAt }))
        return true
      })
    }
  }

  return {
    nonces,
    snapshot() {
      return enqueue(async () => isolatedState(state))
    },
    async immutableSnapshot() {
      await initialization
      return state
    },
    inspectPublicationReservation() {
      return enqueue(async () =>
        publicationReservation === null ? null : structuredClone(publicationReservation)
      )
    },
    inspectPublicationCompletion(requestDigest, bundleDigest) {
      return enqueue(async () => {
        const receipt = publicationCompletion(requestDigest, bundleDigest)
        return receipt === null ? null : structuredClone(receipt)
      })
    },
    reservePublication(reservationValue) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        if (publicationReservation !== null) {
          if (!sameMarketplacePublicationReservation(publicationReservation, reservation)) {
            throw new MarketplacePublicationReservationConflictError()
          }
          assertMarketplacePublicationReservationState(publicationReservation, state)
          return Object.freeze({
            source: 'replayed' as const,
            reservation: structuredClone(publicationReservation)
          })
        }
        assertMarketplacePublicationReservationState(reservation, state)
        publicationReservation = reservation
        return Object.freeze({
          source: 'reserved' as const,
          reservation: structuredClone(reservation)
        })
      })
    },
    completePublication(reservationValue, bundleDigestValue, operation) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        const bundleDigest = parseSha256Base64URL(
          bundleDigestValue,
          'marketplace publication completion bundle digest'
        )
        const replayed = publicationCompletion(reservation.requestDigest, bundleDigest)
        if (replayed) {
          return Object.freeze({
            source: 'replayed' as const,
            receipt: structuredClone(replayed),
            publication: structuredClone(replayed.publication)
          })
        }
        if (
          publicationReservation === null ||
          !sameMarketplacePublicationReservation(publicationReservation, reservation)
        ) {
          throw new MarketplacePublicationReservationConflictError()
        }
        assertMarketplacePublicationReservationState(reservation, state)
        const transaction = createTransaction(state, capacity)
        const completion = createPublicationCompletionTransaction(transaction, reservation)
        try {
          const result = await operation(completion.transaction)
          const returnedPublication = parseMarketplacePublication(
            structuredClone(result),
            'marketplace publication completion result'
          )
          completion.assertExactlyRecorded()
          const next = await transaction.close()
          const verifiedNext = assertMarketplacePublicationReservationCompletion(
            reservation,
            state,
            next
          )
          const receipt = createMarketplacePublicationCompletionReceipt(
            reservation,
            bundleDigest,
            verifiedNext
          )
          if (
            canonicalManifestJSON(returnedPublication) !==
            canonicalManifestJSON(receipt.publication)
          ) {
            throw new MarketplacePublicationReservationConflictError()
          }
          state = verifiedNext
          publicationCompletions.set(receipt.requestDigest, receipt)
          publicationReservation = null
          return Object.freeze({
            source: 'committed' as const,
            receipt: structuredClone(receipt),
            publication: structuredClone(receipt.publication)
          })
        } catch (error) {
          await transaction.abort()
          throw error
        }
      })
    },
    cancelPublication(reservationValue, confirmedRequestDigestValue, contextValue) {
      return enqueue(async () => {
        const reservation = parseMarketplacePublicationReservation(reservationValue)
        const confirmedRequestDigest = parseSha256Base64URL(
          confirmedRequestDigestValue,
          'marketplace publication cancellation confirmed request digest'
        )
        if (
          confirmedRequestDigest !== reservation.requestDigest ||
          publicationReservation === null ||
          !sameMarketplacePublicationReservation(publicationReservation, reservation)
        ) {
          throw new MarketplacePublicationReservationConflictError()
        }
        assertMarketplacePublicationReservationState(reservation, state)
        const context = resolveMarketplaceMutationContext(contextValue)
        if (!context.reason) {
          throw new TypeError('Marketplace publication reservation cancellation requires a reason')
        }
        if (context.correlationId !== reservation.requestDigest) {
          throw new MarketplacePublicationReservationConflictError()
        }
        const cancelled = await commitMutation(state, {}, null, {
          action: 'publication.reservation_cancelled',
          subject: `publication-reservation:${reservation.requestDigest}`,
          payload: {
            auditHead: reservation.auditHead,
            auditSequence: reservation.auditSequence,
            expectedNextSequence: reservation.expectedNextSequence,
            requestDigest: reservation.requestDigest,
            stateDigest: reservation.stateDigest
          },
          context
        })
        const event = cancelled.state.auditEvents.at(-1)
        if (event?.action !== 'publication.reservation_cancelled') {
          throw new MarketplacePublicationReservationConflictError()
        }
        state = cancelled.state
        publicationReservation = null
        return structuredClone(event)
      })
    },
    transaction(operation) {
      return enqueue(async () => {
        if (publicationReservation !== null) throw new MarketplacePublicationQuiescedError()
        const transaction = createTransaction(state, capacity)
        let result: Awaited<ReturnType<typeof operation>>
        try {
          result = await operation(transaction)
          const next = await transaction.close()
          state = next
          prunePublicationCompletions()
        } catch (error) {
          await transaction.abort()
          throw error
        }
        return structuredClone(result)
      })
    },
    inspectPublisherMutation(requestValue, currentTime) {
      return enqueue(async () => {
        const request = parseMarketplaceVerifiedPublisherMutationRequest(requestValue)
        const now = marketplaceClock(() => currentTime)
        cleanupExpiredRequests(now)
        const key = marketplaceNonceKey(
          MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
          request.publisherId,
          request.nonce
        )
        const receipt = publisherReceipts.get(key)
        if (receipt) return receiptExecution(receipt, request)
        const committedNonce = committedNonces.get(key)
        if (committedNonce) {
          if (request.freshUntil > committedNonce.expiresAt) {
            committedNonces.set(
              key,
              Object.freeze({ ...committedNonce, expiresAt: request.freshUntil })
            )
          }
          throw new MarketplacePublisherMutationConflictError()
        }
        return null
      })
    },
    executePublisherMutation(requestValue, currentTime, operation) {
      return enqueue(async () => {
        const request = parseMarketplaceVerifiedPublisherMutationRequest(requestValue)
        const now = marketplaceClock(() => currentTime)
        if (publicationReservation !== null) throw new MarketplacePublicationQuiescedError()
        cleanupExpiredRequests(now)
        const key = marketplaceNonceKey(
          MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
          request.publisherId,
          request.nonce
        )
        const receipt = publisherReceipts.get(key)
        if (receipt) return receiptExecution(receipt, request)
        const committedNonce = committedNonces.get(key)
        if (committedNonce) {
          if (request.freshUntil > committedNonce.expiresAt) {
            committedNonces.set(
              key,
              Object.freeze({ ...committedNonce, expiresAt: request.freshUntil })
            )
          }
          throw new MarketplacePublisherMutationConflictError()
        }
        assertRequestCapacity(request)

        const transaction = createTransaction(state, capacity)
        let response: MarketplacePublisherMutationResponse | null = null
        let next = state
        let callbackResult:
          | MarketplacePublisherMutationCommitPlan
          | MarketplacePublisherMutationSuccessResponse
          | undefined
        let terminalFailure = false
        try {
          callbackResult = await operation(transaction)
        } catch (error) {
          await transaction.abort()
          if (!(error instanceof MarketplacePublisherMutationTerminalError)) throw error
          terminalFailure = true
          response = createMarketplacePublisherMutationTerminalResponse(error)
          if (
            [...publisherReceipts.values()].reduce(
              (sum, value) => sum + value.response.byteLength,
              response.byteLength
            ) > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes
          ) {
            throw new MarketplacePublisherMutationCapacityError(
              'Marketplace Publisher mutation response capacity is exhausted'
            )
          }
        }
        if (!terminalFailure) {
          try {
            const result = callbackResult as
              | MarketplacePublisherMutationCommitPlan
              | MarketplacePublisherMutationSuccessResponse
            const plan = result instanceof MarketplacePublisherMutationCommitPlan ? result : null
            response = parseMarketplacePublisherMutationSuccessResponse(
              request.operation,
              result instanceof MarketplacePublisherMutationCommitPlan ? result.response : result
            )
            if (
              [...publisherReceipts.values()].reduce(
                (sum, value) => sum + value.response.byteLength,
                response.byteLength
              ) > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxAggregateResponseBytes
            ) {
              throw new MarketplacePublisherMutationCapacityError(
                'Marketplace Publisher mutation response capacity is exhausted'
              )
            }
            next = await transaction.close()
            if (plan) await plan.commit()
          } catch (error) {
            await transaction.abort()
            throw error
          }
        }
        if (!response) {
          throw new Error('Marketplace Publisher mutation did not produce a response')
        }
        const nextCommittedNonce = Object.freeze({
          namespace: MARKETPLACE_NONCE_NAMESPACES.publisherRequestV2,
          subjectId: request.publisherId,
          nonce: request.nonce,
          expiresAt: request.freshUntil
        })
        const committedReceipt: MarketplacePublisherMutationReceipt = Object.freeze({
          ...request,
          response: structuredClone(response),
          committedAt: now
        })
        state = next
        prunePublicationCompletions()
        committedNonces.set(key, nextCommittedNonce)
        publisherReceipts.set(key, committedReceipt)
        return Object.freeze({
          source: 'committed' as const,
          response: structuredClone(response)
        })
      })
    }
  }
}
