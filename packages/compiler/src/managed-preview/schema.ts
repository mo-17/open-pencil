import { managedCommandLedgerSchema } from '#compiler/backend/nestjs/commands/ledger'
import { nestJSEnum } from '#compiler/backend/nestjs/schema-fields'
import { nestJSConstraintName } from '#compiler/backend/nestjs/schema-names'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { managedModelCatalog } from './schema-catalog'

/** Closed catalog projection computed by the host; never accepted from the renderer. */
export function managedSchema(application: BackendApplicationSpecV1) {
  const types = {
    string: 'text',
    uuid: 'uuid',
    integer: 'int4',
    number: 'float8',
    boolean: 'bool',
    date: 'date',
    datetime: 'timestamptz'
  }
  const extended =
    (application.commands?.commands.length ?? 0) > 0 ||
    application.dataModel.enums.length > 0 ||
    application.dataModel.entities.some(
      (entity) =>
        (entity.uniques?.length ?? 0) +
          (entity.indexes?.length ?? 0) +
          (entity.foreignKeys?.length ?? 0) >
        0
    )
  const tables = application.dataModel.entities.map((entity, index) => ({
    name: entity.name,
    columns: entity.fields.map((field) => {
      const type =
        field.type === 'enum'
          ? nestJSEnum(field, application.dataModel).name
          : types[field.type as keyof typeof types]
      if (!type) throw new Error('Managed schema field type is unsupported.')
      return { name: field.name, type, nullable: field.nullable }
    }),
    indexes: [
      entity.name + '_pkey',
      entity.name + '_owner_page_idx',
      ...(entity.uniques ?? []).map((entry) => nestJSConstraintName(entity, 'uq', entry.id)),
      ...(entity.indexes ?? []).map((entry) => nestJSConstraintName(entity, 'idx', entry.id))
    ],
    constraints: [
      entity.name + '_pkey',
      ...(entity.uniques ?? []).map((entry) => nestJSConstraintName(entity, 'uq', entry.id)),
      ...(entity.foreignKeys ?? []).map((entry) => nestJSConstraintName(entity, 'fk', entry.id))
    ],
    ...(extended ? { catalog: managedModelCatalog(application, entity, index === 0) } : {})
  }))
  if (application.commands?.commands.length) tables.push(managedCommandLedgerSchema())
  return tables
}
