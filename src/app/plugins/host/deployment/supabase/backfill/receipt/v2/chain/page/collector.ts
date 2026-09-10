/* oxlint-disable eslint(max-lines), eslint(complexity) -- One bounded provenance and verification boundary is easier to audit as a unit. */

import {
  BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
  createBackendBackfillExecutionReceiptChainVerifierV2,
  type BackendBackfillExecutionErrorCodeV2,
  type BackendBackfillExecutionOutcomeV2,
  type BackendBackfillExecutionReceiptV2
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1,
  type SupabaseBackfillReceiptV2ChainContinuationPageObservationV1,
  type TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1
} from '../continuation-review'
import {
  trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1,
  type SupabaseBackfillReceiptV2ChainFirstPageObservationV1,
  type SupabaseBackfillReceiptV2ChainPageAnchorV1,
  type TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
} from './response'
import { SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE } from './review'
import {
  SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_PAGE_COUNT,
  certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1,
  type SupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1
} from './transport-size-certificate'

export { SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_PAGE_COUNT } from './transport-size-certificate'

export const SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_COLLECTION_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-chain-page-collection.v1' as const

const INPUT_KEYS = ['firstPageObservation', 'continuationPageObservations'] as const

export interface CollectAndVerifySupabaseBackfillReceiptV2ChainForTestingOptionsV1 {
  readonly firstPageObservation: SupabaseBackfillReceiptV2ChainFirstPageObservationV1
  readonly continuationPageObservations: readonly SupabaseBackfillReceiptV2ChainContinuationPageObservationV1[]
}

/**
 * Sanitized local verification evidence. It authenticates neither the injected responses nor the
 * database head that they claim, and therefore never grants transport, database, or release authority.
 */
export interface SupabaseBackfillReceiptV2ChainPageCollectionV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_COLLECTION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly testingOnly: true
  readonly pageCount: number
  readonly receiptCount: number
  readonly decodedReceiptByteLength: number
  readonly maximumDecodedReceiptBytes: number
  readonly decodedAggregateBoundCertified: true
  readonly anchor: Readonly<{
    revision: number
    eventId: string
    receiptDigest: string
    updatedAt: string
  }>
  readonly outcome: BackendBackfillExecutionOutcomeV2
  readonly bindings: Readonly<{
    firstPageObservationDigest: string
    terminalPageObservationDigest: string
    pageSequenceDigest: string
    scopeDigest: string
    expectedHeadDigest: string
    computedHeadDigest: string
  }>
  readonly allPageProvenanceVerified: true
  readonly allReceiptTransitionsVerified: true
  readonly expectedHeadDigestMatched: true
  readonly fullPortableReceiptV2ChainVerified: true
  readonly specificHistoricalInstallationAuthenticated: false
  readonly productionTransportAuthenticated: false
  readonly crossPageHeadFreshnessAuthenticated: false
  readonly automaticRetryAllowed: false
  readonly captureConsumed: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly releaseReady: false
}

export type SupabaseBackfillReceiptV2ChainPageCollectionErrorCode =
  | 'supabase-backfill-receipt-v2-chain-page-collection-input-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-collection-proof-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid'
  | 'supabase-backfill-receipt-v2-chain-page-collection-page-verification-failed'
  | 'supabase-backfill-receipt-v2-chain-page-collection-decoded-aggregate-too-large'
  | 'supabase-backfill-receipt-v2-chain-page-collection-finalization-failed'
  | 'supabase-backfill-receipt-v2-chain-page-collection-digest-failed'

