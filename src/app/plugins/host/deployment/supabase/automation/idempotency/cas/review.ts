/* oxlint-disable eslint(max-lines), eslint(complexity) -- The fixed CAS SQL, strict snapshot boundary, and review metadata form one audit unit. */

import {
  canonicalBackendAutomationIdempotencyCASProposalBytes,
  canonicalBackendAutomationIdempotencyRecordBytes,
  digestBackendAutomationIdempotencyCASProposal,
  digestBackendAutomationIdempotencyRecord,
  parseBackendAutomationIdempotencyRecord,
  verifyBackendAutomationIdempotencyCASProposal,
  type BackendAutomationIdempotencyCASCandidateV1,
  type BackendAutomationIdempotencyRecordV1
} from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_REVIEW_FORMAT =
  'openpencil.supabase-automation-idempotency-cas-review.v1' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_ID =
  'supabase-automation-idempotency-cas' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_VERSION =
  'openpencil-supabase-automation-idempotency-cas-v1' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_ARTIFACT_PATH =
  'backend/supabase-v2/automation/idempotency-cas-review.sql' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_STATEMENT_COUNT = 1 as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL =
  '__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__' as const
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL_COUNT = 19 as const

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER = Object.freeze([
  'proposalDigest',
  'canonicalProposalBase64',
  'recordDigest',
  'canonicalRecordBase64',
  'automationId',
  'eventId',
  'operationId',
  'idempotencyKeyDigest',
  'causationId',
  'causationHop',
  'retentionHours',
  'createdAt',
  'expiresAt',
  'recordedAt',
  'nextRevision',
  'expectedRevision',
  'expectedHeadDigest',
  'previousRecordDigest',
  'attemptIds',
  'currentAttemptId',
  'state',
  'completionEvidenceDigest',
  'knownNotDispatchedEvidenceDigest',
  'reconciliationEvidenceDigest',
  'hostEvidenceAuthenticated',
  'persistenceAuthorityGranted',
  'dispatchAuthorityGranted'
] as const)

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES = Object.freeze([
  'inserted',
  'advanced-head',
  'exact-replay',
  'cas-conflict',
  'corruption',
  'precondition-failed'
] as const)

type ParameterName = (typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER)[number]
type ParameterValue = string | number | false | null | readonly string[]

export interface SupabaseAutomationIdempotencyCASParameterV1 {
  readonly position: number
  readonly name: ParameterName
  readonly pgType: 'text' | 'bigint' | 'integer' | 'text[]' | 'boolean'
  readonly nullable: boolean
  readonly encoding:
    | 'sha256-base64url'
    | 'standard-base64'
    | 'identifier'
    | 'integer'
    | 'rfc3339-millis'
    | 'identifier-array'
    | 'state'
    | 'fixed-false'
}

const PARAMETER_DETAILS = Object.freeze({
  proposalDigest: ['text', false, 'sha256-base64url'],
  canonicalProposalBase64: ['text', false, 'standard-base64'],
  recordDigest: ['text', false, 'sha256-base64url'],
  canonicalRecordBase64: ['text', false, 'standard-base64'],
  automationId: ['text', false, 'identifier'],
  eventId: ['text', false, 'identifier'],
  operationId: ['text', false, 'identifier'],
  idempotencyKeyDigest: ['text', false, 'sha256-base64url'],
  causationId: ['text', false, 'identifier'],
  causationHop: ['integer', false, 'integer'],
  retentionHours: ['integer', false, 'integer'],
  createdAt: ['text', false, 'rfc3339-millis'],
  expiresAt: ['text', false, 'rfc3339-millis'],
  recordedAt: ['text', false, 'rfc3339-millis'],
  nextRevision: ['bigint', false, 'integer'],
  expectedRevision: ['bigint', true, 'integer'],
  expectedHeadDigest: ['text', true, 'sha256-base64url'],
  previousRecordDigest: ['text', true, 'sha256-base64url'],
  attemptIds: ['text[]', false, 'identifier-array'],
  currentAttemptId: ['text', false, 'identifier'],
  state: ['text', false, 'state'],
  completionEvidenceDigest: ['text', true, 'sha256-base64url'],
  knownNotDispatchedEvidenceDigest: ['text', true, 'sha256-base64url'],
  reconciliationEvidenceDigest: ['text', true, 'sha256-base64url'],
  hostEvidenceAuthenticated: ['boolean', false, 'fixed-false'],
  persistenceAuthorityGranted: ['boolean', false, 'fixed-false'],
  dispatchAuthorityGranted: ['boolean', false, 'fixed-false']
} as const satisfies Record<
  ParameterName,
  readonly [
    SupabaseAutomationIdempotencyCASParameterV1['pgType'],
    boolean,
    SupabaseAutomationIdempotencyCASParameterV1['encoding']
  ]
>)

export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA = Object.freeze(
  SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER.map((name, index) => {
    const [pgType, nullable, encoding] = PARAMETER_DETAILS[name]
    return Object.freeze({ position: index + 1, name, pgType, nullable, encoding })
  })
)

