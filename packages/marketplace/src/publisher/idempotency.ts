import { createHash, timingSafeEqual } from 'node:crypto'

import { parseSha256Base64URL } from '@open-pencil/scene-graph'

import type { MarketplaceVerifiedRequestSignature } from '../auth'
import {
  parseMarketplaceControlJSON,
  parseMarketplaceControlPublisherKey,
  parseMarketplaceControlSubmissionSummary,
  serializeMarketplaceControlJSON
} from '../control-contract'
import {
  parseMarketplaceIdentity,
  parseMarketplaceOwnership,
  parseMarketplacePublisher,
  parseMarketplaceTimestamp
} from '../types'

export const MARKETPLACE_PUBLISHER_MUTATION_OPERATIONS = [
  'publisher.register',
  'ownership.request',
  'key.rotate',
  'submission.create',
  'submission.revise',
  'submission.withdraw'
] as const

export type MarketplacePublisherMutationOperation =
  (typeof MARKETPLACE_PUBLISHER_MUTATION_OPERATIONS)[number]

export const MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_STATUSES = [400, 401, 404, 409] as const

export type MarketplacePublisherMutationTerminalStatus =
  (typeof MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_STATUSES)[number]

const MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_FAILURES = Object.freeze({
  'invalid-request': Object.freeze({
    status: 400,
    message: 'Publisher mutation request is invalid'
  }),
  'authority-mismatch': Object.freeze({
    status: 401,
    message: 'Publisher mutation is not bound to its signed identity'
  }),
  'authority-inactive': Object.freeze({
    status: 401,
    message: 'Authenticated Publisher mutation authority is no longer active'
  }),
  'resource-not-found': Object.freeze({
    status: 404,
    message: 'Marketplace Publisher mutation resource was not found'
  }),
  'state-conflict': Object.freeze({
    status: 409,
    message: 'Marketplace Publisher mutation conflicts with current state'
  }),
  'publisher-registration-conflict': Object.freeze({
    status: 409,
    message: 'Marketplace publisher registration already exists'
  })
} as const)

export type MarketplacePublisherMutationTerminalCode =
  keyof typeof MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_FAILURES

export class MarketplacePublisherMutationTerminalError extends Error {
  readonly status: MarketplacePublisherMutationTerminalStatus

  constructor(readonly code: MarketplacePublisherMutationTerminalCode) {
    const failure = MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_FAILURES[code]
    super(failure.message)
    this.name = 'MarketplacePublisherMutationTerminalError'
    this.status = failure.status
  }
}

export const MARKETPLACE_PUBLISHER_MUTATION_LIMITS = Object.freeze({
  maxResponseBytes: 64 * 1024,
  maxReceipts: 8_192,
  maxReceiptsPerPublisher: 1_024,
  maxAggregateResponseBytes: 32 * 1024 * 1024,
  maxLiveNonces: 32_768,
  maxLiveNoncesPerSubject: 2_048
})

export interface MarketplaceVerifiedPublisherMutationRequest extends MarketplaceVerifiedRequestSignature {
  readonly operation: MarketplacePublisherMutationOperation
}

export interface MarketplacePublisherMutationResponse {
  readonly status: 200 | 201 | MarketplacePublisherMutationTerminalStatus
  readonly json: string
  readonly digest: string
  readonly byteLength: number
}

export interface MarketplacePublisherMutationSuccessResponse extends MarketplacePublisherMutationResponse {
  readonly status: 200 | 201
}

export interface MarketplacePublisherMutationExecution {
  readonly source: 'committed' | 'replayed'
  readonly response: MarketplacePublisherMutationResponse
}

/**
 * Defers an irreversible, idempotent content-addressed side effect until the
 * repository has validated the response and its receipt capacity. The
 * repository still owns the surrounding state/nonce/receipt transaction.
 */
export class MarketplacePublisherMutationCommitPlan {
  readonly response: MarketplacePublisherMutationSuccessResponse
  readonly #commit: () => Promise<void>
  #started = false

  constructor(
    operation: MarketplacePublisherMutationOperation,
    response: MarketplacePublisherMutationSuccessResponse,
    commit: () => Promise<void>
  ) {
    if (typeof commit !== 'function') {
      throw new TypeError('Publisher mutation commit plan requires a commit operation')
    }
    this.response = parseMarketplacePublisherMutationSuccessResponse(operation, response)
    this.#commit = commit
    Object.freeze(this)
  }

  async commit(): Promise<void> {
    if (this.#started) {
      throw new Error('Publisher mutation commit plan may only execute once')
    }
    this.#started = true
    await this.#commit()
  }
}

export interface MarketplacePublisherMutationReceipt extends MarketplaceVerifiedPublisherMutationRequest {
  readonly response: MarketplacePublisherMutationResponse
  readonly committedAt: number
}

