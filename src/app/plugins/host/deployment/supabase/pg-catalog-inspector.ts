/* eslint-disable max-lines -- fixed catalog SQL and strict row decoders stay co-located */

import {
  createSupabaseInspectedMigrationSnapshot,
  deriveSupabaseManagedDataModel,
  parseSupabaseManagedMarker,
  type CreateSupabaseInspectedMigrationSnapshotInputV1,
  type SupabaseInspectedMigrationSnapshotV1,
  type SupabaseInspectionColumnDefaultV1,
  type SupabaseInspectionColumnV1,
  type SupabaseInspectionConstraintV1,
  type SupabaseInspectionDefaultPrivilegeV1,
  type SupabaseInspectionIndexV1,
  type SupabaseInspectionObjectV1,
  type SupabaseInspectionPolicyV1,
  type SupabaseInspectionPrivilegeV1,
  type SupabaseInspectionRoleMembershipV1,
  type SupabaseInspectionRoleV1,
  type SupabaseManagedMarkerKind,
  type SupabaseManagedMarkerV1
} from '@open-pencil/compiler/backend'
import { BACKEND_LIMITS } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest } from '@open-pencil/scene-graph'

export const SUPABASE_PG_CATALOG_QUERY_VERSION = 'openpencil-pg-catalog-v5' as const
export const SUPABASE_PG_CATALOG_QUERY_IDS = [
  'provenance',
  'objects',
  'columns',
  'constraints',
  'indexes',
  'policies',
  'roles',
  'role-memberships',
  'privileges',
  'default-privileges'
] as const

export type SupabasePgCatalogQueryId = (typeof SUPABASE_PG_CATALOG_QUERY_IDS)[number]

export interface SupabasePgCatalogFixedQueryDefinition {
  readonly queryId: SupabasePgCatalogQueryId
  readonly sql: string
  readonly parameterOrder: readonly ['schema', 'rowLimit']
  readonly maximumRows: number
}

const QUERY_LIMITS = Object.freeze({
  provenance: 1,
  objects: BACKEND_LIMITS.maxEntities * 4,
  columns: BACKEND_LIMITS.maxNodes,
  constraints: BACKEND_LIMITS.maxMigrationOperations,
  indexes: BACKEND_LIMITS.maxMigrationOperations,
  policies: BACKEND_LIMITS.maxPolicies,
  roles: BACKEND_LIMITS.maxMigrationOperations,
  'role-memberships': BACKEND_LIMITS.maxMigrationOperations,
  privileges: BACKEND_LIMITS.maxMigrationOperations,
  'default-privileges': BACKEND_LIMITS.maxMigrationOperations
}) satisfies Readonly<Record<SupabasePgCatalogQueryId, number>>

const PROVENANCE_SQL = `SELECT
  d.oid::text AS "databaseOid",
  current_database()::text AS "databaseName",
  n.oid::text AS "schemaOid",
  n.nspname::text AS "schemaName",
  r.oid::text AS "currentRoleOid",
  current_user::text AS "currentRoleName",
  current_setting('server_version_num')::text AS "serverVersionNum",
  txid_current_snapshot()::text AS "snapshotMarker",
  to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt",
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
WHERE d.datname = current_database()
ORDER BY d.oid
LIMIT $2`

const OBJECTS_SQL = `WITH catalog_objects AS (
  SELECT
    'pg_class'::regclass::oid::text AS "classOid",
    c.oid::text AS "objectOid",
    0::integer AS "subId",
    n.oid::text AS "schemaOid",
    n.nspname::text AS "schemaName",
    CASE c.relkind
      WHEN 'r' THEN 'table'
      WHEN 'p' THEN 'table'
      WHEN 'S' THEN 'sequence'
      ELSE 'view'
    END::text AS "kind",
    c.relname::text AS "objectName",
    CASE WHEN c.relkind IN ('r', 'p') THEN c.relrowsecurity ELSE NULL END AS "rlsEnabled",
    CASE WHEN c.relkind IN ('r', 'p') THEN c.relforcerowsecurity ELSE NULL END AS "rlsForced",
    CASE WHEN c.relkind IN ('v', 'm')
      THEN COALESCE((
        SELECT reloption.option_value::boolean
        FROM pg_catalog.pg_options_to_table(c.reloptions) AS reloption
        WHERE reloption.option_name = 'security_invoker'
      ), false)
      ELSE NULL END AS "securityInvoker",
    NULL::boolean AS "securityDefiner",
    NULL::jsonb AS "enumValues",
    CASE WHEN pg_catalog.obj_description(c.oid, 'pg_class') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(c.oid, 'pg_class') ELSE NULL END AS "marker"
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  UNION ALL
  SELECT
    'pg_proc'::regclass::oid::text,
    p.oid::text,
    0,
    n.oid::text,
    n.nspname::text,
    'function',
    p.proname::text,
    NULL,
    NULL,
    NULL,
    p.prosecdef,
    NULL::jsonb,
    CASE WHEN pg_catalog.obj_description(p.oid, 'pg_proc') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(p.oid, 'pg_proc') ELSE NULL END
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = $1
  UNION ALL
  SELECT
    'pg_type'::regclass::oid::text,
    t.oid::text,
    0,
    n.oid::text,
    n.nspname::text,
    'enum',
    t.typname::text,
    NULL,
    NULL,
    NULL,
    NULL,
    COALESCE((
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_catalog.pg_enum AS e WHERE e.enumtypid = t.oid
    ), '[]'::jsonb),
    CASE WHEN pg_catalog.obj_description(t.oid, 'pg_type') LIKE 'openpencil:%'
      THEN pg_catalog.obj_description(t.oid, 'pg_type') ELSE NULL END
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = $1 AND t.typtype = 'e'
)
SELECT * FROM catalog_objects
ORDER BY "kind", "schemaName", "objectName", "objectOid"
LIMIT $2`

const COLUMNS_SQL = `SELECT
  'pg_class'::regclass::oid::text AS "classOid",
  c.oid::text AS "objectOid",
  a.attnum::integer AS "subId",
  n.oid::text AS "schemaOid",
  n.nspname::text AS "schemaName",
  c.relname::text AS "tableName",
  a.attname::text AS "columnName",
  t.oid::text AS "typeOid",
  tn.nspname::text AS "typeSchema",
  t.typname::text AS "typeName",
  t.typtype::text AS "typeKind",
  NOT a.attnotnull AS "nullable",
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid)::text AS "defaultExpression",
  a.attidentity::text AS "identityKind",
  a.attgenerated::text AS "generatedKind",
  a.attacl IS NOT NULL AS "columnPrivilegesPresent",
  CASE WHEN pg_catalog.col_description(c.oid, a.attnum) LIKE 'openpencil:%'
    THEN pg_catalog.col_description(c.oid, a.attnum) ELSE NULL END AS "marker"
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_class AS c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.typnamespace
LEFT JOIN pg_catalog.pg_attrdef AS ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
WHERE n.nspname = $1
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, a.attnum
LIMIT $2`

const CONSTRAINTS_SQL = `SELECT
  'pg_constraint'::regclass::oid::text AS "classOid",
  con.oid::text AS "objectOid",
  0::integer AS "subId",
  n.oid::text AS "schemaOid",
  n.nspname::text AS "schemaName",
  rel.oid::text AS "tableOid",
  rel.relname::text AS "tableName",
  con.conname::text AS "constraintName",
  con.contype::text AS "constraintType",
  COALESCE((SELECT jsonb_agg(att.attname ORDER BY keys.ordinality)
    FROM unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = keys.attnum
  ), '[]'::jsonb) AS "fields",
  target.oid::text AS "targetTableOid",
  target.relname::text AS "targetTableName",
  COALESCE((SELECT jsonb_agg(att.attname ORDER BY keys.ordinality)
    FROM unnest(con.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.confrelid AND att.attnum = keys.attnum
  ), '[]'::jsonb) AS "targetFields",
  con.confdeltype::text AS "onDeleteCode",
  pg_catalog.pg_get_constraintdef(con.oid, true)::text AS "definition",
  CASE WHEN pg_catalog.obj_description(con.oid, 'pg_constraint') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(con.oid, 'pg_constraint') ELSE NULL END AS "marker"
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_class AS target ON target.oid = con.confrelid
WHERE n.nspname = $1 AND con.contype IN ('p', 'u', 'f', 'c')
ORDER BY n.nspname, rel.relname, con.conname, con.oid
LIMIT $2`