/** Fixed review template. Only the strict application schema token is rendered. */
export const SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE = `-- OpenPencil Supabase Backend Automation idempotency CAS statement review v1.
-- REVIEW ONLY: no credential, transport, transaction, timeout, or execution authority is created.
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
    "pg_catalog"."current_setting"('transaction_isolation') = 'serializable'
    AND "pg_catalog"."current_setting"('transaction_read_only') = 'off'
    AND "pg_catalog"."current_setting"('row_security') = 'off'
    AND "pg_catalog"."current_setting"('search_path') = 'pg_catalog'
    AND "pg_catalog"."current_setting"('session_replication_role') = 'origin'
    AND "pg_catalog"."current_setting"('synchronous_commit') = 'on'
    AND "pg_catalog"."current_setting"('server_encoding') = 'UTF8'
    AND CURRENT_USER = SESSION_USER
    AND NOT "pg_catalog"."pg_is_in_recovery"()
    AND "pg_catalog"."current_setting"('statement_timeout')
      ::"pg_catalog"."interval" > '0 seconds'::"pg_catalog"."interval"
    AND "pg_catalog"."current_setting"('statement_timeout')
      ::"pg_catalog"."interval" <= '15 seconds'::"pg_catalog"."interval"
    AND "pg_catalog"."current_setting"('lock_timeout')
      ::"pg_catalog"."interval" > '0 seconds'::"pg_catalog"."interval"
    AND "pg_catalog"."current_setting"('lock_timeout')
      ::"pg_catalog"."interval" <= '5 seconds'::"pg_catalog"."interval"
  ), FALSE) AS "ready"
),
"catalog_guard" AS MATERIALIZED (
  SELECT COALESCE((
    "objects"."schema_name" ~ '^op_automation_[a-z0-9_-]{20}$'
    AND "objects"."schema_oid" IS NOT NULL
    AND "objects"."revisions_oid" IS NOT NULL
    AND "objects"."heads_oid" IS NOT NULL
    AND "objects"."guard_oid" IS NOT NULL
    AND "objects"."current_role_oid" IS NOT NULL
    AND "objects"."current_role_oid" = "objects"."session_role_oid"
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
        AND "ledger_schema"."nspowner" = "objects"."current_role_oid"
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
        AND "ledger_table"."relowner" = "objects"."current_role_oid"
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
        OR "index_relation"."relowner" IS DISTINCT FROM "objects"."current_role_oid"
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
        AND "guard_function"."proowner" = "objects"."current_role_oid"
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
        AND "acl"."grantee" <> "objects"."current_role_oid"
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
        "denied_role"."role_oid", "objects"."current_role_oid", 'MEMBER'
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
"locked_head" AS MATERIALIZED (
  SELECT "head".*
  FROM "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads" AS "head"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  WHERE "input"."valid" IS TRUE
    AND "runtime"."ready" IS TRUE
    AND "catalog"."ready" IS TRUE
    AND "head"."automation_id" = "input"."automation_id"
    AND "head"."idempotency_key_digest" = "input"."idempotency_key_digest"
  FOR UPDATE OF "head" NOWAIT
),
"head_lock_barrier" AS MATERIALIZED (
  SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" AS "head_count"
  FROM "locked_head"
),
"locked_revisions" AS MATERIALIZED (
  SELECT "revision_row".*
  FROM "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_revisions"
    AS "revision_row"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "head_lock_barrier"
  WHERE "input"."valid" IS TRUE
    AND "runtime"."ready" IS TRUE
    AND "catalog"."ready" IS TRUE
    AND "revision_row"."automation_id" = "input"."automation_id"
    AND "revision_row"."idempotency_key_digest" = "input"."idempotency_key_digest"
  ORDER BY
    "revision_row"."automation_id",
    "revision_row"."idempotency_key_digest",
    "revision_row"."revision"
  FOR SHARE OF "revision_row" NOWAIT
),
"revision_lock_barrier" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"(*)::"pg_catalog"."int8" AS "revision_count",
    "pg_catalog"."min"("revision") AS "minimum_revision",
    "pg_catalog"."max"("revision") AS "maximum_revision"
  FROM "locked_revisions"
),
"chain_health" AS MATERIALIZED (
  SELECT
    "head_barrier"."head_count",
    "revision_barrier"."revision_count",
    (
      "head_barrier"."head_count" BETWEEN 0 AND 1
      AND COALESCE(
        "pg_catalog"."bool_and"(
          (
            "revision_row"."revision" = 0
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
          )
          OR (
            "revision_row"."revision" > 0
            AND EXISTS (
              SELECT 1
              FROM "locked_revisions" AS "previous"
              WHERE "previous"."revision" = "revision_row"."revision" - 1
                AND "revision_row"."expected_revision" = "previous"."revision"
                AND "revision_row"."expected_head_digest" = "previous"."record_digest"
                AND "revision_row"."expected_event_id" = "previous"."event_id"
                AND "revision_row"."expected_operation_id" = "previous"."operation_id"
                AND "revision_row"."expected_causation_id" = "previous"."causation_id"
                AND "revision_row"."expected_causation_hop" = "previous"."causation_hop"
                AND "revision_row"."expected_attempt_id" = "previous"."attempt_id"
                AND "revision_row"."expected_attempt_ordinal" = "previous"."attempt_ordinal"
                AND "revision_row"."expected_state" = "previous"."state"
                AND "revision_row"."expected_recorded_at" = "previous"."recorded_at"
                AND "revision_row"."expected_retention_expires_at"
                  = "previous"."retention_expires_at"
            )
          )
        ),
        TRUE
      )
      AND (
        (
          "head_barrier"."head_count" = 0
          AND "revision_barrier"."revision_count" = 0
          AND "revision_barrier"."minimum_revision" IS NULL
          AND "revision_barrier"."maximum_revision" IS NULL
        )
        OR (
          "head_barrier"."head_count" = 1
          AND EXISTS (
            SELECT 1
            FROM "locked_head" AS "head"
            JOIN "locked_revisions" AS "current_revision"
              ON "current_revision"."revision" = "head"."current_revision"
            WHERE "revision_barrier"."minimum_revision" = 0
              AND "revision_barrier"."maximum_revision" = "head"."current_revision"
              AND "revision_barrier"."revision_count" = "head"."current_revision" + 1
              AND "current_revision"."automation_id" = "head"."automation_id"
              AND "current_revision"."idempotency_key_digest"
                = "head"."idempotency_key_digest"
              AND "current_revision"."record_digest" = "head"."current_head_digest"
              AND "current_revision"."event_id" = "head"."current_event_id"
              AND "current_revision"."operation_id" = "head"."current_operation_id"
              AND "current_revision"."causation_id" = "head"."current_causation_id"
              AND "current_revision"."causation_hop" = "head"."current_causation_hop"
              AND "current_revision"."attempt_id" = "head"."current_attempt_id"
              AND "current_revision"."attempt_ordinal" = "head"."current_attempt_ordinal"
              AND "current_revision"."state" = "head"."current_state"
              AND "current_revision"."retry_fence" = "head"."current_retry_fence"
              AND "current_revision"."recorded_at" = "head"."current_recorded_at"
              AND "current_revision"."retention_expires_at" = "head"."retention_expires_at"
          )
        )
      )
    ) AS "healthy"
  FROM "head_lock_barrier" AS "head_barrier"
  CROSS JOIN "revision_lock_barrier" AS "revision_barrier"
  LEFT JOIN "locked_revisions" AS "revision_row" ON TRUE
  GROUP BY
    "head_barrier"."head_count",
    "revision_barrier"."revision_count",
    "revision_barrier"."minimum_revision",
    "revision_barrier"."maximum_revision"
),
"candidate_snapshot" AS MATERIALIZED (
  SELECT "revision_row".*
  FROM "locked_revisions" AS "revision_row"
  CROSS JOIN "input_validity" AS "input"
  WHERE "revision_row"."revision" = "input"."next_revision"
),
"previous_snapshot" AS MATERIALIZED (
  SELECT "revision_row".*
  FROM "locked_revisions" AS "revision_row"
  CROSS JOIN "input_validity" AS "input"
  WHERE "input"."expected_revision" IS NOT NULL
    AND "revision_row"."revision" = "input"."expected_revision"
    AND "revision_row"."record_digest" = "input"."expected_head_digest"
),
"candidate_comparison" AS MATERIALIZED (
  SELECT
    "pg_catalog"."count"("candidate"."revision")::"pg_catalog"."int4"
      AS "candidate_count",
    COALESCE(
      "pg_catalog"."bool_and"(
        "candidate"."record_digest" = "input"."record_digest"
      ),
      FALSE
    ) AS "candidate_digest_match",
    COALESCE(
      "pg_catalog"."bool_and"(
        "candidate"."automation_id" = "input"."automation_id"
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
            AND "previous"."revision" = "input"."expected_revision"
            AND "previous"."record_digest" = "input"."expected_head_digest"
            AND "candidate"."expected_event_id" = "previous"."event_id"
            AND "candidate"."expected_operation_id" = "previous"."operation_id"
            AND "candidate"."expected_causation_id" = "previous"."causation_id"
            AND "candidate"."expected_causation_hop" = "previous"."causation_hop"
            AND "candidate"."expected_attempt_id" = "previous"."attempt_id"
            AND "candidate"."expected_attempt_ordinal" = "previous"."attempt_ordinal"
            AND "candidate"."expected_state" = "previous"."state"
            AND "candidate"."expected_recorded_at" = "previous"."recorded_at"
            AND "candidate"."expected_retention_expires_at"
              = "previous"."retention_expires_at"
          )
        )
      ),
      FALSE
    ) AS "candidate_exact"
  FROM "input_validity" AS "input"
  LEFT JOIN "candidate_snapshot" AS "candidate" ON TRUE
  LEFT JOIN "previous_snapshot" AS "previous" ON TRUE
),
"pre_state" AS MATERIALIZED (
  SELECT
    CASE
      WHEN "input"."valid" IS NOT TRUE
        OR "runtime"."ready" IS NOT TRUE
        OR "catalog"."ready" IS NOT TRUE
        THEN 'precondition-failed'
      WHEN "health"."healthy" IS NOT TRUE
        THEN 'corruption'
      WHEN "comparison"."candidate_count" > 1
        THEN 'corruption'
      WHEN "comparison"."candidate_count" = 1
        AND "comparison"."candidate_digest_match" IS TRUE
        AND "comparison"."candidate_exact" IS NOT TRUE
        THEN 'corruption'
      WHEN "comparison"."candidate_count" = 1
        AND "comparison"."candidate_digest_match" IS NOT TRUE
        THEN 'cas-conflict'
      WHEN "comparison"."candidate_count" = 1
        AND "comparison"."candidate_exact" IS TRUE
        AND "head"."current_revision" = "input"."next_revision"
        THEN 'exact-replay'
      WHEN "comparison"."candidate_count" = 1
        AND "comparison"."candidate_exact" IS TRUE
        AND "head"."current_revision" > "input"."next_revision"
        THEN 'advanced-head'
      WHEN "health"."head_count" = 0
        AND "health"."revision_count" = 0
        AND "comparison"."candidate_count" = 0
        AND "input"."expected_revision" IS NULL
        AND "input"."expected_head_digest" IS NULL
        AND "input"."next_revision" = 0
        THEN 'write-initial'
      WHEN "health"."head_count" = 1
        AND "comparison"."candidate_count" = 0
        AND "head"."current_revision" = "input"."expected_revision"
        AND "head"."current_head_digest" = "input"."expected_head_digest"
        THEN 'write-successor'
      ELSE 'cas-conflict'
    END::"pg_catalog"."text" AS "state"
  FROM "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "chain_health" AS "health"
  CROSS JOIN "candidate_comparison" AS "comparison"
  LEFT JOIN "locked_head" AS "head" ON TRUE
),
"inserted_revision" AS (
  INSERT INTO
    "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_revisions" (
      "automation_id",
      "idempotency_key_digest",
      "revision",
      "expected_revision",
      "expected_head_digest",
      "expected_event_id",
      "expected_operation_id",
      "expected_causation_id",
      "expected_causation_hop",
      "expected_attempt_id",
      "expected_attempt_ordinal",
      "expected_state",
      "expected_recorded_at",
      "expected_retention_expires_at",
      "record_digest",
      "event_id",
      "operation_id",
      "causation_id",
      "causation_hop",
      "attempt_id",
      "attempt_ordinal",
      "state",
      "retry_fence",
      "completion_evidence_digest",
      "known_not_dispatched_evidence_digest",
      "reconciliation_evidence_digest",
      "recorded_at",
      "retention_expires_at"
    )
  SELECT
    "input"."automation_id",
    "input"."idempotency_key_digest",
    "input"."next_revision",
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_revision" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_head_digest" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_event_id" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_operation_id" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_causation_id" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_causation_hop" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_attempt_id" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_attempt_ordinal" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_state" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."current_recorded_at" ELSE NULL END,
    CASE WHEN "pre_state"."state" = 'write-successor'
      THEN "head"."retention_expires_at" ELSE NULL END,
    "input"."record_digest",
    "input"."event_id",
    "input"."operation_id",
    "input"."causation_id",
    "input"."causation_hop",
    "input"."current_attempt_id",
    "input"."attempt_ordinal",
    "input"."state",
    "input"."retry_fence",
    "input"."completion_evidence_digest",
    "input"."known_not_dispatched_evidence_digest",
    "input"."reconciliation_evidence_digest",
    "input"."recorded_at",
    "input"."expires_at"
  FROM "input_validity" AS "input"
  CROSS JOIN "pre_state"
  LEFT JOIN "locked_head" AS "head" ON TRUE
  WHERE "pre_state"."state" IN ('write-initial', 'write-successor')
  ON CONFLICT DO NOTHING
  RETURNING *
),
"inserted_head" AS (
  INSERT INTO
    "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads" (
      "automation_id",
      "idempotency_key_digest",
      "current_revision",
      "current_head_digest",
      "current_event_id",
      "current_operation_id",
      "current_causation_id",
      "current_causation_hop",
      "current_attempt_id",
      "current_attempt_ordinal",
      "current_state",
      "current_retry_fence",
      "current_recorded_at",
      "retention_expires_at"
    )
  SELECT
    "revision_row"."automation_id",
    "revision_row"."idempotency_key_digest",
    "revision_row"."revision",
    "revision_row"."record_digest",
    "revision_row"."event_id",
    "revision_row"."operation_id",
    "revision_row"."causation_id",
    "revision_row"."causation_hop",
    "revision_row"."attempt_id",
    "revision_row"."attempt_ordinal",
    "revision_row"."state",
    "revision_row"."retry_fence",
    "revision_row"."recorded_at",
    "revision_row"."retention_expires_at"
  FROM "inserted_revision" AS "revision_row"
  CROSS JOIN "pre_state"
  WHERE "pre_state"."state" = 'write-initial'
  ON CONFLICT DO NOTHING
  RETURNING *
),
"updated_head" AS (
  UPDATE
    "__OPENPENCIL_AUTOMATION_IDEMPOTENCY_SCHEMA__"."idempotency_heads" AS "head"
  SET
    "current_revision" = "revision_row"."revision",
    "current_head_digest" = "revision_row"."record_digest",
    "current_event_id" = "revision_row"."event_id",
    "current_operation_id" = "revision_row"."operation_id",
    "current_causation_id" = "revision_row"."causation_id",
    "current_causation_hop" = "revision_row"."causation_hop",
    "current_attempt_id" = "revision_row"."attempt_id",
    "current_attempt_ordinal" = "revision_row"."attempt_ordinal",
    "current_state" = "revision_row"."state",
    "current_retry_fence" = "revision_row"."retry_fence",
    "current_recorded_at" = "revision_row"."recorded_at",
    "retention_expires_at" = "revision_row"."retention_expires_at"
  FROM
    "inserted_revision" AS "revision_row",
    "input_validity" AS "input",
    "pre_state",
    "locked_head" AS "expected_head"
  WHERE "pre_state"."state" = 'write-successor'
    AND "head"."automation_id" = "input"."automation_id"
    AND "head"."idempotency_key_digest" = "input"."idempotency_key_digest"
    AND "expected_head"."automation_id" = "input"."automation_id"
    AND "expected_head"."idempotency_key_digest" = "input"."idempotency_key_digest"
    AND "head"."automation_id" IS NOT DISTINCT FROM "expected_head"."automation_id"
    AND "head"."idempotency_key_digest"
      IS NOT DISTINCT FROM "expected_head"."idempotency_key_digest"
    AND "head"."current_revision"
      IS NOT DISTINCT FROM "expected_head"."current_revision"
    AND "head"."current_head_digest"
      IS NOT DISTINCT FROM "expected_head"."current_head_digest"
    AND "head"."current_event_id"
      IS NOT DISTINCT FROM "expected_head"."current_event_id"
    AND "head"."current_operation_id"
      IS NOT DISTINCT FROM "expected_head"."current_operation_id"
    AND "head"."current_causation_id"
      IS NOT DISTINCT FROM "expected_head"."current_causation_id"
    AND "head"."current_causation_hop"
      IS NOT DISTINCT FROM "expected_head"."current_causation_hop"
    AND "head"."current_attempt_id"
      IS NOT DISTINCT FROM "expected_head"."current_attempt_id"
    AND "head"."current_attempt_ordinal"
      IS NOT DISTINCT FROM "expected_head"."current_attempt_ordinal"
    AND "head"."current_state"
      IS NOT DISTINCT FROM "expected_head"."current_state"
    AND "head"."current_retry_fence"
      IS NOT DISTINCT FROM "expected_head"."current_retry_fence"
    AND "head"."current_recorded_at"
      IS NOT DISTINCT FROM "expected_head"."current_recorded_at"
    AND "head"."retention_expires_at"
      IS NOT DISTINCT FROM "expected_head"."retention_expires_at"
    AND "expected_head"."current_revision" = "input"."expected_revision"
    AND "expected_head"."current_head_digest" = "input"."expected_head_digest"
  RETURNING "head".*
),
"effects" AS MATERIALIZED (
  SELECT
    (SELECT "pg_catalog"."count"(*) FROM "inserted_revision")::"pg_catalog"."int4"
      AS "revision_count",
    (SELECT "pg_catalog"."count"(*) FROM "inserted_head")::"pg_catalog"."int4"
      AS "head_insert_count",
    (SELECT "pg_catalog"."count"(*) FROM "updated_head")::"pg_catalog"."int4"
      AS "head_update_count"
),
"final_state" AS MATERIALIZED (
  SELECT
    CASE
      WHEN "pre_state"."state" = 'write-initial'
        AND "effects"."revision_count" = 1
        AND "effects"."head_insert_count" = 1
        AND "effects"."head_update_count" = 0
        THEN 'inserted'
      WHEN "pre_state"."state" = 'write-successor'
        AND "effects"."revision_count" = 1
        AND "effects"."head_insert_count" = 0
        AND "effects"."head_update_count" = 1
        THEN 'advanced-head'
      WHEN "pre_state"."state" IN ('write-initial', 'write-successor')
        AND "effects"."revision_count" = 0
        AND "effects"."head_insert_count" = 0
        AND "effects"."head_update_count" = 0
        THEN 'cas-conflict'
      ELSE "pre_state"."state"
    END::"pg_catalog"."text" AS "status"
  FROM "pre_state"
  CROSS JOIN "effects"
)
SELECT "final_state"."status"
FROM "final_state"
CROSS JOIN "pre_state"
CROSS JOIN "effects"
WHERE 1 / CASE
  WHEN "pre_state"."state" = 'write-initial'
    AND (
      (
        "effects"."revision_count" = 1
        AND "effects"."head_insert_count" = 1
        AND "effects"."head_update_count" = 0
      )
      OR (
        "effects"."revision_count" = 0
        AND "effects"."head_insert_count" = 0
        AND "effects"."head_update_count" = 0
      )
    )
    THEN 1
  WHEN "pre_state"."state" = 'write-successor'
    AND (
      (
        "effects"."revision_count" = 1
        AND "effects"."head_insert_count" = 0
        AND "effects"."head_update_count" = 1
      )
      OR (
        "effects"."revision_count" = 0
        AND "effects"."head_insert_count" = 0
        AND "effects"."head_update_count" = 0
      )
    )
    THEN 1
  WHEN "pre_state"."state" IN (
    'exact-replay',
    'advanced-head',
    'cas-conflict',
    'corruption',
    'precondition-failed'
  )
    AND "effects"."revision_count" = 0
    AND "effects"."head_insert_count" = 0
    AND "effects"."head_update_count" = 0
    THEN 1
  ELSE 0
END = 1;
`

