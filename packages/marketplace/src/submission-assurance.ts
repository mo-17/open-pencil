import {
  parseBoundedManifestArray,
  parseExactManifestRecord,
  parseSha256Base64URL
} from '@open-pencil/scene-graph'

import { marketplaceAuditPayloadDigest, verifyMarketplaceAuditChain } from './audit'
import {
  MARKETPLACE_LIMITS,
  MARKETPLACE_SUBMISSION_STATUSES,
  canTransitionMarketplaceSubmission,
  parseMarketplaceAuditActor,
  parseMarketplaceIdentity,
  parseMarketplaceReason,
  parseMarketplaceReleaseCoordinate,
  parseMarketplaceState,
  parseMarketplaceTimestamp,
  type MarketplaceReleaseCoordinateV1,
  type MarketplaceSubmissionStatus
} from './types'

export const MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION = 1 as const
export const MARKETPLACE_SUBMISSION_HISTORY_LIMITS = Object.freeze({
  defaultPageLimit: 50,
  maxPageLimit: 100,
  maxOmittedSequences: 100,
  maxQueryBytes: 8 * 1024
})

export const MARKETPLACE_SUBMISSION_CHECK_IDS = Object.freeze([
  'publisher-active',
  'ownership-active',
  'signing-key-active',
  'listing-digest-binding',
  'manifest-artifact-signature-binding',
  'runtime-artifact-signature-binding'
] as const)

export type MarketplaceSubmissionCheckId = (typeof MARKETPLACE_SUBMISSION_CHECK_IDS)[number]
export type MarketplaceSubmissionCheckStatus = 'pass' | 'fail' | 'not_applicable'

const CHECK_MESSAGES: Readonly<
  Record<MarketplaceSubmissionCheckId, Readonly<Record<MarketplaceSubmissionCheckStatus, string>>>
> = Object.freeze({
  'publisher-active': Object.freeze({
    pass: 'Publisher is currently active.',
    fail: 'Publisher is not currently active.',
    not_applicable: 'Publisher check is not applicable.'
  }),
  'ownership-active': Object.freeze({
    pass: 'Plugin ownership is currently active.',
    fail: 'Plugin ownership is not currently active.',
    not_applicable: 'Ownership check is not applicable.'
  }),
  'signing-key-active': Object.freeze({
    pass: 'Submission signing key is currently active and valid.',
    fail: 'Submission signing key is not currently active and valid.',
    not_applicable: 'Signing-key check is not applicable.'
  }),
  'listing-digest-binding': Object.freeze({
    pass: 'Current listing metadata matches its authoritative digest.',
    fail: 'Current listing metadata does not match its authoritative digest.',
    not_applicable: 'Listing-digest check is not applicable.'
  }),
  'manifest-artifact-signature-binding': Object.freeze({
    pass: 'Immutable manifest artifact, signature, and submission binding are valid.',
    fail: 'Immutable manifest artifact, signature, or submission binding is invalid.',
    not_applicable: 'Manifest-artifact check is not applicable.'
  }),
  'runtime-artifact-signature-binding': Object.freeze({
    pass: 'Immutable runtime artifact, signature, and submission binding are valid.',
    fail: 'Immutable runtime artifact, signature, or submission binding is invalid.',
    not_applicable: 'Submission has no runtime artifact.'
  })
})

export interface MarketplaceSubmissionCurrentCheckV1 {
  readonly id: MarketplaceSubmissionCheckId
  readonly status: MarketplaceSubmissionCheckStatus
  readonly message: string
}

export interface MarketplaceSubmissionCurrentCheckBindingV1 {
  readonly submissionId: string
  readonly revision: number
  readonly publisherId: string
  readonly signingKeyId: string | null
  readonly coordinate: MarketplaceReleaseCoordinateV1
  readonly manifestDigest: string
  readonly artifactDigest: string
  readonly listingDigest: string
  readonly runtime: Readonly<{
    packageDigest: string
    artifactDigest: string | null
    byteLength: number
    kind: 'wasm' | 'javascript'
  }> | null
}

export interface MarketplaceSubmissionCurrentCheckReportV1 {
  readonly schemaVersion: typeof MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION
  readonly scope: 'current'
  readonly evaluatedAt: string
  readonly binding: MarketplaceSubmissionCurrentCheckBindingV1
  readonly valid: boolean
  readonly checks: readonly MarketplaceSubmissionCurrentCheckV1[]
}

export type MarketplaceSubmissionReviewDecision = 'approved' | 'changes_requested' | 'rejected'

