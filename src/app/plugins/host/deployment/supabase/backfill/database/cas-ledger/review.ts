/* oxlint-disable eslint(max-lines) -- One review artifact keeps its contract, fixed DDL, and provenance checks co-located. */

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA_SQL_SOURCE from './schema-v1.sql?raw'

import {
  trustedSupabaseBackfillReceiptV2ReviewContextV1,
  type SupabaseBackfillReceiptV2ReviewEnvelopeV1
} from '@/app/plugins/host/deployment/supabase/backfill/receipt/v2/review'

export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_REVIEW_FORMAT =
  'openpencil.supabase-backfill-database-cas-ledger-review.v1' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH =
  'backend/supabase-v2/backfill/database-cas-ledger-review.sql' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA = 'openpencil_release' as const
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES = Object.freeze({
  executions: 'backfill_executions_v1' as const,
  receipts: 'backfill_receipts_v2' as const,
  heads: 'backfill_heads_v1' as const
})
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES = 65_536
export const SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES = 65_536

const INPUT_KEYS = ['receiptReview'] as const
const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const EXPECTED_MAXIMUM_RECEIPT_COUNT = 10_000
const EXPECTED_MAXIMUM_BATCH_COUNT = 9_999
const STATEMENT_COUNT = 19
const SCHEMA_MUTATION_STATEMENT_COUNT = 13
const DENIED_ROLES = Object.freeze(['PUBLIC', 'anon', 'authenticated', 'service_role'] as const)
const LEDGER_BLOCKERS = Object.freeze([
  'database-ledger-not-installed',
  'database-ledger-install-authority-not-created',
  'database-ledger-not-verified',
  'database-ledger-install-controller-unavailable',
  'source-migration-ledger-not-bound',
  'capture-receipt-not-persisted',
  'bounded-runner-unavailable'
] as const)

export interface CreateSupabaseBackfillDatabaseCASLedgerReviewOptionsV1 {
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
}

