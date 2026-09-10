/* eslint-disable max-lines -- the Receipt V2 state-machine matrix stays together to share canonical chain fixtures */
import { describe, expect, test } from 'bun:test'

import {
  BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE,
  BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT,
  BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
  BACKEND_BACKFILL_EXECUTION_V2_MAX_VERIFICATION_PAGE_RECEIPTS,
  BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT,
  BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY,
  BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
  BACKEND_BACKFILL_EXECUTION_V2_VERSION,
  canonicalBackendBackfillExecutionReceiptV2Bytes,
  canonicalBackendBackfillExecutionScopeV2Bytes,
  createBackendBackfillExecutionReceiptChainVerifierV2,
  digestBackendBackfillExecutionReceiptV2,
  digestBackendBackfillExecutionScopeV2,
  parseBackendBackfillExecutionReceiptV2,
  parseBackendBackfillExecutionScopeV2,
  verifyBackendBackfillExecutionReceiptChainV2,
  type BackendBackfillExecutionBatchCountsV2,
  type BackendBackfillExecutionExhaustionProofV2,
  type BackendBackfillExecutionPostconditionsV2,
  type BackendBackfillExecutionReceiptV2,
  type BackendBackfillExecutionScopeV2
} from '#lowcode/backend/release/backfill-execution-v2'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { stripeSecretCanary } from '../fixture'

const CAPTURED_AT = '2026-09-07T00:00:00.000000001Z'
const BATCH_ONE_AT = '2026-09-07T00:00:00.000000002Z'
const TERMINAL_AT = '2026-09-07T00:00:00.000000003Z'
const EVALUATED_AT = '2026-09-07T00:00:10Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

async function scopeFixture(
  overrides: Partial<BackendBackfillExecutionScopeV2> = {}
): Promise<BackendBackfillExecutionScopeV2> {
  const captureDigest = overrides.captureDigest ?? (await digest('capture'))
  const batchSize = overrides.batchSize ?? 100
  const initialRemainingEligibleRowCount = overrides.initialRemainingEligibleRowCount ?? 3
  const initialRemainingTargetRowCount = overrides.initialRemainingTargetRowCount ?? 3
  return parseBackendBackfillExecutionScopeV2({
    format: BACKEND_BACKFILL_EXECUTION_V2_SCOPE_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_V2_VERSION,
    providerId: 'provider.test',
    environment: 'staging',
    providerAuthorityDigest: await digest('provider-authority'),
    applicationId: 'application-1',
    applicationDigest: await digest('application'),
    migrationId: 'notes-title-backfill',
    migrationDigest: await digest('migration'),
    migrationPlanDigest: await digest('migration-plan'),
    sourceLedgerDigest: await digest('source-ledger'),
    captureDigest,
    receiptZeroEvidenceDigest: captureDigest,
    resourceIdentityDigest: await digest('resource-identity'),
    catalogPreconditionDigest: await digest('catalog'),
    entityId: 'notes',
    cursorField: 'id',
    cursorFieldType: 'integer',
    targetField: 'title',
    batchSize,
    maximumReceiptCount: BACKEND_BACKFILL_EXECUTION_V2_MAX_RECEIPTS,
    maximumBatchCount: BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT,
    capturedHighWater: 100,
    initialRemainingEligibleRowCount,
    initialRemainingTargetRowCount,
    requiredBatchCount: Math.ceil(initialRemainingEligibleRowCount / batchSize),
    requiredMatchedRowCount: null,
    resumePolicy: BACKEND_BACKFILL_EXECUTION_V2_RESUME_POLICY,
    completionRule: BACKEND_BACKFILL_EXECUTION_V2_COMPLETION_RULE,
    ...overrides
  })
}

interface ReceiptOverrides extends Partial<
  Omit<
    BackendBackfillExecutionReceiptV2,
    'batchCounts' | 'cumulativeCounts' | 'exhaustion' | 'postconditions'
  >
> {
  readonly batchCounts?: Partial<BackendBackfillExecutionBatchCountsV2>
  readonly cumulativeCounts?: Partial<BackendBackfillExecutionBatchCountsV2>
  readonly exhaustion?: Partial<BackendBackfillExecutionExhaustionProofV2>
  readonly postconditions?: Partial<BackendBackfillExecutionPostconditionsV2>
}

async function receiptFixture(
  scope: BackendBackfillExecutionScopeV2,
  overrides: ReceiptOverrides = {}
): Promise<BackendBackfillExecutionReceiptV2> {
  const scopeDigest = await digestBackendBackfillExecutionScopeV2(scope)
  const {
    batchCounts: batchCountOverrides,
    cumulativeCounts: cumulativeCountOverrides,
    exhaustion: exhaustionOverrides,
    postconditions: postconditionOverrides,
    ...receiptOverrides
  } = overrides
  return parseBackendBackfillExecutionReceiptV2({
    format: BACKEND_BACKFILL_EXECUTION_V2_RECEIPT_FORMAT,
    version: BACKEND_BACKFILL_EXECUTION_V2_VERSION,
    receiptId: 'receipt-0',
    executionId: 'execution-1',
    idempotencyKey: 'idempotency-0',
    requestDigest: await digest(`request:${receiptOverrides.receiptId ?? 'receipt-0'}`),
    scope,
    scopeDigest,
    checkpointKind: 'capture',
    batchIndex: 0,
    previousCursor: null,
    lastProcessedKey: null,
    batchCounts: {
      scannedRowCount: 0,
      matchedRowCount: 0,
      updatedRowCount: 0,
      ...batchCountOverrides
    },
    cumulativeCounts: {
      scannedRowCount: 0,
      matchedRowCount: 0,
      updatedRowCount: 0,
      ...cumulativeCountOverrides
    },
    exhaustion: {
      checked: true,
      remainingEligibleRowCount: scope.initialRemainingEligibleRowCount,
      remainingTargetRowCount: scope.initialRemainingTargetRowCount,
      ...exhaustionOverrides
    },
    postconditions: {
      fieldNotNull: scope.initialRemainingTargetRowCount === 0,
      requiredMatchedRowCount: scope.requiredMatchedRowCount,
      matchedRowCountSatisfied:
        scope.requiredMatchedRowCount === null || scope.requiredMatchedRowCount === 0,
      ...postconditionOverrides
    },
    outcome: 'in-progress',
    terminalReason: null,
    stableErrorCode: null,
    previousReceiptDigest: null,
    catalogEvidenceDigest: scope.catalogPreconditionDigest,
    operationAuthorityDigest: await digest('capture-operation-authority'),
    databaseEventId: 'database-event-0',
    databaseHeadVersion: 1,
    committedAt: CAPTURED_AT,
    evidenceDigest: scope.receiptZeroEvidenceDigest,
    ...receiptOverrides
  })
}

