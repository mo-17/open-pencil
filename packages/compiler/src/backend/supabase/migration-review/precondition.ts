/* eslint-disable max-lines -- Exact catalog, ACL, RLS, policy, and pre-grant freshness checks stay in one auditable SQL boundary. */
import type { SupabaseInspectedMigrationSnapshotV1 } from '../inspection'
import { formatSupabaseManagedMarker } from '../inspection'
import { qualified, quoteIdentifier, quoteLiteral, stableSQLName } from './common'

export interface SupabasePlannedPolicyPreconditionV1 {
  readonly tableName: string
  readonly openPencilId: string
  readonly name: string
  readonly command: 'select' | 'insert' | 'update' | 'delete'
  readonly mode: 'permissive' | 'restrictive'
  readonly role: 'anon' | 'authenticated'
  /** Compiler-rendered policy tail, never caller-provided SQL. */
  readonly policyTail: string
}

interface SupabaseACLPreconditionEntry {
  readonly grantor: string
  readonly grantee: string
  readonly privilege: string
  readonly isGrantable: boolean
}

interface SupabasePolicyPreconditionEntry {
  readonly name: string
  readonly command: string
  readonly mode: string
  readonly roles: readonly string[]
  readonly marker: string | null
  readonly usingExpressionDigest: string | null
  readonly withCheckExpressionDigest: string | null
}

interface SupabaseRuntimeRolePreconditionEntry {
  readonly roleName: string
  readonly superuser: boolean
  readonly bypassRls: boolean
  readonly inherit: boolean
}

interface SupabasePolicyShapePreconditionEntry {
  readonly name: string
  readonly command: string
  readonly mode: string
  readonly roles: readonly string[]
  readonly marker: string | null
  readonly usingPresent: boolean
  readonly withCheckPresent: boolean
}

interface SupabasePhysicalColumnPreconditionEntry {
  readonly address: {
    readonly classOid: string
    readonly objectOid: string
    readonly subId: number
  }
  readonly name: string
  readonly marker: string | null
  readonly typeOid: string
  readonly nullable: boolean
  readonly defaultExpressionDigest: string | null
  readonly identityKind: string
  readonly generatedKind: string
}

function requirePhysicalAddress(
  value: {
    readonly address?: {
      readonly classOid: string
      readonly objectOid: string
      readonly subId: number
    }
  },
  label: string
) {
  if (!value.address) {
    throw new TypeError(
      `Supabase Apply freshness requires an inspected catalog address for ${label}.`
    )
  }
  return value.address
}

function requireManagedMarker(
  kind: 'enum' | 'field' | 'primary-key' | 'foreign-key' | 'unique' | 'index',
  id: string | undefined,
  label: string
): string {
  if (!id) {
    throw new TypeError(`Supabase Apply freshness requires a managed identity for ${label}.`)
  }
  return formatSupabaseManagedMarker(kind, id)
}

function constraintMarkerKind(
  kind: SupabaseInspectedMigrationSnapshotV1['constraints'][number]['kind']
): 'primary-key' | 'foreign-key' | 'unique' | null {
  if (kind === 'primary-key') return 'primary-key'
  if (kind === 'foreign-key') return 'foreign-key'
  if (kind === 'unique') return 'unique'
  return null
}