export interface SupabaseBackfillDatabaseCASLedgerReviewV1 {
  readonly format: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly databaseLedgerBound: false
  readonly sourceLedgerBound: false
  readonly releaseReady: false
  readonly installAuthorityCreated: false
  readonly installedVerificationCreated: false
  readonly installControllerAvailable: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly bindings: Readonly<{
    receiptReviewDigest: string
    scopeDraftDigest: string
    captureDigest: string
    providerAuthorityDigest: string
    applicationDigest: string
    migrationDigest: string
    ledgerShapeDigest: string
    sqlDigest: string
  }>
  readonly ledger: Readonly<{
    schemaName: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA
    tables: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES
    captureDigestUnique: true
    scopeDigestUnique: true
    receiptIdUniquePerExecution: true
    eventIdUniquePerExecution: true
    idempotencyKeyUniquePerExecution: true
    requestDigestUniquePerExecution: true
    receiptDigestUniquePerExecution: true
    maximumReceiptsPerExecution: 10_000
    maximumBatchReceiptsPerExecution: 9_999
    maximumCanonicalScopeBytes: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES
    maximumCanonicalReceiptBytes: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES
    scopeBytesStoredExactly: true
    receiptBytesStoredExactly: true
    databaseCanonicalDigestRequired: true
    receiptDigestInputRequired: true
    receiptPreviousHeadForeignKey: true
    previousHeadRevisionIsImmediatelyPrior: true
    captureCheckpointAtInitialRevisionOnly: true
    currentHeadReceiptForeignKey: true
    currentHeadTupleColumns: readonly ['revision', 'eventId', 'receiptDigest']
    databaseCompareAndSwapRequiredByReceiptPolicy: true
    databaseCompareAndSwapEnforced: false
    initialRevision: 1
    maximumRevision: 10_000
    safeIntegerHighWaterBound: true
    captureCountsAndBatchCapacityConstrained: true
  }>
  readonly security: Readonly<{
    privateSchema: true
    rowLevelSecurityEnabled: true
    rowLevelSecurityForced: false
    policyCount: 0
    deniedRoles: typeof DENIED_ROLES
    securityDefinerUsed: false
    extensionRequired: false
    identityOrSequenceUsed: false
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH
    kind: 'database-cas-ledger-schema-review'
    mediaType: 'application/sql; charset=utf-8'
    byteLength: number
    digest: string
    statementCount: 19
    schemaMutationStatementCount: 13
    containsManagedDataRead: false
    containsDml: false
    performsSchemaChange: true
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly blockers: readonly string[]
}

export interface SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1 {
  readonly review: SupabaseBackfillDatabaseCASLedgerReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

/** Process-local provenance only; it is not database, install, execution, or Receipt authority. */
export interface TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1 {
  readonly envelope: SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1
  readonly receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1
}

export type SupabaseBackfillDatabaseCASLedgerReviewErrorCode =
  | 'supabase-backfill-database-cas-ledger-input-invalid'
  | 'supabase-backfill-database-cas-ledger-receipt-review-proof-invalid'
  | 'supabase-backfill-database-cas-ledger-input-changed'
  | 'supabase-backfill-database-cas-ledger-digest-failed'

export class SupabaseBackfillDatabaseCASLedgerReviewError extends Error {
  constructor(readonly code: SupabaseBackfillDatabaseCASLedgerReviewErrorCode) {
    super(`Supabase backfill database CAS ledger review failed: ${code}.`)
    this.name = 'SupabaseBackfillDatabaseCASLedgerReviewError'
  }
}

type UnknownRecord = Record<PropertyKey, unknown>

const trustedLedgerReviews = new WeakMap<
  object,
  TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1
>()

interface ReceiptReviewRuntimeView {
  readonly format: unknown
  readonly version: unknown
  readonly receiptVersion: unknown
  readonly providerId: unknown
  readonly environmentIntent: unknown
  readonly reviewOnly: unknown
  readonly releaseReady: unknown
  readonly executionAuthorityCreated: unknown
  readonly receiptAuthorityCreated: unknown
  readonly databaseLedgerBound: unknown
  readonly sourceLedgerBound: unknown
  readonly bindings: Readonly<{
    scopeDraftDigest: unknown
    captureDigest: unknown
    providerAuthorityDigest: unknown
    applicationDigest: unknown
    migrationDigest: unknown
  }>
  readonly scopeDraft: Readonly<{
    providerId: unknown
    environment: unknown
    receiptVersion: unknown
    maximumReceiptCount: unknown
    maximumBatchCount: unknown
    batchSize: unknown
    sourceLedgerDigest: unknown
    cursorFieldType: unknown
    initialRemainingEligibleRowCount: unknown
    initialRemainingTargetRowCount: unknown
    requiredBatchCount: unknown
    completionRule: unknown
    captureDigest: unknown
  }>
  readonly receiptPolicy: Readonly<{
    databaseCASRequired: unknown
    databaseHead: unknown
    scanEveryCursorRow: unknown
    updateOnlyMatchingRows: unknown
  }>
}

function fail(code: SupabaseBackfillDatabaseCASLedgerReviewErrorCode): never {
  throw new SupabaseBackfillDatabaseCASLedgerReviewError(code)
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  return value as UnknownRecord
}

function ownData(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  return descriptor.value
}

function inputSnapshot(value: unknown): CreateSupabaseBackfillDatabaseCASLedgerReviewOptionsV1 {
  const source = exactRecord(value, INPUT_KEYS)
  const receiptReview = ownData(source, 'receiptReview')
  if (receiptReview === null || typeof receiptReview !== 'object') {
    return fail('supabase-backfill-database-cas-ledger-input-invalid')
  }
  return Object.freeze({
    receiptReview: receiptReview as SupabaseBackfillReceiptV2ReviewEnvelopeV1
  })
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-backfill-database-cas-ledger-digest-failed')
  }
}

function encodeBase64URL(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-backfill-database-cas-ledger-digest-failed')
  }
}

