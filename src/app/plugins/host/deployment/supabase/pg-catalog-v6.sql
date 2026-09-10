WITH
"openpencil_provenance" AS (
SELECT
  d.oid::pg_catalog.text AS "databaseOid",
  pg_catalog.current_database()::pg_catalog.text AS "databaseName",
  n.oid::pg_catalog.text AS "schemaOid",
  n.nspname::pg_catalog.text AS "schemaName",
  r.oid::pg_catalog.text AS "currentRoleOid",
  current_user::pg_catalog.text AS "currentRoleName",
  pg_catalog.current_setting('server_version_num')::pg_catalog.text AS "serverVersionNum",
  pg_catalog.txid_current_snapshot()::pg_catalog.text AS "snapshotMarker",
  pg_catalog.to_char(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS acl_attribute
    JOIN pg_catalog.pg_class AS acl_relation ON acl_relation.oid = acl_attribute.attrelid
    WHERE acl_relation.relnamespace = n.oid
      AND acl_relation.relkind IN ('r', 'p', 'v', 'm')
      AND acl_attribute.attnum > 0
      AND NOT acl_attribute.attisdropped
      AND acl_attribute.attacl IS NOT NULL
  ) AS "columnPrivilegesPresent"
FROM pg_catalog.pg_database AS d
JOIN pg_catalog.pg_namespace AS n ON n.nspname = $1
JOIN pg_catalog.pg_roles AS r ON r.rolname = current_user
WHERE d.datname = pg_catalog.current_database()
ORDER BY d.oid
LIMIT $2
),
"openpencil_objects" AS (
WITH catalog_objects AS (
  SELECT
    'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
    c.oid::pg_catalog.text AS "objectOid",
    0::pg_catalog.int4 AS "subId",
    n.oid::pg_catalog.text AS "schemaOid",
    n.nspname::pg_catalog.text AS "schemaName",
    CASE c.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'table'
      WHEN 'S' THEN 'sequence'
      ELSE 'view'
    END::pg_catalog.text AS "kind",
    c.relname::pg_catalog.text AS "objectName",
    CASE WHEN c.relkind IN ('r', 'p') THEN c.relrowsecurity ELSE NULL END AS "rlsEnabled",
    CASE WHEN c.relkind IN ('r', 'p') THEN c.relforcerowsecurity ELSE NULL END AS "rlsForced",
    CASE WHEN c.relkind IN ('v', 'm')
      THEN COALESCE((
        SELECT reloption.option_value::pg_catalog.bool
        FROM pg_catalog.pg_options_to_table(c.reloptions) AS reloption
        WHERE reloption.option_name = 'security_invoker'
      ), false)
      ELSE NULL END AS "securityInvoker",
    NULL::pg_catalog.bool AS "securityDefiner",
    NULL::pg_catalog.jsonb AS "enumValues",
    CASE WHEN pg_catalog.obj_description(c.oid, 'pg_class') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(c.oid, 'pg_class') ELSE NULL END AS "marker"
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = $3 AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  UNION ALL
  SELECT
    'pg_catalog.pg_proc'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text,
    p.oid::pg_catalog.text,
    0,
    n.oid::pg_catalog.text,
    n.nspname::pg_catalog.text,
    'function',
    p.proname::pg_catalog.text,
    NULL,
    NULL,
    NULL,
    p.prosecdef,
    NULL::pg_catalog.jsonb,
    CASE WHEN pg_catalog.obj_description(p.oid, 'pg_proc') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(p.oid, 'pg_proc') ELSE NULL END
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = $3
  UNION ALL
  SELECT
    'pg_catalog.pg_type'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text,
    t.oid::pg_catalog.text,
    0,
    n.oid::pg_catalog.text,
    n.nspname::pg_catalog.text,
    'enum',
    t.typname::pg_catalog.text,
    NULL,
    NULL,
    NULL,
    NULL,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_catalog.pg_enum AS e WHERE e.enumtypid = t.oid
    ), '[]'::pg_catalog.jsonb),
    CASE WHEN pg_catalog.obj_description(t.oid, 'pg_type') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(t.oid, 'pg_type') ELSE NULL END
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = $3 AND t.typtype = 'e'
)
SELECT * FROM catalog_objects
ORDER BY "kind", "schemaName", "objectName", "objectOid"
LIMIT $4
),
"openpencil_columns" AS (
SELECT
  'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
  c.oid::pg_catalog.text AS "objectOid",
  a.attnum::pg_catalog.int4 AS "subId",
  n.oid::pg_catalog.text AS "schemaOid",
  n.nspname::pg_catalog.text AS "schemaName",
  c.relname::pg_catalog.text AS "tableName",
  a.attname::pg_catalog.text AS "columnName",
  t.oid::pg_catalog.text AS "typeOid",
  tn.nspname::pg_catalog.text AS "typeSchema",
  t.typname::pg_catalog.text AS "typeName",
  t.typtype::pg_catalog.text AS "typeKind",
  NOT a.attnotnull AS "nullable",
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)::pg_catalog.text AS "defaultExpression",
  a.attidentity::pg_catalog.text AS "identityKind",
  a.attgenerated::pg_catalog.text AS "generatedKind",
  a.attacl IS NOT NULL AS "columnPrivilegesPresent",
  CASE WHEN pg_catalog.col_description(c.oid, a.attnum) LIKE 'openpencil:%'
    THEN pg_catalog.col_description(c.oid, a.attnum) ELSE NULL END AS "marker"
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_attrdef AS ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = $5
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum
LIMIT $6
),
"openpencil_constraints" AS (
SELECT
  'pg_catalog.pg_constraint'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
  con.oid::pg_catalog.text AS "objectOid",
  0::pg_catalog.int4 AS "subId",
  n.oid::pg_catalog.text AS "schemaOid",
  n.nspname::pg_catalog.text AS "schemaName",
  rel.oid::pg_catalog.text AS "tableOid",
  rel.relname::pg_catalog.text AS "tableName",
  con.conname::pg_catalog.text AS "constraintName",
  con.contype::pg_catalog.text AS "constraintType",
  COALESCE((SELECT pg_catalog.jsonb_agg(att.attname ORDER BY keys.ordinality)
    FROM pg_catalog.unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = keys.attnum
  ), '[]'::pg_catalog.jsonb) AS "fields",
  target.oid::pg_catalog.text AS "targetTableOid",
  target.relname::pg_catalog.text AS "targetTableName",
  COALESCE((SELECT pg_catalog.jsonb_agg(att.attname ORDER BY keys.ordinality)
    FROM pg_catalog.unnest(con.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.confrelid AND att.attnum = keys.attnum
  ), '[]'::pg_catalog.jsonb) AS "targetFields",
  con.confdeltype::pg_catalog.text AS "onDeleteCode",
  pg_catalog.pg_get_constraintdef(con.oid, true)::pg_catalog.text AS "definition",
  con.convalidated AS "validated",
  CASE WHEN pg_catalog.obj_description(con.oid, 'pg_constraint') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(con.oid, 'pg_constraint') ELSE NULL END AS "marker"
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_class AS target ON target.oid = con.confrelid
WHERE n.nspname = $7 AND con.contype IN ('p', 'u', 'f', 'c')
ORDER BY n.nspname, rel.relname, con.conname, con.oid
LIMIT $8
),
"openpencil_indexes" AS (
SELECT
  'pg_catalog.pg_class'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
  idx.oid::pg_catalog.text AS "objectOid",
  0::pg_catalog.int4 AS "subId",
  n.oid::pg_catalog.text AS "schemaOid",
  n.nspname::pg_catalog.text AS "schemaName",
  rel.oid::pg_catalog.text AS "tableOid",
  rel.relname::pg_catalog.text AS "tableName",
  idx.relname::pg_catalog.text AS "indexName",
  COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'name', att.attname,
      'order', CASE WHEN (ind.indoption[keys.ordinality - 1] & 1) = 1 THEN 'desc' ELSE 'asc' END
    ) ORDER BY keys.ordinality)
    FROM pg_catalog.unnest(ind.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
    LEFT JOIN pg_catalog.pg_attribute AS att
      ON att.attrelid = ind.indrelid AND att.attnum = keys.attnum
  ), '[]'::pg_catalog.jsonb) AS "fields",
  pg_catalog.pg_get_expr(ind.indpred, ind.indrelid)::pg_catalog.text AS "predicate",
  pg_catalog.pg_get_expr(ind.indexprs, ind.indrelid)::pg_catalog.text AS "expressions",
  pg_catalog.pg_get_indexdef(idx.oid)::pg_catalog.text AS "definition",
  ind.indisvalid AS "valid",
  ind.indisready AS "ready",
  CASE WHEN pg_catalog.obj_description(idx.oid, 'pg_class') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(idx.oid, 'pg_class') ELSE NULL END AS "marker"
