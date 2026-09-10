/* eslint-disable max-lines -- fixed catalog SQL and strict inert decoders stay co-located */

import {
  createSupabaseBackfillInspectionSubjectV1,
  type BackendProviderPlanV2,
  type BackendProviderRegistryV2,
  type BackendProviderSelectionV2,
  type SupabaseBackfillInspectionSubjectEnvelopeV1,
  type SupabaseBackfillInspectionSubjectV1
} from '@open-pencil/compiler/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import type {
  SupabaseManagementAccountAuthorityV1,
  SupabaseManagementProjectAuthorityV1
} from '@/app/lowcode/supabase/management-client'

export const SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION =
  'openpencil-supabase-backfill-live-catalog-v1' as const
export const SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID = 'backfill-live-catalog' as const
export const SUPABASE_BACKFILL_LIVE_CATALOG_INSPECTION_FORMAT =
  'openpencil.supabase-backfill-live-catalog-inspection.v1' as const

export const SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER = Object.freeze([
  'schema',
  'table',
  'entityMarker',
  'cursorField',
  'cursorMarker',
  'primaryKeyMarker',
  'targetField',
  'targetMarker',
  'subjectDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest'
] as const)

/**
 * One fixed statement over pg_catalog only. It deliberately does not read the
 * managed table, calculate MAX(cursor), acquire locks, or create execution state.
 */