function databaseCASLedgerSql(): string {
  const generated = [
    '-- OpenPencil Supabase backfill database CAS ledger review v1.',
    '-- Review only. This artifact creates no Apply, execution, Receipt, or release authority.',
    '-- DO NOT APPLY: install authority, source migration ledger, and installed verification are absent.',
    'BEGIN;',
    'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;',
    'SET LOCAL search_path = pg_catalog;',
    "SET LOCAL lock_timeout = '5s';",
    "SET LOCAL statement_timeout = '15s';",
    '',
    'CREATE SCHEMA "openpencil_release";',
    'COMMENT ON SCHEMA "openpencil_release"',
    "  IS 'openpencil:release-ledger:v1';",
    'REVOKE ALL PRIVILEGES ON SCHEMA "openpencil_release"',
    '  FROM PUBLIC, "anon", "authenticated", "service_role";',
    '',
    'CREATE TABLE "openpencil_release"."backfill_executions_v1" (',
    '  "execution_id" text NOT NULL,',
    '  "provider_id" text NOT NULL,',
    '  "environment" text NOT NULL,',
    '  "application_id" text NOT NULL,',
    '  "application_digest" text NOT NULL,',
    '  "migration_id" text NOT NULL,',
    '  "migration_digest" text NOT NULL,',
    '  "migration_plan_digest" text NOT NULL,',
    '  "provider_authority_digest" text NOT NULL,',
    '  "source_ledger_digest" text NOT NULL,',
    '  "scope_digest" text NOT NULL,',
    '  "resource_identity_digest" text NOT NULL,',
    '  "catalog_precondition_digest" text NOT NULL,',
    '  "canonical_scope" bytea NOT NULL,',
    '  "canonical_scope_byte_length" integer NOT NULL,',
    '  "capture_digest" text NOT NULL,',
    '  "captured_high_water" bigint,',
    '  "initial_remaining_eligible_row_count" bigint NOT NULL,',
    '  "initial_remaining_target_row_count" bigint NOT NULL,',
    '  "required_matched_row_count" bigint,',
    '  "required_batch_count" integer NOT NULL,',
    '  "batch_size" integer NOT NULL,',
    '  "maximum_receipt_count" integer NOT NULL,',
    '  "maximum_batch_count" integer NOT NULL,',
    '  "status" text NOT NULL,',
    '  "created_at" timestamp with time zone NOT NULL,',
    '  "updated_at" timestamp with time zone NOT NULL,',
    '  CONSTRAINT "backfill_executions_v1_pkey" PRIMARY KEY ("execution_id"),',
    '  CONSTRAINT "backfill_executions_v1_capture_key" UNIQUE ("capture_digest"),',
    '  CONSTRAINT "backfill_executions_v1_scope_key" UNIQUE ("scope_digest"),',
    '  CONSTRAINT "backfill_executions_v1_execution_id_check" CHECK ("execution_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'),',
    '  CONSTRAINT "backfill_executions_v1_provider_check" CHECK ("provider_id" = \'supabase\' AND "environment" = \'staging\'),',
    '  CONSTRAINT "backfill_executions_v1_application_id_check" CHECK ("application_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'),',
    '  CONSTRAINT "backfill_executions_v1_migration_id_check" CHECK ("migration_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'),',
    '  CONSTRAINT "backfill_executions_v1_digest_check" CHECK (',
    '    "application_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "migration_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "migration_plan_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "provider_authority_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "source_ledger_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "scope_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "resource_identity_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "catalog_precondition_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "capture_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '  ),',
    '  CONSTRAINT "backfill_executions_v1_scope_bytes_check" CHECK (',
    '    "canonical_scope_byte_length" = pg_catalog.octet_length("canonical_scope")',
    '    AND "canonical_scope_byte_length" BETWEEN 2 AND 65536',
    '    AND "scope_digest" = pg_catalog.translate(',
    '      pg_catalog.rtrim(',
    '        pg_catalog.encode(pg_catalog.sha256("canonical_scope"), \'base64\'),',
    "        '='",
    '      ),',
    "      '+/',",
    "      '-_'",
    '    )',
    '  ),',
    '  CONSTRAINT "backfill_executions_v1_high_water_check" CHECK (',
    '    ("captured_high_water" IS NULL) = ("initial_remaining_eligible_row_count" = 0)',
    '    AND ("captured_high_water" IS NULL OR "captured_high_water" BETWEEN 0 AND 9007199254740991)',
    '  ),',
    '  CONSTRAINT "backfill_executions_v1_capacity_check" CHECK (',
    '    "batch_size" BETWEEN 1 AND 1000',
    '    AND "maximum_receipt_count" = 10000',
    '    AND "maximum_batch_count" = 9999',
    '    AND "initial_remaining_eligible_row_count" BETWEEN 0 AND ("batch_size"::bigint * "maximum_batch_count"::bigint)',
    '    AND "initial_remaining_target_row_count" BETWEEN 0 AND "initial_remaining_eligible_row_count"',
    '    AND ("required_matched_row_count" IS NULL OR "required_matched_row_count" BETWEEN 0 AND "initial_remaining_target_row_count")',
    '    AND "required_batch_count" = CASE',
    '      WHEN "initial_remaining_eligible_row_count" = 0 THEN 0',
    '      ELSE (("initial_remaining_eligible_row_count" - 1) / "batch_size") + 1',
    '    END',
    '    AND "required_batch_count" BETWEEN 0 AND "maximum_batch_count"',
    '  ),',
    "  CONSTRAINT \"backfill_executions_v1_status_check\" CHECK (\"status\" IN ('running', 'completed', 'failed')),",
    '  CONSTRAINT "backfill_executions_v1_time_check" CHECK ("updated_at" >= "created_at")',
    ');',
    'COMMENT ON TABLE "openpencil_release"."backfill_executions_v1"',
    "  IS 'openpencil:release-ledger:backfill-executions:v1';",
    '',
    'CREATE TABLE "openpencil_release"."backfill_receipts_v2" (',
    '  "execution_id" text NOT NULL,',
    '  "revision" bigint NOT NULL,',
    '  "event_id" text NOT NULL,',
    '  "receipt_id" text NOT NULL,',
    '  "idempotency_key" text NOT NULL,',
    '  "request_digest" text NOT NULL,',
    '  "receipt_digest" text NOT NULL,',
    '  "previous_revision" bigint,',
    '  "previous_event_id" text,',
    '  "previous_receipt_digest" text,',
    '  "checkpoint_kind" text NOT NULL,',
    '  "canonical_receipt" bytea NOT NULL,',
    '  "canonical_receipt_byte_length" integer NOT NULL,',
    '  "committed_at" timestamp with time zone NOT NULL,',
    '  CONSTRAINT "backfill_receipts_v2_pkey" PRIMARY KEY ("execution_id", "revision"),',
    '  CONSTRAINT "backfill_receipts_v2_event_key" UNIQUE ("execution_id", "event_id"),',
    '  CONSTRAINT "backfill_receipts_v2_receipt_id_key" UNIQUE ("execution_id", "receipt_id"),',
    '  CONSTRAINT "backfill_receipts_v2_idempotency_key" UNIQUE ("execution_id", "idempotency_key"),',
    '  CONSTRAINT "backfill_receipts_v2_request_digest_key" UNIQUE ("execution_id", "request_digest"),',
    '  CONSTRAINT "backfill_receipts_v2_digest_key" UNIQUE ("execution_id", "receipt_digest"),',
    '  CONSTRAINT "backfill_receipts_v2_head_key" UNIQUE ("execution_id", "revision", "event_id", "receipt_digest"),',
    '  CONSTRAINT "backfill_receipts_v2_execution_fkey" FOREIGN KEY ("execution_id")',
    '    REFERENCES "openpencil_release"."backfill_executions_v1" ("execution_id") ON UPDATE RESTRICT ON DELETE RESTRICT,',
    '  CONSTRAINT "backfill_receipts_v2_previous_head_fkey" FOREIGN KEY ("execution_id", "previous_revision", "previous_event_id", "previous_receipt_digest")',
    '    REFERENCES "openpencil_release"."backfill_receipts_v2" ("execution_id", "revision", "event_id", "receipt_digest") ON UPDATE RESTRICT ON DELETE RESTRICT,',
    '  CONSTRAINT "backfill_receipts_v2_revision_check" CHECK ("revision" BETWEEN 1 AND 10000),',
    '  CONSTRAINT "backfill_receipts_v2_identifier_check" CHECK (',
    '    "event_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'',
    '    AND "receipt_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'',
    '    AND "idempotency_key" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'',
    '  ),',
    '  CONSTRAINT "backfill_receipts_v2_digest_check" CHECK (',
    '    "receipt_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND "request_digest" ~ \'^[A-Za-z0-9_-]{43}$\'',
    '    AND ("previous_receipt_digest" IS NULL OR "previous_receipt_digest" ~ \'^[A-Za-z0-9_-]{43}$\')',
    '  ),',
    '  CONSTRAINT "backfill_receipts_v2_previous_head_check" CHECK (',
    '    ("revision" = 1 AND "previous_revision" IS NULL AND "previous_event_id" IS NULL AND "previous_receipt_digest" IS NULL)',
    '    OR ("revision" > 1 AND "previous_revision" IS NOT NULL AND "previous_revision" = "revision" - 1 AND "previous_event_id" IS NOT NULL AND "previous_receipt_digest" IS NOT NULL)',
    '  ),',
    '  CONSTRAINT "backfill_receipts_v2_checkpoint_check" CHECK (',
    '    ("revision" = 1 AND "checkpoint_kind" = \'capture\')',
    '    OR ("revision" > 1 AND "checkpoint_kind" IN (\'batch\', \'failure\'))',
    '  ),',
    '  CONSTRAINT "backfill_receipts_v2_canonical_bytes_check" CHECK (',
    '    "canonical_receipt_byte_length" = pg_catalog.octet_length("canonical_receipt")',
    '    AND "canonical_receipt_byte_length" BETWEEN 2 AND 65536',
    '    AND "receipt_digest" = pg_catalog.translate(',
    '      pg_catalog.rtrim(',
    '        pg_catalog.encode(pg_catalog.sha256("canonical_receipt"), \'base64\'),',
    "        '='",
    '      ),',
    "      '+/',",
    "      '-_'",
    '    )',
    '  )',
    ');',
    'COMMENT ON TABLE "openpencil_release"."backfill_receipts_v2"',
    "  IS 'openpencil:release-ledger:backfill-receipts:v2';",
    '',
    'CREATE TABLE "openpencil_release"."backfill_heads_v1" (',
    '  "execution_id" text NOT NULL,',
    '  "revision" bigint NOT NULL,',
    '  "event_id" text NOT NULL,',
    '  "receipt_digest" text NOT NULL,',
    '  "updated_at" timestamp with time zone NOT NULL,',
    '  CONSTRAINT "backfill_heads_v1_pkey" PRIMARY KEY ("execution_id"),',
    '  CONSTRAINT "backfill_heads_v1_receipt_fkey" FOREIGN KEY ("execution_id", "revision", "event_id", "receipt_digest")',
    '    REFERENCES "openpencil_release"."backfill_receipts_v2" ("execution_id", "revision", "event_id", "receipt_digest") ON UPDATE RESTRICT ON DELETE RESTRICT,',
    '  CONSTRAINT "backfill_heads_v1_revision_check" CHECK ("revision" BETWEEN 1 AND 10000),',
    '  CONSTRAINT "backfill_heads_v1_event_id_check" CHECK ("event_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$\'),',
    '  CONSTRAINT "backfill_heads_v1_digest_check" CHECK ("receipt_digest" ~ \'^[A-Za-z0-9_-]{43}$\')',
    ');',
    'COMMENT ON TABLE "openpencil_release"."backfill_heads_v1"',
    "  IS 'openpencil:release-ledger:backfill-heads:v1';",
    '',
    'ALTER TABLE "openpencil_release"."backfill_executions_v1" ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE "openpencil_release"."backfill_receipts_v2" ENABLE ROW LEVEL SECURITY;',
    'ALTER TABLE "openpencil_release"."backfill_heads_v1" ENABLE ROW LEVEL SECURITY;',
    'REVOKE ALL PRIVILEGES ON TABLE',
    '  "openpencil_release"."backfill_executions_v1",',
    '  "openpencil_release"."backfill_receipts_v2",',
    '  "openpencil_release"."backfill_heads_v1"',
    '  FROM PUBLIC, "anon", "authenticated", "service_role";',
    'COMMIT;',
    ''
  ].join('\n')
  if (generated !== SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA_SQL_SOURCE) {
    return fail('supabase-backfill-database-cas-ledger-input-changed')
  }
  return SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA_SQL_SOURCE
}

