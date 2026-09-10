import { describe, expect, test } from 'bun:test'

import { encodeBase64URL } from '@open-pencil/scene-graph'

import CAS_LEDGER_SCHEMA_SQL_SOURCE from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/schema-v1.sql?raw'

import {
  createSupabaseBackfillDatabaseCASLedgerReviewV1,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_REVIEW_FORMAT,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
  SupabaseBackfillDatabaseCASLedgerReviewError,
  trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1,
  type SupabaseBackfillDatabaseCASLedgerReviewErrorCode
} from '@/app/plugins/host/deployment/supabase/backfill/database/cas-ledger/review'
import { consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1 } from '@/app/plugins/host/deployment/supabase/backfill/locked-high-water-capture'
import { createSupabaseBackfillReceiptV2ReviewV1 } from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'

import {
  BACKFILL_CAPTURE_FIXTURE_GRANT,
  BACKFILL_CAPTURE_FIXTURE_PAT,
  createCapturedBackfillLockedHighWaterFixture
} from '#tests/engine/app/plugins/deployment/supabase/backfill/locked-high-water/helpers'
import {
  BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
  BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
  BACKFILL_INSTALL_FIXTURE_READ_GRANT,
  BACKFILL_INSTALL_FIXTURE_WRITE_GRANT
} from '#tests/engine/app/plugins/deployment/supabase/backfill/write-barrier/helpers'

async function createReceiptReview(batchSize = 250) {
  const { capture } = await createCapturedBackfillLockedHighWaterFixture(batchSize)
  return createSupabaseBackfillReceiptV2ReviewV1({ capture })
}

async function digestBytes(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

async function ledgerError(
  operation: Promise<unknown>,
  expected: SupabaseBackfillDatabaseCASLedgerReviewErrorCode
): Promise<void> {
  try {
    await operation
  } catch (cause) {
    expect(cause).toBeInstanceOf(SupabaseBackfillDatabaseCASLedgerReviewError)
    expect((cause as SupabaseBackfillDatabaseCASLedgerReviewError).code).toBe(expected)
    return
  }
  throw new TypeError(`Expected database CAS ledger review error ${expected}`)
}

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor && 'value' in descriptor) expectDeepFrozen(descriptor.value, seen)
  }
}