export const SUPABASE_BACKFILL_LIVE_CATALOG_SQL = `WITH "requested" AS (
  SELECT
    $1::"pg_catalog"."name" AS "schema_name",
    $2::"pg_catalog"."name" AS "table_name",
    $3::"pg_catalog"."text" AS "entity_marker",
    $4::"pg_catalog"."name" AS "cursor_field",
    $5::"pg_catalog"."text" AS "cursor_marker",
    $6::"pg_catalog"."text" AS "primary_key_marker",
    $7::"pg_catalog"."name" AS "target_field",
    $8::"pg_catalog"."text" AS "target_marker",
    $9::"pg_catalog"."text" AS "subject_digest",
    $10::"pg_catalog"."text" AS "project_ref",
    $11::"pg_catalog"."text" AS "account_id",
    $12::"pg_catalog"."text" AS "grant_generation",
    $13::"pg_catalog"."text" AS "query_version",
    $14::"pg_catalog"."text" AS "query_digest"
),
"managed_table" AS (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspname" AS "schema_name",
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "table_owner"."rolname" AS "owner_name",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relacl" AS "table_acl",
    "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') AS "marker"
  FROM "pg_catalog"."pg_class" AS "table_entry"
  JOIN "pg_catalog"."pg_namespace" AS "namespace_entry"
    ON "namespace_entry"."oid" = "table_entry"."relnamespace"
  JOIN "pg_catalog"."pg_roles" AS "table_owner"
    ON "table_owner"."oid" = "table_entry"."relowner"
  CROSS JOIN "requested"
  WHERE "namespace_entry"."nspname" = "requested"."schema_name"
    AND "table_entry"."relname" = "requested"."table_name"
    AND "table_entry"."relkind" = 'r'
    AND "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') =
      "requested"."entity_marker"
),
"cursor_column" AS (
  SELECT
    "column_entry"."attrelid" AS "table_oid",
    "column_entry"."attnum" AS "sub_id",
    "column_entry"."attname" AS "column_name",
    "column_entry"."atttypid" AS "type_oid",
    "type_namespace"."nspname" AS "type_schema",
    "type_entry"."typname" AS "type_name",
    "column_entry"."atttypmod" AS "type_modifier",
    "column_entry"."attnotnull" AS "not_null",
    "column_entry"."attidentity" AS "identity_kind",
    "column_entry"."attgenerated" AS "generated_kind",
    "pg_catalog"."col_description"("column_entry"."attrelid", "column_entry"."attnum") AS "marker"
  FROM "pg_catalog"."pg_attribute" AS "column_entry"
  JOIN "managed_table" ON "managed_table"."table_oid" = "column_entry"."attrelid"
  JOIN "pg_catalog"."pg_type" AS "type_entry"
    ON "type_entry"."oid" = "column_entry"."atttypid"
  JOIN "pg_catalog"."pg_namespace" AS "type_namespace"
    ON "type_namespace"."oid" = "type_entry"."typnamespace"
  CROSS JOIN "requested"
  WHERE "column_entry"."attname" = "requested"."cursor_field"
    AND "column_entry"."attnum" > 0
    AND NOT "column_entry"."attisdropped"
    AND "pg_catalog"."col_description"("column_entry"."attrelid", "column_entry"."attnum") =
      "requested"."cursor_marker"
),
"target_column" AS (
  SELECT
    "column_entry"."attrelid" AS "table_oid",
    "column_entry"."attnum" AS "sub_id",
    "column_entry"."attname" AS "column_name",
    "column_entry"."atttypid" AS "type_oid",
    "type_namespace"."oid" AS "type_schema_oid",
    "type_namespace"."nspname" AS "type_schema",
    "type_entry"."typname" AS "type_name",
    "type_entry"."typtype" AS "type_kind",
    "column_entry"."atttypmod" AS "type_modifier",
    "column_entry"."attnotnull" AS "not_null",
    "column_entry"."attidentity" AS "identity_kind",
    "column_entry"."attgenerated" AS "generated_kind",
    "column_default"."oid" IS NOT NULL AS "has_default",
    "pg_catalog"."col_description"("column_entry"."attrelid", "column_entry"."attnum") AS "marker",
    "pg_catalog"."obj_description"("type_entry"."oid", 'pg_type') AS "enum_marker",
    COALESCE((
      SELECT "pg_catalog"."jsonb_agg"("enum_entry"."enumlabel" ORDER BY "enum_entry"."enumsortorder")
      FROM "pg_catalog"."pg_enum" AS "enum_entry"
      WHERE "enum_entry"."enumtypid" = "type_entry"."oid"
    ), '[]'::"pg_catalog"."jsonb") AS "enum_values"
  FROM "pg_catalog"."pg_attribute" AS "column_entry"
  JOIN "managed_table" ON "managed_table"."table_oid" = "column_entry"."attrelid"
  JOIN "pg_catalog"."pg_type" AS "type_entry"
    ON "type_entry"."oid" = "column_entry"."atttypid"
  JOIN "pg_catalog"."pg_namespace" AS "type_namespace"
    ON "type_namespace"."oid" = "type_entry"."typnamespace"
  LEFT JOIN "pg_catalog"."pg_attrdef" AS "column_default"
    ON "column_default"."adrelid" = "column_entry"."attrelid"
   AND "column_default"."adnum" = "column_entry"."attnum"
  CROSS JOIN "requested"
  WHERE "column_entry"."attname" = "requested"."target_field"
    AND "column_entry"."attnum" > 0
    AND NOT "column_entry"."attisdropped"
    AND "pg_catalog"."col_description"("column_entry"."attrelid", "column_entry"."attnum") =
      "requested"."target_marker"
),
"primary_key" AS (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "constraint_entry"."conrelid" AS "table_oid",
    "constraint_entry"."conname" AS "constraint_name",
    "pg_catalog"."cardinality"("constraint_entry"."conkey") AS "field_count",
    "cursor_column"."sub_id" AS "cursor_sub_id",
    "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') AS "marker"
  FROM "pg_catalog"."pg_constraint" AS "constraint_entry"
  JOIN "managed_table" ON "managed_table"."table_oid" = "constraint_entry"."conrelid"
  JOIN "cursor_column" ON "cursor_column"."table_oid" = "constraint_entry"."conrelid"
  CROSS JOIN "requested"
  WHERE "constraint_entry"."contype" = 'p'
    AND "constraint_entry"."conkey" =
      ARRAY["cursor_column"."sub_id"]::"pg_catalog"."int2"[]
    AND "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') =
      "requested"."primary_key_marker"
),
"identity_sequence" AS (
  SELECT
    "sequence_entry"."oid" AS "sequence_oid",
    "sequence_namespace"."oid" AS "sequence_schema_oid",
    "sequence_namespace"."nspname" AS "sequence_schema",
    "sequence_entry"."relname" AS "sequence_name",
    "sequence_dependency"."deptype" AS "dependency_type",
    "sequence_state"."seqincrement" AS "increment_by",
    "sequence_state"."seqmin" AS "minimum_value",
    "sequence_state"."seqmax" AS "maximum_value",
    "sequence_state"."seqcache" AS "cache_size",
    "sequence_state"."seqcycle" AS "cycle",
    "cursor_column"."table_oid" AS "owned_table_oid",
    "cursor_column"."sub_id" AS "owned_sub_id"
  FROM "cursor_column"
  JOIN "pg_catalog"."pg_depend" AS "sequence_dependency"
    ON "sequence_dependency"."refobjid" = "cursor_column"."table_oid"
   AND "sequence_dependency"."refobjsubid" = "cursor_column"."sub_id"
   AND "sequence_dependency"."deptype" = 'i'
   AND "sequence_dependency"."classid" = 'pg_catalog.pg_class'::"pg_catalog"."regclass"
   AND "sequence_dependency"."refclassid" = 'pg_catalog.pg_class'::"pg_catalog"."regclass"
  JOIN "pg_catalog"."pg_class" AS "sequence_entry"
    ON "sequence_entry"."oid" = "sequence_dependency"."objid"
   AND "sequence_entry"."relkind" = 'S'
  JOIN "pg_catalog"."pg_namespace" AS "sequence_namespace"
    ON "sequence_namespace"."oid" = "sequence_entry"."relnamespace"
  JOIN "pg_catalog"."pg_sequence" AS "sequence_state"
    ON "sequence_state"."seqrelid" = "sequence_entry"."oid"
),
"current_role_entry" AS (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = CURRENT_USER
),
"session_role_entry" AS (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = SESSION_USER
),
"hazards" AS (
  SELECT
    (SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "entry"."conrelid" = "managed_table"."table_oid"
        AND "entry"."contype" IN ('u', 'x'))::"pg_catalog"."int4" AS
      "non_primary_unique_or_exclusion_constraint_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_index" AS "entry"
      WHERE "entry"."indrelid" = "managed_table"."table_oid"
        AND NOT "entry"."indisprimary")::"pg_catalog"."int4" AS "non_primary_index_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_index" AS "entry"
      WHERE "entry"."indrelid" = "managed_table"."table_oid"
        AND ("entry"."indpred" IS NOT NULL OR "entry"."indexprs" IS NOT NULL))::
      "pg_catalog"."int4" AS "partial_or_expression_index_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "entry"."conrelid" = "managed_table"."table_oid"
        AND "entry"."contype" = 'c')::"pg_catalog"."int4" AS "check_constraint_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "entry"."conrelid" = "managed_table"."table_oid"
        AND "entry"."contype" = 'f')::"pg_catalog"."int4" AS
      "outbound_foreign_key_constraint_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_constraint" AS "entry"
      WHERE "entry"."confrelid" = "managed_table"."table_oid"
        AND "entry"."contype" = 'f')::"pg_catalog"."int4" AS
      "inbound_foreign_key_constraint_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_attribute" AS "entry"
      WHERE "entry"."attrelid" = "managed_table"."table_oid"
        AND "entry"."attnum" > 0
        AND NOT "entry"."attisdropped"
        AND "entry"."attgenerated" <> '')::"pg_catalog"."int4" AS "generated_column_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_inherits" AS "entry"
      WHERE "entry"."inhrelid" = "managed_table"."table_oid"
         OR "entry"."inhparent" = "managed_table"."table_oid")::"pg_catalog"."int4" AS
      "inheritance_relation_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_trigger" AS "entry"
      WHERE "entry"."tgrelid" = "managed_table"."table_oid"
        AND NOT "entry"."tgisinternal")::"pg_catalog"."int4" AS "user_trigger_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_rewrite" AS "entry"
      WHERE "entry"."ev_class" = "managed_table"."table_oid"
        AND "entry"."rulename" <> '_RETURN')::"pg_catalog"."int4" AS "user_rule_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_policy" AS "entry"
      WHERE "entry"."polrelid" = "managed_table"."table_oid")::"pg_catalog"."int4" AS
      "policy_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_publication_rel" AS "entry"
      WHERE "entry"."prrelid" = "managed_table"."table_oid")::"pg_catalog"."int4" AS
      "publication_membership_count",
    COALESCE("pg_catalog"."cardinality"("managed_table"."table_acl"), 0)::
      "pg_catalog"."int4" AS "table_acl_entry_count",
    (SELECT COUNT(*) FROM "pg_catalog"."pg_attribute" AS "entry"
      WHERE "entry"."attrelid" = "managed_table"."table_oid"
        AND "entry"."attnum" > 0
        AND NOT "entry"."attisdropped"
        AND "entry"."attacl" IS NOT NULL)::"pg_catalog"."int4" AS "column_acl_count"
  FROM "managed_table"
)
SELECT
  "requested"."subject_digest" AS "subjectDigest",
  "requested"."project_ref" AS "projectRef",
  "requested"."account_id" AS "accountId",
  "requested"."grant_generation" AS "grantGeneration",
  "requested"."query_version" AS "queryVersion",
  "requested"."query_digest" AS "queryDigest",
  'read-only'::"pg_catalog"."text" AS "accessMode",
  'single-statement'::"pg_catalog"."text" AS "snapshotScope",
  TRUE AS "catalogOnly",
  "pg_catalog"."txid_current_snapshot"()::"pg_catalog"."text" AS "snapshotMarker",
  "pg_catalog"."to_char"(
    "pg_catalog"."statement_timestamp"() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "observedAt",
  "pg_catalog"."jsonb_build_object"(
    'currentOid', "current_role_entry"."oid"::"pg_catalog"."text",
    'currentName', CURRENT_USER::"pg_catalog"."text",
    'currentSuperuser', "current_role_entry"."rolsuper",
    'currentBypassRls', "current_role_entry"."rolbypassrls",
    'sessionOid', "session_role_entry"."oid"::"pg_catalog"."text",
    'sessionName', SESSION_USER::"pg_catalog"."text",
    'sessionSuperuser', "session_role_entry"."rolsuper",
    'sessionBypassRls', "session_role_entry"."rolbypassrls"
  ) AS "roles",
  "pg_catalog"."jsonb_build_object"(
    'transactionReadOnly', "pg_catalog"."current_setting"('transaction_read_only') = 'on',
    'rowSecurity', "pg_catalog"."current_setting"('row_security') = 'on',
    'searchPath', "pg_catalog"."current_setting"('search_path'),
    'effectiveSearchPath', "pg_catalog"."to_jsonb"("pg_catalog"."current_schemas"(TRUE)),
    'databasePrimary', NOT "pg_catalog"."pg_is_in_recovery"(),
    'rowSecurityActiveForTable', "pg_catalog"."row_security_active"("managed_table"."table_oid")
  ) AS "settings",
  "pg_catalog"."jsonb_build_object"(
    'oid', "managed_table"."schema_oid"::"pg_catalog"."text",
    'name', "managed_table"."schema_name"::"pg_catalog"."text"
  ) AS "schema",
  "pg_catalog"."jsonb_build_object"(
    'classOid', 'pg_catalog.pg_class'::"pg_catalog"."regclass"::"pg_catalog"."oid"::"pg_catalog"."text",
    'oid', "managed_table"."table_oid"::"pg_catalog"."text",
    'schemaOid', "managed_table"."schema_oid"::"pg_catalog"."text",
    'name', "managed_table"."table_name"::"pg_catalog"."text",
    'ownerOid', "managed_table"."owner_oid"::"pg_catalog"."text",
    'ownerName', "managed_table"."owner_name"::"pg_catalog"."text",
    'marker', "managed_table"."marker",
    'rlsEnabled', "managed_table"."rls_enabled",
    'rlsForced', "managed_table"."rls_forced"
  ) AS "table",
  "pg_catalog"."jsonb_build_object"(
    'classOid', 'pg_catalog.pg_class'::"pg_catalog"."regclass"::"pg_catalog"."oid"::"pg_catalog"."text",
    'objectOid', "cursor_column"."table_oid"::"pg_catalog"."text",
    'subId', "cursor_column"."sub_id",
    'name', "cursor_column"."column_name"::"pg_catalog"."text",
    'marker', "cursor_column"."marker",
    'typeOid', "cursor_column"."type_oid"::"pg_catalog"."text",
    'typeSchema', "cursor_column"."type_schema"::"pg_catalog"."text",
    'typeName', "cursor_column"."type_name"::"pg_catalog"."text",
    'typeModifier', "cursor_column"."type_modifier",
    'notNull', "cursor_column"."not_null",
    'identityKind', "cursor_column"."identity_kind"::"pg_catalog"."text",
    'generatedKind', "cursor_column"."generated_kind"::"pg_catalog"."text"
  ) AS "cursor",
  "pg_catalog"."jsonb_build_object"(
    'classOid', 'pg_catalog.pg_class'::"pg_catalog"."regclass"::"pg_catalog"."oid"::"pg_catalog"."text",
    'objectOid', "target_column"."table_oid"::"pg_catalog"."text",
    'subId', "target_column"."sub_id",
    'name', "target_column"."column_name"::"pg_catalog"."text",
    'marker', "target_column"."marker",
    'typeOid', "target_column"."type_oid"::"pg_catalog"."text",
    'typeSchemaOid', "target_column"."type_schema_oid"::"pg_catalog"."text",
    'typeSchema', "target_column"."type_schema"::"pg_catalog"."text",
    'typeName', "target_column"."type_name"::"pg_catalog"."text",
    'typeKind', "target_column"."type_kind"::"pg_catalog"."text",
    'typeModifier', "target_column"."type_modifier",
    'notNull', "target_column"."not_null",
    'identityKind', "target_column"."identity_kind"::"pg_catalog"."text",
    'generatedKind', "target_column"."generated_kind"::"pg_catalog"."text",
    'hasDefault', "target_column"."has_default",
    'enumMarker', "target_column"."enum_marker",
    'enumValues', "target_column"."enum_values"
  ) AS "target",
  "pg_catalog"."jsonb_build_object"(
    'classOid', 'pg_catalog.pg_constraint'::"pg_catalog"."regclass"::"pg_catalog"."oid"::"pg_catalog"."text",
    'oid', "primary_key"."constraint_oid"::"pg_catalog"."text",
    'tableOid', "primary_key"."table_oid"::"pg_catalog"."text",
    'name', "primary_key"."constraint_name"::"pg_catalog"."text",
    'marker', "primary_key"."marker",
    'fieldCount', "primary_key"."field_count",
    'cursorSubId', "primary_key"."cursor_sub_id"
  ) AS "primaryKey",
  "pg_catalog"."jsonb_build_object"(
    'classOid', 'pg_catalog.pg_class'::"pg_catalog"."regclass"::"pg_catalog"."oid"::"pg_catalog"."text",
    'oid', "identity_sequence"."sequence_oid"::"pg_catalog"."text",
    'schemaOid', "identity_sequence"."sequence_schema_oid"::"pg_catalog"."text",
    'schema', "identity_sequence"."sequence_schema"::"pg_catalog"."text",
    'name', "identity_sequence"."sequence_name"::"pg_catalog"."text",
    'dependencyType', "identity_sequence"."dependency_type"::"pg_catalog"."text",
    'incrementBy', "identity_sequence"."increment_by"::"pg_catalog"."text",
    'minimumValue', "identity_sequence"."minimum_value"::"pg_catalog"."text",
    'maximumValue', "identity_sequence"."maximum_value"::"pg_catalog"."text",
    'cacheSize', "identity_sequence"."cache_size"::"pg_catalog"."text",
    'cycle', "identity_sequence"."cycle",
    'ownedTableOid', "identity_sequence"."owned_table_oid"::"pg_catalog"."text",
    'ownedSubId', "identity_sequence"."owned_sub_id",
    'liveValueObserved', FALSE
  ) AS "sequence",
  "pg_catalog"."jsonb_build_object"(
    'nonPrimaryUniqueOrExclusionConstraintCount',
      "hazards"."non_primary_unique_or_exclusion_constraint_count",
    'nonPrimaryIndexCount', "hazards"."non_primary_index_count",
    'partialOrExpressionIndexCount', "hazards"."partial_or_expression_index_count",
    'checkConstraintCount', "hazards"."check_constraint_count",
    'outboundForeignKeyConstraintCount',
      "hazards"."outbound_foreign_key_constraint_count",
    'inboundForeignKeyConstraintCount', "hazards"."inbound_foreign_key_constraint_count",
    'generatedColumnCount', "hazards"."generated_column_count",
    'inheritanceRelationCount', "hazards"."inheritance_relation_count",
    'userTriggerCount', "hazards"."user_trigger_count",
    'userRuleCount', "hazards"."user_rule_count",
    'policyCount', "hazards"."policy_count",
    'publicationMembershipCount', "hazards"."publication_membership_count",
    'tableAclEntryCount', "hazards"."table_acl_entry_count",
    'columnAclCount', "hazards"."column_acl_count"
  ) AS "hazards"
FROM "requested"
JOIN "managed_table" ON TRUE
JOIN "cursor_column" ON "cursor_column"."table_oid" = "managed_table"."table_oid"
JOIN "target_column" ON "target_column"."table_oid" = "managed_table"."table_oid"
JOIN "primary_key" ON TRUE
JOIN "identity_sequence" ON TRUE
JOIN "current_role_entry" ON TRUE
JOIN "session_role_entry" ON TRUE
JOIN "hazards" ON TRUE`

