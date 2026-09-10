import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  trustedSupabaseBackfillLockedHighWaterCaptureContextV1,
  trustedSupabaseBackfillLockedHighWaterCaptureV1,
  type SupabaseBackfillLockedHighWaterCaptureV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'

export const SUPABASE_BACKFILL_RECEIPT_V2_REVIEW_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-review.v1' as const
export const SUPABASE_BACKFILL_RECEIPT_V2_SCOPE_DRAFT_FORMAT =
  'openpencil.supabase-backfill-receipt-v2-scope-draft.v1' as const

export interface CreateSupabaseBackfillReceiptV2ReviewOptionsV1 {
  readonly capture: SupabaseBackfillLockedHighWaterCaptureV1
}

export interface SupabaseBackfillReceiptV2ScopeDraftV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_SCOPE_DRAFT_FORMAT
  readonly version: 1
  readonly receiptVersion: 2
  readonly providerId: 'supabase'
  readonly environment: 'staging'
  readonly applicationId: string
  readonly applicationDigest: string
  readonly migrationId: string
  readonly migrationDigest: string
  readonly migrationPlanDigest: string
  readonly sourceLedgerDigest: null
  readonly captureDigest: string
  readonly providerAuthorityDigest: string
  readonly sourceReviewDigest: string
  readonly installedVerificationDigest: string
  readonly backendPlanDigest: string
  readonly adapterPlanDigest: string
  readonly manifestDigest: string
  readonly catalogPreconditionDigest: string
  readonly resourceIdentityDigest: string
  readonly entityId: string
  readonly cursorField: string
  readonly cursorFieldType: 'integer'
  readonly targetField: string
  readonly batchSize: number
  readonly maximumReceiptCount: number
  readonly maximumBatchCount: number
  readonly capturedHighWater: number | null
  readonly initialRemainingEligibleRowCount: number
  readonly initialRemainingTargetRowCount: number
  readonly requiredBatchCount: number
  readonly requiredMatchedRowCount: number | null
  readonly resumePolicy: 'from-receipt'
  readonly receiptZeroEvidenceDigest: string
  readonly completionRule: 'database-terminal-exhaustion-and-postconditions'
}

export interface SupabaseBackfillReceiptV2ReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_RECEIPT_V2_REVIEW_FORMAT
  readonly version: 1
  readonly receiptVersion: 2
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly reviewOnly: true
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly bindings: Readonly<{
    subjectDigest: string
    sourceReviewDigest: string
    captureReviewDigest: string
    captureDigest: string
    appliedSingleFlightKey: string
    installedVerificationDigest: string
    installDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    backendPlanDigest: string
    adapterPlanDigest: string
    manifestDigest: string
    migrationDigest: string
    catalogPreconditionDigest: string
    queryDigest: string
    scopeDraftDigest: string
  }>
  readonly authority: SupabaseBackfillLockedHighWaterCaptureV1['authority']
  readonly address: SupabaseBackfillLockedHighWaterCaptureV1['address']
  readonly scopeDraft: SupabaseBackfillReceiptV2ScopeDraftV1
  readonly receiptPolicy: Readonly<{
    databaseCASRequired: true
    databaseHead: 'monotonic-revision-and-immutable-event-id'
    scanEveryCursorRow: true
    updateOnlyMatchingRows: true
    maximumScannedRowsPerBatch: number
    maximumMutatedRowsPerBatch: number
    statementTimeoutRequired: true
    terminalExhaustionCheckedInMutationTransaction: true
    terminalReceiptMayHaveZeroRows: true
    completionRequiresCursorToEqualHighWater: false
    outcomeUnknownPersistedAsReceipt: false
    automaticUnknownOutcomeRetryAllowed: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillReceiptV2ReviewEnvelopeV1 {
  readonly review: SupabaseBackfillReceiptV2ReviewV1
  readonly reviewDigest: string
}

export interface TrustedSupabaseBackfillReceiptV2ReviewContextV1 {
  readonly envelope: SupabaseBackfillReceiptV2ReviewEnvelopeV1
  readonly capture: SupabaseBackfillLockedHighWaterCaptureV1
}

export type SupabaseBackfillReceiptV2ReviewErrorCode =
  | 'supabase-backfill-receipt-v2-input-invalid'
  | 'supabase-backfill-receipt-v2-capture-proof-invalid'
  | 'supabase-backfill-receipt-v2-input-changed'
  | 'supabase-backfill-receipt-v2-digest-failed'

export class SupabaseBackfillReceiptV2ReviewError extends Error {
  constructor(readonly code: SupabaseBackfillReceiptV2ReviewErrorCode) {
    super(`Supabase backfill Receipt V2 review failed: ${code}.`)
    this.name = 'SupabaseBackfillReceiptV2ReviewError'
  }
}

interface UnknownRecord {
  [key: PropertyKey]: unknown
}

const OPTION_KEYS = ['capture'] as const
const trustedReviews = new WeakMap<object, TrustedSupabaseBackfillReceiptV2ReviewContextV1>()

function fail(code: SupabaseBackfillReceiptV2ReviewErrorCode): never {
  throw new SupabaseBackfillReceiptV2ReviewError(code)
}

function ownData(value: object, key: PropertyKey): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  return descriptor.value
}