export interface CreateSupabaseAutomationIdempotencyCASReviewForTestingOptionsV1 {
  readonly applicationObjectKey: string
  readonly candidate: BackendAutomationIdempotencyCASCandidateV1
  readonly currentRecord: BackendAutomationIdempotencyRecordV1 | null
}

export interface SupabaseAutomationIdempotencyCASReviewEnvelopeV1 {
  readonly review: SupabaseAutomationIdempotencyCASReviewV1
  readonly reviewDigest: string
  readonly previewSql: string
}

export interface SupabaseAutomationIdempotencyCASReviewV1 {
  readonly format: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_REVIEW_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly environmentIntent: 'staging'
  readonly testingOnly: true
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly productionReachable: false
  readonly databaseLedgerBound: false
  readonly operationAuthorityAuthenticated: false
  readonly hostEvidenceAuthenticated: false
  readonly credentialAuthorityCreated: false
  readonly transportAuthorityCreated: false
  readonly databaseAuthorityCreated: false
  readonly mutationAuthorityCreated: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly releaseAuthorityCreated: false
  readonly persistenceAuthorityGranted: false
  readonly dispatchAuthorityGranted: false
  readonly queueRunnerWired: false
  readonly bindings: Readonly<{
    proposalDigest: string
    recordDigest: string
    currentRecordDigest: string | null
    sqlTemplateDigest: string
    renderedSqlDigest: string
    parameterSchemaDigest: string
    parameterValuesDigest: string
  }>
  readonly transaction: Readonly<{
    queryId: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_ID
    queryVersion: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_VERSION
    schemaName: string
    isolation: 'serializable'
    accessMode: 'read-write'
    statementCount: 1
    lockOrder: readonly ['head', 'ordered-revisions']
    finalStates: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES
    responseShape: 'one-row-one-status-field'
    requiresExternallyEstablishedSerializableTransaction: true
    requiresExternallyBoundedStatementTimeout: true
    requiresExternallyBoundedLockTimeout: true
    establishesTransaction: false
    exactReplayWrites: false
    refusalWrites: false
  }>
  readonly parameters: Readonly<{
    order: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER
    schema: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA
    valueCount: 27
    valuesExposed: false
    canonicalProposalByteLength: number
    canonicalRecordByteLength: number
  }>
  readonly artifact: Readonly<{
    path: typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_ARTIFACT_PATH
    kind: 'automation-idempotency-cas-transaction-review'
    mediaType: 'application/sql; charset=utf-8'
    schemaName: string
    byteLength: number
    digest: string
    templateDigest: string
    containsCatalogRead: true
    containsManagedDataRead: true
    containsDml: true
    performsSchemaChange: false
    mutationDispatched: false
    hostDispatchAvailable: false
  }>
  readonly policy: Readonly<{
    previewContainsPlaceholdersOnly: true
    canonicalValuesKeptInTrustedContextOnly: true
    callerSqlAccepted: false
    callerSchemaAccepted: false
    managementTransportCreated: false
    requestDispatched: false
    mutationDispatched: false
    databaseCASCommitted: false
    automaticRetryAllowed: false
    ambiguousOutcomeRequiresReadOnlyReconciliation: true
    advancedHeadRequiresReadOnlyReconciliation: true
  }>
  readonly blockers: readonly string[]
}