const OPERATION_STATUS: Readonly<Record<MarketplacePublisherMutationOperation, 200 | 201>> =
  Object.freeze({
    'publisher.register': 201,
    'ownership.request': 201,
    'key.rotate': 201,
    'submission.create': 201,
    'submission.revise': 200,
    'submission.withdraw': 200
  })

const encoder = new TextEncoder()

function operation(value: unknown): MarketplacePublisherMutationOperation {
  if (
    typeof value !== 'string' ||
    !(MARKETPLACE_PUBLISHER_MUTATION_OPERATIONS as readonly string[]).includes(value)
  ) {
    throw new TypeError('Publisher mutation operation is invalid')
  }
  return value as MarketplacePublisherMutationOperation
}

function boundedTarget(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('#') ||
    encoder.encode(value).byteLength > 8 * 1024
  ) {
    throw new TypeError('Publisher mutation target is invalid')
  }
  return value
}

function boundedNonce(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new TypeError('Publisher mutation nonce must be bounded base64url text')
  }
  return value
}

export function parseMarketplaceVerifiedPublisherMutationRequest(
  value: MarketplaceVerifiedPublisherMutationRequest
): MarketplaceVerifiedPublisherMutationRequest {
  const authVersion: unknown = value.authVersion
  if (authVersion !== 2) throw new TypeError('Publisher mutation auth version is invalid')
  if (value.method !== 'POST') throw new TypeError('Publisher mutations require POST')
  if (!Number.isSafeInteger(value.freshUntil) || value.freshUntil <= 0) {
    throw new TypeError('Publisher mutation freshness boundary is invalid')
  }
  return Object.freeze({
    authVersion: 2,
    operation: operation(value.operation),
    audience: parseMarketplaceIdentity(value.audience, 'publisher mutation audience'),
    publisherId: parseMarketplaceIdentity(value.publisherId, 'publisher mutation publisher id'),
    keyId: parseMarketplaceIdentity(value.keyId, 'publisher mutation key id'),
    method: 'POST',
    target: boundedTarget(value.target),
    timestamp: parseMarketplaceTimestamp(value.timestamp, 'publisher mutation timestamp'),
    nonce: boundedNonce(value.nonce),
    bodyDigest: parseSha256Base64URL(value.bodyDigest, 'publisher mutation body digest'),
    requestDigest: parseSha256Base64URL(value.requestDigest, 'publisher mutation request digest'),
    signatureDigest: parseSha256Base64URL(
      value.signatureDigest,
      'publisher mutation signature digest'
    ),
    freshUntil: value.freshUntil
  })
}

function responseParser(operationValue: MarketplacePublisherMutationOperation) {
  switch (operationValue) {
    case 'publisher.register':
      return parseMarketplacePublisher
    case 'ownership.request':
      return parseMarketplaceOwnership
    case 'key.rotate':
      return parseMarketplaceControlPublisherKey
    case 'submission.create':
    case 'submission.revise':
    case 'submission.withdraw':
      return parseMarketplaceControlSubmissionSummary
    default:
      throw new TypeError('Publisher mutation operation has no response parser')
  }
}

function terminalResponseStatus(value: unknown): MarketplacePublisherMutationTerminalStatus {
  if (
    !MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_STATUSES.includes(
      value as MarketplacePublisherMutationTerminalStatus
    )
  ) {
    throw new TypeError('Publisher mutation terminal response status is invalid')
  }
  return value as MarketplacePublisherMutationTerminalStatus
}

function terminalResponsePayload(
  statusValue: MarketplacePublisherMutationTerminalStatus,
  value: unknown
): Readonly<{ error: string }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Publisher mutation terminal response must be an object')
  }
  const prototype = Object.getPrototypeOf(value)
  const keys = Reflect.ownKeys(value)
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== 1 ||
    keys[0] !== 'error'
  ) {
    throw new TypeError('Publisher mutation terminal response shape is invalid')
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'error')
  if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string') {
    throw new TypeError('Publisher mutation terminal response error is invalid')
  }
  const supported = Object.values(MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_FAILURES).some(
    ({ status, message }) => status === statusValue && message === descriptor.value
  )
  if (!supported) {
    throw new TypeError('Publisher mutation terminal response is not a supported failure')
  }
  return Object.freeze({ error: descriptor.value })
}

export function createMarketplacePublisherMutationResponse(
  operationValue: MarketplacePublisherMutationOperation,
  value: unknown
): MarketplacePublisherMutationSuccessResponse {
  const parsedOperation = operation(operationValue)
  const parsed = responseParser(parsedOperation)(value)
  const json = serializeMarketplaceControlJSON(
    parsed,
    MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
  )
  const bytes = encoder.encode(json)
  return Object.freeze({
    status: OPERATION_STATUS[parsedOperation],
    json,
    digest: createHash('sha256').update(bytes).digest('base64url'),
    byteLength: bytes.byteLength
  })
}

