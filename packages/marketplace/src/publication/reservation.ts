import {
  canonicalManifestJSON,
  parseExactManifestRecord,
  parseSha256Base64URL
} from '@open-pencil/scene-graph'

import {
  parseMarketplacePublication,
  parseMarketplaceState,
  type MarketplacePublicationV1,
  type MarketplaceStateV1
} from '../types'
import {
  marketplacePublicationRequestDigest,
  marketplacePublicationStateDigest,
  parseMarketplacePublicationRequest
} from './request'

const RESERVATION_KEYS = new Set([
  'requestDigest',
  'stateDigest',
  'auditSequence',
  'auditHead',
  'expectedNextSequence'
])
const COMPLETION_RECEIPT_KEYS = new Set([
  ...RESERVATION_KEYS,
  'bundleDigest',
  'completionEventHash',
  'publication'
])

export interface MarketplacePublicationReservationV1 {
  readonly requestDigest: string
  readonly stateDigest: string
  readonly auditSequence: number
  readonly auditHead: string
  readonly expectedNextSequence: number
}

export interface MarketplacePublicationReservationExecution {
  readonly source: 'reserved' | 'replayed'
  readonly reservation: MarketplacePublicationReservationV1
}

export interface MarketplacePublicationCompletionReceiptV1 extends MarketplacePublicationReservationV1 {
  readonly bundleDigest: string
  readonly completionEventHash: string
  readonly publication: MarketplacePublicationV1
}

export interface MarketplacePublicationCompletionExecution {
  readonly source: 'committed' | 'replayed'
  readonly receipt: MarketplacePublicationCompletionReceiptV1
  readonly publication: MarketplacePublicationV1
}

export class MarketplacePublicationReservationConflictError extends Error {
  constructor() {
    super('Marketplace publication reservation does not match the committed publication boundary')
    this.name = 'MarketplacePublicationReservationConflictError'
  }
}

export class MarketplacePublicationQuiescedError extends Error {
  constructor() {
    super('Marketplace mutations are quiesced by an active publication reservation')
    this.name = 'MarketplacePublicationQuiescedError'
  }
}

export class MarketplacePublicationCompletionConflictError extends Error {
  constructor() {
    super('Marketplace publication request is already completed by a different signed bundle')
    this.name = 'MarketplacePublicationCompletionConflictError'
  }
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value as number
}

export function parseMarketplacePublicationReservation(
  value: unknown
): MarketplacePublicationReservationV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplacePublicationReservation',
    RESERVATION_KEYS,
    RESERVATION_KEYS
  )
  return Object.freeze({
    requestDigest: parseSha256Base64URL(
      source.requestDigest,
      'marketplacePublicationReservation.requestDigest'
    ),
    stateDigest: parseSha256Base64URL(
      source.stateDigest,
      'marketplacePublicationReservation.stateDigest'
    ),
    auditSequence: positiveSafeInteger(
      source.auditSequence,
      'marketplacePublicationReservation.auditSequence'
    ),
    auditHead: parseSha256Base64URL(
      source.auditHead,
      'marketplacePublicationReservation.auditHead'
    ),
    expectedNextSequence: positiveSafeInteger(
      source.expectedNextSequence,
      'marketplacePublicationReservation.expectedNextSequence'
    )
  })
}

export function marketplacePublicationReservationFromRequest(
  requestValue: unknown
): MarketplacePublicationReservationV1 {
  const request = parseMarketplacePublicationRequest(requestValue)
  return parseMarketplacePublicationReservation({
    requestDigest: marketplacePublicationRequestDigest(request),
    stateDigest: request.stateDigest,
    auditSequence: request.auditSequence,
    auditHead: request.auditHead,
    expectedNextSequence: request.expectedNextSequence
  })
}

export function sameMarketplacePublicationReservation(
  leftValue: unknown,
  rightValue: unknown
): boolean {
  const left = parseMarketplacePublicationReservation(leftValue)
  const right = parseMarketplacePublicationReservation(rightValue)
  return (
    left.requestDigest === right.requestDigest &&
    left.stateDigest === right.stateDigest &&
    left.auditSequence === right.auditSequence &&
    left.auditHead === right.auditHead &&
    left.expectedNextSequence === right.expectedNextSequence
  )
}

export function parseMarketplacePublicationCompletionReceipt(
  value: unknown
): MarketplacePublicationCompletionReceiptV1 {
  const source = parseExactManifestRecord(
    value,
    'marketplacePublicationCompletionReceipt',
    COMPLETION_RECEIPT_KEYS,
    COMPLETION_RECEIPT_KEYS
  )
  const reservation = parseMarketplacePublicationReservation({
    requestDigest: source.requestDigest,
    stateDigest: source.stateDigest,
    auditSequence: source.auditSequence,
    auditHead: source.auditHead,
    expectedNextSequence: source.expectedNextSequence
  })
  const publication = parseMarketplacePublication(
    source.publication,
    'marketplacePublicationCompletionReceipt.publication'
  )
  if (
    publication.sequence !== reservation.expectedNextSequence ||
    publication.auditSequence !== reservation.auditSequence ||
    publication.auditHead !== reservation.auditHead
  ) {
    throw new TypeError(
      'marketplacePublicationCompletionReceipt publication does not match its reservation'
    )
  }
  return Object.freeze({
    ...reservation,
    bundleDigest: parseSha256Base64URL(
      source.bundleDigest,
      'marketplacePublicationCompletionReceipt.bundleDigest'
    ),
    completionEventHash: parseSha256Base64URL(
      source.completionEventHash,
      'marketplacePublicationCompletionReceipt.completionEventHash'
    ),
    publication
  })
}