const INDEXES_SQL = `SELECT
  'pg_class'::regclass::oid::text AS "classOid",
  idx.oid::text AS "objectOid",
  0::integer AS "subId",
  n.oid::text AS "schemaOid",
  n.nspname::text AS "schemaName",
  rel.oid::text AS "tableOid",
  rel.relname::text AS "tableName",
  idx.relname::text AS "indexName",
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name', att.attname,
      'order', CASE WHEN (ind.indoption[keys.ordinality - 1] & 1) = 1 THEN 'desc' ELSE 'asc' END
    ) ORDER BY keys.ordinality)
    FROM unnest(ind.indkey) WITH ORDINALITY AS keys(attnum, ordinality)
    LEFT JOIN pg_catalog.pg_attribute AS att
      ON att.attrelid = ind.indrelid AND att.attnum = keys.attnum
  ), '[]'::jsonb) AS "fields",
  pg_catalog.pg_get_expr(ind.indpred, ind.indrelid)::text AS "predicate",
  pg_catalog.pg_get_expr(ind.indexprs, ind.indrelid)::text AS "expressions",
  CASE WHEN pg_catalog.obj_description(idx.oid, 'pg_class') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(idx.oid, 'pg_class') ELSE NULL END AS "marker"
FROM pg_catalog.pg_index AS ind
JOIN pg_catalog.pg_class AS idx ON idx.oid = ind.indexrelid
JOIN pg_catalog.pg_class AS rel ON rel.oid = ind.indrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
LEFT JOIN pg_catalog.pg_constraint AS backing_constraint ON backing_constraint.conindid = idx.oid
WHERE n.nspname = $1 AND backing_constraint.oid IS NULL
ORDER BY n.nspname, rel.relname, idx.relname, idx.oid
LIMIT $2`

const POLICIES_SQL = `SELECT
  'pg_policy'::regclass::oid::text AS "classOid",
  pol.oid::text AS "objectOid",
  0::integer AS "subId",
  n.oid::text AS "schemaOid",
  n.nspname::text AS "schemaName",
  rel.oid::text AS "tableOid",
  rel.relname::text AS "tableName",
  pol.polname::text AS "policyName",
  pol.polpermissive AS "permissive",
  CASE pol.polcmd WHEN '*' THEN 'all' WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert'
    WHEN 'w' THEN 'update' WHEN 'd' THEN 'delete' END::text AS "command",
  COALESCE((SELECT jsonb_agg(CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
      ELSE role.rolname END
    ORDER BY CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END)
    FROM unnest(pol.polroles) AS policy_role(role_oid)
    LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
  ), '[]'::jsonb) AS "roles",
  pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)::text AS "usingExpression",
  pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)::text AS "withCheckExpression",
  CASE WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
    THEN pg_catalog.obj_description(pol.oid, 'pg_policy') ELSE NULL END AS "marker"
FROM pg_catalog.pg_policy AS pol
JOIN pg_catalog.pg_class AS rel ON rel.oid = pol.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = rel.relnamespace
WHERE n.nspname = $1
ORDER BY n.nspname, rel.relname, pol.polname, pol.oid
LIMIT $2`

const ROLES_SQL = `SELECT
  role.oid::text AS "roleOid",
  role.rolname::text AS "roleName",
  role.rolsuper AS "superuser",
  role.rolbypassrls AS "bypassRls",
  role.rolinherit AS "inherit"
FROM pg_catalog.pg_roles AS role
WHERE $1 = 'public'
ORDER BY role.rolname, role.oid
LIMIT $2`

const ROLE_MEMBERSHIPS_SQL = `SELECT
  membership.roleid::text AS "roleOid",
  role.rolname::text AS "roleName",
  membership.member::text AS "memberOid",
  member.rolname::text AS "memberName",
  membership.grantor::text AS "grantorOid",
  grantor.rolname::text AS "grantorName",
  membership.admin_option AS "adminOption",
  membership.inherit_option AS "inheritOption",
  membership.set_option AS "setOption"
FROM pg_catalog.pg_auth_members AS membership
JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
WHERE $1 = 'public'
ORDER BY role.rolname, member.rolname, grantor.rolname
LIMIT $2`

const PRIVILEGES_SQL = `WITH object_acls AS (
  SELECT 'schema'::text AS "objectKind", n.oid AS object_oid, n.oid AS schema_oid,
    n.nspname::text AS "objectName", n.nspowner AS owner_oid, n.nspacl AS acl
  FROM pg_catalog.pg_namespace AS n WHERE n.nspname = $1
  UNION ALL
  SELECT CASE c.relkind WHEN 'S' THEN 'sequence' WHEN 'v' THEN 'view' WHEN 'm' THEN 'view'
      ELSE 'table' END,
    c.oid, n.oid, c.relname::text, c.relowner, c.relacl
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  UNION ALL
  SELECT 'function', p.oid, n.oid, p.proname::text, p.proowner, p.proacl
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace WHERE n.nspname = $1
  UNION ALL
  SELECT 'enum', t.oid, n.oid, t.typname::text, t.typowner, t.typacl
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  WHERE n.nspname = $1 AND t.typtype = 'e'
)
SELECT
  object_acls."objectKind",
  object_acls.object_oid::text AS "objectOid",
  object_acls.schema_oid::text AS "schemaOid",
  $1::text AS "schemaName",
  object_acls."objectName",
  acl.grantor::text AS "grantorOid",
  grantor.rolname::text AS "grantorName",
  acl.grantee::text AS "granteeOid",
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END::text AS "granteeName",
  acl.privilege_type::text AS "privilege",
  acl.is_grantable AS "isGrantable"
FROM object_acls
CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(object_acls.acl,
  pg_catalog.acldefault(CASE object_acls."objectKind"
    WHEN 'schema' THEN 'n'::"char" WHEN 'sequence' THEN 'S'::"char"
    WHEN 'function' THEN 'f'::"char" WHEN 'enum' THEN 'T'::"char"
    ELSE 'r'::"char" END, object_acls.owner_oid))) AS acl
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE acl.grantee <> object_acls.owner_oid
ORDER BY object_acls."objectKind", object_acls."objectName", "granteeName", "privilege"
LIMIT $2`

const DEFAULT_PRIVILEGES_SQL = `SELECT
  owner.rolname::text AS "ownerName",
  namespace.oid::text AS "schemaOid",
  COALESCE(namespace.nspname, $1)::text AS "schemaName",
  CASE defaults.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence'
    WHEN 'f' THEN 'function' WHEN 'T' THEN 'type' WHEN 'n' THEN 'schema' END::text AS "objectKind",
  acl.grantor::text AS "grantorOid",
  grantor.rolname::text AS "grantorName",
  acl.grantee::text AS "granteeOid",
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END::text AS "granteeName",
  acl.privilege_type::text AS "privilege",
  acl.is_grantable AS "isGrantable"
FROM pg_catalog.pg_default_acl AS defaults
JOIN pg_catalog.pg_roles AS owner ON owner.oid = defaults.defaclrole
LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
WHERE (defaults.defaclnamespace = 0 OR namespace.nspname = $1)
  AND owner.rolname = current_user
  AND acl.grantee <> defaults.defaclrole
ORDER BY "schemaName", "objectKind", "grantorName", "granteeName", "privilege"
LIMIT $2`

const QUERY_SQL = Object.freeze({
  provenance: PROVENANCE_SQL,
  objects: OBJECTS_SQL,
  columns: COLUMNS_SQL,
  constraints: CONSTRAINTS_SQL,
  indexes: INDEXES_SQL,
  policies: POLICIES_SQL,
  roles: ROLES_SQL,
  'role-memberships': ROLE_MEMBERSHIPS_SQL,
  privileges: PRIVILEGES_SQL,
  'default-privileges': DEFAULT_PRIVILEGES_SQL
}) satisfies Readonly<Record<SupabasePgCatalogQueryId, string>>

export const SUPABASE_PG_CATALOG_FIXED_QUERIES = Object.freeze(
  SUPABASE_PG_CATALOG_QUERY_IDS.map((queryId) =>
    Object.freeze({
      queryId,
      sql: QUERY_SQL[queryId],
      parameterOrder: Object.freeze(['schema', 'rowLimit'] as const),
      maximumRows: QUERY_LIMITS[queryId]
    })
  )
) satisfies readonly SupabasePgCatalogFixedQueryDefinition[]

export interface SupabasePgCatalogProjectAuthorityRequest {
  readonly projectRef: string
  readonly grantGeneration: string
}