async function verify(
  scope: BackendBackfillExecutionScopeV2,
  receipts: readonly BackendBackfillExecutionReceiptV2[],
  expectedHeadDigest: string | null
) {
  return verifyBackendBackfillExecutionReceiptChainV2(receipts, {
    scope,
    expectedHeadDigest,
    evaluatedAt: EVALUATED_AT
  })
}

async function validCaptureAndBatch() {
  const scope = await scopeFixture({ batchSize: 2 })
  const capture = await receiptFixture(scope)
  const captureDigest = await digestBackendBackfillExecutionReceiptV2(capture)
  const batch = await receiptFixture(scope, {
    receiptId: 'receipt-1',
    idempotencyKey: 'idempotency-1',
    checkpointKind: 'batch',
    batchIndex: 1,
    previousCursor: null,
    lastProcessedKey: 20,
    batchCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
    cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
    exhaustion: {
      checked: false,
      remainingEligibleRowCount: null,
      remainingTargetRowCount: null
    },
    postconditions: { fieldNotNull: false },
    previousReceiptDigest: captureDigest,
    catalogEvidenceDigest: await digest('batch-live-catalog'),
    operationAuthorityDigest: await digest('batch-operation-authority'),
    databaseEventId: 'database-event-1',
    databaseHeadVersion: 2,
    committedAt: BATCH_ONE_AT,
    evidenceDigest: await digest('batch-evidence')
  })
  return { scope, capture, captureDigest, batch }
}

async function validCaptureBatchAndCompletion() {
  const { scope, capture, batch } = await validCaptureAndBatch()
  const batchDigest = await digestBackendBackfillExecutionReceiptV2(batch)
  const completed = await receiptFixture(scope, {
    receiptId: 'receipt-2',
    idempotencyKey: 'idempotency-2',
    checkpointKind: 'batch',
    batchIndex: 2,
    previousCursor: 20,
    lastProcessedKey: 20,
    batchCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 },
    cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
    exhaustion: {
      checked: true,
      remainingEligibleRowCount: 0,
      remainingTargetRowCount: 0
    },
    postconditions: { fieldNotNull: true },
    outcome: 'completed',
    terminalReason: 'predicate-exhausted',
    previousReceiptDigest: batchDigest,
    operationAuthorityDigest: await digest('terminal-operation-authority'),
    databaseEventId: 'database-event-2',
    databaseHeadVersion: 3,
    committedAt: TERMINAL_AT,
    evidenceDigest: await digest('terminal-evidence')
  })
  return {
    scope,
    capture,
    batch,
    completed,
    head: await digestBackendBackfillExecutionReceiptV2(completed)
  }
}