export class SupabaseBackfillReceiptV2ChainPageCollectionError extends Error {
  constructor(
    readonly code: SupabaseBackfillReceiptV2ChainPageCollectionErrorCode,
    readonly verifierCode: BackendBackfillExecutionErrorCodeV2 | null = null
  ) {
    super(`Supabase backfill Receipt V2 chain page collection failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ChainPageCollectionError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

interface PageRuntimeViewV1 {
  readonly reportedStatus: unknown
  readonly status: unknown
  readonly reportedInstallMarkerDigestMatchesHistorical: unknown
  readonly productionTransportAuthenticated: unknown
  readonly fullPortableReceiptV2ChainVerified: unknown
  readonly releaseReady: unknown
}

interface CollectedPageV1 {
  readonly observation:
    | SupabaseBackfillReceiptV2ChainFirstPageObservationV1
    | SupabaseBackfillReceiptV2ChainContinuationPageObservationV1
  readonly context:
    | TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
    | TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1
  readonly canonicalReceipts: readonly BackendBackfillExecutionReceiptV2[]
}

function fail(
  code: SupabaseBackfillReceiptV2ChainPageCollectionErrorCode,
  verifierCode: BackendBackfillExecutionErrorCodeV2 | null = null
): never {
  throw new SupabaseBackfillReceiptV2ChainPageCollectionError(code, verifierCode)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  return descriptor.value
}

function exactInput(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object') {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    if (Array.isArray(value)) {
      return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
    }
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== INPUT_KEYS.length ||
    keys.some(
      (key) => typeof key !== 'string' || !INPUT_KEYS.some((expectedKey) => expectedKey === key)
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  return Object.freeze({
    firstPageObservation: ownData(value, 'firstPageObservation'),
    continuationPageObservations: ownData(value, 'continuationPageObservations')
  })
}

function exactContinuationPages(
  value: unknown
): readonly SupabaseBackfillReceiptV2ChainContinuationPageObservationV1[] {
  let array: unknown[]
  try {
    if (!Array.isArray(value)) {
      return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
    }
    array = value
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    prototype = Object.getPrototypeOf(array)
    keys = Reflect.ownKeys(array)
    lengthDescriptor = Object.getOwnPropertyDescriptor(array, 'length')
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  const length = lengthDescriptor?.value
  const maximumContinuationPageCount = SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_PAGE_COUNT - 1
  if (
    prototype !== Array.prototype ||
    !Object.hasOwn(lengthDescriptor ?? {}, 'value') ||
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximumContinuationPageCount ||
    keys.length !== length + 1 ||
    keys.some((key) =>
      key === 'length'
        ? false
        : typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-input-invalid')
  }
  const pages: SupabaseBackfillReceiptV2ChainContinuationPageObservationV1[] = []
  for (let index = 0; index < length; index += 1) {
    const page = ownData(array, String(index))
    pages.push(page as SupabaseBackfillReceiptV2ChainContinuationPageObservationV1)
  }
  return Object.freeze(pages)
}

function sameAnchor(
  left: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>,
  right: Readonly<SupabaseBackfillReceiptV2ChainPageAnchorV1>
): boolean {
  return (
    left.revision === right.revision &&
    left.eventId === right.eventId &&
    left.receiptDigest === right.receiptDigest &&
    left.updatedAt === right.updatedAt
  )
}

function pageStatusIsUsable(
  observation:
    | SupabaseBackfillReceiptV2ChainFirstPageObservationV1
    | SupabaseBackfillReceiptV2ChainContinuationPageObservationV1,
  expectedStatus: 'page-ready' | 'chain-complete'
): boolean {
  const runtime = observation as PageRuntimeViewV1
  return (
    runtime.reportedStatus === expectedStatus &&
    runtime.status === expectedStatus &&
    runtime.reportedInstallMarkerDigestMatchesHistorical === true &&
    runtime.productionTransportAuthenticated === false &&
    runtime.fullPortableReceiptV2ChainVerified === false &&
    runtime.releaseReady === false
  )
}

function requireAnchor(
  firstPage: SupabaseBackfillReceiptV2ChainFirstPageObservationV1
): Readonly<{ revision: number; eventId: string; receiptDigest: string; updatedAt: string }> {
  const anchor = firstPage.anchor
  if (
    anchor.revision === null ||
    !Number.isSafeInteger(anchor.revision) ||
    anchor.revision < 1 ||
    anchor.revision > BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS ||
    anchor.eventId === null ||
    anchor.receiptDigest === null ||
    anchor.updatedAt === null
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
  }
  return Object.freeze({
    revision: anchor.revision,
    eventId: anchor.eventId,
    receiptDigest: anchor.receiptDigest,
    updatedAt: anchor.updatedAt
  })
}

function collectTrustedPages(
  firstPageValue: unknown,
  continuationValues: readonly SupabaseBackfillReceiptV2ChainContinuationPageObservationV1[]
): Readonly<{
  pages: readonly CollectedPageV1[]
  anchor: Readonly<{ revision: number; eventId: string; receiptDigest: string; updatedAt: string }>
}> {
  const firstContext =
    trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(firstPageValue)
  if (!firstContext || firstContext.observation !== firstPageValue) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-proof-invalid')
  }
  const firstPage = firstContext.observation
  const anchor = requireAnchor(firstPage)
  const expectedPageCount = Math.ceil(
    anchor.revision / SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_SIZE
  )
  if (
    expectedPageCount < 1 ||
    expectedPageCount > SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_MAX_PAGE_COUNT ||
    continuationValues.length !== expectedPageCount - 1 ||
    firstContext.receipts.length === 0 ||
    !pageStatusIsUsable(
      firstPage,
      continuationValues.length === 0 ? 'chain-complete' : 'page-ready'
    )
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
  }
  const pages: CollectedPageV1[] = [
    Object.freeze({
      observation: firstPage,
      context: firstContext,
      canonicalReceipts: firstContext.receipts
    })
  ]
  let previousContext:
    | TrustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1
    | TrustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1 = firstContext
  let previousLastRevision = firstPage.facts.pageLastRevision
  for (const [index, continuationValue] of continuationValues.entries()) {
    const context =
      trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(continuationValue)
    if (
      !context ||
      context.observation !== continuationValue ||
      context.reviewContext.sourceObservationContext !== previousContext ||
      context.reviewContext.firstPageReviewContext !== firstContext.reviewContext
    ) {
      return fail('supabase-backfill-receipt-v2-chain-page-collection-proof-invalid')
    }
    const observation = context.observation
    const terminal = index === continuationValues.length - 1
    if (
      previousLastRevision === null ||
      observation.afterRevision !== previousLastRevision ||
      !sameAnchor(observation.anchor, anchor) ||
      !sameAnchor(observation.currentHead, anchor) ||
      !pageStatusIsUsable(observation, terminal ? 'chain-complete' : 'page-ready')
    ) {
      return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
    }
    pages.push(
      Object.freeze({
        observation,
        context,
        canonicalReceipts: context.canonicalReceipts
      })
    )
    previousContext = context
    previousLastRevision = observation.facts.pageLastRevision
  }
  const receiptCount = pages.reduce((count, page) => count + page.canonicalReceipts.length, 0)
  const terminalPage = pages.at(-1)
  const terminalReceipt = terminalPage?.canonicalReceipts.at(-1)
  if (
    receiptCount !== anchor.revision ||
    previousLastRevision !== anchor.revision ||
    terminalReceipt?.databaseHeadVersion !== anchor.revision ||
    terminalReceipt.databaseEventId !== anchor.eventId
  ) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
  }
  return Object.freeze({ pages: Object.freeze(pages), anchor })
}

function trustedPagesRemainCurrent(pages: readonly CollectedPageV1[]): boolean {
  for (const [index, page] of pages.entries()) {
    if (index === 0) {
      if (
        trustedSupabaseBackfillReceiptV2ChainFirstPageObservationContextV1(page.observation) !==
        page.context
      ) {
        return false
      }
      continue
    }
    if (
      trustedSupabaseBackfillReceiptV2ChainContinuationPageObservationContextV1(
        page.observation
      ) !== page.context
    ) {
      return false
    }
  }
  return true
}

async function pageObservationDigests(
  pages: readonly CollectedPageV1[]
): Promise<readonly string[]> {
  try {
    return Object.freeze(
      await Promise.all(pages.map(({ observation }) => digestCanonicalManifest(observation)))
    )
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-digest-failed')
  }
}

function certifyDecodedAggregate(
  pages: readonly CollectedPageV1[]
): SupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1 {
  let decodedReceiptByteLength = 0
  for (const page of pages) {
    if (page.observation.receipts.length !== page.canonicalReceipts.length) {
      return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
    }
    for (const receipt of page.observation.receipts) {
      const byteLength = receipt.canonicalReceiptByteLength
      if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
        return fail('supabase-backfill-receipt-v2-chain-page-collection-sequence-invalid')
      }
      decodedReceiptByteLength += byteLength
      try {
        certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1(decodedReceiptByteLength)
      } catch {
        return fail(
          'supabase-backfill-receipt-v2-chain-page-collection-decoded-aggregate-too-large'
        )
      }
    }
  }
  try {
    return certifySupabaseBackfillReceiptV2ChainDecodedAggregateSizeV1(decodedReceiptByteLength)
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-decoded-aggregate-too-large')
  }
}

/**
 * Verify a complete, already parsed page sequence with one provider-neutral incremental verifier.
 * No request is sent and no supplied read is promoted to authenticated database evidence.
 */
export async function collectAndVerifySupabaseBackfillReceiptV2ChainForTestingV1(
  input: CollectAndVerifySupabaseBackfillReceiptV2ChainForTestingOptionsV1
): Promise<SupabaseBackfillReceiptV2ChainPageCollectionV1> {
  const source = exactInput(input)
  const firstPageValue = ownData(source, 'firstPageObservation')
  const continuationValues = exactContinuationPages(ownData(source, 'continuationPageObservations'))
  const collected = collectTrustedPages(firstPageValue, continuationValues)
  const firstPage = collected.pages[0]
  const firstReceipt = firstPage.canonicalReceipts[0]
  if (!trustedPagesRemainCurrent(collected.pages)) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-proof-invalid')
  }
  const decodedAggregate = certifyDecodedAggregate(collected.pages)
  const verifier = await createBackendBackfillExecutionReceiptChainVerifierV2({
    scope: firstReceipt.scope,
    expectedHeadDigest: collected.anchor.receiptDigest,
    evaluatedAt: firstPage.observation.snapshot.observedAt
  })
  let acceptedReceiptCount = 0
  for (const page of collected.pages) {
    const appended = await verifier.appendPage(page.canonicalReceipts)
    acceptedReceiptCount += page.canonicalReceipts.length
    if (!appended.ok || appended.receiptCount !== acceptedReceiptCount) {
      return fail(
        'supabase-backfill-receipt-v2-chain-page-collection-page-verification-failed',
        appended.ok ? null : appended.code
      )
    }
  }
  const finalized = await verifier.finalize()
  if (
    !finalized.ok ||
    finalized.receiptCount !== collected.anchor.revision ||
    finalized.lastDatabaseHeadVersion !== collected.anchor.revision ||
    finalized.computedHeadDigest !== collected.anchor.receiptDigest ||
    finalized.outcome === 'not-started'
  ) {
    return fail(
      'supabase-backfill-receipt-v2-chain-page-collection-finalization-failed',
      finalized.ok ? null : finalized.code
    )
  }
  const observationDigests = await pageObservationDigests(collected.pages)
  const firstPageObservationDigest = observationDigests[0]
  const terminalPageObservationDigest = observationDigests.at(-1)
  if (terminalPageObservationDigest === undefined) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-digest-failed')
  }
  let pageSequenceDigest: string
  try {
    pageSequenceDigest = await digestCanonicalManifest(
      Object.freeze({
        format: 'openpencil.supabase-backfill-receipt-v2-chain-page-sequence.v1' as const,
        version: 1 as const,
        anchor: collected.anchor,
        pageObservationDigests
      })
    )
  } catch {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-digest-failed')
  }
  if (!trustedPagesRemainCurrent(collected.pages)) {
    return fail('supabase-backfill-receipt-v2-chain-page-collection-proof-invalid')
  }
  return Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_CHAIN_PAGE_COLLECTION_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    testingOnly: true as const,
    pageCount: collected.pages.length,
    receiptCount: finalized.receiptCount,
    decodedReceiptByteLength: decodedAggregate.decodedReceiptByteLength,
    maximumDecodedReceiptBytes: decodedAggregate.maximumDecodedReceiptBytes,
    decodedAggregateBoundCertified: decodedAggregate.decodedAggregateBoundCertified,
    anchor: collected.anchor,
    outcome: finalized.outcome,
    bindings: Object.freeze({
      firstPageObservationDigest,
      terminalPageObservationDigest,
      pageSequenceDigest,
      scopeDigest: finalized.scopeDigest,
      expectedHeadDigest: collected.anchor.receiptDigest,
      computedHeadDigest: finalized.computedHeadDigest
    }),
    allPageProvenanceVerified: true as const,
    allReceiptTransitionsVerified: true as const,
    expectedHeadDigestMatched: true as const,
    fullPortableReceiptV2ChainVerified: true as const,
    specificHistoricalInstallationAuthenticated: false as const,
    productionTransportAuthenticated: false as const,
    crossPageHeadFreshnessAuthenticated: false as const,
    automaticRetryAllowed: false as const,
    captureConsumed: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    releaseReady: false as const
  }) satisfies SupabaseBackfillReceiptV2ChainPageCollectionV1
}
