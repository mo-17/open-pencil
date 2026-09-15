import type { DataEntityIR } from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from './artifact'
import { nestJSReadColumn } from './schema-fields'

/** Map validated entity fields to quoted identifiers and scalar-safe SQL projections. */
export function nestJSEntitySQL(entity: DataEntityIR) {
  return {
    table: sqlIdentifier('public') + '.' + sqlIdentifier(entity.name),
    columns: Object.fromEntries(
      entity.fields.map((field) => [field.id, sqlIdentifier(field.name)])
    ),
    projection: entity.fields
      .map((field) => nestJSReadColumn(field) + ' AS ' + sqlIdentifier(field.id))
      .join(', ')
  }
}