FROM pg_catalog.pg_index AS ind
JOIN pg_catalog.pg_class AS idx ON idx.oid = ind.indexrelid
JOIN pg_catalog.pg_class AS rel ON rel.oid = ind.indrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_constraint AS backing_constraint ON backing_constraint.conindid = idx.oid
WHERE n.nspname = $9 AND backing_constraint.oid IS NULL
ORDER BY n.nspname, rel.relname, idx.relname, idx.oid
LIMIT $10
),
"openpencil_policies" AS (
SELECT
  'pg_catalog.pg_policy'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
  pol.oid::pg_catalog.text AS "objectOid",
  0::pg_catalog.int4 AS "subId",
  n.oid::pg_catalog.text AS "schemaOid",
  n.nspname::pg_catalog.text AS "schemaName",
  rel.oid::pg_catalog.text AS "tableOid",
  rel.relname::pg_catalog.text AS "tableName",
  pol.polname::pg_catalog.text AS "policyName",
  pol.polpermissive AS "permissive",
  CASE pol.polcmd WHEN '*' THEN 'all' WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert'
    WHEN 'w' THEN 'update' WHEN 'd' THEN 'delete' END::pg_catalog.text AS "command",
  COALESCE((SELECT pg_catalog.jsonb_agg(CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
      ELSE role.rolname END
    ORDER BY CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END)
    FROM pg_catalog.unnest(pol.polroles) AS policy_role(role_oid)
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
  ), '[]'::pg_catalog.jsonb) AS "roles",
  pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)::pg_catalog.text AS "usingExpression",
  pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)::pg_catalog.text AS "withCheckExpression",
  CASE WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(pol.oid, 'pg_policy') ELSE NULL END AS "marker"