function ledgerShape() {
  return Object.freeze({
    format: 'openpencil.supabase-backfill-database-cas-ledger-shape.v1' as const,
    schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
    tables: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
    captureDigestUnique: true as const,
    scopeDigestUnique: true as const,
    receiptIdUniquePerExecution: true as const,
    eventIdUniquePerExecution: true as const,
    idempotencyKeyUniquePerExecution: true as const,
    requestDigestUniquePerExecution: true as const,
    receiptDigestUniquePerExecution: true as const,
    captureCheckpointAtInitialRevisionOnly: true as const,
    currentHeadTupleColumns: Object.freeze(['revision', 'eventId', 'receiptDigest'] as const),
    databaseCompareAndSwapRequiredByReceiptPolicy: true as const,
    databaseCompareAndSwapEnforced: false as const,
    maximumReceiptsPerExecution: EXPECTED_MAXIMUM_RECEIPT_COUNT,
    maximumBatchReceiptsPerExecution: EXPECTED_MAXIMUM_BATCH_COUNT,
    maximumCanonicalScopeBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES,
    maximumCanonicalReceiptBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES,
    scopeBytesStoredExactly: true as const,
    receiptBytesStoredExactly: true as const,
    receiptDigestInputRequired: true as const,
    databaseCanonicalDigestRequired: true as const,
    receiptPreviousHeadForeignKey: true as const,
    previousHeadRevisionIsImmediatelyPrior: true as const,
    currentHeadReceiptForeignKey: true as const,
    initialRevision: 1 as const,
    maximumRevision: 10_000 as const,
    safeIntegerHighWaterBound: true as const,
    captureCountsAndBatchCapacityConstrained: true as const,
    rowLevelSecurity: 'enabled-zero-policy' as const,
    deniedRoles: DENIED_ROLES
  })
}