describe('provider-neutral Backend backfill Receipt V2 contract', () => {
  test('accepts a sparse terminal exhaustion chain without pretending to grant authority', async () => {
    const { scope, capture, batch } = await validCaptureAndBatch()
    const batchDigest = await digestBackendBackfillExecutionReceiptV2(batch)
    const completed = await receiptFixture(scope, {
      receiptId: 'receipt-2',
      idempotencyKey: 'idempotency-2',
      checkpointKind: 'batch',
      batchIndex: 2,
      previousCursor: 20,
      lastProcessedKey: 20,
      batchCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 },
      cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 0,
        remainingTargetRowCount: 0
      },
      postconditions: { fieldNotNull: true },
      outcome: 'completed',
      terminalReason: 'predicate-exhausted',
      previousReceiptDigest: batchDigest,
      operationAuthorityDigest: await digest('terminal-operation-authority'),
      databaseEventId: 'database-event-2',
      databaseHeadVersion: 3,
      committedAt: TERMINAL_AT,
      evidenceDigest: await digest('terminal-evidence')
    })
    const head = await digestBackendBackfillExecutionReceiptV2(completed)

    expect(await verify(scope, [capture, batch, completed], head)).toMatchObject({
      ok: true,
      releaseReady: false,
      databaseAuthorityGranted: false,
      executionAuthorityGranted: false,
      computedHeadDigest: head,
      outcome: 'completed'
    })
    expect(completed.lastProcessedKey).toBeLessThan(scope.capturedHighWater ?? 0)
    expect(canonicalBackendBackfillExecutionReceiptV2Bytes(completed)).toBeInstanceOf(Uint8Array)
    expect(canonicalBackendBackfillExecutionScopeV2Bytes(scope)).toBeInstanceOf(Uint8Array)
  })

  test('incrementally verifies atomic pages without retaining the full Receipt payload chain', async () => {
    const { scope, capture, batch, completed, head } = await validCaptureBatchAndCompletion()
    const context = { scope, expectedHeadDigest: head, evaluatedAt: EVALUATED_AT }
    const whole = await verifyBackendBackfillExecutionReceiptChainV2(
      [capture, batch, completed],
      context
    )
    const verifier = await createBackendBackfillExecutionReceiptChainVerifierV2(context)

    expect(Object.isFrozen(verifier)).toBe(true)
    expect(await verifier.appendPage([capture, batch])).toMatchObject({
      ok: true,
      finalized: false,
      releaseReady: false,
      databaseAuthorityGranted: false,
      executionAuthorityGranted: false,
      receiptCount: 2,
      lastDatabaseHeadVersion: 2,
      outcome: 'in-progress'
    })
    expect(await verifier.appendPage([completed])).toMatchObject({
      ok: true,
      finalized: false,
      receiptCount: 3,
      lastDatabaseHeadVersion: 3,
      computedHeadDigest: head,
      outcome: 'completed'
    })
    const finalized = await verifier.finalize()
    expect(finalized).toMatchObject({
      ok: true,
      finalized: true,
      releaseReady: false,
      databaseAuthorityGranted: false,
      executionAuthorityGranted: false,
      receiptCount: 3,
      lastDatabaseHeadVersion: 3,
      computedHeadDigest: head,
      outcome: 'completed'
    })
    expect(finalized).toEqual(await verifier.finalize())
    expect('receipts' in finalized).toBe(false)
    expect(finalized.ok && whole.ok ? finalized.scopeDigest : null).toBe(
      whole.ok ? whole.scopeDigest : null
    )
    expect(await verifier.appendPage([completed])).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-invalid',
      failureDisposition: 'already-finalized',
      finalized: true,
      retryable: false
    })
  })

  test('matches whole-array verification across every page split', async () => {
    const { scope, capture, batch, completed, head } = await validCaptureBatchAndCompletion()
    const context = { scope, expectedHeadDigest: head, evaluatedAt: EVALUATED_AT }
    const whole = await verifyBackendBackfillExecutionReceiptChainV2(
      [capture, batch, completed],
      context
    )
    expect(whole.ok).toBe(true)
    if (!whole.ok) return

    const splits = [
      [[capture, batch, completed]],
      [[capture], [batch, completed]],
      [[capture, batch], [completed]],
      [[capture], [batch], [completed]]
    ] as const
    for (const pages of splits) {
      const verifier = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
      for (const page of pages) expect(await verifier.appendPage(page)).toMatchObject({ ok: true })
      expect(await verifier.finalize()).toEqual({
        ok: true,
        finalized: true,
        releaseReady: false,
        databaseAuthorityGranted: false,
        executionAuthorityGranted: false,
        scope: whole.scope,
        scopeDigest: whole.scopeDigest,
        receiptCount: whole.receipts.length,
        lastDatabaseHeadVersion: completed.databaseHeadVersion,
        computedHeadDigest: whole.computedHeadDigest,
        outcome: whole.outcome
      })
    }
  })

  test('keeps accepted state unchanged after invalid, oversized, empty, or concurrent pages', async () => {
    const { scope, capture, batch, completed, head } = await validCaptureBatchAndCompletion()
    const context = { scope, expectedHeadDigest: head, evaluatedAt: EVALUATED_AT }
    const verifier = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
    const brokenBatch = parseBackendBackfillExecutionReceiptV2({
      ...batch,
      previousReceiptDigest: await digest('wrong-page-previous')
    })

    expect(await verifier.appendPage([])).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid',
      failureDisposition: 'page-rejected',
      finalized: false,
      retryable: true
    })
    const sparsePage: unknown[] = []
    sparsePage.length = 1
    expect(await verifier.appendPage(sparsePage)).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid'
    })
    let getterCalls = 0
    const accessorPage = [capture]
    Object.defineProperty(accessorPage, '0', {
      enumerable: true,
      get() {
        getterCalls += 1
        return capture
      }
    })
    expect(await verifier.appendPage(accessorPage)).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid'
    })
    expect(getterCalls).toBe(0)
    const symbolPage = [capture]
    Object.defineProperty(symbolPage, Symbol('extension'), { value: true })
    expect(await verifier.appendPage(symbolPage)).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid'
    })
    const revoked = Proxy.revocable([capture], {})
    revoked.revoke()
    expect(await verifier.appendPage(revoked.proxy)).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid'
    })
    expect(
      await verifier.appendPage(
        Array.from(
          { length: BACKEND_BACKFILL_EXECUTION_V2_MAX_VERIFICATION_PAGE_RECEIPTS + 1 },
          () => capture
        )
      )
    ).toMatchObject({ ok: false, index: 0, code: 'backfill-execution-v2-invalid' })
    expect(await verifier.appendPage([capture, brokenBatch])).toMatchObject({
      ok: false,
      index: 1,
      code: 'backfill-execution-v2-chain-broken',
      failureDisposition: 'page-rejected',
      finalized: false,
      retryable: true
    })
    expect(await verifier.appendPage([capture, { ...batch, batchIndex: 'invalid' }])).toMatchObject(
      {
        ok: false,
        index: 1,
        code: 'backfill-execution-v2-invalid'
      }
    )
    expect(await verifier.appendPage([capture, batch])).toMatchObject({
      ok: true,
      receiptCount: 2,
      lastDatabaseHeadVersion: 2
    })
    expect(await verifier.appendPage([completed])).toMatchObject({ ok: true, receiptCount: 3 })
    expect(await verifier.finalize()).toMatchObject({ ok: true, computedHeadDigest: head })

    const prefixed = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
    expect(await prefixed.appendPage([capture])).toMatchObject({ ok: true, receiptCount: 1 })
    expect(
      await prefixed.appendPage([batch, { ...completed, batchIndex: 'invalid' }])
    ).toMatchObject({
      ok: false,
      index: 2,
      failureDisposition: 'page-rejected',
      finalized: false,
      retryable: true
    })
    expect(await prefixed.appendPage([batch, completed])).toMatchObject({
      ok: true,
      receiptCount: 3
    })

    const concurrent = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
    const firstPage = concurrent.appendPage([capture])
    const overlappingPage = concurrent.appendPage([batch])
    const overlappingFinalization = concurrent.finalize()
    expect(await overlappingPage).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid',
      failureDisposition: 'operation-in-progress',
      finalized: false,
      retryable: true
    })
    expect(await overlappingFinalization).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid',
      failureDisposition: 'operation-in-progress',
      finalized: false,
      retryable: true
    })
    expect(await firstPage).toMatchObject({ ok: true, receiptCount: 1 })
    expect(await concurrent.appendPage([batch])).toMatchObject({ ok: true, receiptCount: 2 })
  })

  test('returns terminal machine-readable initialization and finalization failures', async () => {
    const { scope, capture, batch, completed } = await validCaptureBatchAndCompletion()
    const invalidContext = { scope, expectedHeadDigest: null, evaluatedAt: 'invalid' }
    const invalidVerifier =
      await createBackendBackfillExecutionReceiptChainVerifierV2(invalidContext)
    const initializationFailure = await invalidVerifier.finalize()
    expect(initializationFailure).toMatchObject({
      ok: false,
      index: 0,
      code: 'backfill-execution-v2-invalid',
      failureDisposition: 'initialization-rejected',
      finalized: true,
      retryable: false
    })
    if (initializationFailure.ok) throw new Error('Expected initialization to fail closed')
    expect(await invalidVerifier.appendPage([capture])).toEqual(initializationFailure)
    expect(
      await verifyBackendBackfillExecutionReceiptChainV2([capture], invalidContext)
    ).toMatchObject({ ok: false, index: 0, code: 'backfill-execution-v2-invalid' })

    const headMismatchVerifier = await createBackendBackfillExecutionReceiptChainVerifierV2({
      scope,
      expectedHeadDigest: await digest('different-head'),
      evaluatedAt: EVALUATED_AT
    })
    expect(await headMismatchVerifier.appendPage([capture, batch, completed])).toMatchObject({
      ok: true,
      receiptCount: 3
    })
    const finalizationFailure = await headMismatchVerifier.finalize()
    expect(finalizationFailure).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-database-head-mismatch',
      failureDisposition: 'finalization-rejected',
      finalized: true,
      retryable: false
    })
    expect(await headMismatchVerifier.finalize()).toEqual(finalizationFailure)
    expect(await headMismatchVerifier.appendPage([completed])).toMatchObject({
      ok: false,
      failureDisposition: 'already-finalized',
      finalized: true,
      retryable: false
    })
  })

  test('checks every uniqueness key within and across pages without leaking rejected deltas', async () => {
    const { scope, capture, batch, head } = await validCaptureBatchAndCompletion()
    const context = { scope, expectedHeadDigest: head, evaluatedAt: EVALUATED_AT }
    const cases = [
      {
        overrides: { receiptId: capture.receiptId },
        code: 'backfill-execution-v2-receipt-id-duplicate'
      },
      {
        overrides: { databaseEventId: capture.databaseEventId },
        code: 'backfill-execution-v2-receipt-id-duplicate'
      },
      {
        overrides: { idempotencyKey: capture.idempotencyKey },
        code: 'backfill-execution-v2-idempotency-key-reused'
      },
      {
        overrides: { requestDigest: capture.requestDigest },
        code: 'backfill-execution-v2-request-digest-reused'
      }
    ] as const

    for (const candidateCase of cases) {
      const duplicate = parseBackendBackfillExecutionReceiptV2({
        ...batch,
        ...candidateCase.overrides
      })
      const samePage = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
      expect(await samePage.appendPage([capture, duplicate])).toMatchObject({
        ok: false,
        index: 1,
        code: candidateCase.code,
        failureDisposition: 'page-rejected'
      })
      expect(await samePage.appendPage([capture, batch])).toMatchObject({
        ok: true,
        receiptCount: 2
      })

      const crossPage = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
      expect(await crossPage.appendPage([capture])).toMatchObject({ ok: true, receiptCount: 1 })
      expect(await crossPage.appendPage([duplicate])).toMatchObject({
        ok: false,
        index: 1,
        code: candidateCase.code,
        failureDisposition: 'page-rejected'
      })
      expect(await crossPage.appendPage([batch])).toMatchObject({ ok: true, receiptCount: 2 })
    }
  })

  test('reports the same absolute malformed-receipt index for whole and paged verification', async () => {
    const { scope, capture, batch, head } = await validCaptureBatchAndCompletion()
    const context = { scope, expectedHeadDigest: head, evaluatedAt: EVALUATED_AT }
    const malformed = { ...batch, batchIndex: 'invalid' }
    expect(
      await verifyBackendBackfillExecutionReceiptChainV2([capture, malformed], context)
    ).toMatchObject({
      ok: false,
      index: 1,
      code: 'backfill-execution-v2-invalid'
    })
    const verifier = await createBackendBackfillExecutionReceiptChainVerifierV2(context)
    expect(await verifier.appendPage([capture, malformed])).toMatchObject({
      ok: false,
      index: 1,
      code: 'backfill-execution-v2-invalid'
    })
  })

  test('accepts a non-empty table with no remaining target rows as already satisfied', async () => {
    const scope = await scopeFixture({
      capturedHighWater: 100,
      initialRemainingEligibleRowCount: 3,
      initialRemainingTargetRowCount: 0
    })
    const capture = await receiptFixture(scope, {
      outcome: 'completed',
      terminalReason: 'already-satisfied'
    })
    const head = await digestBackendBackfillExecutionReceiptV2(capture)
    expect(await verify(scope, [capture], head)).toMatchObject({ ok: true, outcome: 'completed' })
  })

  test('binds every receipt to the exact scope, capture, catalog, and external head', async () => {
    const scope = await scopeFixture()
    const capture = await receiptFixture(scope)
    const captureHead = await digestBackendBackfillExecutionReceiptV2(capture)
    const changedScope = await scopeFixture({ applicationId: 'application-2' })
    const changedScopeReceipt = await receiptFixture(changedScope)

    expect(
      await verify(
        scope,
        [changedScopeReceipt],
        await digestBackendBackfillExecutionReceiptV2(changedScopeReceipt)
      )
    ).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-scope-mismatch'
    })
    const wrongCapture = parseBackendBackfillExecutionReceiptV2({
      ...capture,
      evidenceDigest: await digest('wrong-capture')
    })
    expect(
      await verify(
        scope,
        [wrongCapture],
        await digestBackendBackfillExecutionReceiptV2(wrongCapture)
      )
    ).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-capture-binding-mismatch'
    })
    const wrongCatalog = parseBackendBackfillExecutionReceiptV2({
      ...capture,
      catalogEvidenceDigest: await digest('wrong-catalog')
    })
    expect(
      await verify(
        scope,
        [wrongCatalog],
        await digestBackendBackfillExecutionReceiptV2(wrongCatalog)
      )
    ).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-capture-binding-mismatch'
    })
    expect(await verify(scope, [capture], await digest('attacker-head'))).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-database-head-mismatch'
    })
    expect(await verify(scope, [capture], captureHead)).toMatchObject({ ok: true })
  })

  test('allows fresh per-batch catalog evidence while binding tampering through the chain head', async () => {
    const { scope, capture, batch } = await validCaptureAndBatch()
    const originalHead = await digestBackendBackfillExecutionReceiptV2(batch)
    expect(batch.catalogEvidenceDigest).not.toBe(scope.catalogPreconditionDigest)
    expect(await verify(scope, [capture, batch], originalHead)).toMatchObject({ ok: true })

    const tampered = parseBackendBackfillExecutionReceiptV2({
      ...batch,
      catalogEvidenceDigest: await digest('different-live-catalog')
    })
    expect(await digestBackendBackfillExecutionReceiptV2(tampered)).not.toBe(originalHead)
    expect(await verify(scope, [capture, tampered], originalHead)).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-database-head-mismatch'
    })
  })

  test('rejects cursor, cumulative-count, and zero-row in-progress regressions', async () => {
    const { scope, capture, captureDigest } = await validCaptureAndBatch()
    const attacks: Array<{
      overrides: ReceiptOverrides
      code: string
    }> = [
      {
        overrides: {
          lastProcessedKey: 101,
          batchCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
          cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 }
        },
        code: 'backfill-execution-v2-high-water-exceeded'
      },
      {
        overrides: {
          lastProcessedKey: 20,
          batchCounts: { scannedRowCount: 1, matchedRowCount: 1, updatedRowCount: 1 },
          cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 1, updatedRowCount: 1 }
        },
        code: 'backfill-execution-v2-progress-regressed'
      },
      {
        overrides: {
          lastProcessedKey: 20,
          batchCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 1 },
          cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 1 }
        },
        code: 'backfill-execution-v2-progress-regressed'
      },
      {
        overrides: {
          lastProcessedKey: null,
          batchCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 },
          cumulativeCounts: { scannedRowCount: 0, matchedRowCount: 0, updatedRowCount: 0 }
        },
        code: 'backfill-execution-v2-progress-regressed'
      }
    ]
    for (const [index, attack] of attacks.entries()) {
      const candidate = await receiptFixture(scope, {
        receiptId: `attack-receipt-${index}`,
        idempotencyKey: `attack-idempotency-${index}`,
        checkpointKind: 'batch',
        batchIndex: 1,
        previousReceiptDigest: captureDigest,
        databaseEventId: `attack-event-${index}`,
        databaseHeadVersion: 2,
        committedAt: BATCH_ONE_AT,
        evidenceDigest: await digest(`attack-evidence-${index}`),
        exhaustion: {
          checked: false,
          remainingEligibleRowCount: null,
          remainingTargetRowCount: null
        },
        ...attack.overrides
      })
      expect(
        await verify(
          scope,
          [capture, candidate],
          await digestBackendBackfillExecutionReceiptV2(candidate)
        )
      ).toMatchObject({ ok: false, code: attack.code })
    }
  })

  test('requires terminal exhaustion and postconditions instead of cursor equality', async () => {
    const { scope, capture, batch } = await validCaptureAndBatch()
    const batchDigest = await digestBackendBackfillExecutionReceiptV2(batch)
    const missingExhaustion = await receiptFixture(scope, {
      receiptId: 'missing-exhaustion',
      idempotencyKey: 'missing-exhaustion-key',
      checkpointKind: 'batch',
      batchIndex: 2,
      previousCursor: 20,
      lastProcessedKey: 20,
      cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      exhaustion: {
        checked: false,
        remainingEligibleRowCount: null,
        remainingTargetRowCount: null
      },
      postconditions: { fieldNotNull: true },
      outcome: 'completed',
      terminalReason: 'predicate-exhausted',
      previousReceiptDigest: batchDigest,
      databaseEventId: 'missing-exhaustion-event',
      databaseHeadVersion: 3,
      committedAt: TERMINAL_AT,
      evidenceDigest: await digest('missing-exhaustion-evidence')
    })
    expect(
      await verify(
        scope,
        [capture, batch, missingExhaustion],
        await digestBackendBackfillExecutionReceiptV2(missingExhaustion)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-exhaustion-proof-required' })

    const failedPostcondition = parseBackendBackfillExecutionReceiptV2({
      ...missingExhaustion,
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 0,
        remainingTargetRowCount: 0
      },
      postconditions: { ...missingExhaustion.postconditions, fieldNotNull: false }
    })
    expect(
      await verify(
        scope,
        [capture, batch, failedPostcondition],
        await digestBackendBackfillExecutionReceiptV2(failedPostcondition)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-postcondition-failed' })
  })

  test('rejects failed receipt zero and exhaustion claims outside captured progress bounds', async () => {
    const scope = await scopeFixture({ batchSize: 2 })
    const failedCapture = await receiptFixture(scope, {
      outcome: 'failed',
      terminalReason: 'stable-failure',
      stableErrorCode: 'capture-failed'
    })
    expect(
      await verify(
        scope,
        [failedCapture],
        await digestBackendBackfillExecutionReceiptV2(failedCapture)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-transition-invalid' })

    const capture = await receiptFixture(scope)
    const captureDigest = await digestBackendBackfillExecutionReceiptV2(capture)
    const unprovenPostcondition = await receiptFixture(scope, {
      receiptId: 'unproven-postcondition',
      idempotencyKey: 'unproven-postcondition-key',
      checkpointKind: 'batch',
      batchIndex: 1,
      lastProcessedKey: 20,
      batchCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      exhaustion: {
        checked: false,
        remainingEligibleRowCount: null,
        remainingTargetRowCount: null
      },
      postconditions: { fieldNotNull: true },
      previousReceiptDigest: captureDigest,
      databaseEventId: 'unproven-postcondition-event',
      databaseHeadVersion: 2,
      committedAt: BATCH_ONE_AT,
      evidenceDigest: await digest('unproven-postcondition-evidence')
    })
    expect(
      await verify(
        scope,
        [capture, unprovenPostcondition],
        await digestBackendBackfillExecutionReceiptV2(unprovenPostcondition)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-postcondition-failed' })

    const impossibleRemaining = await receiptFixture(scope, {
      receiptId: 'impossible-remaining',
      idempotencyKey: 'impossible-remaining-key',
      checkpointKind: 'batch',
      batchIndex: 1,
      lastProcessedKey: 20,
      batchCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      cumulativeCounts: { scannedRowCount: 2, matchedRowCount: 2, updatedRowCount: 2 },
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 2,
        remainingTargetRowCount: 1
      },
      previousReceiptDigest: captureDigest,
      databaseEventId: 'impossible-remaining-event',
      databaseHeadVersion: 2,
      committedAt: BATCH_ONE_AT,
      evidenceDigest: await digest('impossible-remaining-evidence')
    })
    expect(
      await verify(
        scope,
        [capture, impossibleRemaining],
        await digestBackendBackfillExecutionReceiptV2(impossibleRemaining)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-progress-regressed' })
  })

  test('preserves the last checked exhaustion bound across unchecked checkpoints', async () => {
    const scope = await scopeFixture({
      batchSize: 100,
      capturedHighWater: 400,
      initialRemainingEligibleRowCount: 400,
      initialRemainingTargetRowCount: 400
    })
    const capture = await receiptFixture(scope)
    const captureDigest = await digestBackendBackfillExecutionReceiptV2(capture)
    const checked = await receiptFixture(scope, {
      receiptId: 'checked-remainder',
      idempotencyKey: 'checked-remainder-key',
      checkpointKind: 'batch',
      batchIndex: 1,
      lastProcessedKey: 100,
      batchCounts: { scannedRowCount: 100, matchedRowCount: 0, updatedRowCount: 0 },
      cumulativeCounts: { scannedRowCount: 100, matchedRowCount: 0, updatedRowCount: 0 },
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 10,
        remainingTargetRowCount: 10
      },
      previousReceiptDigest: captureDigest,
      databaseEventId: 'checked-remainder-event',
      databaseHeadVersion: 2,
      committedAt: BATCH_ONE_AT,
      evidenceDigest: await digest('checked-remainder-evidence')
    })
    const checkedDigest = await digestBackendBackfillExecutionReceiptV2(checked)
    const uncheckedOverflow = await receiptFixture(scope, {
      receiptId: 'unchecked-overflow',
      idempotencyKey: 'unchecked-overflow-key',
      checkpointKind: 'batch',
      batchIndex: 2,
      previousCursor: 100,
      lastProcessedKey: 200,
      batchCounts: { scannedRowCount: 100, matchedRowCount: 0, updatedRowCount: 0 },
      cumulativeCounts: { scannedRowCount: 200, matchedRowCount: 0, updatedRowCount: 0 },
      exhaustion: {
        checked: false,
        remainingEligibleRowCount: null,
        remainingTargetRowCount: null
      },
      previousReceiptDigest: checkedDigest,
      databaseEventId: 'unchecked-overflow-event',
      databaseHeadVersion: 3,
      committedAt: TERMINAL_AT,
      evidenceDigest: await digest('unchecked-overflow-evidence')
    })

    expect(
      await verify(
        scope,
        [capture, checked, uncheckedOverflow],
        await digestBackendBackfillExecutionReceiptV2(uncheckedOverflow)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-progress-regressed' })
  })

  test('accepts only zero-progress stable failure checkpoints and seals terminal chains', async () => {
    const { scope, capture, captureDigest } = await validCaptureAndBatch()
    const failed = await receiptFixture(scope, {
      receiptId: 'receipt-failed',
      idempotencyKey: 'idempotency-failed',
      checkpointKind: 'failure',
      batchIndex: 1,
      outcome: 'failed',
      terminalReason: 'stable-failure',
      stableErrorCode: 'provider-transaction-failed',
      exhaustion: {
        checked: false,
        remainingEligibleRowCount: null,
        remainingTargetRowCount: null
      },
      previousReceiptDigest: captureDigest,
      databaseEventId: 'database-event-failed',
      databaseHeadVersion: 2,
      committedAt: BATCH_ONE_AT,
      evidenceDigest: await digest('failure-evidence')
    })
    const failedHead = await digestBackendBackfillExecutionReceiptV2(failed)
    expect(await verify(scope, [capture, failed], failedHead)).toMatchObject({
      ok: true,
      outcome: 'failed'
    })

    const failedBatch = parseBackendBackfillExecutionReceiptV2({
      ...failed,
      receiptId: 'receipt-failed-batch',
      idempotencyKey: 'idempotency-failed-batch',
      checkpointKind: 'batch',
      databaseEventId: 'database-event-failed-batch'
    })
    expect(
      await verify(
        scope,
        [capture, failedBatch],
        await digestBackendBackfillExecutionReceiptV2(failedBatch)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-transition-invalid' })

    const extension = await receiptFixture(scope, {
      receiptId: 'receipt-after-failure',
      idempotencyKey: 'idempotency-after-failure',
      checkpointKind: 'batch',
      batchIndex: 2,
      outcome: 'completed',
      terminalReason: 'predicate-exhausted',
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 0,
        remainingTargetRowCount: 0
      },
      postconditions: { fieldNotNull: true },
      previousReceiptDigest: failedHead,
      databaseEventId: 'database-event-after-failure',
      databaseHeadVersion: 3,
      committedAt: TERMINAL_AT,
      evidenceDigest: await digest('extension-evidence')
    })
    expect(
      await verify(
        scope,
        [capture, failed, extension],
        await digestBackendBackfillExecutionReceiptV2(extension)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-terminal' })
  })

  test('rejects duplicate receipt/event IDs, reused idempotency keys, and broken chains', async () => {
    const { scope, capture, captureDigest } = await validCaptureAndBatch()
    const cases: Array<{ overrides: ReceiptOverrides; code: string }> = [
      {
        overrides: { receiptId: capture.receiptId },
        code: 'backfill-execution-v2-receipt-id-duplicate'
      },
      {
        overrides: { databaseEventId: capture.databaseEventId },
        code: 'backfill-execution-v2-receipt-id-duplicate'
      },
      {
        overrides: { idempotencyKey: capture.idempotencyKey },
        code: 'backfill-execution-v2-idempotency-key-reused'
      },
      {
        overrides: { requestDigest: capture.requestDigest },
        code: 'backfill-execution-v2-request-digest-reused'
      },
      {
        overrides: { previousReceiptDigest: await digest('wrong-previous') },
        code: 'backfill-execution-v2-chain-broken'
      }
    ]
    for (const [index, candidateCase] of cases.entries()) {
      const candidate = await receiptFixture(scope, {
        receiptId: `receipt-case-${index}`,
        idempotencyKey: `idempotency-case-${index}`,
        checkpointKind: 'batch',
        batchIndex: 1,
        lastProcessedKey: 1,
        batchCounts: { scannedRowCount: 1, matchedRowCount: 1, updatedRowCount: 1 },
        cumulativeCounts: { scannedRowCount: 1, matchedRowCount: 1, updatedRowCount: 1 },
        exhaustion: {
          checked: false,
          remainingEligibleRowCount: null,
          remainingTargetRowCount: null
        },
        previousReceiptDigest: captureDigest,
        databaseEventId: `database-event-case-${index}`,
        databaseHeadVersion: 2,
        committedAt: BATCH_ONE_AT,
        evidenceDigest: await digest(`case-evidence-${index}`),
        ...candidateCase.overrides
      })
      expect(
        await verify(
          scope,
          [capture, candidate],
          await digestBackendBackfillExecutionReceiptV2(candidate)
        )
      ).toMatchObject({ ok: false, code: candidateCase.code })
    }
  })

  test('enforces the final batch bound and rejects future-dated receipts', async () => {
    const scope = await scopeFixture()
    const atLimit = await receiptFixture(scope, {
      batchIndex: BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT
    })
    expect(
      await verify(scope, [atLimit], await digestBackendBackfillExecutionReceiptV2(atLimit))
    ).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-batch-limit-exceeded'
    })
    const overLimit = await receiptFixture(scope, {
      batchIndex: BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT + 1,
      outcome: 'completed',
      terminalReason: 'predicate-exhausted',
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 0,
        remainingTargetRowCount: 0
      },
      postconditions: { fieldNotNull: true }
    })
    expect(
      await verify(scope, [overLimit], await digestBackendBackfillExecutionReceiptV2(overLimit))
    ).toMatchObject({ ok: false, code: 'backfill-execution-v2-batch-limit-exceeded' })

    const terminalAtLimit = await receiptFixture(scope, {
      batchIndex: BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT,
      outcome: 'completed',
      terminalReason: 'predicate-exhausted',
      exhaustion: {
        checked: true,
        remainingEligibleRowCount: 0,
        remainingTargetRowCount: 0
      },
      postconditions: { fieldNotNull: true }
    })
    expect(terminalAtLimit.batchIndex).toBe(BACKEND_BACKFILL_EXECUTION_V2_MAX_BATCH_COUNT)

    const future = await receiptFixture(scope, { committedAt: '2026-09-07T00:01:00Z' })
    expect(
      await verify(scope, [future], await digestBackendBackfillExecutionReceiptV2(future))
    ).toMatchObject({
      ok: false,
      code: 'backfill-execution-v2-future-dated'
    })
  })

  test('rejects negative zero in every canonical count position', async () => {
    for (const overrides of [
      { batchSize: -0 },
      { capturedHighWater: -0 },
      { initialRemainingEligibleRowCount: -0 },
      { initialRemainingTargetRowCount: -0 },
      { requiredMatchedRowCount: -0 }
    ]) {
      await expect(scopeFixture(overrides)).rejects.toThrow('non-negative safe integer')
    }
    await expect(
      scopeFixture({
        capturedHighWater: null,
        initialRemainingEligibleRowCount: 0,
        initialRemainingTargetRowCount: 0,
        requiredBatchCount: -0
      })
    ).rejects.toThrow('non-negative safe integer')

    const scope = await scopeFixture()
    const capture = await receiptFixture(scope)
    const cases: unknown[] = [
      { ...capture, batchIndex: -0 },
      { ...capture, previousCursor: -0 },
      { ...capture, lastProcessedKey: -0 },
      {
        ...capture,
        batchCounts: { ...capture.batchCounts, scannedRowCount: -0 }
      },
      {
        ...capture,
        batchCounts: { ...capture.batchCounts, matchedRowCount: -0 }
      },
      {
        ...capture,
        batchCounts: { ...capture.batchCounts, updatedRowCount: -0 }
      },
      {
        ...capture,
        cumulativeCounts: { ...capture.cumulativeCounts, scannedRowCount: -0 }
      },
      {
        ...capture,
        cumulativeCounts: { ...capture.cumulativeCounts, matchedRowCount: -0 }
      },
      {
        ...capture,
        cumulativeCounts: { ...capture.cumulativeCounts, updatedRowCount: -0 }
      },
      {
        ...capture,
        exhaustion: { ...capture.exhaustion, remainingEligibleRowCount: -0 }
      },
      {
        ...capture,
        exhaustion: { ...capture.exhaustion, remainingTargetRowCount: -0 }
      },
      {
        ...capture,
        postconditions: { ...capture.postconditions, requiredMatchedRowCount: -0 }
      },
      { ...capture, databaseHeadVersion: -0 }
    ]
    for (const candidate of cases) {
      expect(() => parseBackendBackfillExecutionReceiptV2(candidate)).toThrow()
    }
  })

  test('rejects impossible captured counts and scopes beyond bounded batch capacity', async () => {
    await expect(
      scopeFixture({
        initialRemainingEligibleRowCount: 1,
        initialRemainingTargetRowCount: 2
      })
    ).rejects.toThrow('initialRemainingTargetRowCount cannot exceed eligible rows')
    await expect(
      scopeFixture({
        initialRemainingEligibleRowCount: 3,
        initialRemainingTargetRowCount: 2,
        requiredMatchedRowCount: 3
      })
    ).rejects.toThrow('requiredMatchedRowCount exceeds captured target rows')

    await expect(
      scopeFixture({
        capturedHighWater: 999_900,
        initialRemainingEligibleRowCount: 999_900,
        initialRemainingTargetRowCount: 3
      })
    ).resolves.toMatchObject({ initialRemainingEligibleRowCount: 999_900 })
    await expect(
      scopeFixture({
        capturedHighWater: 999_901,
        initialRemainingEligibleRowCount: 999_901,
        initialRemainingTargetRowCount: 3
      })
    ).rejects.toThrow('initialRemainingEligibleRowCount exceeds bounded batch capacity')
    await expect(
      scopeFixture({
        capturedHighWater: Number.MAX_SAFE_INTEGER,
        initialRemainingEligibleRowCount: Number.MAX_SAFE_INTEGER,
        initialRemainingTargetRowCount: 3
      })
    ).rejects.toThrow('initialRemainingEligibleRowCount exceeds bounded batch capacity')

    const scope = await scopeFixture()
    await expect(
      receiptFixture(scope, {
        exhaustion: {
          checked: true,
          remainingEligibleRowCount: 1,
          remainingTargetRowCount: 2
        }
      })
    ).rejects.toThrow('remainingTargetRowCount cannot exceed eligible rows')
  })

  test('rejects outcome-unknown, secrets, extension fields, and accessors before use', async () => {
    const scope = await scopeFixture()
    const capture = await receiptFixture(scope)
    expect(() =>
      parseBackendBackfillExecutionReceiptV2({ ...capture, outcome: 'outcome-unknown' })
    ).toThrow('outcome is not supported')
    expect(() =>
      parseBackendBackfillExecutionReceiptV2({
        ...capture,
        executionId: stripeSecretCanary('receiptv2012345678901234567890')
      })
    ).toThrow('secret-free')
    expect(() =>
      parseBackendBackfillExecutionReceiptV2({ ...capture, payload: { rows: [] } })
    ).toThrow('unsupported fields')

    let getterCalls = 0
    const accessor = { ...capture }
    Object.defineProperty(accessor, 'receiptId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'receipt-accessor'
      }
    })
    expect(() => parseBackendBackfillExecutionReceiptV2(accessor)).toThrow(
      'enumerable data property values only'
    )
    expect(getterCalls).toBe(0)
  })
})