FROM pg_catalog.pg_policy AS pol
JOIN pg_catalog.pg_class AS rel ON rel.oid = pol.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
WHERE n.nspname = $11
ORDER BY n.nspname, rel.relname, pol.polname, pol.oid
LIMIT $12
),
"openpencil_storage_buckets" AS (
SELECT
  bucket.id::pg_catalog.text AS "bucketId",
  bucket.name::pg_catalog.text AS "bucketName",
  bucket.public AS "public",
  bucket.file_size_limit::pg_catalog.text AS "fileSizeLimit",
  pg_catalog.to_jsonb(bucket.allowed_mime_types) AS "allowedMimeTypes"
FROM storage.buckets AS bucket
WHERE $13 = 'public'
ORDER BY bucket.id
LIMIT $14
),
"openpencil_storage_policies" AS (
SELECT
  'pg_catalog.pg_policy'::pg_catalog.regclass::pg_catalog.oid::pg_catalog.text AS "classOid",
  pol.oid::pg_catalog.text AS "objectOid",
  0::pg_catalog.int4 AS "subId",
  rel.oid::pg_catalog.text AS "tableOid",
  pol.polname::pg_catalog.text AS "policyName",
  pol.polpermissive AS "permissive",
  CASE pol.polcmd WHEN '*' THEN 'all' WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert'
    WHEN 'w' THEN 'update' WHEN 'd' THEN 'delete' END::pg_catalog.text AS "command",
  COALESCE((SELECT pg_catalog.jsonb_agg(CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
      ELSE role.rolname END
    ORDER BY CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END)
    FROM pg_catalog.unnest(pol.polroles) AS policy_role(role_oid)
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
  ), '[]'::pg_catalog.jsonb) AS "roles",
  pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)::pg_catalog.text AS "usingExpression",
  pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)::pg_catalog.text AS "withCheckExpression",
  CASE WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(pol.oid, 'pg_policy') ELSE NULL END AS "marker"
FROM pg_catalog.pg_policy AS pol
JOIN pg_catalog.pg_class AS rel ON rel.oid = pol.polrelid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = rel.relnamespace
WHERE $15 = 'public'
  AND namespace.nspname = 'storage'
  AND rel.relname = 'objects'