export interface MarketplaceSubmissionReviewerHistoryItemV1 {
  readonly sequence: number
  readonly time: string
  readonly actor: string
  readonly action: 'submission.review.decision'
  readonly decision: MarketplaceSubmissionReviewDecision
  readonly from: MarketplaceSubmissionStatus
  readonly to: MarketplaceSubmissionReviewDecision
  readonly reason: string
}

export interface MarketplaceSubmissionReviewerHistoryV1 {
  readonly schemaVersion: typeof MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION
  readonly submissionId: string
  readonly complete: boolean
  readonly omittedCount: number
  readonly omittedSequences: readonly number[]
  readonly items: readonly MarketplaceSubmissionReviewerHistoryItemV1[]
  readonly nextBeforeSequence: number | null
}

export interface MarketplaceSubmissionReviewerHistoryQuery {
  readonly limit: number
  readonly beforeSequence?: number
}

const REPORT_KEYS = new Set(['schemaVersion', 'scope', 'evaluatedAt', 'binding', 'valid', 'checks'])
const BINDING_KEYS = new Set([
  'submissionId',
  'revision',
  'publisherId',
  'signingKeyId',
  'coordinate',
  'manifestDigest',
  'artifactDigest',
  'listingDigest',
  'runtime'
])
const RUNTIME_KEYS = new Set(['packageDigest', 'artifactDigest', 'byteLength', 'kind'])
const CHECK_KEYS = new Set(['id', 'status', 'message'])
const HISTORY_KEYS = new Set([
  'schemaVersion',
  'submissionId',
  'complete',
  'omittedCount',
  'omittedSequences',
  'items',
  'nextBeforeSequence'
])
const HISTORY_ITEM_KEYS = new Set([
  'sequence',
  'time',
  'actor',
  'action',
  'decision',
  'from',
  'to',
  'reason'
])
const CHECK_STATUS = new Set<MarketplaceSubmissionCheckStatus>(['pass', 'fail', 'not_applicable'])
const REVIEW_DECISIONS = new Set<MarketplaceSubmissionReviewDecision>([
  'approved',
  'changes_requested',
  'rejected'
])
const REASONED_SUBMISSION_STATUSES = new Set<MarketplaceSubmissionStatus>([
  'validation_failed',
  'changes_requested',
  'rejected',
  'withdrawn',
  'yanked'
])

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${path} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`)
  }
  return value
}

function submissionStatus(value: unknown, path: string): MarketplaceSubmissionStatus {
  if (
    typeof value !== 'string' ||
    !MARKETPLACE_SUBMISSION_STATUSES.includes(value as MarketplaceSubmissionStatus)
  ) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplaceSubmissionStatus
}

function reviewDecision(value: unknown, path: string): MarketplaceSubmissionReviewDecision {
  if (
    typeof value !== 'string' ||
    !REVIEW_DECISIONS.has(value as MarketplaceSubmissionReviewDecision)
  ) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplaceSubmissionReviewDecision
}

function checkStatus(value: unknown, path: string): MarketplaceSubmissionCheckStatus {
  if (typeof value !== 'string' || !CHECK_STATUS.has(value as MarketplaceSubmissionCheckStatus)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as MarketplaceSubmissionCheckStatus
}

export function marketplaceSubmissionCheck(
  id: MarketplaceSubmissionCheckId,
  status: MarketplaceSubmissionCheckStatus
): MarketplaceSubmissionCurrentCheckV1 {
  if (status === 'not_applicable' && id !== 'runtime-artifact-signature-binding') {
    throw new TypeError(`${id} cannot be not_applicable`)
  }
  return Object.freeze({ id, status, message: CHECK_MESSAGES[id][status] })
}

function assertSigningKeyCheckBinding(
  signingKeyId: string | null,
  signingKeyCheck: MarketplaceSubmissionCurrentCheckV1,
  path: string
): void {
  if (signingKeyId === null && signingKeyCheck.status !== 'fail') {
    throw new TypeError(`${path} signing-key binding does not match its check`)
  }
}

export function parseMarketplaceSubmissionCurrentCheckReport(
  value: unknown,
  path = 'marketplaceSubmission.currentCheckReport'
): MarketplaceSubmissionCurrentCheckReportV1 {
  const source = parseExactManifestRecord(value, path, REPORT_KEYS, REPORT_KEYS)
  if (source.schemaVersion !== MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion is not supported`)
  }
  if (source.scope !== 'current') throw new TypeError(`${path}.scope must be current`)
  const bindingSource = parseExactManifestRecord(
    source.binding,
    `${path}.binding`,
    BINDING_KEYS,
    BINDING_KEYS
  )
  const runtimeSource =
    bindingSource.runtime === null
      ? null
      : parseExactManifestRecord(
          bindingSource.runtime,
          `${path}.binding.runtime`,
          RUNTIME_KEYS,
          RUNTIME_KEYS
        )
  const runtime = runtimeSource
    ? Object.freeze({
        packageDigest: parseSha256Base64URL(
          runtimeSource.packageDigest,
          `${path}.binding.runtime.packageDigest`
        ),
        artifactDigest:
          runtimeSource.artifactDigest === null
            ? null
            : parseSha256Base64URL(
                runtimeSource.artifactDigest,
                `${path}.binding.runtime.artifactDigest`
              ),
        byteLength: positiveInteger(runtimeSource.byteLength, `${path}.binding.runtime.byteLength`),
        kind:
          runtimeSource.kind === 'wasm' || runtimeSource.kind === 'javascript'
            ? runtimeSource.kind
            : (() => {
                throw new TypeError(`${path}.binding.runtime.kind is not supported`)
              })()
      })
    : null
  const checks = parseBoundedManifestArray(
    source.checks,
    `${path}.checks`,
    MARKETPLACE_SUBMISSION_CHECK_IDS.length
  ).map((value, index) => {
    const checkPath = `${path}.checks[${index}]`
    const checkSource = parseExactManifestRecord(value, checkPath, CHECK_KEYS, CHECK_KEYS)
    const expectedId = MARKETPLACE_SUBMISSION_CHECK_IDS[index]
    if (checkSource.id !== expectedId) {
      throw new TypeError(`${checkPath}.id is out of order or unsupported`)
    }
    const status = checkStatus(checkSource.status, `${checkPath}.status`)
    if (status === 'not_applicable' && expectedId !== 'runtime-artifact-signature-binding') {
      throw new TypeError(`${checkPath}.status cannot be not_applicable`)
    }
    if (checkSource.message !== CHECK_MESSAGES[expectedId][status]) {
      throw new TypeError(`${checkPath}.message does not match its fixed check result`)
    }
    return Object.freeze({ id: expectedId, status, message: CHECK_MESSAGES[expectedId][status] })
  })
  if (checks.length !== MARKETPLACE_SUBMISSION_CHECK_IDS.length) {
    throw new TypeError(`${path}.checks must contain every stable check`)
  }
  const runtimeCheck = checks.at(-1)
  const signingKeyCheck = checks[2]
  if (
    !runtimeCheck ||
    (runtime === null) !== (runtimeCheck.status === 'not_applicable') ||
    (runtime?.artifactDigest === null && runtimeCheck.status !== 'fail')
  ) {
    throw new TypeError(`${path} runtime binding does not match its check`)
  }
  const signingKeyId =
    bindingSource.signingKeyId === null
      ? null
      : parseMarketplaceIdentity(bindingSource.signingKeyId, `${path}.binding.signingKeyId`)
  assertSigningKeyCheckBinding(signingKeyId, signingKeyCheck, path)
  const valid = source.valid
  if (typeof valid !== 'boolean' || valid !== checks.every(({ status }) => status !== 'fail')) {
    throw new TypeError(`${path}.valid does not match its checks`)
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION,
    scope: 'current',
    evaluatedAt: parseMarketplaceTimestamp(source.evaluatedAt, `${path}.evaluatedAt`),
    binding: Object.freeze({
      submissionId: parseMarketplaceIdentity(
        bindingSource.submissionId,
        `${path}.binding.submissionId`
      ),
      revision: positiveInteger(bindingSource.revision, `${path}.binding.revision`),
      publisherId: parseMarketplaceIdentity(
        bindingSource.publisherId,
        `${path}.binding.publisherId`
      ),
      signingKeyId,
      coordinate: parseMarketplaceReleaseCoordinate(bindingSource.coordinate),
      manifestDigest: parseSha256Base64URL(
        bindingSource.manifestDigest,
        `${path}.binding.manifestDigest`
      ),
      artifactDigest: parseSha256Base64URL(
        bindingSource.artifactDigest,
        `${path}.binding.artifactDigest`
      ),
      listingDigest: parseSha256Base64URL(
        bindingSource.listingDigest,
        `${path}.binding.listingDigest`
      ),
      runtime
    }),
    valid,
    checks: Object.freeze(checks)
  })
}