function reviewRuntimeReady(review: ReceiptReviewRuntimeView): boolean {
  return (
    review.format === 'openpencil.supabase-backfill-receipt-v2-review.v1' &&
    review.version === 1 &&
    review.receiptVersion === 2 &&
    review.providerId === 'supabase' &&
    review.environmentIntent === 'staging' &&
    review.reviewOnly === true &&
    review.releaseReady === false &&
    review.executionAuthorityCreated === false &&
    review.receiptAuthorityCreated === false &&
    review.databaseLedgerBound === false &&
    review.sourceLedgerBound === false
  )
}

function scopeIdentityRuntimeReady(scope: ReceiptReviewRuntimeView['scopeDraft']): boolean {
  return (
    scope.providerId === 'supabase' &&
    scope.environment === 'staging' &&
    scope.receiptVersion === 2 &&
    scope.maximumReceiptCount === EXPECTED_MAXIMUM_RECEIPT_COUNT &&
    scope.maximumBatchCount === EXPECTED_MAXIMUM_BATCH_COUNT &&
    scope.sourceLedgerDigest === null &&
    scope.cursorFieldType === 'integer' &&
    scope.completionRule === 'database-terminal-exhaustion-and-postconditions'
  )
}

function scopeCapacityRuntimeReady(scope: ReceiptReviewRuntimeView['scopeDraft']): boolean {
  return (
    typeof scope.batchSize === 'number' &&
    Number.isSafeInteger(scope.batchSize) &&
    scope.batchSize >= 1 &&
    scope.batchSize <= 1_000 &&
    typeof scope.initialRemainingEligibleRowCount === 'number' &&
    Number.isSafeInteger(scope.initialRemainingEligibleRowCount) &&
    scope.initialRemainingEligibleRowCount >= 0 &&
    typeof scope.initialRemainingTargetRowCount === 'number' &&
    Number.isSafeInteger(scope.initialRemainingTargetRowCount) &&
    scope.initialRemainingTargetRowCount >= 0 &&
    scope.initialRemainingTargetRowCount <= scope.initialRemainingEligibleRowCount &&
    typeof scope.requiredBatchCount === 'number' &&
    Number.isSafeInteger(scope.requiredBatchCount) &&
    scope.requiredBatchCount >= 0 &&
    scope.requiredBatchCount <= EXPECTED_MAXIMUM_BATCH_COUNT &&
    scope.requiredBatchCount === Math.ceil(scope.initialRemainingEligibleRowCount / scope.batchSize)
  )
}

