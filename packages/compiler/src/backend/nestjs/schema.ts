import type {
  BackendApplicationSpecV1,
  DataEntityIR,
  DataFieldIR,
  DataModelIR
} from '@open-pencil/lowcode/backend'

import { nestJSArtifact, nestJSJSONArtifact, sqlIdentifier } from './artifact'
import { nestJSCommandLedgerSQL } from './commands/ledger'
import { nestJSCommerceLedgerSQL } from './commerce/ledger'
import { nestJSEnum } from './schema-fields'
import { nestJSConstraintName } from './schema-names'

function sqlLiteral(value: string | number | boolean | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return "'" + value.replaceAll("'", "''") + "'"
  return String(value)
}

export function nestJSFieldSQL(field: DataFieldIR, model: DataModelIR): string {
  const types = {
    string: 'text',
    uuid: 'uuid',
    integer: 'integer',
    number: 'double precision',
    boolean: 'boolean',
    date: 'date',
    datetime: 'timestamp with time zone'
  }
  const type =
    field.type === 'enum'
      ? sqlIdentifier('public') + '.' + sqlIdentifier(nestJSEnum(field, model).name)
      : types[field.type as keyof typeof types]
  if (!type) throw new Error('Unsupported validated PostgreSQL field.')
  let result = sqlIdentifier(field.name) + ' ' + type + (field.nullable ? '' : ' NOT NULL')
  if (field.default?.kind === 'generated')
    result +=
      field.default.generator === 'created-at'
        ? ' DEFAULT CURRENT_TIMESTAMP'
        : ' DEFAULT pg_catalog.gen_random_uuid()'
  if (field.default?.kind === 'literal') {
    const value = field.default.value
    result += ' DEFAULT ' + sqlLiteral(value)
  }
  return result
}

/** Shared by initial export and the bounded local-preview migration planner. */
export function nestJSEntitySchemaStatements(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR
): string[] {
  const primaryKey = entity.fields.find((field) => entity.primaryKey?.fields[0] === field.id)
  const ownership = application.auth.ownership.find((entry) => entry.entityId === entity.id)
  const owner = entity.fields.find((field) => field.id === ownership?.identityFieldId)
  if (!primaryKey || !owner) throw new Error('Missing validated ownership or primary key.')
  const table = sqlIdentifier('public') + '.' + sqlIdentifier(entity.name)
  const fields = entity.fields.map((field) => '  ' + nestJSFieldSQL(field, application.dataModel))
  fields.push('  PRIMARY KEY (' + sqlIdentifier(primaryKey.name) + ')')
  return [
    'CREATE TABLE ' + table + ' (\n' + fields.join(',\n') + '\n);',
    'CREATE INDEX ' +
      sqlIdentifier(entity.name + '_owner_page_idx') +
      ' ON ' +
      table +
      ' (' +
      sqlIdentifier(owner.name) +
      ', ' +
      sqlIdentifier(primaryKey.name) +
      ');'
  ]
}

function fieldNames(entity: DataEntityIR, ids: readonly string[]): string {
  return ids
    .map((id) => {
      const field = entity.fields.find((entry) => entry.id === id)
      if (!field) throw new Error('Missing validated constraint field.')
      return sqlIdentifier(field.name)
    })
    .join(', ')
}

function table(entity: DataEntityIR): string {
  return sqlIdentifier('public') + '.' + sqlIdentifier(entity.name)
}

function uniqueAndIndexStatements(entity: DataEntityIR): string[] {
  return [
    ...(entity.uniques ?? []).map(
      (entry) =>
        'ALTER TABLE ' +
        table(entity) +
        ' ADD CONSTRAINT ' +
        sqlIdentifier(nestJSConstraintName(entity, 'uq', entry.id)) +
        ' UNIQUE (' +
        fieldNames(entity, entry.fields) +
        ');'
    ),
    ...(entity.indexes ?? []).map(
      (entry) =>
        'CREATE INDEX ' +
        sqlIdentifier(nestJSConstraintName(entity, 'idx', entry.id)) +
        ' ON ' +
        table(entity) +
        ' (' +
        entry.fields
          .map((id) => fieldNames(entity, [id]) + ' ' + (entry.order === 'desc' ? 'DESC' : 'ASC'))
          .join(', ') +
        ');'
    )
  ]
}