export function assertMarketplacePublicationCompletionReceiptState(
  receiptValue: unknown,
  stateValue: unknown
): MarketplacePublicationCompletionReceiptV1 {
  const receipt = parseMarketplacePublicationCompletionReceipt(receiptValue)
  const state = parseMarketplaceState(stateValue)
  const publication = state.publications.find(
    ({ sequence }) => sequence === receipt.expectedNextSequence
  )
  const event = state.auditEvents.at(receipt.auditSequence)
  if (!event) throw new MarketplacePublicationCompletionConflictError()
  const contexts = state.auditContexts.filter(({ sequence }) => sequence === event.sequence)
  const context = contexts.at(0)
  if (
    !publication ||
    canonicalManifestJSON(publication) !== canonicalManifestJSON(receipt.publication) ||
    event.sequence !== receipt.auditSequence + 1 ||
    event.eventHash !== receipt.completionEventHash ||
    event.action !== 'publication.recorded' ||
    event.subject !== 'publication:global' ||
    event.contextDigest === undefined ||
    contexts.length !== 1 ||
    !context ||
    context.contextDigest !== event.contextDigest ||
    context.reason !== null ||
    context.correlationId !== receipt.requestDigest
  ) {
    throw new MarketplacePublicationCompletionConflictError()
  }
  return receipt
}

export function createMarketplacePublicationCompletionReceipt(
  reservationValue: unknown,
  bundleDigestValue: unknown,
  stateValue: unknown
): MarketplacePublicationCompletionReceiptV1 {
  const reservation = parseMarketplacePublicationReservation(reservationValue)
  const state = parseMarketplaceState(stateValue)
  const publication = state.publications.find(
    ({ sequence }) => sequence === reservation.expectedNextSequence
  )
  const event = state.auditEvents.at(reservation.auditSequence)
  if (!publication || !event) throw new MarketplacePublicationCompletionConflictError()
  return assertMarketplacePublicationCompletionReceiptState(
    {
      ...reservation,
      bundleDigest: parseSha256Base64URL(
        bundleDigestValue,
        'marketplace publication completion bundle digest'
      ),
      completionEventHash: event.eventHash,
      publication
    },
    state
  )
}

export function assertMarketplacePublicationReservationState(
  reservationValue: unknown,
  stateValue: unknown
): MarketplacePublicationReservationV1 {
  const reservation = parseMarketplacePublicationReservation(reservationValue)
  const state = parseMarketplaceState(stateValue)
  if (
    marketplacePublicationStateDigest(state) !== reservation.stateDigest ||
    state.auditEvents.length !== reservation.auditSequence ||
    state.auditEvents.at(-1)?.eventHash !== reservation.auditHead ||
    (state.publications.at(-1)?.sequence ?? 0) + 1 !== reservation.expectedNextSequence
  ) {
    throw new MarketplacePublicationReservationConflictError()
  }
  return reservation
}

export function assertMarketplacePublicationReservationCompletion(
  reservationValue: unknown,
  beforeValue: unknown,
  afterValue: unknown
): MarketplaceStateV1 {
  const reservation = assertMarketplacePublicationReservationState(reservationValue, beforeValue)
  const before = parseMarketplaceState(beforeValue)
  const after = parseMarketplaceState(afterValue)
  const publication = after.publications.at(-1)
  const event = after.auditEvents.at(reservation.auditSequence)
  if (!event) throw new MarketplacePublicationReservationConflictError()
  const contexts = after.auditContexts.filter(({ sequence }) => sequence === event.sequence)
  const context = contexts.at(0)
  if (
    !publication ||
    publication.sequence !== reservation.expectedNextSequence ||
    publication.auditSequence !== reservation.auditSequence ||
    publication.auditHead !== reservation.auditHead ||
    after.auditEvents.length !== before.auditEvents.length + 1 ||
    event.sequence !== reservation.auditSequence + 1 ||
    event.action !== 'publication.recorded' ||
    event.subject !== 'publication:global' ||
    event.contextDigest === undefined ||
    after.auditContexts.length !== before.auditContexts.length + 1 ||
    contexts.length !== 1 ||
    !context ||
    context.contextDigest !== event.contextDigest ||
    context.reason !== null ||
    context.correlationId !== reservation.requestDigest
  ) {
    throw new MarketplacePublicationReservationConflictError()
  }
  return after
}
