-- OpenPencil Supabase Receipt-zero CAS statement review v1.
-- REVIEW ONLY: requires an externally established SERIALIZABLE transaction and fresh ledger guard.
-- Parameters are positional; values must never be interpolated into this SQL.
WITH RECURSIVE
"input" AS MATERIALIZED (
  SELECT
    $1::"pg_catalog"."text" AS "execution_id",
    $2::"pg_catalog"."text" AS "application_id",
    $3::"pg_catalog"."text" AS "application_digest",
    $4::"pg_catalog"."text" AS "migration_id",
    $5::"pg_catalog"."text" AS "migration_digest",
    $6::"pg_catalog"."text" AS "migration_plan_digest",
    $7::"pg_catalog"."text" AS "provider_authority_digest",
    $8::"pg_catalog"."text" AS "source_ledger_digest",
    $9::"pg_catalog"."text" AS "scope_digest",
    $10::"pg_catalog"."text" AS "resource_identity_digest",
    $11::"pg_catalog"."text" AS "catalog_precondition_digest",
    "pg_catalog"."decode"($12::"pg_catalog"."text", 'base64') AS "canonical_scope",
    $13::"pg_catalog"."text" AS "capture_digest",
    $14::"pg_catalog"."int8" AS "captured_high_water",
    $15::"pg_catalog"."int8" AS "initial_remaining_eligible_row_count",
    $16::"pg_catalog"."int8" AS "initial_remaining_target_row_count",
    $17::"pg_catalog"."int8" AS "required_matched_row_count",
    $18::"pg_catalog"."int4" AS "required_batch_count",
    $19::"pg_catalog"."int4" AS "batch_size",
    $20::"pg_catalog"."text" AS "initial_execution_status",
    $21::"pg_catalog"."text"::"pg_catalog"."timestamptz" AS "candidate_committed_at",
    $21::"pg_catalog"."text" AS "candidate_committed_at_text",
    $22::"pg_catalog"."text" AS "event_id",
    $23::"pg_catalog"."text" AS "receipt_id",
    $24::"pg_catalog"."text" AS "idempotency_key",
    $25::"pg_catalog"."text" AS "request_digest",
    $26::"pg_catalog"."text" AS "receipt_digest",
    "pg_catalog"."decode"($27::"pg_catalog"."text", 'base64') AS "canonical_receipt",
    $28::"pg_catalog"."text" AS "unauthenticated_operation_evidence_digest"
),
"documents" AS MATERIALIZED (
  SELECT
    "input".*,
    "pg_catalog"."convert_from"("input"."canonical_scope", 'UTF8')::"pg_catalog"."jsonb" AS "scope_document",
    "pg_catalog"."convert_from"("input"."canonical_receipt", 'UTF8')::"pg_catalog"."jsonb" AS "receipt_document"
  FROM "input"
),
"input_validity" AS MATERIALIZED (
  SELECT
    "documents".*,
    (
      "execution_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "application_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "migration_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "receipt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND "application_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "migration_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "migration_plan_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "provider_authority_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "source_ledger_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "scope_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "resource_identity_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "catalog_precondition_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "capture_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "request_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "receipt_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "unauthenticated_operation_evidence_digest" ~ '^[A-Za-z0-9_-]{43}$'
      AND "pg_catalog"."octet_length"("canonical_scope") BETWEEN 2 AND 65536
      AND "pg_catalog"."octet_length"("canonical_receipt") BETWEEN 2 AND 65536
      AND "scope_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"("pg_catalog"."encode"("pg_catalog"."sha256"("canonical_scope"), 'base64'), '='),
        '+/', '-_'
      )
      AND "receipt_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"("pg_catalog"."encode"("pg_catalog"."sha256"("canonical_receipt"), 'base64'), '='),
        '+/', '-_'
      )
      AND ("captured_high_water" IS NULL) = ("initial_remaining_eligible_row_count" = 0)
      AND ("captured_high_water" IS NULL OR "captured_high_water" BETWEEN 0 AND 9007199254740991)
      AND "batch_size" BETWEEN 1 AND 1000
      AND "initial_remaining_eligible_row_count" BETWEEN 0 AND ("batch_size"::"pg_catalog"."int8" * 9999)
      AND "initial_remaining_target_row_count" BETWEEN 0 AND "initial_remaining_eligible_row_count"
      AND ("required_matched_row_count" IS NULL OR "required_matched_row_count" BETWEEN 0 AND "initial_remaining_target_row_count")
      AND "required_batch_count" = CASE
        WHEN "initial_remaining_eligible_row_count" = 0 THEN 0
        ELSE (("initial_remaining_eligible_row_count" - 1) / "batch_size") + 1
      END
      AND "initial_execution_status" IN ('running', 'completed')
      AND "scope_document" ->> 'format' = 'openpencil.backend-backfill-execution-scope'
      AND "scope_document" ->> 'version' = '2'
      AND "scope_document" ->> 'providerId' = 'supabase'
      AND "scope_document" ->> 'environment' = 'staging'
      AND "scope_document" ->> 'providerAuthorityDigest' = "provider_authority_digest"
      AND "scope_document" ->> 'applicationId' = "application_id"
      AND "scope_document" ->> 'applicationDigest' = "application_digest"
      AND "scope_document" ->> 'migrationId' = "migration_id"
      AND "scope_document" ->> 'migrationDigest' = "migration_digest"
      AND "scope_document" ->> 'migrationPlanDigest' = "migration_plan_digest"
      AND "scope_document" ->> 'sourceLedgerDigest' = "source_ledger_digest"
      AND "scope_document" ->> 'captureDigest' = "capture_digest"
      AND "scope_document" ->> 'resourceIdentityDigest' = "resource_identity_digest"
      AND "scope_document" ->> 'catalogPreconditionDigest' = "catalog_precondition_digest"
      AND "scope_document" -> 'initialRemainingEligibleRowCount' = "pg_catalog"."to_jsonb"("initial_remaining_eligible_row_count")
      AND "scope_document" -> 'initialRemainingTargetRowCount' = "pg_catalog"."to_jsonb"("initial_remaining_target_row_count")
      AND "scope_document" -> 'requiredBatchCount' = "pg_catalog"."to_jsonb"("required_batch_count")
      AND "scope_document" -> 'batchSize' = "pg_catalog"."to_jsonb"("batch_size")
      AND "scope_document" -> 'maximumReceiptCount' = '10000'::"pg_catalog"."jsonb"
      AND "scope_document" -> 'maximumBatchCount' = '9999'::"pg_catalog"."jsonb"
      AND CASE
        WHEN "captured_high_water" IS NULL THEN "scope_document" -> 'capturedHighWater' = 'null'::"pg_catalog"."jsonb"
        ELSE "scope_document" -> 'capturedHighWater' = "pg_catalog"."to_jsonb"("captured_high_water")
      END
      AND CASE
        WHEN "required_matched_row_count" IS NULL THEN "scope_document" -> 'requiredMatchedRowCount' = 'null'::"pg_catalog"."jsonb"
        ELSE "scope_document" -> 'requiredMatchedRowCount' = "pg_catalog"."to_jsonb"("required_matched_row_count")
      END
      AND "receipt_document" ->> 'format' = 'openpencil.backend-backfill-execution-receipt'
      AND "receipt_document" ->> 'version' = '2'
      AND "receipt_document" ->> 'executionId' = "execution_id"
      AND "receipt_document" ->> 'receiptId' = "receipt_id"
      AND "receipt_document" ->> 'idempotencyKey' = "idempotency_key"
      AND "receipt_document" ->> 'requestDigest' = "request_digest"
      AND "receipt_document" ->> 'scopeDigest' = "scope_digest"
      AND "receipt_document" -> 'scope' = "scope_document"
      AND "receipt_document" ->> 'checkpointKind' = 'capture'
      AND "receipt_document" ->> 'batchIndex' = '0'
      AND "receipt_document" ->> 'databaseEventId' = "event_id"
      AND "receipt_document" ->> 'databaseHeadVersion' = '1'
      AND "receipt_document" ->> 'committedAt' = "candidate_committed_at_text"
      AND "receipt_document" ->> 'operationAuthorityDigest' = "unauthenticated_operation_evidence_digest"
      AND (
        ("initial_execution_status" = 'completed' AND "receipt_document" ->> 'outcome' = 'completed')
        OR ("initial_execution_status" = 'running' AND "receipt_document" ->> 'outcome' = 'in-progress')
      )
    ) AS "valid"
  FROM "documents"
),
"runtime_guard" AS MATERIALIZED (
  SELECT (
    "pg_catalog"."current_setting"('transaction_isolation') = 'serializable'
    AND "pg_catalog"."current_setting"('transaction_read_only') = 'off'
    AND "pg_catalog"."current_setting"('row_security') = 'off'
    AND "pg_catalog"."current_setting"('synchronous_commit') = 'on'
    AND "pg_catalog"."current_setting"('search_path') = 'pg_catalog'
    AND CURRENT_USER = SESSION_USER
    AND NOT "pg_catalog"."pg_is_in_recovery"()
  ) AS "ready"
),
"locked_executions" AS MATERIALIZED (
  SELECT "execution".*
  FROM "openpencil_release"."backfill_executions_v1" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "runtime"."ready"
    AND (
      "execution"."execution_id" = "input"."execution_id"
      OR "execution"."capture_digest" = "input"."capture_digest"
      OR "execution"."scope_digest" = "input"."scope_digest"
    )
  ORDER BY "execution"."execution_id"
  FOR UPDATE OF "execution" NOWAIT
),
"execution_lock_barrier" AS MATERIALIZED (
  SELECT COUNT(*) AS "locked_count" FROM "locked_executions"
),
"locked_head" AS MATERIALIZED (
  SELECT "head".*
  FROM "openpencil_release"."backfill_heads_v1" AS "head"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "execution_lock_barrier" AS "barrier"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "head"."execution_id" = "input"."execution_id"
    AND "barrier"."locked_count" >= 0
    AND "runtime"."ready"
  FOR UPDATE OF "head" NOWAIT
),
"head_lock_barrier" AS MATERIALIZED (
  SELECT COUNT(*) AS "locked_count" FROM "locked_head"
),
"locked_receipts" AS MATERIALIZED (
  SELECT "receipt".*
  FROM "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "head_lock_barrier" AS "barrier"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "receipt"."execution_id" = "input"."execution_id"
    AND "barrier"."locked_count" >= 0
    AND "runtime"."ready"
  ORDER BY "receipt"."revision"
  FOR UPDATE OF "receipt" NOWAIT
),
"exact_initial_execution" AS MATERIALIZED (
  SELECT "execution"."execution_id"
  FROM "locked_executions" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  WHERE "execution"."execution_id" = "input"."execution_id"
    AND "execution"."provider_id" = 'supabase'
    AND "execution"."environment" = 'staging'
    AND "execution"."application_id" = "input"."application_id"
    AND "execution"."application_digest" = "input"."application_digest"
    AND "execution"."migration_id" = "input"."migration_id"
    AND "execution"."migration_digest" = "input"."migration_digest"
    AND "execution"."migration_plan_digest" = "input"."migration_plan_digest"
    AND "execution"."provider_authority_digest" = "input"."provider_authority_digest"
    AND "execution"."source_ledger_digest" = "input"."source_ledger_digest"
    AND "execution"."scope_digest" = "input"."scope_digest"
    AND "execution"."resource_identity_digest" = "input"."resource_identity_digest"
    AND "execution"."catalog_precondition_digest" = "input"."catalog_precondition_digest"
    AND "execution"."canonical_scope" = "input"."canonical_scope"
    AND "execution"."canonical_scope_byte_length" = "pg_catalog"."octet_length"("input"."canonical_scope")
    AND "execution"."capture_digest" = "input"."capture_digest"
    AND "execution"."captured_high_water" IS NOT DISTINCT FROM "input"."captured_high_water"
    AND "execution"."initial_remaining_eligible_row_count" = "input"."initial_remaining_eligible_row_count"
    AND "execution"."initial_remaining_target_row_count" = "input"."initial_remaining_target_row_count"
    AND "execution"."required_matched_row_count" IS NOT DISTINCT FROM "input"."required_matched_row_count"
    AND "execution"."required_batch_count" = "input"."required_batch_count"
    AND "execution"."batch_size" = "input"."batch_size"
    AND "execution"."maximum_receipt_count" = 10000
    AND "execution"."maximum_batch_count" = 9999
    AND "execution"."status" = "input"."initial_execution_status"
    AND "execution"."created_at" = "input"."candidate_committed_at"
    AND "execution"."updated_at" = "input"."candidate_committed_at"
),
"exact_immutable_execution" AS MATERIALIZED (
  SELECT "exact"."execution_id"
  FROM "exact_initial_execution" AS "exact"
  UNION ALL
  SELECT "execution"."execution_id"
  FROM "locked_executions" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  WHERE "execution"."execution_id" = "input"."execution_id"
    AND NOT EXISTS (SELECT 1 FROM "exact_initial_execution")
    AND "execution"."provider_id" = 'supabase'
    AND "execution"."environment" = 'staging'
    AND "execution"."application_id" = "input"."application_id"
    AND "execution"."application_digest" = "input"."application_digest"
    AND "execution"."migration_id" = "input"."migration_id"
    AND "execution"."migration_digest" = "input"."migration_digest"
    AND "execution"."migration_plan_digest" = "input"."migration_plan_digest"
    AND "execution"."provider_authority_digest" = "input"."provider_authority_digest"
    AND "execution"."source_ledger_digest" = "input"."source_ledger_digest"
    AND "execution"."scope_digest" = "input"."scope_digest"
    AND "execution"."resource_identity_digest" = "input"."resource_identity_digest"
    AND "execution"."catalog_precondition_digest" = "input"."catalog_precondition_digest"
    AND "execution"."canonical_scope" = "input"."canonical_scope"
    AND "execution"."canonical_scope_byte_length" = "pg_catalog"."octet_length"("input"."canonical_scope")
    AND "execution"."capture_digest" = "input"."capture_digest"
    AND "execution"."captured_high_water" IS NOT DISTINCT FROM "input"."captured_high_water"
    AND "execution"."initial_remaining_eligible_row_count" = "input"."initial_remaining_eligible_row_count"
    AND "execution"."initial_remaining_target_row_count" = "input"."initial_remaining_target_row_count"
    AND "execution"."required_matched_row_count" IS NOT DISTINCT FROM "input"."required_matched_row_count"
    AND "execution"."required_batch_count" = "input"."required_batch_count"
    AND "execution"."batch_size" = "input"."batch_size"
    AND "execution"."maximum_receipt_count" = 10000
    AND "execution"."maximum_batch_count" = 9999
    AND "execution"."status" IN ('running', 'completed', 'failed')
    AND "execution"."updated_at" >= "execution"."created_at"
    AND "execution"."created_at" = "input"."candidate_committed_at"
),
"exact_receipt_zero" AS MATERIALIZED (
  SELECT "receipt"."execution_id"
  FROM "locked_receipts" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  WHERE "receipt"."execution_id" = "input"."execution_id"
    AND "receipt"."revision" = 1
    AND "receipt"."event_id" = "input"."event_id"
    AND "receipt"."receipt_id" = "input"."receipt_id"
    AND "receipt"."idempotency_key" = "input"."idempotency_key"
    AND "receipt"."request_digest" = "input"."request_digest"
    AND "receipt"."receipt_digest" = "input"."receipt_digest"
    AND "receipt"."previous_revision" IS NULL
    AND "receipt"."previous_event_id" IS NULL
    AND "receipt"."previous_receipt_digest" IS NULL
    AND "receipt"."checkpoint_kind" = 'capture'
    AND "receipt"."canonical_receipt" = "input"."canonical_receipt"
    AND "receipt"."canonical_receipt_byte_length" = "pg_catalog"."octet_length"("input"."canonical_receipt")
    AND "receipt"."committed_at" = "input"."candidate_committed_at"
),
"exact_initial_head" AS MATERIALIZED (
  SELECT "head"."execution_id"
  FROM "locked_head" AS "head"
  CROSS JOIN "input_validity" AS "input"
  WHERE "head"."execution_id" = "input"."execution_id"
    AND "head"."revision" = 1
    AND "head"."event_id" = "input"."event_id"
    AND "head"."receipt_digest" = "input"."receipt_digest"
    AND "head"."updated_at" = "input"."candidate_committed_at"
),
"receipt_chain"(
  "revision", "event_id", "receipt_digest", "previous_revision",
  "previous_event_id", "previous_receipt_digest", "committed_at", "depth"
) AS (
  SELECT
    "receipt"."revision", "receipt"."event_id", "receipt"."receipt_digest",
    "receipt"."previous_revision", "receipt"."previous_event_id",
    "receipt"."previous_receipt_digest", "receipt"."committed_at", 1::"pg_catalog"."int4"
  FROM "locked_head" AS "head"
  JOIN "locked_receipts" AS "receipt"
    ON "receipt"."execution_id" = "head"."execution_id"
    AND "receipt"."revision" = "head"."revision"
    AND "receipt"."event_id" = "head"."event_id"
    AND "receipt"."receipt_digest" = "head"."receipt_digest"
  WHERE "head"."revision" BETWEEN 2 AND 10000
  UNION ALL
  SELECT
    "previous"."revision", "previous"."event_id", "previous"."receipt_digest",
    "previous"."previous_revision", "previous"."previous_event_id",
    "previous"."previous_receipt_digest", "previous"."committed_at", "chain"."depth" + 1
  FROM "receipt_chain" AS "chain"
  JOIN "locked_receipts" AS "previous"
    ON "previous"."revision" = "chain"."previous_revision"
    AND "previous"."event_id" = "chain"."previous_event_id"
    AND "previous"."receipt_digest" = "chain"."previous_receipt_digest"
  WHERE "chain"."previous_revision" = "chain"."revision" - 1
    AND "chain"."depth" < 10000
),
"pre_state" AS MATERIALIZED (
  SELECT CASE
    WHEN NOT "runtime"."ready" THEN 'precondition-failed'
    WHEN "input"."valid"
      AND (SELECT COUNT(*) FROM "locked_executions") = 0
      AND (SELECT COUNT(*) FROM "locked_head") = 0
      AND (SELECT COUNT(*) FROM "locked_receipts") = 0
      THEN 'absent'
    WHEN "input"."valid"
      AND (SELECT COUNT(*) FROM "locked_executions") = 1
      AND (SELECT COUNT(*) FROM "exact_initial_execution") = 1
      AND (SELECT COUNT(*) FROM "locked_receipts") = 1
      AND (SELECT COUNT(*) FROM "exact_receipt_zero") = 1
      AND (SELECT COUNT(*) FROM "locked_head") = 1
      AND (SELECT COUNT(*) FROM "exact_initial_head") = 1
      THEN 'exact-replay'
    WHEN "input"."valid"
      AND "input"."initial_execution_status" = 'running'
      AND "input"."receipt_document" ->> 'outcome' = 'in-progress'
      AND (SELECT COUNT(*) FROM "locked_executions") = 1
      AND (SELECT COUNT(*) FROM "exact_immutable_execution") = 1
      AND (SELECT COUNT(*) FROM "exact_receipt_zero") = 1
      AND (SELECT COUNT(*) FROM "locked_head") = 1
      AND (SELECT MAX("revision") FROM "locked_head") BETWEEN 2 AND 10000
      AND (SELECT COUNT(*) FROM "locked_receipts") = (SELECT MAX("revision") FROM "locked_head")
      AND (SELECT COUNT(*) FROM "receipt_chain") = (SELECT MAX("revision") FROM "locked_head")
      AND (SELECT MIN("revision") FROM "receipt_chain") = 1
      AND (SELECT MAX("revision") FROM "receipt_chain") = (SELECT MAX("revision") FROM "locked_head")
      AND (SELECT MAX("updated_at") FROM "locked_head") = (
        SELECT MAX("committed_at") FROM "receipt_chain"
        WHERE "revision" = (SELECT MAX("revision") FROM "receipt_chain")
      )
      AND (SELECT MAX("updated_at") FROM "locked_executions") = (SELECT MAX("updated_at") FROM "locked_head")
      THEN 'advanced-head'
    ELSE 'corruption'
  END::"pg_catalog"."text" AS "state"
  FROM "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
),
"inserted_execution" AS (
  INSERT INTO "openpencil_release"."backfill_executions_v1" (
    "execution_id", "provider_id", "environment", "application_id", "application_digest",
    "migration_id", "migration_digest", "migration_plan_digest", "provider_authority_digest",
    "source_ledger_digest", "scope_digest", "resource_identity_digest",
    "catalog_precondition_digest", "canonical_scope", "canonical_scope_byte_length",
    "capture_digest", "captured_high_water", "initial_remaining_eligible_row_count",
    "initial_remaining_target_row_count", "required_matched_row_count", "required_batch_count",
    "batch_size", "maximum_receipt_count", "maximum_batch_count", "status", "created_at", "updated_at"
  )
  SELECT
    "input"."execution_id", 'supabase', 'staging', "input"."application_id",
    "input"."application_digest", "input"."migration_id", "input"."migration_digest",
    "input"."migration_plan_digest", "input"."provider_authority_digest",
    "input"."source_ledger_digest", "input"."scope_digest", "input"."resource_identity_digest",
    "input"."catalog_precondition_digest", "input"."canonical_scope",
    "pg_catalog"."octet_length"("input"."canonical_scope"), "input"."capture_digest",
    "input"."captured_high_water", "input"."initial_remaining_eligible_row_count",
    "input"."initial_remaining_target_row_count", "input"."required_matched_row_count",
    "input"."required_batch_count", "input"."batch_size", 10000, 9999,
    "input"."initial_execution_status", "input"."candidate_committed_at",
    "input"."candidate_committed_at"
  FROM "input_validity" AS "input"
  CROSS JOIN "pre_state"
  WHERE "pre_state"."state" = 'absent'
  ON CONFLICT DO NOTHING
  RETURNING "execution_id"
),
"inserted_receipt" AS (
  INSERT INTO "openpencil_release"."backfill_receipts_v2" (
    "execution_id", "revision", "event_id", "receipt_id", "idempotency_key",
    "request_digest", "receipt_digest", "previous_revision", "previous_event_id",
    "previous_receipt_digest", "checkpoint_kind", "canonical_receipt",
    "canonical_receipt_byte_length", "committed_at"
  )
  SELECT
    "input"."execution_id", 1, "input"."event_id", "input"."receipt_id",
    "input"."idempotency_key", "input"."request_digest", "input"."receipt_digest",
    NULL, NULL, NULL, 'capture', "input"."canonical_receipt",
    "pg_catalog"."octet_length"("input"."canonical_receipt"), "input"."candidate_committed_at"
  FROM "input_validity" AS "input"
  JOIN "inserted_execution" USING ("execution_id")
  RETURNING "execution_id"
),
"inserted_head" AS (
  INSERT INTO "openpencil_release"."backfill_heads_v1" (
    "execution_id", "revision", "event_id", "receipt_digest", "updated_at"
  )
  SELECT
    "input"."execution_id", 1, "input"."event_id", "input"."receipt_digest",
    "input"."candidate_committed_at"
  FROM "input_validity" AS "input"
  JOIN "inserted_receipt" USING ("execution_id")
  RETURNING "execution_id"
),
"effects" AS MATERIALIZED (
  SELECT
    (SELECT COUNT(*) FROM "inserted_execution") AS "execution_count",
    (SELECT COUNT(*) FROM "inserted_receipt") AS "receipt_count",
    (SELECT COUNT(*) FROM "inserted_head") AS "head_count"
)
SELECT CASE
  WHEN "pre_state"."state" = 'absent' THEN 'inserted'
  ELSE "pre_state"."state"
END::"pg_catalog"."text" AS "status"
FROM "pre_state"
CROSS JOIN "effects"
WHERE 1 / CASE
  WHEN "pre_state"."state" = 'absent'
    AND "effects"."execution_count" = 1
    AND "effects"."receipt_count" = 1
    AND "effects"."head_count" = 1
    THEN 1
  WHEN "pre_state"."state" <> 'absent'
    AND "effects"."execution_count" = 0
    AND "effects"."receipt_count" = 0
    AND "effects"."head_count" = 0
    THEN 1
  ELSE 0
END = 1;