function expectedManagedEnums(snapshot: SupabaseInspectedMigrationSnapshotV1): readonly object[] {
  return snapshot.objects
    .filter(
      (object): object is Extract<typeof object, { kind: 'enum' }> =>
        object.kind === 'enum' && object.management === 'managed'
    )
    .map((dataEnum) => {
      return {
        address: requirePhysicalAddress(dataEnum, `enum public.${dataEnum.name}`),
        name: dataEnum.name,
        marker: requireManagedMarker('enum', dataEnum.openPencilId, `enum public.${dataEnum.name}`),
        values: dataEnum.values
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function expectedPhysicalColumns(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string
): readonly SupabasePhysicalColumnPreconditionEntry[] {
  return snapshot.columns
    .filter((column) => column.tableName === tableName)
    .map((column) => {
      if (column.management === 'managed' && !column.openPencilFieldId) {
        throw new TypeError(
          `Supabase Apply freshness requires a managed identity for column public.${tableName}.${column.name}.`
        )
      }
      if (
        column.typeOid === undefined ||
        column.defaultExpressionDigest === undefined ||
        column.identityKind === undefined ||
        column.generatedKind === undefined
      ) {
        throw new TypeError(
          `Supabase Apply freshness requires complete physical column state for public.${tableName}.${column.name}.`
        )
      }
      return {
        address: requirePhysicalAddress(column, `column public.${tableName}.${column.name}`),
        name: column.name,
        marker:
          column.management === 'managed'
            ? requireManagedMarker(
                'field',
                column.openPencilFieldId,
                `column public.${tableName}.${column.name}`
              )
            : null,
        typeOid: column.typeOid,
        nullable: column.nullable,
        defaultExpressionDigest: column.defaultExpressionDigest,
        identityKind: column.identityKind,
        generatedKind: column.generatedKind
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function expectedPhysicalConstraints(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string
): readonly object[] {
  return snapshot.constraints
    .filter((constraint) => constraint.tableName === tableName)
    .map((constraint) => {
      if (constraint.management === 'managed' && !constraint.openPencilId) {
        throw new TypeError(
          `Supabase Apply freshness requires a managed identity for constraint public.${tableName}.${constraint.name}.`
        )
      }
      if (constraint.definitionDigest === undefined || constraint.validated === undefined) {
        throw new TypeError(
          `Supabase Apply freshness requires complete physical constraint state for public.${tableName}.${constraint.name}.`
        )
      }
      const markerKind = constraintMarkerKind(constraint.kind)
      return {
        address: requirePhysicalAddress(
          constraint,
          `constraint public.${tableName}.${constraint.name}`
        ),
        name: constraint.name,
        marker:
          constraint.management === 'managed' && markerKind
            ? requireManagedMarker(
                markerKind,
                constraint.openPencilId,
                `constraint public.${tableName}.${constraint.name}`
              )
            : null,
        definitionDigest: constraint.definitionDigest,
        validated: constraint.validated
      }
    })
    .sort((left, right) =>
      String(Reflect.get(left, 'name')).localeCompare(String(Reflect.get(right, 'name')), 'en')
    )
}

function expectedPhysicalIndexes(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string
): readonly object[] {
  return snapshot.indexes
    .filter((index) => index.tableName === tableName)
    .map((index) => {
      if (index.management === 'managed' && !index.openPencilId) {
        throw new TypeError(
          `Supabase Apply freshness requires a managed identity for index public.${tableName}.${index.name}.`
        )
      }
      if (
        index.definitionDigest === undefined ||
        index.valid === undefined ||
        index.ready === undefined
      ) {
        throw new TypeError(
          `Supabase Apply freshness requires complete physical index state for public.${tableName}.${index.name}.`
        )
      }
      return {
        address: requirePhysicalAddress(index, `index public.${tableName}.${index.name}`),
        name: index.name,
        marker:
          index.management === 'managed'
            ? requireManagedMarker(
                'index',
                index.openPencilId,
                `index public.${tableName}.${index.name}`
              )
            : null,
        definitionDigest: index.definitionDigest,
        valid: index.valid,
        ready: index.ready
      }
    })
    .sort((left, right) =>
      String(Reflect.get(left, 'name')).localeCompare(String(Reflect.get(right, 'name')), 'en')
    )
}

const UTF8_ENCODER = new TextEncoder()

function compareUTF8Text(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left)
  const rightBytes = UTF8_ENCODER.encode(right)
  const sharedLength = Math.min(leftBytes.byteLength, rightBytes.byteLength)
  for (let index = 0; index < sharedLength; index++) {
    const difference = leftBytes[index] - rightBytes[index]
    if (difference !== 0) return difference
  }
  return leftBytes.byteLength - rightBytes.byteLength
}

export interface SupabaseInspectedBaselinePreconditionV1 {
  readonly version: 1
  readonly tableNames: readonly string[]
  readonly statements: readonly string[]
}

function canonicalJSONLiteral(value: unknown): string {
  return `${quoteLiteral(JSON.stringify(value))}::jsonb`
}

/**
 * Catalog inventories are unordered. PostgreSQL's active collation can order values such as
 * `PUBLIC` differently from the compiler's ICU-backed sort, so compare value multiplicities
 * instead of serialized JSON array positions. The counts preserve duplicate detection.
 */
function jsonbArrayMultisetDiffers(actual: string, expected: string): string {
  return `EXISTS (
    SELECT 1
    FROM (
      SELECT entry, pg_catalog.count(*) AS copies
      FROM pg_catalog.jsonb_array_elements(${actual}) AS entries(entry)
      GROUP BY entry
    ) AS actual_inventory
    FULL JOIN (
      SELECT entry, pg_catalog.count(*) AS copies
      FROM pg_catalog.jsonb_array_elements(${expected}) AS entries(entry)
      GROUP BY entry
    ) AS expected_inventory USING (entry)
    WHERE actual_inventory.copies IS DISTINCT FROM expected_inventory.copies
  )`
}

function aclKey(entry: SupabaseACLPreconditionEntry): string {
  return `${entry.grantor}:${entry.grantee}:${entry.privilege}:${String(entry.isGrantable)}`
}

function expectedACL(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  objectKind: 'schema' | 'table',
  objectName: string
): readonly SupabaseACLPreconditionEntry[] {
  return snapshot.privileges
    .filter((entry) => entry.objectKind === objectKind && entry.objectName === objectName)
    .map((entry) => ({
      grantor: entry.grantor,
      grantee: entry.grantee,
      privilege: entry.privilege,
      isGrantable: entry.isGrantable
    }))
    .sort((left, right) => aclKey(left).localeCompare(aclKey(right), 'en'))
}

function policyKey(entry: SupabasePolicyPreconditionEntry): string {
  return `${entry.name}:${entry.command}:${entry.mode}:${entry.roles.join(',')}`
}

function expectedPolicies(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string
): readonly SupabasePolicyPreconditionEntry[] {
  return snapshot.policies
    .filter((entry) => entry.tableName === tableName)
    .map((entry) => ({
      name: entry.name,
      command: entry.command,
      mode: entry.mode,
      roles: [...entry.roles].sort(compareUTF8Text),
      marker:
        entry.source === 'openpencil' ? formatSupabaseManagedMarker('policy', entry.name) : null,
      usingExpressionDigest: entry.usingExpressionDigest,
      withCheckExpressionDigest: entry.withCheckExpressionDigest
    }))
    .sort((left, right) => policyKey(left).localeCompare(policyKey(right), 'en'))
}

function expectedRuntimeRoles(
  snapshot: SupabaseInspectedMigrationSnapshotV1
): readonly SupabaseRuntimeRolePreconditionEntry[] {
  return snapshot.roles
    .filter((entry) => entry.roleName === 'anon' || entry.roleName === 'authenticated')
    .map((entry) => ({
      roleName: entry.roleName,
      superuser: entry.superuser,
      bypassRls: entry.bypassRls,
      inherit: entry.inherit
    }))
    .sort((left, right) => left.roleName.localeCompare(right.roleName, 'en'))
}

function expectedRuntimeMemberships(
  snapshot: SupabaseInspectedMigrationSnapshotV1
): readonly object[] {
  return snapshot.roleMemberships
    .filter((entry) => entry.memberName === 'anon' || entry.memberName === 'authenticated')
    .map((entry) => ({
      roleName: entry.roleName,
      memberName: entry.memberName,
      grantorName: entry.grantorName,
      adminOption: entry.adminOption,
      inheritOption: entry.inheritOption,
      setOption: entry.setOption
    }))
    .sort((left, right) =>
      `${left.memberName}:${left.roleName}:${left.grantorName}`.localeCompare(
        `${right.memberName}:${right.roleName}:${right.grantorName}`,
        'en'
      )
    )
}

function schemaBaselineStatement(snapshot: SupabaseInspectedMigrationSnapshotV1): string {
  const schemaACL = canonicalJSONLiteral(expectedACL(snapshot, 'schema', 'public'))
  const runtimeRoles = canonicalJSONLiteral(expectedRuntimeRoles(snapshot))
  const memberships = canonicalJSONLiteral(expectedRuntimeMemberships(snapshot))
  const managedEnums = canonicalJSONLiteral(expectedManagedEnums(snapshot))
  const emptyDefaultACL = canonicalJSONLiteral([])
  return `DO $openpencil_precondition$
DECLARE
  actual_schema_acl jsonb;
  actual_runtime_roles jsonb;
  actual_runtime_memberships jsonb;
  actual_managed_enums jsonb;
  actual_default_acl jsonb;
BEGIN
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'grantor', grantor.rolname,
        'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'privilege', acl.privilege_type::text,
        'isGrantable', acl.is_grantable
      )
      ORDER BY grantor.rolname,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        acl.privilege_type::text,
        acl.is_grantable
    ),
    '[]'::jsonb
  )
  INTO actual_schema_acl
  FROM pg_catalog.pg_namespace AS namespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(namespace.nspacl, pg_catalog.acldefault('n'::"char", namespace.nspowner))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE namespace.nspname = 'public'
    AND acl.grantee <> namespace.nspowner;

  IF ${jsonbArrayMultisetDiffers('actual_schema_acl', schemaACL)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: public schema ACL drift.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'roleName', role.rolname,
        'superuser', role.rolsuper,
        'bypassRls', role.rolbypassrls,
        'inherit', role.rolinherit
      )
      ORDER BY role.rolname
    ),
    '[]'::jsonb
  )
  INTO actual_runtime_roles
  FROM pg_catalog.pg_roles AS role
  WHERE role.rolname IN ('anon', 'authenticated');

  IF ${jsonbArrayMultisetDiffers('actual_runtime_roles', runtimeRoles)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: runtime role drift.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'roleName', role.rolname,
        'memberName', member.rolname,
        'grantorName', grantor.rolname,
        'adminOption', membership.admin_option,
        'inheritOption', COALESCE((pg_catalog.to_jsonb(membership)->>'inherit_option')::boolean, true),
        'setOption', COALESCE((pg_catalog.to_jsonb(membership)->>'set_option')::boolean, true)
      )
      ORDER BY member.rolname, role.rolname, grantor.rolname
    ),
    '[]'::jsonb
  )
  INTO actual_runtime_memberships
  FROM pg_catalog.pg_auth_members AS membership
  JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
  JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
  WHERE member.rolname IN ('anon', 'authenticated');

  IF ${jsonbArrayMultisetDiffers('actual_runtime_memberships', memberships)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: runtime membership drift.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'address', pg_catalog.jsonb_build_object(
          'classOid', 'pg_type'::regclass::oid::text,
          'objectOid', data_type.oid::text,
          'subId', 0
        ),
        'name', data_type.typname,
        'marker', pg_catalog.obj_description(data_type.oid, 'pg_type'),
        'values', COALESCE((
          SELECT pg_catalog.jsonb_agg(enum_value.enumlabel ORDER BY enum_value.enumsortorder)
          FROM pg_catalog.pg_enum AS enum_value
          WHERE enum_value.enumtypid = data_type.oid
        ), '[]'::jsonb)
      )
      ORDER BY data_type.typname
    ),
    '[]'::jsonb
  )
  INTO actual_managed_enums
  FROM pg_catalog.pg_type AS data_type
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = data_type.typnamespace
  WHERE namespace.nspname = 'public'
    AND data_type.typtype = 'e'
    AND pg_catalog.obj_description(data_type.oid, 'pg_type') LIKE 'openpencil:%';

  IF ${jsonbArrayMultisetDiffers('actual_managed_enums', managedEnums)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: managed enum physical drift.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'objectKind', CASE defaults.defaclobjtype
          WHEN 'r' THEN 'table'
          WHEN 'S' THEN 'sequence'
          WHEN 'f' THEN 'function'
          WHEN 'T' THEN 'type'
          WHEN 'n' THEN 'schema'
        END,
        'grantor', grantor.rolname,
        'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'privilege', acl.privilege_type::text,
        'isGrantable', acl.is_grantable
      )
      ORDER BY CASE defaults.defaclobjtype
          WHEN 'r' THEN 'table'
          WHEN 'S' THEN 'sequence'
          WHEN 'f' THEN 'function'
          WHEN 'T' THEN 'type'
          WHEN 'n' THEN 'schema'
        END,
        grantor.rolname,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        acl.privilege_type::text,
        acl.is_grantable
    ),
    '[]'::jsonb
  )
  INTO actual_default_acl
  FROM pg_catalog.pg_default_acl AS defaults
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = defaults.defaclrole
  LEFT JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE (defaults.defaclnamespace = 0 OR namespace.nspname = 'public')
    AND defaults.defaclobjtype IN ('r', 'S', 'f', 'T', 'n')
    AND owner.rolname = current_user
    AND acl.grantee <> defaults.defaclrole;

  IF ${jsonbArrayMultisetDiffers('actual_default_acl', emptyDefaultACL)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: default privilege drift.',
      ERRCODE = 'P0001';
  END IF;
END
$openpencil_precondition$;`
}

function rawExpressionDigestSQL(expression: string, kind: string): string {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE pg_catalog.translate(
          pg_catalog.rtrim(
            pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(
                  '{"expression":' || pg_catalog.to_json(
                    ${expression}
                  )::text || ',"format":"openpencil.supabase-pg-catalog-expression.v1","kind":"${kind}"}',
                  'UTF8'
                )
              ),
              'base64'
            ),
            '='
          ),
          '+/',
          '-_'
        ) END`
}

function expressionDigestSQL(column: 'pol.polqual' | 'pol.polwithcheck', kind: string): string {
  return rawExpressionDigestSQL(`pg_catalog.pg_get_expr(${column}, pol.polrelid)`, kind)
}

function tableBaselineStatement(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  table: Extract<SupabaseInspectedMigrationSnapshotV1['objects'][number], { kind: 'table' }>
): string {
  if (!table.openPencilId) {
    throw new TypeError('Managed Supabase table precondition requires an OpenPencil identity.')
  }
  const tableAddress = requirePhysicalAddress(table, `table public.${table.name}`)
  if (tableAddress.subId !== 0) {
    throw new TypeError(
      `Supabase table public.${table.name} has an invalid catalog sub-object address.`
    )
  }
  const marker = quoteLiteral(formatSupabaseManagedMarker('entity', table.openPencilId))
  const expectedTableACL = canonicalJSONLiteral(expectedACL(snapshot, 'table', table.name))
  const policies = canonicalJSONLiteral(expectedPolicies(snapshot, table.name))
  const physicalColumns = canonicalJSONLiteral(expectedPhysicalColumns(snapshot, table.name))
  const physicalConstraints = canonicalJSONLiteral(
    expectedPhysicalConstraints(snapshot, table.name)
  )
  const physicalIndexes = canonicalJSONLiteral(expectedPhysicalIndexes(snapshot, table.name))
  const tableLabel = quoteLiteral(`public.${table.name}`)
  return `DO $openpencil_precondition$
DECLARE
  relation_oid oid;
  relation_kind "char";
  relation_owner name;
  relation_marker text;
  relation_rls boolean;
  relation_force_rls boolean;
  column_acl_present boolean;
  actual_table_acl jsonb;
  actual_policies jsonb;
  actual_columns jsonb;
  actual_constraints jsonb;
  actual_indexes jsonb;
BEGIN
  SELECT relation.oid,
    relation.relkind,
    owner.rolname,
    pg_catalog.obj_description(relation.oid, 'pg_class'),
    relation.relrowsecurity,
    relation.relforcerowsecurity
  INTO relation_oid,
    relation_kind,
    relation_owner,
    relation_marker,
    relation_rls,
    relation_force_rls
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = relation.relowner
  WHERE namespace.nspname = 'public'
    AND relation.relname = ${quoteLiteral(table.name)};

  IF relation_oid IS NULL
    OR relation_kind <> 'r'::"char"
    OR 'pg_class'::regclass::oid::text IS DISTINCT FROM ${quoteLiteral(tableAddress.classOid)}
    OR relation_oid::text IS DISTINCT FROM ${quoteLiteral(tableAddress.objectOid)}
    OR relation_owner <> current_user
    OR relation_marker IS DISTINCT FROM ${marker}
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: managed relation identity drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  IF relation_rls IS DISTINCT FROM ${table.rlsEnabled ? 'TRUE' : 'FALSE'}
    OR relation_force_rls IS DISTINCT FROM ${table.rlsForced ? 'TRUE' : 'FALSE'}
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: RLS drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'address', pg_catalog.jsonb_build_object(
          'classOid', 'pg_class'::regclass::oid::text,
          'objectOid', attribute.attrelid::text,
          'subId', attribute.attnum
        ),
        'name', attribute.attname,
        'marker', CASE
          WHEN pg_catalog.col_description(attribute.attrelid, attribute.attnum) LIKE 'openpencil:%'
          THEN pg_catalog.col_description(attribute.attrelid, attribute.attnum)
          ELSE NULL
        END,
        'typeOid', attribute.atttypid::text,
        'nullable', NOT attribute.attnotnull,
        'defaultExpressionDigest', ${rawExpressionDigestSQL(
          'pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid)',
          'column-default'
        )},
        'identityKind', attribute.attidentity::text,
        'generatedKind', attribute.attgenerated::text
      )
      ORDER BY attribute.attnum
    ),
    '[]'::jsonb
  )
  INTO actual_columns
  FROM pg_catalog.pg_attribute AS attribute
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = attribute.attrelid
    AND attribute_default.adnum = attribute.attnum
  WHERE attribute.attrelid = relation_oid
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF ${jsonbArrayMultisetDiffers('actual_columns', physicalColumns)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: column physical drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'address', pg_catalog.jsonb_build_object(
          'classOid', 'pg_constraint'::regclass::oid::text,
          'objectOid', constraint_row.oid::text,
          'subId', 0
        ),
        'name', constraint_row.conname,
        'marker', CASE
          WHEN pg_catalog.obj_description(constraint_row.oid, 'pg_constraint') LIKE 'openpencil:%'
          THEN pg_catalog.obj_description(constraint_row.oid, 'pg_constraint')
          ELSE NULL
        END,
        'definitionDigest', ${rawExpressionDigestSQL(
          'pg_catalog.pg_get_constraintdef(constraint_row.oid, true)',
          'constraint-definition'
        )},
        'validated', constraint_row.convalidated
      )
      ORDER BY constraint_row.conname
    ),
    '[]'::jsonb
  )
  INTO actual_constraints
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = relation_oid
    AND constraint_row.contype IN ('p', 'u', 'f', 'c');

  IF ${jsonbArrayMultisetDiffers('actual_constraints', physicalConstraints)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: constraint physical drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'address', pg_catalog.jsonb_build_object(
          'classOid', 'pg_class'::regclass::oid::text,
          'objectOid', index_relation.oid::text,
          'subId', 0
        ),
        'name', index_relation.relname,
        'marker', CASE
          WHEN pg_catalog.obj_description(index_relation.oid, 'pg_class') LIKE 'openpencil:%'
          THEN pg_catalog.obj_description(index_relation.oid, 'pg_class')
          ELSE NULL
        END,
        'definitionDigest', ${rawExpressionDigestSQL(
          'pg_catalog.pg_get_indexdef(index_relation.oid)',
          'index-definition'
        )},
        'valid', index_row.indisvalid,
        'ready', index_row.indisready
      )
      ORDER BY index_relation.relname
    ),
    '[]'::jsonb
  )
  INTO actual_indexes
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
  LEFT JOIN pg_catalog.pg_constraint AS backing_constraint
    ON backing_constraint.conindid = index_relation.oid
  WHERE index_row.indrelid = relation_oid
    AND backing_constraint.oid IS NULL;

  IF ${jsonbArrayMultisetDiffers('actual_indexes', physicalIndexes)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: index physical drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = relation_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
  )
  INTO column_acl_present;

  IF column_acl_present THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: column ACL drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'grantor', grantor.rolname,
        'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'privilege', acl.privilege_type::text,
        'isGrantable', acl.is_grantable
      )
      ORDER BY grantor.rolname,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        acl.privilege_type::text,
        acl.is_grantable
    ),
    '[]'::jsonb
  )
  INTO actual_table_acl
  FROM pg_catalog.pg_class AS acl_relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(acl_relation.relacl, pg_catalog.acldefault('r'::"char", acl_relation.relowner))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE acl_relation.oid = relation_oid
    AND acl.grantee <> acl_relation.relowner;

  IF ${jsonbArrayMultisetDiffers('actual_table_acl', expectedTableACL)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: table ACL drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', pol.polname,
        'command', CASE pol.polcmd
          WHEN '*' THEN 'all'
          WHEN 'r' THEN 'select'
          WHEN 'a' THEN 'insert'
          WHEN 'w' THEN 'update'
          WHEN 'd' THEN 'delete'
        END,
        'mode', CASE WHEN pol.polpermissive THEN 'permissive' ELSE 'restrictive' END,
        'roles', COALESCE((
          SELECT pg_catalog.jsonb_agg(
            CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END
            ORDER BY pg_catalog.convert_to(
              CASE
                WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
                ELSE role.rolname::text
              END,
              'UTF8'
            )
          )
          FROM unnest(pol.polroles) AS policy_role(role_oid)
          LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
        ), '[]'::jsonb),
        'marker', CASE
          WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
          THEN pg_catalog.obj_description(pol.oid, 'pg_policy')
          ELSE NULL
        END,
        'usingExpressionDigest', ${expressionDigestSQL('pol.polqual', 'policy-using')},
        'withCheckExpressionDigest', ${expressionDigestSQL('pol.polwithcheck', 'policy-check')}
      )
      ORDER BY pol.polname
    ),
    '[]'::jsonb
  )
  INTO actual_policies
  FROM pg_catalog.pg_policy AS pol
  WHERE pol.polrelid = relation_oid;

  IF ${jsonbArrayMultisetDiffers('actual_policies', policies)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil inspected baseline precondition failed: policy drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;
END
$openpencil_precondition$;`
}

/**
 * Emit transaction-local catalog assertions from the parsed, digest-bound snapshot. Callers supply
 * only target names already derived by the compiler; every expected value comes from the snapshot.
 */
export function renderInspectedBaselinePreconditions(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  targetTableNames: ReadonlySet<string>
): SupabaseInspectedBaselinePreconditionV1 {
  const tables = snapshot.objects
    .filter(
      (object): object is Extract<typeof object, { kind: 'table' }> =>
        object.kind === 'table' &&
        object.management === 'managed' &&
        targetTableNames.has(object.name)
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const tableNames = tables.map((table) => table.name)
  return {
    version: 1,
    tableNames,
    statements: [
      '-- OpenPencil transaction-local inspected baseline precondition v1.',
      ...tables.map(
        (table) => `LOCK TABLE ONLY ${qualified(table.name)} IN ACCESS EXCLUSIVE MODE;`
      ),
      schemaBaselineStatement(snapshot),
      ...tables.map((table) => tableBaselineStatement(snapshot, table))
    ]
  }
}

function plannedPolicyShape(
  policy: SupabasePlannedPolicyPreconditionV1
): SupabasePolicyShapePreconditionEntry {
  return {
    name: policy.name,
    command: policy.command,
    mode: policy.mode,
    roles: [policy.role],
    marker: formatSupabaseManagedMarker('policy', policy.name),
    usingPresent: policy.command !== 'insert',
    withCheckPresent: policy.command === 'insert' || policy.command === 'update'
  }
}

function snapshotPolicyShape(
  policy: SupabaseInspectedMigrationSnapshotV1['policies'][number]
): SupabasePolicyShapePreconditionEntry {
  return {
    name: policy.name,
    command: policy.command,
    mode: policy.mode,
    roles: [...policy.roles].sort(compareUTF8Text),
    marker:
      policy.source === 'openpencil' ? formatSupabaseManagedMarker('policy', policy.name) : null,
    usingPresent: policy.usingExpressionDigest !== null,
    withCheckPresent: policy.withCheckExpressionDigest !== null
  }
}

function postPolicyShapes(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string,
  planned: readonly SupabasePlannedPolicyPreconditionV1[]
): readonly SupabasePolicyShapePreconditionEntry[] {
  const plannedNames = new Set(planned.map((entry) => entry.name))
  return [
    ...snapshot.policies
      .filter((entry) => entry.tableName === tableName && !plannedNames.has(entry.name))
      .map(snapshotPolicyShape),
    ...planned.map(plannedPolicyShape)
  ].sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

function postPolicyTableStatement(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  tableName: string,
  openPencilId: string,
  planned: readonly SupabasePlannedPolicyPreconditionV1[]
): string {
  const existing = snapshot.objects.find(
    (object) =>
      object.kind === 'table' &&
      object.management === 'managed' &&
      object.name === tableName &&
      object.openPencilId === openPencilId
  )
  const tableACL = canonicalJSONLiteral(existing ? expectedACL(snapshot, 'table', tableName) : [])
  const policyShapes = canonicalJSONLiteral(postPolicyShapes(snapshot, tableName, planned))
  const tableLabel = quoteLiteral(`public.${tableName}`)
  return `DO $openpencil_pregrant$
DECLARE
  relation_oid oid;
  relation_kind "char";
  relation_owner name;
  relation_marker text;
  relation_rls boolean;
  relation_force_rls boolean;
  column_acl_present boolean;
  actual_table_acl jsonb;
  actual_policy_shapes jsonb;
BEGIN
  SELECT relation.oid,
    relation.relkind,
    owner.rolname,
    pg_catalog.obj_description(relation.oid, 'pg_class'),
    relation.relrowsecurity,
    relation.relforcerowsecurity
  INTO relation_oid,
    relation_kind,
    relation_owner,
    relation_marker,
    relation_rls,
    relation_force_rls
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_catalog.pg_roles AS owner ON owner.oid = relation.relowner
  WHERE namespace.nspname = 'public'
    AND relation.relname = ${quoteLiteral(tableName)};

  IF relation_oid IS NULL
    OR relation_kind <> 'r'::"char"
    OR relation_owner <> current_user
    OR relation_marker IS DISTINCT FROM ${quoteLiteral(formatSupabaseManagedMarker('entity', openPencilId))}
    OR relation_rls IS DISTINCT FROM TRUE
    OR relation_force_rls IS DISTINCT FROM TRUE
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: managed RLS relation drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = relation_oid
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attacl IS NOT NULL
  )
  INTO column_acl_present;

  IF column_acl_present THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: column ACL drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'grantor', grantor.rolname,
        'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        'privilege', acl.privilege_type::text,
        'isGrantable', acl.is_grantable
      )
      ORDER BY grantor.rolname,
        CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END,
        acl.privilege_type::text,
        acl.is_grantable
    ),
    '[]'::jsonb
  )
  INTO actual_table_acl
  FROM pg_catalog.pg_class AS acl_relation
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(acl_relation.relacl, pg_catalog.acldefault('r'::"char", acl_relation.relowner))
  ) AS acl
  JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = acl.grantor
  LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
  WHERE acl_relation.oid = relation_oid
    AND acl.grantee <> acl_relation.relowner;

  IF ${jsonbArrayMultisetDiffers('actual_table_acl', tableACL)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: table ACL drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'name', pol.polname,
        'command', CASE pol.polcmd
          WHEN '*' THEN 'all'
          WHEN 'r' THEN 'select'
          WHEN 'a' THEN 'insert'
          WHEN 'w' THEN 'update'
          WHEN 'd' THEN 'delete'
        END,
        'mode', CASE WHEN pol.polpermissive THEN 'permissive' ELSE 'restrictive' END,
        'roles', COALESCE((
          SELECT pg_catalog.jsonb_agg(
            CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END
            ORDER BY pg_catalog.convert_to(
              CASE
                WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
                ELSE role.rolname::text
              END,
              'UTF8'
            )
          )
          FROM unnest(pol.polroles) AS policy_role(role_oid)
          LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
        ), '[]'::jsonb),
        'marker', CASE
          WHEN pg_catalog.obj_description(pol.oid, 'pg_policy') LIKE 'openpencil:%'
          THEN pg_catalog.obj_description(pol.oid, 'pg_policy')
          ELSE NULL
        END,
        'usingPresent', pol.polqual IS NOT NULL,
        'withCheckPresent', pol.polwithcheck IS NOT NULL
      )
      ORDER BY pol.polname
    ),
    '[]'::jsonb
  )
  INTO actual_policy_shapes
  FROM pg_catalog.pg_policy AS pol
  WHERE pol.polrelid = relation_oid;

  IF ${jsonbArrayMultisetDiffers('actual_policy_shapes', policyShapes)} THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: policy inventory drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;
