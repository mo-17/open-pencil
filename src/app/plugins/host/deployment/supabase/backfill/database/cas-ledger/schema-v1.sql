-- OpenPencil Supabase backfill database CAS ledger review v1.
-- Review only. This artifact creates no Apply, execution, Receipt, or release authority.
-- DO NOT APPLY: install authority, source migration ledger, and installed verification are absent.
BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SET LOCAL search_path = pg_catalog;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

CREATE SCHEMA "openpencil_release";
COMMENT ON SCHEMA "openpencil_release"
  IS 'openpencil:release-ledger:v1';
REVOKE ALL PRIVILEGES ON SCHEMA "openpencil_release"
  FROM PUBLIC, "anon", "authenticated", "service_role";

CREATE TABLE "openpencil_release"."backfill_executions_v1" (
  "execution_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "environment" text NOT NULL,
  "application_id" text NOT NULL,
  "application_digest" text NOT NULL,
  "migration_id" text NOT NULL,
  "migration_digest" text NOT NULL,
  "migration_plan_digest" text NOT NULL,
  "provider_authority_digest" text NOT NULL,
  "source_ledger_digest" text NOT NULL,
  "scope_digest" text NOT NULL,
  "resource_identity_digest" text NOT NULL,
  "catalog_precondition_digest" text NOT NULL,
  "canonical_scope" bytea NOT NULL,
  "canonical_scope_byte_length" integer NOT NULL,
  "capture_digest" text NOT NULL,
  "captured_high_water" bigint,
  "initial_remaining_eligible_row_count" bigint NOT NULL,
  "initial_remaining_target_row_count" bigint NOT NULL,
  "required_matched_row_count" bigint,
  "required_batch_count" integer NOT NULL,
  "batch_size" integer NOT NULL,
  "maximum_receipt_count" integer NOT NULL,
  "maximum_batch_count" integer NOT NULL,
  "status" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "backfill_executions_v1_pkey" PRIMARY KEY ("execution_id"),
  CONSTRAINT "backfill_executions_v1_capture_key" UNIQUE ("capture_digest"),
  CONSTRAINT "backfill_executions_v1_scope_key" UNIQUE ("scope_digest"),
  CONSTRAINT "backfill_executions_v1_execution_id_check" CHECK ("execution_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "backfill_executions_v1_provider_check" CHECK ("provider_id" = 'supabase' AND "environment" = 'staging'),
  CONSTRAINT "backfill_executions_v1_application_id_check" CHECK ("application_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "backfill_executions_v1_migration_id_check" CHECK ("migration_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "backfill_executions_v1_digest_check" CHECK (
    "application_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "migration_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "migration_plan_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "provider_authority_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "source_ledger_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "scope_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "resource_identity_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "catalog_precondition_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "capture_digest" ~ '^[A-Za-z0-9_-]{43}$'
  ),
  CONSTRAINT "backfill_executions_v1_scope_bytes_check" CHECK (
    "canonical_scope_byte_length" = pg_catalog.octet_length("canonical_scope")
    AND "canonical_scope_byte_length" BETWEEN 2 AND 65536
    AND "scope_digest" = pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(pg_catalog.sha256("canonical_scope"), 'base64'),
        '='
      ),
      '+/',
      '-_'
    )
  ),
  CONSTRAINT "backfill_executions_v1_high_water_check" CHECK (
    ("captured_high_water" IS NULL) = ("initial_remaining_eligible_row_count" = 0)
    AND ("captured_high_water" IS NULL OR "captured_high_water" BETWEEN 0 AND 9007199254740991)
  ),
  CONSTRAINT "backfill_executions_v1_capacity_check" CHECK (
    "batch_size" BETWEEN 1 AND 1000
    AND "maximum_receipt_count" = 10000
    AND "maximum_batch_count" = 9999
    AND "initial_remaining_eligible_row_count" BETWEEN 0 AND ("batch_size"::bigint * "maximum_batch_count"::bigint)
    AND "initial_remaining_target_row_count" BETWEEN 0 AND "initial_remaining_eligible_row_count"
    AND ("required_matched_row_count" IS NULL OR "required_matched_row_count" BETWEEN 0 AND "initial_remaining_target_row_count")
    AND "required_batch_count" = CASE
      WHEN "initial_remaining_eligible_row_count" = 0 THEN 0
      ELSE (("initial_remaining_eligible_row_count" - 1) / "batch_size") + 1
    END
    AND "required_batch_count" BETWEEN 0 AND "maximum_batch_count"
  ),
  CONSTRAINT "backfill_executions_v1_status_check" CHECK ("status" IN ('running', 'completed', 'failed')),
  CONSTRAINT "backfill_executions_v1_time_check" CHECK ("updated_at" >= "created_at")
);
COMMENT ON TABLE "openpencil_release"."backfill_executions_v1"
  IS 'openpencil:release-ledger:backfill-executions:v1';