export interface SupabasePgCatalogProjectAuthority {
  readonly projectRef: string
  readonly organizationId: string
  readonly grantGeneration: string
}

export interface SupabasePgCatalogQueryRequest {
  readonly queryId: SupabasePgCatalogQueryId
  readonly parameters: Readonly<{
    schema: 'public'
    /** One sentinel row above the accepted maximum proves bounded completeness. */
    rowLimit: number
  }>
}

export interface SupabasePgCatalogReadRequest {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly queryVersion: typeof SUPABASE_PG_CATALOG_QUERY_VERSION
  readonly schema: 'public'
  /** All catalog rows must come from one immutable aggregate SQL statement. */
  readonly snapshotScope: 'single-statement'
  readonly accessMode: 'read-only'
  readonly queries: readonly SupabasePgCatalogQueryRequest[]
}

export interface SupabasePgCatalogQueryResult {
  readonly queryId: SupabasePgCatalogQueryId
  readonly snapshotMarker: string
  readonly complete: true
  readonly truncated: false
  readonly rows: readonly unknown[]
}

export interface SupabasePgCatalogReadResult {
  readonly projectRef: string
  readonly accountId: string
  readonly grantGeneration: string
  readonly queryVersion: typeof SUPABASE_PG_CATALOG_QUERY_VERSION
  readonly schema: 'public'
  readonly snapshotScope: 'single-statement'
  readonly accessMode: 'read-only'
  readonly snapshotMarker: string
  readonly observedAt: string
  readonly results: readonly SupabasePgCatalogQueryResult[]
}

interface StrictSupabasePgCatalogReadEnvelope extends Omit<SupabasePgCatalogReadResult, 'results'> {
  readonly results: readonly unknown[]
}

/**
 * Host-owned transport bound to one PAT authority. A real implementation must
 * use Management GET /v1/projects/{ref} first, then only the database_read
 * /v1/projects/{ref}/database/query/read-only endpoint. It accepts query IDs
 * and typed parameters, never caller-provided SQL or credential values.
 */
export interface SupabasePgCatalogHostTransport {
  getProjectAuthority(
    request: SupabasePgCatalogProjectAuthorityRequest
  ): Promise<SupabasePgCatalogProjectAuthority>
  runReadOnlyCatalogQueries(
    request: SupabasePgCatalogReadRequest
  ): Promise<SupabasePgCatalogReadResult>
}

export type SupabasePgCatalogInspectionDiagnosticCode =
  | 'supabase-pg-catalog-transport-failed'
  | 'supabase-pg-catalog-project-authority-mismatch'
  | 'supabase-pg-catalog-query-envelope-invalid'
  | 'supabase-pg-catalog-query-set-invalid'
  | 'supabase-pg-catalog-query-incomplete'
  | 'supabase-pg-catalog-query-truncated'
  | 'supabase-pg-catalog-query-row-limit-exceeded'
  | 'supabase-pg-catalog-query-version-unsupported'
  | 'supabase-pg-catalog-row-invalid'
  | 'supabase-pg-catalog-address-mismatch'
  | 'supabase-pg-catalog-column-privileges-unsupported'
  | 'supabase-pg-catalog-managed-marker-invalid'
  | 'supabase-pg-catalog-snapshot-invalid'

export interface SupabasePgCatalogInspectionDiagnostic {
  readonly code: SupabasePgCatalogInspectionDiagnosticCode
  readonly queryId?: SupabasePgCatalogQueryId
  readonly message: string
}

export class SupabasePgCatalogInspectionError extends Error {
  readonly diagnostics: readonly SupabasePgCatalogInspectionDiagnostic[]

  constructor(diagnostic: SupabasePgCatalogInspectionDiagnostic) {
    super(diagnostic.message)
    this.name = 'SupabasePgCatalogInspectionError'
    this.diagnostics = Object.freeze([Object.freeze({ ...diagnostic })])
  }
}

export interface InspectSupabasePgCatalogOptions {
  readonly projectRef: string
  /** Exact Supabase organization_id returned under the same PAT authority. */
  readonly accountId: string
  readonly grantGeneration: string
  readonly transport: SupabasePgCatalogHostTransport
}

type UnknownRecord = Record<string, unknown>

function hasExactDataProperties(value: unknown, keys: readonly string[]): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    return false
  }
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value')
  })
}

function fail(
  code: SupabasePgCatalogInspectionDiagnosticCode,
  message: string,
  queryId?: SupabasePgCatalogQueryId
): never {
  throw new SupabasePgCatalogInspectionError({ code, message, ...(queryId ? { queryId } : {}) })
}

function record(value: unknown, queryId: SupabasePgCatalogQueryId): UnknownRecord {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase catalog row is not an object.',
      queryId
    )
  }
  return value as UnknownRecord
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  queryId: SupabasePgCatalogQueryId
): UnknownRecord {
  const source = record(value, queryId)
  if (!hasExactDataProperties(source, keys)) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase catalog row has an unexpected shape.',
      queryId
    )
  }
  return source
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u
const OID = /^(?:0|[1-9][0-9]{0,9})$/u
const SNAPSHOT_MARKER = /^[0-9:,]{1,512}$/u
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

function stableId(value: unknown, queryId: SupabasePgCatalogQueryId): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase authority identifier is invalid.',
      queryId
    )
  }
  return value
}

function identifier(value: unknown, queryId: SupabasePgCatalogQueryId): string {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase catalog contains an unsupported PostgreSQL identifier.',
      queryId
    )
  }
  return value
}

function oid(value: unknown, queryId: SupabasePgCatalogQueryId, allowZero = false): string {
  if (typeof value !== 'string' || !OID.test(value)) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog OID is invalid.', queryId)
  }
  const parsed = BigInt(value)
  if (parsed > 4_294_967_295n || (!allowZero && parsed === 0n)) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog OID is out of range.', queryId)
  }
  return value
}

function boolean(value: unknown, queryId: SupabasePgCatalogQueryId): boolean {
  if (typeof value !== 'boolean') {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog boolean is invalid.', queryId)
  }
  return value
}

function indexOrder(value: unknown, queryId: SupabasePgCatalogQueryId): 'asc' | 'desc' {
  if (value !== 'asc' && value !== 'desc') {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase index order is invalid.', queryId)
  }
  return value
}

function nullableString(value: unknown, queryId: SupabasePgCatalogQueryId): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > BACKEND_LIMITS.maxCanonicalBytes) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog text is invalid.', queryId)
  }
  return value
}

function marker(
  value: unknown,
  expectedKind: SupabaseManagedMarkerKind | null,
  queryId: SupabasePgCatalogQueryId
): SupabaseManagedMarkerV1 | null {
  const raw = nullableString(value, queryId)
  let parsed: SupabaseManagedMarkerV1 | null
  try {
    parsed = parseSupabaseManagedMarker(raw)
  } catch {
    return fail(
      'supabase-pg-catalog-managed-marker-invalid',
      'Supabase catalog contains an invalid or unsupported OpenPencil managed marker.',
      queryId
    )
  }
  if (parsed && parsed.kind !== expectedKind) {
    return fail(
      'supabase-pg-catalog-managed-marker-invalid',
      'Supabase managed marker kind does not match its catalog object address.',
      queryId
    )
  }
  return parsed
}

function stringArray(value: unknown, queryId: SupabasePgCatalogQueryId): readonly string[] {
  if (!Array.isArray(value) || value.length > BACKEND_LIMITS.maxNodes) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog array is invalid.', queryId)
  }
  return value.map((entry) => identifier(entry, queryId))
}

function addressKey(classOid: string, objectOid: string, subId: number): string {
  return `${classOid}:${objectOid}:${String(subId)}`
}

function subId(value: unknown, queryId: SupabasePgCatalogQueryId): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 32_767) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase catalog sub-object ID is invalid.',
      queryId
    )
  }
  return value as number
}

function validateSchema(
  schemaName: unknown,
  schemaOid: unknown,
  expectedSchemaOid: string,
  queryId: SupabasePgCatalogQueryId
): void {
  if (schemaName !== 'public' || oid(schemaOid, queryId) !== expectedSchemaOid) {
    fail(
      'supabase-pg-catalog-address-mismatch',
      'Supabase catalog row belongs to a different schema address.',
      queryId
    )
  }
}