export const SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY = Object.freeze({
  queryId: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
  version: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
  sql: SUPABASE_BACKFILL_LIVE_CATALOG_SQL,
  parameterOrder: SUPABASE_BACKFILL_LIVE_CATALOG_PARAMETER_ORDER,
  statementCount: 1 as const,
  catalogOnly: true as const,
  accessMode: 'read-only' as const,
  snapshotScope: 'single-statement' as const
})

export type SupabaseBackfillLiveCatalogAuthorityV1 = SupabaseManagementAccountAuthorityV1

export interface SupabaseBackfillLiveCatalogRequestV1 extends SupabaseBackfillLiveCatalogAuthorityV1 {
  readonly queryId: typeof SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID
  readonly queryVersion: typeof SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION
  readonly queryDigest: string
  readonly subjectDigest: string
  readonly statementCount: 1
  readonly catalogOnly: true
  readonly accessMode: 'read-only'
  readonly snapshotScope: 'single-statement'
  readonly parameters: Readonly<{
    schema: 'public'
    table: string
    entityMarker: string
    cursorField: string
    cursorMarker: string
    primaryKeyMarker: string
    targetField: string
    targetMarker: string
    subjectDigest: string
    projectRef: string
    accountId: string
    grantGeneration: string
    queryVersion: typeof SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION
    queryDigest: string
  }>
}

export interface SupabaseBackfillLiveCatalogHazardsV1 {
  readonly nonPrimaryUniqueOrExclusionConstraintCount: number
  readonly nonPrimaryIndexCount: number
  readonly partialOrExpressionIndexCount: number
  readonly checkConstraintCount: number
  readonly outboundForeignKeyConstraintCount: number
  readonly inboundForeignKeyConstraintCount: number
  readonly generatedColumnCount: number
  readonly inheritanceRelationCount: number
  readonly userTriggerCount: number
  readonly userRuleCount: number
  readonly policyCount: number
  readonly publicationMembershipCount: number
  readonly tableAclEntryCount: number
  readonly columnAclCount: number
}