function scopeRuntimeReady(scope: ReceiptReviewRuntimeView['scopeDraft']): boolean {
  return scopeIdentityRuntimeReady(scope) && scopeCapacityRuntimeReady(scope)
}

function policyRuntimeReady(policy: ReceiptReviewRuntimeView['receiptPolicy']): boolean {
  return (
    policy.databaseCASRequired === true &&
    policy.databaseHead === 'monotonic-revision-and-immutable-event-id' &&
    policy.scanEveryCursorRow === true &&
    policy.updateOnlyMatchingRows === true
  )
}

function digestBindingsReady(
  reviewDigest: string,
  bindings: ReceiptReviewRuntimeView['bindings']
): boolean {
  return (
    DIGEST.test(reviewDigest) &&
    typeof bindings.scopeDraftDigest === 'string' &&
    DIGEST.test(bindings.scopeDraftDigest) &&
    typeof bindings.captureDigest === 'string' &&
    DIGEST.test(bindings.captureDigest) &&
    typeof bindings.providerAuthorityDigest === 'string' &&
    DIGEST.test(bindings.providerAuthorityDigest) &&
    typeof bindings.applicationDigest === 'string' &&
    DIGEST.test(bindings.applicationDigest) &&
    typeof bindings.migrationDigest === 'string' &&
    DIGEST.test(bindings.migrationDigest)
  )
}

