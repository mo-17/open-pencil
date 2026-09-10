/* eslint-disable max-lines -- the one-shot DDL and its exact catalog postconditions are one review boundary */

const LEDGER_MARKER_FORMAT = 'openpencil.supabase-automation-idempotency-ledger.v1'
const HEADS_TABLE = 'idempotency_heads'
const REVISIONS_TABLE = 'idempotency_revisions'
const MUTATION_GUARD_FUNCTION = 'reject_idempotency_revision_mutation'
const MUTATION_GUARD_TRIGGER = 'idempotency_revisions_immutable'
const MUTATION_GUARD_PROSRC =
  "\nBEGIN\n  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency revisions are append-only; mutation and retirement require explicit approval.';\nEND\n"

const REVISION_CONSTRAINTS = Object.freeze([
  ['idempotency_revisions_pkey', 'p'],
  ['idempotency_revisions_head_key', 'u'],
  ['idempotency_revisions_previous_fkey', 'f'],
  ['idempotency_revisions_identifiers_check', 'c'],
  ['idempotency_revisions_digests_check', 'c'],
  ['idempotency_revisions_chain_check', 'c'],
  ['idempotency_revisions_transition_check', 'c'],
  ['idempotency_revisions_evidence_check', 'c'],
  ['idempotency_revisions_retry_fence_check', 'c'],
  ['idempotency_revisions_retention_check', 'c']
] as const)

const HEAD_CONSTRAINTS = Object.freeze([
  ['idempotency_heads_pkey', 'p'],
  ['idempotency_heads_revision_fkey', 'f'],
  ['idempotency_heads_key_digest_check', 'c'],
  ['idempotency_heads_head_digest_check', 'c'],
  ['idempotency_heads_revision_check', 'c'],
  ['idempotency_heads_attempt_check', 'c'],
  ['idempotency_heads_state_fence_check', 'c'],
  ['idempotency_heads_retention_check', 'c']
] as const)

type LedgerConstraintName =
  | (typeof REVISION_CONSTRAINTS)[number][0]
  | (typeof HEAD_CONSTRAINTS)[number][0]