export interface SupabaseBackfillLiveCatalogInspectionV1 {
  readonly format: typeof SUPABASE_BACKFILL_LIVE_CATALOG_INSPECTION_FORMAT
  readonly version: 1
  readonly providerId: 'supabase'
  readonly reviewOnly: true
  readonly applyAvailable: false
  readonly releaseReady: false
  readonly executionAuthorityCreated: false
  readonly receiptAuthorityCreated: false
  readonly subjectDigest: string
  readonly authority: SupabaseBackfillLiveCatalogAuthorityV1
  readonly query: Readonly<{
    id: typeof SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID
    version: typeof SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION
    digest: string
    statementCount: 1
    catalogOnly: true
    accessMode: 'read-only'
    snapshotScope: 'single-statement'
  }>
  readonly observedAt: string
  readonly snapshotMarker: string
  readonly roles: Readonly<{
    currentOid: string
    currentName: string
    currentSuperuser: boolean
    currentBypassRls: boolean
    sessionOid: string
    sessionName: string
    sessionSuperuser: boolean
    sessionBypassRls: boolean
  }>
  readonly settings: Readonly<{
    transactionReadOnly: boolean
    rowSecurity: boolean
    searchPath: string
    effectiveSearchPath: readonly string[]
    databasePrimary: boolean
    rowSecurityActiveForTable: boolean
  }>
  readonly catalog: Readonly<{
    schema: Readonly<{ oid: string; name: 'public' }>
    table: Readonly<{
      classOid: string
      oid: string
      schemaOid: string
      name: string
      ownerOid: string
      ownerName: string
      marker: string
      rlsEnabled: boolean
      rlsForced: boolean
    }>
    cursor: Readonly<{
      classOid: string
      objectOid: string
      subId: number
      name: string
      marker: string
      typeOid: string
      typeSchema: string
      typeName: string
      typeModifier: number
      notNull: boolean
      identityKind: string
      generatedKind: string
    }>
    target: Readonly<{
      classOid: string
      objectOid: string
      subId: number
      name: string
      marker: string
      typeOid: string
      typeSchemaOid: string
      typeSchema: string
      typeName: string
      typeKind: string
      typeModifier: number
      notNull: boolean
      identityKind: string
      generatedKind: string
      hasDefault: boolean
      enumMarker: string | null
      enumValues: readonly string[]
    }>
    primaryKey: Readonly<{
      classOid: string
      oid: string
      tableOid: string
      name: string
      marker: string
      fieldCount: number
      cursorSubId: number
    }>
    sequence: Readonly<{
      classOid: string
      oid: string
      schemaOid: string
      schema: string
      name: string
      dependencyType: 'i'
      incrementBy: string
      minimumValue: string
      maximumValue: string
      cacheSize: string
      cycle: boolean
      ownedTableOid: string
      ownedSubId: number
      liveValueObserved: false
    }>
  }>
  readonly hazards: SupabaseBackfillLiveCatalogHazardsV1
  readonly checks: Readonly<{
    queryRoleMatchesReadOnlyEndpoint: boolean
    queryRoleIsNonSuperuser: boolean
    currentAndSessionRoleMatch: boolean
    databaseIsPrimary: boolean
    searchPathIsBounded: boolean
    tableRlsIsForced: boolean
    cursorShapeMatches: boolean
    targetShapeMatches: boolean
    identitySequenceShapeMatches: boolean
    noWriteHazards: boolean
    allCatalogChecksPassed: boolean
  }>
  readonly highWater: Readonly<{
    status: 'not-observed'
    observedCandidate: null
    lockedCapture: false
  }>
  readonly receipt: Readonly<{
    mayCreate: false
    signed: false
  }>
  readonly blockers: readonly string[]
}

export type SupabaseBackfillLiveCatalogInspectionErrorCode =
  | 'supabase-backfill-live-catalog-subject-invalid'
  | 'supabase-backfill-live-catalog-subject-digest-mismatch'
  | 'supabase-backfill-live-catalog-authority-invalid'
  | 'supabase-backfill-live-catalog-response-invalid'
  | 'supabase-backfill-live-catalog-authority-mismatch'
  | 'supabase-backfill-live-catalog-query-binding-mismatch'
  | 'supabase-backfill-live-catalog-address-mismatch'
  | 'supabase-backfill-live-catalog-input-changed'
  | 'supabase-backfill-live-catalog-project-authority-mismatch'
  | 'supabase-backfill-live-catalog-transport-failed'

export class SupabaseBackfillLiveCatalogInspectionError extends Error {
  readonly code: SupabaseBackfillLiveCatalogInspectionErrorCode

  constructor(code: SupabaseBackfillLiveCatalogInspectionErrorCode, message: string) {
    super(message)
    this.name = 'SupabaseBackfillLiveCatalogInspectionError'
    this.code = code
  }
}

export interface SupabaseBackfillLiveCatalogCompilerInputV1 {
  readonly registry: BackendProviderRegistryV2
  readonly plan: BackendProviderPlanV2
  readonly selection: BackendProviderSelectionV2
}

export type SupabaseBackfillLiveCatalogProjectAuthorityV1 = SupabaseManagementProjectAuthorityV1

export interface SupabaseBackfillLiveCatalogHostTransportV1 {
  getProjectAuthority(
    request: SupabaseBackfillLiveCatalogAuthorityV1
  ): Promise<SupabaseBackfillLiveCatalogProjectAuthorityV1>
  runReadOnlyBackfillCatalogQuery(request: SupabaseBackfillLiveCatalogRequestV1): Promise<unknown>
}

type MaybePromise<T> = T | Promise<T>

export interface InspectSupabaseBackfillLiveCatalogOptionsV1 {
  /** Host-owned live compiler authority; called three times to detect stale inputs. */
  readonly readCurrentCompilerInput: () => MaybePromise<SupabaseBackfillLiveCatalogCompilerInputV1>
  /** Host-owned live credential authority; called three times to detect grant replacement. */
  readonly readCurrentAuthority: () => MaybePromise<SupabaseBackfillLiveCatalogAuthorityV1>
  readonly transport: SupabaseBackfillLiveCatalogHostTransportV1
}

type UnknownRecord = Record<string, unknown>

const DIGEST = /^[A-Za-z0-9_-]{43}$/u
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const PROJECT_REF = /^[a-z]{20}$/u
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u
const MAX_TEXT_BYTES = 8_192
const MAX_HAZARD_COUNT = 1_000_000

function fail(code: SupabaseBackfillLiveCatalogInspectionErrorCode, message: string): never {
  throw new SupabaseBackfillLiveCatalogInspectionError(code, message)
}

function ownData(value: object, key: string, code: SupabaseBackfillLiveCatalogInspectionErrorCode) {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
  } catch {
    return fail(code, 'Supabase backfill inspection data contains an invalid property.')
  }
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return fail(code, 'Supabase backfill inspection data contains a non-data property.')
  }
  return descriptor.value
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  code: SupabaseBackfillLiveCatalogInspectionErrorCode
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(code, 'Supabase backfill inspection data has an unexpected shape.')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail(code, 'Supabase backfill inspection data has an invalid object boundary.')
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(code, 'Supabase backfill inspection data must be a plain object.')
  }
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail(code, 'Supabase backfill inspection data has missing or unsupported fields.')
  }
  for (const key of keys) ownData(value, key, code)
  return value as UnknownRecord
}

function boundedText(value: unknown, code: SupabaseBackfillLiveCatalogInspectionErrorCode): string {
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES ||
    value.includes('\0')
  ) {
    return fail(code, 'Supabase backfill inspection text is invalid.')
  }
  return value
}

function stableId(value: unknown, code: SupabaseBackfillLiveCatalogInspectionErrorCode): string {
  const parsed = boundedText(value, code)
  if (!STABLE_ID.test(parsed)) return fail(code, 'Supabase authority identifier is invalid.')
  return parsed
}

function digest(value: unknown, code: SupabaseBackfillLiveCatalogInspectionErrorCode): string {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    return fail(code, 'Supabase backfill inspection digest is invalid.')
  }
  return value
}

function identifier(value: unknown, code: SupabaseBackfillLiveCatalogInspectionErrorCode): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    return fail(code, 'Supabase backfill inspection identifier is invalid.')
  }
  return value
}

function oid(value: unknown): string {
  if (typeof value !== 'string' || !OID.test(value)) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog OID is invalid.')
  }
  const parsed = BigInt(value)
  if (parsed === 0n || parsed > 4_294_967_295n) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog OID is out of range.')
  }
  return value
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog boolean is invalid.')
  }
  return value
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog integer is invalid.')
  }
  return value as number
}

function positiveBigIntText(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,18})$/u.test(value)) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Sequence value is invalid.')
  }
  return value
}

function stringArray(value: unknown, maximum = 32): readonly string[] {
  if (!Array.isArray(value)) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog array is invalid.')
  }
  let keys: readonly PropertyKey[]
  let lengthDescriptor: PropertyDescriptor | undefined
  try {
    keys = Reflect.ownKeys(value)
    lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  } catch {
    return fail(
      'supabase-backfill-live-catalog-response-invalid',
      'Catalog array has an invalid object boundary.'
    )
  }
  const length = lengthDescriptor?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog array is invalid.')
  }
  if (
    keys.length !== length + 1 ||
    keys.some(
      (key) => typeof key !== 'string' || (key !== 'length' && !/^(?:0|[1-9][0-9]*)$/u.test(key))
    )
  ) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Catalog array is not dense.')
  }
  return Object.freeze(
    Array.from({ length }, (_, index) =>
      boundedText(
        ownData(value, String(index), 'supabase-backfill-live-catalog-response-invalid'),
        'supabase-backfill-live-catalog-response-invalid'
      )
    )
  )
}

function canonicalTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return fail('supabase-backfill-live-catalog-response-invalid', 'Observed time is invalid.')
  }
  if (new Date(value).toISOString() !== value) {
    return fail(
      'supabase-backfill-live-catalog-response-invalid',
      'Observed time is not canonical.'
    )
  }
  return value
}

async function checkedSubject(
  value: SupabaseBackfillInspectionSubjectEnvelopeV1
): Promise<Readonly<{ subject: SupabaseBackfillInspectionSubjectV1; subjectDigest: string }>> {
  const subjectDigest = digest(
    value.subjectDigest,
    'supabase-backfill-live-catalog-subject-invalid'
  )
  if ((await digestCanonicalManifest(value.subject)) !== subjectDigest) {
    return fail(
      'supabase-backfill-live-catalog-subject-digest-mismatch',
      'The compiler-built Supabase backfill inspection subject digest is inconsistent.'
    )
  }
  return Object.freeze({ subject: value.subject, subjectDigest })
}

function checkedAuthority(value: unknown): SupabaseBackfillLiveCatalogAuthorityV1 {
  let source: UnknownRecord
  try {
    source = exactRecord(
      value,
      ['projectRef', 'accountId', 'grantGeneration'],
      'supabase-backfill-live-catalog-authority-invalid'
    )
  } catch (cause) {
    if (cause instanceof SupabaseBackfillLiveCatalogInspectionError) throw cause
    return fail(
      'supabase-backfill-live-catalog-authority-invalid',
      'Supabase backfill inspection authority is invalid.'
    )
  }
  const projectRef = stableId(
    ownData(source, 'projectRef', 'supabase-backfill-live-catalog-authority-invalid'),
    'supabase-backfill-live-catalog-authority-invalid'
  )
  if (!PROJECT_REF.test(projectRef)) {
    return fail(
      'supabase-backfill-live-catalog-authority-invalid',
      'Supabase backfill inspection project reference is invalid.'
    )
  }
  return Object.freeze({
    projectRef,
    accountId: stableId(
      ownData(source, 'accountId', 'supabase-backfill-live-catalog-authority-invalid'),
      'supabase-backfill-live-catalog-authority-invalid'
    ),
    grantGeneration: stableId(
      ownData(source, 'grantGeneration', 'supabase-backfill-live-catalog-authority-invalid'),
      'supabase-backfill-live-catalog-authority-invalid'
    )
  })
}

const RESPONSE_KEYS = [
  'subjectDigest',
  'projectRef',
  'accountId',
  'grantGeneration',
  'queryVersion',
  'queryDigest',
  'accessMode',
  'snapshotScope',
  'catalogOnly',
  'snapshotMarker',
  'observedAt',
  'roles',
  'settings',
  'schema',
  'table',
  'cursor',
  'target',
  'primaryKey',
  'sequence',
  'hazards'
] as const

function parseRoles(value: unknown): SupabaseBackfillLiveCatalogInspectionV1['roles'] {
  const source = exactRecord(
    value,
    [
      'currentOid',
      'currentName',
      'currentSuperuser',
      'currentBypassRls',
      'sessionOid',
      'sessionName',
      'sessionSuperuser',
      'sessionBypassRls'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  return Object.freeze({
    currentOid: oid(source.currentOid),
    currentName: identifier(source.currentName, 'supabase-backfill-live-catalog-response-invalid'),
    currentSuperuser: boolean(source.currentSuperuser),
    currentBypassRls: boolean(source.currentBypassRls),
    sessionOid: oid(source.sessionOid),
    sessionName: identifier(source.sessionName, 'supabase-backfill-live-catalog-response-invalid'),
    sessionSuperuser: boolean(source.sessionSuperuser),
    sessionBypassRls: boolean(source.sessionBypassRls)
  })
}

function parseSettings(value: unknown): SupabaseBackfillLiveCatalogInspectionV1['settings'] {
  const source = exactRecord(
    value,
    [
      'transactionReadOnly',
      'rowSecurity',
      'searchPath',
      'effectiveSearchPath',
      'databasePrimary',
      'rowSecurityActiveForTable'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  return Object.freeze({
    transactionReadOnly: boolean(source.transactionReadOnly),
    rowSecurity: boolean(source.rowSecurity),
    searchPath: boundedText(source.searchPath, 'supabase-backfill-live-catalog-response-invalid'),
    effectiveSearchPath: stringArray(source.effectiveSearchPath),
    databasePrimary: boolean(source.databasePrimary),
    rowSecurityActiveForTable: boolean(source.rowSecurityActiveForTable)
  })
}

function parseSchema(value: unknown) {
  const source = exactRecord(
    value,
    ['oid', 'name'],
    'supabase-backfill-live-catalog-response-invalid'
  )
  if (source.name !== 'public') {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase backfill inspection schema address does not match public.'
    )
  }
  return Object.freeze({ oid: oid(source.oid), name: 'public' as const })
}

function parseTable(value: unknown, subject: SupabaseBackfillInspectionSubjectV1) {
  const source = exactRecord(
    value,
    [
      'classOid',
      'oid',
      'schemaOid',
      'name',
      'ownerOid',
      'ownerName',
      'marker',
      'rlsEnabled',
      'rlsForced'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  const parsed = Object.freeze({
    classOid: oid(source.classOid),
    oid: oid(source.oid),
    schemaOid: oid(source.schemaOid),
    name: identifier(source.name, 'supabase-backfill-live-catalog-response-invalid'),
    ownerOid: oid(source.ownerOid),
    ownerName: identifier(source.ownerName, 'supabase-backfill-live-catalog-response-invalid'),
    marker: boundedText(source.marker, 'supabase-backfill-live-catalog-response-invalid'),
    rlsEnabled: boolean(source.rlsEnabled),
    rlsForced: boolean(source.rlsForced)
  })
  if (
    parsed.name !== subject.migration.entity.table ||
    parsed.marker !== subject.migration.entity.marker
  ) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase table address does not match the bound backfill subject.'
    )
  }
  return parsed
}

function parseColumn(
  value: unknown,
  expected: Readonly<{ classOid: string; tableOid: string; name: string; marker: string }>
) {
  const source = exactRecord(
    value,
    [
      'classOid',
      'objectOid',
      'subId',
      'name',
      'marker',
      'typeOid',
      'typeSchema',
      'typeName',
      'typeModifier',
      'notNull',
      'identityKind',
      'generatedKind'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  const parsed = Object.freeze({
    classOid: oid(source.classOid),
    objectOid: oid(source.objectOid),
    subId: integer(source.subId, 1, 32_767),
    name: identifier(source.name, 'supabase-backfill-live-catalog-response-invalid'),
    marker: boundedText(source.marker, 'supabase-backfill-live-catalog-response-invalid'),
    typeOid: oid(source.typeOid),
    typeSchema: identifier(source.typeSchema, 'supabase-backfill-live-catalog-response-invalid'),
    typeName: identifier(source.typeName, 'supabase-backfill-live-catalog-response-invalid'),
    typeModifier: integer(source.typeModifier, -1, 1_000_000_000),
    notNull: boolean(source.notNull),
    identityKind: boundedText(
      source.identityKind,
      'supabase-backfill-live-catalog-response-invalid'
    ),
    generatedKind: boundedText(
      source.generatedKind,
      'supabase-backfill-live-catalog-response-invalid'
    )
  })
  if (
    parsed.classOid !== expected.classOid ||
    parsed.objectOid !== expected.tableOid ||
    parsed.name !== expected.name ||
    parsed.marker !== expected.marker
  ) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase column address does not match the bound backfill subject.'
    )
  }
  return parsed
}

function parseTarget(
  value: unknown,
  expected: Readonly<{ classOid: string; tableOid: string; name: string; marker: string }>
) {
  const source = exactRecord(
    value,
    [
      'classOid',
      'objectOid',
      'subId',
      'name',
      'marker',
      'typeOid',
      'typeSchemaOid',
      'typeSchema',
      'typeName',
      'typeKind',
      'typeModifier',
      'notNull',
      'identityKind',
      'generatedKind',
      'hasDefault',
      'enumMarker',
      'enumValues'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  const enumMarker =
    source.enumMarker === null
      ? null
      : boundedText(source.enumMarker, 'supabase-backfill-live-catalog-response-invalid')
  const parsed = Object.freeze({
    classOid: oid(source.classOid),
    objectOid: oid(source.objectOid),
    subId: integer(source.subId, 1, 32_767),
    name: identifier(source.name, 'supabase-backfill-live-catalog-response-invalid'),
    marker: boundedText(source.marker, 'supabase-backfill-live-catalog-response-invalid'),
    typeOid: oid(source.typeOid),
    typeSchemaOid: oid(source.typeSchemaOid),
    typeSchema: identifier(source.typeSchema, 'supabase-backfill-live-catalog-response-invalid'),
    typeName: identifier(source.typeName, 'supabase-backfill-live-catalog-response-invalid'),
    typeKind: boundedText(source.typeKind, 'supabase-backfill-live-catalog-response-invalid'),
    typeModifier: integer(source.typeModifier, -1, 1_000_000_000),
    notNull: boolean(source.notNull),
    identityKind: boundedText(
      source.identityKind,
      'supabase-backfill-live-catalog-response-invalid'
    ),
    generatedKind: boundedText(
      source.generatedKind,
      'supabase-backfill-live-catalog-response-invalid'
    ),
    hasDefault: boolean(source.hasDefault),
    enumMarker,
    enumValues: stringArray(source.enumValues, 256)
  })
  if (
    parsed.classOid !== expected.classOid ||
    parsed.objectOid !== expected.tableOid ||
    parsed.name !== expected.name ||
    parsed.marker !== expected.marker
  ) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase target column address does not match the bound backfill subject.'
    )
  }
  return parsed
}

function parsePrimaryKey(value: unknown, tableOid: string, cursorSubId: number, marker: string) {
  const source = exactRecord(
    value,
    ['classOid', 'oid', 'tableOid', 'name', 'marker', 'fieldCount', 'cursorSubId'],
    'supabase-backfill-live-catalog-response-invalid'
  )
  const parsed = Object.freeze({
    classOid: oid(source.classOid),
    oid: oid(source.oid),
    tableOid: oid(source.tableOid),
    name: identifier(source.name, 'supabase-backfill-live-catalog-response-invalid'),
    marker: boundedText(source.marker, 'supabase-backfill-live-catalog-response-invalid'),
    fieldCount: integer(source.fieldCount, 1, 32_767),
    cursorSubId: integer(source.cursorSubId, 1, 32_767)
  })
  if (
    parsed.tableOid !== tableOid ||
    parsed.marker !== marker ||
    parsed.fieldCount !== 1 ||
    parsed.cursorSubId !== cursorSubId
  ) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase primary-key address does not match the bound cursor.'
    )
  }
  return parsed
}

function parseSequence(
  value: unknown,
  expected: Readonly<{
    classOid: string
    tableOid: string
    cursorSubId: number
    schemaOid: string
  }>
) {
  const source = exactRecord(
    value,
    [
      'classOid',
      'oid',
      'schemaOid',
      'schema',
      'name',
      'dependencyType',
      'incrementBy',
      'minimumValue',
      'maximumValue',
      'cacheSize',
      'cycle',
      'ownedTableOid',
      'ownedSubId',
      'liveValueObserved'
    ],
    'supabase-backfill-live-catalog-response-invalid'
  )
  if (source.dependencyType !== 'i' || source.liveValueObserved !== false) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase identity sequence dependency evidence is invalid.'
    )
  }
  const parsed = Object.freeze({
    classOid: oid(source.classOid),
    oid: oid(source.oid),
    schemaOid: oid(source.schemaOid),
    schema: identifier(source.schema, 'supabase-backfill-live-catalog-response-invalid'),
    name: identifier(source.name, 'supabase-backfill-live-catalog-response-invalid'),
    dependencyType: 'i' as const,
    incrementBy: positiveBigIntText(source.incrementBy),
    minimumValue: positiveBigIntText(source.minimumValue),
    maximumValue: positiveBigIntText(source.maximumValue),
    cacheSize: positiveBigIntText(source.cacheSize),
    cycle: boolean(source.cycle),
    ownedTableOid: oid(source.ownedTableOid),
    ownedSubId: integer(source.ownedSubId, 1, 32_767),
    liveValueObserved: false as const
  })
  if (
    parsed.classOid !== expected.classOid ||
    parsed.schemaOid !== expected.schemaOid ||
    parsed.ownedTableOid !== expected.tableOid ||
    parsed.ownedSubId !== expected.cursorSubId
  ) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase identity sequence address does not match the bound cursor.'
    )
  }
  return parsed
}