describe('Supabase backfill database CAS ledger DDL review', () => {
  test('returns deterministic canonical review material without creating any authority', async () => {
    const receiptReview = await createReceiptReview()
    const [first, repeated] = await Promise.all([
      createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview }),
      createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview })
    ])

    expect(repeated).toEqual(first)
    expect(repeated).not.toBe(first)
    expect(first.reviewDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review).toMatchObject({
      format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_REVIEW_FORMAT,
      version: 1,
      providerId: 'supabase',
      environmentIntent: 'staging',
      reviewOnly: true,
      applyAvailable: false,
      databaseLedgerBound: false,
      sourceLedgerBound: false,
      releaseReady: false,
      installAuthorityCreated: false,
      installedVerificationCreated: false,
      installControllerAvailable: false,
      executionAuthorityCreated: false,
      receiptAuthorityCreated: false,
      bindings: {
        receiptReviewDigest: receiptReview.reviewDigest,
        scopeDraftDigest: receiptReview.review.bindings.scopeDraftDigest,
        captureDigest: receiptReview.review.bindings.captureDigest,
        providerAuthorityDigest: receiptReview.review.bindings.providerAuthorityDigest,
        applicationDigest: receiptReview.review.bindings.applicationDigest,
        migrationDigest: receiptReview.review.bindings.migrationDigest
      },
      ledger: {
        schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
        tables: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
        captureDigestUnique: true,
        scopeDigestUnique: true,
        receiptIdUniquePerExecution: true,
        eventIdUniquePerExecution: true,
        idempotencyKeyUniquePerExecution: true,
        requestDigestUniquePerExecution: true,
        receiptDigestUniquePerExecution: true,
        maximumReceiptsPerExecution: 10_000,
        maximumBatchReceiptsPerExecution: 9_999,
        maximumCanonicalScopeBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES,
        maximumCanonicalReceiptBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES,
        scopeBytesStoredExactly: true,
        receiptBytesStoredExactly: true,
        databaseCanonicalDigestRequired: true,
        receiptDigestInputRequired: true,
        receiptPreviousHeadForeignKey: true,
        previousHeadRevisionIsImmediatelyPrior: true,
        captureCheckpointAtInitialRevisionOnly: true,
        currentHeadReceiptForeignKey: true,
        currentHeadTupleColumns: ['revision', 'eventId', 'receiptDigest'],
        databaseCompareAndSwapRequiredByReceiptPolicy: true,
        databaseCompareAndSwapEnforced: false,
        initialRevision: 1,
        maximumRevision: 10_000,
        safeIntegerHighWaterBound: true,
        captureCountsAndBatchCapacityConstrained: true
      },
      security: {
        privateSchema: true,
        rowLevelSecurityEnabled: true,
        rowLevelSecurityForced: false,
        policyCount: 0,
        deniedRoles: ['PUBLIC', 'anon', 'authenticated', 'service_role'],
        securityDefinerUsed: false,
        extensionRequired: false,
        identityOrSequenceUsed: false
      },
      artifact: {
        path: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH,
        kind: 'database-cas-ledger-schema-review',
        mediaType: 'application/sql; charset=utf-8',
        statementCount: 19,
        schemaMutationStatementCount: 13,
        containsManagedDataRead: false,
        containsDml: false,
        performsSchemaChange: true,
        mutationDispatched: false,
        hostDispatchAvailable: false
      }
    })
    expect(first.review.bindings.ledgerShapeDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review.bindings.sqlDigest).toMatch(/^[A-Za-z0-9_-]{43}$/u)
    expect(first.review.artifact.digest).toBe(first.review.bindings.sqlDigest)
    expect(first.previewSql).toBe(CAS_LEDGER_SCHEMA_SQL_SOURCE)
    expect(new TextEncoder().encode(CAS_LEDGER_SCHEMA_SQL_SOURCE).byteLength).toBe(9_627)
    expect(CAS_LEDGER_SCHEMA_SQL_SOURCE.endsWith('\n')).toBe(true)
    expect(CAS_LEDGER_SCHEMA_SQL_SOURCE.endsWith('\n\n')).toBe(false)
    expect(await digestBytes(CAS_LEDGER_SCHEMA_SQL_SOURCE)).toBe(
      'oRFYTUNJDPRM83W1tmGQygKfaBSVjAZAVpG8tR1WSdw'
    )
    expect(first.review.artifact.byteLength).toBe(
      new TextEncoder().encode(first.previewSql).byteLength
    )
    expect(first.review.blockers).toEqual(
      expect.arrayContaining([
        'database-ledger-not-installed',
        'database-ledger-install-authority-not-created',
        'database-ledger-not-verified',
        'database-ledger-install-controller-unavailable',
        'source-migration-ledger-not-bound',
        'capture-receipt-not-persisted',
        'bounded-runner-unavailable'
      ])
    )
    expect(trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(first)).toEqual({
      envelope: first,
      receiptReview
    })
    expect(
      trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(structuredClone(first))
    ).toBeNull()
    expectDeepFrozen(first)
  })

  test('emits one private three-table ledger with strict receipt predecessor and current-head constraints', async () => {
    const receiptReview = await createReceiptReview()
    const { previewSql: sql } = await createSupabaseBackfillDatabaseCASLedgerReviewV1({
      receiptReview
    })

    expect(sql.match(/;/gu)).toHaveLength(19)
    expect(sql.match(/^CREATE TABLE /gmu)).toHaveLength(3)
    expect(sql).toContain('CREATE SCHEMA "openpencil_release";')
    expect(sql).toContain('CREATE TABLE "openpencil_release"."backfill_executions_v1"')
    expect(sql).toContain('CREATE TABLE "openpencil_release"."backfill_receipts_v2"')
    expect(sql).toContain('CREATE TABLE "openpencil_release"."backfill_heads_v1"')
    expect(sql).toContain('UNIQUE ("capture_digest")')
    expect(sql).toContain('UNIQUE ("scope_digest")')
    expect(sql).toContain('"canonical_scope" bytea NOT NULL')
    expect(sql).toContain(
      '"canonical_scope_byte_length" = pg_catalog.octet_length("canonical_scope")'
    )
    expect(sql).toContain('pg_catalog.encode(pg_catalog.sha256("canonical_scope"), \'base64\')')
    expect(sql).toContain('"scope_digest" = pg_catalog.translate(')
    expect(sql).toContain('"migration_plan_digest" text NOT NULL')
    expect(sql).toContain('"resource_identity_digest" text NOT NULL')
    expect(sql).toContain('"catalog_precondition_digest" text NOT NULL')
    expect(sql).toContain('"initial_remaining_eligible_row_count" bigint NOT NULL')
    expect(sql).toContain('"initial_remaining_target_row_count" bigint NOT NULL')
    expect(sql).toContain('"required_matched_row_count" bigint')
    expect(sql).toContain('"required_batch_count" integer NOT NULL')
    expect(sql).toContain('"captured_high_water" BETWEEN 0 AND 9007199254740991')
    expect(sql).toContain(
      '"initial_remaining_target_row_count" BETWEEN 0 AND "initial_remaining_eligible_row_count"'
    )
    expect(sql).toContain(
      'FOREIGN KEY ("execution_id", "previous_revision", "previous_event_id", "previous_receipt_digest")'
    )
    expect(sql).toContain(
      'REFERENCES "openpencil_release"."backfill_receipts_v2" ("execution_id", "revision", "event_id", "receipt_digest") ON UPDATE RESTRICT ON DELETE RESTRICT'
    )
    expect(sql).not.toContain('MATCH FULL')
    expect(sql).toContain('FOREIGN KEY ("execution_id", "revision", "event_id", "receipt_digest")')
    expect(sql).toContain('"previous_revision" IS NOT NULL')
    expect(sql).toContain('"previous_revision" = "revision" - 1')
    expect(sql).toContain('"revision" BETWEEN 1 AND 10000')
    expect(sql).toContain('("revision" = 1 AND "checkpoint_kind" = \'capture\')')
    expect(sql).toContain('("revision" > 1 AND "checkpoint_kind" IN (\'batch\', \'failure\'))')
    expect(sql).toContain('UNIQUE ("execution_id", "receipt_id")')
    expect(sql).toContain('UNIQUE ("execution_id", "idempotency_key")')
    expect(sql).toContain('UNIQUE ("execution_id", "request_digest")')
    expect(sql).toContain('"request_digest" ~ \'^[A-Za-z0-9_-]{43}$\'')
    expect(sql).toContain(
      '"canonical_receipt_byte_length" = pg_catalog.octet_length("canonical_receipt")'
    )
    expect(sql).toContain('"canonical_receipt_byte_length" BETWEEN 2 AND 65536')
    expect(sql).toContain('pg_catalog.encode(pg_catalog.sha256("canonical_receipt"), \'base64\')')
    expect(sql).toContain('"receipt_digest" = pg_catalog.translate(')
    expect(sql).toContain('"maximum_receipt_count" = 10000')
    expect(sql).toContain('"maximum_batch_count" = 9999')
    expect(sql.match(/ ENABLE ROW LEVEL SECURITY;/gu)).toHaveLength(3)
    expect(sql).not.toContain('FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('FROM PUBLIC, "anon", "authenticated", "service_role";')
    expect(sql).not.toMatch(/CREATE POLICY/iu)
    expect(sql).not.toMatch(/IF NOT EXISTS/iu)
    expect(sql).not.toMatch(/SECURITY DEFINER/iu)
    expect(sql).not.toMatch(/CREATE EXTENSION|pgcrypto/iu)
    expect(sql).not.toMatch(/GENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY|CREATE SEQUENCE/iu)
    expect(sql).not.toMatch(/^(?:INSERT|UPDATE|DELETE|MERGE)\b/gimu)
    expect(sql).not.toContain('outcome-unknown')
  })

  test('keeps the generic DDL free of credentials and raw project or account authority', async () => {
    const receiptReview = await createReceiptReview()
    const result = await createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview })
    const serialized = JSON.stringify(result)

    expect(result.review).not.toHaveProperty('authority')
    expect(result.review).not.toHaveProperty('address')
    for (const forbidden of [
      BACKFILL_CAPTURE_FIXTURE_PAT,
      BACKFILL_CAPTURE_FIXTURE_GRANT,
      BACKFILL_INSTALL_FIXTURE_PROJECT_REF,
      BACKFILL_INSTALL_FIXTURE_ACCOUNT_ID,
      BACKFILL_INSTALL_FIXTURE_READ_GRANT,
      BACKFILL_INSTALL_FIXTURE_WRITE_GRANT
    ]) {
      expect(serialized).not.toContain(forbidden)
      expect(result.previewSql).not.toContain(forbidden)
    }
    expect(result.previewSql).not.toContain(receiptReview.reviewDigest)
    expect(result.previewSql).not.toContain(receiptReview.review.bindings.scopeDraftDigest)
    expect(result.previewSql).not.toContain(receiptReview.review.bindings.captureDigest)
  })

  test('invalidates inherited review provenance when the capture is consumed', async () => {
    const { capture } = await createCapturedBackfillLockedHighWaterFixture()
    const receiptReview = await createSupabaseBackfillReceiptV2ReviewV1({ capture })
    const ledgerReview = await createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview })

    expect(trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(ledgerReview)).not.toBeNull()
    expect(consumeTrustedSupabaseBackfillLockedHighWaterCaptureV1(capture)).not.toBeNull()
    expect(trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(ledgerReview)).toBeNull()
  })

  test('rejects cloned proof envelopes and hostile option records without invoking accessors', async () => {
    const receiptReview = await createReceiptReview()
    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1({
        receiptReview: structuredClone(receiptReview)
      }),
      'supabase-backfill-database-cas-ledger-receipt-review-proof-invalid'
    )
    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1({ receiptReview, extra: true } as never),
      'supabase-backfill-database-cas-ledger-input-invalid'
    )
    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1(
        Object.assign(Object.create({ inherited: true }), { receiptReview })
      ),
      'supabase-backfill-database-cas-ledger-input-invalid'
    )

    let getterCalls = 0
    const accessor = {}
    Object.defineProperty(accessor, 'receiptReview', {
      enumerable: true,
      get() {
        getterCalls += 1
        return receiptReview
      }
    })
    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1(accessor as never),
      'supabase-backfill-database-cas-ledger-input-invalid'
    )
    expect(getterCalls).toBe(0)

    const symbolInput = { receiptReview } as Record<PropertyKey, unknown>
    symbolInput[Symbol('extra')] = true
    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1(symbolInput as never),
      'supabase-backfill-database-cas-ledger-input-invalid'
    )

    await ledgerError(
      createSupabaseBackfillDatabaseCASLedgerReviewV1(
        new Proxy(
          { receiptReview },
          {
            ownKeys() {
              throw new TypeError('hostile ownKeys')
            }
          }
        )
      ),
      'supabase-backfill-database-cas-ledger-input-invalid'
    )
  })
})
