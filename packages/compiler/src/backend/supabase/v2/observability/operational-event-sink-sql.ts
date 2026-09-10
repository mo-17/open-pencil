/* eslint-disable max-lines -- one-shot DDL and its exact catalog postconditions form one review boundary */

import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import {
  BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT,
  BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS,
  BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT,
  BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION,
  BACKEND_OPERATIONAL_EVENT_SINK_VERSION,
  BACKEND_OPERATIONAL_EVENT_VERSION
} from '@open-pencil/lowcode/backend'

const SINK_MARKER_FORMAT = 'openpencil.supabase-operational-event-sink.v1'
const REVISIONS_TABLE = 'operational_event_sink_revisions'
const HEADS_TABLE = 'operational_event_sink_heads'
const MUTATION_GUARD_FUNCTION = 'reject_operational_event_sink_revision_mutation'
const MUTATION_GUARD_TRIGGER = 'operational_event_sink_revisions_immutable'
const SHA256_BASE64URL_PATTERN = '^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'
const UTC_RFC3339_NANOSECOND_PATTERN =
  '^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9][.][0-9]{9}Z$'

const REVISION_CONSTRAINTS = Object.freeze([
  ['operational_event_sink_revisions_pkey', 'p'],
  ['operational_event_sink_revisions_chain_key', 'u'],
  ['operational_event_sink_revisions_head_key', 'u'],
  ['operational_event_sink_revisions_previous_fkey', 'f'],
  ['operational_event_sink_revisions_formats_check', 'c'],
  ['operational_event_sink_revisions_revision_check', 'c'],
  ['operational_event_sink_revisions_digests_check', 'c'],
  ['operational_event_sink_revisions_timestamps_check', 'c'],
  ['operational_event_sink_revisions_anchor_check', 'c'],
  ['operational_event_sink_revisions_events_check', 'c'],
  ['operational_event_sink_revisions_authority_check', 'c']
] as const)

const HEAD_CONSTRAINTS = Object.freeze([
  ['operational_event_sink_heads_pkey', 'p'],
  ['operational_event_sink_heads_revision_fkey', 'f'],
  ['operational_event_sink_heads_revision_check', 'c'],
  ['operational_event_sink_heads_digests_check', 'c'],
  ['operational_event_sink_heads_timestamps_check', 'c'],
  ['operational_event_sink_heads_domain_check', 'c']
] as const)

const INDEXES = Object.freeze([
  ['operational_event_sink_revisions_pkey', REVISIONS_TABLE, true, true, [1, 2]],
  [
    'operational_event_sink_revisions_chain_key',
    REVISIONS_TABLE,
    false,
    true,
    [1, 2, 5, 11, 12, 13, 26]
  ],
  [
    'operational_event_sink_revisions_head_key',
    REVISIONS_TABLE,
    false,
    true,
    [1, 2, 5, 6, 11, 12, 13, 26, 30]
  ],
  ['operational_event_sink_heads_pkey', HEADS_TABLE, true, true, [1]]
] as const)

