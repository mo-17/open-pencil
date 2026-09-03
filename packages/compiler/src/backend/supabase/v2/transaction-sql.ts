import type {
  BackendApplicationSpecV2,
  BackendFieldScalarType,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { formatSupabaseManagedMarker } from '../inspection'
import { stableSQLName } from '../migration-review/common'
import { resolvedSupabaseAtomicTransactionV2 } from './transaction'

const MAX_SAFE_INTEGER = 9_007_199_254_740_991
const MAX_EXPECTED_VERSION = MAX_SAFE_INTEGER - 1
const MAX_TEXT_BYTES = 4_000_000

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function quoteFragmentedLiteral(value: string): string {
  const fragments: string[] = []
  for (let offset = 0; offset < value.length; offset += 24) {
    fragments.push(quoteLiteral(value.slice(offset, offset + 24)))
  }
  return fragments.join(' || ')
}

function qualified(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`
}

function postgresTypeName(type: BackendFieldScalarType): string {
  switch (type) {
    case 'string':
      return 'text'
    case 'integer':
      return 'int8'
    case 'number':
      return 'float8'
    case 'boolean':
      return 'bool'
    case 'date':
      return 'date'
    case 'datetime':
      return 'timestamptz'
    case 'uuid':
      return 'uuid'
    default:
      throw new TypeError('Unsupported Supabase atomic RPC field type.')
  }
}

function fieldPreflightSQL(table: string, field: DataFieldIR): readonly string[] {
  if (field.type === 'enum') {
    throw new TypeError('Supabase atomic RPC enum field reached SQL emission.')
  }
  const expectedNotNull = field.nullable ? 'FALSE' : 'TRUE'
  return [
    '  IF NOT EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_attribute')} AS ${quoteIdentifier('managed_column')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_class')} AS ${quoteIdentifier('managed_table')}`,
    `      ON ${quoteIdentifier('managed_table')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_column')}.${quoteIdentifier('attrelid')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_namespace')} AS ${quoteIdentifier('managed_namespace')}`,
    `      ON ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_table')}.${quoteIdentifier('relnamespace')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_type')} AS ${quoteIdentifier('managed_type')}`,
    `      ON ${quoteIdentifier('managed_type')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_column')}.${quoteIdentifier('atttypid')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_namespace')} AS ${quoteIdentifier('type_namespace')}`,
    `      ON ${quoteIdentifier('type_namespace')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_type')}.${quoteIdentifier('typnamespace')}`,
    `    WHERE ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('nspname')} = 'public'`,
    `      AND ${quoteIdentifier('managed_table')}.${quoteIdentifier('relname')} = ${quoteLiteral(table)}`,
    `      AND ${quoteIdentifier('managed_column')}.${quoteIdentifier('attname')} = ${quoteLiteral(field.name)}`,
    `      AND ${quoteIdentifier('managed_column')}.${quoteIdentifier('attnum')} > 0`,
    `      AND NOT ${quoteIdentifier('managed_column')}.${quoteIdentifier('attisdropped')}`,
    `      AND ${quoteIdentifier('managed_column')}.${quoteIdentifier('attnotnull')} = ${expectedNotNull}`,
    `      AND ${quoteIdentifier('type_namespace')}.${quoteIdentifier('nspname')} = 'pg_catalog'`,
    `      AND ${quoteIdentifier('managed_type')}.${quoteIdentifier('typname')} = ${quoteLiteral(postgresTypeName(field.type))}`,
    `      AND ${qualified('pg_catalog', 'col_description')}(${quoteIdentifier('managed_column')}.${quoteIdentifier('attrelid')}, ${quoteIdentifier('managed_column')}.${quoteIdentifier('attnum')}) = ${quoteLiteral(formatSupabaseManagedMarker('field', field.id))}`,
    '  ) THEN',
    `    RAISE EXCEPTION ${quoteLiteral(`OpenPencil managed field prerequisite failed: ${field.id}`)};`,
    '  END IF;'
  ]
}