async function requireReceiptReview(
  envelope: SupabaseBackfillReceiptV2ReviewEnvelopeV1
): Promise<SupabaseBackfillReceiptV2ReviewEnvelopeV1> {
  const context = trustedSupabaseBackfillReceiptV2ReviewContextV1(envelope)
  if (!context) {
    return fail('supabase-backfill-database-cas-ledger-receipt-review-proof-invalid')
  }
  const review = envelope.review
  const scope = review.scopeDraft
  const runtime: ReceiptReviewRuntimeView = review
  if (
    !reviewRuntimeReady(runtime) ||
    !scopeRuntimeReady(runtime.scopeDraft) ||
    !policyRuntimeReady(runtime.receiptPolicy) ||
    !digestBindingsReady(envelope.reviewDigest, runtime.bindings)
  ) {
    return fail('supabase-backfill-database-cas-ledger-input-changed')
  }
  const [computedReviewDigest, computedScopeDraftDigest] = await Promise.all([
    digest(review),
    digest(scope)
  ])
  if (
    computedReviewDigest !== envelope.reviewDigest ||
    computedScopeDraftDigest !== review.bindings.scopeDraftDigest ||
    scope.captureDigest !== review.bindings.captureDigest
  ) {
    return fail('supabase-backfill-database-cas-ledger-input-changed')
  }
  return envelope
}

function blockers(receiptReview: SupabaseBackfillReceiptV2ReviewEnvelopeV1): readonly string[] {
  return Object.freeze([...new Set([...receiptReview.review.blockers, ...LEDGER_BLOCKERS])])
}

/**
 * Produce a deterministic, secret-free DDL review for the private Receipt V2 CAS ledger.
 * This function consumes no capture or receipt proof and creates no install, database, or runner
 * authority. A separate installer, verifier, and controller must bind the artifact before use.
 */