END
$openpencil_pregrant$;`
}

function plannedPolicyExpressionStatement(policy: SupabasePlannedPolicyPreconditionV1): string {
  const shadowName = stableSQLName('openpencil_guard_policy', `${policy.tableName}:${policy.name}`)
  const tableLabel = quoteLiteral(`public.${policy.tableName}:${policy.name}`)
  return `DO $openpencil_pregrant$
DECLARE
  relation_oid oid;
  actual_permissive boolean;
  actual_command text;
  actual_roles jsonb;
  actual_marker text;
  actual_using_digest text;
  actual_check_digest text;
  expected_using_digest text;
  expected_check_digest text;
BEGIN
  SELECT relation.oid
  INTO relation_oid
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname = ${quoteLiteral(policy.tableName)};

  SELECT pol.polpermissive,
    CASE pol.polcmd
      WHEN '*' THEN 'all'
      WHEN 'r' THEN 'select'
      WHEN 'a' THEN 'insert'
      WHEN 'w' THEN 'update'
      WHEN 'd' THEN 'delete'
    END,
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        CASE WHEN policy_role.role_oid = 0 THEN 'PUBLIC' ELSE role.rolname END
        ORDER BY pg_catalog.convert_to(
          CASE
            WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
            ELSE role.rolname::text
          END,
          'UTF8'
        )
      )
      FROM unnest(pol.polroles) AS policy_role(role_oid)
      LEFT JOIN pg_catalog.pg_roles AS role ON role.oid = policy_role.role_oid
    ), '[]'::jsonb),
    pg_catalog.obj_description(pol.oid, 'pg_policy'),
    ${expressionDigestSQL('pol.polqual', 'policy-using')},
    ${expressionDigestSQL('pol.polwithcheck', 'policy-check')}
  INTO actual_permissive,
    actual_command,
    actual_roles,
    actual_marker,
    actual_using_digest,
    actual_check_digest
  FROM pg_catalog.pg_policy AS pol
  WHERE pol.polrelid = relation_oid
    AND pol.polname = ${quoteLiteral(policy.name)};

  IF actual_permissive IS DISTINCT FROM ${policy.mode === 'permissive' ? 'TRUE' : 'FALSE'}
    OR actual_command IS DISTINCT FROM ${quoteLiteral(policy.command)}
    OR ${jsonbArrayMultisetDiffers('actual_roles', canonicalJSONLiteral([policy.role]))}
    OR actual_marker IS DISTINCT FROM ${quoteLiteral(formatSupabaseManagedMarker('policy', policy.name))}
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: planned policy drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;

  BEGIN
    CREATE POLICY ${quoteIdentifier(shadowName)} ON ${qualified(policy.tableName)} ${policy.policyTail};

    SELECT ${expressionDigestSQL('pol.polqual', 'policy-using')},
      ${expressionDigestSQL('pol.polwithcheck', 'policy-check')}
    INTO expected_using_digest, expected_check_digest
    FROM pg_catalog.pg_policy AS pol
    WHERE pol.polrelid = relation_oid
      AND pol.polname = ${quoteLiteral(shadowName)};

    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil transient policy parse completed.',
      ERRCODE = 'OP001';
  EXCEPTION WHEN SQLSTATE 'OP001' THEN
    NULL;
  END;

  IF actual_using_digest IS DISTINCT FROM expected_using_digest
    OR actual_check_digest IS DISTINCT FROM expected_check_digest
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'OpenPencil pre-grant precondition failed: planned policy expression drift on ' || ${tableLabel} || '.',
      ERRCODE = 'P0001';
  END IF;