CREATE TABLE "openpencil_release"."backfill_receipts_v2" (
  "execution_id" text NOT NULL,
  "revision" bigint NOT NULL,
  "event_id" text NOT NULL,
  "receipt_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "receipt_digest" text NOT NULL,
  "previous_revision" bigint,
  "previous_event_id" text,
  "previous_receipt_digest" text,
  "checkpoint_kind" text NOT NULL,
  "canonical_receipt" bytea NOT NULL,
  "canonical_receipt_byte_length" integer NOT NULL,
  "committed_at" timestamp with time zone NOT NULL,
  CONSTRAINT "backfill_receipts_v2_pkey" PRIMARY KEY ("execution_id", "revision"),
  CONSTRAINT "backfill_receipts_v2_event_key" UNIQUE ("execution_id", "event_id"),
  CONSTRAINT "backfill_receipts_v2_receipt_id_key" UNIQUE ("execution_id", "receipt_id"),
  CONSTRAINT "backfill_receipts_v2_idempotency_key" UNIQUE ("execution_id", "idempotency_key"),
  CONSTRAINT "backfill_receipts_v2_request_digest_key" UNIQUE ("execution_id", "request_digest"),
  CONSTRAINT "backfill_receipts_v2_digest_key" UNIQUE ("execution_id", "receipt_digest"),
  CONSTRAINT "backfill_receipts_v2_head_key" UNIQUE ("execution_id", "revision", "event_id", "receipt_digest"),
  CONSTRAINT "backfill_receipts_v2_execution_fkey" FOREIGN KEY ("execution_id")
    REFERENCES "openpencil_release"."backfill_executions_v1" ("execution_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "backfill_receipts_v2_previous_head_fkey" FOREIGN KEY ("execution_id", "previous_revision", "previous_event_id", "previous_receipt_digest")
    REFERENCES "openpencil_release"."backfill_receipts_v2" ("execution_id", "revision", "event_id", "receipt_digest") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "backfill_receipts_v2_revision_check" CHECK ("revision" BETWEEN 1 AND 10000),
  CONSTRAINT "backfill_receipts_v2_identifier_check" CHECK (
    "event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "receipt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
  ),
  CONSTRAINT "backfill_receipts_v2_digest_check" CHECK (
    "receipt_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND "request_digest" ~ '^[A-Za-z0-9_-]{43}$'
    AND ("previous_receipt_digest" IS NULL OR "previous_receipt_digest" ~ '^[A-Za-z0-9_-]{43}$')
  ),
  CONSTRAINT "backfill_receipts_v2_previous_head_check" CHECK (
    ("revision" = 1 AND "previous_revision" IS NULL AND "previous_event_id" IS NULL AND "previous_receipt_digest" IS NULL)
    OR ("revision" > 1 AND "previous_revision" IS NOT NULL AND "previous_revision" = "revision" - 1 AND "previous_event_id" IS NOT NULL AND "previous_receipt_digest" IS NOT NULL)
  ),
  CONSTRAINT "backfill_receipts_v2_checkpoint_check" CHECK (
    ("revision" = 1 AND "checkpoint_kind" = 'capture')
    OR ("revision" > 1 AND "checkpoint_kind" IN ('batch', 'failure'))
  ),
  CONSTRAINT "backfill_receipts_v2_canonical_bytes_check" CHECK (
    "canonical_receipt_byte_length" = pg_catalog.octet_length("canonical_receipt")
    AND "canonical_receipt_byte_length" BETWEEN 2 AND 65536
    AND "receipt_digest" = pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(pg_catalog.sha256("canonical_receipt"), 'base64'),
        '='
      ),
      '+/',
      '-_'
    )
  )
);
COMMENT ON TABLE "openpencil_release"."backfill_receipts_v2"
  IS 'openpencil:release-ledger:backfill-receipts:v2';

CREATE TABLE "openpencil_release"."backfill_heads_v1" (
  "execution_id" text NOT NULL,
  "revision" bigint NOT NULL,
  "event_id" text NOT NULL,
  "receipt_digest" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "backfill_heads_v1_pkey" PRIMARY KEY ("execution_id"),
  CONSTRAINT "backfill_heads_v1_receipt_fkey" FOREIGN KEY ("execution_id", "revision", "event_id", "receipt_digest")
    REFERENCES "openpencil_release"."backfill_receipts_v2" ("execution_id", "revision", "event_id", "receipt_digest") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "backfill_heads_v1_revision_check" CHECK ("revision" BETWEEN 1 AND 10000),
  CONSTRAINT "backfill_heads_v1_event_id_check" CHECK ("event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  CONSTRAINT "backfill_heads_v1_digest_check" CHECK ("receipt_digest" ~ '^[A-Za-z0-9_-]{43}$')
);
COMMENT ON TABLE "openpencil_release"."backfill_heads_v1"
  IS 'openpencil:release-ledger:backfill-heads:v1';

ALTER TABLE "openpencil_release"."backfill_executions_v1" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "openpencil_release"."backfill_receipts_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "openpencil_release"."backfill_heads_v1" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE
  "openpencil_release"."backfill_executions_v1",
  "openpencil_release"."backfill_receipts_v2",
  "openpencil_release"."backfill_heads_v1"
  FROM PUBLIC, "anon", "authenticated", "service_role";
COMMIT;