function validateUniqueAddresses(
  addresses: readonly string[],
  queryId: SupabasePgCatalogQueryId
): void {
  if (new Set(addresses).size !== addresses.length) {
    fail(
      'supabase-pg-catalog-address-mismatch',
      'Supabase catalog returned duplicate object addresses.',
      queryId
    )
  }
}

function exactTimestamp(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !ISO_INSTANT.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    return fail(
      'supabase-pg-catalog-query-envelope-invalid',
      'Supabase catalog observation timestamp is invalid.'
    )
  }
  return value
}

function strictEnvelope(
  value: unknown,
  expected: Readonly<{ projectRef: string; accountId: string; grantGeneration: string }>
): StrictSupabasePgCatalogReadEnvelope {
  const envelopeKeys = [
    'projectRef',
    'accountId',
    'grantGeneration',
    'queryVersion',
    'schema',
    'snapshotScope',
    'accessMode',
    'snapshotMarker',
    'observedAt',
    'results'
  ]
  if (!hasExactDataProperties(value, envelopeKeys)) {
    return fail(
      'supabase-pg-catalog-query-envelope-invalid',
      'Supabase catalog read-only query envelope is invalid.'
    )
  }
  const source = value
  if (
    source.projectRef !== expected.projectRef ||
    source.accountId !== expected.accountId ||
    source.grantGeneration !== expected.grantGeneration ||
    source.queryVersion !== SUPABASE_PG_CATALOG_QUERY_VERSION ||
    source.schema !== 'public' ||
    source.snapshotScope !== 'single-statement' ||
    source.accessMode !== 'read-only' ||
    typeof source.snapshotMarker !== 'string' ||
    !SNAPSHOT_MARKER.test(source.snapshotMarker) ||
    !Array.isArray(source.results)
  ) {
    return fail(
      'supabase-pg-catalog-query-envelope-invalid',
      'Supabase catalog read-only query envelope is invalid.'
    )
  }
  return {
    projectRef: expected.projectRef,
    accountId: expected.accountId,
    grantGeneration: expected.grantGeneration,
    queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
    schema: 'public',
    snapshotScope: 'single-statement',
    accessMode: 'read-only',
    snapshotMarker: source.snapshotMarker,
    observedAt: exactTimestamp(source.observedAt),
    results: source.results
  }
}

function resultMap(
  result: StrictSupabasePgCatalogReadEnvelope
): ReadonlyMap<SupabasePgCatalogQueryId, readonly unknown[]> {
  if (result.results.length !== SUPABASE_PG_CATALOG_QUERY_IDS.length) {
    return fail(
      'supabase-pg-catalog-query-set-invalid',
      'Supabase catalog query result set is incomplete.'
    )
  }
  const rows = new Map<SupabasePgCatalogQueryId, readonly unknown[]>()
  for (const rawSection of result.results) {
    if (
      !hasExactDataProperties(rawSection, [
        'queryId',
        'snapshotMarker',
        'complete',
        'truncated',
        'rows'
      ])
    ) {
      fail(
        'supabase-pg-catalog-query-envelope-invalid',
        'Supabase catalog query result envelope is invalid.'
      )
    }
    const section = rawSection
    const queryId = SUPABASE_PG_CATALOG_QUERY_IDS.find((candidate) => candidate === section.queryId)
    if (queryId === undefined) {
      fail('supabase-pg-catalog-query-set-invalid', 'Supabase catalog query ID is not allowed.')
    }
    if (rows.has(queryId)) {
      fail(
        'supabase-pg-catalog-query-set-invalid',
        'Supabase catalog query result is duplicated.',
        queryId
      )
    }
    if (section.snapshotMarker !== result.snapshotMarker) {
      fail(
        'supabase-pg-catalog-query-envelope-invalid',
        'Supabase catalog queries do not share one statement snapshot.',
        queryId
      )
    }
    if (section.complete !== true) {
      fail(
        'supabase-pg-catalog-query-incomplete',
        'Supabase catalog query did not prove complete coverage.',
        queryId
      )
    }
    if (section.truncated !== false) {
      fail(
        'supabase-pg-catalog-query-truncated',
        'Supabase catalog query result was truncated.',
        queryId
      )
    }
    if (!Array.isArray(section.rows)) {
      fail(
        'supabase-pg-catalog-query-envelope-invalid',
        'Supabase catalog query rows are invalid.',
        queryId
      )
    }
    if (section.rows.length > QUERY_LIMITS[queryId]) {
      fail(
        'supabase-pg-catalog-query-row-limit-exceeded',
        'Supabase catalog query exceeded the strict row limit.',
        queryId
      )
    }
    rows.set(queryId, section.rows)
  }
  return rows
}

interface ParsedProvenance {
  readonly schemaOid: string
  readonly observedAt: string
  readonly serverVersionNum: number
  readonly currentRoleOid: string
  readonly currentRoleName: string
}

function parseProvenance(
  rows: readonly unknown[],
  envelope: Pick<SupabasePgCatalogReadResult, 'snapshotMarker' | 'observedAt'>
): ParsedProvenance {
  const queryId = 'provenance'
  if (rows.length !== 1) {
    return fail(
      'supabase-pg-catalog-query-incomplete',
      'Supabase catalog provenance must contain exactly one row.',
      queryId
    )
  }
  const source = exactRecord(
    rows[0],
    [
      'databaseOid',
      'databaseName',
      'schemaOid',
      'schemaName',
      'currentRoleOid',
      'currentRoleName',
      'serverVersionNum',
      'snapshotMarker',
      'observedAt',
      'columnPrivilegesPresent'
    ],
    queryId
  )
  oid(source.databaseOid, queryId)
  if (typeof source.databaseName !== 'string' || source.databaseName.length === 0) {
    fail('supabase-pg-catalog-row-invalid', 'Supabase database identity is invalid.', queryId)
  }
  const schemaOid = oid(source.schemaOid, queryId)
  if (source.schemaName !== 'public') {
    fail('supabase-pg-catalog-address-mismatch', 'Supabase public schema is unavailable.', queryId)
  }
  requireNoColumnPrivileges(source.columnPrivilegesPresent, queryId)
  const currentRoleOid = oid(source.currentRoleOid, queryId)
  const currentRoleName = identifier(source.currentRoleName, queryId)
  if (source.snapshotMarker !== envelope.snapshotMarker) {
    fail(
      'supabase-pg-catalog-query-envelope-invalid',
      'Supabase provenance is not bound to the statement snapshot.',
      queryId
    )
  }
  const observedAt = exactTimestamp(source.observedAt)
  if (observedAt !== envelope.observedAt) {
    fail(
      'supabase-pg-catalog-query-envelope-invalid',
      'Supabase provenance timestamp differs from the query envelope.',
      queryId
    )
  }
  if (
    typeof source.serverVersionNum !== 'string' ||
    !/^[0-9]{5,6}$/u.test(source.serverVersionNum)
  ) {
    fail('supabase-pg-catalog-row-invalid', 'Supabase server version is invalid.', queryId)
  }
  const serverVersionNum = Number(source.serverVersionNum)
  if (serverVersionNum < 160_000) {
    fail(
      'supabase-pg-catalog-query-version-unsupported',
      'Strict role-membership inspection requires PostgreSQL 16 or newer; membership options cannot be defaulted.',
      queryId
    )
  }
  return { schemaOid, observedAt, serverVersionNum, currentRoleOid, currentRoleName }
}

interface ParsedObjects {
  readonly values: readonly SupabaseInspectionObjectV1[]
  readonly byOid: ReadonlyMap<string, SupabaseInspectionObjectV1>
}