const INDEXES = Object.freeze([
  ['idempotency_revisions_pkey', REVISIONS_TABLE, true, true, [1, 2, 3], null],
  [
    'idempotency_revisions_head_key',
    REVISIONS_TABLE,
    false,
    true,
    [1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28],
    null
  ],
  [
    'idempotency_revisions_attempt_reservation_uidx',
    REVISIONS_TABLE,
    false,
    true,
    [1, 2, 20],
    "(state = 'reserved'::text)"
  ],
  ['idempotency_revisions_retention_idx', REVISIONS_TABLE, false, false, [28, 1, 2, 3], null],
  ['idempotency_heads_pkey', HEADS_TABLE, true, true, [1, 2], null],
  ['idempotency_heads_retention_idx', HEADS_TABLE, false, false, [14, 1, 2], null]
] as const)

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function generatedIdentifier(value: string, path: string): string {
  if (!/^[a-z][a-z0-9_-]{0,60}$/u.test(value)) {
    throw new TypeError(`${path} is not a bounded generated PostgreSQL identifier.`)
  }
  return value
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/** Match PostgreSQL's identifier rendering in pg_get_constraintdef/pg_get_indexdef. */
function catalogIdentifier(value: string): string {
  return /^[a-z_][a-z0-9_$]*$/u.test(value) ? value : identifier(value)
}

function qualified(schemaName: string, objectName: string): string {
  return `${identifier(schemaName)}.${identifier(objectName)}`
}

function markerPrefix(applicationObjectKey: string): string {
  return `${LEDGER_MARKER_FORMAT};application=${applicationObjectKey};`
}

function marker(applicationObjectKey: string, object: string): string {
  return `${markerPrefix(applicationObjectKey)}object=${object}`
}

export function supabaseAutomationIdempotencyLedgerSchemaNameV2(
  applicationObjectKey: string
): string {
  return generatedIdentifier(
    `op_automation_${applicationObjectKey}`,
    '$.supabaseAutomations.idempotencyLedger.schemaName'
  )
}

function inventoryPreflight(applicationObjectKey: string, schemaName: string): readonly string[] {
  const prefix = markerPrefix(applicationObjectKey)
  return [
    'DO $openpencil_idempotency_ledger_inventory$',
    'BEGIN',
    `  IF "pg_catalog"."to_regnamespace"(${literal(identifier(schemaName))}) IS NOT NULL THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil refuses to adopt or replace a pre-existing idempotency ledger schema.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_description" AS "prior_ledger_marker"',
    `    WHERE LEFT("prior_ledger_marker"."description", ${prefix.length}) = ${literal(prefix)}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil found a previously generated idempotency ledger; retirement or replacement requires explicit approval and a fresh inspected inventory.';",
    '  END IF;',
    'END',
    '$openpencil_idempotency_ledger_inventory$;'
  ]
}

function revisionTableDDL(schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  return [
    `CREATE TABLE ${revisions} (`,
    '  "automation_id" text NOT NULL,',
    '  "idempotency_key_digest" text NOT NULL,',
    '  "revision" bigint NOT NULL,',
    '  "expected_revision" bigint,',
    '  "expected_head_digest" text,',
    '  "expected_event_id" text,',
    '  "expected_operation_id" text,',
    '  "expected_causation_id" text,',
    '  "expected_causation_hop" smallint,',
    '  "expected_attempt_id" text,',
    '  "expected_attempt_ordinal" smallint,',
    '  "expected_state" text,',
    '  "expected_recorded_at" timestamp with time zone,',
    '  "expected_retention_expires_at" timestamp with time zone,',
    '  "record_digest" text NOT NULL,',
    '  "event_id" text NOT NULL,',
    '  "operation_id" text NOT NULL,',
    '  "causation_id" text NOT NULL,',
    '  "causation_hop" smallint NOT NULL,',
    '  "attempt_id" text NOT NULL,',
    '  "attempt_ordinal" smallint NOT NULL,',
    '  "state" text NOT NULL,',
    '  "retry_fence" text NOT NULL,',
    '  "completion_evidence_digest" text,',
    '  "known_not_dispatched_evidence_digest" text,',
    '  "reconciliation_evidence_digest" text,',
    '  "recorded_at" timestamp with time zone NOT NULL,',
    '  "retention_expires_at" timestamp with time zone NOT NULL,',
    '  CONSTRAINT "idempotency_revisions_pkey"',
    '    PRIMARY KEY ("automation_id", "idempotency_key_digest", "revision"),',
    '  CONSTRAINT "idempotency_revisions_head_key"',
    '    UNIQUE (',
    '      "automation_id", "idempotency_key_digest", "revision", "record_digest",',
    '      "event_id", "operation_id", "causation_id", "causation_hop",',
    '      "attempt_id", "attempt_ordinal", "state", "recorded_at", "retention_expires_at"',
    '    ),',
    '  CONSTRAINT "idempotency_revisions_previous_fkey"',
    '    FOREIGN KEY (',
    '      "automation_id", "idempotency_key_digest", "expected_revision",',
    '      "expected_head_digest", "expected_event_id", "expected_operation_id",',
    '      "expected_causation_id", "expected_causation_hop", "expected_attempt_id",',
    '      "expected_attempt_ordinal", "expected_state", "expected_recorded_at",',
    '      "expected_retention_expires_at"',
    `    ) REFERENCES ${revisions} (`,
    '      "automation_id", "idempotency_key_digest", "revision", "record_digest",',
    '      "event_id", "operation_id", "causation_id", "causation_hop",',
    '      "attempt_id", "attempt_ordinal", "state", "recorded_at", "retention_expires_at"',
    '    ) MATCH SIMPLE DEFERRABLE INITIALLY DEFERRED,',
    '  CONSTRAINT "idempotency_revisions_identifiers_check" CHECK (',
    '    "automation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "event_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "operation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "causation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "attempt_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND ("expected_event_id" IS NULL',
    '      OR "expected_event_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\')',
    '    AND ("expected_operation_id" IS NULL',
    '      OR "expected_operation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\')',
    '    AND ("expected_causation_id" IS NULL',
    '      OR "expected_causation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\')',
    '    AND ("expected_attempt_id" IS NULL',
    '      OR "expected_attempt_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\')',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_digests_check" CHECK (',
    '    "idempotency_key_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\'',
    '    AND "record_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\'',
    '    AND ("expected_head_digest" IS NULL',
    '      OR "expected_head_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\')',
    '    AND ("completion_evidence_digest" IS NULL',
    '      OR "completion_evidence_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\')',
    '    AND ("known_not_dispatched_evidence_digest" IS NULL',
    '      OR "known_not_dispatched_evidence_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\')',
    '    AND ("reconciliation_evidence_digest" IS NULL',
    '      OR "reconciliation_evidence_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\')',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_chain_check" CHECK (',
    '    (',
    '      "revision" = 0',
    '      AND "expected_revision" IS NULL',
    '      AND "expected_head_digest" IS NULL',
    '      AND "expected_event_id" IS NULL',
    '      AND "expected_operation_id" IS NULL',
    '      AND "expected_causation_id" IS NULL',
    '      AND "expected_causation_hop" IS NULL',
    '      AND "expected_attempt_id" IS NULL',
    '      AND "expected_attempt_ordinal" IS NULL',
    '      AND "expected_state" IS NULL',
    '      AND "expected_recorded_at" IS NULL',
    '      AND "expected_retention_expires_at" IS NULL',
    '    ) OR (',
    '      "revision" BETWEEN 1 AND 1024',
    '      AND "expected_revision" IS NOT NULL',
    '      AND "expected_revision" = "revision" - 1',
    '      AND "expected_head_digest" IS NOT NULL',
    '      AND "expected_event_id" IS NOT NULL',
    '      AND "expected_operation_id" IS NOT NULL',
    '      AND "expected_causation_id" IS NOT NULL',
    '      AND "expected_causation_hop" IS NOT NULL',
    '      AND "expected_attempt_id" IS NOT NULL',
    '      AND "expected_attempt_ordinal" IS NOT NULL',
    '      AND "expected_state" IS NOT NULL',
    '      AND "expected_recorded_at" IS NOT NULL',
    '      AND "expected_retention_expires_at" IS NOT NULL',
    '      AND "event_id" = "expected_event_id"',
    '      AND "operation_id" = "expected_operation_id"',
    '      AND "causation_id" = "expected_causation_id"',
    '      AND "causation_hop" = "expected_causation_hop"',
    '      AND "recorded_at" >= "expected_recorded_at"',
    '      AND "retention_expires_at" = "expected_retention_expires_at"',
    '    )',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_transition_check" CHECK (',
    '    (',
    '      "revision" = 0',
    '      AND "state" = \'reserved\'',
    '      AND "attempt_ordinal" = 1',
    '      AND "recorded_at" < "retention_expires_at"',
    '    ) OR (',
    '      "revision" BETWEEN 1 AND 1024',
    '      AND "expected_state" = \'reserved\'',
    "      AND \"state\" IN ('dispatch-started', 'known-not-dispatched')",
    '      AND "attempt_id" = "expected_attempt_id"',
    '      AND "attempt_ordinal" = "expected_attempt_ordinal"',
    '    ) OR (',
    '      "revision" BETWEEN 1 AND 1024',
    '      AND "expected_state" = \'dispatch-started\'',
    "      AND \"state\" IN ('outcome-unknown', 'succeeded', 'known-not-dispatched')",
    '      AND "attempt_id" = "expected_attempt_id"',
    '      AND "attempt_ordinal" = "expected_attempt_ordinal"',
    '    ) OR (',
    '      "revision" BETWEEN 1 AND 1024',
    '      AND "expected_state" = \'outcome-unknown\'',
    "      AND \"state\" IN ('succeeded', 'known-not-dispatched')",
    '      AND "attempt_id" = "expected_attempt_id"',
    '      AND "attempt_ordinal" = "expected_attempt_ordinal"',
    '    ) OR (',
    '      "revision" BETWEEN 1 AND 1024',
    '      AND "expected_state" = \'known-not-dispatched\'',
    '      AND "state" = \'reserved\'',
    '      AND "attempt_id" <> "expected_attempt_id"',
    '      AND "attempt_ordinal" = "expected_attempt_ordinal" + 1',
    '      AND "attempt_ordinal" BETWEEN 2 AND 20',
    '      AND "recorded_at" < "retention_expires_at"',
    '    )',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_evidence_check" CHECK (',
    '    (',
    "      \"state\" IN ('reserved', 'dispatch-started', 'outcome-unknown')",
    '      AND "completion_evidence_digest" IS NULL',
    '      AND "known_not_dispatched_evidence_digest" IS NULL',
    '      AND "reconciliation_evidence_digest" IS NULL',
    '    ) OR (',
    '      "state" = \'succeeded\'',
    '      AND "completion_evidence_digest" IS NOT NULL',
    '      AND "known_not_dispatched_evidence_digest" IS NULL',
    '      AND (',
    '        ("expected_state" = \'dispatch-started\' AND "reconciliation_evidence_digest" IS NULL)',
    '        OR ("expected_state" = \'outcome-unknown\' AND "reconciliation_evidence_digest" IS NOT NULL)',
    '      )',
    '    ) OR (',
    '      "state" = \'known-not-dispatched\'',
    '      AND "completion_evidence_digest" IS NULL',
    '      AND "known_not_dispatched_evidence_digest" IS NOT NULL',
    '      AND (',
    '        ("expected_state" = \'reserved\' AND "reconciliation_evidence_digest" IS NULL)',
    "        OR (\"expected_state\" IN ('dispatch-started', 'outcome-unknown')",
    '          AND "reconciliation_evidence_digest" IS NOT NULL)',
    '      )',
    '    )',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_retry_fence_check" CHECK (',
    "    (\"state\" IN ('reserved', 'dispatch-started') AND \"retry_fence\" = 'current-attempt-only')",
    '    OR ("state" = \'outcome-unknown\' AND "retry_fence" = \'reconciliation-required\')',
    '    OR ("state" = \'succeeded\' AND "retry_fence" = \'terminal\')',
    '    OR ("state" = \'known-not-dispatched\' AND "retry_fence" = \'bounded-policy-review-required\')',
    '  ),',
    '  CONSTRAINT "idempotency_revisions_retention_check" CHECK (',
    '    "pg_catalog"."isfinite"("recorded_at")',
    '    AND "pg_catalog"."isfinite"("retention_expires_at")',
    '    AND "causation_hop" BETWEEN 0 AND 16',
    '    AND ("expected_causation_hop" IS NULL',
    '      OR "expected_causation_hop" BETWEEN 0 AND 16)',
    '    AND ("expected_recorded_at" IS NULL',
    '      OR "pg_catalog"."isfinite"("expected_recorded_at"))',
    '    AND ("expected_retention_expires_at" IS NULL',
    '      OR "pg_catalog"."isfinite"("expected_retention_expires_at"))',
    '  )',
    ') USING heap;'
  ]
}

function headsTableDDL(schemaName: string): readonly string[] {
  const heads = qualified(schemaName, HEADS_TABLE)
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  return [
    `CREATE TABLE ${heads} (`,
    '  "automation_id" text NOT NULL,',
    '  "idempotency_key_digest" text NOT NULL,',
    '  "current_revision" bigint NOT NULL,',
    '  "current_head_digest" text NOT NULL,',
    '  "current_event_id" text NOT NULL,',
    '  "current_operation_id" text NOT NULL,',
    '  "current_causation_id" text NOT NULL,',
    '  "current_causation_hop" smallint NOT NULL,',
    '  "current_attempt_id" text NOT NULL,',
    '  "current_attempt_ordinal" smallint NOT NULL,',
    '  "current_state" text NOT NULL,',
    '  "current_retry_fence" text NOT NULL,',
    '  "current_recorded_at" timestamp with time zone NOT NULL,',
    '  "retention_expires_at" timestamp with time zone NOT NULL,',
    '  CONSTRAINT "idempotency_heads_pkey"',
    '    PRIMARY KEY ("automation_id", "idempotency_key_digest"),',
    '  CONSTRAINT "idempotency_heads_revision_fkey"',
    '    FOREIGN KEY (',
    '      "automation_id", "idempotency_key_digest", "current_revision",',
    '      "current_head_digest", "current_event_id", "current_operation_id",',
    '      "current_causation_id", "current_causation_hop", "current_attempt_id",',
    '      "current_attempt_ordinal", "current_state", "current_recorded_at",',
    '      "retention_expires_at"',
    `    ) REFERENCES ${revisions} (`,
    '      "automation_id", "idempotency_key_digest", "revision", "record_digest",',
    '      "event_id", "operation_id", "causation_id", "causation_hop",',
    '      "attempt_id", "attempt_ordinal", "state", "recorded_at", "retention_expires_at"',
    '    ) MATCH FULL DEFERRABLE INITIALLY DEFERRED,',
    '  CONSTRAINT "idempotency_heads_key_digest_check" CHECK (',
    '    "automation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "idempotency_key_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\'',
    '  ),',
    '  CONSTRAINT "idempotency_heads_head_digest_check" CHECK (',
    '    "current_head_digest" ~ \'^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$\'',
    '  ),',
    '  CONSTRAINT "idempotency_heads_revision_check" CHECK (',
    '    "current_revision" BETWEEN 0 AND 1024',
    '  ),',
    '  CONSTRAINT "idempotency_heads_attempt_check" CHECK (',
    '    "current_event_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "current_operation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "current_causation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "current_causation_hop" BETWEEN 0 AND 16',
    '    AND "pg_catalog"."isfinite"("current_recorded_at")',
    '    AND',
    '    "current_attempt_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$\'',
    '    AND "current_attempt_ordinal" BETWEEN 1 AND 20',
    '  ),',
    '  CONSTRAINT "idempotency_heads_state_fence_check" CHECK (',
    "    (\"current_state\" IN ('reserved', 'dispatch-started')",
    '      AND "current_retry_fence" = \'current-attempt-only\')',
    '    OR ("current_state" = \'outcome-unknown\'',
    '      AND "current_retry_fence" = \'reconciliation-required\')',
    '    OR ("current_state" = \'succeeded\' AND "current_retry_fence" = \'terminal\')',
    '    OR ("current_state" = \'known-not-dispatched\'',
    '      AND "current_retry_fence" = \'bounded-policy-review-required\')',
    '  ),',
    '  CONSTRAINT "idempotency_heads_retention_check" CHECK (',
    '    "pg_catalog"."isfinite"("retention_expires_at")',
    '  )',
    ') USING heap;'
  ]
}

function mutationGuardDDL(schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  const guard = qualified(schemaName, MUTATION_GUARD_FUNCTION)
  return [
    `CREATE FUNCTION ${guard}()`,
    'RETURNS "pg_catalog"."trigger"',
    'LANGUAGE plpgsql',
    'SECURITY INVOKER',
    'SET search_path = pg_catalog',
    'AS $openpencil_revision_mutation_guard$',
    'BEGIN',
    "  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency revisions are append-only; mutation and retirement require explicit approval.';",
    'END',
    '$openpencil_revision_mutation_guard$;',
    `CREATE TRIGGER ${identifier(MUTATION_GUARD_TRIGGER)}`,
    `BEFORE UPDATE OR DELETE OR TRUNCATE ON ${revisions}`,
    'FOR EACH STATEMENT',
    `EXECUTE FUNCTION ${guard}();`
  ]
}

function indexDDL(schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  const heads = qualified(schemaName, HEADS_TABLE)
  return [
    `CREATE UNIQUE INDEX ${identifier('idempotency_revisions_attempt_reservation_uidx')}`,
    `ON ${revisions} ("automation_id", "idempotency_key_digest", "attempt_id")`,
    'WHERE "state" = \'reserved\';',
    `CREATE INDEX ${identifier('idempotency_revisions_retention_idx')}`,
    `ON ${revisions} ("retention_expires_at", "automation_id", "idempotency_key_digest", "revision");`,
    `CREATE INDEX ${identifier('idempotency_heads_retention_idx')}`,
    `ON ${heads} ("retention_expires_at", "automation_id", "idempotency_key_digest");`
  ]
}

function comments(applicationObjectKey: string, schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  const heads = qualified(schemaName, HEADS_TABLE)
  const guard = qualified(schemaName, MUTATION_GUARD_FUNCTION)
  return [
    `COMMENT ON SCHEMA ${identifier(schemaName)} IS ${literal(marker(applicationObjectKey, 'schema'))};`,
    `COMMENT ON TABLE ${revisions} IS ${literal(marker(applicationObjectKey, 'table:idempotency-revisions'))};`,
    `COMMENT ON TABLE ${heads} IS ${literal(marker(applicationObjectKey, 'table:idempotency-heads'))};`,
    `COMMENT ON FUNCTION ${guard}() IS ${literal(marker(applicationObjectKey, 'function:revision-mutation-guard'))};`,
    `COMMENT ON TRIGGER ${identifier(MUTATION_GUARD_TRIGGER)} ON ${revisions} IS ${literal(marker(applicationObjectKey, 'trigger:revision-immutability'))};`,
    ...REVISION_CONSTRAINTS.map(
      ([constraintName]) =>
        `COMMENT ON CONSTRAINT ${identifier(constraintName)} ON ${revisions} IS ${literal(marker(applicationObjectKey, `constraint:${constraintName}`))};`
    ),
    ...HEAD_CONSTRAINTS.map(
      ([constraintName]) =>
        `COMMENT ON CONSTRAINT ${identifier(constraintName)} ON ${heads} IS ${literal(marker(applicationObjectKey, `constraint:${constraintName}`))};`
    ),
    ...INDEXES.map(
      ([indexName]) =>
        `COMMENT ON INDEX ${qualified(schemaName, indexName)} IS ${literal(marker(applicationObjectKey, `index:${indexName}`))};`
    )
  ]
}

function revokeDDL(schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  const heads = qualified(schemaName, HEADS_TABLE)
  const guard = qualified(schemaName, MUTATION_GUARD_FUNCTION)
  return [
    `REVOKE ALL PRIVILEGES ON SCHEMA ${identifier(schemaName)} FROM PUBLIC, "anon", "authenticated", "authenticator";`,
    `REVOKE ALL PRIVILEGES ON TABLE ${revisions}, ${heads} FROM PUBLIC, "anon", "authenticated", "authenticator";`,
    `REVOKE ALL PRIVILEGES ON FUNCTION ${guard}() FROM PUBLIC, "anon", "authenticated", "authenticator";`,
    'DO $openpencil_idempotency_ledger_api_role_revoke$',
    'DECLARE',
    `  schema_identifier CONSTANT text := ${literal(identifier(schemaName))};`,
    `  revisions_identifier CONSTANT text := ${literal(revisions)};`,
    `  heads_identifier CONSTANT text := ${literal(heads)};`,
    `  guard_identifier CONSTANT text := ${literal(`${guard}()`)};`,
    '  api_role_identifier CONSTANT text := "pg_catalog"."quote_ident"(\'service\' || \'_role\');',
    'BEGIN',
    "  EXECUTE 'REVOKE ALL PRIVILEGES ON SCHEMA ' || schema_identifier || ' FROM ' || api_role_identifier;",
    "  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE ' || revisions_identifier || ', ' || heads_identifier || ' FROM ' || api_role_identifier;",
    "  EXECUTE 'REVOKE ALL PRIVILEGES ON FUNCTION ' || guard_identifier || ' FROM ' || api_role_identifier;",
    'END',
    '$openpencil_idempotency_ledger_api_role_revoke$;'
  ]
}

function expectedColumnRows(): readonly string[] {
  const rows = [
    [REVISIONS_TABLE, 1, 'automation_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 2, 'idempotency_key_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 3, 'revision', 'pg_catalog.int8', true],
    [REVISIONS_TABLE, 4, 'expected_revision', 'pg_catalog.int8', false],
    [REVISIONS_TABLE, 5, 'expected_head_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 6, 'expected_event_id', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 7, 'expected_operation_id', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 8, 'expected_causation_id', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 9, 'expected_causation_hop', 'pg_catalog.int2', false],
    [REVISIONS_TABLE, 10, 'expected_attempt_id', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 11, 'expected_attempt_ordinal', 'pg_catalog.int2', false],
    [REVISIONS_TABLE, 12, 'expected_state', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 13, 'expected_recorded_at', 'pg_catalog.timestamptz', false],
    [REVISIONS_TABLE, 14, 'expected_retention_expires_at', 'pg_catalog.timestamptz', false],
    [REVISIONS_TABLE, 15, 'record_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 16, 'event_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 17, 'operation_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 18, 'causation_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 19, 'causation_hop', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 20, 'attempt_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 21, 'attempt_ordinal', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 22, 'state', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 23, 'retry_fence', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 24, 'completion_evidence_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 25, 'known_not_dispatched_evidence_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 26, 'reconciliation_evidence_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 27, 'recorded_at', 'pg_catalog.timestamptz', true],
    [REVISIONS_TABLE, 28, 'retention_expires_at', 'pg_catalog.timestamptz', true],
    [HEADS_TABLE, 1, 'automation_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 2, 'idempotency_key_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 3, 'current_revision', 'pg_catalog.int8', true],
    [HEADS_TABLE, 4, 'current_head_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 5, 'current_event_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 6, 'current_operation_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 7, 'current_causation_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 8, 'current_causation_hop', 'pg_catalog.int2', true],
    [HEADS_TABLE, 9, 'current_attempt_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 10, 'current_attempt_ordinal', 'pg_catalog.int2', true],
    [HEADS_TABLE, 11, 'current_state', 'pg_catalog.text', true],
    [HEADS_TABLE, 12, 'current_retry_fence', 'pg_catalog.text', true],
    [HEADS_TABLE, 13, 'current_recorded_at', 'pg_catalog.timestamptz', true],
    [HEADS_TABLE, 14, 'retention_expires_at', 'pg_catalog.timestamptz', true]
  ] as const
  return rows.map(
    ([tableName, ordinal, columnName, typeName, notNull]) =>
      `      (${literal(tableName)}, ${ordinal}, ${literal(columnName)}, "pg_catalog"."to_regtype"(${literal(typeName)}), ${typeName === 'pg_catalog.text' ? '"pg_catalog"."to_regcollation"(\'pg_catalog.default\')' : '0::"pg_catalog"."oid"'}, ${notNull ? 'TRUE' : 'FALSE'})`
  )
}

function expectedConstraintDefinitions(
  schemaName: string
): Readonly<Record<LedgerConstraintName, string>> {
  const revisions = `${catalogIdentifier(schemaName)}.${REVISIONS_TABLE}`
  return Object.freeze({
    idempotency_revisions_pkey: 'PRIMARY KEY (automation_id, idempotency_key_digest, revision)',
    idempotency_revisions_head_key:
      'UNIQUE (automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at)',
    idempotency_revisions_previous_fkey: `FOREIGN KEY (automation_id, idempotency_key_digest, expected_revision, expected_head_digest, expected_event_id, expected_operation_id, expected_causation_id, expected_causation_hop, expected_attempt_id, expected_attempt_ordinal, expected_state, expected_recorded_at, expected_retention_expires_at) REFERENCES ${revisions}(automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at) DEFERRABLE INITIALLY DEFERRED`,
    idempotency_revisions_identifiers_check:
      "CHECK (((automation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((expected_event_id IS NULL) OR (expected_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_operation_id IS NULL) OR (expected_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_causation_id IS NULL) OR (expected_causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text)) AND ((expected_attempt_id IS NULL) OR (expected_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text))))",
    idempotency_revisions_digests_check:
      "CHECK (((idempotency_key_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text) AND (record_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text) AND ((expected_head_digest IS NULL) OR (expected_head_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((completion_evidence_digest IS NULL) OR (completion_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((known_not_dispatched_evidence_digest IS NULL) OR (known_not_dispatched_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)) AND ((reconciliation_evidence_digest IS NULL) OR (reconciliation_evidence_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text))))",
    idempotency_revisions_chain_check:
      'CHECK ((((revision = 0) AND (expected_revision IS NULL) AND (expected_head_digest IS NULL) AND (expected_event_id IS NULL) AND (expected_operation_id IS NULL) AND (expected_causation_id IS NULL) AND (expected_causation_hop IS NULL) AND (expected_attempt_id IS NULL) AND (expected_attempt_ordinal IS NULL) AND (expected_state IS NULL) AND (expected_recorded_at IS NULL) AND (expected_retention_expires_at IS NULL)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_revision IS NOT NULL) AND (expected_revision = (revision - 1)) AND (expected_head_digest IS NOT NULL) AND (expected_event_id IS NOT NULL) AND (expected_operation_id IS NOT NULL) AND (expected_causation_id IS NOT NULL) AND (expected_causation_hop IS NOT NULL) AND (expected_attempt_id IS NOT NULL) AND (expected_attempt_ordinal IS NOT NULL) AND (expected_state IS NOT NULL) AND (expected_recorded_at IS NOT NULL) AND (expected_retention_expires_at IS NOT NULL) AND (event_id = expected_event_id) AND (operation_id = expected_operation_id) AND (causation_id = expected_causation_id) AND (causation_hop = expected_causation_hop) AND (recorded_at >= expected_recorded_at) AND (retention_expires_at = expected_retention_expires_at))))',
    idempotency_revisions_transition_check:
      "CHECK ((((revision = 0) AND (state = 'reserved'::text) AND (attempt_ordinal = 1) AND (recorded_at < retention_expires_at)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'reserved'::text) AND (state = ANY (ARRAY['dispatch-started'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'dispatch-started'::text) AND (state = ANY (ARRAY['outcome-unknown'::text, 'succeeded'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'outcome-unknown'::text) AND (state = ANY (ARRAY['succeeded'::text, 'known-not-dispatched'::text])) AND (attempt_id = expected_attempt_id) AND (attempt_ordinal = expected_attempt_ordinal)) OR (((revision >= 1) AND (revision <= 1024)) AND (expected_state = 'known-not-dispatched'::text) AND (state = 'reserved'::text) AND (attempt_id <> expected_attempt_id) AND (attempt_ordinal = (expected_attempt_ordinal + 1)) AND ((attempt_ordinal >= 2) AND (attempt_ordinal <= 20)) AND (recorded_at < retention_expires_at))))",
    idempotency_revisions_evidence_check:
      "CHECK ((((state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text, 'outcome-unknown'::text])) AND (completion_evidence_digest IS NULL) AND (known_not_dispatched_evidence_digest IS NULL) AND (reconciliation_evidence_digest IS NULL)) OR ((state = 'succeeded'::text) AND (completion_evidence_digest IS NOT NULL) AND (known_not_dispatched_evidence_digest IS NULL) AND (((expected_state = 'dispatch-started'::text) AND (reconciliation_evidence_digest IS NULL)) OR ((expected_state = 'outcome-unknown'::text) AND (reconciliation_evidence_digest IS NOT NULL)))) OR ((state = 'known-not-dispatched'::text) AND (completion_evidence_digest IS NULL) AND (known_not_dispatched_evidence_digest IS NOT NULL) AND (((expected_state = 'reserved'::text) AND (reconciliation_evidence_digest IS NULL)) OR ((expected_state = ANY (ARRAY['dispatch-started'::text, 'outcome-unknown'::text])) AND (reconciliation_evidence_digest IS NOT NULL))))))",
    idempotency_revisions_retry_fence_check:
      "CHECK ((((state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text])) AND (retry_fence = 'current-attempt-only'::text)) OR ((state = 'outcome-unknown'::text) AND (retry_fence = 'reconciliation-required'::text)) OR ((state = 'succeeded'::text) AND (retry_fence = 'terminal'::text)) OR ((state = 'known-not-dispatched'::text) AND (retry_fence = 'bounded-policy-review-required'::text))))",
    idempotency_revisions_retention_check:
      'CHECK ((isfinite(recorded_at) AND isfinite(retention_expires_at) AND ((causation_hop >= 0) AND (causation_hop <= 16)) AND ((expected_causation_hop IS NULL) OR ((expected_causation_hop >= 0) AND (expected_causation_hop <= 16))) AND ((expected_recorded_at IS NULL) OR isfinite(expected_recorded_at)) AND ((expected_retention_expires_at IS NULL) OR isfinite(expected_retention_expires_at))))',
    idempotency_heads_pkey: 'PRIMARY KEY (automation_id, idempotency_key_digest)',
    idempotency_heads_revision_fkey: `FOREIGN KEY (automation_id, idempotency_key_digest, current_revision, current_head_digest, current_event_id, current_operation_id, current_causation_id, current_causation_hop, current_attempt_id, current_attempt_ordinal, current_state, current_recorded_at, retention_expires_at) REFERENCES ${revisions}(automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at) MATCH FULL DEFERRABLE INITIALLY DEFERRED`,
    idempotency_heads_key_digest_check:
      "CHECK (((automation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (idempotency_key_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text)))",
    idempotency_heads_head_digest_check:
      "CHECK ((current_head_digest ~ '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'::text))",
    idempotency_heads_revision_check:
      'CHECK (((current_revision >= 0) AND (current_revision <= 1024)))',
    idempotency_heads_attempt_check:
      "CHECK (((current_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (current_operation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND (current_causation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((current_causation_hop >= 0) AND (current_causation_hop <= 16)) AND isfinite(current_recorded_at) AND (current_attempt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$'::text) AND ((current_attempt_ordinal >= 1) AND (current_attempt_ordinal <= 20))))",
    idempotency_heads_state_fence_check:
      "CHECK ((((current_state = ANY (ARRAY['reserved'::text, 'dispatch-started'::text])) AND (current_retry_fence = 'current-attempt-only'::text)) OR ((current_state = 'outcome-unknown'::text) AND (current_retry_fence = 'reconciliation-required'::text)) OR ((current_state = 'succeeded'::text) AND (current_retry_fence = 'terminal'::text)) OR ((current_state = 'known-not-dispatched'::text) AND (current_retry_fence = 'bounded-policy-review-required'::text))))",
    idempotency_heads_retention_check: 'CHECK (isfinite(retention_expires_at))'
  })
}

function expectedConstraintRows(
  applicationObjectKey: string,
  schemaName: string
): readonly string[] {
  const definitions = expectedConstraintDefinitions(schemaName)
  return [
    ...REVISION_CONSTRAINTS.map((entry) => [REVISIONS_TABLE, ...entry] as const),
    ...HEAD_CONSTRAINTS.map((entry) => [HEADS_TABLE, ...entry] as const)
  ].map(
    ([tableName, constraintName, constraintType]) =>
      `      (${literal(tableName)}, ${literal(constraintName)}, ${literal(constraintType)}, ${constraintType === 'c' ? 'FALSE' : 'TRUE'}, ${literal(definitions[constraintName])}, ${literal(marker(applicationObjectKey, `constraint:${constraintName}`))})`
  )
}

function expectedIndexRows(applicationObjectKey: string, schemaName: string): readonly string[] {
  const schema = catalogIdentifier(schemaName)
  const definitions = Object.freeze({
    idempotency_revisions_pkey: `CREATE UNIQUE INDEX idempotency_revisions_pkey ON ${schema}.idempotency_revisions USING btree (automation_id, idempotency_key_digest, revision)`,
    idempotency_revisions_head_key: `CREATE UNIQUE INDEX idempotency_revisions_head_key ON ${schema}.idempotency_revisions USING btree (automation_id, idempotency_key_digest, revision, record_digest, event_id, operation_id, causation_id, causation_hop, attempt_id, attempt_ordinal, state, recorded_at, retention_expires_at)`,
    idempotency_revisions_attempt_reservation_uidx: `CREATE UNIQUE INDEX idempotency_revisions_attempt_reservation_uidx ON ${schema}.idempotency_revisions USING btree (automation_id, idempotency_key_digest, attempt_id) WHERE (state = 'reserved'::text)`,
    idempotency_revisions_retention_idx: `CREATE INDEX idempotency_revisions_retention_idx ON ${schema}.idempotency_revisions USING btree (retention_expires_at, automation_id, idempotency_key_digest, revision)`,
    idempotency_heads_pkey: `CREATE UNIQUE INDEX idempotency_heads_pkey ON ${schema}.idempotency_heads USING btree (automation_id, idempotency_key_digest)`,
    idempotency_heads_retention_idx: `CREATE INDEX idempotency_heads_retention_idx ON ${schema}.idempotency_heads USING btree (retention_expires_at, automation_id, idempotency_key_digest)`
  })
  return INDEXES.map(
    ([indexName, tableName, primary, unique, columns, predicate]) =>
      `      (${literal(indexName)}, ${literal(tableName)}, ${primary ? 'TRUE' : 'FALSE'}, ${unique ? 'TRUE' : 'FALSE'}, ARRAY[${columns.join(', ')}]::smallint[], ${predicate === null ? 'NULL' : literal(predicate)}, ${literal(definitions[indexName])}, ${literal(marker(applicationObjectKey, `index:${indexName}`))})`
  )
}

function catalogPostcondition(applicationObjectKey: string, schemaName: string): readonly string[] {
  const schemaMarker = literal(marker(applicationObjectKey, 'schema'))
  const revisionMarker = literal(marker(applicationObjectKey, 'table:idempotency-revisions'))
  const headMarker = literal(marker(applicationObjectKey, 'table:idempotency-heads'))
  const functionMarker = literal(marker(applicationObjectKey, 'function:revision-mutation-guard'))
  const triggerMarker = literal(marker(applicationObjectKey, 'trigger:revision-immutability'))
  const schemaLiteral = literal(schemaName)
  const revisionsRegclass = literal(`${identifier(schemaName)}.${identifier(REVISIONS_TABLE)}`)
  const headsRegclass = literal(`${identifier(schemaName)}.${identifier(HEADS_TABLE)}`)
  const guardRegprocedure = literal(
    `${identifier(schemaName)}.${identifier(MUTATION_GUARD_FUNCTION)}()`
  )
  return [
    'DO $openpencil_idempotency_ledger_postcondition$',
    'DECLARE',
    '  expected_owner oid := (',
    '    SELECT "database_role"."oid"',
    '    FROM "pg_catalog"."pg_roles" AS "database_role"',
    '    WHERE "database_role"."rolname" = CURRENT_USER',
    '  );',
    `  ledger_namespace oid := "pg_catalog"."to_regnamespace"(${literal(identifier(schemaName))});`,
    `  revisions_table regclass := "pg_catalog"."to_regclass"(${revisionsRegclass});`,
    `  heads_table regclass := "pg_catalog"."to_regclass"(${headsRegclass});`,
    `  guard_function regprocedure := "pg_catalog"."to_regprocedure"(${guardRegprocedure});`,
    'BEGIN',
    '  IF ledger_namespace IS NULL OR revisions_table IS NULL OR heads_table IS NULL',
    '    OR guard_function IS NULL THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger object resolution postcondition failed.';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS "ledger_schema"',
    '    WHERE "ledger_schema"."oid" = ledger_namespace',
    `      AND "ledger_schema"."nspname" = ${schemaLiteral}`,
    '      AND "ledger_schema"."nspowner" = expected_owner',
    `      AND "pg_catalog"."obj_description"("ledger_schema"."oid", 'pg_namespace') = ${schemaMarker}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger schema ownership/marker postcondition failed.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_class" AS "ledger_relation"',
    '    WHERE "ledger_relation"."relnamespace" = ledger_namespace',
    '  ) <> 8 OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "ledger_relation"',
    '    WHERE "ledger_relation"."relnamespace" = ledger_namespace',
    '      AND (',
    `        ("ledger_relation"."relkind" = 'r' AND "ledger_relation"."relname" NOT IN (${literal(REVISIONS_TABLE)}, ${literal(HEADS_TABLE)}))`,
    `        OR ("ledger_relation"."relkind" = 'i' AND "ledger_relation"."relname" NOT IN (${INDEXES.map(([name]) => literal(name)).join(', ')}))`,
    `        OR "ledger_relation"."relkind" NOT IN ('r', 'i')`,
    '      )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger relation inventory postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedColumnRows().map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_column"("table_name", "ordinal", "column_name", "type_oid", "collation_oid", "not_null")',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "table_relation"."relname" AS "table_name",',
    '        "table_column"."attnum"::integer AS "ordinal",',
    '        "table_column"."attname" AS "column_name",',
    '        "table_column"."atttypid" AS "type_oid",',
    '        "table_column"."attcollation" AS "collation_oid",',
    '        "table_column"."attnotnull" AS "not_null",',
    '        "table_column"."atthasdef" AS "has_default",',
    '        "table_column"."attidentity" AS "identity_kind",',
    '        "table_column"."attgenerated" AS "generated_kind",',
    '        "table_column"."attacl" AS "column_acl"',
    '      FROM "pg_catalog"."pg_attribute" AS "table_column"',
    '      INNER JOIN "pg_catalog"."pg_class" AS "table_relation"',
    '        ON "table_relation"."oid" = "table_column"."attrelid"',
    '      WHERE "table_relation"."oid" IN (revisions_table, heads_table)',
    '        AND "table_column"."attnum" > 0',
    '        AND NOT "table_column"."attisdropped"',
    '    ) AS "actual_column"',
    '      ON "actual_column"."table_name" = "expected_column"."table_name"',
    '      AND "actual_column"."ordinal" = "expected_column"."ordinal"',
    '    WHERE "expected_column"."table_name" IS NULL',
    '      OR "actual_column"."table_name" IS NULL',
    '      OR "actual_column"."column_name" <> "expected_column"."column_name"',
    '      OR "actual_column"."type_oid" <> "expected_column"."type_oid"',
    '      OR "actual_column"."collation_oid" IS DISTINCT FROM "expected_column"."collation_oid"',
    '      OR "actual_column"."not_null" <> "expected_column"."not_null"',
    '      OR "actual_column"."has_default"',
    '      OR "actual_column"."identity_kind" <> \'\'',
    '      OR "actual_column"."generated_kind" <> \'\'',
    '      OR "actual_column"."column_acl" IS NOT NULL',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger column catalog postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedConstraintRows(applicationObjectKey, schemaName).map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_constraint"("table_name", "constraint_name", "constraint_type", "no_inherit", "definition", "marker")',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "constraint_table"."relname" AS "table_name",',
    '        "table_constraint"."conname" AS "constraint_name",',
    '        "table_constraint"."contype"::text AS "constraint_type",',
    '        "pg_catalog"."obj_description"("table_constraint"."oid", \'pg_constraint\') AS "marker",',
    '        "table_constraint"."convalidated" AS "validated",',
    '        "table_constraint"."connoinherit" AS "no_inherit",',
    '        "pg_catalog"."pg_get_constraintdef"("table_constraint"."oid", FALSE) AS "definition"',
    '      FROM "pg_catalog"."pg_constraint" AS "table_constraint"',
    '      INNER JOIN "pg_catalog"."pg_class" AS "constraint_table"',
    '        ON "constraint_table"."oid" = "table_constraint"."conrelid"',
    '      WHERE "constraint_table"."oid" IN (revisions_table, heads_table)',
    '    ) AS "actual_constraint"',
    '      ON "actual_constraint"."table_name" = "expected_constraint"."table_name"',
    '      AND "actual_constraint"."constraint_name" = "expected_constraint"."constraint_name"',
    '    WHERE "expected_constraint"."table_name" IS NULL',
    '      OR "actual_constraint"."table_name" IS NULL',
    '      OR "actual_constraint"."constraint_type" IS DISTINCT FROM "expected_constraint"."constraint_type"',
    '      OR "actual_constraint"."marker" IS DISTINCT FROM "expected_constraint"."marker"',
    '      OR NOT "actual_constraint"."validated"',
    '      OR "actual_constraint"."no_inherit" IS DISTINCT FROM "expected_constraint"."no_inherit"',
    '      OR "actual_constraint"."definition" IS DISTINCT FROM "expected_constraint"."definition"',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger constraint catalog postcondition failed.';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_constraint" AS "chain_constraint"',
    '    WHERE "chain_constraint"."conrelid" = revisions_table',
    '      AND "chain_constraint"."conname" = \'idempotency_revisions_previous_fkey\'',
    '      AND "chain_constraint"."confrelid" = revisions_table',
    '      AND "chain_constraint"."conkey" = ARRAY[1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]::smallint[]',
    '      AND "chain_constraint"."confkey" = ARRAY[1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28]::smallint[]',
    '      AND "chain_constraint"."condeferrable"',
    '      AND "chain_constraint"."condeferred"',
    '      AND "chain_constraint"."confmatchtype" = \'s\'',
    '      AND "chain_constraint"."confupdtype" = \'a\'',
    '      AND "chain_constraint"."confdeltype" = \'a\'',
    '  ) OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_constraint" AS "head_constraint"',
    '    WHERE "head_constraint"."conrelid" = heads_table',
    '      AND "head_constraint"."conname" = \'idempotency_heads_pkey\'',
    '      AND "head_constraint"."conkey" = ARRAY[1, 2]::smallint[]',
    '  ) OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_constraint" AS "head_constraint"',
    '    WHERE "head_constraint"."conrelid" = heads_table',
    '      AND "head_constraint"."conname" = \'idempotency_heads_revision_fkey\'',
    '      AND "head_constraint"."confrelid" = revisions_table',
    '      AND "head_constraint"."conkey" = ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14]::smallint[]',
    '      AND "head_constraint"."confkey" = ARRAY[1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28]::smallint[]',
    '      AND "head_constraint"."condeferrable"',
    '      AND "head_constraint"."condeferred"',
    '      AND "head_constraint"."confmatchtype" = \'f\'',
    '      AND "head_constraint"."confupdtype" = \'a\'',
    '      AND "head_constraint"."confdeltype" = \'a\'',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger CAS key/chain foreign-key postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedIndexRows(applicationObjectKey, schemaName).map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_index"(',
    '      "index_name", "table_name", "primary", "unique_index", "key_columns", "predicate", "definition", "marker"',
    '    )',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "index_relation"."relname" AS "index_name",',
    '        "table_relation"."relname" AS "table_name",',
    '        "table_index"."indisprimary" AS "primary",',
    '        "table_index"."indisunique" AS "unique_index",',
    '        ARRAY(SELECT "pg_catalog"."unnest"("table_index"."indkey"))::smallint[] AS "key_columns",',
    '        "pg_catalog"."pg_get_expr"(',
    '          "table_index"."indpred", "table_index"."indrelid"',
    '        ) AS "predicate",',
    '        "pg_catalog"."pg_get_indexdef"("index_relation"."oid") AS "definition",',
    '        "pg_catalog"."obj_description"("index_relation"."oid", \'pg_class\') AS "marker",',
    '        "table_index"."indisvalid" AS "valid",',
    '        "table_index"."indisready" AS "ready",',
    '        "table_index"."indislive" AS "live"',
    '      FROM "pg_catalog"."pg_index" AS "table_index"',
    '      INNER JOIN "pg_catalog"."pg_class" AS "index_relation"',
    '        ON "index_relation"."oid" = "table_index"."indexrelid"',
    '      INNER JOIN "pg_catalog"."pg_class" AS "table_relation"',
    '        ON "table_relation"."oid" = "table_index"."indrelid"',
    '      WHERE "table_index"."indrelid" IN (revisions_table, heads_table)',
    '    ) AS "actual_index"',
    '      ON "actual_index"."index_name" = "expected_index"."index_name"',
    '      AND "actual_index"."table_name" = "expected_index"."table_name"',
    '    WHERE "expected_index"."index_name" IS NULL',
    '      OR "actual_index"."index_name" IS NULL',
    '      OR "actual_index"."primary" IS DISTINCT FROM "expected_index"."primary"',
    '      OR "actual_index"."unique_index" IS DISTINCT FROM "expected_index"."unique_index"',
    '      OR "actual_index"."key_columns" IS DISTINCT FROM "expected_index"."key_columns"',
    '      OR "actual_index"."predicate" IS DISTINCT FROM "expected_index"."predicate"',
    '      OR "actual_index"."definition" IS DISTINCT FROM "expected_index"."definition"',
    '      OR "actual_index"."marker" IS DISTINCT FROM "expected_index"."marker"',
    '      OR NOT "actual_index"."valid"',
    '      OR NOT "actual_index"."ready"',
    '      OR NOT "actual_index"."live"',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger index catalog postcondition failed.';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_index" AS "attempt_index"',
    '    INNER JOIN "pg_catalog"."pg_class" AS "index_relation"',
    '      ON "index_relation"."oid" = "attempt_index"."indexrelid"',
    '    WHERE "attempt_index"."indrelid" = revisions_table',
    '      AND "index_relation"."relname" = \'idempotency_revisions_attempt_reservation_uidx\'',
    '      AND ARRAY(SELECT "pg_catalog"."unnest"("attempt_index"."indkey"))::smallint[] = ARRAY[1, 2, 20]::smallint[]',
    '      AND "pg_catalog"."pg_get_expr"("attempt_index"."indpred", "attempt_index"."indrelid") = \'(state = \'\'reserved\'\'::text)\'',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency attempt reservation index postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "ledger_table"',
    '    INNER JOIN "pg_catalog"."pg_am" AS "table_access_method"',
    '      ON "table_access_method"."oid" = "ledger_table"."relam"',
    '    WHERE "ledger_table"."oid" IN (revisions_table, heads_table)',
    '      AND (',
    '        "ledger_table"."relkind" <> \'r\'',
    '        OR "ledger_table"."relpersistence" <> \'p\'',
    '        OR "ledger_table"."relispartition"',
    '        OR "ledger_table"."relowner" <> expected_owner',
    '        OR "ledger_table"."relrowsecurity"',
    '        OR "ledger_table"."relforcerowsecurity"',
    '        OR "ledger_table"."relreplident" <> \'d\'',
    '        OR "table_access_method"."amname" <> \'heap\'',
    '      )',
    '  ) OR "pg_catalog"."obj_description"(revisions_table, \'pg_class\') IS DISTINCT FROM ' +
      revisionMarker,
    '    OR "pg_catalog"."obj_description"(heads_table, \'pg_class\') IS DISTINCT FROM ' +
      headMarker,
    '  THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger table shape/ownership/marker postcondition failed.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_proc" AS "ledger_function"',
    '    WHERE "ledger_function"."pronamespace" = ledger_namespace',
    '  ) <> 1 OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_proc" AS "guard_proc"',
    '    INNER JOIN "pg_catalog"."pg_language" AS "function_language"',
    '      ON "function_language"."oid" = "guard_proc"."prolang"',
    '    WHERE "guard_proc"."oid" = guard_function',
    '      AND "guard_proc"."pronamespace" = ledger_namespace',
    '      AND "guard_proc"."proowner" = expected_owner',
    '      AND NOT "guard_proc"."prosecdef"',
    '      AND NOT "guard_proc"."proleakproof"',
    '      AND NOT "guard_proc"."proisstrict"',
    '      AND NOT "guard_proc"."proretset"',
    '      AND "guard_proc"."prokind" = \'f\'',
    '      AND "guard_proc"."provolatile" = \'v\'',
    '      AND "guard_proc"."proparallel" = \'u\'',
    '      AND "guard_proc"."prorettype" = "pg_catalog"."to_regtype"(\'pg_catalog.trigger\')',
    '      AND "guard_proc"."pronargs" = 0',
    '      AND "guard_proc"."pronargdefaults" = 0',
    '      AND "guard_proc"."proconfig" = ARRAY[\'search_path=pg_catalog\']::text[]',
    `      AND "guard_proc"."prosrc" = ${literal(MUTATION_GUARD_PROSRC)}`,
    '      AND "guard_proc"."probin" IS NULL',
    '      AND "guard_proc"."prosqlbody" IS NULL',
    '      AND "function_language"."lanname" = \'plpgsql\'',
    `      AND "pg_catalog"."obj_description"("guard_proc"."oid", 'pg_proc') = ${functionMarker}`,
    '  ) OR (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_trigger" AS "ledger_trigger"',
    '    WHERE "ledger_trigger"."tgrelid" IN (revisions_table, heads_table)',
    '      AND NOT "ledger_trigger"."tgisinternal"',
    '  ) <> 1 OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_trigger" AS "guard_trigger"',
    '    WHERE "guard_trigger"."tgrelid" = revisions_table',
    `      AND "guard_trigger"."tgname" = ${literal(MUTATION_GUARD_TRIGGER)}`,
    '      AND NOT "guard_trigger"."tgisinternal"',
    '      AND "guard_trigger"."tgenabled" = \'O\'',
    '      AND "guard_trigger"."tgtype" = 58',
    '      AND "guard_trigger"."tgfoid" = guard_function',
    '      AND "guard_trigger"."tgconstraint" = 0',
    '      AND "guard_trigger"."tgconstrrelid" = 0',
    '      AND "guard_trigger"."tgconstrindid" = 0',
    '      AND NOT "guard_trigger"."tgdeferrable"',
    '      AND NOT "guard_trigger"."tginitdeferred"',
    '      AND "guard_trigger"."tgparentid" = 0',
    '      AND "guard_trigger"."tgqual" IS NULL',
    '      AND "guard_trigger"."tgnargs" = 0',
    '      AND "pg_catalog"."octet_length"("guard_trigger"."tgargs") = 0',
    '      AND "pg_catalog"."cardinality"(',
    '        ARRAY(SELECT "pg_catalog"."unnest"("guard_trigger"."tgattr"))',
    '      ) = 0',
    '      AND "guard_trigger"."tgoldtable" IS NULL',
    '      AND "guard_trigger"."tgnewtable" IS NULL',
    `      AND "pg_catalog"."obj_description"("guard_trigger"."oid", 'pg_trigger') = ${triggerMarker}`,
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    "      ('idempotency_revisions_previous_fkey', 'idempotency_revisions', 'RI_FKey_check_ins', 5, 'idempotency_revisions'),",
    "      ('idempotency_revisions_previous_fkey', 'idempotency_revisions', 'RI_FKey_check_upd', 17, 'idempotency_revisions'),",
    "      ('idempotency_revisions_previous_fkey', 'idempotency_revisions', 'RI_FKey_noaction_del', 9, 'idempotency_revisions'),",
    "      ('idempotency_revisions_previous_fkey', 'idempotency_revisions', 'RI_FKey_noaction_upd', 17, 'idempotency_revisions'),",
    "      ('idempotency_heads_revision_fkey', 'idempotency_heads', 'RI_FKey_check_ins', 5, 'idempotency_revisions'),",
    "      ('idempotency_heads_revision_fkey', 'idempotency_heads', 'RI_FKey_check_upd', 17, 'idempotency_revisions'),",
    "      ('idempotency_heads_revision_fkey', 'idempotency_revisions', 'RI_FKey_noaction_del', 9, 'idempotency_heads'),",
    "      ('idempotency_heads_revision_fkey', 'idempotency_revisions', 'RI_FKey_noaction_upd', 17, 'idempotency_heads')",
    '    ) AS "expected_internal_trigger"(',
    '      "constraint_name", "table_name", "function_name", "trigger_type", "other_table_name"',
    '    )',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "internal_trigger"."oid" AS "trigger_oid",',
    '        "trigger_constraint"."conname" AS "constraint_name",',
    '        "trigger_table"."relname" AS "table_name",',
    '        "trigger_function"."proname" AS "function_name",',
    '        "internal_trigger"."tgtype"::integer AS "trigger_type",',
    '        "other_table"."relname" AS "other_table_name",',
    '        "constraint_index"."relname" AS "constraint_index_name",',
    '        "function_schema"."nspname" AS "function_schema_name",',
    '        "internal_trigger"."tgisinternal" AS "internal",',
    '        "internal_trigger"."tgenabled" AS "enabled",',
    '        "internal_trigger"."tgdeferrable" AS "deferrable",',
    '        "internal_trigger"."tginitdeferred" AS "initially_deferred",',
    '        "internal_trigger"."tgparentid" AS "parent_oid",',
    '        "internal_trigger"."tgqual" AS "qualification",',
    '        "internal_trigger"."tgnargs" AS "argument_count",',
    '        "pg_catalog"."octet_length"("internal_trigger"."tgargs") AS "argument_bytes",',
    '        "pg_catalog"."cardinality"(',
    '          ARRAY(SELECT "pg_catalog"."unnest"("internal_trigger"."tgattr"))',
    '        ) AS "attribute_count",',
    '        "internal_trigger"."tgoldtable" AS "old_transition_table",',
    '        "internal_trigger"."tgnewtable" AS "new_transition_table"',
    '      FROM "pg_catalog"."pg_trigger" AS "internal_trigger"',
    '      INNER JOIN "pg_catalog"."pg_class" AS "trigger_table"',
    '        ON "trigger_table"."oid" = "internal_trigger"."tgrelid"',
    '      LEFT JOIN "pg_catalog"."pg_constraint" AS "trigger_constraint"',
    '        ON "trigger_constraint"."oid" = "internal_trigger"."tgconstraint"',
    '      LEFT JOIN "pg_catalog"."pg_class" AS "other_table"',
    '        ON "other_table"."oid" = "internal_trigger"."tgconstrrelid"',
    '      LEFT JOIN "pg_catalog"."pg_class" AS "constraint_index"',
    '        ON "constraint_index"."oid" = "internal_trigger"."tgconstrindid"',
    '      LEFT JOIN "pg_catalog"."pg_proc" AS "trigger_function"',
    '        ON "trigger_function"."oid" = "internal_trigger"."tgfoid"',
    '      LEFT JOIN "pg_catalog"."pg_namespace" AS "function_schema"',
    '        ON "function_schema"."oid" = "trigger_function"."pronamespace"',
    '      WHERE "internal_trigger"."tgrelid" IN (revisions_table, heads_table)',
    '        AND "internal_trigger"."tgisinternal"',
    '    ) AS "actual_internal_trigger"',
    '      ON "actual_internal_trigger"."constraint_name" =',
    '        "expected_internal_trigger"."constraint_name"',
    '      AND "actual_internal_trigger"."table_name" =',
    '        "expected_internal_trigger"."table_name"',
    '      AND "actual_internal_trigger"."function_name" =',
    '        "expected_internal_trigger"."function_name"',
    '      AND "actual_internal_trigger"."trigger_type" =',
    '        "expected_internal_trigger"."trigger_type"',
    '    WHERE "expected_internal_trigger"."constraint_name" IS NULL',
    '      OR "actual_internal_trigger"."trigger_oid" IS NULL',
    '      OR "actual_internal_trigger"."other_table_name" IS DISTINCT FROM',
    '        "expected_internal_trigger"."other_table_name"',
    '      OR "actual_internal_trigger"."constraint_index_name" IS DISTINCT FROM',
    "        'idempotency_revisions_head_key'",
    '      OR "actual_internal_trigger"."function_schema_name" IS DISTINCT FROM \'pg_catalog\'',
    '      OR "actual_internal_trigger"."internal" IS NOT TRUE',
    '      OR "actual_internal_trigger"."enabled" IS DISTINCT FROM \'O\'',
    '      OR "actual_internal_trigger"."deferrable" IS NOT TRUE',
    '      OR "actual_internal_trigger"."initially_deferred" IS NOT TRUE',
    '      OR "actual_internal_trigger"."parent_oid" <> 0',
    '      OR "actual_internal_trigger"."qualification" IS NOT NULL',
    '      OR "actual_internal_trigger"."argument_count" <> 0',
    '      OR "actual_internal_trigger"."argument_bytes" <> 0',
    '      OR "actual_internal_trigger"."attribute_count" <> 0',
    '      OR "actual_internal_trigger"."old_transition_table" IS NOT NULL',
    '      OR "actual_internal_trigger"."new_transition_table" IS NOT NULL',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency revision immutability guard postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_inherits" AS "ledger_inheritance"',
    '    WHERE "ledger_inheritance"."inhrelid" IN (revisions_table, heads_table)',
    '      OR "ledger_inheritance"."inhparent" IN (revisions_table, heads_table)',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_rewrite" AS "ledger_rule"',
    '    WHERE "ledger_rule"."ev_class" IN (revisions_table, heads_table)',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_policy" AS "ledger_policy"',
    '    WHERE "ledger_policy"."polrelid" IN (revisions_table, heads_table)',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_publication" AS "ledger_publication"',
    '    WHERE "ledger_publication"."puballtables"',
    '      OR EXISTS (',
    '        SELECT 1',
    '        FROM "pg_catalog"."pg_publication_rel" AS "published_relation"',
    '        WHERE "published_relation"."prpubid" = "ledger_publication"."oid"',
    '          AND "published_relation"."prrelid" IN (revisions_table, heads_table)',
    '      )',
    '      OR EXISTS (',
    '        SELECT 1',
    '        FROM "pg_catalog"."pg_publication_namespace" AS "published_schema"',
    '        WHERE "published_schema"."pnpubid" = "ledger_publication"."oid"',
    '          AND "published_schema"."pnnspid" = ledger_namespace',
    '      )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil idempotency ledger inheritance, rule, policy, or publication postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS "ledger_schema"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("ledger_schema"."nspacl", "pg_catalog"."acldefault"(\'n\', "ledger_schema"."nspowner"))',
    '    ) AS "schema_acl"',
    '    WHERE "ledger_schema"."oid" = ledger_namespace',
    '      AND "schema_acl"."grantee" <> "ledger_schema"."nspowner"',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "ledger_table"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("ledger_table"."relacl", "pg_catalog"."acldefault"(\'r\', "ledger_table"."relowner"))',
    '    ) AS "table_acl"',
    '    WHERE "ledger_table"."oid" IN (revisions_table, heads_table)',
    '      AND "table_acl"."grantee" <> "ledger_table"."relowner"',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_attribute" AS "ledger_column"',
    '    WHERE "ledger_column"."attrelid" IN (revisions_table, heads_table)',
    '      AND "ledger_column"."attnum" > 0',
    '      AND NOT "ledger_column"."attisdropped"',
    '      AND "ledger_column"."attacl" IS NOT NULL',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_proc" AS "guard_proc"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("guard_proc"."proacl", "pg_catalog"."acldefault"(\'f\', "guard_proc"."proowner"))',
    '    ) AS "function_acl"',
    '    WHERE "guard_proc"."oid" = guard_function',
    '      AND "function_acl"."grantee" <> "guard_proc"."proowner"',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A non-owner retains a direct privilege on an OpenPencil idempotency ledger object.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    '    LEFT JOIN "pg_catalog"."pg_roles" AS "database_role"',
    '      ON "database_role"."rolname" = "known_role"."role_name"',
    '    WHERE "database_role"."oid" IS NULL',
    '      OR "pg_catalog"."pg_has_role"(',
    '        "database_role"."oid", expected_owner, \'MEMBER\'',
    '      )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A known Supabase API role is missing or inherits the idempotency ledger owner.';",
    '  END IF;',
    '  IF EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    '    WHERE "pg_catalog"."has_schema_privilege"("known_role"."role_name", ledger_namespace, \'USAGE\')',
    '      OR "pg_catalog"."has_schema_privilege"("known_role"."role_name", ledger_namespace, \'CREATE\')',
    '  ) OR EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    "    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS \"table_privilege\"(\"privilege_name\")",
    '    CROSS JOIN (VALUES (revisions_table), (heads_table)) AS "ledger_table"("table_oid")',
    '    WHERE "pg_catalog"."has_table_privilege"(',
    '      "known_role"."role_name", "ledger_table"."table_oid", "table_privilege"."privilege_name"',
    '    )',
    '  ) OR EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    "    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS \"column_privilege\"(\"privilege_name\")",
    '    CROSS JOIN (',
    '      SELECT "ledger_column"."attrelid", "ledger_column"."attnum"',
    '      FROM "pg_catalog"."pg_attribute" AS "ledger_column"',
    '      WHERE "ledger_column"."attrelid" IN (revisions_table, heads_table)',
    '        AND "ledger_column"."attnum" > 0',
    '        AND NOT "ledger_column"."attisdropped"',
    '    ) AS "ledger_column"',
    '    WHERE "pg_catalog"."has_column_privilege"(',
    '      "known_role"."role_name", "ledger_column"."attrelid",',
    '      "ledger_column"."attnum", "column_privilege"."privilege_name"',
    '    )',
    '  ) OR EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    '    WHERE "pg_catalog"."has_function_privilege"(',
    '      "known_role"."role_name", guard_function, \'EXECUTE\'',
    '    )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A known Supabase API role retains effective access to an OpenPencil idempotency ledger object.';",
    '  END IF;',
    'END',
    '$openpencil_idempotency_ledger_postcondition$;'
  ]
}

/**
 * Deterministic one-shot ledger DDL for review. It creates no writer and performs no DML.
 * A trusted Host must later implement the exact head CAS transaction and accept a catalog Receipt.
 */
export function emitSupabaseAutomationIdempotencyLedgerReviewSQLV2(
  applicationObjectKey: string
): readonly string[] {
  const schemaName = supabaseAutomationIdempotencyLedgerSchemaNameV2(applicationObjectKey)
  return [
    ...inventoryPreflight(applicationObjectKey, schemaName),
    `CREATE SCHEMA ${identifier(schemaName)} AUTHORIZATION CURRENT_USER;`,
    ...revisionTableDDL(schemaName),
    ...headsTableDDL(schemaName),
    ...mutationGuardDDL(schemaName),
    ...indexDDL(schemaName),
    ...comments(applicationObjectKey, schemaName),
    ...revokeDDL(schemaName),
    ...catalogPostcondition(applicationObjectKey, schemaName)
  ]
}