END
$openpencil_pregrant$;`
}

/** Recheck compiler-created RLS policy and ACL state immediately before runtime grants. */
export function renderPostPolicyGrantPreconditions(
  snapshot: SupabaseInspectedMigrationSnapshotV1,
  plannedPolicies: readonly SupabasePlannedPolicyPreconditionV1[]
): SupabaseInspectedBaselinePreconditionV1 {
  const policies = [...plannedPolicies].sort((left, right) =>
    `${left.tableName}:${left.name}`.localeCompare(`${right.tableName}:${right.name}`, 'en')
  )
  const byTable = new Map<string, SupabasePlannedPolicyPreconditionV1[]>()
  for (const policy of policies) {
    const entries = byTable.get(policy.tableName) ?? []
    entries.push(policy)
    byTable.set(policy.tableName, entries)
  }
  const tableNames = [...byTable.keys()].sort((left, right) => left.localeCompare(right, 'en'))
  return {
    version: 1,
    tableNames,
    statements:
      tableNames.length === 0
        ? []
        : [
            '-- OpenPencil transaction-local pre-grant verification v1.',
            schemaBaselineStatement(snapshot),
            ...tableNames.map((tableName) => {
              const tablePolicies = byTable.get(tableName) ?? []
              const openPencilId = tablePolicies[0]?.openPencilId
              if (!openPencilId) throw new TypeError('Planned policy table identity is required.')
              return postPolicyTableStatement(snapshot, tableName, openPencilId, tablePolicies)
            }),
            ...policies.map(plannedPolicyExpressionStatement)
          ]
  }
}
