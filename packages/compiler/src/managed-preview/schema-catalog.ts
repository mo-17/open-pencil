import { nestJSConstraintName } from '#compiler/backend/nestjs/schema-names'

import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

function fieldNames(entity: DataEntityIR, ids: readonly string[]): string[] {
  return ids.map((id) => {
    const field = entity.fields.find((entry) => entry.id === id)
    if (!field) throw new Error('Missing managed catalog field.')
    return field.name
  })
}

export function managedModelCatalog(
  application: BackendApplicationSpecV1,
  entity: DataEntityIR,
  includeEnums: boolean
) {
  const primaryKey = fieldNames(entity, entity.primaryKey?.fields ?? [])
  const owner = application.auth.ownership.find((entry) => entry.entityId === entity.id)
  if (!owner) throw new Error('Missing managed catalog owner.')
  const unique = (entity.uniques ?? []).map((entry) => ({
    name: nestJSConstraintName(entity, 'uq', entry.id),
    columns: fieldNames(entity, entry.fields)
  }))
  return {
    enums: includeEnums
      ? application.dataModel.enums.map((entry) => ({
          name: entry.name,
          labels: entry.values
        }))
      : [],
    constraints: [
      { name: entity.name + '_pkey', kind: 'p', columns: primaryKey },
      ...unique.map((entry) => ({ ...entry, kind: 'u' })),
      ...(entity.foreignKeys ?? []).map((entry) => {
        const target = application.dataModel.entities.find(
          (candidate) => candidate.id === entry.targetEntityId
        )
        if (!target) throw new Error('Missing managed foreign key target.')
        return {
          name: nestJSConstraintName(entity, 'fk', entry.id),
          kind: 'f',
          columns: fieldNames(entity, entry.fields),
          targetTable: target.name,
          targetColumns: fieldNames(target, entry.targetFields),
          deleteAction: entry.onDelete === 'restrict' ? 'r' : 'a'
        }
      })
    ],
    indexes: [
      {
        name: entity.name + '_pkey',
        columns: primaryKey,
        unique: true,
        primary: true,
        options: primaryKey.map(() => 0)
      },
      {
        name: entity.name + '_owner_page_idx',
        columns: [...fieldNames(entity, [owner.identityFieldId]), ...primaryKey],
        unique: false,
        primary: false,
        options: [0, 0]
      },
      ...unique.map((entry) => ({
        ...entry,
        unique: true,
        primary: false,
        options: entry.columns.map(() => 0)
      })),
      ...(entity.indexes ?? []).map((entry) => ({
        name: nestJSConstraintName(entity, 'idx', entry.id),
        columns: fieldNames(entity, entry.fields),
        unique: false,
        primary: false,
        options: entry.fields.map(() => (entry.order === 'desc' ? 3 : 0))
      }))
    ]
  }
}
