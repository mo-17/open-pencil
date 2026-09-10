/* oxlint-disable eslint/max-lines -- One Host capture matrix keeps proof, SQL, drift, and response invariants together. */

import { describe, expect, test } from 'bun:test'

import {
  captureSupabaseBackfillLockedHighWaterV1,
  createSupabaseBackfillLockedHighWaterCaptureReviewV1,
  SupabaseBackfillLockedHighWaterCaptureError,
  trustedSupabaseBackfillLockedHighWaterCaptureV1,
  type CaptureSupabaseBackfillLockedHighWaterOptionsV1,
  type SupabaseBackfillLockedHighWaterCaptureErrorCode,
  type SupabaseBackfillLockedHighWaterCaptureHostTransportV1
} from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import {
  createSupabaseManagementBackfillLockedHighWaterCaptureTransport,
  type SupabaseManagementBackfillLockedHighWaterCaptureFetch
} from '@/app/plugins/host/deployment/supabase/management/backfill/locked-high-water-capture-transport'

import {
  BACKFILL_CAPTURE_FIXTURE_PAT,
  BACKFILL_CAPTURE_READ_AUTHORITY,
  createBackfillLockedHighWaterCaptureFixture,
  lockedHighWaterResponse,
  type BackfillLockedHighWaterCaptureFixture
} from './locked-high-water/helpers'

interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
}

interface MutableCaptureHighWater {
  capturedHighWater: string | null
  minimumCursor: string | null
  totalRowCount: string
  remainingNullTargetRowCount: string
  unsafeCursorRowCount: string
  requiredBatchReceiptCount: string
  maximumBatchReceiptCount: string
  withinReceiptCountLimit: boolean
}

interface MutableCaptureRow {
  highWater: MutableCaptureHighWater
  extension?: boolean
}

function withURL(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

function jsonResponse(value: unknown, status: number, url: string): Response {
  return withURL(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    }),
    url
  )
}

function successfulFetcher(
  fixture: BackfillLockedHighWaterCaptureFixture,
  row: Readonly<Record<string, unknown>>,
  requests: RecordedRequest[] = []
): SupabaseManagementBackfillLockedHighWaterCaptureFetch {
  return async (input, init) => {
    const url = String(input)
    requests.push({ url, init: init ?? {} })
    if (init?.method === 'GET') {
      return jsonResponse(
        {
          ref: fixture.writeAuthority.projectRef,
          organization_id: fixture.writeAuthority.accountId,
          name: 'Locked high-water staging'
        },
        200,
        url
      )
    }
    return jsonResponse([row], 201, url)
  }
}

function captureTransport(
  fixture: BackfillLockedHighWaterCaptureFixture,
  row = lockedHighWaterResponse(fixture),
  requests: RecordedRequest[] = []
) {
  return createSupabaseManagementBackfillLockedHighWaterCaptureTransport({
    personalAccessToken: BACKFILL_CAPTURE_FIXTURE_PAT,
    authority: fixture.writeAuthority,
    fetcher: successfulFetcher(fixture, row, requests)
  })
}

function captureOptions(
  fixture: BackfillLockedHighWaterCaptureFixture,
  transport: SupabaseBackfillLockedHighWaterCaptureHostTransportV1,
  overrides: Partial<CaptureSupabaseBackfillLockedHighWaterOptionsV1> = {}
): CaptureSupabaseBackfillLockedHighWaterOptionsV1 {
  return {
    captureReview: fixture.captureReview,
    stagingTargetBinding: fixture.install.stagingBinding,
    confirmation: fixture.confirmation,
    readCurrentCompilerInput: () => fixture.install.input,
    readCurrentReadAuthority: () => BACKFILL_CAPTURE_READ_AUTHORITY,
    readCurrentWriteAuthority: () => fixture.writeAuthority,
    readCurrentStagingTargetBinding: () => fixture.install.stagingBinding,
    transport,
    ...overrides
  }
}

async function captureError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillLockedHighWaterCaptureErrorCode
): Promise<SupabaseBackfillLockedHighWaterCaptureError> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillLockedHighWaterCaptureError)
    const error = cause as SupabaseBackfillLockedHighWaterCaptureError
    expect(error.code).toBe(expected)
    return error
  }
  throw new TypeError(`Expected locked high-water error ${expected}`)
}