function exactOptions(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  let prototype: object | null
  let keys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    keys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    keys.length !== OPTION_KEYS.length ||
    keys.some((key) => typeof key !== 'string' || !OPTION_KEYS.includes(key as never))
  ) {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  for (const key of OPTION_KEYS) ownData(value, key)
  return value as UnknownRecord
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-receipt-v2-digest-failed')
  }
}

function reviewBlockers(capture: SupabaseBackfillLockedHighWaterCaptureV1): readonly string[] {
  const blockers = capture.blockers.map((blocker) =>
    blocker === 'provider-v2-receipt-binding-not-implemented'
      ? 'receipt-v2-authority-not-created'
      : blocker
  )
  return Object.freeze([...new Set(blockers)])
}

function requireCaptureBindings(
  capture: SupabaseBackfillLockedHighWaterCaptureV1
): ReturnType<typeof trustedSupabaseBackfillLockedHighWaterCaptureContextV1> {
  const context = trustedSupabaseBackfillLockedHighWaterCaptureContextV1(capture)
  if (!context) return fail('supabase-backfill-receipt-v2-capture-proof-invalid')
  const subject = context.subject
  const bindingsMatch = [
    capture.bindings.subjectDigest === context.subjectDigest,
    capture.bindings.providerAuthorityDigest === subject.providerAuthority.digest,
    capture.bindings.applicationId === subject.application.id,
    capture.bindings.applicationDigest === subject.application.digest,
    capture.bindings.backendPlanDigest === subject.plan.digest,
    capture.bindings.adapterPlanDigest === subject.plan.adapterPlanDigest,
    capture.bindings.manifestDigest === subject.emission.manifestDigest,
    capture.bindings.migrationId === subject.migration.id,
    capture.bindings.migrationDigest === subject.migration.digest,
    capture.address.tableName === subject.migration.entity.table,
    capture.address.cursorField === subject.migration.cursor.field,
    capture.address.targetField === subject.migration.target.field,
    capture.highWater.maximumBatchReceiptCount === subject.migration.maximumBatchReceiptCount,
    capture.highWater.requiredBatchReceiptCount <= subject.migration.maximumBatchReceiptCount
  ].every(Boolean)
  if (!bindingsMatch) {
    return fail('supabase-backfill-receipt-v2-input-changed')
  }
  const required = Math.ceil(capture.highWater.totalRowCount / subject.migration.batchSize)
  if (required !== capture.highWater.requiredBatchReceiptCount) {
    return fail('supabase-backfill-receipt-v2-input-changed')
  }
  return context
}

/**
 * Derive a canonical, provider-bound Receipt V2 scope draft from one genuine locked capture.
 * This is review material only: it deliberately creates no IDs, CAS head, receipt, or execution
 * permit, and it does not consume the capture reserved for database-ledger initialization.
 */
