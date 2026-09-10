-- OpenPencil Supabase Receipt-zero read-only reconciliation review v1.
-- REVIEW ONLY: bounded managed-row reads and response shape, no DML, row locks, credential, or release authority.
-- Parameters are the CAS review's exact 28 positional values and must never be interpolated.
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
"expected_tables"("table_name", "comment") AS (
  VALUES
    ('backfill_executions_v1'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-executions:v1'::"pg_catalog"."text"),
    ('backfill_heads_v1'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-heads:v1'::"pg_catalog"."text"),
    ('backfill_receipts_v2'::"pg_catalog"."name", 'openpencil:release-ledger:backfill-receipts:v2'::"pg_catalog"."text")
),
"schema_entry" AS MATERIALIZED (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "pg_catalog"."obj_description"("namespace_entry"."oid", 'pg_namespace') AS "comment"
  FROM "pg_catalog"."pg_namespace" AS "namespace_entry"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry"
    ON "owner_entry"."oid" = "namespace_entry"."nspowner"
  WHERE "namespace_entry"."nspname" = 'openpencil_release'
),
"owner_role_members"("role_oid") AS (
  SELECT "membership_entry"."member"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_auth_members" AS "membership_entry"
    ON "membership_entry"."roleid" = "schema_entry"."owner_oid"
  UNION
  SELECT "membership_entry"."member"
  FROM "pg_catalog"."pg_auth_members" AS "membership_entry"
  JOIN "owner_role_members"
    ON "membership_entry"."roleid" = "owner_role_members"."role_oid"
),
"table_entries" AS MATERIALIZED (
  SELECT
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "table_entry"."relkind" AS "relation_kind",
    "table_entry"."relpersistence" AS "persistence",
    "table_entry"."relispartition" AS "is_partition",
    "table_entry"."relreplident" AS "replica_identity",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relacl" AS "acl",
    "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') AS "comment",
    "expected_tables"."comment" AS "expected_comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
  JOIN "expected_tables" ON "expected_tables"."table_name" = "table_entry"."relname"
),
"current_role_entry" AS MATERIALIZED (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = CURRENT_USER
),
"session_role_entry" AS MATERIALIZED (
  SELECT "role_entry".*
  FROM "pg_catalog"."pg_roles" AS "role_entry"
  WHERE "role_entry"."rolname" = SESSION_USER
),
"install_marker_constraint_entry" AS MATERIALIZED (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
   AND "table_entry"."relname" = 'backfill_executions_v1'
   AND "table_entry"."relkind" = 'r'
  JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
    ON "constraint_entry"."conrelid" = "table_entry"."oid"
   AND "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
   AND "constraint_entry"."conname" = 'backfill_executions_v1_pkey'
   AND "constraint_entry"."contype" = 'p'
  JOIN "pg_catalog"."pg_attribute" AS "attribute_entry"
    ON "attribute_entry"."attrelid" = "table_entry"."oid"
   AND "attribute_entry"."attname" = 'execution_id'
   AND "attribute_entry"."attnum" > 0
   AND NOT "attribute_entry"."attisdropped"
  WHERE "constraint_entry"."conkey" = ARRAY["attribute_entry"."attnum"]::"pg_catalog"."int2"[]
    AND NOT "constraint_entry"."condeferrable"
    AND NOT "constraint_entry"."condeferred"
    AND "constraint_entry"."convalidated"
    AND NOT "constraint_entry"."connoinherit"
    AND "constraint_entry"."conislocal"
    AND "constraint_entry"."coninhcount" = 0
    AND "constraint_entry"."conparentid" = 0
),
"full_catalog_snapshot" AS MATERIALIZED (
WITH RECURSIVE "requested" AS (
  SELECT
    $openpencil_catalog$openpencil_release$openpencil_catalog$::"pg_catalog"."name" AS "schema_name",
    $openpencil_catalog$receipt-zero-reconciliation-catalog-review$openpencil_catalog$::"pg_catalog"."text" AS "review_digest",
    $openpencil_catalog$receipt-zero-reconciliation-ledger-shape$openpencil_catalog$::"pg_catalog"."text" AS "ledger_shape_digest",
    $openpencil_catalog$receipt-zero-reconciliation-ledger-sql$openpencil_catalog$::"pg_catalog"."text" AS "sql_digest",
    $openpencil_catalog$receipt-zero-reconciliation-project$openpencil_catalog$::"pg_catalog"."text" AS "project_ref",
    $openpencil_catalog$receipt-zero-reconciliation-account$openpencil_catalog$::"pg_catalog"."text" AS "account_id",
    $openpencil_catalog$receipt-zero-reconciliation-grant$openpencil_catalog$::"pg_catalog"."text" AS "grant_generation",
    $openpencil_catalog$receipt-zero-reconciliation-catalog-query$openpencil_catalog$::"pg_catalog"."text" AS "query_version",
    $openpencil_catalog$receipt-zero-reconciliation-catalog-digest$openpencil_catalog$::"pg_catalog"."text" AS "query_digest"
),
"expected_tables"("table_name") AS (
  VALUES
    ('backfill_executions_v1'::"pg_catalog"."name"),
    ('backfill_heads_v1'::"pg_catalog"."name"),
    ('backfill_receipts_v2'::"pg_catalog"."name")
),
"schema_entry" AS (
  SELECT
    "namespace_entry"."oid" AS "schema_oid",
    "namespace_entry"."nspowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "pg_catalog"."obj_description"("namespace_entry"."oid", 'pg_namespace') AS "comment",
    "namespace_entry"."nspacl" AS "acl"
  FROM "pg_catalog"."pg_namespace" AS "namespace_entry"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry"
    ON "owner_entry"."oid" = "namespace_entry"."nspowner"
  CROSS JOIN "requested"
  WHERE "namespace_entry"."nspname" = "requested"."schema_name"
),
"owner_role_members"("role_oid") AS (
  SELECT "membership_entry"."member"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_auth_members" AS "membership_entry"
    ON "membership_entry"."roleid" = "schema_entry"."owner_oid"
  UNION
  SELECT "membership_entry"."member"
  FROM "pg_catalog"."pg_auth_members" AS "membership_entry"
  JOIN "owner_role_members"
    ON "membership_entry"."roleid" = "owner_role_members"."role_oid"
),
"table_entries" AS (
  SELECT
    "table_entry"."oid" AS "table_oid",
    "table_entry"."relname" AS "table_name",
    "table_entry"."relowner" AS "owner_oid",
    "owner_entry"."rolname" AS "owner_name",
    "table_entry"."relkind" AS "relation_kind",
    "table_entry"."relpersistence" AS "persistence",
    "table_entry"."relispartition" AS "is_partition",
    "table_entry"."relreplident" AS "replica_identity",
    "table_entry"."relrowsecurity" AS "rls_enabled",
    "table_entry"."relforcerowsecurity" AS "rls_forced",
    "table_entry"."relacl" AS "acl",
    "pg_catalog"."obj_description"("table_entry"."oid", 'pg_class') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
  JOIN "expected_tables" ON "expected_tables"."table_name" = "table_entry"."relname"
  JOIN "pg_catalog"."pg_roles" AS "owner_entry" ON "owner_entry"."oid" = "table_entry"."relowner"
  WHERE "table_entry"."relkind" = 'r'
),
"install_marker_constraint_entry" AS (
  SELECT
    "constraint_entry"."oid" AS "constraint_oid",
    "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint') AS "comment"
  FROM "schema_entry"
  JOIN "pg_catalog"."pg_class" AS "table_entry"
    ON "table_entry"."relnamespace" = "schema_entry"."schema_oid"
   AND "table_entry"."relname" = 'backfill_executions_v1'
   AND "table_entry"."relkind" = 'r'
  JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
    ON "constraint_entry"."conrelid" = "table_entry"."oid"
   AND "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
   AND "constraint_entry"."conname" = 'backfill_executions_v1_pkey'
   AND "constraint_entry"."contype" = 'p'
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
)
SELECT
  "requested"."review_digest" AS "reviewDigest",
  "requested"."ledger_shape_digest" AS "ledgerShapeDigest",
  "requested"."sql_digest" AS "sqlDigest",
  "requested"."project_ref" AS "projectRef",
  "requested"."account_id" AS "accountId",
  "requested"."grant_generation" AS "grantGeneration",
  "requested"."query_version" AS "queryVersion",
  "requested"."query_digest" AS "queryDigest",
  'read-only'::"pg_catalog"."text" AS "accessMode",
  'single-statement'::"pg_catalog"."text" AS "snapshotScope",
  TRUE AS "catalogOnly",
  FALSE AS "managedDataRead",
  "pg_catalog"."current_setting"('server_version_num') AS "serverVersionNum",
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
    'currentHasEffectivePgReadAllData', "pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'usage'),
    'sessionOid', "session_role_entry"."oid"::"pg_catalog"."text",
    'sessionName', SESSION_USER::"pg_catalog"."text",
    'sessionSuperuser', "session_role_entry"."rolsuper",
    'sessionBypassRls', "session_role_entry"."rolbypassrls",
    'sessionHasEffectivePgReadAllData', "pg_catalog"."pg_has_role"(SESSION_USER, 'pg_read_all_data', 'usage')
  ) AS "roles",
  "pg_catalog"."jsonb_build_object"(
    'databasePrimary', NOT "pg_catalog"."pg_is_in_recovery"(),
    'transactionReadOnly', "pg_catalog"."current_setting"('transaction_read_only')::"pg_catalog"."boolean",
    'effectiveSearchPath', "pg_catalog"."to_jsonb"(ARRAY["pg_catalog"."current_setting"('search_path')::"pg_catalog"."name"])
  ) AS "settings",
  "pg_catalog"."jsonb_build_object"(
    'schemaCount', (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "schema_entry"),
    'schemaOid', (SELECT "schema_oid"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaOwnerOid', (SELECT "owner_oid"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaOwnerName', (SELECT "owner_name"::"pg_catalog"."text" FROM "schema_entry"),
    'schemaComment', (SELECT "comment" FROM "schema_entry"),
    'installMarkerConstraintComment', (
      SELECT "comment" FROM "install_marker_constraint_entry"
    ),
    'schemaInstallMarkerPrefixCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
      WHERE "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint')
        LIKE 'openpencil-install:v1:supabase-backfill-database-cas-ledger:%'
    ), 0),
    'ownerRoleMemberCount', (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "owner_role_members"),
    'ownerDefaultNonOwnerPrivilegeCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_default_acl" AS "default_acl_entry"
        ON "default_acl_entry"."defaclrole" = "schema_entry"."owner_oid"
       AND "default_acl_entry"."defaclnamespace" IN (0, "schema_entry"."schema_oid")
       AND "default_acl_entry"."defaclobjtype" = 'r'
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"("default_acl_entry"."defaclacl") AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "schema_entry"."owner_oid"
    ), 0),
    'schemaNonOwnerPrivilegeCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE("schema_entry"."acl", "pg_catalog"."acldefault"('n', "schema_entry"."owner_oid"))
      ) AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "schema_entry"."owner_oid"
    ), 0),
    'relationCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_class" AS "relation_entry"
        ON "relation_entry"."relnamespace" = "schema_entry"."schema_oid"
      WHERE "relation_entry"."relkind" IN ('r', 'p', 'v', 'm', 'S', 'f')
    ), 0),
    'unexpectedIndexCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_index" AS "index_entry"
        ON "index_entry"."indrelid" = "table_entries"."table_oid"
      LEFT JOIN "pg_catalog"."pg_constraint" AS "backing_constraint"
        ON "backing_constraint"."conindid" = "index_entry"."indexrelid"
       AND "backing_constraint"."contype" IN ('p', 'u')
      WHERE "backing_constraint"."oid" IS NULL
    ), 0),
    'unexpectedTriggerCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_trigger" AS "trigger_entry"
        ON "trigger_entry"."tgrelid" = "table_entries"."table_oid"
      WHERE NOT "trigger_entry"."tgisinternal"
    ), 0),
    'unexpectedRuleCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_rewrite" AS "rule_entry"
        ON "rule_entry"."ev_class" = "table_entries"."table_oid"
    ), 0),
    'unexpectedConstraintCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."conrelid" = "table_entries"."table_oid"
      WHERE "constraint_entry"."contype" NOT IN ('p', 'u', 'f', 'c')
    ), 0),
    'inheritanceRelationCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "pg_catalog"."pg_inherits" AS "inheritance_entry"
      WHERE "inheritance_entry"."inhrelid" IN (SELECT "table_oid" FROM "table_entries")
         OR "inheritance_entry"."inhparent" IN (SELECT "table_oid" FROM "table_entries")
    ), 0),
    'publicationExposureCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "pg_catalog"."pg_publication_tables" AS "publication_entry"
      CROSS JOIN "requested"
      WHERE "publication_entry"."schemaname" = "requested"."schema_name"
        AND "publication_entry"."tablename" IN (SELECT "table_name" FROM "expected_tables")
    ), 0),
    'droppedColumnCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_attribute" AS "column_entry"
        ON "column_entry"."attrelid" = "table_entries"."table_oid"
       AND "column_entry"."attnum" > 0
       AND "column_entry"."attisdropped"
    ), 0),
    'policyCount', COALESCE((
      SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
      FROM "table_entries"
      JOIN "pg_catalog"."pg_policy" AS "policy_entry"
        ON "policy_entry"."polrelid" = "table_entries"."table_oid"
    ), 0),
    'tables', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'tableOid', "table_entries"."table_oid"::"pg_catalog"."text",
          'ownerOid', "table_entries"."owner_oid"::"pg_catalog"."text",
          'ownerName', "table_entries"."owner_name"::"pg_catalog"."text",
          'relationKind', "table_entries"."relation_kind"::"pg_catalog"."text",
          'persistence', "table_entries"."persistence"::"pg_catalog"."text",
          'isPartition', "table_entries"."is_partition",
          'replicaIdentity', "table_entries"."replica_identity"::"pg_catalog"."text",
          'rlsEnabled', "table_entries"."rls_enabled",
          'rlsForced', "table_entries"."rls_forced",
          'comment', "table_entries"."comment",
          'nonOwnerPrivilegeCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."aclexplode"(
              COALESCE("table_entries"."acl", "pg_catalog"."acldefault"('r', "table_entries"."owner_oid"))
            ) AS "acl_entry"
            WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
          ),
          'policyCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_policy" AS "policy_entry"
            WHERE "policy_entry"."polrelid" = "table_entries"."table_oid"
          )
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END
      )
      FROM "table_entries"
    ), '[]'::"pg_catalog"."jsonb"),
    'columns', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'ordinal', "column_entry"."attnum"::"pg_catalog"."int4",
          'columnName', "column_entry"."attname"::"pg_catalog"."text",
          'typeSchema', "type_namespace"."nspname"::"pg_catalog"."text",
          'typeName', "type_entry"."typname"::"pg_catalog"."text",
          'notNull', "column_entry"."attnotnull",
          'identityKind', "column_entry"."attidentity"::"pg_catalog"."text",
          'generatedKind', "column_entry"."attgenerated"::"pg_catalog"."text",
          'typeModifier', "column_entry"."atttypmod"::"pg_catalog"."int4",
          'usesTypeDefaultCollation', "column_entry"."attcollation" = "type_entry"."typcollation",
          'hasDefault', "column_default"."oid" IS NOT NULL,
          'nonOwnerColumnPrivilegeCount', COALESCE((
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."aclexplode"("column_entry"."attacl") AS "acl_entry"
            WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
          ), 0)
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END, "column_entry"."attnum"
      )
      FROM "table_entries"
      JOIN "pg_catalog"."pg_attribute" AS "column_entry"
        ON "column_entry"."attrelid" = "table_entries"."table_oid"
       AND "column_entry"."attnum" > 0
       AND NOT "column_entry"."attisdropped"
      JOIN "pg_catalog"."pg_type" AS "type_entry" ON "type_entry"."oid" = "column_entry"."atttypid"
      JOIN "pg_catalog"."pg_namespace" AS "type_namespace"
        ON "type_namespace"."oid" = "type_entry"."typnamespace"
      LEFT JOIN "pg_catalog"."pg_attrdef" AS "column_default"
        ON "column_default"."adrelid" = "column_entry"."attrelid"
       AND "column_default"."adnum" = "column_entry"."attnum"
    ), '[]'::"pg_catalog"."jsonb"),
    'constraints', COALESCE((
      SELECT "pg_catalog"."jsonb_agg"(
        "pg_catalog"."jsonb_build_object"(
          'tableName', "table_entries"."table_name"::"pg_catalog"."text",
          'constraintName', "constraint_entry"."conname"::"pg_catalog"."text",
          'constraintType', "constraint_entry"."contype"::"pg_catalog"."text",
          'fields', CASE WHEN "constraint_entry"."contype" = 'c'
            THEN '[]'::"pg_catalog"."jsonb"
            ELSE COALESCE((
              SELECT "pg_catalog"."jsonb_agg"("field_entry"."attname" ORDER BY "key_entry"."ordinality")
              FROM "pg_catalog"."unnest"("constraint_entry"."conkey")
                WITH ORDINALITY AS "key_entry"("attnum", "ordinality")
              JOIN "pg_catalog"."pg_attribute" AS "field_entry"
                ON "field_entry"."attrelid" = "constraint_entry"."conrelid"
               AND "field_entry"."attnum" = "key_entry"."attnum"
            ), '[]'::"pg_catalog"."jsonb") END,
          'targetSchemaName', "target_namespace"."nspname"::"pg_catalog"."text",
          'targetTableName', "target_table"."relname"::"pg_catalog"."text",
          'targetFields', CASE WHEN "constraint_entry"."contype" = 'f'
            THEN COALESCE((
              SELECT "pg_catalog"."jsonb_agg"("field_entry"."attname" ORDER BY "key_entry"."ordinality")
              FROM "pg_catalog"."unnest"("constraint_entry"."confkey")
                WITH ORDINALITY AS "key_entry"("attnum", "ordinality")
              JOIN "pg_catalog"."pg_attribute" AS "field_entry"
                ON "field_entry"."attrelid" = "constraint_entry"."confrelid"
               AND "field_entry"."attnum" = "key_entry"."attnum"
            ), '[]'::"pg_catalog"."jsonb") ELSE '[]'::"pg_catalog"."jsonb" END,
          'updateAction', "constraint_entry"."confupdtype"::"pg_catalog"."text",
          'deleteAction', "constraint_entry"."confdeltype"::"pg_catalog"."text",
          'matchType', "constraint_entry"."confmatchtype"::"pg_catalog"."text",
          'deferrable', "constraint_entry"."condeferrable",
          'initiallyDeferred', "constraint_entry"."condeferred",
          'validated', "constraint_entry"."convalidated",
          'noInherit', "constraint_entry"."connoinherit",
          'local', "constraint_entry"."conislocal",
          'inheritedCount', "constraint_entry"."coninhcount"::"pg_catalog"."int4",
          'hasParentConstraint', "constraint_entry"."conparentid" <> 0,
          'constraintTriggerCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_trigger" AS "constraint_trigger"
            WHERE "constraint_trigger"."tgconstraint" = "constraint_entry"."oid"
          ),
          'enabledConstraintTriggerCount', (
            SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4"
            FROM "pg_catalog"."pg_trigger" AS "constraint_trigger"
            WHERE "constraint_trigger"."tgconstraint" = "constraint_entry"."oid"
              AND "constraint_trigger"."tgenabled" = 'O'
          ),
          'supportingIndex', CASE WHEN "supporting_index"."indexrelid" IS NULL THEN NULL
            ELSE "pg_catalog"."jsonb_build_object"(
              'indexSchemaName', "supporting_index_namespace"."nspname"::"pg_catalog"."text",
              'indexName', "supporting_index_entry"."relname"::"pg_catalog"."text",
              'tableSchemaName', "supporting_index_table_namespace"."nspname"::"pg_catalog"."text",
              'tableName', "supporting_index_table"."relname"::"pg_catalog"."text",
              'accessMethodName', "supporting_index_access_method"."amname"::"pg_catalog"."text",
              'keyAttributeCount', "supporting_index"."indnkeyatts"::"pg_catalog"."int4",
              'totalAttributeCount', "supporting_index"."indnatts"::"pg_catalog"."int4",
              'keyFields', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "index_field"."attname" ORDER BY "index_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "index_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "index_field"
                  ON "index_field"."attrelid" = "supporting_index"."indrelid"
                 AND "index_field"."attnum" = "index_key"."attnum"
                WHERE "index_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'includedFields', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "included_field"."attname" ORDER BY "included_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "included_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "included_field"
                  ON "included_field"."attrelid" = "supporting_index"."indrelid"
                 AND "included_field"."attnum" = "included_key"."attnum"
                WHERE "included_key"."ordinality" > "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyOpclasses', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "opclass_namespace"."nspname"::"pg_catalog"."text",
                    'opclassName', "opclass_entry"."opcname"::"pg_catalog"."text"
                  ) ORDER BY "opclass_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indclass")
                  WITH ORDINALITY AS "opclass_key"("opclass_oid", "ordinality")
                JOIN "pg_catalog"."pg_opclass" AS "opclass_entry"
                  ON "opclass_entry"."oid" = "opclass_key"."opclass_oid"
                JOIN "pg_catalog"."pg_namespace" AS "opclass_namespace"
                  ON "opclass_namespace"."oid" = "opclass_entry"."opcnamespace"
                WHERE "opclass_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyOptions', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "option_key"."option"::"pg_catalog"."int4" ORDER BY "option_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indoption")
                  WITH ORDINALITY AS "option_key"("option", "ordinality")
                WHERE "option_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), '[]'::"pg_catalog"."jsonb"),
              'keyCollationsMatchColumns', COALESCE((
                SELECT "pg_catalog"."bool_and"(
                  "supporting_index"."indcollation"[
                    "pg_catalog"."array_lower"("supporting_index"."indcollation", 1) +
                    "collation_key"."ordinality"::"pg_catalog"."int4" - 1
                  ] = "collation_field"."attcollation"
                )
                FROM "pg_catalog"."unnest"("supporting_index"."indkey")
                  WITH ORDINALITY AS "collation_key"("attnum", "ordinality")
                JOIN "pg_catalog"."pg_attribute" AS "collation_field"
                  ON "collation_field"."attrelid" = "supporting_index"."indrelid"
                 AND "collation_field"."attnum" = "collation_key"."attnum"
                WHERE "collation_key"."ordinality" <= "supporting_index"."indnkeyatts"
              ), FALSE),
              'primary', "supporting_index"."indisprimary",
              'valid', "supporting_index"."indisvalid",
              'ready', "supporting_index"."indisready",
              'live', "supporting_index"."indislive",
              'unique', "supporting_index"."indisunique",
              'immediate', "supporting_index"."indimmediate",
              'hasPredicate', "supporting_index"."indpred" IS NOT NULL,
              'hasExpressions', "supporting_index"."indexprs" IS NOT NULL,
              'nullsNotDistinct', "supporting_index"."indnullsnotdistinct"
            ) END,
          'foreignKeyOperators', CASE WHEN "constraint_entry"."contype" = 'f' THEN
            "pg_catalog"."jsonb_build_object"(
              'primaryForeign', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "primary_foreign_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "primary_foreign_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "primary_foreign_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "primary_foreign_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "primary_foreign_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "primary_foreign_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "primary_foreign_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conpfeqop")
                  WITH ORDINALITY AS "primary_foreign_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "primary_foreign_operator"
                  ON "primary_foreign_operator"."oid" = "primary_foreign_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_operator_namespace"
                  ON "primary_foreign_operator_namespace"."oid" = "primary_foreign_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_foreign_left_type"
                  ON "primary_foreign_left_type"."oid" = "primary_foreign_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_left_type_namespace"
                  ON "primary_foreign_left_type_namespace"."oid" = "primary_foreign_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_foreign_right_type"
                  ON "primary_foreign_right_type"."oid" = "primary_foreign_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "primary_foreign_right_type_namespace"
                  ON "primary_foreign_right_type_namespace"."oid" = "primary_foreign_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb"),
              'primaryPrimary', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "primary_primary_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "primary_primary_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "primary_primary_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "primary_primary_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "primary_primary_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "primary_primary_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "primary_primary_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conppeqop")
                  WITH ORDINALITY AS "primary_primary_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "primary_primary_operator"
                  ON "primary_primary_operator"."oid" = "primary_primary_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_operator_namespace"
                  ON "primary_primary_operator_namespace"."oid" = "primary_primary_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_primary_left_type"
                  ON "primary_primary_left_type"."oid" = "primary_primary_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_left_type_namespace"
                  ON "primary_primary_left_type_namespace"."oid" = "primary_primary_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "primary_primary_right_type"
                  ON "primary_primary_right_type"."oid" = "primary_primary_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "primary_primary_right_type_namespace"
                  ON "primary_primary_right_type_namespace"."oid" = "primary_primary_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb"),
              'foreignForeign', COALESCE((
                SELECT "pg_catalog"."jsonb_agg"(
                  "pg_catalog"."jsonb_build_object"(
                    'schemaName', "foreign_foreign_operator_namespace"."nspname"::"pg_catalog"."text",
                    'operatorName', "foreign_foreign_operator"."oprname"::"pg_catalog"."text",
                    'leftTypeSchemaName', "foreign_foreign_left_type_namespace"."nspname"::"pg_catalog"."text",
                    'leftTypeName', "foreign_foreign_left_type"."typname"::"pg_catalog"."text",
                    'rightTypeSchemaName', "foreign_foreign_right_type_namespace"."nspname"::"pg_catalog"."text",
                    'rightTypeName', "foreign_foreign_right_type"."typname"::"pg_catalog"."text"
                  ) ORDER BY "foreign_foreign_operator_key"."ordinality"
                )
                FROM "pg_catalog"."unnest"("constraint_entry"."conffeqop")
                  WITH ORDINALITY AS "foreign_foreign_operator_key"("operator_oid", "ordinality")
                JOIN "pg_catalog"."pg_operator" AS "foreign_foreign_operator"
                  ON "foreign_foreign_operator"."oid" = "foreign_foreign_operator_key"."operator_oid"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_operator_namespace"
                  ON "foreign_foreign_operator_namespace"."oid" = "foreign_foreign_operator"."oprnamespace"
                JOIN "pg_catalog"."pg_type" AS "foreign_foreign_left_type"
                  ON "foreign_foreign_left_type"."oid" = "foreign_foreign_operator"."oprleft"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_left_type_namespace"
                  ON "foreign_foreign_left_type_namespace"."oid" = "foreign_foreign_left_type"."typnamespace"
                JOIN "pg_catalog"."pg_type" AS "foreign_foreign_right_type"
                  ON "foreign_foreign_right_type"."oid" = "foreign_foreign_operator"."oprright"
                JOIN "pg_catalog"."pg_namespace" AS "foreign_foreign_right_type_namespace"
                  ON "foreign_foreign_right_type_namespace"."oid" = "foreign_foreign_right_type"."typnamespace"
              ), '[]'::"pg_catalog"."jsonb")
            ) ELSE NULL END,
          'checkDefinition', CASE WHEN "constraint_entry"."contype" = 'c'
            THEN "pg_catalog"."pg_get_constraintdef"("constraint_entry"."oid", FALSE)
            ELSE NULL END
        ) ORDER BY CASE "table_entries"."table_name"
          WHEN 'backfill_executions_v1' THEN 1
          WHEN 'backfill_receipts_v2' THEN 2
          ELSE 3 END, "constraint_entry"."conname"
      )
      FROM "table_entries"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."conrelid" = "table_entries"."table_oid"
      LEFT JOIN "pg_catalog"."pg_class" AS "target_table"
        ON "target_table"."oid" = "constraint_entry"."confrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "target_namespace"
        ON "target_namespace"."oid" = "target_table"."relnamespace"
      LEFT JOIN "pg_catalog"."pg_index" AS "supporting_index"
        ON "supporting_index"."indexrelid" = "constraint_entry"."conindid"
      LEFT JOIN "pg_catalog"."pg_class" AS "supporting_index_entry"
        ON "supporting_index_entry"."oid" = "supporting_index"."indexrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "supporting_index_namespace"
        ON "supporting_index_namespace"."oid" = "supporting_index_entry"."relnamespace"
      LEFT JOIN "pg_catalog"."pg_am" AS "supporting_index_access_method"
        ON "supporting_index_access_method"."oid" = "supporting_index_entry"."relam"
      LEFT JOIN "pg_catalog"."pg_class" AS "supporting_index_table"
        ON "supporting_index_table"."oid" = "supporting_index"."indrelid"
      LEFT JOIN "pg_catalog"."pg_namespace" AS "supporting_index_table_namespace"
        ON "supporting_index_table_namespace"."oid" = "supporting_index_table"."relnamespace"
      WHERE "constraint_entry"."contype" IN ('p', 'u', 'f', 'c')
    ), '[]'::"pg_catalog"."jsonb")
  ) AS "catalog"