/** Emits one review-only, PostgREST-callable, owner-scoped atomic update RPC. */
export function emitSupabaseAtomicTransactionSQLV2(application: BackendApplicationSpecV2): string {
  const transaction = resolvedSupabaseAtomicTransactionV2(application)
  const entity = application.dataModel.entities.at(0)
  const ownership = application.auth.ownership.at(0)
  const policy = application.auth.rowAccess.at(0)
  const primaryKeyField = entity?.fields.find(
    (field) => field.id === transaction.primaryKey.at(0)?.fieldId
  )
  const ownerField = entity?.fields.find((field) => field.id === transaction.ownerFieldId)
  const versionField = entity?.fields.find((field) => field.id === transaction.versionFieldId)
  const updateFields = transaction.updates.map((update) =>
    entity?.fields.find((field) => field.id === update.fieldId)
  )
  if (
    !entity ||
    !ownership ||
    !policy ||
    !primaryKeyField ||
    !ownerField ||
    !versionField ||
    updateFields.some((field) => !field)
  ) {
    throw new TypeError('Supabase atomic RPC SQL prerequisites were not resolved.')
  }
  const managedFields = [
    primaryKeyField,
    ownerField,
    versionField,
    ...(updateFields as readonly DataFieldIR[])
  ]
  const primaryKeyName = stableSQLName(
    'openpencil_pk',
    `${entity.name}:${transaction.primaryKey.map((entry) => entry.field).join(',')}`
  )
  const selectPolicyName = stableSQLName(
    'openpencil_policy',
    `${entity.id}:${policy.id}:${policy.effect}:select`
  )
  const updatePolicyName = stableSQLName(
    'openpencil_policy',
    `${entity.id}:${policy.id}:${policy.effect}:update`
  )
  const functionPath = qualified('public', transaction.functionName)
  const tablePath = qualified('public', transaction.table)
  const argumentType = (sqlType: string) => qualified('pg_catalog', sqlType)
  const signature = transaction.parameters.map((entry) => argumentType(entry.sqlType)).join(', ')
  const declaredArguments = transaction.parameters
    .map((entry) => `  ${quoteIdentifier(entry.sqlArgument)} ${argumentType(entry.sqlType)}`)
    .join(',\n')
  const parameterPosition = new Map(
    transaction.parameters.map((entry, index) => [entry.name, `$${index + 1}`])
  )
  const reference = (parameter: string): string => {
    const value = parameterPosition.get(parameter)
    if (!value) throw new TypeError('Supabase atomic RPC parameter was not resolved.')
    return value
  }
  const expectedVersion = reference(transaction.expectedVersionParameter)
  const primaryKeyPredicates = transaction.primaryKey.map(
    (entry) =>
      `    AND ${quoteIdentifier('target_row')}.${quoteIdentifier(entry.field)} = ${reference(entry.parameter)}`
  )
  const updateAssignments = transaction.updates.map(
    (entry) => `    ${quoteIdentifier(entry.field)} = ${reference(entry.parameter)}`
  )
  updateAssignments.push(
    `    ${quoteIdentifier(transaction.versionField)} = ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.versionField)} + 1`
  )
  const primaryKeyResult = transaction.primaryKey.flatMap((entry) => [
    quoteLiteral(entry.field),
    `${quoteIdentifier('pg_catalog')}.${quoteIdentifier('to_jsonb')}(${reference(entry.parameter)})`
  ])
  const nullGuards = transaction.parameters.flatMap((entry, index) => [
    `  IF $${index + 1} IS NULL THEN`,
    `    RAISE EXCEPTION ${quoteLiteral(`OpenPencil atomic parameter is required: ${entry.name}`)} USING ERRCODE = '22004';`,
    '  END IF;'
  ])
  const integerGuards = transaction.parameters
    .map((entry, index) => ({ entry, position: `$${index + 1}` }))
    .filter(({ entry }) => entry.type === 'integer')
    .flatMap(({ entry, position }) => {
      if (entry.name === transaction.expectedVersionParameter) {
        return [
          `  IF ${position} < 0 OR ${position} > ${MAX_EXPECTED_VERSION} THEN`,
          "    RAISE EXCEPTION 'OpenPencil expected version is outside the safe integer range' USING ERRCODE = '22003';",
          '  END IF;'
        ]
      }
      return [
        `  IF ${position} < -${MAX_SAFE_INTEGER} OR ${position} > ${MAX_SAFE_INTEGER} THEN`,
        "    RAISE EXCEPTION 'OpenPencil integer parameter is outside the safe integer range' USING ERRCODE = '22003';",
        '  END IF;'
      ]
    })
  const floatingPointGuards = transaction.parameters
    .map((entry, index) => ({ entry, position: `$${index + 1}` }))
    .filter(({ entry }) => entry.type === 'number')
    .flatMap(({ position }) => [
      `  IF ${position}::${argumentType('text')} IN ('NaN', 'Infinity', '-Infinity') THEN`,
      "    RAISE EXCEPTION 'OpenPencil number parameter must be finite' USING ERRCODE = '22003';",
      '  END IF;'
    ])
  const textGuards = transaction.parameters
    .map((entry, index) => ({ entry, position: `$${index + 1}` }))
    .filter(({ entry }) => entry.type === 'string')
    .flatMap(({ position }) => [
      `  IF ${qualified('pg_catalog', 'octet_length')}(${position}) > ${MAX_TEXT_BYTES} THEN`,
      "    RAISE EXCEPTION 'OpenPencil text parameter exceeds the reviewed byte bound' USING ERRCODE = '22001';",
      '  END IF;'
    ])
  const managedFieldChecks = managedFields.flatMap((field) => fieldPreflightSQL(entity.name, field))
  const argumentTypeChecks = transaction.parameters.map(
    (entry, index) =>
      `      AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('proargtypes')}[${index}] = ${qualified('pg_catalog', 'to_regtype')}(${quoteLiteral(`pg_catalog.${entry.sqlType}`)})`
  )
  const versionDefaultForms = ['0', '0::bigint', "'0'::bigint", '(0)::bigint', "('0'::bigint)"]
    .map(quoteLiteral)
    .join(', ')
  const policyChecks = [
    { name: selectPolicyName, command: 'r' },
    { name: updatePolicyName, command: 'w' }
  ].flatMap(({ name, command }) => [
    '  IF NOT EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_policy')} AS ${quoteIdentifier('managed_policy')}`,
    `    WHERE ${quoteIdentifier('managed_policy')}.${quoteIdentifier('polrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('managed_policy')}.${quoteIdentifier('polname')} = (${quoteFragmentedLiteral(name)})`,
    `      AND ${quoteIdentifier('managed_policy')}.${quoteIdentifier('polcmd')} = ${quoteLiteral(command)}`,
    `      AND ${quoteIdentifier('managed_policy')}.${quoteIdentifier('polpermissive')}`,
    `      AND ${quoteIdentifier('managed_policy')}.${quoteIdentifier('polroles')} = ARRAY[${quoteIdentifier('authenticated_oid')}]::${qualified('pg_catalog', 'oid')}[]`,
    `      AND ${qualified('pg_catalog', 'obj_description')}(${quoteIdentifier('managed_policy')}.${quoteIdentifier('oid')}, 'pg_policy') = (${quoteFragmentedLiteral(formatSupabaseManagedMarker('policy', name))})`,
    '  ) THEN',
    `    RAISE EXCEPTION ${quoteLiteral(`OpenPencil managed ${command === 'r' ? 'SELECT' : 'UPDATE'} policy prerequisite failed`)};`,
    '  END IF;'
  ])
  const lines = [
    '-- OpenPencil Supabase atomic transaction RPC review artifact v1.',
    '-- REVIEW ONLY: this compiler has no Apply, credential, network, or deployment authority.',
    '-- NOT RELEASE READY: the P1 source-ledger receipt and schema/RLS artifact digests are not bound.',
    '-- NON-EXCLUSIVE: P1 owner RLS and authenticated table grants still permit direct REST reads/writes.',
    '-- Atomicity applies only to one reviewed RPC call; this artifact does not create exclusive write authority.',
    '-- PostgREST executes one RPC request in one database transaction; this function pins serializable isolation.',
    '-- The public schema is required for the default Supabase Data API exposure boundary.',
    '-- SECURITY INVOKER plus explicit auth.uid(), owner predicates, and RLS retain caller authority.',
    '-- Single apply only: any existing same-name overload hard-blocks this artifact.',
    'BEGIN;',
    'DO $openpencil_drift$',
    'BEGIN',
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_proc')} AS ${quoteIdentifier('managed_function')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_namespace')} AS ${quoteIdentifier('managed_namespace')}`,
    `      ON ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_function')}.${quoteIdentifier('pronamespace')}`,
    `    WHERE ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('nspname')} = 'public'`,
    `      AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('proname')} = ${quoteLiteral(transaction.functionName)}`,
    '  ) THEN',
    "    RAISE EXCEPTION 'Existing OpenPencil atomic RPC overload requires reviewed cleanup or delta migration';",
    '  END IF;',
    'END;',
    '$openpencil_drift$;',
    '',
    'DO $openpencil_prerequisites$',
    'DECLARE',
    `  ${quoteIdentifier('managed_table_oid')} ${qualified('pg_catalog', 'oid')};`,
    `  ${quoteIdentifier('managed_table_owner_oid')} ${qualified('pg_catalog', 'oid')};`,
    `  ${quoteIdentifier('authenticated_oid')} ${qualified('pg_catalog', 'oid')};`,
    'BEGIN',
    `  SELECT ${quoteIdentifier('managed_table')}.${quoteIdentifier('oid')}, ${quoteIdentifier('managed_table')}.${quoteIdentifier('relowner')}`,
    `  INTO ${quoteIdentifier('managed_table_oid')}, ${quoteIdentifier('managed_table_owner_oid')}`,
    `  FROM ${qualified('pg_catalog', 'pg_class')} AS ${quoteIdentifier('managed_table')}`,
    `  JOIN ${qualified('pg_catalog', 'pg_namespace')} AS ${quoteIdentifier('managed_namespace')}`,
    `    ON ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_table')}.${quoteIdentifier('relnamespace')}`,
    `  WHERE ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('nspname')} = 'public'`,
    `    AND ${quoteIdentifier('managed_table')}.${quoteIdentifier('relname')} = ${quoteLiteral(entity.name)}`,
    `    AND ${quoteIdentifier('managed_table')}.${quoteIdentifier('relkind')} = 'r'`,
    `    AND ${quoteIdentifier('managed_table')}.${quoteIdentifier('relrowsecurity')}`,
    `    AND ${quoteIdentifier('managed_table')}.${quoteIdentifier('relforcerowsecurity')}`,
    `    AND ${qualified('pg_catalog', 'obj_description')}(${quoteIdentifier('managed_table')}.${quoteIdentifier('oid')}, 'pg_class') = ${quoteLiteral(formatSupabaseManagedMarker('entity', entity.id))};`,
    `  IF ${quoteIdentifier('managed_table_oid')} IS NULL THEN`,
    "    RAISE EXCEPTION 'OpenPencil managed table, marker, or forced RLS prerequisite failed';",
    '  END IF;',
    `  SELECT ${quoteIdentifier('role_entry')}.${quoteIdentifier('oid')}`,
    `  INTO ${quoteIdentifier('authenticated_oid')}`,
    `  FROM ${qualified('pg_catalog', 'pg_roles')} AS ${quoteIdentifier('role_entry')}`,
    `  WHERE ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolname')} = 'authenticated'`,
    `    AND NOT ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolsuper')}`,
    `    AND NOT ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolbypassrls')};`,
    `  IF ${quoteIdentifier('authenticated_oid')} IS NULL THEN`,
    "    RAISE EXCEPTION 'OpenPencil authenticated role must exist without superuser or BYPASSRLS authority';",
    '  END IF;',
    ...managedFieldChecks,
    '  IF NOT EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_attribute')} AS ${quoteIdentifier('version_column')}`,
    `    JOIN ${qualified('pg_catalog', 'pg_attrdef')} AS ${quoteIdentifier('version_default')}`,
    `      ON ${quoteIdentifier('version_default')}.${quoteIdentifier('adrelid')} = ${quoteIdentifier('version_column')}.${quoteIdentifier('attrelid')}`,
    `      AND ${quoteIdentifier('version_default')}.${quoteIdentifier('adnum')} = ${quoteIdentifier('version_column')}.${quoteIdentifier('attnum')}`,
    `    WHERE ${quoteIdentifier('version_column')}.${quoteIdentifier('attrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('version_column')}.${quoteIdentifier('attname')} = ${quoteLiteral(versionField.name)}`,
    `      AND ${qualified('pg_catalog', 'pg_get_expr')}(${quoteIdentifier('version_default')}.${quoteIdentifier('adbin')}, ${quoteIdentifier('version_default')}.${quoteIdentifier('adrelid')}) IN (${versionDefaultForms})`,
    '  ) THEN',
    "    RAISE EXCEPTION 'OpenPencil version column must retain literal default zero';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_constraint')} AS ${quoteIdentifier('managed_primary_key')}`,
    `    WHERE ${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('conrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('conname')} = (${quoteFragmentedLiteral(primaryKeyName)})`,
    `      AND ${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('contype')} = 'p'`,
    `      AND ${qualified('pg_catalog', 'array_length')}(${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('conkey')}, 1) = 1`,
    `      AND ${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('conkey')}[1] = (`,
    `        SELECT ${quoteIdentifier('primary_key_column')}.${quoteIdentifier('attnum')}`,
    `        FROM ${qualified('pg_catalog', 'pg_attribute')} AS ${quoteIdentifier('primary_key_column')}`,
    `        WHERE ${quoteIdentifier('primary_key_column')}.${quoteIdentifier('attrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `          AND ${quoteIdentifier('primary_key_column')}.${quoteIdentifier('attname')} = ${quoteLiteral(primaryKeyField.name)}`,
    '      )',
    `      AND ${qualified('pg_catalog', 'obj_description')}(${quoteIdentifier('managed_primary_key')}.${quoteIdentifier('oid')}, 'pg_constraint') = ${quoteLiteral(formatSupabaseManagedMarker('primary-key', entity.id))}`,
    '  ) THEN',
    "    RAISE EXCEPTION 'OpenPencil managed primary-key prerequisite failed';",
    '  END IF;',
    ...policyChecks,
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_policy')} AS ${quoteIdentifier('unexpected_policy')}`,
    `    WHERE ${quoteIdentifier('unexpected_policy')}.${quoteIdentifier('polrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('unexpected_policy')}.${quoteIdentifier('polname')} NOT IN ((${quoteFragmentedLiteral(selectPolicyName)}), (${quoteFragmentedLiteral(updatePolicyName)}))`,
    '  ) THEN',
    "    RAISE EXCEPTION 'Unexpected table policy blocks the bounded atomic RPC review';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_trigger')} AS ${quoteIdentifier('user_trigger')}`,
    `    WHERE ${quoteIdentifier('user_trigger')}.${quoteIdentifier('tgrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND NOT ${quoteIdentifier('user_trigger')}.${quoteIdentifier('tgisinternal')}`,
    '  ) THEN',
    "    RAISE EXCEPTION 'User trigger can change the reviewed atomic update postcondition';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_rewrite')} AS ${quoteIdentifier('user_rule')}`,
    `    WHERE ${quoteIdentifier('user_rule')}.${quoteIdentifier('ev_class')} = ${quoteIdentifier('managed_table_oid')}`,
    '  ) THEN',
    "    RAISE EXCEPTION 'User rule can change the reviewed atomic update postcondition';",
    '  END IF;',
    '  IF (',
    '    SELECT COUNT(*)',
    `    FROM ${qualified('pg_catalog', 'pg_class')} AS ${quoteIdentifier('managed_table')}`,
    `    CROSS JOIN LATERAL ${qualified('pg_catalog', 'aclexplode')}(`,
    `      COALESCE(${quoteIdentifier('managed_table')}.${quoteIdentifier('relacl')}, ${qualified('pg_catalog', 'acldefault')}('r', ${quoteIdentifier('managed_table')}.${quoteIdentifier('relowner')}))`,
    `    ) AS ${quoteIdentifier('table_acl')}`,
    `    WHERE ${quoteIdentifier('managed_table')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('table_acl')}.${quoteIdentifier('grantee')} = ${quoteIdentifier('authenticated_oid')}`,
    `      AND ${quoteIdentifier('table_acl')}.${quoteIdentifier('grantor')} = ${quoteIdentifier('managed_table_owner_oid')}`,
    `      AND ${quoteIdentifier('table_acl')}.${quoteIdentifier('privilege_type')} IN ('SELECT', 'UPDATE')`,
    `      AND NOT ${quoteIdentifier('table_acl')}.${quoteIdentifier('is_grantable')}`,
    '  ) <> 2 OR EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_class')} AS ${quoteIdentifier('managed_table')}`,
    `    CROSS JOIN LATERAL ${qualified('pg_catalog', 'aclexplode')}(`,
    `      COALESCE(${quoteIdentifier('managed_table')}.${quoteIdentifier('relacl')}, ${qualified('pg_catalog', 'acldefault')}('r', ${quoteIdentifier('managed_table')}.${quoteIdentifier('relowner')}))`,
    `    ) AS ${quoteIdentifier('table_acl')}`,
    `    WHERE ${quoteIdentifier('managed_table')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_table_oid')}`,
    '      AND (',
    `        ${quoteIdentifier('table_acl')}.${quoteIdentifier('grantee')} NOT IN (${quoteIdentifier('managed_table_owner_oid')}, ${quoteIdentifier('authenticated_oid')})`,
    `        OR (${quoteIdentifier('table_acl')}.${quoteIdentifier('grantee')} = ${quoteIdentifier('authenticated_oid')} AND (`,
    `          ${quoteIdentifier('table_acl')}.${quoteIdentifier('grantor')} <> ${quoteIdentifier('managed_table_owner_oid')}`,
    `          OR ${quoteIdentifier('table_acl')}.${quoteIdentifier('privilege_type')} NOT IN ('SELECT', 'UPDATE')`,
    `          OR ${quoteIdentifier('table_acl')}.${quoteIdentifier('is_grantable')}`,
    '        ))',
    '      )',
    '  ) THEN',
    "    RAISE EXCEPTION 'OpenPencil direct table grant prerequisite failed';",
    '  END IF;',
    '  IF EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_attribute')} AS ${quoteIdentifier('column_acl')}`,
    `    WHERE ${quoteIdentifier('column_acl')}.${quoteIdentifier('attrelid')} = ${quoteIdentifier('managed_table_oid')}`,
    `      AND ${quoteIdentifier('column_acl')}.${quoteIdentifier('attnum')} > 0`,
    `      AND NOT ${quoteIdentifier('column_acl')}.${quoteIdentifier('attisdropped')}`,
    `      AND ${qualified('pg_catalog', 'cardinality')}(${quoteIdentifier('column_acl')}.${quoteIdentifier('attacl')}) > 0`,
    '  ) THEN',
    "    RAISE EXCEPTION 'Column-level grants are outside the reviewed direct CRUD authority';",
    '  END IF;',
    'END;',
    '$openpencil_prerequisites$;',
    '',
    `CREATE FUNCTION ${functionPath}(`,
    declaredArguments,
    ')',
    `RETURNS ${argumentType('jsonb')}`,
    'LANGUAGE plpgsql',
    'VOLATILE',
    'SECURITY INVOKER',
    "SET search_path = ''",
    "SET default_transaction_isolation TO 'serializable'",
    'AS $openpencil$',
    'DECLARE',
    `  ${quoteIdentifier('current_user_id')} ${argumentType('uuid')};`,
    `  ${quoteIdentifier('current_version')} ${argumentType('int8')};`,
    `  ${quoteIdentifier('updated_version')} ${argumentType('int8')};`,
    `  ${quoteIdentifier('affected_rows')} ${argumentType('int4')};`,
    'BEGIN',
    `  IF ${qualified('pg_catalog', 'current_setting')}('transaction_isolation') <> 'serializable' THEN`,
    "    RAISE EXCEPTION 'OpenPencil atomic RPC requires serializable isolation' USING ERRCODE = '25001';",
    '  END IF;',
    `  ${quoteIdentifier('current_user_id')} := ${qualified('auth', 'uid')}();`,
    `  IF ${quoteIdentifier('current_user_id')} IS NULL THEN`,
    "    RAISE EXCEPTION 'OpenPencil atomic RPC requires an authenticated user' USING ERRCODE = '42501';",
    '  END IF;',
    ...nullGuards,
    ...integerGuards,
    ...floatingPointGuards,
    ...textGuards,
    '',
    `  SELECT ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.versionField)}`,
    `  INTO ${quoteIdentifier('current_version')}`,
    `  FROM ${tablePath} AS ${quoteIdentifier('target_row')}`,
    '  WHERE TRUE',
    ...primaryKeyPredicates,
    `    AND ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.ownerField)} = ${quoteIdentifier('current_user_id')}`,
    '  FOR UPDATE;',
    '  IF NOT FOUND THEN',
    "    RAISE EXCEPTION 'OpenPencil atomic target was not found for the authenticated owner' USING ERRCODE = 'P0002';",
    '  END IF;',
    `  IF ${quoteIdentifier('current_version')} IS DISTINCT FROM ${expectedVersion} THEN`,
    "    RAISE EXCEPTION 'OpenPencil atomic version conflict' USING ERRCODE = '40001';",
    '  END IF;',
    '',
    `  UPDATE ${tablePath} AS ${quoteIdentifier('target_row')}`,
    '  SET',
    updateAssignments.join(',\n'),
    '  WHERE TRUE',
    ...primaryKeyPredicates,
    `    AND ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.ownerField)} = ${quoteIdentifier('current_user_id')}`,
    `    AND ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.versionField)} = ${expectedVersion}`,
    `  RETURNING ${quoteIdentifier('target_row')}.${quoteIdentifier(transaction.versionField)}`,
    `  INTO ${quoteIdentifier('updated_version')};`,
    `  GET DIAGNOSTICS ${quoteIdentifier('affected_rows')} = ROW_COUNT;`,
    `  IF ${quoteIdentifier('affected_rows')} <> 1 OR ${quoteIdentifier('updated_version')} IS NULL OR ${quoteIdentifier('updated_version')} IS DISTINCT FROM ${expectedVersion} + 1 THEN`,
    "    RAISE EXCEPTION 'OpenPencil atomic update lost its version race' USING ERRCODE = '40001';",
    '  END IF;',
    `  IF ${quoteIdentifier('updated_version')} > ${MAX_SAFE_INTEGER} THEN`,
    "    RAISE EXCEPTION 'OpenPencil updated version is outside the safe integer range' USING ERRCODE = '22003';",
    '  END IF;',
    '',
    `  RETURN ${qualified('pg_catalog', 'jsonb_build_object')}(`,
    `    'entityId', ${quoteLiteral(transaction.entityId)},`,
    `    'primaryKey', ${qualified('pg_catalog', 'jsonb_build_object')}(${primaryKeyResult.join(', ')}),`,
    `    'newVersion', ${qualified('pg_catalog', 'to_jsonb')}(${quoteIdentifier('updated_version')})`,
    '  );',
    'END;',
    '$openpencil$;',
    `REVOKE ALL ON FUNCTION ${functionPath}(${signature}) FROM PUBLIC, ${quoteIdentifier('anon')}, ${quoteIdentifier('authenticated')}, ${quoteIdentifier('service_role')};`,
    `GRANT EXECUTE ON FUNCTION ${functionPath}(${signature}) TO ${quoteIdentifier('authenticated')};`,
    '',
    'DO $openpencil_acl$',
    'DECLARE',
    `  ${quoteIdentifier('target_oid')} ${qualified('pg_catalog', 'oid')};`,
    `  ${quoteIdentifier('owner_oid')} ${qualified('pg_catalog', 'oid')};`,
    `  ${quoteIdentifier('authenticated_oid')} ${qualified('pg_catalog', 'oid')};`,
    'BEGIN',
    `  SELECT ${quoteIdentifier('managed_function')}.${quoteIdentifier('oid')}, ${quoteIdentifier('managed_function')}.${quoteIdentifier('proowner')}`,
    `  INTO ${quoteIdentifier('target_oid')}, ${quoteIdentifier('owner_oid')}`,
    `  FROM ${qualified('pg_catalog', 'pg_proc')} AS ${quoteIdentifier('managed_function')}`,
    `  JOIN ${qualified('pg_catalog', 'pg_namespace')} AS ${quoteIdentifier('managed_namespace')}`,
    `    ON ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('oid')} = ${quoteIdentifier('managed_function')}.${quoteIdentifier('pronamespace')}`,
    `  WHERE ${quoteIdentifier('managed_namespace')}.${quoteIdentifier('nspname')} = 'public'`,
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('proname')} = ${quoteLiteral(transaction.functionName)}`,
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('prokind')} = 'f'`,
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('provolatile')} = 'v'`,
    `    AND NOT ${quoteIdentifier('managed_function')}.${quoteIdentifier('prosecdef')}`,
    `    AND NOT ${quoteIdentifier('managed_function')}.${quoteIdentifier('proretset')}`,
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('prorettype')} = ${qualified('pg_catalog', 'to_regtype')}('pg_catalog.jsonb')`,
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('prolang')} = (`,
    `      SELECT ${quoteIdentifier('managed_language')}.${quoteIdentifier('oid')}`,
    `      FROM ${qualified('pg_catalog', 'pg_language')} AS ${quoteIdentifier('managed_language')}`,
    `      WHERE ${quoteIdentifier('managed_language')}.${quoteIdentifier('lanname')} = 'plpgsql'`,
    '    )',
    `    AND ${quoteIdentifier('managed_function')}.${quoteIdentifier('pronargs')} = ${transaction.parameters.length}`,
    ...argumentTypeChecks,
    `    AND ${qualified('pg_catalog', 'cardinality')}(${quoteIdentifier('managed_function')}.${quoteIdentifier('proconfig')}) = 2`,
    `    AND ${qualified('pg_catalog', 'array_position')}(${quoteIdentifier('managed_function')}.${quoteIdentifier('proconfig')}, 'default_transaction_isolation=serializable') IS NOT NULL`,
    '    AND (',
    `      ${qualified('pg_catalog', 'array_position')}(${quoteIdentifier('managed_function')}.${quoteIdentifier('proconfig')}, 'search_path=') IS NOT NULL`,
    `      OR ${qualified('pg_catalog', 'array_position')}(${quoteIdentifier('managed_function')}.${quoteIdentifier('proconfig')}, 'search_path=""') IS NOT NULL`,
    '    );',
    `  SELECT ${quoteIdentifier('role_entry')}.${quoteIdentifier('oid')}`,
    `  INTO ${quoteIdentifier('authenticated_oid')}`,
    `  FROM ${qualified('pg_catalog', 'pg_roles')} AS ${quoteIdentifier('role_entry')}`,
    `  WHERE ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolname')} = 'authenticated'`,
    `    AND NOT ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolsuper')}`,
    `    AND NOT ${quoteIdentifier('role_entry')}.${quoteIdentifier('rolbypassrls')};`,
    `  IF ${quoteIdentifier('target_oid')} IS NULL OR ${quoteIdentifier('authenticated_oid')} IS NULL OR ${qualified('pg_catalog', 'pg_get_userbyid')}(${quoteIdentifier('owner_oid')}) <> CURRENT_USER THEN`,
    "    RAISE EXCEPTION 'OpenPencil atomic RPC owner or invoker authority verification failed';",
    '  END IF;',
    '  IF NOT EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_proc')} AS ${quoteIdentifier('managed_function')}`,
    `    CROSS JOIN LATERAL ${qualified('pg_catalog', 'aclexplode')}(`,
    `      COALESCE(${quoteIdentifier('managed_function')}.${quoteIdentifier('proacl')}, ${qualified('pg_catalog', 'acldefault')}('f', ${quoteIdentifier('managed_function')}.${quoteIdentifier('proowner')}))`,
    `    ) AS ${quoteIdentifier('function_acl')}`,
    `    WHERE ${quoteIdentifier('managed_function')}.${quoteIdentifier('oid')} = ${quoteIdentifier('target_oid')}`,
    `      AND ${quoteIdentifier('function_acl')}.${quoteIdentifier('grantee')} = ${quoteIdentifier('authenticated_oid')}`,
    `      AND ${quoteIdentifier('function_acl')}.${quoteIdentifier('privilege_type')} = 'EXECUTE'`,
    `      AND NOT ${quoteIdentifier('function_acl')}.${quoteIdentifier('is_grantable')}`,
    '  ) OR EXISTS (',
    '    SELECT 1',
    `    FROM ${qualified('pg_catalog', 'pg_proc')} AS ${quoteIdentifier('managed_function')}`,
    `    CROSS JOIN LATERAL ${qualified('pg_catalog', 'aclexplode')}(`,
    `      COALESCE(${quoteIdentifier('managed_function')}.${quoteIdentifier('proacl')}, ${qualified('pg_catalog', 'acldefault')}('f', ${quoteIdentifier('managed_function')}.${quoteIdentifier('proowner')}))`,
    `    ) AS ${quoteIdentifier('function_acl')}`,
    `    WHERE ${quoteIdentifier('managed_function')}.${quoteIdentifier('oid')} = ${quoteIdentifier('target_oid')}`,
    `      AND ${quoteIdentifier('function_acl')}.${quoteIdentifier('privilege_type')} = 'EXECUTE'`,
    `      AND ${quoteIdentifier('function_acl')}.${quoteIdentifier('grantee')} NOT IN (${quoteIdentifier('owner_oid')}, ${quoteIdentifier('authenticated_oid')})`,
    '  ) THEN',
    "    RAISE EXCEPTION 'OpenPencil atomic RPC ACL verification failed';",
    '  END IF;',
    'END;',
    '$openpencil_acl$;',
    `NOTIFY ${quoteIdentifier('pgrst')}, 'reload schema';`,
    'COMMIT;'
  ]
  return `${lines.join('\n').trimEnd()}\n`
}
