import { nestJSArtifact, sqlIdentifier } from '../artifact'
import type { NestJSResource } from '../model'
import { LIST_SQL_SOURCE } from './sql'
import { LIST_VALIDATION_SOURCE } from './validation'

export function nestJSQuerySpec(model: NestJSResource) {
  const fields = (ids: readonly string[]) =>
    ids.map((id) => {
      const field = model.entity.fields.find((entry) => entry.id === id)
      if (!field) throw new Error('Missing validated query field.')
      const values = field.enumId
        ? model.dataModel.enums.find((entry) => entry.id === field.enumId)?.values
        : undefined
      return {
        id,
        column: sqlIdentifier(field.name),
        type: field.type,
        nullable: field.nullable,
        ...(values ? { values } : {})
      }
    })
  return {
    filterFields: fields(model.resource.query?.filterFields ?? []),
    searchFields: fields(model.resource.query?.searchFields ?? []),
    sortFields: fields(model.resource.query?.sortFields ?? [])
  }
}

export function emitNestJSListQuery() {
  return nestJSArtifact('src/list-query.ts', LIST_VALIDATION_SOURCE + LIST_SQL_SOURCE)
}