function foreignKeyStatements(model: DataModelIR, entity: DataEntityIR): string[] {
  return (entity.foreignKeys ?? []).map((entry) => {
    const target = model.entities.find((candidate) => candidate.id === entry.targetEntityId)
    if (!target) throw new Error('Missing validated foreign key target.')
    return (
      'ALTER TABLE ' +
      table(entity) +
      ' ADD CONSTRAINT ' +
      sqlIdentifier(nestJSConstraintName(entity, 'fk', entry.id)) +
      ' FOREIGN KEY (' +
      fieldNames(entity, entry.fields) +
      ') REFERENCES ' +
      table(target) +
      ' (' +
      fieldNames(target, entry.targetFields) +
      ') ON DELETE ' +
      (entry.onDelete === 'restrict' ? 'RESTRICT' : 'NO ACTION') +
      ';'
    )
  })
}

/** Builds only the selected model objects; caller must validate additive migration authority. */
export function nestJSModelSchemaStatements(
  application: BackendApplicationSpecV1,
  entityIds: readonly string[],
  enumIds: readonly string[]
): string[] {
  const model = application.dataModel
  const entities = model.entities.filter((entity) => entityIds.includes(entity.id))
  const enums = model.enums.filter((entry) => enumIds.includes(entry.id))
  if (
    new Set(entityIds).size !== entityIds.length ||
    new Set(enumIds).size !== enumIds.length ||
    entities.length !== entityIds.length ||
    enums.length !== enumIds.length
  )
    throw new Error('Schema selection must name unique validated model objects.')
  return [
    ...enums.map(
      (entry) =>
        'CREATE TYPE ' +
        sqlIdentifier('public') +
        '.' +
        sqlIdentifier(entry.name) +
        ' AS ENUM (' +
        entry.values.map(sqlLiteral).join(', ') +
        ');'
    ),
    ...entities.flatMap((entity) => nestJSEntitySchemaStatements(application, entity)),
    ...entities.flatMap(uniqueAndIndexStatements),
    ...entities.flatMap((entity) => foreignKeyStatements(model, entity))
  ]
}

export function emitNestJSSchema(application: BackendApplicationSpecV1) {
  const model = application.dataModel
  const statements = [
    ...nestJSModelSchemaStatements(
      application,
      model.entities.map((entity) => entity.id),
      model.enums.map((entry) => entry.id)
    ),
    ...(application.commands?.commands.length ? [nestJSCommandLedgerSQL()] : []),
    ...(application.commerce ? nestJSCommerceLedgerSQL() : [])
  ]
  const sql =
    '-- Review-only initial schema for fresh tables. Never executed by the generator or application.\n' +
    'BEGIN;\nSET LOCAL standard_conforming_strings = on;\n\n' +
    statements.join('\n\n') +
    '\n\nCOMMIT;\n'
  return [
    nestJSArtifact('migrations/001-initial.sql', sql, 'migration-plan', 'application/sql'),
    nestJSJSONArtifact('database-schema.json', application.dataModel, 'database-schema'),
    nestJSJSONArtifact(
      'security-policy.json',
      {
        version: 1,
        enforcement: 'server-explicit-policy-predicates',
        databaseRLS: false,
        identity: 'verified-jwt-sub-uuid',
        roleClaim: 'verified-jwt-top-level-openpencil_roles',
        policyCombination: application.auth.tenants.length
          ? 'OR-of-explicit-owner-role-tenant-and-select-only-anonymous-grants-with-AND-tenant-role'
          : 'OR-of-explicit-owner-role-and-select-only-anonymous-grants',
        policies: application.auth.rowAccess,
        ownership: application.auth.ownership,
        ...(application.auth.tenants.length ? { tenants: application.auth.tenants } : {}),
        ...(application.httpApi?.resources.some((resource) => resource.readPolicyIds)
          ? {
              resourceReadPolicies: application.httpApi.resources
                .filter((resource) => resource.readPolicyIds)
                .map((resource) => ({ resourceId: resource.id, policyIds: resource.readPolicyIds }))
            }
          : {}),
        ...(application.commands?.commands.length
          ? {
              commands: application.commands,
              commandEnforcement: application.auth.tenants.length
                ? 'verified-caller-and-locked-membership-before-ledger-with-bound-tenant-reads'
                : 'explicit-command-steps-with-owner-scope-and-verified-caller',
              commandIdempotency: 'same-transaction-ledger-bound-to-application-command-subject-key'
            }
          : {}),
        ...(application.commerce
          ? {
              commerce: application.commerce,
              commercePayments: 'development-simulator-only-no-real-gateway',
              commerceLedger: 'append-only-business-effects'
            }
          : {}),
        invariants: [
          'server-injected-create-owner',
          'operation-requires-an-explicit-policy-grant',
          'owner-policies-filter-by-verified-subject',
          'role-grants-match-declared-role-ids-in-verified-claim',
          'anonymous-grants-allow-select-only',
          'invalid-supplied-tokens-never-fall-back-to-anonymous',
          'writes-never-change-existing-owner'
        ],
        applied: false,
        releaseReady: false
      },
      'security-policy'
    )
  ]
}
