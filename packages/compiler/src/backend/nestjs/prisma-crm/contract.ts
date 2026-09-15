import type { BackendArtifactSource } from '#compiler/backend/contracts'

import type {
  BackendApplicationSpecV1,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { nestJSArtifact } from '../artifact'
import { managedCommandLedgerSchema } from '../commands/ledger'
import { nestJSConstraintName } from '../schema-names'
import { validatePrismaCRMApplication } from './profile'

const MODEL_NAMES: Readonly<Record<string, string>> = {
  'business-customers': 'Customer',
  'business-customer-history': 'CustomerHistory',
  'business-users': 'User'
}

function fieldType(application: BackendApplicationSpecV1, field: DataFieldIR): string {
  if (field.type === 'enum') {
    const dataEnum = application.dataModel.enums.find((entry) => entry.id === field.enumId)
    if (!dataEnum) throw new Error('Missing validated Prisma CRM enum.')
    return 'pg.enum(' + dataEnum.name + ')'
  }
  const scalar = {
    uuid: 'Uuid',
    string: 'String',
    integer: 'Int',
    boolean: 'Boolean',
    datetime: 'TimestamptzString'
  }
  if (!(field.type in scalar)) throw new Error('Unsupported Prisma CRM scalar.')
  return scalar[field.type as keyof typeof scalar]
}

function fieldDefault(field: DataFieldIR): string {
  const value = field.default
  if (!value) return ''
  if (value.kind === 'literal') return ' @default(' + JSON.stringify(value.value) + ')'
  if (value.generator === 'uuid') return ' @default(dbgenerated("pg_catalog.gen_random_uuid()"))'
  if (value.generator === 'created-at') return ' @default(now())'
  throw new Error('Unsupported Prisma CRM default.')
}

function model(application: BackendApplicationSpecV1, entity: DataEntityIR): string {
  const lines = [...entity.fields]
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
    .map((field) => {
      const unique = entity.uniques?.find(
        (entry) => entry.fields.length === 1 && entry.fields[0] === field.id
      )
      return (
        '  ' +
        field.id +
        ' ' +
        fieldType(application, field) +
        (field.nullable ? '?' : '') +
        (entity.primaryKey?.fields.includes(field.id) ? ' @id' : '') +
        fieldDefault(field) +
        (unique
          ? ' @unique(map: ' + JSON.stringify(nestJSConstraintName(entity, 'uq', unique.id)) + ')'
          : '')
      )
    })
  for (const reference of entity.foreignKeys ?? []) {
    lines.push(
      '  customer ' +
        MODEL_NAMES[reference.targetEntityId] +
        ' @relation(fields: [' +
        reference.fields.join(', ') +
        '], references: [' +
        reference.targetFields.join(', ') +
        '], onDelete: Restrict, map: ' +
        JSON.stringify(nestJSConstraintName(entity, 'fk', reference.id)) +
        ')'
    )
  }
  if (entity.id === 'business-customers') lines.push('  history CustomerHistory[]')
  for (const unique of [...(entity.uniques ?? [])].sort((a, b) => a.id.localeCompare(b.id, 'en'))) {
    if (unique.fields.length === 1) continue
    lines.push(
      '  @@unique([' +
        unique.fields.join(', ') +
        '], map: ' +
        JSON.stringify(nestJSConstraintName(entity, 'uq', unique.id)) +
        ')'
    )
  }
  lines.push('  @@map(' + JSON.stringify(entity.name) + ')')
  return 'model ' + MODEL_NAMES[entity.id] + ' {\n' + lines.join('\n') + '\n}'
}

function commandLedger(): string {
  const ledger = managedCommandLedgerSchema()
  const lines = ledger.columns.map(
    (column) =>
      '  ' +
      column.name +
      ' ' +
      (column.type === 'uuid' ? 'Uuid' : 'String') +
      (column.nullable ? '?' : '')
  )
  lines.push('  @@id([' + ledger.catalog.constraints[0].columns.join(', ') + '])')
  lines.push('  @@map(' + JSON.stringify(ledger.name) + ')')
  return 'model CommandRequest {\n' + lines.join('\n') + '\n}'
}

/** Query mapping only. SQL migrations remain the sole schema owner, including secondary indexes. */
export function emitPrismaCRMContract(
  application: BackendApplicationSpecV1
): BackendArtifactSource {
  if (
    validatePrismaCRMApplication(application).some((diagnostic) => diagnostic.severity === 'error')
  )
    throw new Error('Cannot emit an unsupported Prisma CRM query contract.')
  const enums = application.dataModel.enums.map(
    (entry) =>
      'native_enum ' +
      entry.name +
      ' {\n' +
      entry.values.map((value) => '  ' + value + ' = ' + JSON.stringify(value)).join('\n') +
      '\n}'
  )
  const models = Object.keys(MODEL_NAMES).map((id) => {
    const entity = application.dataModel.entities.find((entry) => entry.id === id)
    if (!entity) throw new Error('Missing validated Prisma CRM entity.')
    return model(application, entity)
  })
  return nestJSArtifact(
    'src/prisma/contract.prisma',
    [
      '// use prisma-8',
      '// Experimental ORM view of the SQL-owned CRM schema. Do not apply Prisma DDL.',
      '// Secondary indexes remain solely in migrations/001-initial.sql; this is not a migration contract.',
      [
        ...enums,
        ...models,
        ...(application.commands?.commands.length ? [commandLedger()] : [])
      ].join('\n\n')
    ].join('\n') + '\n'
  )
}