function boundedQueryInteger(value: string, path: string, maximum?: number): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new TypeError(`${path} must be a positive integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (maximum !== undefined && parsed > maximum)) {
    throw new TypeError(`${path} is outside its allowed range`)
  }
  return parsed
}

export function parseMarketplaceSubmissionReviewerHistoryQuery(
  search: string
): MarketplaceSubmissionReviewerHistoryQuery {
  if (
    new TextEncoder().encode(search).byteLength >
    MARKETPLACE_SUBMISSION_HISTORY_LIMITS.maxQueryBytes
  ) {
    throw new TypeError('Submission reviewer history query exceeds the byte limit')
  }
  const parameters = new URLSearchParams(search)
  const entries = [...parameters.entries()]
  if (entries.some(([key]) => key !== 'limit' && key !== 'beforeSequence')) {
    throw new TypeError('Submission reviewer history query contains unsupported fields')
  }
  for (const key of ['limit', 'beforeSequence']) {
    if (parameters.getAll(key).length > 1) {
      throw new TypeError(`Submission reviewer history query repeats ${key}`)
    }
  }
  const limitValue = parameters.get('limit')
  const beforeValue = parameters.get('beforeSequence')
  return Object.freeze({
    limit:
      limitValue === null
        ? MARKETPLACE_SUBMISSION_HISTORY_LIMITS.defaultPageLimit
        : boundedQueryInteger(
            limitValue,
            'Submission reviewer history limit',
            MARKETPLACE_SUBMISSION_HISTORY_LIMITS.maxPageLimit
          ),
    ...(beforeValue === null
      ? {}
      : {
          beforeSequence: boundedQueryInteger(
            beforeValue,
            'Submission reviewer history beforeSequence',
            MARKETPLACE_LIMITS.maxAuditEvents
          )
        })
  })
}

function parseHistoryItem(
  value: unknown,
  path: string
): MarketplaceSubmissionReviewerHistoryItemV1 {
  const source = parseExactManifestRecord(value, path, HISTORY_ITEM_KEYS, HISTORY_ITEM_KEYS)
  if (source.action !== 'submission.review.decision') {
    throw new TypeError(`${path}.action is not supported`)
  }
  const decision = reviewDecision(source.decision, `${path}.decision`)
  const from = submissionStatus(source.from, `${path}.from`)
  const to = reviewDecision(source.to, `${path}.to`)
  if (decision !== to || !canTransitionMarketplaceSubmission(from, to)) {
    throw new TypeError(`${path} contains an impossible review transition`)
  }
  return Object.freeze({
    sequence: positiveInteger(source.sequence, `${path}.sequence`),
    time: parseMarketplaceTimestamp(source.time, `${path}.time`),
    actor: parseMarketplaceAuditActor(source.actor, `${path}.actor`),
    action: 'submission.review.decision',
    decision,
    from,
    to,
    reason: parseMarketplaceReason(source.reason, `${path}.reason`)
  })
}

export function parseMarketplaceSubmissionReviewerHistory(
  value: unknown,
  path = 'marketplaceSubmission.reviewerHistory'
): MarketplaceSubmissionReviewerHistoryV1 {
  const source = parseExactManifestRecord(value, path, HISTORY_KEYS, HISTORY_KEYS)
  if (source.schemaVersion !== MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION) {
    throw new TypeError(`${path}.schemaVersion is not supported`)
  }
  const omittedCount = nonNegativeInteger(source.omittedCount, `${path}.omittedCount`)
  const omittedSequences = parseBoundedManifestArray(
    source.omittedSequences,
    `${path}.omittedSequences`,
    MARKETPLACE_SUBMISSION_HISTORY_LIMITS.maxOmittedSequences
  ).map((sequence, index) => positiveInteger(sequence, `${path}.omittedSequences[${index}]`))
  if (
    omittedSequences.length > omittedCount ||
    new Set(omittedSequences).size !== omittedSequences.length ||
    omittedSequences.some((sequence, index) => index > 0 && sequence <= omittedSequences[index - 1])
  ) {
    throw new TypeError(`${path}.omittedSequences is inconsistent`)
  }
  const complete = source.complete
  if (typeof complete !== 'boolean' || complete !== (omittedCount === 0)) {
    throw new TypeError(`${path}.complete does not match omittedCount`)
  }
  const items = parseBoundedManifestArray(
    source.items,
    `${path}.items`,
    MARKETPLACE_SUBMISSION_HISTORY_LIMITS.maxPageLimit
  ).map((item, index) => parseHistoryItem(item, `${path}.items[${index}]`))
  if (items.some((item, index) => index > 0 && item.sequence >= items[index - 1].sequence)) {
    throw new TypeError(`${path}.items must be newest-first`)
  }
  const itemSequences = new Set(items.map(({ sequence }) => sequence))
  if (omittedSequences.some((sequence) => itemSequences.has(sequence))) {
    throw new TypeError(`${path}.omittedSequences must not overlap projected items`)
  }
  const nextBeforeSequence =
    source.nextBeforeSequence === null
      ? null
      : positiveInteger(source.nextBeforeSequence, `${path}.nextBeforeSequence`)
  if (
    nextBeforeSequence !== null &&
    (items.length === 0 || nextBeforeSequence !== items.at(-1)?.sequence)
  ) {
    throw new TypeError(`${path}.nextBeforeSequence does not continue from the page boundary`)
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION,
    submissionId: parseMarketplaceIdentity(source.submissionId, `${path}.submissionId`),
    complete,
    omittedCount,
    omittedSequences: Object.freeze(omittedSequences),
    items: Object.freeze(items),
    nextBeforeSequence
  })
}

async function transitionMatches(
  payloadDigest: string,
  submissionId: string,
  reason: string | null
): Promise<readonly { from: MarketplaceSubmissionStatus; to: MarketplaceSubmissionStatus }[]> {
  const candidates: Array<{ from: MarketplaceSubmissionStatus; to: MarketplaceSubmissionStatus }> =
    []
  for (const from of MARKETPLACE_SUBMISSION_STATUSES) {
    for (const to of MARKETPLACE_SUBMISSION_STATUSES) {
      if (!canTransitionMarketplaceSubmission(from, to)) continue
      const payloadReason = REASONED_SUBMISSION_STATUSES.has(to) ? reason : null
      if (payloadReason === null && REASONED_SUBMISSION_STATUSES.has(to)) continue
      if (
        (await marketplaceAuditPayloadDigest({ from, reason: payloadReason, submissionId, to })) ===
        payloadDigest
      ) {
        candidates.push({ from, to })
      }
    }
  }
  return Object.freeze(candidates)
}

export async function createMarketplaceSubmissionReviewerHistory(
  stateValue: unknown,
  submissionIdValue: string,
  query: MarketplaceSubmissionReviewerHistoryQuery
): Promise<MarketplaceSubmissionReviewerHistoryV1 | null> {
  const state = parseMarketplaceState(stateValue)
  const submissionId = parseMarketplaceIdentity(submissionIdValue, 'submission id')
  if (!state.submissions.some(({ id }) => id === submissionId)) return null
  const events = await verifyMarketplaceAuditChain(state.auditEvents)
  const contexts = new Map(state.auditContexts.map((context) => [context.sequence, context]))
  const items: MarketplaceSubmissionReviewerHistoryItemV1[] = []
  const omitted: number[] = []
  for (const event of events) {
    if (
      event.action !== 'submission.status_changed' ||
      event.subject !== `submission:${submissionId}`
    ) {
      continue
    }
    const context = contexts.get(event.sequence)
    const matches = await transitionMatches(
      event.payloadDigest,
      submissionId,
      context?.reason ?? null
    )
    if (matches.length !== 1) {
      omitted.push(event.sequence)
      continue
    }
    const [match] = matches
    if (!REVIEW_DECISIONS.has(match.to as MarketplaceSubmissionReviewDecision)) continue
    if (!context?.reason) {
      omitted.push(event.sequence)
      continue
    }
    const decision = match.to as MarketplaceSubmissionReviewDecision
    items.push(
      Object.freeze({
        sequence: event.sequence,
        time: event.time,
        actor: event.actor,
        action: 'submission.review.decision',
        decision,
        from: match.from,
        to: decision,
        reason: context.reason
      })
    )
  }
  const ordered = items.sort((left, right) => right.sequence - left.sequence)
  const before = query.beforeSequence
  const candidates = before ? ordered.filter(({ sequence }) => sequence < before) : ordered
  const selected = candidates.slice(0, query.limit)
  const nextBeforeSequence =
    candidates.length > selected.length ? (selected.at(-1)?.sequence ?? null) : null
  const omittedSequences = omitted
    .sort((left, right) => left - right)
    .slice(-MARKETPLACE_SUBMISSION_HISTORY_LIMITS.maxOmittedSequences)
  return parseMarketplaceSubmissionReviewerHistory({
    schemaVersion: MARKETPLACE_SUBMISSION_ASSURANCE_SCHEMA_VERSION,
    submissionId,
    complete: omitted.length === 0,
    omittedCount: omitted.length,
    omittedSequences,
    items: selected,
    nextBeforeSequence
  })
}