function parseObjects(rows: readonly unknown[], schemaOid: string): ParsedObjects {
  const queryId = 'objects'
  const values: SupabaseInspectionObjectV1[] = []
  const byOid = new Map<string, SupabaseInspectionObjectV1>()
  const addresses: string[] = []
  for (const row of rows) {
    const source = exactRecord(
      row,
      [
        'classOid',
        'objectOid',
        'subId',
        'schemaOid',
        'schemaName',
        'kind',
        'objectName',
        'rlsEnabled',
        'rlsForced',
        'securityInvoker',
        'securityDefiner',
        'enumValues',
        'marker'
      ],
      queryId
    )
    const classOid = oid(source.classOid, queryId)
    const objectOid = oid(source.objectOid, queryId)
    const parsedSubId = subId(source.subId, queryId)
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const name = identifier(source.objectName, queryId)
    let value: SupabaseInspectionObjectV1
    if (source.kind === 'table') {
      const managed = marker(source.marker, 'entity', queryId)
      value = {
        kind: 'table',
        schema: 'public',
        name,
        management: managed ? 'managed' : 'external',
        ...(managed ? { openPencilId: managed.id } : {}),
        rlsEnabled: boolean(source.rlsEnabled, queryId),
        rlsForced: boolean(source.rlsForced, queryId)
      }
    } else if (source.kind === 'enum') {
      const managed = marker(source.marker, 'enum', queryId)
      value = {
        kind: 'enum',
        schema: 'public',
        name,
        management: managed ? 'managed' : 'external',
        ...(managed ? { openPencilId: managed.id } : {}),
        values: stringArray(source.enumValues, queryId)
      }
    } else if (source.kind === 'sequence') {
      marker(source.marker, null, queryId)
      value = { kind: 'sequence', schema: 'public', name, management: 'external' }
    } else if (source.kind === 'view') {
      marker(source.marker, null, queryId)
      value = {
        kind: 'view',
        schema: 'public',
        name,
        management: 'external',
        securityInvoker: boolean(source.securityInvoker, queryId)
      }
    } else if (source.kind === 'function') {
      marker(source.marker, null, queryId)
      value = {
        kind: 'function',
        schema: 'public',
        name,
        management: 'external',
        securityDefiner: boolean(source.securityDefiner, queryId)
      }
    } else {
      fail('supabase-pg-catalog-row-invalid', 'Supabase object kind is unsupported.', queryId)
    }
    addresses.push(addressKey(classOid, objectOid, parsedSubId))
    if (byOid.has(objectOid)) {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase catalog object OID is duplicated.',
        queryId
      )
    }
    byOid.set(objectOid, value)
    values.push(value)
  }
  validateUniqueAddresses(addresses, queryId)
  return { values, byOid }
}

function scalarType(
  typeName: string,
  typeKind: string,
  queryId: SupabasePgCatalogQueryId
): SupabaseInspectionColumnV1['type'] {
  if (typeKind === 'e') return 'enum'
  if (['text', 'varchar', 'bpchar', 'name', 'citext'].includes(typeName)) return 'string'
  if (['int2', 'int4', 'int8', 'oid'].includes(typeName)) return 'integer'
  if (['numeric', 'float4', 'float8'].includes(typeName)) return 'number'
  if (typeName === 'bool') return 'boolean'
  if (typeName === 'date') return 'date'
  if (['timestamp', 'timestamptz'].includes(typeName)) return 'datetime'
  if (typeName === 'uuid') return 'uuid'
  if (['json', 'jsonb'].includes(typeName)) return 'json'
  if (typeName === 'bytea') return 'bytes'
  return fail(
    'supabase-pg-catalog-row-invalid',
    'Supabase column type cannot be represented by strict inspection v1.',
    queryId
  )
}

async function expressionDigest(kind: string, expression: string): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.supabase-pg-catalog-expression.v1',
    kind,
    expression
  })
}

function jsonScalarDefault(expression: string): SupabaseInspectionColumnDefaultV1 | undefined {
  try {
    const value: unknown = JSON.parse(expression)
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return { kind: 'literal', value }
    }
    return undefined
  } catch {
    return undefined
  }
}

function literalColumnDefault(
  expression: string,
  type: SupabaseInspectionColumnV1['type']
): SupabaseInspectionColumnDefaultV1 | undefined {
  const quoted = expression.match(/^'((?:[^']|'')*)'(?:::[A-Za-z0-9_. ]+)?$/u)
  if (quoted && ['string', 'date', 'datetime', 'uuid', 'enum'].includes(type)) {
    return { kind: 'literal', value: quoted[1].replaceAll("''", "'") }
  }
  if (quoted && type === 'json') {
    return jsonScalarDefault(quoted[1].replaceAll("''", "'"))
  }
  const numeric = expression.match(/^(-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?)(?:::[A-Za-z0-9_. ]+)?$/u)
  if (numeric && (type === 'integer' || type === 'number')) {
    const value = Number(numeric[1])
    if (Number.isFinite(value) && (type !== 'integer' || Number.isSafeInteger(value))) {
      return { kind: 'literal', value }
    }
  }
  if (/^(?:true|false)(?:::[A-Za-z0-9_. ]+)?$/iu.test(expression) && type === 'boolean') {
    return { kind: 'literal', value: expression.toLowerCase().startsWith('true') }
  }
  return undefined
}

async function columnDefault(
  source: UnknownRecord,
  type: SupabaseInspectionColumnV1['type'],
  queryId: SupabasePgCatalogQueryId
): Promise<SupabaseInspectionColumnDefaultV1> {
  const expression = nullableString(source.defaultExpression, queryId)
  const identityKind = nullableString(source.identityKind, queryId)
  const generatedKind = nullableString(source.generatedKind, queryId)
  if (identityKind && identityKind !== 'a' && identityKind !== 'd') {
    fail('supabase-pg-catalog-row-invalid', 'Supabase identity metadata is invalid.', queryId)
  }
  if (generatedKind && generatedKind !== 's') {
    fail('supabase-pg-catalog-row-invalid', 'Supabase generated metadata is invalid.', queryId)
  }
  if (identityKind) return { kind: 'generated', generator: 'identity' }
  if (expression === null) return null
  if (expression === 'CURRENT_TIMESTAMP' && (type === 'date' || type === 'datetime')) {
    return { kind: 'generated', generator: 'created-at' }
  }
  const literal = literalColumnDefault(expression, type)
  if (literal !== undefined) return literal
  return {
    kind: 'unbound',
    expressionDigest: await expressionDigest('column-default', expression)
  }
}

function validateEnumColumnTypeBinding(
  type: SupabaseInspectionColumnV1['type'],
  typeOid: string,
  typeSchema: string,
  typeName: string,
  managed: SupabaseManagedMarkerV1 | null,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>,
  queryId: SupabasePgCatalogQueryId
): void {
  if (type !== 'enum') return
  const enumObject = objectsByOid.get(typeOid)
  if (typeSchema !== 'public' || enumObject?.kind !== 'enum' || enumObject.name !== typeName) {
    fail(
      'supabase-pg-catalog-address-mismatch',
      'Supabase enum column type does not match the inspected public enum OID.',
      queryId
    )
  }
  if (managed && enumObject.management !== 'managed') {
    fail(
      'supabase-pg-catalog-managed-marker-invalid',
      'A managed enum column must bind an address-validated managed enum marker.',
      queryId
    )
  }
}

function requireNoColumnPrivileges(value: unknown, queryId: SupabasePgCatalogQueryId): false {
  if (boolean(value, queryId)) {
    fail(
      'supabase-pg-catalog-column-privileges-unsupported',
      'Column-level PostgreSQL privileges are outside the exact review contract.',
      queryId
    )
  }
  return false
}

async function parseColumns(
  rows: readonly unknown[],
  schemaOid: string,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>
): Promise<readonly SupabaseInspectionColumnV1[]> {
  const queryId = 'columns'
  const values: SupabaseInspectionColumnV1[] = []
  const addresses: string[] = []
  for (const row of rows) {
    const source = exactRecord(
      row,
      [
        'classOid',
        'objectOid',
        'subId',
        'schemaOid',
        'schemaName',
        'tableName',
        'columnName',
        'typeOid',
        'typeSchema',
        'typeName',
        'typeKind',
        'nullable',
        'defaultExpression',
        'identityKind',
        'generatedKind',
        'columnPrivilegesPresent',
        'marker'
      ],
      queryId
    )
    const classOid = oid(source.classOid, queryId)
    const tableOid = oid(source.objectOid, queryId)
    const parsedSubId = subId(source.subId, queryId)
    if (parsedSubId === 0) {
      fail('supabase-pg-catalog-address-mismatch', 'Supabase column address is invalid.', queryId)
    }
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const tableName = identifier(source.tableName, queryId)
    const table = objectsByOid.get(tableOid)
    if (table?.kind !== 'table' || table.name !== tableName) {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase column does not match its table OID.',
        queryId
      )
    }
    const managed = marker(source.marker, 'field', queryId)
    if ((table.management === 'managed') !== Boolean(managed)) {
      fail(
        'supabase-pg-catalog-managed-marker-invalid',
        'Every column of a managed table must carry a field marker, and external tables cannot claim one.',
        queryId
      )
    }
    const typeOid = oid(source.typeOid, queryId)
    const typeSchema = identifier(source.typeSchema, queryId)
    const typeName = identifier(source.typeName, queryId)
    if (typeof source.typeKind !== 'string' || source.typeKind.length !== 1) {
      fail('supabase-pg-catalog-row-invalid', 'Supabase type kind is invalid.', queryId)
    }
    const type = scalarType(typeName, source.typeKind, queryId)
    validateEnumColumnTypeBinding(
      type,
      typeOid,
      typeSchema,
      typeName,
      managed,
      objectsByOid,
      queryId
    )
    const columnPrivilegesPresent = requireNoColumnPrivileges(
      source.columnPrivilegesPresent,
      queryId
    )
    const parsedDefault = await columnDefault(source, type, queryId)
    if (managed && parsedDefault?.kind === 'unbound') {
      fail(
        'supabase-pg-catalog-row-invalid',
        'A managed column default is outside the exact generated SQL subset.',
        queryId
      )
    }
    values.push({
      schema: 'public',
      tableName,
      name: identifier(source.columnName, queryId),
      columnPrivilegesPresent,
      management: managed ? 'managed' : 'external',
      ...(managed ? { openPencilFieldId: managed.id } : {}),
      type,
      ...(type === 'enum' ? { enumName: typeName } : {}),
      nullable: boolean(source.nullable, queryId),
      default: parsedDefault
    })
    addresses.push(addressKey(classOid, tableOid, parsedSubId))
  }
  validateUniqueAddresses(addresses, queryId)
  return values
}