export async function createSupabaseBackfillDatabaseCASLedgerReviewV1(
  input: CreateSupabaseBackfillDatabaseCASLedgerReviewOptionsV1
): Promise<SupabaseBackfillDatabaseCASLedgerReviewEnvelopeV1> {
  const options = inputSnapshot(input)
  const receiptReview = await requireReceiptReview(options.receiptReview)
  const sql = databaseCASLedgerSql()
  const shape = ledgerShape()
  const [ledgerShapeDigest, sqlDigest] = await Promise.all([digest(shape), digestSql(sql)])
  const review = Object.freeze({
    format: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    databaseLedgerBound: false as const,
    sourceLedgerBound: false as const,
    releaseReady: false as const,
    installAuthorityCreated: false as const,
    installedVerificationCreated: false as const,
    installControllerAvailable: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    bindings: Object.freeze({
      receiptReviewDigest: receiptReview.reviewDigest,
      scopeDraftDigest: receiptReview.review.bindings.scopeDraftDigest,
      captureDigest: receiptReview.review.bindings.captureDigest,
      providerAuthorityDigest: receiptReview.review.bindings.providerAuthorityDigest,
      applicationDigest: receiptReview.review.bindings.applicationDigest,
      migrationDigest: receiptReview.review.bindings.migrationDigest,
      ledgerShapeDigest,
      sqlDigest
    }),
    ledger: Object.freeze({
      schemaName: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_SCHEMA,
      tables: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_TABLES,
      captureDigestUnique: true as const,
      scopeDigestUnique: true as const,
      receiptIdUniquePerExecution: true as const,
      eventIdUniquePerExecution: true as const,
      idempotencyKeyUniquePerExecution: true as const,
      requestDigestUniquePerExecution: true as const,
      receiptDigestUniquePerExecution: true as const,
      maximumReceiptsPerExecution: 10_000 as const,
      maximumBatchReceiptsPerExecution: 9_999 as const,
      maximumCanonicalScopeBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_SCOPE_BYTES,
      maximumCanonicalReceiptBytes: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_MAX_RECEIPT_BYTES,
      scopeBytesStoredExactly: true as const,
      receiptBytesStoredExactly: true as const,
      databaseCanonicalDigestRequired: true as const,
      receiptDigestInputRequired: true as const,
      receiptPreviousHeadForeignKey: true as const,
      previousHeadRevisionIsImmediatelyPrior: true as const,
      captureCheckpointAtInitialRevisionOnly: true as const,
      currentHeadReceiptForeignKey: true as const,
      currentHeadTupleColumns: Object.freeze(['revision', 'eventId', 'receiptDigest'] as const),
      databaseCompareAndSwapRequiredByReceiptPolicy: true as const,
      databaseCompareAndSwapEnforced: false as const,
      initialRevision: 1 as const,
      maximumRevision: 10_000 as const,
      safeIntegerHighWaterBound: true as const,
      captureCountsAndBatchCapacityConstrained: true as const
    }),
    security: Object.freeze({
      privateSchema: true as const,
      rowLevelSecurityEnabled: true as const,
      rowLevelSecurityForced: false as const,
      policyCount: 0 as const,
      deniedRoles: DENIED_ROLES,
      securityDefinerUsed: false as const,
      extensionRequired: false as const,
      identityOrSequenceUsed: false as const
    }),
    artifact: Object.freeze({
      path: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_ARTIFACT_PATH,
      kind: 'database-cas-ledger-schema-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      byteLength: new TextEncoder().encode(sql).byteLength,
      digest: sqlDigest,
      statementCount: STATEMENT_COUNT as 19,
      schemaMutationStatementCount: SCHEMA_MUTATION_STATEMENT_COUNT as 13,
      containsManagedDataRead: false as const,
      containsDml: false as const,
      performsSchemaChange: true as const,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    blockers: blockers(receiptReview)
  }) satisfies SupabaseBackfillDatabaseCASLedgerReviewV1
  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: sql
  })
  trustedLedgerReviews.set(envelope, Object.freeze({ envelope, receiptReview }))
  return envelope
}

/** Return genuine same-process review provenance without upgrading the review to authority. */
export function trustedSupabaseBackfillDatabaseCASLedgerReviewContextV1(
  value: unknown
): TrustedSupabaseBackfillDatabaseCASLedgerReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  const context = trustedLedgerReviews.get(value)
  if (!context || !trustedSupabaseBackfillReceiptV2ReviewContextV1(context.receiptReview)) {
    return null
  }
  return context
}