export interface TrustedSupabaseAutomationIdempotencyCASReviewContextV1 {
  readonly envelope: SupabaseAutomationIdempotencyCASReviewEnvelopeV1
  readonly sql: string
  readonly parameters: readonly ParameterValue[]
  readonly candidate: BackendAutomationIdempotencyCASCandidateV1
  readonly currentRecord: BackendAutomationIdempotencyRecordV1 | null
}

export type SupabaseAutomationIdempotencyCASResultStateV1 =
  (typeof SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES)[number]

export type SupabaseAutomationIdempotencyCASReviewErrorCode =
  | 'supabase-automation-idempotency-cas-input-invalid'
  | 'supabase-automation-idempotency-cas-digest-failed'

export class SupabaseAutomationIdempotencyCASReviewError extends Error {
  readonly code: SupabaseAutomationIdempotencyCASReviewErrorCode

  constructor(code: SupabaseAutomationIdempotencyCASReviewErrorCode) {
    super(code)
    this.name = 'SupabaseAutomationIdempotencyCASReviewError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>

const INPUT_KEYS = Object.freeze(['applicationObjectKey', 'candidate', 'currentRecord'] as const)
const CANDIDATE_KEYS = Object.freeze(['proposal', 'record', 'recordDigest'] as const)
const APPLICATION_OBJECT_KEY = /^[a-z0-9_-]{20}$/u
const SHA256_BASE64URL = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u
const trustedReviews = new WeakMap<object, TrustedSupabaseAutomationIdempotencyCASReviewContextV1>()
const BLOCKERS = Object.freeze([
  'testing-only-review-is-production-unreachable',
  'no-database-credential-or-transport-created',
  'no-operation-or-persistence-or-dispatch-authority-created',
  'rendered-schema-has-not-been-bound-to-a-reviewed-deployment-receipt',
  'execution-requires-an-external-serializable-read-write-transaction',
  'execution-requires-external-statement-and-lock-timeouts',
  'ambiguous-and-advanced-head-outcomes-require-read-only-reconciliation'
] as const)

function fail(code: SupabaseAutomationIdempotencyCASReviewErrorCode): never {
  throw new SupabaseAutomationIdempotencyCASReviewError(code)
}

function snapshotDataRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail('supabase-automation-idempotency-cas-input-invalid')
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return fail('supabase-automation-idempotency-cas-input-invalid')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const names = Reflect.ownKeys(descriptors)
    if (
      names.length !== keys.length ||
      names.some((name) => typeof name !== 'string' || !keys.includes(name))
    ) {
      return fail('supabase-automation-idempotency-cas-input-invalid')
    }
    const snapshot = Object.create(null) as UnknownRecord
    for (const name of names as string[]) {
      const descriptor = descriptors[name]
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        return fail('supabase-automation-idempotency-cas-input-invalid')
      }
      Object.defineProperty(snapshot, name, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      })
    }
    return Object.freeze(snapshot)
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReviewError) throw cause
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
}