function requiredStringArray(value: unknown, queryId: SupabasePgCatalogQueryId): readonly string[] {
  const values = stringArray(value, queryId)
  if (values.length === 0) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase catalog field list is empty.', queryId)
  }
  return values
}

function foreignKeyDeleteAction(
  value: unknown,
  queryId: SupabasePgCatalogQueryId
): 'restrict' | 'cascade' | 'set-null' | 'no-action' {
  if (value === 'r') return 'restrict'
  if (value === 'c') return 'cascade'
  if (value === 'n') return 'set-null'
  if (value === 'a') return 'no-action'
  return fail(
    'supabase-pg-catalog-row-invalid',
    'Supabase foreign-key delete action is unsupported.',
    queryId
  )
}

function constraintMarkerKind(value: unknown): SupabaseManagedMarkerKind | null {
  if (value === 'p') return 'primary-key'
  if (value === 'u') return 'unique'
  if (value === 'f') return 'foreign-key'
  return null
}

interface ParsedConstraintBase {
  readonly schema: 'public'
  readonly tableName: string
  readonly name: string
  readonly management: 'managed' | 'external'
  readonly openPencilId?: string
}

async function constraintValue(
  source: UnknownRecord,
  base: ParsedConstraintBase,
  fields: readonly string[],
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>,
  queryId: SupabasePgCatalogQueryId
): Promise<SupabaseInspectionConstraintV1> {
  if (source.constraintType === 'p') return { ...base, kind: 'primary-key', fields }
  if (source.constraintType === 'u') return { ...base, kind: 'unique', fields }
  if (source.constraintType === 'f') {
    const targetTableOid = oid(source.targetTableOid, queryId)
    const targetTableName = identifier(source.targetTableName, queryId)
    const target = objectsByOid.get(targetTableOid)
    if (target?.kind !== 'table' || target.name !== targetTableName) {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase foreign key target does not match its table OID.',
        queryId
      )
    }
    return {
      ...base,
      kind: 'foreign-key',
      fields,
      targetTableName,
      targetFields: requiredStringArray(source.targetFields, queryId),
      onDelete: foreignKeyDeleteAction(source.onDeleteCode, queryId)
    }
  }
  if (source.constraintType === 'c') {
    const definition = nullableString(source.definition, queryId)
    if (!definition) {
      fail('supabase-pg-catalog-row-invalid', 'Supabase check definition is absent.', queryId)
    }
    return {
      ...base,
      kind: 'check',
      management: 'external',
      expressionDigest: await expressionDigest('check-constraint', definition)
    }
  }
  return fail(
    'supabase-pg-catalog-row-invalid',
    'Supabase constraint kind is unsupported.',
    queryId
  )
}

async function parseConstraints(
  rows: readonly unknown[],
  schemaOid: string,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>
): Promise<readonly SupabaseInspectionConstraintV1[]> {
  const queryId = 'constraints'
  const values: SupabaseInspectionConstraintV1[] = []
  const addresses: string[] = []
  for (const row of rows) {
    const source = exactRecord(
      row,
      [
        'classOid',
        'objectOid',
        'subId',
        'schemaOid',
        'schemaName',
        'tableOid',
        'tableName',
        'constraintName',
        'constraintType',
        'fields',
        'targetTableOid',
        'targetTableName',
        'targetFields',
        'onDeleteCode',
        'definition',
        'marker'
      ],
      queryId
    )
    const classOid = oid(source.classOid, queryId)
    const objectOid = oid(source.objectOid, queryId)
    const parsedSubId = subId(source.subId, queryId)
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const tableOid = oid(source.tableOid, queryId)
    const tableName = identifier(source.tableName, queryId)
    const table = objectsByOid.get(tableOid)
    if (table?.kind !== 'table' || table.name !== tableName) {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase constraint does not match its table OID.',
        queryId
      )
    }
    const managed = marker(source.marker, constraintMarkerKind(source.constraintType), queryId)
    if (table.management === 'managed' && source.constraintType === 'c') {
      fail(
        'supabase-pg-catalog-row-invalid',
        'Managed check constraints are outside the exact generated DataModelIR subset.',
        queryId
      )
    }
    if ((table.management === 'managed') !== Boolean(managed)) {
      fail(
        'supabase-pg-catalog-managed-marker-invalid',
        'Every structural constraint of a managed table must carry the matching marker.',
        queryId
      )
    }
    if (source.constraintType === 'p' && managed?.id !== table.openPencilId) {
      fail(
        'supabase-pg-catalog-managed-marker-invalid',
        'Managed primary-key marker is not bound to its table identity.',
        queryId
      )
    }
    const base = {
      schema: 'public' as const,
      tableName,
      name: identifier(source.constraintName, queryId),
      management: managed ? ('managed' as const) : ('external' as const),
      ...(managed ? { openPencilId: managed.id } : {})
    }
    const fields = requiredStringArray(source.fields, queryId)
    values.push(await constraintValue(source, base, fields, objectsByOid, queryId))
    addresses.push(addressKey(classOid, objectOid, parsedSubId))
  }
  validateUniqueAddresses(addresses, queryId)
  return values
}

function parseIndexes(
  rows: readonly unknown[],
  schemaOid: string,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>
): readonly SupabaseInspectionIndexV1[] {
  const queryId = 'indexes'
  const values: SupabaseInspectionIndexV1[] = []
  const addresses: string[] = []
  for (const row of rows) {
    const source = exactRecord(
      row,
      [
        'classOid',
        'objectOid',
        'subId',
        'schemaOid',
        'schemaName',
        'tableOid',
        'tableName',
        'indexName',
        'fields',
        'predicate',
        'expressions',
        'marker'
      ],
      queryId
    )
    const classOid = oid(source.classOid, queryId)
    const objectOid = oid(source.objectOid, queryId)
    const parsedSubId = subId(source.subId, queryId)
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const tableOid = oid(source.tableOid, queryId)
    const tableName = identifier(source.tableName, queryId)
    const table = objectsByOid.get(tableOid)
    if (table?.kind !== 'table' || table.name !== tableName) {
      fail('supabase-pg-catalog-address-mismatch', 'Supabase index table OID is invalid.', queryId)
    }
    const managed = marker(source.marker, 'index', queryId)
    if ((table.management === 'managed') !== Boolean(managed)) {
      fail(
        'supabase-pg-catalog-managed-marker-invalid',
        'Every explicit index of a managed table must carry an index marker.',
        queryId
      )
    }
    if (source.predicate !== null || source.expressions !== null) {
      fail(
        'supabase-pg-catalog-row-invalid',
        'Expression and partial indexes cannot be represented by strict inspection v1.',
        queryId
      )
    }
    if (!Array.isArray(source.fields) || source.fields.length === 0) {
      fail('supabase-pg-catalog-row-invalid', 'Supabase index fields are invalid.', queryId)
    }
    const fields = source.fields.map((field) => {
      const parsed = exactRecord(field, ['name', 'order'], queryId)
      return {
        name: identifier(parsed.name, queryId),
        order: indexOrder(parsed.order, queryId)
      }
    })
    values.push({
      schema: 'public',
      tableName,
      name: identifier(source.indexName, queryId),
      management: managed ? 'managed' : 'external',
      ...(managed ? { openPencilId: managed.id } : {}),
      fields
    })
    addresses.push(addressKey(classOid, objectOid, parsedSubId))
  }
  validateUniqueAddresses(addresses, queryId)
  return values
}

