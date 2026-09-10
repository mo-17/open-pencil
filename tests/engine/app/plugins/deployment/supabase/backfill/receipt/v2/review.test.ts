import { describe, expect, test } from 'bun:test'

import {
  consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1,
  trustedSupabaseBackfillLockedHighWaterCaptureContextV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  createSupabaseBackfillReceiptV2ReviewV1,
  SupabaseBackfillReceiptV2ReviewError,
  trustedSupabaseBackfillReceiptV2ReviewContextV1,
  type SupabaseBackfillReceiptV2ReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'

import {
  BACKFILL_CAPTURE_FIXTURE_PAT,
  createCapturedBackfillLockedHighWaterFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'

async function reviewError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillReceiptV2ReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillReceiptV2ReviewError)
    expect((cause as SupabaseBackfillReceiptV2ReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected Receipt V2 review error ${expected}`)
}

describe('Supabase backfill Receipt V2 review', () => {
  test('derives one deterministic provider-bound scope without creating authority', async () => {
    const { capture, fixture } = await createCapturedBackfillLockedHighWaterFixture()
    const first = await createSupabaseBackfillReceiptV2ReviewV1({ capture })
    const repeated = await createSupabaseBackfillReceiptV2ReviewV1({ capture })

    expect(repeated).toEqual(first)
    expect(repeated).not.toBe(first)
    expect(first.review).toMatchObject({
      format: 'openpencil.supabase-backfill-receipt-v2-review.v1',
      version: 1,
      receiptVersion: 2,
      providerId: 'supabase',
      environmentIntent: 'staging',
      reviewOnly: true,
      releaseReady: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      scopeDraft: {
        format: 'openpencil.supabase-backfill-receipt-v2-scope-draft.v1',
        receiptVersion: 2,
        applicationId: capture.bindings.applicationId,
        migrationId: capture.bindings.migrationId,
        sourceLedgerDigest: null,
        entityId: 'accounts',
        cursorFieldType: 'integer',
        batchSize: 250,
        maximumReceiptCount: 10_000,
        maximumBatchCount: 9_999,
        capturedHighWater: 42,
        initialRemainingEligibleRowCount: 42,
        initialRemainingTargetRowCount: 17,
        requiredBatchCount: 1,
        requiredMatchedRowCount: 1,
        completionRule: 'database-terminal-exhaustion-and-postconditions'
      },
      receiptPolicy: {
        databaseCASRequired: true,
        databaseHead: 'monotonic-revision-and-immutable-event-id',
        scanEveryCursorRow: true,
        updateOnlyMatchingRows: true,
        maximumScannedRowsPerBatch: 250,
        maximumMutatedRowsPerBatch: 250,
        terminalExhaustionCheckedInMutationTransaction: true,
        terminalReceiptMayHaveZeroRows: true,
        completionRequiresCursorToEqualHighWater: false,
        outcomeUnknownPersistedAsReceipt: false,
        automaticUnknownOutcomeRetryAllowed: false
      }
    })
    expect(first.review.bindings.captureDigest).toBe(capture.captureDigest)
    expect(first.review.bindings.scopeDraftDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review.scopeDraft.migrationPlanDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review.scopeDraft.resourceIdentityDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.reviewDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review.blockers).toContain('receipt-v2-authority-not-created')
    expect(first.review.blockers).not.toContain('provider-v2-receipt-binding-not-implemented')
    expect(first.review.blockers).toContain('database-batch-ledger-not-implemented')
    expect(first.review.blockers).toContain('execution-runner-unavailable')
    expect(trustedSupabaseBackfillReceiptV2ReviewContextV1(first)?.capture).toBe(capture)
    expect(trustedSupabaseBackfillReceiptV2ReviewContextV1(structuredClone(first))).toBeNull()
    expect(trustedSupabaseBackfillLockedHighWaterCaptureContextV1(capture)?.capture).toBe(capture)
    expect(JSON.stringify(first)).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)
    expect(JSON.stringify(first)).not.toContain(fixture.captureReview.captureSql)
  })

  test('keeps empty and already-filled captures explicit without inventing a receipt', async () => {
    const empty = await createCapturedBackfillLockedHighWaterFixture(250, {
      capturedHighWater: null,
      minimumCursor: null,
      totalRowCount: '0',
      remainingNullTargetRowCount: '0',
      requiredBatchReceiptCount: '0'
    })
    const emptyReview = await createSupabaseBackfillReceiptV2ReviewV1({
      capture: empty.capture
    })
    expect(emptyReview.review.scopeDraft).toMatchObject({
      capturedHighWater: null,
      initialRemainingEligibleRowCount: 0,
      initialRemainingTargetRowCount: 0,
      requiredBatchCount: 0
    })

    const filled = await createCapturedBackfillLockedHighWaterFixture(250, {
      capturedHighWater: '3000',
      minimumCursor: '1',
      totalRowCount: '3000',
      remainingNullTargetRowCount: '0',
      requiredBatchReceiptCount: '12'
    })
    const filledReview = await createSupabaseBackfillReceiptV2ReviewV1({
      capture: filled.capture
    })
    expect(filledReview.review.scopeDraft).toMatchObject({
      capturedHighWater: 3000,
      initialRemainingEligibleRowCount: 3000,
      initialRemainingTargetRowCount: 0,
      requiredBatchCount: 12
    })
    expect(filledReview.review.receiptAuthorityCreated).toBe(false)
  })

  test('rejects serialized proofs and hostile option records before granting review identity', async () => {
    const { capture } = await createCapturedBackfillLockedHighWaterFixture()
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1({ capture: structuredClone(capture) }),
      'supabase-backfill-receipt-v2-capture-proof-invalid'
    )
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1({ capture, extra: true } as never),
      'supabase-backfill-receipt-v2-input-invalid'
    )
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1(
        Object.assign(Object.create({ inherited: true }), { capture })
      ),
      'supabase-backfill-receipt-v2-input-invalid'
    )

    let getterCalls = 0
    const accessor = {}
    Object.defineProperty(accessor, 'capture', {
      enumerable: true,
      get() {
        getterCalls += 1
        return capture
      }
    })
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1(accessor as never),
      'supabase-backfill-receipt-v2-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const symbolInput = { capture } as Record<PropertyKey, unknown>
    symbolInput[Symbol('extra')] = true
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1(symbolInput as never),
      'supabase-backfill-receipt-v2-input-invalid'
    )
  })

  test('keeps review non-consuming and makes the future ledger handoff one-shot', async () => {
    const { capture } = await createCapturedBackfillLockedHighWaterFixture()
    const first = await createSupabaseBackfillReceiptV2ReviewV1({ capture })
    await createSupabaseBackfillReceiptV2ReviewV1({ capture })

    expect(trustedSupabaseBackfillReceiptV2ReviewContextV1(first)).not.toBeNull()
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(capture)?.capture).toBe(capture)
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(capture)).toBeNull()
    expect(trustedSupabaseBackfillLockedHighWaterCaptureContextV1(capture)).toBeNull()
    expect(trustedSupabaseBackfillReceiptV2ReviewContextV1(first)).toBeNull()
    await reviewError(
      createSupabaseBackfillReceiptV2ReviewV1({ capture }),
      'supabase-backfill-receipt-v2-capture-proof-invalid'
    )
  })
})