function assertCloneableWithoutProxy(value: unknown): void {
  try {
    structuredClone(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
}

function applicationSchemaName(value: unknown): string {
  if (typeof value !== 'string' || !APPLICATION_OBJECT_KEY.test(value)) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  return `op_automation_${value}`
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function encodeBase64URL(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

async function digest(value: unknown): Promise<string> {
  try {
    return await digestCanonicalManifest(value)
  } catch {
    return fail('supabase-automation-idempotency-cas-digest-failed')
  }
}

async function digestSql(value: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(value)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
  } catch {
    return fail('supabase-automation-idempotency-cas-digest-failed')
  }
}

/** Render the sole fixed schema token after validating the compiler-owned object key. */
export function renderSupabaseAutomationIdempotencyCASSQLForTestingV1(
  applicationObjectKey: string
): string {
  const schemaName = applicationSchemaName(applicationObjectKey)
  if (
    !SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE.includes(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL
    )
  ) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  if (
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE.split(
      SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL
    ).length -
      1 !==
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL_COUNT
  ) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  const rendered = SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE.replaceAll(
    SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL,
    schemaName
  )
  if (rendered.includes(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SCHEMA_SENTINEL)) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  return rendered
}

function parameterValues(
  candidate: BackendAutomationIdempotencyCASCandidateV1,
  proposalDigest: string,
  proposalBase64: string,
  recordBase64: string
): readonly ParameterValue[] {
  const { proposal, record } = candidate
  return Object.freeze([
    proposalDigest,
    proposalBase64,
    candidate.recordDigest,
    recordBase64,
    record.automationId,
    record.eventId,
    record.operationId,
    record.idempotencyKeyDigest,
    record.causationId,
    record.causationHop,
    record.retentionHours,
    record.createdAt,
    record.expiresAt,
    record.recordedAt,
    record.revision,
    proposal.expectedRevision,
    proposal.expectedHeadDigest,
    record.previousRecordDigest,
    Object.freeze([...record.attemptIds]),
    record.currentAttemptId,
    record.state,
    record.completionEvidenceDigest,
    record.knownNotDispatchedEvidenceDigest,
    record.reconciliationEvidenceDigest,
    false,
    false,
    false
  ] satisfies ParameterValue[])
}

/**
 * Build a deterministic, testing-only review. The synchronous prefix snapshots every caller-owned
 * boundary and starts all lowcode validation before the first await.
 */
export async function createSupabaseAutomationIdempotencyCASReviewForTestingV1(
  input: CreateSupabaseAutomationIdempotencyCASReviewForTestingOptionsV1
): Promise<SupabaseAutomationIdempotencyCASReviewEnvelopeV1> {
  const source = snapshotDataRecord(input, INPUT_KEYS)
  const schemaName = applicationSchemaName(source.applicationObjectKey)
  const candidateSource = snapshotDataRecord(source.candidate, CANDIDATE_KEYS)
  const suppliedRecordDigest = candidateSource.recordDigest
  if (typeof suppliedRecordDigest !== 'string' || !SHA256_BASE64URL.test(suppliedRecordDigest)) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }

  let currentRecord: BackendAutomationIdempotencyRecordV1 | null
  let canonicalProposalBytes: Uint8Array
  let canonicalRecordBytes: Uint8Array
  let verifiedPromise: Promise<BackendAutomationIdempotencyCASCandidateV1>
  let proposalDigestPromise: Promise<string>
  let recordDigestPromise: Promise<string>
  let currentRecordDigestPromise: Promise<string> | null
  try {
    currentRecord =
      source.currentRecord === null
        ? null
        : parseBackendAutomationIdempotencyRecord(source.currentRecord)
    canonicalProposalBytes = canonicalBackendAutomationIdempotencyCASProposalBytes(
      candidateSource.proposal
    )
    canonicalRecordBytes = canonicalBackendAutomationIdempotencyRecordBytes(candidateSource.record)

    // Run only after descriptor-based parsing has rejected accessors throughout the data graph.
    // Native clone is then a fail-closed transparent-Proxy probe for both wrapper boundaries.
    assertCloneableWithoutProxy(source.candidate)
    assertCloneableWithoutProxy(input)

    // Do not create a rejecting Promise before the Proxy probes above. Otherwise a rejected
    // wrapper could abandon an already-running verifier and surface an unhandled rejection.
    proposalDigestPromise = digestBackendAutomationIdempotencyCASProposal(candidateSource.proposal)
    recordDigestPromise = digestBackendAutomationIdempotencyRecord(candidateSource.record)
    currentRecordDigestPromise = currentRecord
      ? digestBackendAutomationIdempotencyRecord(currentRecord)
      : null
    verifiedPromise = verifyBackendAutomationIdempotencyCASProposal(
      candidateSource.proposal,
      currentRecord,
      candidateSource.record
    )
  } catch (cause) {
    if (cause instanceof SupabaseAutomationIdempotencyCASReviewError) throw cause
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }

  let candidate: BackendAutomationIdempotencyCASCandidateV1
  let proposalDigest: string
  let recordDigest: string
  let currentRecordDigest: string | null
  try {
    ;[candidate, proposalDigest, recordDigest, currentRecordDigest] = await Promise.all([
      verifiedPromise,
      proposalDigestPromise,
      recordDigestPromise,
      currentRecordDigestPromise ?? Promise.resolve(null)
    ])
  } catch {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  if (
    candidate.recordDigest !== suppliedRecordDigest ||
    recordDigest !== suppliedRecordDigest ||
    candidate.proposal.nextRecordDigest !== suppliedRecordDigest
  ) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }

  const sql = renderSupabaseAutomationIdempotencyCASSQLForTestingV1(
    source.applicationObjectKey as string
  )
  const values = parameterValues(
    candidate,
    proposalDigest,
    encodeBase64(canonicalProposalBytes),
    encodeBase64(canonicalRecordBytes)
  )
  if (values.length !== SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER.length) {
    return fail('supabase-automation-idempotency-cas-input-invalid')
  }
  const [sqlTemplateDigest, renderedSqlDigest, parameterSchemaDigest, parameterValuesDigest] =
    await Promise.all([
      digestSql(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_SQL_TEMPLATE),
      digestSql(sql),
      digest(SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA),
      digest(
        Object.freeze({
          format: 'openpencil.supabase-automation-idempotency-cas-parameters.v1' as const,
          version: 1 as const,
          order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
          values
        })
      )
    ])

  const review: SupabaseAutomationIdempotencyCASReviewV1 = Object.freeze({
    format: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_REVIEW_FORMAT,
    version: 1 as const,
    providerId: 'supabase' as const,
    environmentIntent: 'staging' as const,
    testingOnly: true as const,
    reviewOnly: true as const,
    applyAvailable: false as const,
    releaseReady: false as const,
    productionReachable: false as const,
    databaseLedgerBound: false as const,
    operationAuthorityAuthenticated: false as const,
    hostEvidenceAuthenticated: false as const,
    credentialAuthorityCreated: false as const,
    transportAuthorityCreated: false as const,
    databaseAuthorityCreated: false as const,
    mutationAuthorityCreated: false as const,
    executionAuthorityCreated: false as const,
    receiptAuthorityCreated: false as const,
    releaseAuthorityCreated: false as const,
    persistenceAuthorityGranted: false as const,
    dispatchAuthorityGranted: false as const,
    queueRunnerWired: false as const,
    bindings: Object.freeze({
      proposalDigest,
      recordDigest,
      currentRecordDigest,
      sqlTemplateDigest,
      renderedSqlDigest,
      parameterSchemaDigest,
      parameterValuesDigest
    }),
    transaction: Object.freeze({
      queryId: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_ID,
      queryVersion: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_QUERY_VERSION,
      schemaName,
      isolation: 'serializable' as const,
      accessMode: 'read-write' as const,
      statementCount: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_STATEMENT_COUNT,
      lockOrder: Object.freeze(['head', 'ordered-revisions'] as const),
      finalStates: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_RESULT_STATES,
      responseShape: 'one-row-one-status-field' as const,
      requiresExternallyEstablishedSerializableTransaction: true as const,
      requiresExternallyBoundedStatementTimeout: true as const,
      requiresExternallyBoundedLockTimeout: true as const,
      establishesTransaction: false as const,
      exactReplayWrites: false as const,
      refusalWrites: false as const
    }),
    parameters: Object.freeze({
      order: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_ORDER,
      schema: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_PARAMETER_SCHEMA,
      valueCount: 27 as const,
      valuesExposed: false as const,
      canonicalProposalByteLength: canonicalProposalBytes.byteLength,
      canonicalRecordByteLength: canonicalRecordBytes.byteLength
    }),
    artifact: Object.freeze({
      path: SUPABASE_AUTOMATION_IDEMPOTENCY_CAS_ARTIFACT_PATH,
      kind: 'automation-idempotency-cas-transaction-review' as const,
      mediaType: 'application/sql; charset=utf-8' as const,
      schemaName,
      byteLength: new TextEncoder().encode(sql).byteLength,
      digest: renderedSqlDigest,
      templateDigest: sqlTemplateDigest,
      containsCatalogRead: true as const,
      containsManagedDataRead: true as const,
      containsDml: true as const,
      performsSchemaChange: false as const,
      mutationDispatched: false as const,
      hostDispatchAvailable: false as const
    }),
    policy: Object.freeze({
      previewContainsPlaceholdersOnly: true as const,
      canonicalValuesKeptInTrustedContextOnly: true as const,
      callerSqlAccepted: false as const,
      callerSchemaAccepted: false as const,
      managementTransportCreated: false as const,
      requestDispatched: false as const,
      mutationDispatched: false as const,
      databaseCASCommitted: false as const,
      automaticRetryAllowed: false as const,
      ambiguousOutcomeRequiresReadOnlyReconciliation: true as const,
      advancedHeadRequiresReadOnlyReconciliation: true as const
    }),
    blockers: BLOCKERS
  })
  const envelope = Object.freeze({
    review,
    reviewDigest: await digest(review),
    previewSql: sql
  })
  trustedReviews.set(
    envelope,
    Object.freeze({
      envelope,
      sql,
      parameters: values,
      candidate,
      currentRecord
    })
  )
  return envelope
}

/** Identity-only lookup; copied or reconstructed reviews have no trusted parameter context. */
export function trustedSupabaseAutomationIdempotencyCASReviewContextV1(
  value: unknown
): TrustedSupabaseAutomationIdempotencyCASReviewContextV1 | null {
  if (value === null || typeof value !== 'object') return null
  return trustedReviews.get(value) ?? null
}