const HAZARD_KEYS = [
  'nonPrimaryUniqueOrExclusionConstraintCount',
  'nonPrimaryIndexCount',
  'partialOrExpressionIndexCount',
  'checkConstraintCount',
  'outboundForeignKeyConstraintCount',
  'inboundForeignKeyConstraintCount',
  'generatedColumnCount',
  'inheritanceRelationCount',
  'userTriggerCount',
  'userRuleCount',
  'policyCount',
  'publicationMembershipCount',
  'tableAclEntryCount',
  'columnAclCount'
] as const

const BLOCKING_HAZARD_KEYS = [
  'nonPrimaryUniqueOrExclusionConstraintCount',
  'nonPrimaryIndexCount',
  'partialOrExpressionIndexCount',
  'checkConstraintCount',
  'outboundForeignKeyConstraintCount',
  'generatedColumnCount',
  'inheritanceRelationCount'
] as const

function parseHazards(value: unknown): SupabaseBackfillLiveCatalogHazardsV1 {
  const source = exactRecord(value, HAZARD_KEYS, 'supabase-backfill-live-catalog-response-invalid')
  const count = (key: (typeof HAZARD_KEYS)[number]) => integer(source[key], 0, MAX_HAZARD_COUNT)
  return Object.freeze({
    nonPrimaryUniqueOrExclusionConstraintCount: count('nonPrimaryUniqueOrExclusionConstraintCount'),
    nonPrimaryIndexCount: count('nonPrimaryIndexCount'),
    partialOrExpressionIndexCount: count('partialOrExpressionIndexCount'),
    checkConstraintCount: count('checkConstraintCount'),
    outboundForeignKeyConstraintCount: count('outboundForeignKeyConstraintCount'),
    inboundForeignKeyConstraintCount: count('inboundForeignKeyConstraintCount'),
    generatedColumnCount: count('generatedColumnCount'),
    inheritanceRelationCount: count('inheritanceRelationCount'),
    userTriggerCount: count('userTriggerCount'),
    userRuleCount: count('userRuleCount'),
    policyCount: count('policyCount'),
    publicationMembershipCount: count('publicationMembershipCount'),
    tableAclEntryCount: count('tableAclEntryCount'),
    columnAclCount: count('columnAclCount')
  })
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function typeMatchesTarget(
  target: SupabaseBackfillLiveCatalogInspectionV1['catalog']['target'],
  subject: SupabaseBackfillInspectionSubjectV1
): boolean {
  const expectedEnum = subject.migration.target.enum
  if (expectedEnum) {
    return (
      target.typeSchema === 'public' &&
      target.typeName === expectedEnum.name &&
      target.typeKind === 'e' &&
      target.enumMarker === expectedEnum.marker &&
      sameStrings(target.enumValues, expectedEnum.orderedValues)
    )
  }
  const [schema, name, ...rest] = subject.migration.target.postgresType.split('.')
  return (
    rest.length === 0 &&
    target.typeSchema === schema &&
    target.typeName === name &&
    target.typeKind === 'b' &&
    target.enumMarker === null &&
    target.enumValues.length === 0
  )
}

function inspectionBlockers(
  checks: Omit<SupabaseBackfillLiveCatalogInspectionV1['checks'], 'allCatalogChecksPassed'>
): readonly string[] {
  const blockers = [
    'write-barrier-not-installed',
    'locked-high-water-not-captured',
    'database-batch-ledger-not-bound',
    'execution-runner-unavailable'
  ]
  const mapped = [
    ['queryRoleMatchesReadOnlyEndpoint', 'unexpected-read-only-query-role'],
    ['queryRoleIsNonSuperuser', 'privileged-query-role'],
    ['currentAndSessionRoleMatch', 'current-session-role-mismatch'],
    ['databaseIsPrimary', 'database-not-primary'],
    ['searchPathIsBounded', 'search-path-not-bounded'],
    ['tableRlsIsForced', 'table-rls-not-forced'],
    ['cursorShapeMatches', 'cursor-shape-mismatch'],
    ['targetShapeMatches', 'target-shape-mismatch'],
    ['identitySequenceShapeMatches', 'identity-sequence-shape-mismatch'],
    ['noWriteHazards', 'table-write-hazards-present']
  ] as const
  for (const [key, blocker] of mapped) if (!checks[key]) blockers.push(blocker)
  return Object.freeze(blockers)
}

// oxlint-disable-next-line complexity -- One fail-closed decoder binds the complete snapshot and OID graph.
function inspectResponse(
  response: unknown,
  request: SupabaseBackfillLiveCatalogRequestV1,
  subject: SupabaseBackfillInspectionSubjectV1
): SupabaseBackfillLiveCatalogInspectionV1 {
  let source: UnknownRecord
  try {
    source = exactRecord(response, RESPONSE_KEYS, 'supabase-backfill-live-catalog-response-invalid')
  } catch (cause) {
    if (cause instanceof SupabaseBackfillLiveCatalogInspectionError) throw cause
    return fail(
      'supabase-backfill-live-catalog-response-invalid',
      'Supabase backfill catalog response is not inert exact data.'
    )
  }
  for (const [key, expected] of [
    ['projectRef', request.projectRef],
    ['accountId', request.accountId],
    ['grantGeneration', request.grantGeneration]
  ] as const) {
    if (source[key] !== expected) {
      return fail(
        'supabase-backfill-live-catalog-authority-mismatch',
        'Supabase project authority does not match the catalog request.'
      )
    }
  }
  if (
    source.subjectDigest !== request.subjectDigest ||
    source.queryVersion !== request.queryVersion ||
    source.queryDigest !== request.queryDigest ||
    source.accessMode !== 'read-only' ||
    source.snapshotScope !== 'single-statement' ||
    source.catalogOnly !== true
  ) {
    return fail(
      'supabase-backfill-live-catalog-query-binding-mismatch',
      'Supabase catalog response does not match the fixed query binding.'
    )
  }
  if (typeof source.snapshotMarker !== 'string' || !SNAPSHOT_MARKER.test(source.snapshotMarker)) {
    return fail(
      'supabase-backfill-live-catalog-response-invalid',
      'Supabase catalog snapshot marker is invalid.'
    )
  }
  const roles = parseRoles(source.roles)
  const settings = parseSettings(source.settings)
  const schema = parseSchema(source.schema)
  const table = parseTable(source.table, subject)
  if (table.schemaOid !== schema.oid) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase table schema OID does not match the inspected public schema.'
    )
  }
  const cursor = parseColumn(source.cursor, {
    classOid: table.classOid,
    tableOid: table.oid,
    name: subject.migration.cursor.field,
    marker: subject.migration.cursor.marker
  })
  const target = parseTarget(source.target, {
    classOid: table.classOid,
    tableOid: table.oid,
    name: subject.migration.target.field,
    marker: subject.migration.target.marker
  })
  const primaryKey = parsePrimaryKey(
    source.primaryKey,
    table.oid,
    cursor.subId,
    subject.migration.cursor.primaryKeyMarker
  )
  const sequence = parseSequence(source.sequence, {
    classOid: table.classOid,
    tableOid: table.oid,
    cursorSubId: cursor.subId,
    schemaOid: schema.oid
  })
  if (sequence.schema !== schema.name) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase identity sequence schema does not match the managed table.'
    )
  }
  if (target.typeKind === 'e' && target.typeSchemaOid !== schema.oid) {
    return fail(
      'supabase-backfill-live-catalog-address-mismatch',
      'Supabase enum type schema OID does not match the managed schema.'
    )
  }
  const hazards = parseHazards(source.hazards)
  // Supabase's fixed read-only role is BYPASSRLS and the endpoint does not
  // promise transaction_read_only=on. Preserve both observations as evidence;
  // safety here comes from the exact role plus the Host-owned catalog-only SQL.
  const queryRoleMatchesReadOnlyEndpoint =
    roles.currentName === 'supabase_read_only_user' &&
    roles.sessionName === 'supabase_read_only_user'
  const queryRoleIsNonSuperuser =
    !roles.currentSuperuser &&
    !roles.sessionSuperuser &&
    roles.currentOid !== table.ownerOid &&
    roles.currentName !== table.ownerName &&
    roles.sessionOid !== table.ownerOid &&
    roles.sessionName !== table.ownerName
  const currentAndSessionRoleMatch =
    roles.currentOid === roles.sessionOid && roles.currentName === roles.sessionName
  const databaseIsPrimary = settings.databasePrimary
  const searchPathIsBounded = sameStrings(settings.effectiveSearchPath, ['pg_catalog', 'public'])
  const tableRlsIsForced = table.rlsEnabled && table.rlsForced
  const cursorShapeMatches =
    cursor.typeSchema === 'pg_catalog' &&
    cursor.typeName === 'int8' &&
    cursor.typeModifier === -1 &&
    cursor.notNull &&
    cursor.identityKind === 'a' &&
    cursor.generatedKind === ''
  const targetShapeMatches =
    typeMatchesTarget(target, subject) &&
    target.typeModifier === -1 &&
    !target.notNull &&
    target.identityKind === '' &&
    target.generatedKind === '' &&
    !target.hasDefault
  const identitySequenceShapeMatches =
    BigInt(sequence.incrementBy) === 1n &&
    BigInt(sequence.minimumValue) >= BigInt(subject.migration.cursor.minimum) &&
    BigInt(sequence.maximumValue) <= BigInt(subject.migration.cursor.maximum) &&
    BigInt(sequence.cacheSize) === 1n &&
    !sequence.cycle &&
    !sequence.liveValueObserved
  const noWriteHazards = BLOCKING_HAZARD_KEYS.every((key) => hazards[key] === 0)
  const partialChecks = Object.freeze({
    queryRoleMatchesReadOnlyEndpoint,
    queryRoleIsNonSuperuser,
    currentAndSessionRoleMatch,
    databaseIsPrimary,
    searchPathIsBounded,
    tableRlsIsForced,
    cursorShapeMatches,
    targetShapeMatches,
    identitySequenceShapeMatches,
    noWriteHazards
  })
  const checks = Object.freeze({
    ...partialChecks,
    allCatalogChecksPassed: Object.values(partialChecks).every(Boolean)
  })
  return Object.freeze({
    format: SUPABASE_BACKFILL_LIVE_CATALOG_INSPECTION_FORMAT,
    version: 1,
    providerId: 'supabase',
    reviewOnly: true,
    applyAvailable: false,
    releaseReady: false,
    executionAuthorityCreated: false,
    receiptAuthorityCreated: false,
    subjectDigest: request.subjectDigest,
    authority: Object.freeze({
      projectRef: request.projectRef,
      accountId: request.accountId,
      grantGeneration: request.grantGeneration
    }),
    query: Object.freeze({
      id: request.queryId,
      version: request.queryVersion,
      digest: request.queryDigest,
      statementCount: 1,
      catalogOnly: true,
      accessMode: 'read-only',
      snapshotScope: 'single-statement'
    }),
    observedAt: canonicalTimestamp(source.observedAt),
    snapshotMarker: source.snapshotMarker,
    roles,
    settings,
    catalog: Object.freeze({ schema, table, cursor, target, primaryKey, sequence }),
    hazards,
    checks,
    highWater: Object.freeze({
      status: 'not-observed' as const,
      observedCandidate: null,
      lockedCapture: false as const
    }),
    receipt: Object.freeze({ mayCreate: false as const, signed: false as const }),
    blockers: inspectionBlockers(partialChecks)
  })
}