export function createMarketplacePublisherMutationTerminalResponse(
  error: MarketplacePublisherMutationTerminalError
): MarketplacePublisherMutationResponse {
  const failure = (
    MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_FAILURES as Partial<
      Record<
        MarketplacePublisherMutationTerminalCode,
        { status: MarketplacePublisherMutationTerminalStatus; message: string }
      >
    >
  )[error.code]
  if (!failure) throw new TypeError('Publisher mutation terminal error code is invalid')
  const json = serializeMarketplaceControlJSON(
    { error: failure.message },
    MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
  )
  const bytes = encoder.encode(json)
  return Object.freeze({
    status: failure.status,
    json,
    digest: createHash('sha256').update(bytes).digest('base64url'),
    byteLength: bytes.byteLength
  })
}

export function parseMarketplacePublisherMutationResponse(
  operationValue: MarketplacePublisherMutationOperation,
  value: MarketplacePublisherMutationResponse
): MarketplacePublisherMutationResponse {
  const parsedOperation = operation(operationValue)
  const success = value.status === OPERATION_STATUS[parsedOperation]
  if (
    !success &&
    !MARKETPLACE_PUBLISHER_MUTATION_TERMINAL_STATUSES.includes(
      value.status as MarketplacePublisherMutationTerminalStatus
    )
  ) {
    throw new TypeError('Publisher mutation response status does not match its operation')
  }
  if (
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 1 ||
    value.byteLength > MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
  ) {
    throw new TypeError('Publisher mutation response byte length is invalid')
  }
  const bytes = encoder.encode(value.json)
  if (bytes.byteLength !== value.byteLength) {
    throw new TypeError('Publisher mutation response byte length does not match its JSON')
  }
  const digest = parseSha256Base64URL(value.digest, 'publisher mutation response digest')
  const actualDigest = createHash('sha256').update(bytes).digest('base64url')
  if (!safeDigestEqual(digest, actualDigest)) {
    throw new TypeError('Publisher mutation response digest does not match its JSON')
  }
  const parsed: unknown = success
    ? parseMarketplaceControlJSON(
        value.json,
        responseParser(parsedOperation) as (value: unknown, path?: string) => unknown,
        MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
      )
    : parseMarketplaceControlJSON(
        value.json,
        (candidate) => terminalResponsePayload(terminalResponseStatus(value.status), candidate),
        MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
      )
  if (
    serializeMarketplaceControlJSON(
      parsed,
      MARKETPLACE_PUBLISHER_MUTATION_LIMITS.maxResponseBytes
    ) !== value.json
  ) {
    throw new TypeError('Publisher mutation response JSON is not canonical')
  }
  return Object.freeze({
    status: value.status,
    json: value.json,
    digest,
    byteLength: bytes.byteLength
  })
}

export function parseMarketplacePublisherMutationSuccessResponse(
  operationValue: MarketplacePublisherMutationOperation,
  value: MarketplacePublisherMutationResponse
): MarketplacePublisherMutationSuccessResponse {
  const parsedOperation = operation(operationValue)
  const response = parseMarketplacePublisherMutationResponse(parsedOperation, value)
  if (response.status !== OPERATION_STATUS[parsedOperation]) {
    throw new TypeError('Publisher mutation callback must return a success response')
  }
  return response as MarketplacePublisherMutationSuccessResponse
}

export function sameMarketplacePublisherMutationRequest(
  leftValue: MarketplaceVerifiedPublisherMutationRequest,
  rightValue: MarketplaceVerifiedPublisherMutationRequest
): boolean {
  const left = parseMarketplaceVerifiedPublisherMutationRequest(leftValue)
  const right = parseMarketplaceVerifiedPublisherMutationRequest(rightValue)
  return (
    left.operation === right.operation &&
    left.audience === right.audience &&
    left.publisherId === right.publisherId &&
    left.keyId === right.keyId &&
    left.method === right.method &&
    left.target === right.target &&
    left.timestamp === right.timestamp &&
    left.nonce === right.nonce &&
    safeDigestEqual(left.bodyDigest, right.bodyDigest) &&
    safeDigestEqual(left.requestDigest, right.requestDigest) &&
    safeDigestEqual(left.signatureDigest, right.signatureDigest) &&
    left.freshUntil === right.freshUntil
  )
}

function safeDigestEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes)
}

export class MarketplacePublisherMutationConflictError extends Error {
  constructor(message = 'Publisher mutation nonce is already bound to a different request') {
    super(message)
    this.name = 'MarketplacePublisherMutationConflictError'
  }
}

export class MarketplacePublisherMutationCapacityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketplacePublisherMutationCapacityError'
  }
}