describe('Supabase locked high-water capture', () => {
  test('emits deterministic review SQL with lock-before-read and full address/barrier bindings', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const repeated = await createSupabaseBackfillLockedHighWaterCaptureReviewV1({
      context: fixture.install.context,
      reconciliation: fixture.reconciliation
    })
    const { captureSql, review } = fixture.captureReview
    const executable = captureSql
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n')
    const lockOffset = executable.indexOf('LOCK TABLE ONLY')
    const firstReadOffset = executable.indexOf('\n  SELECT\n')

    expect(repeated).toEqual(fixture.captureReview)
    expect(repeated).not.toBe(fixture.captureReview)
    expect(lockOffset).toBeGreaterThan(executable.indexOf('SET TRANSACTION'))
    expect(firstReadOffset).toBeGreaterThan(lockOffset)
    expect(executable.indexOf('FROM "public"."accounts";')).toBeGreaterThan(firstReadOffset)
    expect(executable.lastIndexOf('COMMIT;')).toBeGreaterThan(firstReadOffset)
    expect(executable).toContain('IN SHARE ROW EXCLUSIVE MODE')
    expect(executable).toContain("current_setting\"('transaction_isolation') = 'serializable'")
    expect(executable).toContain("current_setting\"('row_security') = 'off'")
    expect(executable).toContain('"pg_catalog"."clock_timestamp"()')
    expect(executable).toContain('CEIL(COUNT(*)::"pg_catalog"."numeric"')
    expect(executable).toContain(`${review.address.tableOid}::"pg_catalog"."oid"`)
    expect(executable).toContain(`${review.address.primaryKeyOid}::"pg_catalog"."oid"`)
    expect(executable).toContain(`${review.address.sequenceOid}::"pg_catalog"."oid"`)
    expect(executable).toContain(`${review.address.barrierConstraintOid}::"pg_catalog"."oid"`)
    expect(executable).toContain(review.barrier.constraintName)
    expect(executable).toContain(review.barrier.marker)
    expect(executable).not.toMatch(
      /\b(?:INSERT|UPDATE|DELETE|MERGE|ALTER|CREATE|DROP|TRUNCATE|CALL|COPY)\b/iu
    )
    expect(review.query).toMatchObject({
      statementCount: 10,
      accessMode: 'read-write-locked-read',
      snapshotScope: 'explicit-serializable-transaction',
      lockMode: 'share-row-exclusive',
      containsDml: false,
      performsSchemaChange: false
    })
    expect(review.artifact.digest).toBe(review.query.digest)
    expect(review.highWater).toEqual({
      status: 'not-captured',
      lockedCapture: false,
      environmentSpecific: true
    })
    expect(review.receipt).toEqual({
      mayCreate: false,
      authorityCreated: false,
      databaseLedgerBound: false
    })
    expect(review.blockers).toContain('locked-high-water-not-captured')
    expect(review.releaseReady).toBe(false)
  })

  test('captures one exact non-empty staging high water without creating Receipt authority', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const requests: RecordedRequest[] = []
    const capture = await captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport(fixture, lockedHighWaterResponse(fixture), requests))
    )

    expect(capture).toMatchObject({
      format: 'openpencil.supabase-backfill-locked-high-water-capture.v1',
      environment: 'staging',
      releaseReady: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      sourceLedgerBound: false,
      databaseLedgerBound: false,
      highWater: {
        status: 'captured',
        lockedCapture: true,
        capturedHighWater: 42,
        minimumCursor: 1,
        totalRowCount: 42,
        remainingNullTargetRowCount: 17,
        unsafeCursorRowCount: 0,
        requiredBatchReceiptCount: 1,
        maximumBatchReceiptCount: 9_999,
        withinReceiptCountLimit: true
      },
      receipt: {
        mayCreate: false,
        authorityCreated: false,
        databaseLedgerBound: false,
        futureReceiptZeroEvidenceBinding: 'captureDigest'
      }
    })
    expect(capture.bindings.captureReviewDigest).toBe(fixture.captureReview.reviewDigest)
    expect(capture.bindings.installedVerificationDigest).toBe(fixture.installed.verificationDigest)
    expect(capture.authority).toEqual({
      projectRef: fixture.writeAuthority.projectRef,
      accountId: fixture.writeAuthority.accountId,
      readGrantGeneration: BACKFILL_CAPTURE_READ_AUTHORITY.grantGeneration,
      installWriteGrantGeneration: fixture.install.writeAuthority.grantGeneration,
      captureWriteGrantGeneration: fixture.writeAuthority.grantGeneration
    })
    expect(capture.blockers).not.toContain('locked-high-water-not-captured')
    expect(capture.blockers).toContain(
      'management-query-transaction-result-contract-not-staging-verified'
    )
    expect(capture.blockers).toContain('provider-v2-receipt-binding-not-implemented')
    expect(capture.blockers).toContain('database-batch-ledger-not-implemented')
    expect(capture.blockers).toContain('execution-runner-unavailable')
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(capture)).toBe(true)
    expect(trustedSupabaseBackfillLockedHighWaterCaptureV1(structuredClone(capture))).toBe(false)
    expect(JSON.stringify(capture)).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)
    expect(JSON.stringify(capture)).not.toContain(fixture.captureReview.captureSql)
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'POST', 'GET'])
    const body = requests[1]?.init.body
    if (typeof body !== 'string') throw new TypeError('Expected capture JSON body')
    expect(JSON.parse(body)).toEqual({
      query: fixture.captureReview.captureSql,
      read_only: false
    })
    expect(body).not.toContain(BACKFILL_CAPTURE_FIXTURE_PAT)
    expect(requests.every(({ init }) => init.credentials === 'omit')).toBe(true)
    expect(requests.every(({ init }) => init.redirect === 'error')).toBe(true)
  })

  test('represents an empty table with null cursors and zero receipt batches', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const row = lockedHighWaterResponse(fixture, {
      capturedHighWater: null,
      minimumCursor: null,
      totalRowCount: '0',
      remainingNullTargetRowCount: '0',
      requiredBatchReceiptCount: '0'
    })
    const capture = await captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport(fixture, row))
    )

    expect(capture.highWater).toMatchObject({
      capturedHighWater: null,
      minimumCursor: null,
      totalRowCount: 0,
      remainingNullTargetRowCount: 0,
      requiredBatchReceiptCount: 0
    })
  })

  test('sizes receipt capacity from every cursor row so each keyset scan stays bounded', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const row = lockedHighWaterResponse(fixture, {
      capturedHighWater: '3000',
      totalRowCount: '2500',
      remainingNullTargetRowCount: '0',
      requiredBatchReceiptCount: '10'
    })
    const capture = await captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport(fixture, row))
    )

    expect(capture.highWater).toMatchObject({
      totalRowCount: 2_500,
      remainingNullTargetRowCount: 0,
      requiredBatchReceiptCount: 10,
      withinReceiptCountLimit: true
    })
  })

  test('rejects cloned reviews and unbranded transports before Host callbacks or fetch', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    let callbackCalls = 0
    let transportCalls = 0
    const fakeTransport = Object.freeze({
      async runLockedHighWaterCapture() {
        transportCalls += 1
        return lockedHighWaterResponse(fixture)
      }
    })
    const callbacks = {
      readCurrentCompilerInput: () => {
        callbackCalls += 1
        return fixture.install.input
      },
      readCurrentReadAuthority: () => {
        callbackCalls += 1
        return BACKFILL_CAPTURE_READ_AUTHORITY
      },
      readCurrentWriteAuthority: () => {
        callbackCalls += 1
        return fixture.writeAuthority
      },
      readCurrentStagingTargetBinding: () => {
        callbackCalls += 1
        return fixture.install.stagingBinding
      }
    }
    await captureError(
      captureSupabaseBackfillLockedHighWaterV1(captureOptions(fixture, fakeTransport, callbacks)),
      'supabase-backfill-locked-high-water-proof-invalid'
    )
    expect(callbackCalls).toBe(0)
    expect(transportCalls).toBe(0)

    const fresh = await createBackfillLockedHighWaterCaptureFixture()
    const requests: RecordedRequest[] = []
    await captureError(
      captureSupabaseBackfillLockedHighWaterV1({
        ...captureOptions(fresh, captureTransport(fresh, lockedHighWaterResponse(fresh), requests)),
        captureReview: structuredClone(fresh.captureReview)
      }),
      'supabase-backfill-locked-high-water-proof-invalid'
    )
    expect(requests).toHaveLength(0)
  })

  test('consumes one applied reconciliation across concurrent capture attempts', async () => {
    const fixture = await createBackfillLockedHighWaterCaptureFixture()
    const requests: RecordedRequest[] = []
    const first = captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport(fixture, lockedHighWaterResponse(fixture), requests))
    )
    const second = captureSupabaseBackfillLockedHighWaterV1(
      captureOptions(fixture, captureTransport(fixture, lockedHighWaterResponse(fixture), requests))
    )
    const settled = await Promise.allSettled([first, second])
    const fulfilled = settled.filter((entry) => entry.status === 'fulfilled')
    const rejected = settled.filter((entry) => entry.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'supabase-backfill-locked-high-water-proof-invalid'
    })
    expect(requests.map(({ init }) => init.method)).toEqual(['GET', 'POST', 'GET'])
  })

  test('fails closed on response extensions, unsafe cursors, and receipt overflow', async () => {
    const cases: ReadonlyArray<{
      readonly mutate: (row: MutableCaptureRow) => void
      readonly code: SupabaseBackfillLockedHighWaterCaptureErrorCode
    }> = [
      {
        mutate: (row) => {
          row.extension = true
        },
        code: 'supabase-backfill-locked-high-water-response-invalid'
      },
      {
        mutate: (row) => {
          row.highWater.unsafeCursorRowCount = '1'
        },
        code: 'supabase-backfill-locked-high-water-unsafe-cursor'
      },
      {
        mutate: (row) => {
          row.highWater.totalRowCount = '43'
        },
        code: 'supabase-backfill-locked-high-water-unsafe-cursor'
      },
      {
        mutate: (row) => {
          Object.assign(row.highWater, {
            capturedHighWater: '9007199254740991',
            totalRowCount: '2500000',
            remainingNullTargetRowCount: '1',
            requiredBatchReceiptCount: '10000',
            withinReceiptCountLimit: false
          })
        },
        code: 'supabase-backfill-locked-high-water-receipt-capacity-exceeded'
      }
    ]

    for (const entry of cases) {
      const fixture = await createBackfillLockedHighWaterCaptureFixture()
      const row = structuredClone(lockedHighWaterResponse(fixture)) as MutableCaptureRow
      entry.mutate(row)
      await captureError(
        captureSupabaseBackfillLockedHighWaterV1(
          captureOptions(fixture, captureTransport(fixture, row))
        ),
        entry.code
      )
    }
  })

  test('rejects grant aliasing and authority drift around the network boundary', async () => {
    const aliased = await createBackfillLockedHighWaterCaptureFixture()
    const aliasedAuthority = Object.freeze({
      ...aliased.writeAuthority,
      grantGeneration: BACKFILL_CAPTURE_READ_AUTHORITY.grantGeneration
    })
    await captureError(
      captureSupabaseBackfillLockedHighWaterV1(
        captureOptions(aliased, captureTransport(aliased), {
          confirmation: Object.freeze({
            ...aliased.confirmation,
            captureGrantGeneration: aliasedAuthority.grantGeneration
          }),
          readCurrentWriteAuthority: () => aliasedAuthority
        })
      ),
      'supabase-backfill-locked-high-water-write-authority-not-separated'
    )

    const drifted = await createBackfillLockedHighWaterCaptureFixture()
    let readCount = 0
    await captureError(
      captureSupabaseBackfillLockedHighWaterV1(
        captureOptions(drifted, captureTransport(drifted), {
          readCurrentReadAuthority: () => {
            readCount += 1
            return readCount < 3
              ? BACKFILL_CAPTURE_READ_AUTHORITY
              : Object.freeze({
                  ...BACKFILL_CAPTURE_READ_AUTHORITY,
                  grantGeneration: '423e4567-e89b-42d3-a456-426614174000'
                })
          }
        })
      ),
      'supabase-backfill-locked-high-water-input-changed'
    )
    expect(readCount).toBe(3)
  })
})