FROM "requested"
JOIN "current_role_entry" ON TRUE
JOIN "session_role_entry" ON TRUE
),
"full_catalog_exactness" AS MATERIALIZED (
  SELECT COALESCE((
    "pg_catalog"."jsonb_extract_path"("snapshot"."catalog", 'columns')
      = $openpencil_catalog$[{"tableName":"backfill_executions_v1","ordinal":1,"columnName":"execution_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":2,"columnName":"provider_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":3,"columnName":"environment","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":4,"columnName":"application_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":5,"columnName":"application_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":6,"columnName":"migration_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":7,"columnName":"migration_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":8,"columnName":"migration_plan_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":9,"columnName":"provider_authority_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":10,"columnName":"source_ledger_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":11,"columnName":"scope_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":12,"columnName":"resource_identity_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":13,"columnName":"catalog_precondition_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":14,"columnName":"canonical_scope","typeSchema":"pg_catalog","typeName":"bytea","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":15,"columnName":"canonical_scope_byte_length","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":16,"columnName":"capture_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":17,"columnName":"captured_high_water","typeSchema":"pg_catalog","typeName":"int8","notNull":false,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":18,"columnName":"initial_remaining_eligible_row_count","typeSchema":"pg_catalog","typeName":"int8","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":19,"columnName":"initial_remaining_target_row_count","typeSchema":"pg_catalog","typeName":"int8","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":20,"columnName":"required_matched_row_count","typeSchema":"pg_catalog","typeName":"int8","notNull":false,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":21,"columnName":"required_batch_count","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":22,"columnName":"batch_size","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":23,"columnName":"maximum_receipt_count","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":24,"columnName":"maximum_batch_count","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":25,"columnName":"status","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":26,"columnName":"created_at","typeSchema":"pg_catalog","typeName":"timestamptz","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_executions_v1","ordinal":27,"columnName":"updated_at","typeSchema":"pg_catalog","typeName":"timestamptz","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":1,"columnName":"execution_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":2,"columnName":"revision","typeSchema":"pg_catalog","typeName":"int8","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":3,"columnName":"event_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":4,"columnName":"receipt_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":5,"columnName":"idempotency_key","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":6,"columnName":"request_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":7,"columnName":"receipt_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":8,"columnName":"previous_revision","typeSchema":"pg_catalog","typeName":"int8","notNull":false,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":9,"columnName":"previous_event_id","typeSchema":"pg_catalog","typeName":"text","notNull":false,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":10,"columnName":"previous_receipt_digest","typeSchema":"pg_catalog","typeName":"text","notNull":false,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":11,"columnName":"checkpoint_kind","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":12,"columnName":"canonical_receipt","typeSchema":"pg_catalog","typeName":"bytea","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":13,"columnName":"canonical_receipt_byte_length","typeSchema":"pg_catalog","typeName":"int4","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_receipts_v2","ordinal":14,"columnName":"committed_at","typeSchema":"pg_catalog","typeName":"timestamptz","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_heads_v1","ordinal":1,"columnName":"execution_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_heads_v1","ordinal":2,"columnName":"revision","typeSchema":"pg_catalog","typeName":"int8","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_heads_v1","ordinal":3,"columnName":"event_id","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_heads_v1","ordinal":4,"columnName":"receipt_digest","typeSchema":"pg_catalog","typeName":"text","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0},{"tableName":"backfill_heads_v1","ordinal":5,"columnName":"updated_at","typeSchema":"pg_catalog","typeName":"timestamptz","notNull":true,"identityKind":"","generatedKind":"","typeModifier":-1,"usesTypeDefaultCollation":true,"hasDefault":false,"nonOwnerColumnPrivilegeCount":0}]$openpencil_catalog$::"pg_catalog"."jsonb"
    AND "pg_catalog"."jsonb_extract_path"("snapshot"."catalog", 'constraints')
      = $openpencil_catalog$[{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_application_id_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((application_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_capacity_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((batch_size >= 1) AND (batch_size <= 1000) AND (maximum_receipt_count = 10000) AND (maximum_batch_count = 9999) AND (initial_remaining_eligible_row_count >= 0) AND (initial_remaining_eligible_row_count <= ((batch_size)::bigint * (maximum_batch_count)::bigint)) AND (initial_remaining_target_row_count >= 0) AND (initial_remaining_target_row_count <= initial_remaining_eligible_row_count) AND ((required_matched_row_count IS NULL) OR ((required_matched_row_count >= 0) AND (required_matched_row_count <= initial_remaining_target_row_count))) AND (required_batch_count = CASE WHEN (initial_remaining_eligible_row_count = 0) THEN 0 ELSE (((initial_remaining_eligible_row_count - 1) / (batch_size)::bigint) + 1) END) AND (required_batch_count >= 0) AND (required_batch_count <= maximum_batch_count)))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_capture_key","constraintType":"u","fields":["capture_digest"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_executions_v1_capture_key","tableSchemaName":"openpencil_release","tableName":"backfill_executions_v1","accessMethodName":"btree","keyAttributeCount":1,"totalAttributeCount":1,"keyFields":["capture_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_digest_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((application_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (migration_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (migration_plan_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (provider_authority_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (source_ledger_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (scope_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (resource_identity_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (catalog_precondition_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (capture_digest ~ '^[A-Za-z0-9_-]{43}$'::text)))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_execution_id_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((execution_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_high_water_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((((captured_high_water IS NULL) = (initial_remaining_eligible_row_count = 0)) AND ((captured_high_water IS NULL) OR ((captured_high_water >= 0) AND (captured_high_water <= 9007199254740991)))))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_migration_id_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((migration_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_pkey","constraintType":"p","fields":["execution_id"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_executions_v1_pkey","tableSchemaName":"openpencil_release","tableName":"backfill_executions_v1","accessMethodName":"btree","keyAttributeCount":1,"totalAttributeCount":1,"keyFields":["execution_id"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0],"keyCollationsMatchColumns":true,"primary":true,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_provider_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((provider_id = 'supabase'::text) AND (environment = 'staging'::text)))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_scope_bytes_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((canonical_scope_byte_length = octet_length(canonical_scope)) AND (canonical_scope_byte_length >= 2) AND (canonical_scope_byte_length <= 65536) AND (scope_digest = translate(rtrim(encode(sha256(canonical_scope), 'base64'::text), '='::text), '+/'::text, '-_'::text))))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_scope_key","constraintType":"u","fields":["scope_digest"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_executions_v1_scope_key","tableSchemaName":"openpencil_release","tableName":"backfill_executions_v1","accessMethodName":"btree","keyAttributeCount":1,"totalAttributeCount":1,"keyFields":["scope_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_status_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))"},{"tableName":"backfill_executions_v1","constraintName":"backfill_executions_v1_time_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((updated_at >= created_at))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_canonical_bytes_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((canonical_receipt_byte_length = octet_length(canonical_receipt)) AND (canonical_receipt_byte_length >= 2) AND (canonical_receipt_byte_length <= 65536) AND (receipt_digest = translate(rtrim(encode(sha256(canonical_receipt), 'base64'::text), '='::text), '+/'::text, '-_'::text))))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_checkpoint_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((((revision = 1) AND (checkpoint_kind = 'capture'::text)) OR ((revision > 1) AND (checkpoint_kind = ANY (ARRAY['batch'::text, 'failure'::text])))))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_digest_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((receipt_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND (request_digest ~ '^[A-Za-z0-9_-]{43}$'::text) AND ((previous_receipt_digest IS NULL) OR (previous_receipt_digest ~ '^[A-Za-z0-9_-]{43}$'::text))))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_digest_key","constraintType":"u","fields":["execution_id","receipt_digest"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_digest_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","receipt_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_event_key","constraintType":"u","fields":["execution_id","event_id"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_event_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","event_id"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_execution_fkey","constraintType":"f","fields":["execution_id"],"targetSchemaName":"openpencil_release","targetTableName":"backfill_executions_v1","targetFields":["execution_id"],"updateAction":"r","deleteAction":"r","matchType":"s","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":4,"enabledConstraintTriggerCount":4,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_executions_v1_pkey","tableSchemaName":"openpencil_release","tableName":"backfill_executions_v1","accessMethodName":"btree","keyAttributeCount":1,"totalAttributeCount":1,"keyFields":["execution_id"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0],"keyCollationsMatchColumns":true,"primary":true,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":{"primaryForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"primaryPrimary":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"foreignForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}]},"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_head_key","constraintType":"u","fields":["execution_id","revision","event_id","receipt_digest"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_head_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":4,"totalAttributeCount":4,"keyFields":["execution_id","revision","event_id","receipt_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"int8_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0,0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_idempotency_key","constraintType":"u","fields":["execution_id","idempotency_key"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_idempotency_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","idempotency_key"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_identifier_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text) AND (receipt_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text) AND (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text)))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_pkey","constraintType":"p","fields":["execution_id","revision"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_pkey","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","revision"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"int8_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":true,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_previous_head_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((((revision = 1) AND (previous_revision IS NULL) AND (previous_event_id IS NULL) AND (previous_receipt_digest IS NULL)) OR ((revision > 1) AND (previous_revision IS NOT NULL) AND (previous_revision = (revision - 1)) AND (previous_event_id IS NOT NULL) AND (previous_receipt_digest IS NOT NULL))))"},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_previous_head_fkey","constraintType":"f","fields":["execution_id","previous_revision","previous_event_id","previous_receipt_digest"],"targetSchemaName":"openpencil_release","targetTableName":"backfill_receipts_v2","targetFields":["execution_id","revision","event_id","receipt_digest"],"updateAction":"r","deleteAction":"r","matchType":"s","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":4,"enabledConstraintTriggerCount":4,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_head_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":4,"totalAttributeCount":4,"keyFields":["execution_id","revision","event_id","receipt_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"int8_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0,0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":{"primaryForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"primaryPrimary":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"foreignForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}]},"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_receipt_id_key","constraintType":"u","fields":["execution_id","receipt_id"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_receipt_id_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","receipt_id"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_request_digest_key","constraintType":"u","fields":["execution_id","request_digest"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_request_digest_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":2,"totalAttributeCount":2,"keyFields":["execution_id","request_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_receipts_v2","constraintName":"backfill_receipts_v2_revision_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((revision >= 1) AND (revision <= 10000)))"},{"tableName":"backfill_heads_v1","constraintName":"backfill_heads_v1_digest_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((receipt_digest ~ '^[A-Za-z0-9_-]{43}$'::text))"},{"tableName":"backfill_heads_v1","constraintName":"backfill_heads_v1_event_id_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK ((event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'::text))"},{"tableName":"backfill_heads_v1","constraintName":"backfill_heads_v1_pkey","constraintType":"p","fields":["execution_id"],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_heads_v1_pkey","tableSchemaName":"openpencil_release","tableName":"backfill_heads_v1","accessMethodName":"btree","keyAttributeCount":1,"totalAttributeCount":1,"keyFields":["execution_id"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0],"keyCollationsMatchColumns":true,"primary":true,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":null,"checkDefinition":null},{"tableName":"backfill_heads_v1","constraintName":"backfill_heads_v1_receipt_fkey","constraintType":"f","fields":["execution_id","revision","event_id","receipt_digest"],"targetSchemaName":"openpencil_release","targetTableName":"backfill_receipts_v2","targetFields":["execution_id","revision","event_id","receipt_digest"],"updateAction":"r","deleteAction":"r","matchType":"s","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":4,"enabledConstraintTriggerCount":4,"supportingIndex":{"indexSchemaName":"openpencil_release","indexName":"backfill_receipts_v2_head_key","tableSchemaName":"openpencil_release","tableName":"backfill_receipts_v2","accessMethodName":"btree","keyAttributeCount":4,"totalAttributeCount":4,"keyFields":["execution_id","revision","event_id","receipt_digest"],"includedFields":[],"keyOpclasses":[{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"int8_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"},{"schemaName":"pg_catalog","opclassName":"text_ops"}],"keyOptions":[0,0,0,0],"keyCollationsMatchColumns":true,"primary":false,"valid":true,"ready":true,"live":true,"unique":true,"immediate":true,"hasPredicate":false,"hasExpressions":false,"nullsNotDistinct":false},"foreignKeyOperators":{"primaryForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"primaryPrimary":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}],"foreignForeign":[{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"int8","rightTypeSchemaName":"pg_catalog","rightTypeName":"int8"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"},{"schemaName":"pg_catalog","operatorName":"=","leftTypeSchemaName":"pg_catalog","leftTypeName":"text","rightTypeSchemaName":"pg_catalog","rightTypeName":"text"}]},"checkDefinition":null},{"tableName":"backfill_heads_v1","constraintName":"backfill_heads_v1_revision_check","constraintType":"c","fields":[],"targetSchemaName":null,"targetTableName":null,"targetFields":[],"updateAction":" ","deleteAction":" ","matchType":" ","deferrable":false,"initiallyDeferred":false,"validated":true,"noInherit":false,"local":true,"inheritedCount":0,"hasParentConstraint":false,"constraintTriggerCount":0,"enabledConstraintTriggerCount":0,"supportingIndex":null,"foreignKeyOperators":null,"checkDefinition":"CHECK (((revision >= 1) AND (revision <= 10000)))"}]$openpencil_catalog$::"pg_catalog"."jsonb"
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'schemaCount') = '1'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'ownerRoleMemberCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'ownerDefaultNonOwnerPrivilegeCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'schemaNonOwnerPrivilegeCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'relationCount') = '3'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedIndexCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedTriggerCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedRuleCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'unexpectedConstraintCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'inheritanceRelationCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'publicationExposureCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'droppedColumnCount') = '0'
    AND "pg_catalog"."jsonb_extract_path_text"("snapshot"."catalog", 'policyCount') = '0'
  ), FALSE) AS "ready"
  FROM "full_catalog_snapshot" AS "snapshot"
),
"catalog_guard" AS MATERIALIZED (
  SELECT COALESCE((
    (SELECT "pg_catalog"."count"(*) FROM "schema_entry") = 1
    AND (SELECT "comment" FROM "schema_entry") = 'openpencil:release-ledger:v1'
    AND (SELECT "pg_catalog"."count"(*) FROM "table_entries") = 3
    AND NOT EXISTS (
      SELECT 1
      FROM "table_entries"
      CROSS JOIN "schema_entry"
      WHERE "table_entries"."owner_oid" <> "schema_entry"."owner_oid"
        OR "table_entries"."relation_kind" <> 'r'
        OR "table_entries"."persistence" <> 'p'
        OR "table_entries"."is_partition"
        OR "table_entries"."replica_identity" <> 'd'
        OR NOT "table_entries"."rls_enabled"
        OR "table_entries"."rls_forced"
        OR "table_entries"."comment" IS DISTINCT FROM "table_entries"."expected_comment"
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_class" AS "relation_entry"
        ON "relation_entry"."relnamespace" = "schema_entry"."schema_oid"
      WHERE "relation_entry"."relkind" IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) = 3
    AND NOT EXISTS (
      SELECT 1
      FROM "table_entries"
      CROSS JOIN LATERAL "pg_catalog"."aclexplode"(
        COALESCE(
          "table_entries"."acl",
          "pg_catalog"."acldefault"('r', "table_entries"."owner_oid")
        )
      ) AS "acl_entry"
      WHERE "acl_entry"."grantee" <> "table_entries"."owner_oid"
    )
    AND NOT EXISTS (
      SELECT 1
      FROM "pg_catalog"."pg_inherits" AS "inheritance_entry"
      WHERE "inheritance_entry"."inhrelid" IN (SELECT "table_oid" FROM "table_entries")
         OR "inheritance_entry"."inhparent" IN (SELECT "table_oid" FROM "table_entries")
    )
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "pg_catalog"."pg_policy" AS "policy_entry"
      WHERE "policy_entry"."polrelid" IN (SELECT "table_oid" FROM "table_entries")
    ) = 0
    AND COALESCE((SELECT "ready" FROM "full_catalog_exactness"), FALSE)
    AND (SELECT "pg_catalog"."count"(*) FROM "install_marker_constraint_entry") = 1
    AND (
      SELECT "comment" FROM "install_marker_constraint_entry"
    ) ~ '^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$'
    AND (
      SELECT "pg_catalog"."count"(*)
      FROM "schema_entry"
      JOIN "pg_catalog"."pg_constraint" AS "constraint_entry"
        ON "constraint_entry"."connamespace" = "schema_entry"."schema_oid"
      WHERE "pg_catalog"."obj_description"("constraint_entry"."oid", 'pg_constraint')
        LIKE 'openpencil-install:v1:supabase-backfill-database-cas-ledger:%'
    ) = 1
  ), FALSE) AS "ready",
  CASE
    WHEN (SELECT "pg_catalog"."count"(*) FROM "install_marker_constraint_entry") = 1
      AND (SELECT "comment" FROM "install_marker_constraint_entry")
        ~ '^openpencil-install:v1:supabase-backfill-database-cas-ledger:[A-Za-z0-9_-]{43}$'
      THEN "pg_catalog"."translate"(
        "pg_catalog"."rtrim"(
          "pg_catalog"."encode"(
            "pg_catalog"."sha256"(
              "pg_catalog"."convert_to"(
                (SELECT "comment" FROM "install_marker_constraint_entry"),
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
  END::"pg_catalog"."text" AS "install_marker_digest"
),
"runtime_guard" AS MATERIALIZED (
  SELECT
    COALESCE((
      (SELECT "pg_catalog"."count"(*) FROM "current_role_entry") = 1
      AND (SELECT "pg_catalog"."count"(*) FROM "session_role_entry") = 1
      AND CURRENT_USER = SESSION_USER
      AND CURRENT_USER = 'supabase_read_only_user'
      AND NOT (SELECT "rolsuper" FROM "current_role_entry")
      AND NOT (SELECT "rolsuper" FROM "session_role_entry")
      AND (SELECT "rolbypassrls" FROM "current_role_entry")
      AND (SELECT "rolbypassrls" FROM "session_role_entry")
      AND "pg_catalog"."pg_has_role"(CURRENT_USER, 'pg_read_all_data', 'usage')
      AND "pg_catalog"."pg_has_role"(SESSION_USER, 'pg_read_all_data', 'usage')
      AND (SELECT "oid" FROM "current_role_entry") = (SELECT "oid" FROM "session_role_entry")
      AND (SELECT "oid" FROM "current_role_entry") <> (SELECT "owner_oid" FROM "schema_entry")
      AND NOT EXISTS (
        SELECT 1 FROM "owner_role_members"
        WHERE "role_oid" = (SELECT "oid" FROM "current_role_entry")
      )
      AND NOT "pg_catalog"."pg_is_in_recovery"()
      AND "pg_catalog"."current_setting"('search_path') = 'pg_catalog'
    ), FALSE) AS "ready",
    "pg_catalog"."current_setting"('transaction_read_only')::"pg_catalog"."boolean"
      AS "transaction_read_only"
),
"read_executions" AS MATERIALIZED (
  SELECT "execution".*
  FROM ONLY "openpencil_release"."backfill_executions_v1" AS "execution"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND (
      "execution"."execution_id" = "input"."execution_id"
      OR "execution"."capture_digest" = "input"."capture_digest"
      OR "execution"."scope_digest" = "input"."scope_digest"
    )
  LIMIT 2
),
"read_head" AS MATERIALIZED (
  SELECT "head".*
  FROM ONLY "openpencil_release"."backfill_heads_v1" AS "head"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "head"."execution_id" = "input"."execution_id"
  LIMIT 2
),
"read_receipts" AS MATERIALIZED (
  SELECT
    "input"."execution_id" AS "execution_id",
    "receipt"."revision",
    CASE
      WHEN "pg_catalog"."octet_length"("receipt"."event_id") BETWEEN 1 AND 128
        THEN "receipt"."event_id"
      ELSE NULL
    END AS "event_id",
    CASE
      WHEN "pg_catalog"."octet_length"("receipt"."receipt_digest") = 43
        THEN "receipt"."receipt_digest"
      ELSE NULL
    END AS "receipt_digest",
    "receipt"."previous_revision",
    CASE
      WHEN "receipt"."previous_event_id" IS NULL THEN NULL
      WHEN "pg_catalog"."octet_length"("receipt"."previous_event_id") BETWEEN 1 AND 128
        THEN "receipt"."previous_event_id"
      ELSE NULL
    END AS "previous_event_id",
    CASE
      WHEN "receipt"."previous_receipt_digest" IS NULL THEN NULL
      WHEN "pg_catalog"."octet_length"("receipt"."previous_receipt_digest") = 43
        THEN "receipt"."previous_receipt_digest"
      ELSE NULL
    END AS "previous_receipt_digest",
    "receipt"."committed_at"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "receipt"."execution_id" = "input"."execution_id"
  LIMIT 10001
),
"read_receipt_zero" AS MATERIALIZED (
  SELECT
    "input"."execution_id" AS "execution_id",
    "receipt"."revision",
    "receipt"."event_id" = "input"."event_id" AS "event_id_exact",
    "receipt"."receipt_id" = "input"."receipt_id" AS "receipt_id_exact",
    "receipt"."idempotency_key" = "input"."idempotency_key" AS "idempotency_key_exact",
    "receipt"."request_digest" = "input"."request_digest" AS "request_digest_exact",
    "receipt"."receipt_digest" = "input"."receipt_digest" AS "receipt_digest_exact",
    "receipt"."previous_revision" IS NULL AS "previous_revision_exact",
    "receipt"."previous_event_id" IS NULL AS "previous_event_id_exact",
    "receipt"."previous_receipt_digest" IS NULL AS "previous_receipt_digest_exact",
    "receipt"."checkpoint_kind" = 'capture' AS "checkpoint_kind_exact",
    "receipt"."canonical_receipt" = "input"."canonical_receipt" AS "canonical_receipt_exact",
    "receipt"."canonical_receipt_byte_length" =
      "pg_catalog"."octet_length"("input"."canonical_receipt") AS "canonical_receipt_byte_length_exact",
    "receipt"."committed_at" = "input"."candidate_committed_at" AS "committed_at_exact"
  FROM ONLY "openpencil_release"."backfill_receipts_v2" AS "receipt"
  CROSS JOIN "input_validity" AS "input"
  CROSS JOIN "catalog_guard" AS "catalog"
  CROSS JOIN "runtime_guard" AS "runtime"
  WHERE "input"."valid"
    AND "catalog"."ready"
    AND "runtime"."ready"
    AND "receipt"."execution_id" = "input"."execution_id"
    AND "receipt"."revision" = 1
  LIMIT 2
),
"exact_initial_execution" AS MATERIALIZED (
  SELECT "execution"."execution_id"
  FROM "read_executions" AS "execution"
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
  FROM "read_executions" AS "execution"
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
  FROM "read_receipt_zero" AS "receipt"
  WHERE "receipt"."revision" = 1
    AND "receipt"."event_id_exact"
    AND "receipt"."receipt_id_exact"
    AND "receipt"."idempotency_key_exact"
    AND "receipt"."request_digest_exact"
    AND "receipt"."receipt_digest_exact"
    AND "receipt"."previous_revision_exact"
    AND "receipt"."previous_event_id_exact"
    AND "receipt"."previous_receipt_digest_exact"
    AND "receipt"."checkpoint_kind_exact"
    AND "receipt"."canonical_receipt_exact"
    AND "receipt"."canonical_receipt_byte_length_exact"
    AND "receipt"."committed_at_exact"
),
"exact_initial_head" AS MATERIALIZED (
  SELECT "head"."execution_id"
  FROM "read_head" AS "head"
  CROSS JOIN "input_validity" AS "input"
  WHERE "head"."execution_id" = "input"."execution_id"
    AND "head"."revision" = 1
    AND "head"."event_id" = "input"."event_id"
    AND "head"."receipt_digest" = "input"."receipt_digest"
    AND "head"."updated_at" = "input"."candidate_committed_at"
),
"receipt_chain"(
  "execution_id", "revision", "event_id", "receipt_digest", "previous_revision",
  "previous_event_id", "previous_receipt_digest", "committed_at", "depth"
) AS (
  SELECT
    "receipt"."execution_id", "receipt"."revision", "receipt"."event_id",
    "receipt"."receipt_digest", "receipt"."previous_revision", "receipt"."previous_event_id",
    "receipt"."previous_receipt_digest", "receipt"."committed_at", 1::"pg_catalog"."int4"
  FROM "read_head" AS "head"
  JOIN "read_receipts" AS "receipt"
    ON "receipt"."execution_id" = "head"."execution_id"
   AND "receipt"."revision" = "head"."revision"
   AND "receipt"."event_id" = "head"."event_id"
   AND "receipt"."receipt_digest" = "head"."receipt_digest"
  WHERE "head"."revision" BETWEEN 2 AND 10000
  UNION
  SELECT
    "previous"."execution_id", "previous"."revision", "previous"."event_id",
    "previous"."receipt_digest", "previous"."previous_revision",
    "previous"."previous_event_id", "previous"."previous_receipt_digest",
    "previous"."committed_at", "chain"."depth" + 1
  FROM "receipt_chain" AS "chain"
  JOIN "read_receipts" AS "previous"
    ON "previous"."execution_id" = "chain"."execution_id"
   AND "previous"."revision" = "chain"."previous_revision"
   AND "previous"."event_id" = "chain"."previous_event_id"
   AND "previous"."receipt_digest" = "chain"."previous_receipt_digest"
  WHERE "chain"."previous_revision" = "chain"."revision" - 1
    AND "chain"."depth" < 10000
),
"facts" AS MATERIALIZED (
  SELECT
    "input"."scope_digest",
    "input"."receipt_digest",
    "input"."unauthenticated_operation_evidence_digest" AS "candidate_operation_evidence_digest",
    "input"."valid" AS "input_valid",
    "runtime"."ready" AS "runtime_ready",
    "catalog"."ready" AS "full_ledger_shape_verified",
    "catalog"."install_marker_digest",
    "runtime"."transaction_read_only",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_executions") AS "collision_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_executions" AS "execution"
      WHERE "execution"."execution_id" = "input"."execution_id") AS "target_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_initial_execution") AS "exact_initial_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_immutable_execution") AS "exact_immutable_execution_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_receipts") AS "receipt_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_receipt_zero") AS "exact_receipt_zero_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "read_head") AS "head_count",
    (SELECT "pg_catalog"."max"("revision")::"pg_catalog"."int4" FROM "read_head") AS "head_revision",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "exact_initial_head") AS "exact_initial_head_count",
    (SELECT "pg_catalog"."count"(*)::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_count",
    (SELECT "pg_catalog"."min"("revision")::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_minimum_revision",
    (SELECT "pg_catalog"."max"("revision")::"pg_catalog"."int4" FROM "receipt_chain") AS "chain_maximum_revision",
    COALESCE(
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_head") = (
        SELECT "pg_catalog"."max"("committed_at") FROM "receipt_chain"
        WHERE "revision" = (SELECT "pg_catalog"."max"("revision") FROM "receipt_chain")
      ),
      FALSE
    ) AS "head_timestamp_matches_latest_receipt",
    COALESCE(
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_executions" AS "execution"
        WHERE "execution"."execution_id" = "input"."execution_id") =
      (SELECT "pg_catalog"."max"("updated_at") FROM "read_head"),
      FALSE
    ) AS "execution_timestamp_matches_head",
    "input"."initial_execution_status",
    "input"."receipt_document" ->> 'outcome' AS "initial_receipt_outcome"
  FROM "input_validity" AS "input"
  CROSS JOIN "runtime_guard" AS "runtime"
  CROSS JOIN "catalog_guard" AS "catalog"
),
"classification" AS MATERIALIZED (
  SELECT CASE
    WHEN NOT "facts"."input_valid"
      OR NOT "facts"."runtime_ready"
      OR NOT "facts"."full_ledger_shape_verified"
      THEN 'precondition-failed'
    WHEN "facts"."collision_execution_count" = 0
      AND "facts"."receipt_count" = 0
      AND "facts"."head_count" = 0
      THEN 'absent'
    WHEN "facts"."collision_execution_count" = 1
      AND "facts"."target_execution_count" = 1
      AND "facts"."exact_initial_execution_count" = 1
      AND "facts"."receipt_count" = 1
      AND "facts"."exact_receipt_zero_count" = 1
      AND "facts"."head_count" = 1
      AND "facts"."head_revision" = 1
      AND "facts"."exact_initial_head_count" = 1
      THEN 'exact-replay'
    WHEN "facts"."initial_execution_status" = 'running'
      AND "facts"."initial_receipt_outcome" = 'in-progress'
      AND "facts"."collision_execution_count" = 1
      AND "facts"."target_execution_count" = 1
      AND "facts"."exact_immutable_execution_count" = 1
      AND "facts"."receipt_count" = "facts"."head_revision"
      AND "facts"."exact_receipt_zero_count" = 1
      AND "facts"."head_count" = 1
      AND "facts"."head_revision" BETWEEN 2 AND 10000
      AND "facts"."chain_count" = "facts"."head_revision"
      AND "facts"."chain_minimum_revision" = 1
      AND "facts"."chain_maximum_revision" = "facts"."head_revision"
      AND "facts"."head_timestamp_matches_latest_receipt"
      AND "facts"."execution_timestamp_matches_head"
      THEN 'advanced-head'
    ELSE 'corruption'
  END::"pg_catalog"."text" AS "reported_status"
  FROM "facts"
)
SELECT
  'openpencil-supabase-backfill-receipt-zero-reconciliation-v1'::"pg_catalog"."text"
    AS "queryVersion",
  "facts"."scope_digest" AS "scopeDigest",
  "facts"."receipt_digest" AS "receiptDigest",
  "facts"."candidate_operation_evidence_digest" AS "candidateOperationEvidenceDigest",
  "facts"."initial_execution_status" AS "initialExecutionStatus",
  "facts"."initial_receipt_outcome" AS "initialReceiptOutcome",
  "classification"."reported_status" AS "reportedStatus",
  "facts"."input_valid" AS "inputValid",
  "facts"."runtime_ready" AS "runtimeReady",
  "facts"."full_ledger_shape_verified" AS "fullLedgerShapeVerified",
  "facts"."collision_execution_count" AS "collisionExecutionCount",
  "facts"."target_execution_count" AS "targetExecutionCount",
  "facts"."exact_initial_execution_count" AS "exactInitialExecutionCount",
  "facts"."exact_immutable_execution_count" AS "exactImmutableExecutionCount",
  "facts"."receipt_count" AS "receiptCount",
  "facts"."exact_receipt_zero_count" AS "exactReceiptZeroCount",
  "facts"."head_count" AS "headCount",
  "facts"."head_revision" AS "headRevision",
  "facts"."exact_initial_head_count" AS "exactInitialHeadCount",
  "facts"."chain_count" AS "chainCount",
  "facts"."chain_minimum_revision" AS "chainMinimumRevision",
  "facts"."chain_maximum_revision" AS "chainMaximumRevision",
  "facts"."head_timestamp_matches_latest_receipt" AS "headTimestampMatchesLatestReceipt",
  "facts"."execution_timestamp_matches_head" AS "executionTimestampMatchesHead",
  "facts"."transaction_read_only" AS "transactionReadOnly",
  "facts"."install_marker_digest" AS "installMarkerDigest",
  "pg_catalog"."current_setting"('server_version_num') AS "serverVersionNum",
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
  ) AS "snapshotDigest",
  "pg_catalog"."to_char"(
    "pg_catalog"."statement_timestamp"() AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) AS "observedAt"
FROM "facts"
CROSS JOIN "classification";