async function parsePolicies(
  rows: readonly unknown[],
  schemaOid: string,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>
): Promise<readonly SupabaseInspectionPolicyV1[]> {
  const queryId = 'policies'
  const values: SupabaseInspectionPolicyV1[] = []
  const addresses: string[] = []
  for (const row of rows) {
    const source = exactRecord(
      row,
      [
        'classOid',
        'objectOid',
        'subId',
        'schemaOid',
        'schemaName',
        'tableOid',
        'tableName',
        'policyName',
        'permissive',
        'command',
        'roles',
        'usingExpression',
        'withCheckExpression',
        'marker'
      ],
      queryId
    )
    const classOid = oid(source.classOid, queryId)
    const objectOid = oid(source.objectOid, queryId)
    const parsedSubId = subId(source.subId, queryId)
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const tableOid = oid(source.tableOid, queryId)
    const tableName = identifier(source.tableName, queryId)
    const table = objectsByOid.get(tableOid)
    if (table?.kind !== 'table' || table.name !== tableName) {
      fail('supabase-pg-catalog-address-mismatch', 'Supabase policy table OID is invalid.', queryId)
    }
    const policyName = identifier(source.policyName, queryId)
    const managed = marker(source.marker, 'policy', queryId)
    if (managed && (table.management !== 'managed' || managed.id !== policyName)) {
      fail(
        'supabase-pg-catalog-managed-marker-invalid',
        'Managed policy marker must equal the addressed policy name on a managed table.',
        queryId
      )
    }
    if (!['all', 'select', 'insert', 'update', 'delete'].includes(String(source.command))) {
      fail('supabase-pg-catalog-row-invalid', 'Supabase policy command is invalid.', queryId)
    }
    if (!Array.isArray(source.roles) || source.roles.length > 64) {
      fail('supabase-pg-catalog-row-invalid', 'Supabase policy roles are invalid.', queryId)
    }
    const roles = source.roles.map((role) =>
      role === 'PUBLIC' ? 'PUBLIC' : identifier(role, queryId)
    )
    const usingExpression = nullableString(source.usingExpression, queryId)
    const withCheckExpression = nullableString(source.withCheckExpression, queryId)
    values.push({
      schema: 'public',
      tableName,
      name: policyName,
      command: source.command as SupabaseInspectionPolicyV1['command'],
      mode: boolean(source.permissive, queryId) ? 'permissive' : 'restrictive',
      roles,
      source: managed ? 'openpencil' : 'unknown',
      usingExpressionDigest: usingExpression
        ? await expressionDigest('policy-using', usingExpression)
        : null,
      withCheckExpressionDigest: withCheckExpression
        ? await expressionDigest('policy-check', withCheckExpression)
        : null
    })
    addresses.push(addressKey(classOid, objectOid, parsedSubId))
  }
  validateUniqueAddresses(addresses, queryId)
  return values
}

interface ParsedRoles {
  readonly values: readonly SupabaseInspectionRoleV1[]
  readonly namesByOid: ReadonlyMap<string, string>
}

function parseRoles(rows: readonly unknown[]): ParsedRoles {
  const queryId = 'roles'
  const values: SupabaseInspectionRoleV1[] = []
  const namesByOid = new Map<string, string>()
  for (const row of rows) {
    const source = exactRecord(
      row,
      ['roleOid', 'roleName', 'superuser', 'bypassRls', 'inherit'],
      queryId
    )
    const roleOid = oid(source.roleOid, queryId)
    const roleName = identifier(source.roleName, queryId)
    if (namesByOid.has(roleOid) || [...namesByOid.values()].includes(roleName)) {
      fail('supabase-pg-catalog-address-mismatch', 'Supabase role identity is duplicated.', queryId)
    }
    namesByOid.set(roleOid, roleName)
    values.push({
      roleName,
      superuser: boolean(source.superuser, queryId),
      bypassRls: boolean(source.bypassRls, queryId),
      inherit: boolean(source.inherit, queryId)
    })
  }
  return { values, namesByOid }
}

function boundRole(
  roleOid: unknown,
  roleName: unknown,
  namesByOid: ReadonlyMap<string, string>,
  queryId: SupabasePgCatalogQueryId,
  allowPublic = false
): string {
  const parsedOid = oid(roleOid, queryId, allowPublic)
  if (allowPublic && parsedOid === '0' && roleName === 'PUBLIC') return 'PUBLIC'
  const parsedName = identifier(roleName, queryId)
  if (namesByOid.get(parsedOid) !== parsedName) {
    return fail(
      'supabase-pg-catalog-address-mismatch',
      'Supabase role name does not match its OID.',
      queryId
    )
  }
  return parsedName
}

function parseRoleMemberships(
  rows: readonly unknown[],
  namesByOid: ReadonlyMap<string, string>
): readonly SupabaseInspectionRoleMembershipV1[] {
  const queryId = 'role-memberships'
  return rows.map((row) => {
    const source = exactRecord(
      row,
      [
        'roleOid',
        'roleName',
        'memberOid',
        'memberName',
        'grantorOid',
        'grantorName',
        'adminOption',
        'inheritOption',
        'setOption'
      ],
      queryId
    )
    return {
      roleName: boundRole(source.roleOid, source.roleName, namesByOid, queryId),
      memberName: boundRole(source.memberOid, source.memberName, namesByOid, queryId),
      grantorName: boundRole(source.grantorOid, source.grantorName, namesByOid, queryId),
      adminOption: boolean(source.adminOption, queryId),
      inheritOption: boolean(source.inheritOption, queryId),
      setOption: boolean(source.setOption, queryId)
    }
  })
}

function privilegeKind(value: unknown, queryId: SupabasePgCatalogQueryId) {
  if (!['schema', 'table', 'enum', 'sequence', 'view', 'function'].includes(String(value))) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase privilege object is invalid.', queryId)
  }
  return value as SupabaseInspectionPrivilegeV1['objectKind']
}

function privilegeName(value: unknown, queryId: SupabasePgCatalogQueryId) {
  const allowed = [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
    'USAGE',
    'EXECUTE',
    'CREATE',
    'CONNECT',
    'TEMPORARY'
  ]
  if (!allowed.includes(String(value))) {
    return fail('supabase-pg-catalog-row-invalid', 'Supabase privilege is invalid.', queryId)
  }
  return value as SupabaseInspectionPrivilegeV1['privilege']
}

function parsePrivileges(
  rows: readonly unknown[],
  schemaOid: string,
  objectsByOid: ReadonlyMap<string, SupabaseInspectionObjectV1>,
  namesByOid: ReadonlyMap<string, string>
): readonly SupabaseInspectionPrivilegeV1[] {
  const queryId = 'privileges'
  return rows.map((row) => {
    const source = exactRecord(
      row,
      [
        'objectKind',
        'objectOid',
        'schemaOid',
        'schemaName',
        'objectName',
        'grantorOid',
        'grantorName',
        'granteeOid',
        'granteeName',
        'privilege',
        'isGrantable'
      ],
      queryId
    )
    validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    const objectKind = privilegeKind(source.objectKind, queryId)
    const objectOid = oid(source.objectOid, queryId)
    const objectName = identifier(source.objectName, queryId)
    if (objectKind === 'schema') {
      if (objectOid !== schemaOid || objectName !== 'public') {
        fail('supabase-pg-catalog-address-mismatch', 'Supabase schema ACL is invalid.', queryId)
      }
    } else {
      const object = objectsByOid.get(objectOid)
      if (!object || object.kind !== objectKind || object.name !== objectName) {
        fail('supabase-pg-catalog-address-mismatch', 'Supabase ACL object OID is invalid.', queryId)
      }
    }
    return {
      objectKind,
      schema: 'public',
      objectName: objectKind === 'schema' ? 'public' : objectName,
      grantor: boundRole(source.grantorOid, source.grantorName, namesByOid, queryId),
      grantee: boundRole(source.granteeOid, source.granteeName, namesByOid, queryId, true),
      privilege: privilegeName(source.privilege, queryId),
      isGrantable: boolean(source.isGrantable, queryId),
      source: 'unknown'
    } as SupabaseInspectionPrivilegeV1
  })
}

