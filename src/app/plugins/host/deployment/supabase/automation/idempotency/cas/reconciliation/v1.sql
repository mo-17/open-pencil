-- OpenPencil Supabase Backend Automation idempotency CAS reconciliation fixed read v1.
-- TESTING/REVIEW ONLY: fixed single-snapshot read, no transport or authority is created.
-- Parameters are positional and values must never be interpolated into this statement.
WITH RECURSIVE
"input" AS MATERIALIZED (
  SELECT
    $1::"pg_catalog"."text" AS "proposal_digest",
    $2::"pg_catalog"."text" AS "canonical_proposal_base64",
    $3::"pg_catalog"."text" AS "record_digest",
    $4::"pg_catalog"."text" AS "canonical_record_base64",
    $5::"pg_catalog"."text" AS "automation_id",
    $6::"pg_catalog"."text" AS "event_id",
    $7::"pg_catalog"."text" AS "operation_id",
    $8::"pg_catalog"."text" AS "idempotency_key_digest",
    $9::"pg_catalog"."text" AS "causation_id",
    $10::"pg_catalog"."int4" AS "causation_hop",
    $11::"pg_catalog"."int4" AS "retention_hours",
    $12::"pg_catalog"."text" AS "created_at_text",
    $13::"pg_catalog"."text" AS "expires_at_text",
    $14::"pg_catalog"."text" AS "recorded_at_text",
    $15::"pg_catalog"."int8" AS "next_revision",
    $16::"pg_catalog"."int8" AS "expected_revision",
    $17::"pg_catalog"."text" AS "expected_head_digest",
    $18::"pg_catalog"."text" AS "previous_record_digest",
    $19::"pg_catalog"."text"[] AS "attempt_ids",
    $20::"pg_catalog"."text" AS "current_attempt_id",
    $21::"pg_catalog"."text" AS "state",
    $22::"pg_catalog"."text" AS "completion_evidence_digest",
    $23::"pg_catalog"."text" AS "known_not_dispatched_evidence_digest",
    $24::"pg_catalog"."text" AS "reconciliation_evidence_digest",
    $25::"pg_catalog"."bool" AS "host_evidence_authenticated",
    $26::"pg_catalog"."bool" AS "persistence_authority_granted",
    $27::"pg_catalog"."bool" AS "dispatch_authority_granted"
),
"normalized_input" AS MATERIALIZED (
  SELECT
    "input".*,
    "pg_catalog"."decode"("input"."canonical_proposal_base64", 'base64')
      AS "canonical_proposal",
    "pg_catalog"."decode"("input"."canonical_record_base64", 'base64')
      AS "canonical_record",
    "input"."created_at_text"::"pg_catalog"."timestamptz" AS "created_at",
    "input"."expires_at_text"::"pg_catalog"."timestamptz" AS "expires_at",
    "input"."recorded_at_text"::"pg_catalog"."timestamptz" AS "recorded_at",
    "pg_catalog"."cardinality"("input"."attempt_ids")::"pg_catalog"."int4"
      AS "attempt_ordinal",
    CASE "input"."state"
      WHEN 'reserved' THEN 'current-attempt-only'
      WHEN 'dispatch-started' THEN 'current-attempt-only'
      WHEN 'outcome-unknown' THEN 'reconciliation-required'
      WHEN 'succeeded' THEN 'terminal'
      WHEN 'known-not-dispatched' THEN 'bounded-policy-review-required'
      ELSE NULL
    END::"pg_catalog"."text" AS "retry_fence"
  FROM "input"
),
"documents" AS MATERIALIZED (
  SELECT
    "normalized".*,
    "pg_catalog"."convert_from"("normalized"."canonical_proposal", 'UTF8')
      AS "canonical_proposal_text",
    "pg_catalog"."convert_from"("normalized"."canonical_record", 'UTF8')
      AS "canonical_record_text",
    "pg_catalog"."convert_from"("normalized"."canonical_proposal", 'UTF8')
      ::"pg_catalog"."jsonb" AS "proposal_document",
    "pg_catalog"."convert_from"("normalized"."canonical_record", 'UTF8')
      ::"pg_catalog"."jsonb" AS "record_document"
  FROM "normalized_input" AS "normalized"
),
"canonical_expectations" AS MATERIALIZED (
  SELECT
    "documents".*,
    (
      '{"automationId":'
      || "pg_catalog"."to_json"("automation_id")::"pg_catalog"."text"
      || ',"dispatchAuthorityGranted":'
      || "pg_catalog"."to_json"("dispatch_authority_granted")::"pg_catalog"."text"
      || ',"eventId":'
      || "pg_catalog"."to_json"("event_id")::"pg_catalog"."text"
      || ',"expectedHeadDigest":'
      || COALESCE(
        "pg_catalog"."to_json"("expected_head_digest")::"pg_catalog"."text",
        'null'
      )
      || ',"expectedRevision":'
      || COALESCE(
        "pg_catalog"."to_json"("expected_revision")::"pg_catalog"."text",
        'null'
      )
      || ',"format":"openpencil.backend-automation-idempotency-cas-proposal"'
      || ',"hostEvidenceAuthenticated":'
      || "pg_catalog"."to_json"("host_evidence_authenticated")::"pg_catalog"."text"
      || ',"idempotencyKeyDigest":'
      || "pg_catalog"."to_json"("idempotency_key_digest")::"pg_catalog"."text"
      || ',"nextRecordDigest":'
      || "pg_catalog"."to_json"("record_digest")::"pg_catalog"."text"
      || ',"nextRevision":'
      || "pg_catalog"."to_json"("next_revision")::"pg_catalog"."text"
      || ',"operationId":'
      || "pg_catalog"."to_json"("operation_id")::"pg_catalog"."text"
      || ',"persistenceAuthorityGranted":'
      || "pg_catalog"."to_json"("persistence_authority_granted")::"pg_catalog"."text"
      || ',"version":1}'
    )::"pg_catalog"."text" AS "expected_canonical_proposal_text",
    (
      '{"attemptIds":'
      || "pg_catalog"."array_to_json"("attempt_ids")::"pg_catalog"."text"
      || ',"automationId":'
      || "pg_catalog"."to_json"("automation_id")::"pg_catalog"."text"
      || ',"causationHop":'
      || "pg_catalog"."to_json"("causation_hop")::"pg_catalog"."text"
      || ',"causationId":'
      || "pg_catalog"."to_json"("causation_id")::"pg_catalog"."text"
      || ',"completionEvidenceDigest":'
      || COALESCE(
        "pg_catalog"."to_json"("completion_evidence_digest")::"pg_catalog"."text",
        'null'
      )
      || ',"createdAt":'
      || "pg_catalog"."to_json"("created_at_text")::"pg_catalog"."text"
      || ',"currentAttemptId":'
      || "pg_catalog"."to_json"("current_attempt_id")::"pg_catalog"."text"
      || ',"dispatchAuthorityGranted":'
      || "pg_catalog"."to_json"("dispatch_authority_granted")::"pg_catalog"."text"
      || ',"eventId":'
      || "pg_catalog"."to_json"("event_id")::"pg_catalog"."text"
      || ',"expiresAt":'
      || "pg_catalog"."to_json"("expires_at_text")::"pg_catalog"."text"
      || ',"format":"openpencil.backend-automation-idempotency-record"'
      || ',"hostEvidenceAuthenticated":'
      || "pg_catalog"."to_json"("host_evidence_authenticated")::"pg_catalog"."text"
      || ',"idempotencyKeyDigest":'
      || "pg_catalog"."to_json"("idempotency_key_digest")::"pg_catalog"."text"
      || ',"knownNotDispatchedEvidenceDigest":'
      || COALESCE(
        "pg_catalog"."to_json"("known_not_dispatched_evidence_digest")
          ::"pg_catalog"."text",
        'null'
      )
      || ',"operationId":'
      || "pg_catalog"."to_json"("operation_id")::"pg_catalog"."text"
      || ',"persistenceAuthorityGranted":'
      || "pg_catalog"."to_json"("persistence_authority_granted")::"pg_catalog"."text"
      || ',"previousRecordDigest":'
      || COALESCE(
        "pg_catalog"."to_json"("previous_record_digest")::"pg_catalog"."text",
        'null'
      )
      || ',"reconciliationEvidenceDigest":'
      || COALESCE(
        "pg_catalog"."to_json"("reconciliation_evidence_digest")
          ::"pg_catalog"."text",
        'null'
      )
      || ',"recordedAt":'
      || "pg_catalog"."to_json"("recorded_at_text")::"pg_catalog"."text"
      || ',"retentionHours":'
      || "pg_catalog"."to_json"("retention_hours")::"pg_catalog"."text"
      || ',"revision":'
      || "pg_catalog"."to_json"("next_revision")::"pg_catalog"."text"
      || ',"state":'
      || "pg_catalog"."to_json"("state")::"pg_catalog"."text"
      || ',"version":1}'
    )::"pg_catalog"."text" AS "expected_canonical_record_text"
  FROM "documents"
),
"input_validity" AS MATERIALIZED (
  SELECT
    "candidate".*,
    COALESCE((
      "proposal_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      AND "record_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      AND "idempotency_key_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      AND (
        "expected_head_digest" IS NULL
        OR "expected_head_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      )
      AND (
        "previous_record_digest" IS NULL
        OR "previous_record_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      )
      AND (
        "completion_evidence_digest" IS NULL
        OR "completion_evidence_digest" ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      )
      AND (
        "known_not_dispatched_evidence_digest" IS NULL
        OR "known_not_dispatched_evidence_digest"
          ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      )
      AND (
        "reconciliation_evidence_digest" IS NULL
        OR "reconciliation_evidence_digest"
          ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
      )
      AND "automation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      AND "event_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      AND "operation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      AND "causation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      AND "current_attempt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      AND "causation_hop" BETWEEN 0 AND 16
      AND "retention_hours" BETWEEN 1 AND 2160
      AND "next_revision" BETWEEN 0 AND 1024
      AND (
        "expected_revision" IS NULL
        OR "expected_revision" BETWEEN 0 AND 1023
      )
      AND ("expected_revision" IS NULL) = ("expected_head_digest" IS NULL)
      AND "next_revision" = CASE
        WHEN "expected_revision" IS NULL THEN 0
        ELSE "expected_revision" + 1
      END
      AND "previous_record_digest" IS NOT DISTINCT FROM "expected_head_digest"
      AND ("next_revision" = 0) = ("previous_record_digest" IS NULL)
      AND "created_at_text"
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      AND "expires_at_text"
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      AND "recorded_at_text"
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{3}Z$'
      AND "pg_catalog"."isfinite"("created_at")
      AND "pg_catalog"."isfinite"("expires_at")
      AND "pg_catalog"."isfinite"("recorded_at")
      AND "pg_catalog"."to_char"(
        "pg_catalog"."timezone"('UTC', "created_at"),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) = "created_at_text"
      AND "pg_catalog"."to_char"(
        "pg_catalog"."timezone"('UTC', "expires_at"),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) = "expires_at_text"
      AND "pg_catalog"."to_char"(
        "pg_catalog"."timezone"('UTC', "recorded_at"),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ) = "recorded_at_text"
      AND "expires_at"
        = "created_at"
          + ("retention_hours"::"pg_catalog"."int8"
            * '1 hour'::"pg_catalog"."interval")
      AND "recorded_at" >= "created_at"
      AND ("next_revision" <> 0 OR "recorded_at" = "created_at")
      AND "pg_catalog"."cardinality"("attempt_ids") BETWEEN 1 AND 20
      AND "pg_catalog"."array_ndims"("attempt_ids") = 1
      AND "pg_catalog"."array_lower"("attempt_ids", 1) = 1
      AND "pg_catalog"."array_upper"("attempt_ids", 1)
        = "pg_catalog"."cardinality"("attempt_ids")
      AND "pg_catalog"."cardinality"("attempt_ids") <= "next_revision" + 1
      AND "current_attempt_id"
        = "attempt_ids"["pg_catalog"."cardinality"("attempt_ids")]
      AND NOT EXISTS (
        SELECT 1
        FROM "pg_catalog"."unnest"("attempt_ids") AS "attempt"("attempt_id")
        WHERE "attempt"."attempt_id" IS NULL
          OR "attempt"."attempt_id"
            !~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'
      )
      AND (
        SELECT "pg_catalog"."count"(*)
          = "pg_catalog"."count"(DISTINCT "attempt"."attempt_id")
        FROM "pg_catalog"."unnest"("attempt_ids") AS "attempt"("attempt_id")
      )
      AND "state" IN (
        'reserved',
        'dispatch-started',
        'outcome-unknown',
        'succeeded',
        'known-not-dispatched'
      )
      AND (
        (
          "state" IN ('reserved', 'dispatch-started', 'outcome-unknown')
          AND "completion_evidence_digest" IS NULL
          AND "known_not_dispatched_evidence_digest" IS NULL
          AND "reconciliation_evidence_digest" IS NULL
        )
        OR (
          "state" = 'succeeded'
          AND "completion_evidence_digest" IS NOT NULL
          AND "known_not_dispatched_evidence_digest" IS NULL
        )
        OR (
          "state" = 'known-not-dispatched'
          AND "completion_evidence_digest" IS NULL
          AND "known_not_dispatched_evidence_digest" IS NOT NULL
        )
      )
      AND "host_evidence_authenticated" IS FALSE
      AND "persistence_authority_granted" IS FALSE
      AND "dispatch_authority_granted" IS FALSE
      AND "pg_catalog"."octet_length"("canonical_proposal") BETWEEN 2 AND 16384
      AND "pg_catalog"."octet_length"("canonical_record") BETWEEN 2 AND 16384
      AND "proposal_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"(
          "pg_catalog"."encode"(
            "pg_catalog"."sha256"("canonical_proposal"),
            'base64'
          ),
          '='
        ),
        '+/',
        '-_'
      )
      AND "record_digest" = "pg_catalog"."translate"(
        "pg_catalog"."rtrim"(
          "pg_catalog"."encode"(
            "pg_catalog"."sha256"("canonical_record"),
            'base64'
          ),
          '='
        ),
        '+/',
        '-_'
      )
      AND "canonical_proposal_text" = "expected_canonical_proposal_text"
      AND "canonical_record_text" = "expected_canonical_record_text"
      AND "proposal_document" = "expected_canonical_proposal_text"::"pg_catalog"."jsonb"
      AND "record_document" = "expected_canonical_record_text"::"pg_catalog"."jsonb"
      AND (
        "next_revision" <> 0
        OR (
          "state" = 'reserved'
          AND "attempt_ordinal" = 1
          AND "recorded_at" = "created_at"
        )
      )
    ), FALSE) AS "valid"
  FROM "canonical_expectations" AS "candidate"
),
"review_target" AS MATERIALIZED (
  SELECT
    '__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__'::"pg_catalog"."text"
      AS "schema_name",
    (
      'openpencil.supabase-automation-idempotency-ledger.v1'
      || "pg_catalog"."chr"(59)
      || 'application='
      || "pg_catalog"."right"(
        '__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__'::"pg_catalog"."text",
        20
      )
      || "pg_catalog"."chr"(59)
      || 'object='
    )::"pg_catalog"."text" AS "marker_prefix"
),
"catalog_objects" AS MATERIALIZED (
  SELECT
    "target".*,
    "pg_catalog"."to_regnamespace"(
      '"__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"'
    ) AS "schema_oid",
    "pg_catalog"."to_regclass"(
      '"__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_revisions"'
    ) AS "revisions_oid",
    "pg_catalog"."to_regclass"(
      '"__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads"'
    ) AS "heads_oid",
    "pg_catalog"."to_regprocedure"(
      '"__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."reject_idempotency_revision_mutation"()'
    ) AS "guard_oid",
    (
      SELECT "ledger_schema"."nspowner"
      FROM "pg_catalog"."pg_namespace" AS "ledger_schema"
      WHERE "ledger_schema"."oid" = "pg_catalog"."to_regnamespace"(
        '"__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"'
      )
    ) AS "owner_role_oid",
    (
      SELECT "database_role"."oid"
      FROM "pg_catalog"."pg_roles" AS "database_role"
      WHERE "database_role"."rolname" = CURRENT_USER
    ) AS "current_role_oid",
    (
      SELECT "database_role"."oid"
      FROM "pg_catalog"."pg_roles" AS "database_role"
      WHERE "database_role"."rolname" = SESSION_USER
    ) AS "session_role_oid"
  FROM "review_target" AS "target"
),
"expected_columns"(
  "table_name", "ordinal", "column_name", "type_name", "not_null"
) AS (
  VALUES
    ('idempotency_revisions', 1, 'automation_id', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 2, 'idempotency_key_digest', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 3, 'revision', 'pg_catalog.int8', TRUE),
    ('idempotency_revisions', 4, 'expected_revision', 'pg_catalog.int8', FALSE),
    ('idempotency_revisions', 5, 'expected_head_digest', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 6, 'expected_event_id', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 7, 'expected_operation_id', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 8, 'expected_causation_id', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 9, 'expected_causation_hop', 'pg_catalog.int2', FALSE),
    ('idempotency_revisions', 10, 'expected_attempt_id', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 11, 'expected_attempt_ordinal', 'pg_catalog.int2', FALSE),
    ('idempotency_revisions', 12, 'expected_state', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 13, 'expected_recorded_at', 'pg_catalog.timestamptz', FALSE),
    ('idempotency_revisions', 14, 'expected_retention_expires_at', 'pg_catalog.timestamptz', FALSE),
    ('idempotency_revisions', 15, 'record_digest', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 16, 'event_id', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 17, 'operation_id', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 18, 'causation_id', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 19, 'causation_hop', 'pg_catalog.int2', TRUE),
    ('idempotency_revisions', 20, 'attempt_id', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 21, 'attempt_ordinal', 'pg_catalog.int2', TRUE),
    ('idempotency_revisions', 22, 'state', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 23, 'retry_fence', 'pg_catalog.text', TRUE),
    ('idempotency_revisions', 24, 'completion_evidence_digest', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 25, 'known_not_dispatched_evidence_digest', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 26, 'reconciliation_evidence_digest', 'pg_catalog.text', FALSE),
    ('idempotency_revisions', 27, 'recorded_at', 'pg_catalog.timestamptz', TRUE),
    ('idempotency_revisions', 28, 'retention_expires_at', 'pg_catalog.timestamptz', TRUE),
    ('idempotency_heads', 1, 'automation_id', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 2, 'idempotency_key_digest', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 3, 'current_revision', 'pg_catalog.int8', TRUE),
    ('idempotency_heads', 4, 'current_head_digest', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 5, 'current_event_id', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 6, 'current_operation_id', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 7, 'current_causation_id', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 8, 'current_causation_hop', 'pg_catalog.int2', TRUE),
    ('idempotency_heads', 9, 'current_attempt_id', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 10, 'current_attempt_ordinal', 'pg_catalog.int2', TRUE),
    ('idempotency_heads', 11, 'current_state', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 12, 'current_retry_fence', 'pg_catalog.text', TRUE),
    ('idempotency_heads', 13, 'current_recorded_at', 'pg_catalog.timestamptz', TRUE),
    ('idempotency_heads', 14, 'retention_expires_at', 'pg_catalog.timestamptz', TRUE)
),
"expected_constraints"(
  "table_name", "constraint_name", "constraint_type", "no_inherit"
) AS (
  VALUES
    ('idempotency_revisions', 'idempotency_revisions_pkey', 'p', TRUE),
    ('idempotency_revisions', 'idempotency_revisions_head_key', 'u', TRUE),
    ('idempotency_revisions', 'idempotency_revisions_previous_fkey', 'f', TRUE),
    ('idempotency_revisions', 'idempotency_revisions_identifiers_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_digests_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_chain_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_transition_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_evidence_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_retry_fence_check', 'c', FALSE),
    ('idempotency_revisions', 'idempotency_revisions_retention_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_pkey', 'p', TRUE),
    ('idempotency_heads', 'idempotency_heads_revision_fkey', 'f', TRUE),
    ('idempotency_heads', 'idempotency_heads_key_digest_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_head_digest_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_revision_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_attempt_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_state_fence_check', 'c', FALSE),
    ('idempotency_heads', 'idempotency_heads_retention_check', 'c', FALSE)
),
"expected_constraint_definitions"(
  "table_name", "constraint_name", "definition"
) AS (
  VALUES
    (
      'idempotency_revisions', 'idempotency_revisions_pkey',
      $openpencil_constraint$PRIMARY KEY (automation_id, idempotency_key_digest, revision)$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_head_key',
      $openpencil_constraint$UNIQUE (automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at)$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_previous_fkey',
      $openpencil_constraint$FOREIGN KEY (automation_id, idempotency_key_digest, expected_revision, expected_head_digest, expected_event_id, expected_operation_id, expected_causation_id, expected_causation_hop, expected_attempt_id, expected_attempt_ordinal, expected_state, expected_recorded_at, expected_retention_expires_at) REFERENCES __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions(automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at) DEFERRABLE INITIALLY DEFERRED$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_identifiers_check',
      $openpencil_constraint$CHECK (((automation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((expected_event_id IS NULL) OR (expected_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_operation_id IS NULL) OR (expected_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_causation_id IS NULL) OR (expected_causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_attempt_id IS NULL) OR (expected_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_digests_check',
      $openpencil_constraint$CHECK (((idempotency_key_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text) AND (record_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text) AND ((expected_head_digest IS NULL) OR (expected_head_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((completion_evidence_digest IS NULL) OR (completion_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((known_not_dispatched_evidence_digest IS NULL) OR (known_not_dispatched_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((reconciliation_evidence_digest IS NULL) OR (reconciliation_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_chain_check',
      $openpencil_constraint$CHECK ((((revision = 0) AND (expected_revision IS NULL) AND (expected_head_digest IS NULL) AND (expected_event_id IS NULL) AND (expected_operation_id IS NULL) AND (expected_causation_id IS NULL) AND (expected_causation_hop IS NULL) AND (expected_attempt_id IS NULL) AND (expected_attempt_ordinal IS NULL) AND (expected_state IS NULL) AND (expected_recorded_at IS NULL) AND (expected_retention_expires_at IS NULL)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_revision IS NOT NULL) AND (expected_revision = (revision - 1)) AND (expected_head_digest IS NOT NULL) AND (expected_event_id IS NOT NULL) AND (expected_operation_id IS NOT NULL) AND (expected_causation_id IS NOT NULL) AND (expected_causation_hop IS NOT NULL) AND (expected_attempt_id IS NOT NULL) AND (expected_attempt_ordinal IS NOT NULL) AND (expected_state IS NOT NULL) AND (expected_recorded_at IS NOT NULL) AND (expected_retention_expires_at IS NOT NULL) AND (event_id = expected_event_id) AND (operation_id = expected_operation_id) AND (causation_id = expected_causation_id) AND (causation_hop = expected_causation_hop) AND (recorded_at >= expected_recorded_at) AND (retention_expires_at = expected_retention_expires_at))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_transition_check',
      $openpencil_constraint$CHECK ((((revision = 0) AND (state = 'reserved'::text) AND (attempt_ordinal = 1) AND (recorded_at < retention_expires_at)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'reserved'::text) AND (state = ANY (ARRAY['dispatch-started'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'dispatch-started'::text) AND (state = ANY (ARRAY['outcome-unknown'::text, 'succeeded'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'outcome-unknown'::text) AND (state = ANY (ARRAY['succeeded'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'known-not-dispatched'::text) AND (state = 'reserved'::text) AND (attempt_id <> expected_attempt_id) AND (attempt_ordinal = (expected_attempt_ordinal + 1)) AND ((attempt_ordinal >= 2) AND (attempt_ordinal <= 20)) AND (recorded_at < retention_expires_at))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_evidence_check',
      $openpencil_constraint$CHECK ((((state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text, 'outcome-unknown'::text])) AND (completion_evidence_digest IS NULL) AND (known_not_dispatched_evidence_digest IS NULL) AND (reconciliation_evidence_digest IS NULL)) OR ((state = 'succeeded'::text) AND (completion_evidence_digest IS NOT NULL) AND (known_not_dispatched_evidence_digest IS NULL) AND (((expected_state = 'dispatch-started'::text) AND (reconciliation_evidence_digest IS NULL)) OR ((expected_state = 'outcome-unknown'::text) AND (reconciliation_evidence_digest IS NOT NULL)))) OR ((state = 'known-not-dispatched'::text) AND (completion_evidence_digest IS NULL) AND (known_not_dispatched_evidence_digest IS NOT NULL) AND (((expected_state = 'reserved'::text) AND (reconciliation_evidence_digest IS NULL)) OR ((expected_state = ANY (ARRAY['dispatch-started'::text, 'outcome-unknown'::text])) AND (reconciliation_evidence_digest IS NOT NULL))))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_retry_fence_check',
      $openpencil_constraint$CHECK ((((state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text])) AND (retry_fence = 'current-attempt-only'::text)) OR ((state = 'outcome-unknown'::text) AND (retry_fence = 'reconciliation-required'::text)) OR ((state = 'succeeded'::text) AND (retry_fence = 'terminal'::text)) OR ((state = 'known-not-dispatched'::text) AND (retry_fence = 'bounded-policy-review-required'::text))))$openpencil_constraint$
    ),
    (
      'idempotency_revisions', 'idempotency_revisions_retention_check',
      $openpencil_constraint$CHECK ((isfinite(recorded_at) AND isfinite(retention_expires_at) AND ((causation_hop >= 0) AND (causation_hop <= 16)) AND ((expected_causation_hop IS NULL) OR ((expected_causation_hop >= 0) AND (expected_causation_hop <= 16))) AND ((expected_recorded_at IS NULL) OR isfinite(expected_recorded_at)) AND ((expected_retention_expires_at IS NULL) OR isfinite(expected_retention_expires_at))))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_pkey',
      $openpencil_constraint$PRIMARY KEY (automation_id, idempotency_key_digest)$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_revision_fkey',
      $openpencil_constraint$FOREIGN KEY (automation_id, idempotency_key_digest, current_revision, current_head_digest, current_event_id, current_operation_id, current_causation_id, current_causation_hop, current_attempt_id, current_attempt_ordinal, current_state, current_recorded_at, retention_expires_at) REFERENCES __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions(automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at) MATCH FULL DEFERRABLE INITIALLY DEFERRED$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_key_digest_check',
      $openpencil_constraint$CHECK (((automation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (idempotency_key_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_head_digest_check',
      $openpencil_constraint$CHECK ((current_head_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_revision_check',
      $openpencil_constraint$CHECK (((current_revision >= 0) AND (current_revision <= 1024)))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_attempt_check',
      $openpencil_constraint$CHECK (((current_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (current_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (current_causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((current_causation_hop >= 0) AND (current_causation_hop <= 16)) AND isfinite(current_recorded_at) AND (current_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((current_attempt_ordinal >= 1) AND (current_attempt_ordinal <= 20))))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_state_fence_check',
      $openpencil_constraint$CHECK ((((current_state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text])) AND (current_retry_fence = 'current-attempt-only'::text)) OR ((current_state = 'outcome-unknown'::text) AND (current_retry_fence = 'reconciliation-required'::text)) OR ((current_state = 'succeeded'::text) AND (current_retry_fence = 'terminal'::text)) OR ((current_state = 'known-not-dispatched'::text) AND (current_retry_fence = 'bounded-policy-review-required'::text))))$openpencil_constraint$
    ),
    (
      'idempotency_heads', 'idempotency_heads_retention_check',
      $openpencil_constraint$CHECK (isfinite(retention_expires_at))$openpencil_constraint$
    )
),
"expected_indexes"(
  "index_name", "table_name", "primary", "unique_index", "key_columns", "predicate",
  "definition"
) AS (
  VALUES
    (
      'idempotency_revisions_pkey', 'idempotency_revisions',
      TRUE, TRUE, ARRAY[1, 2, 3]::"pg_catalog"."int2"[], NULL::"pg_catalog"."text",
      'CREATE UNIQUE INDEX idempotency_revisions_pkey ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions USING btree (automation_id, idempotency_key_digest, revision)'
    ),
    (
      'idempotency_revisions_head_key', 'idempotency_revisions',
      FALSE, TRUE,
      ARRAY[1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28]
        ::"pg_catalog"."int2"[],
      NULL::"pg_catalog"."text",
      'CREATE UNIQUE INDEX idempotency_revisions_head_key ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions USING btree (automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at)'
    ),
    (
      'idempotency_revisions_attempt_reservation_uidx', 'idempotency_revisions',
      FALSE, TRUE, ARRAY[1, 2, 20]::"pg_catalog"."int2"[],
      '(state = ''reserved''::text)',
      'CREATE UNIQUE INDEX idempotency_revisions_attempt_reservation_uidx ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions USING btree (automation_id, idempotency_key_digest, attempt_id) WHERE (state = ''reserved''::text)'
    ),
    (
      'idempotency_revisions_retention_idx', 'idempotency_revisions',
      FALSE, FALSE, ARRAY[28, 1, 2, 3]::"pg_catalog"."int2"[], NULL::"pg_catalog"."text",
      'CREATE INDEX idempotency_revisions_retention_idx ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_revisions USING btree (retention_expires_at, automation_id, idempotency_key_digest, revision)'
    ),
    (
      'idempotency_heads_pkey', 'idempotency_heads',
      TRUE, TRUE, ARRAY[1, 2]::"pg_catalog"."int2"[], NULL::"pg_catalog"."text",
      'CREATE UNIQUE INDEX idempotency_heads_pkey ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_heads USING btree (automation_id, idempotency_key_digest)'
    ),
    (
      'idempotency_heads_retention_idx', 'idempotency_heads',
      FALSE, FALSE, ARRAY[14, 1, 2]::"pg_catalog"."int2"[], NULL::"pg_catalog"."text",
      'CREATE INDEX idempotency_heads_retention_idx ON __OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__.idempotency_heads USING btree (retention_expires_at, automation_id, idempotency_key_digest)'
    )
),
"known_api_roles" AS MATERIALIZED (
  SELECT
    "expected_role"."role_name",
    "database_role"."oid" AS "role_oid"
  FROM (
    VALUES
      ('anon'::"pg_catalog"."text"),
      ('authenticated'::"pg_catalog"."text"),
      ('authenticator'::"pg_catalog"."text"),
      (('service' || '_role')::"pg_catalog"."text")
  ) AS "expected_role"("role_name")
  LEFT JOIN "pg_catalog"."pg_roles" AS "database_role"
    ON "database_role"."rolname" = "expected_role"."role_name"
),
"runtime_guard" AS MATERIALIZED (
  SELECT COALESCE((
    "pg_catalog"."current_setting"('transaction_isolation') IN (
      'read committed', 'repeatable read', 'serializable'
    )
    AND "pg_catalog"."current_setting"('transaction_read_only') = 'on'
    AND "pg_catalog"."current_setting"('row_security') = 'off'
    AND "pg_catalog"."current_setting"('search_path') = 'pg_catalog'
    AND "pg_catalog"."current_setting"('session_replication_role') = 'origin'
    AND "pg_catalog"."current_setting"('server_encoding') = 'UTF8'
    AND "pg_catalog"."current_setting"('server_version_num')
      ~ '^(15|16|17)[0-9]{4}$'
    AND CURRENT_USER = SESSION_USER
    AND NOT "pg_catalog"."pg_is_in_recovery"()
    AND "pg_catalog"."current_setting"('statement_timeout')
      ::"pg_catalog"."interval" > '0 seconds'::"pg_catalog"."interval"
    AND "pg_catalog"."current_setting"('statement_timeout')
      ::"pg_catalog"."interval" <= '15 seconds'::"pg_catalog"."interval"
  ), FALSE) AS "ready"
),
"catalog_guard" AS MATERIALIZED (
  SELECT COALESCE((
    "objects"."schema_name" ~ '^op_automation_[a-z0-9_-]{20}$'
    AND "objects"."schema_oid" IS NOT NULL
    AND "objects"."revisions_oid" IS NOT NULL
    AND "objects"."heads_oid" IS NOT NULL
    AND "objects"."guard_oid" IS NOT NULL
    AND "objects"."owner_role_oid" IS NOT NULL
    AND "objects"."current_role_oid" IS NOT NULL
    AND "objects"."current_role_oid" = "objects"."session_role_oid"
    AND "objects"."current_role_oid" <> "objects"."owner_role_oid"
    AND NOT "pg_catalog"."pg_has_role"(
      "objects"."current_role_oid", "objects"."owner_role_oid", 'MEMBER'
    )
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_roles" AS "read_role"
      WHERE "read_role"."oid" = "objects"."current_role_oid"
        AND "read_role"."rolname" = 'supabase_read_only_user'
        AND NOT "read_role"."rolsuper"
        AND "read_role"."rolbypassrls"
        AND NOT "read_role"."rolcreaterole"
        AND NOT "read_role"."rolcreatedb"
        AND NOT "read_role"."rolreplication"
    )
    AND "pg_catalog"."pg_has_role"(
      "objects"."current_role_oid",
      "pg_catalog"."to_regrole"('pg_read_all_data'),
      'USAGE'
    )
    AND NOT "pg_catalog"."pg_has_role"(
      "objects"."current_role_oid",
      "pg_catalog"."to_regrole"('pg_write_all_data'),
      'USAGE'
    )
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_collation" AS "default_collation"
      WHERE "default_collation"."oid"
        = "pg_catalog"."to_regcollation"('pg_catalog.default')
        AND "default_collation"."collisdeterministic"
    )
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_namespace" AS "ledger_schema"
      WHERE "ledger_schema"."oid" = "objects"."schema_oid"
        AND "ledger_schema"."nspname" = "objects"."schema_name"
        AND "ledger_schema"."nspowner" = "objects"."owner_role_oid"
        AND "pg_catalog"."obj_description"(
          "ledger_schema"."oid", 'pg_namespace'
        ) = "objects"."marker_prefix" || 'schema'
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_class" AS "ledger_relation"
      WHERE "ledger_relation"."relnamespace" = "objects"."schema_oid"
    ) = 8
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_class" AS "ledger_table"
      WHERE "ledger_table"."oid" IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND "ledger_table"."relkind" = 'r'
        AND "ledger_table"."relpersistence" = 'p'
        AND NOT "ledger_table"."relispartition"
        AND NOT "ledger_table"."relrowsecurity"
        AND NOT "ledger_table"."relforcerowsecurity"
        AND "ledger_table"."relreplident" = 'd'
        AND "ledger_table"."relowner" = "objects"."owner_role_oid"
        AND EXISTS (
          SELECT 1
          FROM "pg_catalog"."pg_am" AS "access_method"
          WHERE "access_method"."oid" = "ledger_table"."relam"
            AND "access_method"."amname" = 'heap'
        )
        AND "pg_catalog"."obj_description"(
          "ledger_table"."oid", 'pg_class'
        ) = "objects"."marker_prefix" || CASE "ledger_table"."relname"
          WHEN 'idempotency_revisions' THEN 'table:idempotency-revisions'
          WHEN 'idempotency_heads' THEN 'table:idempotency-heads'
          ELSE ''
        END
    ) = 2
    AND NOT EXISTS (
      SELECT 1
      FROM "expected_columns" AS "expected"
      LEFT JOIN "pg_catalog"."pg_class" AS "ledger_table"
        ON "ledger_table"."relnamespace" = "objects"."schema_oid"
        AND "ledger_table"."relname" = "expected"."table_name"
        AND "ledger_table"."relkind" = 'r'
      LEFT JOIN "pg_catalog"."pg_attribute" AS "actual"
        ON "actual"."attrelid" = "ledger_table"."oid"
        AND "actual"."attnum" = "expected"."ordinal"
        AND NOT "actual"."attisdropped"
      WHERE "actual"."attrelid" IS NULL
        OR "actual"."attname" <> "expected"."column_name"
        OR "actual"."atttypid" <> "pg_catalog"."to_regtype"("expected"."type_name")
        OR "actual"."attcollation" IS DISTINCT FROM CASE "expected"."type_name"
          WHEN 'pg_catalog.text'
            THEN "pg_catalog"."to_regcollation"('pg_catalog.default')
          ELSE 0::"pg_catalog"."oid"
        END
        OR "actual"."attnotnull" <> "expected"."not_null"
        OR "actual"."atthasdef"
        OR "actual"."attidentity" <> ''
        OR "actual"."attgenerated" <> ''
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_attribute" AS "actual"
      WHERE "actual"."attrelid" IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND "actual"."attnum" > 0
        AND NOT "actual"."attisdropped"
    ) = 42
    AND NOT EXISTS (
      SELECT 1
      FROM "expected_constraints" AS "expected"
      LEFT JOIN "pg_catalog"."pg_class" AS "ledger_table"
        ON "ledger_table"."relnamespace" = "objects"."schema_oid"
        AND "ledger_table"."relname" = "expected"."table_name"
      LEFT JOIN "pg_catalog"."pg_constraint" AS "actual"
        ON "actual"."conrelid" = "ledger_table"."oid"
        AND "actual"."conname" = "expected"."constraint_name"
      LEFT JOIN "expected_constraint_definitions" AS "expected_definition"
        ON "expected_definition"."table_name" = "expected"."table_name"
        AND "expected_definition"."constraint_name" = "expected"."constraint_name"
      WHERE "actual"."oid" IS NULL
        OR "expected_definition"."definition" IS NULL
        OR "actual"."contype"::"pg_catalog"."text" <> "expected"."constraint_type"
        OR NOT "actual"."convalidated"
        OR "actual"."connoinherit" IS DISTINCT FROM "expected"."no_inherit"
        OR "pg_catalog"."pg_get_constraintdef"("actual"."oid", FALSE)
          IS DISTINCT FROM "expected_definition"."definition"
        OR "pg_catalog"."obj_description"("actual"."oid", 'pg_constraint')
          IS DISTINCT FROM
          "objects"."marker_prefix" || 'constraint:' || "expected"."constraint_name"
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_constraint" AS "actual"
      WHERE "actual"."conrelid" IN ("objects"."revisions_oid", "objects"."heads_oid")
    ) = 18
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_constraint" AS "chain_constraint"
      WHERE "chain_constraint"."conrelid" = "objects"."revisions_oid"
        AND "chain_constraint"."conname" = 'idempotency_revisions_previous_fkey'
        AND "chain_constraint"."confrelid" = "objects"."revisions_oid"
        AND "chain_constraint"."conkey"
          = ARRAY[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
            ::"pg_catalog"."int2"[]
        AND "chain_constraint"."confkey"
          = ARRAY[1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28]
            ::"pg_catalog"."int2"[]
        AND "chain_constraint"."condeferrable"
        AND "chain_constraint"."condeferred"
        AND "chain_constraint"."confmatchtype" = 's'
        AND "chain_constraint"."confupdtype" = 'a'
        AND "chain_constraint"."confdeltype" = 'a'
    )
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_constraint" AS "head_constraint"
      WHERE "head_constraint"."conrelid" = "objects"."heads_oid"
        AND "head_constraint"."conname" = 'idempotency_heads_revision_fkey'
        AND "head_constraint"."confrelid" = "objects"."revisions_oid"
        AND "head_constraint"."conkey"
          = ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]
            ::"pg_catalog"."int2"[]
        AND "head_constraint"."confkey"
          = ARRAY[1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28]
            ::"pg_catalog"."int2"[]
        AND "head_constraint"."condeferrable"
        AND "head_constraint"."condeferred"
        AND "head_constraint"."confmatchtype" = 'f'
        AND "head_constraint"."confupdtype" = 'a'
        AND "head_constraint"."confdeltype" = 'a'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "expected_indexes" AS "expected"
      LEFT JOIN "pg_catalog"."pg_class" AS "table_relation"
        ON "table_relation"."relnamespace" = "objects"."schema_oid"
        AND "table_relation"."relname" = "expected"."table_name"
      LEFT JOIN "pg_catalog"."pg_class" AS "index_relation"
        ON "index_relation"."relnamespace" = "objects"."schema_oid"
        AND "index_relation"."relname" = "expected"."index_name"
        AND "index_relation"."relkind" = 'i'
      LEFT JOIN "pg_catalog"."pg_index" AS "actual"
        ON "actual"."indexrelid" = "index_relation"."oid"
        AND "actual"."indrelid" = "table_relation"."oid"
      WHERE "actual"."indexrelid" IS NULL
        OR "index_relation"."relowner" IS DISTINCT FROM "objects"."owner_role_oid"
        OR "index_relation"."relpersistence" <> 'p'
        OR "index_relation"."relispartition"
        OR "index_relation"."reloptions" IS NOT NULL
        OR NOT EXISTS (
          SELECT 1
          FROM "pg_catalog"."pg_am" AS "index_access_method"
          WHERE "index_access_method"."oid" = "index_relation"."relam"
            AND "index_access_method"."amname" = 'btree'
        )
        OR "actual"."indisprimary" IS DISTINCT FROM "expected"."primary"
        OR "actual"."indisunique" IS DISTINCT FROM "expected"."unique_index"
        OR "actual"."indisexclusion"
        OR NOT "actual"."indimmediate"
        OR "actual"."indisclustered"
        OR "actual"."indisreplident"
        OR "actual"."indcheckxmin"
        OR "actual"."indnullsnotdistinct"
        OR "actual"."indnatts" <> "pg_catalog"."cardinality"("expected"."key_columns")
        OR "actual"."indnkeyatts" <> "pg_catalog"."cardinality"("expected"."key_columns")
        OR "actual"."indexprs" IS NOT NULL
        OR ARRAY(
          SELECT "pg_catalog"."unnest"("actual"."indkey")
        )::"pg_catalog"."int2"[] IS DISTINCT FROM "expected"."key_columns"
        OR "pg_catalog"."pg_get_expr"("actual"."indpred", "actual"."indrelid")
          IS DISTINCT FROM "expected"."predicate"
        OR "pg_catalog"."pg_get_indexdef"("index_relation"."oid")
          IS DISTINCT FROM "expected"."definition"
        OR NOT "actual"."indisvalid"
        OR NOT "actual"."indisready"
        OR NOT "actual"."indislive"
        OR "pg_catalog"."obj_description"("index_relation"."oid", 'pg_class')
          IS DISTINCT FROM
          "objects"."marker_prefix" || 'index:' || "expected"."index_name"
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_index" AS "actual"
      WHERE "actual"."indrelid" IN ("objects"."revisions_oid", "objects"."heads_oid")
    ) = 6
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_proc" AS "guard_function"
      JOIN "pg_catalog"."pg_language" AS "guard_language"
        ON "guard_language"."oid" = "guard_function"."prolang"
      WHERE "guard_function"."oid" = "objects"."guard_oid"
        AND "guard_function"."pronamespace" = "objects"."schema_oid"
        AND "guard_function"."proowner" = "objects"."owner_role_oid"
        AND NOT "guard_function"."prosecdef"
        AND NOT "guard_function"."proleakproof"
        AND NOT "guard_function"."proisstrict"
        AND NOT "guard_function"."proretset"
        AND "guard_function"."prokind" = 'f'
        AND "guard_function"."provolatile" = 'v'
        AND "guard_function"."proparallel" = 'u'
        AND "guard_function"."prorettype" = "pg_catalog"."to_regtype"('pg_catalog.trigger')
        AND "guard_function"."pronargs" = 0
        AND "guard_function"."pronargdefaults" = 0
        AND "guard_function"."proconfig"
          = ARRAY['search_path=pg_catalog']::"pg_catalog"."text"[]
        AND "guard_function"."prosrc" = (
          "pg_catalog"."chr"(10)
          || "pg_catalog"."chr"(66)
          || 'EGIN'
          || "pg_catalog"."chr"(10)
          || '  RAISE EXCEPTION USING ERRCODE = ''55000'', MESSAGE = ''OpenPencil idempotency revisions are append-only'
          || "pg_catalog"."chr"(59)
          || ' mutation and retirement require explicit approval.'''
          || "pg_catalog"."chr"(59)
          || "pg_catalog"."chr"(10)
          || 'END'
          || "pg_catalog"."chr"(10)
        )
        AND "guard_function"."probin" IS NULL
        AND "guard_function"."prosqlbody" IS NULL
        AND "guard_language"."lanname" = 'plpgsql'
        AND "pg_catalog"."obj_description"("guard_function"."oid", 'pg_proc')
          = "objects"."marker_prefix" || 'function:revision-mutation-guard'
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_proc" AS "ledger_function"
      WHERE "ledger_function"."pronamespace" = "objects"."schema_oid"
    ) = 1
    AND EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_trigger" AS "guard_trigger"
      WHERE "guard_trigger"."tgrelid" = "objects"."revisions_oid"
        AND "guard_trigger"."tgname" = 'idempotency_revisions_immutable'
        AND NOT "guard_trigger"."tgisinternal"
        AND "guard_trigger"."tgenabled" = 'O'
        AND "guard_trigger"."tgtype" = 58
        AND "guard_trigger"."tgfoid" = "objects"."guard_oid"
        AND "guard_trigger"."tgconstraint" = 0
        AND "guard_trigger"."tgconstrrelid" = 0
        AND "guard_trigger"."tgconstrindid" = 0
        AND NOT "guard_trigger"."tgdeferrable"
        AND NOT "guard_trigger"."tginitdeferred"
        AND "guard_trigger"."tgqual" IS NULL
        AND "guard_trigger"."tgnargs" = 0
        AND "pg_catalog"."octet_length"("guard_trigger"."tgargs") = 0
        AND "pg_catalog"."cardinality"(
          ARRAY(SELECT "pg_catalog"."unnest"("guard_trigger"."tgattr"))
        ) = 0
        AND "guard_trigger"."tgoldtable" IS NULL
        AND "guard_trigger"."tgnewtable" IS NULL
        AND "pg_catalog"."obj_description"("guard_trigger"."oid", 'pg_trigger')
          = "objects"."marker_prefix" || 'trigger:revision-immutability'
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_trigger" AS "ledger_trigger"
      WHERE "ledger_trigger"."tgrelid"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
    ) = 9
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_trigger" AS "ledger_trigger"
      WHERE "ledger_trigger"."tgrelid"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND "ledger_trigger"."tgisinternal"
    ) = 8
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_trigger" AS "ledger_trigger"
      WHERE "ledger_trigger"."tgrelid"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND (
          "ledger_trigger"."tgenabled" <> 'O'
          OR "ledger_trigger"."tgqual" IS NOT NULL
          OR "ledger_trigger"."tgnargs" <> 0
          OR "pg_catalog"."octet_length"("ledger_trigger"."tgargs") <> 0
          OR "pg_catalog"."cardinality"(
            ARRAY(SELECT "pg_catalog"."unnest"("ledger_trigger"."tgattr"))
          ) <> 0
          OR "ledger_trigger"."tgoldtable" IS NOT NULL
          OR "ledger_trigger"."tgnewtable" IS NOT NULL
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_inherits" AS "inheritance"
      WHERE "inheritance"."inhrelid" IN ("objects"."revisions_oid", "objects"."heads_oid")
        OR "inheritance"."inhparent" IN ("objects"."revisions_oid", "objects"."heads_oid")
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_rewrite" AS "rewrite_rule"
      WHERE "rewrite_rule"."ev_class"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_policy" AS "row_policy"
      WHERE "row_policy"."polrelid"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_publication" AS "publication"
      WHERE "publication"."puballtables"
        OR EXISTS (
          SELECT 1
          FROM "pg_catalog"."pg_publication_rel" AS "published_relation"
          WHERE "published_relation"."prpubid" = "publication"."oid"
            AND "published_relation"."prrelid"
              IN ("objects"."revisions_oid", "objects"."heads_oid")
        )
        OR EXISTS (
          SELECT 1
          FROM "pg_catalog"."pg_publication_namespace" AS "published_schema"
          WHERE "published_schema"."pnpubid" = "publication"."oid"
            AND "published_schema"."pnnspid" = "objects"."schema_oid"
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_namespace" AS "ledger_schema"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE(
          "ledger_schema"."nspacl",
          "pg_catalog"."acldefault"('n', "ledger_schema"."nspowner")
        )
      ) AS "acl"
      WHERE "ledger_schema"."oid" = "objects"."schema_oid"
        AND "acl"."grantee" <> "ledger_schema"."nspowner"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_class" AS "ledger_table"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE(
          "ledger_table"."relacl",
          "pg_catalog"."acldefault"('r', "ledger_table"."relowner")
        )
      ) AS "acl"
      WHERE "ledger_table"."oid" IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND "acl"."grantee" <> "ledger_table"."relowner"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_attribute" AS "ledger_column"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"("ledger_column"."attacl")
        AS "acl"
      WHERE "ledger_column"."attrelid"
        IN ("objects"."revisions_oid", "objects"."heads_oid")
        AND "ledger_column"."attnum" > 0
        AND NOT "ledger_column"."attisdropped"
        AND "acl"."grantee" <> "objects"."owner_role_oid"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_proc" AS "guard_function"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE(
          "guard_function"."proacl",
          "pg_catalog"."acldefault"('f', "guard_function"."proowner")
        )
      ) AS "acl"
      WHERE "guard_function"."oid" = "objects"."guard_oid"
        AND "acl"."grantee" <> "guard_function"."proowner"
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "known_api_roles"
      WHERE "known_api_roles"."role_oid" IS NOT NULL
    ) = 4
    AND NOT EXISTS (
      SELECT 1
      FROM "known_api_roles" AS "denied_role"
      WHERE "pg_catalog"."pg_has_role"(
        "denied_role"."role_oid", "objects"."owner_role_oid", 'MEMBER'
      )
        OR "pg_catalog"."has_schema_privilege"(
        "denied_role"."role_oid", "objects"."schema_oid", 'USAGE'
      )
        OR "pg_catalog"."has_schema_privilege"(
          "denied_role"."role_oid", "objects"."schema_oid", 'CREATE'
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "known_api_roles" AS "denied_role"
      CROSS JOIN (
        VALUES
          ('SELECT'::"pg_catalog"."text"),
          ('INSERT'::"pg_catalog"."text"),
          ('UPDATE'::"pg_catalog"."text"),
          ('DELETE'::"pg_catalog"."text"),
          ('TRUNCATE'::"pg_catalog"."text"),
          ('REFERENCES'::"pg_catalog"."text"),
          ('TRIGGER'::"pg_catalog"."text")
      ) AS "denied_privilege"("privilege_name")
      CROSS JOIN (
        VALUES ("objects"."revisions_oid"), ("objects"."heads_oid")
      ) AS "ledger_table"("table_oid")
      WHERE "pg_catalog"."has_table_privilege"(
        "denied_role"."role_oid",
        "ledger_table"."table_oid",
        "denied_privilege"."privilege_name"
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "known_api_roles" AS "denied_role"
      CROSS JOIN (
        VALUES
          ('SELECT'::"pg_catalog"."text"),
          ('INSERT'::"pg_catalog"."text"),
          ('UPDATE'::"pg_catalog"."text"),
          ('REFERENCES'::"pg_catalog"."text")
      ) AS "denied_privilege"("privilege_name")
      CROSS JOIN (
        SELECT "ledger_column"."attrelid", "ledger_column"."attnum"
        FROM "pg_catalog"."pg_attribute" AS "ledger_column"
        WHERE "ledger_column"."attrelid"
          IN ("objects"."revisions_oid", "objects"."heads_oid")
          AND "ledger_column"."attnum" > 0
          AND NOT "ledger_column"."attisdropped"
      ) AS "ledger_column"
      WHERE "pg_catalog"."has_column_privilege"(
        "denied_role"."role_oid",
        "ledger_column"."attrelid",
        "ledger_column"."attnum",
        "denied_privilege"."privilege_name"
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "known_api_roles" AS "denied_role"
      WHERE "pg_catalog"."has_function_privilege"(
        "denied_role"."role_oid", "objects"."guard_oid", 'EXECUTE'
      )
    )
  ), FALSE) AS "ready"
  FROM "catalog_objects" AS "objects"
),
"observed_head" AS MATERIALIZED (
  SELECT "head".*
  FROM ONLY "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads"
    AS "head"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  WHERE "input"."valid" IS TRUE
    AND "runtime"."ready" IS TRUE
    AND "catalog"."ready" IS TRUE
    AND "head"."automation_id" = "input"."automation_id"
    AND "head"."idempotency_key_digest" = "input"."idempotency_key_digest"
  LIMIT 2
),
"observed_revisions" AS MATERIALIZED (
  SELECT "revision_row".*
  FROM ONLY "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_revisions"
    AS "revision_row"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  WHERE "input"."valid" IS TRUE
    AND "runtime"."ready" IS TRUE
    AND "catalog"."ready" IS TRUE
    AND "revision_row"."automation_id" = "input"."automation_id"
    AND "revision_row"."idempotency_key_digest" = "input"."idempotency_key_digest"
  ORDER BY "revision_row"."revision"
  LIMIT 1026
),
"exact_initial_revisions" AS MATERIALIZED (
  SELECT "revision_row"."revision"
  FROM "observed_revisions" AS "revision_row"
  WHERE "revision_row"."revision" = 0
    AND "revision_row"."expected_revision" IS NULL
    AND "revision_row"."expected_head_digest" IS NULL
    AND "revision_row"."expected_event_id" IS NULL
    AND "revision_row"."expected_operation_id" IS NULL
    AND "revision_row"."expected_causation_id" IS NULL
    AND "revision_row"."expected_causation_hop" IS NULL
    AND "revision_row"."expected_attempt_id" IS NULL
    AND "revision_row"."expected_attempt_ordinal" IS NULL
    AND "revision_row"."expected_state" IS NULL
    AND "revision_row"."expected_recorded_at" IS NULL
    AND "revision_row"."expected_retention_expires_at" IS NULL
  LIMIT 2
),
"exact_predecessor_links" AS MATERIALIZED (
  SELECT "successor"."revision"
  FROM "observed_revisions" AS "successor"
  JOIN "observed_revisions" AS "predecessor"
    ON "predecessor"."revision" = "successor"."revision" - 1
   AND "successor"."expected_revision" = "predecessor"."revision"
   AND "successor"."expected_head_digest" = "predecessor"."record_digest"
   AND "successor"."expected_event_id" = "predecessor"."event_id"
   AND "successor"."expected_operation_id" = "predecessor"."operation_id"
   AND "successor"."expected_causation_id" = "predecessor"."causation_id"
   AND "successor"."expected_causation_hop" = "predecessor"."causation_hop"
   AND "successor"."expected_attempt_id" = "predecessor"."attempt_id"
   AND "successor"."expected_attempt_ordinal" = "predecessor"."attempt_ordinal"
   AND "successor"."expected_state" = "predecessor"."state"
   AND "successor"."expected_recorded_at" = "predecessor"."recorded_at"
   AND "successor"."expected_retention_expires_at"
     = "predecessor"."retention_expires_at"
  WHERE "successor"."revision" > 0
  LIMIT 1025
),
"exact_head_tips" AS MATERIALIZED (
  SELECT "head"."current_revision"
  FROM "observed_head" AS "head"
  JOIN "observed_revisions" AS "tip"
    ON "tip"."revision" = "head"."current_revision"
   AND "tip"."record_digest" = "head"."current_head_digest"
   AND "tip"."event_id" = "head"."current_event_id"
   AND "tip"."operation_id" = "head"."current_operation_id"
   AND "tip"."causation_id" = "head"."current_causation_id"
   AND "tip"."causation_hop" = "head"."current_causation_hop"
   AND "tip"."attempt_id" = "head"."current_attempt_id"
   AND "tip"."attempt_ordinal" = "head"."current_attempt_ordinal"
   AND "tip"."state" = "head"."current_state"
   AND "tip"."retry_fence" = "head"."current_retry_fence"
   AND "tip"."recorded_at" = "head"."current_recorded_at"
   AND "tip"."retention_expires_at" = "head"."retention_expires_at"
  LIMIT 2
),
"candidate_rows" AS MATERIALIZED (
  SELECT "revision_row".*
  FROM "observed_revisions" AS "revision_row"
  CROSS JOIN "input_validity" AS "input"
  WHERE "revision_row"."revision" = "input"."next_revision"
  LIMIT 2
),
"candidate_digest_matches" AS MATERIALIZED (
  SELECT "candidate"."revision"
  FROM "candidate_rows" AS "candidate"
  CROSS JOIN "input_validity" AS "input"
  WHERE "candidate"."record_digest" = "input"."record_digest"
  LIMIT 2
),
"candidate_exact_matches" AS MATERIALIZED (
  SELECT "candidate"."revision"
  FROM "candidate_rows" AS "candidate"
  CROSS JOIN "input_validity" AS "input"
  LEFT JOIN "observed_revisions" AS "predecessor"
    ON "input"."expected_revision" IS NOT NULL
   AND "predecessor"."revision" = "input"."expected_revision"
   AND "predecessor"."record_digest" = "input"."expected_head_digest"
  WHERE "candidate"."automation_id" = "input"."automation_id"
    AND "candidate"."idempotency_key_digest" = "input"."idempotency_key_digest"
    AND "candidate"."revision" = "input"."next_revision"
    AND "candidate"."expected_revision"
      IS NOT DISTINCT FROM "input"."expected_revision"
    AND "candidate"."expected_head_digest"
      IS NOT DISTINCT FROM "input"."expected_head_digest"
    AND "candidate"."record_digest" = "input"."record_digest"
    AND "candidate"."event_id" = "input"."event_id"
    AND "candidate"."operation_id" = "input"."operation_id"
    AND "candidate"."causation_id" = "input"."causation_id"
    AND "candidate"."causation_hop" = "input"."causation_hop"
    AND "candidate"."attempt_id" = "input"."current_attempt_id"
    AND "candidate"."attempt_ordinal" = "input"."attempt_ordinal"
    AND "candidate"."state" = "input"."state"
    AND "candidate"."retry_fence" = "input"."retry_fence"
    AND "candidate"."completion_evidence_digest"
      IS NOT DISTINCT FROM "input"."completion_evidence_digest"
    AND "candidate"."known_not_dispatched_evidence_digest"
      IS NOT DISTINCT FROM "input"."known_not_dispatched_evidence_digest"
    AND "candidate"."reconciliation_evidence_digest"
      IS NOT DISTINCT FROM "input"."reconciliation_evidence_digest"
    AND "candidate"."recorded_at" = "input"."recorded_at"
    AND "candidate"."retention_expires_at" = "input"."expires_at"
    AND (
      (
        "input"."expected_revision" IS NULL
        AND "candidate"."expected_event_id" IS NULL
        AND "candidate"."expected_operation_id" IS NULL
        AND "candidate"."expected_causation_id" IS NULL
        AND "candidate"."expected_causation_hop" IS NULL
        AND "candidate"."expected_attempt_id" IS NULL
        AND "candidate"."expected_attempt_ordinal" IS NULL
        AND "candidate"."expected_state" IS NULL
        AND "candidate"."expected_recorded_at" IS NULL
        AND "candidate"."expected_retention_expires_at" IS NULL
      )
      OR (
        "input"."expected_revision" IS NOT NULL
        AND "predecessor"."revision" = "input"."expected_revision"
        AND "predecessor"."record_digest" = "input"."expected_head_digest"
        AND "candidate"."expected_event_id" = "predecessor"."event_id"
        AND "candidate"."expected_operation_id" = "predecessor"."operation_id"
        AND "candidate"."expected_causation_id" = "predecessor"."causation_id"
        AND "candidate"."expected_causation_hop" = "predecessor"."causation_hop"
        AND "candidate"."expected_attempt_id" = "predecessor"."attempt_id"
        AND "candidate"."expected_attempt_ordinal" = "predecessor"."attempt_ordinal"
        AND "candidate"."expected_state" = "predecessor"."state"
        AND "candidate"."expected_recorded_at" = "predecessor"."recorded_at"
        AND "candidate"."expected_retention_expires_at"
          = "predecessor"."retention_expires_at"
      )
    )
  LIMIT 2
),
"expected_head_matches" AS MATERIALIZED (
  SELECT "head"."current_revision"
  FROM "observed_head" AS "head"
  CROSS JOIN "input_validity" AS "input"
  JOIN "observed_revisions" AS "predecessor"
    ON "input"."expected_revision" IS NOT NULL
   AND "predecessor"."revision" = "input"."expected_revision"
   AND "predecessor"."record_digest" = "input"."expected_head_digest"
   AND "head"."current_revision" = "predecessor"."revision"
   AND "head"."current_head_digest" = "predecessor"."record_digest"
   AND "head"."current_event_id" = "predecessor"."event_id"
   AND "head"."current_operation_id" = "predecessor"."operation_id"
   AND "head"."current_causation_id" = "predecessor"."causation_id"
   AND "head"."current_causation_hop" = "predecessor"."causation_hop"
   AND "head"."current_attempt_id" = "predecessor"."attempt_id"
   AND "head"."current_attempt_ordinal" = "predecessor"."attempt_ordinal"
   AND "head"."current_state" = "predecessor"."state"
   AND "head"."current_retry_fence" = "predecessor"."retry_fence"
   AND "head"."current_recorded_at" = "predecessor"."recorded_at"
   AND "head"."retention_expires_at" = "predecessor"."retention_expires_at"
  LIMIT 2
),
"facts" AS MATERIALIZED (
  SELECT
    "input"."proposal_digest",
    "input"."record_digest",
    "input"."next_revision"::"pg_catalog"."int4" AS "next_revision",
    "input"."expected_revision"::"pg_catalog"."int4" AS "expected_revision",
    "input"."valid" AS "input_valid",
    "runtime"."ready" AS "runtime_ready",
    "catalog"."ready" AS "full_ledger_shape_verified",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "observed_head") AS "head_count",
    CASE
      WHEN (SELECT "pg_catalog"."count"(*) FROM "observed_head") = 1
        THEN (SELECT "pg_catalog"."max"("current_revision")::"pg_catalog"."int4"
          FROM "observed_head")
      ELSE NULL
    END AS "head_revision",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "observed_revisions") AS "revision_count",
    (SELECT "pg_catalog"."min"("revision")::"pg_catalog"."int4"
      FROM "observed_revisions") AS "revision_minimum",
    (SELECT "pg_catalog"."max"("revision")::"pg_catalog"."int4"
      FROM "observed_revisions") AS "revision_maximum",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "exact_initial_revisions") AS "exact_initial_revision_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "exact_predecessor_links") AS "exact_predecessor_link_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "exact_head_tips") AS "exact_head_tip_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "candidate_rows") AS "candidate_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "candidate_digest_matches") AS "candidate_digest_match_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "candidate_exact_matches") AS "candidate_exact_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "expected_head_matches") AS "expected_head_match_count",
    "pg_catalog"."current_setting"('transaction_read_only')::"pg_catalog"."bool"
      AS "transaction_read_only",
    NOT "pg_catalog"."pg_is_in_recovery"() AS "database_primary",
    (
      "pg_catalog"."current_setting"('session_replication_role') = 'origin'
    ) AS "session_replication_role_origin",
    CASE
      WHEN "catalog"."ready" IS TRUE THEN
        "pg_catalog"."translate"(
          "pg_catalog"."rtrim"(
            "pg_catalog"."encode"(
              "pg_catalog"."sha256"(
                "pg_catalog"."convert_to"(
                  "pg_catalog"."obj_description"(
                    "objects"."schema_oid", 'pg_namespace'
                  ),
                  'UTF8'
                )
              ),
              'base64'
            ),
            '='
          ),
          '+/',
          '-_'
        )
      ELSE NULL
    END::"pg_catalog"."text" AS "schema_marker_digest"
  FROM "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "catalog_objects" AS "objects"
),
"truth" AS MATERIALIZED (
  SELECT
    "facts".*,
    (
      (
        "facts"."head_count" = 0
        AND "facts"."head_revision" IS NULL
        AND "facts"."revision_count" = 0
        AND "facts"."revision_minimum" IS NULL
        AND "facts"."revision_maximum" IS NULL
        AND "facts"."exact_initial_revision_count" = 0
        AND "facts"."exact_predecessor_link_count" = 0
        AND "facts"."exact_head_tip_count" = 0
      )
      OR (
        "facts"."head_count" = 1
        AND "facts"."head_revision" BETWEEN 0 AND 1024
        AND "facts"."revision_count" = "facts"."head_revision" + 1
        AND "facts"."revision_minimum" = 0
        AND "facts"."revision_maximum" = "facts"."head_revision"
        AND "facts"."exact_initial_revision_count" = 1
        AND "facts"."exact_predecessor_link_count" = "facts"."head_revision"
        AND "facts"."exact_head_tip_count" = 1
      )
    ) AS "ledger_healthy"
  FROM "facts"
),
"classification" AS MATERIALIZED (
  SELECT CASE
    WHEN "truth"."input_valid" IS NOT TRUE
      OR "truth"."runtime_ready" IS NOT TRUE
      OR "truth"."full_ledger_shape_verified" IS NOT TRUE
      THEN 'precondition-failed'
    WHEN "truth"."ledger_healthy" IS NOT TRUE
      OR "truth"."head_count" = 2
      OR "truth"."revision_count" = 1026
      OR "truth"."exact_initial_revision_count" = 2
      OR "truth"."exact_predecessor_link_count" = 1025
      OR "truth"."exact_head_tip_count" = 2
      OR "truth"."candidate_count" = 2
      OR "truth"."candidate_digest_match_count" = 2
      OR "truth"."candidate_exact_count" = 2
      OR "truth"."expected_head_match_count" = 2
      THEN 'corruption'
    WHEN "truth"."candidate_count" = 1
      AND "truth"."candidate_digest_match_count" = 1
      AND "truth"."candidate_exact_count" = 0
      THEN 'corruption'
    WHEN "truth"."candidate_count" = 1
      AND "truth"."candidate_digest_match_count" = 0
      THEN 'cas-conflict'
    WHEN "truth"."candidate_count" = 1
      AND "truth"."candidate_digest_match_count" = 1
      AND "truth"."candidate_exact_count" = 1
      AND "truth"."head_revision" = "truth"."next_revision"
      THEN 'exact-replay'
    WHEN "truth"."candidate_count" = 1
      AND "truth"."candidate_digest_match_count" = 1
      AND "truth"."candidate_exact_count" = 1
      AND "truth"."head_revision" > "truth"."next_revision"
      THEN 'advanced-head'
    WHEN "truth"."candidate_count" = 0
      AND "truth"."head_count" = 0
      AND "truth"."revision_count" = 0
      AND "truth"."expected_revision" IS NULL
      AND "truth"."next_revision" = 0
      THEN 'absent'
    WHEN "truth"."candidate_count" = 0
      AND "truth"."head_count" = 1
      AND "truth"."expected_revision" IS NOT NULL
      AND "truth"."head_revision" = "truth"."expected_revision"
      AND "truth"."expected_head_match_count" = 1
      THEN 'absent'
    ELSE 'cas-conflict'
  END::"pg_catalog"."text" AS "reported_status"
  FROM "truth"
)
SELECT
  "pg_catalog"."jsonb_build_object"(
    'queryVersion',
    'openpencil-supabase-automation-idempotency-cas-reconciliation-v1',
    'proposalDigest', "truth"."proposal_digest",
    'recordDigest', "truth"."record_digest",
    'reportedStatus', "classification"."reported_status",
    'inputValid', "truth"."input_valid",
    'runtimeReady', "truth"."runtime_ready",
    'fullLedgerShapeVerified', "truth"."full_ledger_shape_verified",
    'headCount', "truth"."head_count",
    'headRevision', "truth"."head_revision",
    'revisionCount', "truth"."revision_count",
    'revisionMinimum', "truth"."revision_minimum",
    'revisionMaximum', "truth"."revision_maximum",
    'exactInitialRevisionCount', "truth"."exact_initial_revision_count",
    'exactPredecessorLinkCount', "truth"."exact_predecessor_link_count",
    'exactHeadTipCount', "truth"."exact_head_tip_count",
    'candidateCount', "truth"."candidate_count",
    'candidateDigestMatchCount', "truth"."candidate_digest_match_count",
    'candidateExactCount', "truth"."candidate_exact_count",
    'expectedHeadMatchCount', "truth"."expected_head_match_count",
    'transactionReadOnly', "truth"."transaction_read_only",
    'databasePrimary', "truth"."database_primary",
    'sessionReplicationRoleOrigin', "truth"."session_replication_role_origin",
    'schemaMarkerDigest', "truth"."schema_marker_digest",
    'serverVersionNum',
    "pg_catalog"."current_setting"('server_version_num'),
    'snapshotDigest',
    "pg_catalog"."translate"(
      "pg_catalog"."rtrim"(
        "pg_catalog"."encode"(
          "pg_catalog"."sha256"(
            "pg_catalog"."convert_to"(
              "pg_catalog"."txid_current_snapshot"()::"pg_catalog"."text",
              'UTF8'
            )
          ),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    ),
    'observedAt',
    "pg_catalog"."to_char"(
      "pg_catalog"."statement_timestamp"() AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  )::"pg_catalog"."text" AS "observation"
FROM "truth"
CROSS JOIN "classification";