ORDER BY pol.polname, pol.oid
LIMIT $16
),
"openpencil_roles" AS (
SELECT
  role.oid::pg_catalog.text AS "roleOid",
  role.rolname::pg_catalog.text AS "roleName",
  role.rolsuper AS "superuser",
  role.rolbypassrls AS "bypassRls",
  role.rolinherit AS "inherit"
FROM pg_catalog.pg_roles AS role
WHERE $17 = 'public'
ORDER BY role.rolname, role.oid
LIMIT $18
),
"openpencil_role_memberships" AS (
SELECT
  membership.roleid::pg_catalog.text AS "roleOid",
  role.rolname::pg_catalog.text AS "roleName",
  membership.member::pg_catalog.text AS "memberOid",
  member.rolname::pg_catalog.text AS "memberName",
  membership.grantor::pg_catalog.text AS "grantorOid",
  grantor.rolname::pg_catalog.text AS "grantorName",
  membership.admin_option AS "adminOption",
  COALESCE((pg_catalog.to_jsonb(membership)->>'inherit_option')::pg_catalog.bool, true) AS "inheritOption",
  COALESCE((pg_catalog.to_jsonb(membership)->>'set_option')::pg_catalog.bool, true) AS "setOption"
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
WHERE $19 = 'public'
ORDER BY role.rolname, member.rolname, grantor.rolname
LIMIT $20
),
"openpencil_privileges" AS (
WITH object_acls AS (
  SELECT 'schema'::pg_catalog.text AS "objectKind", n.oid AS object_oid, n.oid AS schema_oid,
    n.nspname::pg_catalog.text AS "objectName", n.nspowner AS owner_oid, n.nspacl AS acl
  FROM pg_catalog.pg_namespace AS n WHERE n.nspname = $21
  UNION ALL
  SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'view'
      ELSE 'table' END,
    c.oid, n.oid, c.relname::pg_catalog.text, c.relowner, c.relacl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = $21 AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  UNION ALL
  SELECT 'function', p.oid, n.oid, p.proname::pg_catalog.text, p.proowner, p.proacl
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = $21
  UNION ALL
  SELECT 'enum', t.oid, n.oid, t.typname::pg_catalog.text, t.typowner, t.typacl
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = $21 AND t.typtype = 'e'
)
SELECT
  object_acls."objectKind",
  object_acls.object_oid::pg_catalog.text AS "objectOid",
  object_acls.schema_oid::pg_catalog.text AS "schemaOid",
  $21::pg_catalog.text AS "schemaName",
  object_acls."objectName",
  acl.grantor::pg_catalog.text AS "grantorOid",
  grantor.rolname::pg_catalog.text AS "grantorName",
  acl.grantee::pg_catalog.text AS "granteeOid",
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END::pg_catalog.text AS "granteeName",
  acl.privilege_type::pg_catalog.text AS "privilege",
  acl.is_grantable AS "isGrantable"
FROM object_acls
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(object_acls.acl,
  pg_catalog.acldefault(CASE object_acls."objectKind"
    WHEN 'schema' THEN 'n'::pg_catalog."char" WHEN 'sequence' THEN 'S'::pg_catalog."char"
    WHEN 'function' THEN 'f'::pg_catalog."char" WHEN 'enum' THEN 'T'::pg_catalog."char"
    ELSE 'r'::pg_catalog."char" END, object_acls.owner_oid))) AS acl
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE acl.grantee <> object_acls.owner_oid
ORDER BY object_acls."objectKind", object_acls."objectName", "granteeName", "privilege"
LIMIT $22
),
"openpencil_default_privileges" AS (
SELECT
  owner.rolname::pg_catalog.text AS "ownerName",
  namespace.oid::pg_catalog.text AS "schemaOid",
  COALESCE(namespace.nspname, $23)::pg_catalog.text AS "schemaName",
  CASE defaults.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence'
    WHEN 'f' THEN 'function' WHEN 'T' THEN 'type' WHEN 'n' THEN 'schema' END::pg_catalog.text AS "objectKind",
  acl.grantor::pg_catalog.text AS "grantorOid",
  grantor.rolname::pg_catalog.text AS "grantorName",
  acl.grantee::pg_catalog.text AS "granteeOid",
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END::pg_catalog.text AS "granteeName",
  acl.privilege_type::pg_catalog.text AS "privilege",
  acl.is_grantable AS "isGrantable"
FROM pg_catalog.pg_default_acl AS defaults
JOIN pg_catalog.pg_roles AS owner ON owner.oid = defaults.defaclrole
LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE (defaults.defaclnamespace = 0 OR namespace.nspname = $23)
  AND owner.rolname = current_user
  AND acl.grantee <> defaults.defaclrole
ORDER BY "schemaName", "objectKind", "grantorName", "granteeName", "privilege"
LIMIT $24
)
SELECT
  pg_catalog.txid_current_snapshot()::pg_catalog.text AS "snapshotMarker",
  pg_catalog.to_char(pg_catalog.statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
  pg_catalog.jsonb_build_object(
    'provenance',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_provenance" AS row_data), '[]'::pg_catalog.jsonb),
    'objects',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_objects" AS row_data), '[]'::pg_catalog.jsonb),
    'columns',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_columns" AS row_data), '[]'::pg_catalog.jsonb),
    'constraints',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_constraints" AS row_data), '[]'::pg_catalog.jsonb),
    'indexes',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_indexes" AS row_data), '[]'::pg_catalog.jsonb),
    'policies',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_policies" AS row_data), '[]'::pg_catalog.jsonb),
    'storage-buckets',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_storage_buckets" AS row_data), '[]'::pg_catalog.jsonb),
    'storage-policies',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_storage_policies" AS row_data), '[]'::pg_catalog.jsonb),
    'roles',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_roles" AS row_data), '[]'::pg_catalog.jsonb),
    'role-memberships',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_role_memberships" AS row_data), '[]'::pg_catalog.jsonb),
    'privileges',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_privileges" AS row_data), '[]'::pg_catalog.jsonb),
    'default-privileges',
    COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_data)) FROM "openpencil_default_privileges" AS row_data), '[]'::pg_catalog.jsonb)
  ) AS "queryResults"