export async function createSupabaseBackfillReceiptV2ReviewV1(
  input: CreateSupabaseBackfillReceiptV2ReviewOptionsV1
): Promise<SupabaseBackfillReceiptV2ReviewEnvelopeV1> {
  const options = exactOptions(input)
  const captureValue = ownData(options, 'capture')
  if (captureValue === null || typeof captureValue !== 'object') {
    return fail('supabase-backfill-receipt-v2-input-invalid')
  }
  const capture = captureValue as SupabaseBackfillLockedHighWaterCaptureV1
  const context = requireCaptureBindings(capture)
  if (!context) return fail('supabase-backfill-receipt-v2-capture-proof-invalid')
  const subject = context.subject
  const resourceIdentityDigest = await digest(
    Object.freeze({
      format: 'openpencil.supabase-backfill-resource-identity.v1' as const,
      projectRef: capture.authority.projectRef,
      address: capture.address
    })
  )
  const scopeDraft = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_SCOPE_DRAFT_FORMAT,
    version: 1 as const,
    receiptVersion: 2 as const,
    providerId: 'supabase' as const,
    environment: 'staging' as const,
    applicationId: subject.application.id,
    applicationDigest: subject.application.digest,
    migrationId: subject.migration.id,
    migrationDigest: subject.migration.digest,
    migrationPlanDigest: subject.emission.artifacts.migrationPlan.digest,
    sourceLedgerDigest: null,
    captureDigest: capture.captureDigest,
    providerAuthorityDigest: subject.providerAuthority.digest,
    sourceReviewDigest: capture.bindings.sourceReviewDigest,
    installedVerificationDigest: capture.bindings.installedVerificationDigest,
    backendPlanDigest: subject.plan.digest,
    adapterPlanDigest: subject.plan.adapterPlanDigest,
    manifestDigest: subject.emission.manifestDigest,
    catalogPreconditionDigest: capture.bindings.catalogPreconditionDigest,
    resourceIdentityDigest,
    entityId: subject.migration.entity.id,
    cursorField: subject.migration.cursor.field,
    cursorFieldType: 'integer' as const,
    targetField: subject.migration.target.field,
    batchSize: subject.migration.batchSize,
    maximumReceiptCount: subject.migration.maximumReceiptCount,
    maximumBatchCount: subject.migration.maximumBatchReceiptCount,
    capturedHighWater: capture.highWater.capturedHighWater,
    initialRemainingEligibleRowCount: capture.highWater.totalRowCount,
    initialRemainingTargetRowCount: capture.highWater.remainingNullTargetRowCount,
    requiredBatchCount: capture.highWater.requiredBatchReceiptCount,
    requiredMatchedRowCount: subject.migration.requiredMatchedRowCount,
    resumePolicy: 'from-receipt' as const,
    receiptZeroEvidenceDigest: capture.captureDigest,
    completionRule: 'database-terminal-exhaustion-and-postconditions' as const
  }) satisfies SupabaseBackfillReceiptV2ScopeDraftV1
  const scopeDraftDigest = await digest(scopeDraft)
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_RECEIPT_V2_REVIEW_FORMAT,
    version: 1 as const,
    receiptVersion: 2 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    reviewOnly: true as const,
    releaseReady: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    bindings: Object.freeze({
      subjectDigest: capture.bindings.subjectDigest,
      sourceReviewDigest: capture.bindings.sourceReviewDigest,
      captureReviewDigest: capture.bindings.captureReviewDigest,
      captureDigest: capture.captureDigest,
      appliedSingleFlightKey: capture.bindings.appliedSingleFlightKey,
      installedVerificationDigest: capture.bindings.installedVerificationDigest,
      installDigest: capture.bindings.installDigest,
      providerAuthorityDigest: capture.bindings.providerAuthorityDigest,
      applicationDigest: capture.bindings.applicationDigest,
      backendPlanDigest: capture.bindings.backendPlanDigest,
      adapterPlanDigest: capture.bindings.adapterPlanDigest,
      manifestDigest: capture.bindings.manifestDigest,
      migrationDigest: capture.bindings.migrationDigest,
      catalogPreconditionDigest: capture.bindings.catalogPreconditionDigest,
      queryDigest: capture.bindings.queryDigest,
      scopeDraftDigest
    }),
    authority: capture.authority,
    address: capture.address,
    scopeDraft,
    receiptPolicy: Object.freeze({
      databaseCASRequired: true as const,
      databaseHead: 'monotonic-revision-and-immutable-event-id' as const,
      scanEveryCursorRow: true as const,
      updateOnlyMatchingRows: true as const,
      maximumScannedRowsPerBatch: subject.migration.batchSize,
      maximumMutatedRowsPerBatch: subject.migration.batchSize,
      statementTimeoutRequired: true as const,
      terminalExhaustionCheckedInMutationTransaction: true as const,
      terminalReceiptMayHaveZeroRows: true as const,
      completionRequiresCursorToEqualHighWater: false as const,
      outcomeUnknownPersistedAsReceipt: false as const,
      automaticUnknownOutcomeRetryAllowed: false as const
    }),
    blockers: reviewBlockers(capture)
  }) satisfies SupabaseBackfillReceiptV2ReviewV1
  const envelope = Object.freeze({ review, reviewDigest: await digest(review) })
  trustedReviews.set(envelope, Object.freeze({ envelope, capture }))
  return envelope
}

/** Return process-local review context without upgrading it to execution authority. */
export function trustedSupabaseBackfillReceiptV2ReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillReceiptV2ReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedReviews.get(value)
  if (!context || !trustedSupabaseBackfillLockedHighWaterCaptureV1(context.capture)) return null
  return context
}
