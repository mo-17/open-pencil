WITH RECURSIVE "requested" AS (
  SELECT
    $1::"pg_catalog"."name" AS "schema_name",
    $2::"pg_catalog"."text" AS "review_digest",
    $3::"pg_catalog"."text" AS "ledger_shape_digest",
    $4::"pg_catalog"."text" AS "sql_digest",
    $5::"pg_catalog"."text" AS "project_ref",
    $6::"pg_catalog"."text" AS "account_id",
    $7::"pg_catalog"."text" AS "grant_generation",
    $8::"pg_catalog"."text" AS "query_version",
    $9::"pg_catalog"."text" AS "query_digest"
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
    'effectiveSearchPath', "pg_catalog"."to_jsonb"("pg_catalog"."current_schemas"(TRUE))
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
