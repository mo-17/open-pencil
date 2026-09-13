import type { BackendApplicationSpecV1, MigrationOperation } from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'
import { nestJSEntitySchemaStatements, nestJSFieldSQL } from '../schema'
import type { NestJSLocalPreviewMigrationOperation } from './types'

function table(name: string): string {
  return sqlIdentifier('public') + '.' + sqlIdentifier(name)
}

/** The shared diff identifies changes; only these four reviewed operation kinds may produce SQL. */
export function emitLocalMigrationOperation(
  operation: MigrationOperation,
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): NestJSLocalPreviewMigrationOperation | undefined {
  if (operation.kind === 'create-entity') {
    return {
      id: operation.id,
      kind: operation.kind,
      entityId: operation.entity.id,
      summary: 'Create table ' + operation.entity.name + ' with owner access index.',
      risk: 'low',
      sql: nestJSEntitySchemaStatements(to, operation.entity).join('\n')
    }
  }
  if (!('entityId' in operation)) return undefined
  const current = from.dataModel.entities.find((entry) => entry.id === operation.entityId)
  const target = to.dataModel.entities.find((entry) => entry.id === operation.entityId)
  if (!current || !target) return undefined
  if (operation.kind === 'rename-entity') {
    const name = operation.nextName
    return {
      id: operation.id,
      kind: operation.kind,
      entityId: operation.entityId,
      summary: 'Rename table ' + current.name + ' to ' + name + ' and preserve its rows.',
      risk: 'medium',
      sql: [
        'ALTER TABLE ' + table(current.name) + ' RENAME TO ' + sqlIdentifier(name) + ';',
        'ALTER TABLE ' +
          table(name) +
          ' RENAME CONSTRAINT ' +
          sqlIdentifier(current.name + '_pkey') +
          ' TO ' +
          sqlIdentifier(name + '_pkey') +
          ';',
        'ALTER INDEX ' +
          table(current.name + '_owner_page_idx') +
          ' RENAME TO ' +
          sqlIdentifier(name + '_owner_page_idx') +
          ';'
      ].join('\n')
    }
  }
  if (operation.kind === 'rename-field') {
    const field = current.fields.find((entry) => entry.id === operation.fieldId)
    if (!field) return undefined
    return {
      id: operation.id,
      kind: operation.kind,
      entityId: operation.entityId,
      fieldId: operation.fieldId,
      summary:
        'Rename column ' +
        target.name +
        '.' +
        field.name +
        ' to ' +
        operation.nextName +
        ' and preserve its values.',
      risk: 'medium',
      sql:
        'ALTER TABLE ' +
        table(target.name) +
        ' RENAME COLUMN ' +
        sqlIdentifier(field.name) +
        ' TO ' +
        sqlIdentifier(operation.nextName) +
        ';'
    }
  }
  if (
    operation.kind === 'add-field' &&
    (operation.field.nullable || operation.field.default?.kind === 'literal')
  ) {
    const withDefault = operation.field.default?.kind === 'literal'
    return {
      id: operation.id,
      kind: operation.kind,
      entityId: operation.entityId,
      fieldId: operation.field.id,
      summary:
        'Add column ' +
        target.name +
        '.' +
        operation.field.name +
        (withDefault ? ' with a literal default.' : ' accepting null for existing rows.'),
      risk: withDefault ? 'medium' : 'low',
      sql:
        'ALTER TABLE ' +
        table(target.name) +
        ' ADD COLUMN ' +
        nestJSFieldSQL(operation.field, to.dataModel) +
        ';'
    }
  }
  return undefined
}
