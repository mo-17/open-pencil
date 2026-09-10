import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilitiesV2,
  lowerBackendApplicationSpecV1ToV2
} from '#lowcode/backend/application'
import type { BackendApplicationSpecV2 } from '#lowcode/backend/application/types'
import {
  appendBackendBackfillExecutionReceipt,
  canonicalBackendBackfillExecutionReceiptBytes,
  createBackendBackfillExecutionScope,
  digestBackendBackfillExecutionReceipt,
  parseBackendBackfillExecutionReceipt,
  verifyBackendBackfillExecutionReceiptChain,
  type BackendBackfillExecutionAppendAuthorityV1,
  type BackendBackfillExecutionTrustedContextV1
} from '#lowcode/backend/release/backfill-execution'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { backendApplicationFixture, stripeSecretCanary } from '../fixture'

const NOW = '2026-09-04T00:00:00.000000001Z'
const EVALUATED_AT = '2026-09-04T00:00:10Z'
const HIGH_WATER = 100
const MID_KEY = 50

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

function applicationFixture(): BackendApplicationSpecV2 {
  const source = backendApplicationFixture()
  source.dataModel.entities[0].fields[0] = {
    id: 'id',
    name: 'id',
    type: 'integer',
    nullable: false,
    default: { kind: 'generated', generator: 'identity' }
  }
  const lowered = lowerBackendApplicationSpecV1ToV2(source)
  if (!lowered.ok) throw new Error('Backend V1 fixture must lower to V2')
  const application = structuredClone(lowered.value)
  application.dataMigrations.migrations.push({
    id: 'notes-title-backfill',
    name: 'Backfill note titles',
    entityId: 'notes',
    cursor: { kind: 'monotonic-identity-primary-key', fieldId: 'id' },
    batchSize: 100,
    predicate: { kind: 'field-is-null', fieldId: 'title' },
    transforms: [{ kind: 'set-literal', fieldId: 'title', value: 'Untitled' }],
    postconditions: [{ kind: 'field-not-null', fieldId: 'title' }],
    dryRunRequired: true,
    resumePolicy: 'from-receipt'
  })
  application.capabilities = deriveBackendApplicationCapabilitiesV2(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}

async function trustedContext(
  trustedHeadDigest: string | null,
  overrides: Partial<BackendBackfillExecutionTrustedContextV1> = {}
): Promise<BackendBackfillExecutionTrustedContextV1> {
  return {
    providerId: 'provider.test',
    environment: 'staging',
    authorityDigest: await digest('authority'),
    migrationId: 'notes-title-backfill',
    trustedHeadDigest,
    evaluatedAt: EVALUATED_AT,
    ...overrides
  }
}

async function receiptInput(
  overrides: Partial<BackendBackfillExecutionAppendAuthorityV1> = {}
): Promise<BackendBackfillExecutionAppendAuthorityV1> {
  return {
    receiptId: 'receipt-0',
    executionId: 'execution-1',
    capturedHighWater: HIGH_WATER,
    lastProcessedKey: null,
    batchIndex: 0,
    scannedRowCount: 0,
    matchedRowCount: 0,
    updatedRowCount: 0,
    outcome: 'in-progress',
    stableErrorCode: null,
    checkedAt: NOW,
    evidenceDigest: await digest('capture-evidence'),
    ...overrides
  }
}

describe('resumable Backend data backfill execution receipts', () => {
  test('derives an environment and authority-bound scope from source-only migration IR', async () => {
    const application = applicationFixture()
    expect(application.dataMigrations.migrations[0]?.cursor).toEqual({
      kind: 'monotonic-identity-primary-key',
      fieldId: 'id'
    })
    const context = await trustedContext(null)
    const scope = await createBackendBackfillExecutionScope(application, {
      providerId: context.providerId,
      environment: context.environment,
      authorityDigest: context.authorityDigest,
      migrationId: context.migrationId
    })

    expect(scope).toMatchObject({
      providerId: 'provider.test',
      environment: 'staging',
      authorityDigest: context.authorityDigest,
      migrationId: 'notes-title-backfill',
      cursorField: 'id',
      cursorFieldType: 'integer',
      batchSize: 100
    })
    expect(scope.applicationDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(scope.migrationDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  test('appends capture, resumable batch, and terminal receipts against a trusted CAS head', async () => {
    const application = applicationFixture()
    const capture = await appendBackendBackfillExecutionReceipt(
      application,
      [],
      await trustedContext(null),
      await receiptInput()
    )
    const batch = await appendBackendBackfillExecutionReceipt(
      application,
      [capture.receipt],
      await trustedContext(capture.receiptDigest),
      await receiptInput({
        receiptId: 'receipt-1',
        lastProcessedKey: MID_KEY,
        batchIndex: 1,
        scannedRowCount: 50,
        matchedRowCount: 40,
        updatedRowCount: 40,
        checkedAt: '2026-09-04T00:00:00.000000002Z',
        evidenceDigest: await digest('batch-1-evidence')
      })
    )
    const completed = await appendBackendBackfillExecutionReceipt(
      application,
      [capture.receipt, batch.receipt],
      await trustedContext(batch.receiptDigest),
      await receiptInput({
        receiptId: 'receipt-2',
        lastProcessedKey: HIGH_WATER,
        batchIndex: 2,
        scannedRowCount: 100,
        matchedRowCount: 80,
        updatedRowCount: 80,
        outcome: 'completed',
        checkedAt: '2026-09-04T00:00:00.000000003Z',
        evidenceDigest: await digest('completion-evidence')
      })
    )

    expect(completed.receipt.previousReceiptDigest).toBe(batch.receiptDigest)
    expect(completed.receiptDigest).toBe(
      await digestBackendBackfillExecutionReceipt(completed.receipt)
    )
    expect(canonicalBackendBackfillExecutionReceiptBytes(completed.receipt)).toBeInstanceOf(
      Uint8Array
    )
    expect(
      await verifyBackendBackfillExecutionReceiptChain(
        application,
        [capture.receipt, batch.receipt, completed.receipt],
        await trustedContext(completed.receiptDigest)
      )
    ).toMatchObject({
      ok: true,
      computedHeadDigest: completed.receiptDigest,
      outcome: 'completed'
    })

    await expect(
      appendBackendBackfillExecutionReceipt(
        application,
        [capture.receipt, batch.receipt, completed.receipt],
        await trustedContext(completed.receiptDigest),
        await receiptInput({
          receiptId: 'receipt-3',
          batchIndex: 3,
          checkedAt: '2026-09-04T00:00:00.000000004Z'
        })
      )
    ).rejects.toThrow('backfill-execution-terminal')
  })

  test('rejects replay across provider, environment, authority, application, or migration scope', async () => {
    const application = applicationFixture()
    const capture = await appendBackendBackfillExecutionReceipt(
      application,
      [],
      await trustedContext(null),
      await receiptInput()
    )
    const cases: Array<{
      application: BackendApplicationSpecV2
      context: BackendBackfillExecutionTrustedContextV1
      code: string
    }> = [
      {
        application,
        context: await trustedContext(capture.receiptDigest, { providerId: 'provider.other' }),
        code: 'backfill-execution-scope-mismatch'
      },
      {
        application,
        context: await trustedContext(capture.receiptDigest, { environment: 'production' }),
        code: 'backfill-execution-scope-mismatch'
      },
      {
        application,
        context: await trustedContext(capture.receiptDigest, {
          authorityDigest: await digest('other-authority')
        }),
        code: 'backfill-execution-scope-mismatch'
      },
      {
        application: { ...application, applicationId: 'other-application' },
        context: await trustedContext(capture.receiptDigest),
        code: 'backfill-execution-scope-mismatch'
      },
      {
        application,
        context: await trustedContext(capture.receiptDigest, { migrationId: 'other-migration' }),
        code: 'backfill-execution-invalid'
      }
    ]

    for (const candidate of cases) {
      expect(
        await verifyBackendBackfillExecutionReceiptChain(
          candidate.application,
          [capture.receipt],
          candidate.context
        )
      ).toMatchObject({ ok: false, code: candidate.code })
    }
  })

  test('rejects cursor regression, high-water overflow, and inconsistent batch counts', async () => {
    const application = applicationFixture()
    const capture = await appendBackendBackfillExecutionReceipt(
      application,
      [],
      await trustedContext(null),
      await receiptInput()
    )
    const history = [capture.receipt]
    const context = await trustedContext(capture.receiptDigest)
    const attacks: Array<{
      input: Partial<BackendBackfillExecutionAppendAuthorityV1>
      code: string
    }> = [
      {
        input: {
          receiptId: 'receipt-overflow',
          batchIndex: 1,
          lastProcessedKey: 101,
          scannedRowCount: 1
        },
        code: 'backfill-execution-high-water-exceeded'
      },
      {
        input: {
          receiptId: 'receipt-oversized-batch',
          batchIndex: 1,
          lastProcessedKey: HIGH_WATER,
          scannedRowCount: 101,
          outcome: 'completed'
        },
        code: 'backfill-execution-transition-invalid'
      },
      {
        input: {
          receiptId: 'receipt-counts',
          batchIndex: 1,
          lastProcessedKey: MID_KEY,
          scannedRowCount: 1,
          matchedRowCount: 2,
          updatedRowCount: 1
        },
        code: 'cumulative row counts are inconsistent'
      }
    ]
    for (const attack of attacks) {
      await expect(
        appendBackendBackfillExecutionReceipt(
          application,
          history,
          context,
          await receiptInput({
            checkedAt: '2026-09-04T00:00:00.000000002Z',
            ...attack.input
          })
        )
      ).rejects.toThrow(attack.code)
    }

    const batch = await appendBackendBackfillExecutionReceipt(
      application,
      history,
      context,
      await receiptInput({
        receiptId: 'receipt-1',
        batchIndex: 1,
        lastProcessedKey: MID_KEY,
        scannedRowCount: 50,
        matchedRowCount: 40,
        updatedRowCount: 40,
        checkedAt: '2026-09-04T00:00:00.000000002Z'
      })
    )
    await expect(
      appendBackendBackfillExecutionReceipt(
        application,
        [...history, batch.receipt],
        await trustedContext(batch.receiptDigest),
        await receiptInput({
          receiptId: 'receipt-regressed',
          batchIndex: 2,
          lastProcessedKey: 49,
          scannedRowCount: 60,
          matchedRowCount: 45,
          updatedRowCount: 45,
          checkedAt: '2026-09-04T00:00:00.000000003Z'
        })
      )
    ).rejects.toThrow('backfill-execution-progress-regressed')

    await expect(
      appendBackendBackfillExecutionReceipt(
        application,
        [...history, batch.receipt],
        await trustedContext(batch.receiptDigest),
        await receiptInput({
          receiptId: 'receipt-stalled',
          batchIndex: 2,
          lastProcessedKey: MID_KEY,
          scannedRowCount: 60,
          matchedRowCount: 45,
          updatedRowCount: 45,
          checkedAt: '2026-09-04T00:00:00.000000003Z'
        })
      )
    ).rejects.toThrow('backfill-execution-progress-regressed')

    const failed = await appendBackendBackfillExecutionReceipt(
      application,
      history,
      context,
      await receiptInput({
        receiptId: 'receipt-failed',
        batchIndex: 1,
        outcome: 'failed',
        stableErrorCode: 'provider-timeout',
        checkedAt: '2026-09-04T00:00:00.000000002Z'
      })
    )
    expect(failed.receipt).toMatchObject({
      lastProcessedKey: null,
      scannedRowCount: 0,
      outcome: 'failed'
    })
  })

  test('uses nanosecond ordering and rejects stale or recomputed chain heads', async () => {
    const application = applicationFixture()
    const capture = await appendBackendBackfillExecutionReceipt(
      application,
      [],
      await trustedContext(null),
      await receiptInput()
    )
    await expect(
      appendBackendBackfillExecutionReceipt(
        application,
        [capture.receipt],
        await trustedContext(capture.receiptDigest),
        await receiptInput({
          receiptId: 'receipt-nanosecond-regression',
          batchIndex: 1,
          lastProcessedKey: MID_KEY,
          checkedAt: '2026-09-04T00:00:00.000000000Z'
        })
      )
    ).rejects.toThrow('backfill-execution-transition-invalid')

    expect(
      await verifyBackendBackfillExecutionReceiptChain(
        application,
        [capture.receipt],
        await trustedContext(await digest('attacker-head'))
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-head-mismatch' })

    const tampered = parseBackendBackfillExecutionReceipt({
      ...capture.receipt,
      evidenceDigest: await digest('tampered-evidence')
    })
    expect(
      await verifyBackendBackfillExecutionReceiptChain(
        application,
        [tampered],
        await trustedContext(capture.receiptDigest)
      )
    ).toMatchObject({ ok: false, code: 'backfill-execution-head-mismatch' })
  })

  test('supports an empty capture as an immediately completed execution', async () => {
    const application = applicationFixture()
    const completed = await appendBackendBackfillExecutionReceipt(
      application,
      [],
      await trustedContext(null),
      await receiptInput({ capturedHighWater: null, outcome: 'completed' })
    )
    expect(completed.receipt).toMatchObject({
      capturedHighWater: null,
      lastProcessedKey: null,
      outcome: 'completed'
    })
  })

  test('rejects payload fields, credential material, and accessors without invoking them', async () => {
    const application = applicationFixture()
    await expect(
      appendBackendBackfillExecutionReceipt(application, [], await trustedContext(null), {
        ...(await receiptInput()),
        payload: { rows: [] }
      })
    ).rejects.toThrow('unsupported fields')
    await expect(
      appendBackendBackfillExecutionReceipt(
        application,
        [],
        await trustedContext(null),
        await receiptInput({ executionId: stripeSecretCanary('backfill012345678901234567890') })
      )
    ).rejects.toThrow('secret-free')

    const input = await receiptInput()
    let getterCalls = 0
    Object.defineProperty(input, 'receiptId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'receipt-0'
      }
    })
    await expect(
      appendBackendBackfillExecutionReceipt(application, [], await trustedContext(null), input)
    ).rejects.toThrow('enumerable data property values only')
    expect(getterCalls).toBe(0)
  })
})