interface SupabaseBackfillLiveCatalogInspectorSessionV1 {
  readonly request: SupabaseBackfillLiveCatalogRequestV1
  readonly inspect: (response: unknown) => SupabaseBackfillLiveCatalogInspectionV1
}

async function createInspectionSession(
  subjectEnvelope: SupabaseBackfillInspectionSubjectEnvelopeV1,
  authorityValue: unknown
): Promise<SupabaseBackfillLiveCatalogInspectorSessionV1> {
  const { subject, subjectDigest } = await checkedSubject(subjectEnvelope)
  const authority = checkedAuthority(authorityValue)
  const queryDigest = await digestCanonicalManifest(SUPABASE_BACKFILL_LIVE_CATALOG_FIXED_QUERY)
  const parameters = Object.freeze({
    schema: 'public' as const,
    table: subject.migration.entity.table,
    entityMarker: subject.migration.entity.marker,
    cursorField: subject.migration.cursor.field,
    cursorMarker: subject.migration.cursor.marker,
    primaryKeyMarker: subject.migration.cursor.primaryKeyMarker,
    targetField: subject.migration.target.field,
    targetMarker: subject.migration.target.marker,
    subjectDigest,
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.grantGeneration,
    queryVersion: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
    queryDigest
  })
  const request = Object.freeze({
    queryId: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_ID,
    queryVersion: SUPABASE_BACKFILL_LIVE_CATALOG_QUERY_VERSION,
    queryDigest,
    subjectDigest,
    projectRef: authority.projectRef,
    accountId: authority.accountId,
    grantGeneration: authority.grantGeneration,
    statementCount: 1 as const,
    catalogOnly: true as const,
    accessMode: 'read-only' as const,
    snapshotScope: 'single-statement' as const,
    parameters
  })
  return Object.freeze({
    request,
    inspect: (response: unknown) => inspectResponse(response, request, subject)
  })
}