function defaultPrivilegeKind(value: unknown, queryId: SupabasePgCatalogQueryId) {
  if (!['table', 'sequence', 'function', 'type', 'schema'].includes(String(value))) {
    return fail(
      'supabase-pg-catalog-row-invalid',
      'Supabase default privilege object is invalid.',
      queryId
    )
  }
  return value as SupabaseInspectionDefaultPrivilegeV1['objectKind']
}

function parseDefaultPrivileges(
  rows: readonly unknown[],
  schemaOid: string,
  namesByOid: ReadonlyMap<string, string>
): readonly SupabaseInspectionDefaultPrivilegeV1[] {
  const queryId = 'default-privileges'
  return rows.map((row) => {
    const source = exactRecord(
      row,
      [
        'ownerName',
        'schemaOid',
        'schemaName',
        'objectKind',
        'grantorOid',
        'grantorName',
        'granteeOid',
        'granteeName',
        'privilege',
        'isGrantable'
      ],
      queryId
    )
    const ownerName = identifier(source.ownerName, queryId)
    if (![...namesByOid.values()].includes(ownerName)) {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase default ACL owner lacks complete role evidence.',
        queryId
      )
    }
    if (source.schemaOid !== null) {
      validateSchema(source.schemaName, source.schemaOid, schemaOid, queryId)
    } else if (source.schemaName !== 'public') {
      fail(
        'supabase-pg-catalog-address-mismatch',
        'Supabase global default ACL schema binding is invalid.',
        queryId
      )
    }
    return {
      schema: 'public',
      objectKind: defaultPrivilegeKind(source.objectKind, queryId),
      grantor: boundRole(source.grantorOid, source.grantorName, namesByOid, queryId),
      grantee: boundRole(source.granteeOid, source.granteeName, namesByOid, queryId, true),
      privilege: privilegeName(source.privilege, queryId),
      isGrantable: boolean(source.isGrantable, queryId),
      source: 'unknown'
    }
  })
}

function readRows(
  results: ReadonlyMap<SupabasePgCatalogQueryId, readonly unknown[]>,
  queryId: SupabasePgCatalogQueryId
): readonly unknown[] {
  const rows = results.get(queryId)
  if (!rows) {
    return fail(
      'supabase-pg-catalog-query-set-invalid',
      'Supabase catalog query result is missing.',
      queryId
    )
  }
  return rows
}

function inspectionRequest(
  projectRef: string,
  accountId: string,
  grantGeneration: string
): SupabasePgCatalogReadRequest {
  return Object.freeze({
    projectRef,
    accountId,
    grantGeneration,
    queryVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
    schema: 'public',
    snapshotScope: 'single-statement',
    accessMode: 'read-only',
    queries: Object.freeze(
      SUPABASE_PG_CATALOG_QUERY_IDS.map((queryId) =>
        Object.freeze({
          queryId,
          parameters: Object.freeze({
            schema: 'public' as const,
            rowLimit: QUERY_LIMITS[queryId] + 1
          })
        })
      )
    )
  })
}

function authority(
  value: unknown,
  expected: Readonly<{ projectRef: string; accountId: string; grantGeneration: string }>
): SupabasePgCatalogProjectAuthority {
  if (!hasExactDataProperties(value, ['projectRef', 'organizationId', 'grantGeneration'])) {
    return fail(
      'supabase-pg-catalog-project-authority-mismatch',
      'Supabase project does not belong to the expected organization authority.'
    )
  }
  const source = value
  if (
    source.projectRef !== expected.projectRef ||
    source.organizationId !== expected.accountId ||
    source.grantGeneration !== expected.grantGeneration
  ) {
    return fail(
      'supabase-pg-catalog-project-authority-mismatch',
      'Supabase project does not belong to the expected organization authority.'
    )
  }
  return {
    projectRef: expected.projectRef,
    organizationId: expected.accountId,
    grantGeneration: expected.grantGeneration
  }
}

/**
 * Assemble a strict, digest-bound snapshot from a fixed read-only pg_catalog
 * query set. Credential resolution and network transport remain Host-owned;
 * this function never receives a credential value or arbitrary SQL.
 */
export async function inspectSupabasePgCatalog(
  options: InspectSupabasePgCatalogOptions
): Promise<SupabaseInspectedMigrationSnapshotV1> {
  const projectRef = stableId(options.projectRef, 'provenance')
  const accountId = stableId(options.accountId, 'provenance')
  const grantGeneration = stableId(options.grantGeneration, 'provenance')
  const getProjectAuthority = options.transport.getProjectAuthority.bind(options.transport)
  const runReadOnlyCatalogQueries = options.transport.runReadOnlyCatalogQueries.bind(
    options.transport
  )

  let projectAuthority: unknown
  try {
    projectAuthority = await getProjectAuthority(Object.freeze({ projectRef, grantGeneration }))
  } catch {
    return fail(
      'supabase-pg-catalog-transport-failed',
      'Supabase project authority inspection failed.'
    )
  }
  authority(projectAuthority, { projectRef, accountId, grantGeneration })

  let rawResult: unknown
  try {
    rawResult = await runReadOnlyCatalogQueries(
      inspectionRequest(projectRef, accountId, grantGeneration)
    )
  } catch {
    return fail(
      'supabase-pg-catalog-transport-failed',
      'Supabase read-only catalog inspection failed.'
    )
  }
  const envelope = strictEnvelope(rawResult, { projectRef, accountId, grantGeneration })
  const results = resultMap(envelope)
  const provenance = parseProvenance(readRows(results, 'provenance'), envelope)
  const objects = parseObjects(readRows(results, 'objects'), provenance.schemaOid)
  const roles = parseRoles(readRows(results, 'roles'))
  if (roles.namesByOid.get(provenance.currentRoleOid) !== provenance.currentRoleName) {
    fail(
      'supabase-pg-catalog-address-mismatch',
      'Supabase query role does not match complete role evidence.',
      'roles'
    )
  }
  const columns = await parseColumns(
    readRows(results, 'columns'),
    provenance.schemaOid,
    objects.byOid
  )
  const constraints = await parseConstraints(
    readRows(results, 'constraints'),
    provenance.schemaOid,
    objects.byOid
  )
  const indexes = parseIndexes(readRows(results, 'indexes'), provenance.schemaOid, objects.byOid)
  let currentModel: CreateSupabaseInspectedMigrationSnapshotInputV1['currentModel']
  try {
    currentModel = deriveSupabaseManagedDataModel({
      objects: objects.values,
      columns,
      constraints,
      indexes
    })
  } catch {
    return fail(
      'supabase-pg-catalog-snapshot-invalid',
      'Supabase managed catalog evidence could not form an exact data model.'
    )
  }
  const input: CreateSupabaseInspectedMigrationSnapshotInputV1 = {
    provenance: {
      projectRef,
      accountId,
      querySchemaVersion: SUPABASE_PG_CATALOG_QUERY_VERSION,
      databaseRole: provenance.currentRoleName,
      observedAt: provenance.observedAt,
      completeness: 'complete',
      truncated: false
    },
    currentModel,
    coverage: {
      schemas: 'complete',
      tables: 'complete',
      columns: 'complete',
      enums: 'complete',
      constraints: 'complete',
      indexes: 'complete',
      sequences: 'complete',
      views: 'complete',
      functions: 'complete',
      rls: 'complete',
      policies: 'complete',
      roles: 'complete',
      roleMemberships: 'complete',
      privileges: 'complete'
    },
    objects: objects.values,
    columns,
    constraints,
    indexes,
    policies: await parsePolicies(
      readRows(results, 'policies'),
      provenance.schemaOid,
      objects.byOid
    ),
    roles: roles.values,
    roleMemberships: parseRoleMemberships(readRows(results, 'role-memberships'), roles.namesByOid),
    privileges: parsePrivileges(
      readRows(results, 'privileges'),
      provenance.schemaOid,
      objects.byOid,
      roles.namesByOid
    ),
    defaultPrivileges: parseDefaultPrivileges(
      readRows(results, 'default-privileges'),
      provenance.schemaOid,
      roles.namesByOid
    )
  }
  try {
    return await createSupabaseInspectedMigrationSnapshot(input)
  } catch {
    return fail(
      'supabase-pg-catalog-snapshot-invalid',
      'Supabase catalog inspection could not satisfy the strict snapshot contract.'
    )
  }
}