export interface SupabaseOperationalEventSinkScopeV2 {
  readonly applicationObjectKey: string
  readonly applicationScopeDigest: string
  readonly schemaName: string
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function qualified(schemaName: string, objectName: string): string {
  return `${identifier(schemaName)}.${identifier(objectName)}`
}

function splitDigestLiteral(value: string): string {
  return `${literal(value.slice(0, 21))} || ${literal(value.slice(21))}`
}

function markerScopeKey(applicationScopeDigest: string): string {
  return `${applicationScopeDigest.slice(0, 21)}.${applicationScopeDigest.slice(21)}`
}

function markerPrefix(applicationScopeDigest: string): string {
  return `${SINK_MARKER_FORMAT};application-scope-digest-parts:${markerScopeKey(applicationScopeDigest)};`
}

function marker(applicationScopeDigest: string, object: string): string {
  return `${markerPrefix(applicationScopeDigest)}object=${object}`
}

export function resolveSupabaseOperationalEventSinkScopeV2(
  applicationId: string
): SupabaseOperationalEventSinkScopeV2 {
  const applicationScopeDigest = digestCanonicalBackendValue(
    {
      domain: 'openpencil.supabase-operational-event-sink-application.v1',
      applicationId
    },
    '$.supabaseObservability.operationalEventSink.applicationScopeDigest'
  )
  const applicationObjectKey = applicationScopeDigest.slice(0, 20).toLowerCase()
  return Object.freeze({
    applicationObjectKey,
    applicationScopeDigest,
    schemaName: `op_observability_${applicationObjectKey}`
  })
}

export function supabaseOperationalEventSinkSchemaNameV2(applicationId: string): string {
  return resolveSupabaseOperationalEventSinkScopeV2(applicationId).schemaName
}

function executionRolePreflight(): readonly string[] {
  return [
    'DO $openpencil_operational_event_sink_role$',
    'BEGIN',
    "  IF CURRENT_USER IN ('anon', 'authenticated', 'authenticator', 'postgres')",
    "    OR CURRENT_USER = ('service' || '_role')",
    '    OR EXISTS (',
    '      SELECT 1',
    '      FROM "pg_catalog"."pg_roles" AS "privileged_role"',
    '      WHERE ("privileged_role"."rolsuper" OR "privileged_role"."rolbypassrls")',
    '        AND "pg_catalog"."pg_has_role"(CURRENT_USER, "privileged_role"."oid", \'USAGE\')',
    '    ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'OpenPencil operational event sink DDL requires a dedicated non-API owner without superuser or BYPASSRLS authority.';",
    '  END IF;',
    'END',
    '$openpencil_operational_event_sink_role$;'
  ]
}

function inventoryPreflight(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  const prefix = markerPrefix(scope.applicationScopeDigest)
  return [
    'DO $openpencil_operational_event_sink_inventory$',
    'BEGIN',
    `  IF "pg_catalog"."to_regnamespace"(${literal(identifier(scope.schemaName))}) IS NOT NULL THEN`,
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil refuses to adopt or replace a pre-existing operational event sink schema, including a truncated-name collision.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_description" AS "prior_sink_marker"',
    `    WHERE LEFT("prior_sink_marker"."description", ${prefix.length}) = ${literal(prefix)}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil found a previously generated operational event sink; retirement or replacement requires explicit approval and a fresh inspected inventory.';",
    '  END IF;',
    'END',
    '$openpencil_operational_event_sink_inventory$;'
  ]
}

function revisionsTableDDL(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  const revisions = qualified(scope.schemaName, REVISIONS_TABLE)
  const digestPattern = literal(SHA256_BASE64URL_PATTERN)
  const timestampPattern = literal(UTC_RFC3339_NANOSECOND_PATTERN)
  return [
    `CREATE TABLE ${revisions} (`,
    '  "application_scope_digest" text NOT NULL,',
    '  "revision" bigint NOT NULL,',
    '  "expected_revision" bigint,',
    '  "expected_head_digest" text,',
    '  "next_head_digest" text NOT NULL,',
    '  "batch_digest" text NOT NULL,',
    '  "proposal_format" text NOT NULL,',
    '  "proposal_version" smallint NOT NULL,',
    '  "batch_format" text NOT NULL,',
    '  "batch_version" smallint NOT NULL,',
    '  "provider_id" text NOT NULL,',
    '  "environment" text NOT NULL,',
    '  "authority_digest" text NOT NULL,',
    '  "trusted_anchor_format" text NOT NULL,',
    '  "trusted_anchor_version" smallint NOT NULL,',
    '  "anchor_provider_id" text NOT NULL,',
    '  "anchor_environment" text NOT NULL,',
    '  "anchor_authority_digest" text NOT NULL,',
    '  "anchor_prior_segment_head_digest" text,',
    '  "anchor_prior_segment_last_occurred_at" text COLLATE "C",',
    '  "anchor_prior_segment_open_attempt_ids" text[] NOT NULL,',
    '  "anchor_trusted_head_digest" text NOT NULL,',
    '  "anchor_evaluated_at" text COLLATE "C" NOT NULL,',
    '  "segment_prior_head_digest" text,',
    '  "segment_head_digest" text NOT NULL,',
    '  "segment_last_occurred_at" text COLLATE "C" NOT NULL,',
    '  "event_count" smallint NOT NULL,',
    '  "ordered_event_digests" text[] NOT NULL,',
    '  "host_evaluated_at" text COLLATE "C" NOT NULL,',
    '  "observed_at" text COLLATE "C" NOT NULL,',
    '  "proposal_host_anchor_authenticated" boolean NOT NULL,',
    '  "proposal_persistence_authority_granted" boolean NOT NULL,',
    '  "proposal_export_authority_granted" boolean NOT NULL,',
    '  "proposal_alert_authority_granted" boolean NOT NULL,',
    '  "proposal_release_authority_granted" boolean NOT NULL,',
    '  "batch_host_anchor_authenticated" boolean NOT NULL,',
    '  "batch_persistence_authority_granted" boolean NOT NULL,',
    '  "batch_export_authority_granted" boolean NOT NULL,',
    '  "batch_alert_authority_granted" boolean NOT NULL,',
    '  "batch_release_authority_granted" boolean NOT NULL,',
    '  CONSTRAINT "operational_event_sink_revisions_pkey"',
    '    PRIMARY KEY ("application_scope_digest", "revision"),',
    '  CONSTRAINT "operational_event_sink_revisions_chain_key"',
    '    UNIQUE (',
    '      "application_scope_digest", "revision", "next_head_digest",',
    '      "provider_id", "environment", "authority_digest", "segment_last_occurred_at"',
    '    ),',
    '  CONSTRAINT "operational_event_sink_revisions_head_key"',
    '    UNIQUE (',
    '      "application_scope_digest", "revision", "next_head_digest", "batch_digest",',
    '      "provider_id", "environment", "authority_digest",',
    '      "segment_last_occurred_at", "observed_at"',
    '    ),',
    '  CONSTRAINT "operational_event_sink_revisions_previous_fkey"',
    '    FOREIGN KEY (',
    '      "application_scope_digest", "expected_revision", "expected_head_digest",',
    '      "provider_id", "environment", "authority_digest",',
    '      "anchor_prior_segment_last_occurred_at"',
    `    ) REFERENCES ${revisions} (`,
    '      "application_scope_digest", "revision", "next_head_digest",',
    '      "provider_id", "environment", "authority_digest", "segment_last_occurred_at"',
    '    )',
    '    MATCH SIMPLE DEFERRABLE INITIALLY DEFERRED,',
    '  CONSTRAINT "operational_event_sink_revisions_formats_check" CHECK (',
    `    "proposal_format" = ${literal(BACKEND_OPERATIONAL_EVENT_SINK_CAS_PROPOSAL_FORMAT)}`,
    `    AND "proposal_version" = ${BACKEND_OPERATIONAL_EVENT_SINK_VERSION}`,
    `    AND "batch_format" = ${literal(BACKEND_OPERATIONAL_EVENT_SINK_BATCH_FORMAT)}`,
    `    AND "batch_version" = ${BACKEND_OPERATIONAL_EVENT_SINK_VERSION}`,
    `    AND "trusted_anchor_format" = ${literal(BACKEND_OPERATIONAL_EVENT_ANCHOR_FORMAT)}`,
    `    AND "trusted_anchor_version" = ${BACKEND_OPERATIONAL_EVENT_VERSION}`,
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_revision_check" CHECK (',
    `    "application_scope_digest" = ${splitDigestLiteral(scope.applicationScopeDigest)}`,
    `    AND "revision" BETWEEN 0 AND ${BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION}`,
    '    AND (',
    '      (',
    '        "revision" = 0',
    '        AND "expected_revision" IS NULL',
    '        AND "expected_head_digest" IS NULL',
    '        AND "segment_prior_head_digest" IS NULL',
    '        AND "anchor_prior_segment_head_digest" IS NULL',
    '        AND "anchor_prior_segment_last_occurred_at" IS NULL',
    '      ) OR (',
    `        "revision" BETWEEN 1 AND ${BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION}`,
    '        AND "expected_revision" IS NOT NULL',
    '        AND "expected_revision" = "revision" - 1',
    '        AND "expected_head_digest" IS NOT NULL',
    '        AND "segment_prior_head_digest" IS NOT NULL',
    '        AND "anchor_prior_segment_head_digest" IS NOT NULL',
    '        AND "anchor_prior_segment_last_occurred_at" IS NOT NULL',
    '      )',
    '    )',
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_digests_check" CHECK (',
    `    "application_scope_digest" ~ ${digestPattern}`,
    `    AND "next_head_digest" ~ ${digestPattern}`,
    `    AND "batch_digest" ~ ${digestPattern}`,
    `    AND "authority_digest" ~ ${digestPattern}`,
    `    AND "anchor_authority_digest" ~ ${digestPattern}`,
    `    AND "anchor_trusted_head_digest" ~ ${digestPattern}`,
    `    AND "segment_head_digest" ~ ${digestPattern}`,
    `    AND ("expected_head_digest" IS NULL OR "expected_head_digest" ~ ${digestPattern})`,
    '    AND ("anchor_prior_segment_head_digest" IS NULL',
    `      OR "anchor_prior_segment_head_digest" ~ ${digestPattern})`,
    '    AND ("segment_prior_head_digest" IS NULL',
    `      OR "segment_prior_head_digest" ~ ${digestPattern})`,
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_timestamps_check" CHECK (',
    `    "anchor_evaluated_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(CAST("anchor_evaluated_at" AS timestamp with time zone))',
    `    AND "segment_last_occurred_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(CAST("segment_last_occurred_at" AS timestamp with time zone))',
    `    AND "host_evaluated_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(CAST("host_evaluated_at" AS timestamp with time zone))',
    `    AND "observed_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(CAST("observed_at" AS timestamp with time zone))',
    '    AND ("anchor_prior_segment_last_occurred_at" IS NULL OR (',
    `      "anchor_prior_segment_last_occurred_at" ~ ${timestampPattern}`,
    '      AND "pg_catalog"."isfinite"(',
    '        CAST("anchor_prior_segment_last_occurred_at" AS timestamp with time zone)',
    '      )',
    '    ))',
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_anchor_check" CHECK (',
    '    "provider_id" = \'supabase\'',
    "    AND \"environment\" IN ('preview', 'staging', 'production')",
    '    AND "anchor_provider_id" = "provider_id"',
    '    AND "anchor_environment" = "environment"',
    '    AND "anchor_authority_digest" = "authority_digest"',
    '    AND "expected_head_digest" IS NOT DISTINCT FROM "segment_prior_head_digest"',
    '    AND "expected_head_digest" IS NOT DISTINCT FROM "anchor_prior_segment_head_digest"',
    '    AND "next_head_digest" = "segment_head_digest"',
    '    AND "anchor_trusted_head_digest" = "segment_head_digest"',
    '    AND ("anchor_prior_segment_head_digest" IS NULL)',
    '      = ("anchor_prior_segment_last_occurred_at" IS NULL)',
    '    AND "anchor_prior_segment_open_attempt_ids" IS NOT NULL',
    '    AND "anchor_prior_segment_open_attempt_ids"',
    '      IS NOT DISTINCT FROM ARRAY[]::text[]',
    '    AND "pg_catalog"."cardinality"("anchor_prior_segment_open_attempt_ids") = 0',
    '    AND "host_evaluated_at" = "anchor_evaluated_at"',
    '    AND "observed_at" = "anchor_evaluated_at"',
    '    AND ("anchor_prior_segment_last_occurred_at" IS NULL',
    '      OR "anchor_prior_segment_last_occurred_at" <= "observed_at")',
    '    AND ("anchor_prior_segment_last_occurred_at" IS NULL',
    '      OR "anchor_prior_segment_last_occurred_at" <= "segment_last_occurred_at")',
    '    AND "segment_last_occurred_at" <= "host_evaluated_at"',
    '    AND "segment_last_occurred_at" <= "observed_at"',
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_events_check" CHECK (',
    `    "event_count" BETWEEN 1 AND ${BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS}`,
    '    AND "pg_catalog"."array_ndims"("ordered_event_digests") = 1',
    '    AND "pg_catalog"."array_lower"("ordered_event_digests", 1) = 1',
    '    AND "pg_catalog"."array_upper"("ordered_event_digests", 1) = "event_count"',
    '    AND "pg_catalog"."cardinality"("ordered_event_digests") = "event_count"',
    '    AND "pg_catalog"."array_position"("ordered_event_digests", NULL) IS NULL',
    `    AND "pg_catalog"."array_to_string"("ordered_event_digests", ':') ~ ${literal(`^(?:[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])(?::[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]){0,${BACKEND_OPERATIONAL_EVENT_MAX_SEGMENT_EVENTS - 1}}$`)}`,
    '    AND "ordered_event_digests"["event_count"] = "segment_head_digest"',
    '  ),',
    '  CONSTRAINT "operational_event_sink_revisions_authority_check" CHECK (',
    '    "proposal_host_anchor_authenticated" IS FALSE',
    '    AND "proposal_persistence_authority_granted" IS FALSE',
    '    AND "proposal_export_authority_granted" IS FALSE',
    '    AND "proposal_alert_authority_granted" IS FALSE',
    '    AND "proposal_release_authority_granted" IS FALSE',
    '    AND "batch_host_anchor_authenticated" IS FALSE',
    '    AND "batch_persistence_authority_granted" IS FALSE',
    '    AND "batch_export_authority_granted" IS FALSE',
    '    AND "batch_alert_authority_granted" IS FALSE',
    '    AND "batch_release_authority_granted" IS FALSE',
    '  )',
    ');'
  ]
}

function headsTableDDL(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  const revisions = qualified(scope.schemaName, REVISIONS_TABLE)
  const heads = qualified(scope.schemaName, HEADS_TABLE)
  const digestPattern = literal(SHA256_BASE64URL_PATTERN)
  const timestampPattern = literal(UTC_RFC3339_NANOSECOND_PATTERN)
  return [
    `CREATE TABLE ${heads} (`,
    '  "application_scope_digest" text NOT NULL,',
    '  "current_revision" bigint NOT NULL,',
    '  "current_head_digest" text NOT NULL,',
    '  "current_batch_digest" text NOT NULL,',
    '  "provider_id" text NOT NULL,',
    '  "environment" text NOT NULL,',
    '  "authority_digest" text NOT NULL,',
    '  "current_segment_last_occurred_at" text COLLATE "C" NOT NULL,',
    '  "observed_at" text COLLATE "C" NOT NULL,',
    '  CONSTRAINT "operational_event_sink_heads_pkey" PRIMARY KEY ("application_scope_digest"),',
    '  CONSTRAINT "operational_event_sink_heads_revision_fkey"',
    '    FOREIGN KEY (',
    '      "application_scope_digest", "current_revision", "current_head_digest",',
    '      "current_batch_digest", "provider_id", "environment", "authority_digest",',
    '      "current_segment_last_occurred_at", "observed_at"',
    `    ) REFERENCES ${revisions} (`,
    '      "application_scope_digest", "revision", "next_head_digest",',
    '      "batch_digest", "provider_id", "environment", "authority_digest",',
    '      "segment_last_occurred_at", "observed_at"',
    '    ) MATCH FULL DEFERRABLE INITIALLY DEFERRED,',
    '  CONSTRAINT "operational_event_sink_heads_revision_check" CHECK (',
    `    "application_scope_digest" = ${splitDigestLiteral(scope.applicationScopeDigest)}`,
    `    AND "current_revision" BETWEEN 0 AND ${BACKEND_OPERATIONAL_EVENT_SINK_MAX_REVISION}`,
    '  ),',
    '  CONSTRAINT "operational_event_sink_heads_digests_check" CHECK (',
    `    "application_scope_digest" ~ ${digestPattern}`,
    `    AND "current_head_digest" ~ ${digestPattern}`,
    `    AND "current_batch_digest" ~ ${digestPattern}`,
    `    AND "authority_digest" ~ ${digestPattern}`,
    '  ),',
    '  CONSTRAINT "operational_event_sink_heads_timestamps_check" CHECK (',
    `    "current_segment_last_occurred_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(',
    '      CAST("current_segment_last_occurred_at" AS timestamp with time zone)',
    '    )',
    `    AND "observed_at" ~ ${timestampPattern}`,
    '    AND "pg_catalog"."isfinite"(CAST("observed_at" AS timestamp with time zone))',
    '  ),',
    '  CONSTRAINT "operational_event_sink_heads_domain_check" CHECK (',
    '    "provider_id" = \'supabase\'',
    "    AND \"environment\" IN ('preview', 'staging', 'production')",
    '    AND "current_segment_last_occurred_at" <= "observed_at"',
    '  )',
    ');'
  ]
}

function mutationGuardDDL(schemaName: string): readonly string[] {
  const revisions = qualified(schemaName, REVISIONS_TABLE)
  const guard = qualified(schemaName, MUTATION_GUARD_FUNCTION)
  return [
    `CREATE FUNCTION ${guard}()`,
    'RETURNS trigger',
    'LANGUAGE plpgsql',
    'VOLATILE',
    'SECURITY INVOKER',
    'SET search_path = pg_catalog',
    'AS $openpencil_operational_event_sink_revision_guard$',
    'BEGIN',
    "  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink revisions are append-only; mutation and retirement require explicit approval.';",
    'END',
    '$openpencil_operational_event_sink_revision_guard$;',
    `CREATE TRIGGER ${identifier(MUTATION_GUARD_TRIGGER)}`,
    `BEFORE UPDATE OR DELETE OR TRUNCATE ON ${revisions}`,
    'FOR EACH STATEMENT',
    `EXECUTE FUNCTION ${guard}();`
  ]
}

function comments(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  const revisions = qualified(scope.schemaName, REVISIONS_TABLE)
  const heads = qualified(scope.schemaName, HEADS_TABLE)
  const guard = qualified(scope.schemaName, MUTATION_GUARD_FUNCTION)
  return [
    `COMMENT ON SCHEMA ${identifier(scope.schemaName)} IS ${literal(marker(scope.applicationScopeDigest, 'schema'))};`,
    `COMMENT ON TABLE ${revisions} IS ${literal(marker(scope.applicationScopeDigest, 'table:revisions'))};`,
    `COMMENT ON TABLE ${heads} IS ${literal(marker(scope.applicationScopeDigest, 'table:heads'))};`,
    `COMMENT ON FUNCTION ${guard}() IS ${literal(marker(scope.applicationScopeDigest, 'function:revision-mutation-guard'))};`,
    `COMMENT ON TRIGGER ${identifier(MUTATION_GUARD_TRIGGER)} ON ${revisions} IS ${literal(marker(scope.applicationScopeDigest, 'trigger:revision-immutability'))};`,
    ...REVISION_CONSTRAINTS.map(
      ([constraintName]) =>
        `COMMENT ON CONSTRAINT ${identifier(constraintName)} ON ${revisions} IS ${literal(marker(scope.applicationScopeDigest, `constraint:${constraintName}`))};`
    ),
    ...HEAD_CONSTRAINTS.map(
      ([constraintName]) =>
        `COMMENT ON CONSTRAINT ${identifier(constraintName)} ON ${heads} IS ${literal(marker(scope.applicationScopeDigest, `constraint:${constraintName}`))};`
    ),
    ...INDEXES.map(
      ([indexName]) =>
        `COMMENT ON INDEX ${qualified(scope.schemaName, indexName)} IS ${literal(marker(scope.applicationScopeDigest, `index:${indexName}`))};`
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
    'DO $openpencil_operational_event_sink_api_role_revoke$',
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
    '$openpencil_operational_event_sink_api_role_revoke$;'
  ]
}

type ColumnExpectation = readonly [string, number, string, string, boolean]

function expectedColumnRows(): readonly string[] {
  const revisions: readonly ColumnExpectation[] = [
    [REVISIONS_TABLE, 1, 'application_scope_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 2, 'revision', 'pg_catalog.int8', true],
    [REVISIONS_TABLE, 3, 'expected_revision', 'pg_catalog.int8', false],
    [REVISIONS_TABLE, 4, 'expected_head_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 5, 'next_head_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 6, 'batch_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 7, 'proposal_format', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 8, 'proposal_version', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 9, 'batch_format', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 10, 'batch_version', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 11, 'provider_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 12, 'environment', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 13, 'authority_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 14, 'trusted_anchor_format', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 15, 'trusted_anchor_version', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 16, 'anchor_provider_id', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 17, 'anchor_environment', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 18, 'anchor_authority_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 19, 'anchor_prior_segment_head_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 20, 'anchor_prior_segment_last_occurred_at', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 21, 'anchor_prior_segment_open_attempt_ids', 'pg_catalog.text[]', true],
    [REVISIONS_TABLE, 22, 'anchor_trusted_head_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 23, 'anchor_evaluated_at', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 24, 'segment_prior_head_digest', 'pg_catalog.text', false],
    [REVISIONS_TABLE, 25, 'segment_head_digest', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 26, 'segment_last_occurred_at', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 27, 'event_count', 'pg_catalog.int2', true],
    [REVISIONS_TABLE, 28, 'ordered_event_digests', 'pg_catalog.text[]', true],
    [REVISIONS_TABLE, 29, 'host_evaluated_at', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 30, 'observed_at', 'pg_catalog.text', true],
    [REVISIONS_TABLE, 31, 'proposal_host_anchor_authenticated', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 32, 'proposal_persistence_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 33, 'proposal_export_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 34, 'proposal_alert_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 35, 'proposal_release_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 36, 'batch_host_anchor_authenticated', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 37, 'batch_persistence_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 38, 'batch_export_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 39, 'batch_alert_authority_granted', 'pg_catalog.bool', true],
    [REVISIONS_TABLE, 40, 'batch_release_authority_granted', 'pg_catalog.bool', true]
  ]
  const heads: readonly ColumnExpectation[] = [
    [HEADS_TABLE, 1, 'application_scope_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 2, 'current_revision', 'pg_catalog.int8', true],
    [HEADS_TABLE, 3, 'current_head_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 4, 'current_batch_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 5, 'provider_id', 'pg_catalog.text', true],
    [HEADS_TABLE, 6, 'environment', 'pg_catalog.text', true],
    [HEADS_TABLE, 7, 'authority_digest', 'pg_catalog.text', true],
    [HEADS_TABLE, 8, 'current_segment_last_occurred_at', 'pg_catalog.text', true],
    [HEADS_TABLE, 9, 'observed_at', 'pg_catalog.text', true]
  ]
  return [...revisions, ...heads].map(
    ([tableName, ordinal, columnName, typeName, notNull]) =>
      `      (${literal(tableName)}, ${ordinal}, ${literal(columnName)}, "pg_catalog"."to_regtype"(${literal(typeName)}), ${notNull ? 'TRUE' : 'FALSE'})`
  )
}

function expectedConstraintRows(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  return [
    ...REVISION_CONSTRAINTS.map((entry) => [REVISIONS_TABLE, ...entry] as const),
    ...HEAD_CONSTRAINTS.map((entry) => [HEADS_TABLE, ...entry] as const)
  ].map(
    ([tableName, constraintName, constraintType]) =>
      `      (${literal(tableName)}, ${literal(constraintName)}, ${literal(constraintType)}, ${literal(marker(scope.applicationScopeDigest, `constraint:${constraintName}`))})`
  )
}

function expectedIndexRows(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  return INDEXES.map(
    ([indexName, tableName, primary, , columns]) =>
      `      (${literal(indexName)}, ${literal(tableName)}, ${primary ? 'TRUE' : 'FALSE'}, TRUE, ARRAY[${columns.join(', ')}]::smallint[], ${literal(marker(scope.applicationScopeDigest, `index:${indexName}`))})`
  )
}

function catalogPostcondition(scope: SupabaseOperationalEventSinkScopeV2): readonly string[] {
  const revisionsRegclass = literal(
    `${identifier(scope.schemaName)}.${identifier(REVISIONS_TABLE)}`
  )
  const headsRegclass = literal(`${identifier(scope.schemaName)}.${identifier(HEADS_TABLE)}`)
  const guardRegprocedure = literal(
    `${identifier(scope.schemaName)}.${identifier(MUTATION_GUARD_FUNCTION)}()`
  )
  const allowedRelations = [REVISIONS_TABLE, HEADS_TABLE, ...INDEXES.map(([name]) => name)]
  return [
    'DO $openpencil_operational_event_sink_postcondition$',
    'DECLARE',
    '  expected_owner oid := (',
    '    SELECT "database_role"."oid"',
    '    FROM "pg_catalog"."pg_roles" AS "database_role"',
    '    WHERE "database_role"."rolname" = CURRENT_USER',
    '  );',
    `  sink_namespace oid := "pg_catalog"."to_regnamespace"(${literal(identifier(scope.schemaName))});`,
    `  revisions_table regclass := "pg_catalog"."to_regclass"(${revisionsRegclass});`,
    `  heads_table regclass := "pg_catalog"."to_regclass"(${headsRegclass});`,
    `  guard_function regprocedure := "pg_catalog"."to_regprocedure"(${guardRegprocedure});`,
    'BEGIN',
    '  IF expected_owner IS NULL OR sink_namespace IS NULL OR revisions_table IS NULL',
    '    OR heads_table IS NULL OR guard_function IS NULL THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink object resolution postcondition failed.';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS "sink_schema"',
    '    WHERE "sink_schema"."oid" = sink_namespace',
    `      AND "sink_schema"."nspname" = ${literal(scope.schemaName)}`,
    '      AND "sink_schema"."nspowner" = expected_owner',
    `      AND "pg_catalog"."obj_description"("sink_schema"."oid", 'pg_namespace') = ${literal(marker(scope.applicationScopeDigest, 'schema'))}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink schema ownership/marker postcondition failed.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_class" AS "sink_relation"',
    '    WHERE "sink_relation"."relnamespace" = sink_namespace',
    `  ) <> ${allowedRelations.length} OR EXISTS (`,
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "sink_relation"',
    '    WHERE "sink_relation"."relnamespace" = sink_namespace',
    '      AND (',
    '        "sink_relation"."relowner" <> expected_owner',
    `        OR ("sink_relation"."relkind" = 'r' AND "sink_relation"."relname" NOT IN (${literal(REVISIONS_TABLE)}, ${literal(HEADS_TABLE)}))`,
    `        OR ("sink_relation"."relkind" = 'i' AND "sink_relation"."relname" NOT IN (${INDEXES.map(([name]) => literal(name)).join(', ')}))`,
    '        OR "sink_relation"."relkind" NOT IN (\'r\', \'i\')',
    '      )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink relation inventory postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedColumnRows().map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_column"("table_name", "ordinal", "column_name", "type_oid", "not_null")',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "table_relation"."relname" AS "table_name",',
    '        "table_column"."attnum"::integer AS "ordinal",',
    '        "table_column"."attname" AS "column_name",',
    '        "table_column"."atttypid" AS "type_oid",',
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
    '      OR "actual_column"."not_null" <> "expected_column"."not_null"',
    '      OR "actual_column"."has_default"',
    '      OR "actual_column"."identity_kind" <> \'\'',
    '      OR "actual_column"."generated_kind" <> \'\'',
    '      OR "actual_column"."column_acl" IS NOT NULL',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink column catalog postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_attribute" AS "timestamp_column"',
    '    WHERE "timestamp_column"."attrelid" IN (revisions_table, heads_table)',
    '      AND "timestamp_column"."attnum" > 0',
    '      AND NOT "timestamp_column"."attisdropped"',
    '      AND (',
    '        ("timestamp_column"."attrelid" = revisions_table',
    '          AND "timestamp_column"."attname" IN (',
    "            'anchor_prior_segment_last_occurred_at', 'anchor_evaluated_at',",
    "            'segment_last_occurred_at', 'host_evaluated_at', 'observed_at'",
    '          ))',
    '        OR ("timestamp_column"."attrelid" = heads_table',
    '          AND "timestamp_column"."attname" IN (',
    "            'current_segment_last_occurred_at', 'observed_at'",
    '          ))',
    '      )',
    '      AND "timestamp_column"."attcollation" IS DISTINCT FROM',
    '        "pg_catalog"."to_regcollation"(\'pg_catalog."C"\')',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink canonical timestamp collation postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedConstraintRows(scope).map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_constraint"("table_name", "constraint_name", "constraint_type", "marker")',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "constraint_table"."relname" AS "table_name",',
    '        "table_constraint"."conname" AS "constraint_name",',
    '        "table_constraint"."contype"::text AS "constraint_type",',
    '        "pg_catalog"."obj_description"("table_constraint"."oid", \'pg_constraint\') AS "marker",',
    '        "table_constraint"."convalidated" AS "validated",',
    '        "table_constraint"."connoinherit" AS "no_inherit"',
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
    '      OR "actual_constraint"."no_inherit"',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink constraint catalog postcondition failed.';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_constraint" AS "chain_constraint"',
    '    WHERE "chain_constraint"."conrelid" = revisions_table',
    '      AND "chain_constraint"."conname" = \'operational_event_sink_revisions_previous_fkey\'',
    '      AND "chain_constraint"."confrelid" = revisions_table',
    '      AND "chain_constraint"."conkey" = ARRAY[1, 3, 4, 11, 12, 13, 20]::smallint[]',
    '      AND "chain_constraint"."confkey" = ARRAY[1, 2, 5, 11, 12, 13, 26]::smallint[]',
    '      AND "chain_constraint"."condeferrable"',
    '      AND "chain_constraint"."condeferred"',
    '      AND "chain_constraint"."confmatchtype" = \'s\'',
    '      AND "chain_constraint"."confupdtype" = \'a\'',
    '      AND "chain_constraint"."confdeltype" = \'a\'',
    '  ) OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_constraint" AS "head_constraint"',
    '    WHERE "head_constraint"."conrelid" = heads_table',
    '      AND "head_constraint"."conname" = \'operational_event_sink_heads_revision_fkey\'',
    '      AND "head_constraint"."confrelid" = revisions_table',
    '      AND "head_constraint"."conkey" = ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 9]::smallint[]',
    '      AND "head_constraint"."confkey" = ARRAY[1, 2, 5, 6, 11, 12, 13, 26, 30]::smallint[]',
    '      AND "head_constraint"."condeferrable"',
    '      AND "head_constraint"."condeferred"',
    '      AND "head_constraint"."confmatchtype" = \'f\'',
    '      AND "head_constraint"."confupdtype" = \'a\'',
    '      AND "head_constraint"."confdeltype" = \'a\'',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink CAS key/chain foreign-key postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM (VALUES',
    ...expectedIndexRows(scope).map(
      (row, index, rows) => `${row}${index + 1 === rows.length ? '' : ','}`
    ),
    '    ) AS "expected_index"("index_name", "table_name", "primary", "unique_index", "key_columns", "marker")',
    '    FULL OUTER JOIN (',
    '      SELECT',
    '        "index_relation"."relname" AS "index_name",',
    '        "table_relation"."relname" AS "table_name",',
    '        "table_index"."indisprimary" AS "primary",',
    '        "table_index"."indisunique" AS "unique_index",',
    '        "table_index"."indkey"::smallint[] AS "key_columns",',
    '        "pg_catalog"."obj_description"("index_relation"."oid", \'pg_class\') AS "marker",',
    '        "table_index"."indisvalid" AS "valid",',
    '        "table_index"."indisready" AS "ready",',
    '        "table_index"."indislive" AS "live",',
    '        "table_index"."indexprs" AS "expressions",',
    '        "table_index"."indpred" AS "predicate"',
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
    '      OR "actual_index"."marker" IS DISTINCT FROM "expected_index"."marker"',
    '      OR NOT "actual_index"."valid"',
    '      OR NOT "actual_index"."ready"',
    '      OR NOT "actual_index"."live"',
    '      OR "actual_index"."expressions" IS NOT NULL',
    '      OR "actual_index"."predicate" IS NOT NULL',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink index catalog postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "sink_table"',
    '    INNER JOIN "pg_catalog"."pg_am" AS "table_access_method"',
    '      ON "table_access_method"."oid" = "sink_table"."relam"',
    '    WHERE "sink_table"."oid" IN (revisions_table, heads_table)',
    '      AND (',
    '        "sink_table"."relkind" <> \'r\'',
    '        OR "sink_table"."relpersistence" <> \'p\'',
    '        OR "sink_table"."relispartition"',
    '        OR "sink_table"."relowner" <> expected_owner',
    '        OR "sink_table"."relrowsecurity"',
    '        OR "sink_table"."relforcerowsecurity"',
    '        OR "sink_table"."relreplident" <> \'d\'',
    '        OR "table_access_method"."amname" <> \'heap\'',
    '      )',
    `  ) OR "pg_catalog"."obj_description"(revisions_table, 'pg_class') IS DISTINCT FROM ${literal(marker(scope.applicationScopeDigest, 'table:revisions'))}`,
    `    OR "pg_catalog"."obj_description"(heads_table, 'pg_class') IS DISTINCT FROM ${literal(marker(scope.applicationScopeDigest, 'table:heads'))}`,
    '    OR EXISTS (',
    '      SELECT 1 FROM "pg_catalog"."pg_policy" AS "sink_policy"',
    '      WHERE "sink_policy"."polrelid" IN (revisions_table, heads_table)',
    '    )',
    '  THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink table shape/ownership/marker postcondition failed.';",
    '  END IF;',
    '  IF (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_proc" AS "sink_function"',
    '    WHERE "sink_function"."pronamespace" = sink_namespace',
    '  ) <> 1 OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_proc" AS "guard_proc"',
    '    INNER JOIN "pg_catalog"."pg_language" AS "function_language"',
    '      ON "function_language"."oid" = "guard_proc"."prolang"',
    '    WHERE "guard_proc"."oid" = guard_function',
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
    '      AND "function_language"."lanname" = \'plpgsql\'',
    `      AND "pg_catalog"."obj_description"("guard_proc"."oid", 'pg_proc') = ${literal(marker(scope.applicationScopeDigest, 'function:revision-mutation-guard'))}`,
    '  ) OR (',
    '    SELECT "pg_catalog"."count"(*)',
    '    FROM "pg_catalog"."pg_trigger" AS "sink_trigger"',
    '    WHERE "sink_trigger"."tgrelid" IN (revisions_table, heads_table)',
    '      AND NOT "sink_trigger"."tgisinternal"',
    '  ) <> 1 OR NOT EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_trigger" AS "guard_trigger"',
    '    WHERE "guard_trigger"."tgrelid" = revisions_table',
    `      AND "guard_trigger"."tgname" = ${literal(MUTATION_GUARD_TRIGGER)}`,
    '      AND NOT "guard_trigger"."tgisinternal"',
    '      AND "guard_trigger"."tgenabled" = \'O\'',
    '      AND "guard_trigger"."tgtype" = 58',
    '      AND "guard_trigger"."tgfoid" = guard_function',
    `      AND "pg_catalog"."obj_description"("guard_trigger"."oid", 'pg_trigger') = ${literal(marker(scope.applicationScopeDigest, 'trigger:revision-immutability'))}`,
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'OpenPencil operational event sink revision immutability guard postcondition failed.';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_namespace" AS "sink_schema"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("sink_schema"."nspacl", "pg_catalog"."acldefault"(\'n\', "sink_schema"."nspowner"))',
    '    ) AS "schema_acl"',
    '    WHERE "sink_schema"."oid" = sink_namespace',
    '      AND "schema_acl"."grantee" <> "sink_schema"."nspowner"',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_class" AS "sink_table"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("sink_table"."relacl", "pg_catalog"."acldefault"(\'r\', "sink_table"."relowner"))',
    '    ) AS "table_acl"',
    '    WHERE "sink_table"."oid" IN (revisions_table, heads_table)',
    '      AND "table_acl"."grantee" <> "sink_table"."relowner"',
    '  ) OR EXISTS (',
    '    SELECT 1',
    '    FROM "pg_catalog"."pg_proc" AS "guard_proc"',
    '    CROSS JOIN LATERAL "pg_catalog"."aclexplode"(',
    '      COALESCE("guard_proc"."proacl", "pg_catalog"."acldefault"(\'f\', "guard_proc"."proowner"))',
    '    ) AS "function_acl"',
    '    WHERE "guard_proc"."oid" = guard_function',
    '      AND "function_acl"."grantee" <> "guard_proc"."proowner"',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A non-owner retains a direct privilege on an OpenPencil operational event sink object.';",
    '  END IF;',
    '  IF EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    '    WHERE "pg_catalog"."has_schema_privilege"("known_role"."role_name", sink_namespace, \'USAGE\')',
    '      OR "pg_catalog"."has_schema_privilege"("known_role"."role_name", sink_namespace, \'CREATE\')',
    '  ) OR EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    "    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS \"table_privilege\"(\"privilege_name\")",
    '    CROSS JOIN (VALUES (revisions_table), (heads_table)) AS "sink_table"("table_oid")',
    '    WHERE "pg_catalog"."has_table_privilege"(',
    '      "known_role"."role_name", "sink_table"."table_oid", "table_privilege"."privilege_name"',
    '    )',
    '  ) OR EXISTS (',
    `    SELECT 1 FROM (VALUES ('anon'), ('authenticated'), ('authenticator'), ('service' || '_role')) AS "known_role"("role_name")`,
    '    WHERE "pg_catalog"."has_function_privilege"(',
    '      "known_role"."role_name", guard_function, \'EXECUTE\'',
    '    )',
    '  ) THEN',
    "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'A known Supabase API role retains effective access to an OpenPencil operational event sink object.';",
    '  END IF;',
    'END',
    '$openpencil_operational_event_sink_postcondition$;'
  ]
}

/**
 * Deterministic one-shot private schema DDL for review. It emits neither event payloads nor a CAS
 * writer; a trusted Host must authenticate, persist, and receipt the exact proposal separately.
 */
export function emitSupabaseOperationalEventSinkReviewSQLV2(applicationId: string): string {
  const scope = resolveSupabaseOperationalEventSinkScopeV2(applicationId)
  const lines = [
    '-- OpenPencil Supabase operational event sink schema candidate v1.',
    '-- Review only. This artifact has no credential, connection, Apply, Verify, or Release authority.',
    '-- Expected catalog inventory is unverified until a trusted post-apply Receipt accepts it.',
    '-- No event payload, DML writer, network transport, telemetry drain, retention runner, or alert sender is emitted.',
    '-- Release timestamps are Host-projected without rounding to fixed YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ text by zero-padding the optional fraction.',
    '-- Timestamp casts validate calendar/finite input only; exact values and ordering remain C-collated text so nanoseconds are not truncated.',
    '-- segment_last_occurred_at is projected from the final strictly verified event; this payload-free schema binds but cannot recompute that claim.',
    '-- The schema is expected to remain absent from PostgREST exposed schemas; that inventory is unverified until the trusted Receipt.',
    '-- Existing generated objects and every retirement or replacement operation require explicit approval.',
    'BEGIN;',
    'SET LOCAL search_path = pg_catalog;',
    ...executionRolePreflight(),
    ...inventoryPreflight(scope),
    `CREATE SCHEMA ${identifier(scope.schemaName)} AUTHORIZATION CURRENT_USER;`,
    ...revisionsTableDDL(scope),
    ...headsTableDDL(scope),
    ...mutationGuardDDL(scope.schemaName),
    ...comments(scope),
    ...revokeDDL(scope.schemaName),
    ...catalogPostcondition(scope),
    'COMMIT;',
    ''
  ]
  return lines.join('\n')
}