async function currentSubject(
  readCurrentCompilerInput: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentCompilerInput']
): Promise<SupabaseBackfillInspectionSubjectEnvelopeV1> {
  let input: SupabaseBackfillLiveCatalogCompilerInputV1
  try {
    input = await readCurrentCompilerInput()
    return createSupabaseBackfillInspectionSubjectV1(input.registry, {
      plan: input.plan,
      selection: input.selection
    })
  } catch {
    return fail(
      'supabase-backfill-live-catalog-subject-invalid',
      'The Host could not rebuild the live Supabase backfill inspection subject.'
    )
  }
}

async function currentAuthority(
  readCurrentAuthority: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentAuthority']
): Promise<SupabaseBackfillLiveCatalogAuthorityV1> {
  try {
    return checkedAuthority(await readCurrentAuthority())
  } catch (cause) {
    if (cause instanceof SupabaseBackfillLiveCatalogInspectionError) throw cause
    return fail(
      'supabase-backfill-live-catalog-authority-invalid',
      'The Host could not resolve the live Supabase credential authority.'
    )
  }
}

function sameAuthority(
  left: SupabaseBackfillLiveCatalogAuthorityV1,
  right: SupabaseBackfillLiveCatalogAuthorityV1
): boolean {
  return (
    left.projectRef === right.projectRef &&
    left.accountId === right.accountId &&
    left.grantGeneration === right.grantGeneration
  )
}

function requireUnchangedInput(
  baselineSubjectDigest: string,
  baselineAuthority: SupabaseBackfillLiveCatalogAuthorityV1,
  nextSubject: SupabaseBackfillInspectionSubjectEnvelopeV1,
  nextAuthority: SupabaseBackfillLiveCatalogAuthorityV1
): void {
  if (
    nextSubject.subjectDigest !== baselineSubjectDigest ||
    !sameAuthority(baselineAuthority, nextAuthority)
  ) {
    fail(
      'supabase-backfill-live-catalog-input-changed',
      'The live Provider plan or credential authority changed during catalog inspection.'
    )
  }
}

function requireProjectAuthority(
  value: unknown,
  expected: SupabaseBackfillLiveCatalogAuthorityV1
): void {
  let source: UnknownRecord
  try {
    source = exactRecord(
      value,
      ['projectRef', 'organizationId', 'grantGeneration'],
      'supabase-backfill-live-catalog-project-authority-mismatch'
    )
  } catch (cause) {
    if (cause instanceof SupabaseBackfillLiveCatalogInspectionError) throw cause
    return fail(
      'supabase-backfill-live-catalog-project-authority-mismatch',
      'Supabase project authority does not match the live Host authority.'
    )
  }
  if (
    ownData(source, 'projectRef', 'supabase-backfill-live-catalog-project-authority-mismatch') !==
      expected.projectRef ||
    ownData(
      source,
      'organizationId',
      'supabase-backfill-live-catalog-project-authority-mismatch'
    ) !== expected.accountId ||
    ownData(
      source,
      'grantGeneration',
      'supabase-backfill-live-catalog-project-authority-mismatch'
    ) !== expected.grantGeneration
  ) {
    fail(
      'supabase-backfill-live-catalog-project-authority-mismatch',
      'Supabase project authority does not match the live Host authority.'
    )
  }
}

async function readLiveInputs(
  readCurrentCompilerInput: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentCompilerInput'],
  readCurrentAuthority: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentAuthority']
) {
  const subjectEnvelope = await currentSubject(readCurrentCompilerInput)
  const authority = await currentAuthority(readCurrentAuthority)
  return Object.freeze({ subjectEnvelope, authority })
}

/**
 * Rebuild a compiler-bound subject from live Host authority, verify the project,
 * and execute exactly one fixed read-only catalog snapshot. The inputs are
 * re-resolved immediately before and after the query so replaced plans or grants
 * cannot produce a trusted result.
 */
export async function inspectSupabaseBackfillLiveCatalogV1(
  options: InspectSupabaseBackfillLiveCatalogOptionsV1
): Promise<SupabaseBackfillLiveCatalogInspectionV1> {
  let readCurrentCompilerInput: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentCompilerInput']
  let readCurrentAuthority: InspectSupabaseBackfillLiveCatalogOptionsV1['readCurrentAuthority']
  let getProjectAuthority: SupabaseBackfillLiveCatalogHostTransportV1['getProjectAuthority']
  let runReadOnlyBackfillCatalogQuery: SupabaseBackfillLiveCatalogHostTransportV1['runReadOnlyBackfillCatalogQuery']
  try {
    readCurrentCompilerInput = options.readCurrentCompilerInput
    readCurrentAuthority = options.readCurrentAuthority
    getProjectAuthority = options.transport.getProjectAuthority.bind(options.transport)
    runReadOnlyBackfillCatalogQuery = options.transport.runReadOnlyBackfillCatalogQuery.bind(
      options.transport
    )
  } catch {
    return fail(
      'supabase-backfill-live-catalog-authority-invalid',
      'Supabase backfill inspection Host authority is invalid.'
    )
  }
  if (
    typeof readCurrentCompilerInput !== 'function' ||
    typeof readCurrentAuthority !== 'function' ||
    typeof getProjectAuthority !== 'function' ||
    typeof runReadOnlyBackfillCatalogQuery !== 'function'
  ) {
    return fail(
      'supabase-backfill-live-catalog-authority-invalid',
      'Supabase backfill inspection Host authority is invalid.'
    )
  }

  const initial = await readLiveInputs(readCurrentCompilerInput, readCurrentAuthority)
  const session = await createInspectionSession(initial.subjectEnvelope, initial.authority)

  let projectAuthority: unknown
  try {
    projectAuthority = await getProjectAuthority(initial.authority)
  } catch {
    return fail(
      'supabase-backfill-live-catalog-transport-failed',
      'Supabase project authority inspection failed.'
    )
  }
  requireProjectAuthority(projectAuthority, initial.authority)

  const beforeQuery = await readLiveInputs(readCurrentCompilerInput, readCurrentAuthority)
  requireUnchangedInput(
    initial.subjectEnvelope.subjectDigest,
    initial.authority,
    beforeQuery.subjectEnvelope,
    beforeQuery.authority
  )

  let response: unknown
  try {
    response = await runReadOnlyBackfillCatalogQuery(session.request)
  } catch {
    return fail(
      'supabase-backfill-live-catalog-transport-failed',
      'Supabase read-only backfill catalog inspection failed.'
    )
  }

  const afterQuery = await readLiveInputs(readCurrentCompilerInput, readCurrentAuthority)
  requireUnchangedInput(
    initial.subjectEnvelope.subjectDigest,
    initial.authority,
    afterQuery.subjectEnvelope,
    afterQuery.authority
  )
  return session.inspect(response)
}
