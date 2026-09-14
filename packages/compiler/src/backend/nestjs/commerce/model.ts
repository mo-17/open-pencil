import {
  commerceOperationEntityKey,
  type BackendApplicationSpecV1,
  type BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'
import { nestJSReadColumn } from '../schema-fields'

/** Semantic fields are compiled into trusted identifiers; documents never supply SQL. */
export function nestJSCommerceModel(application: BackendApplicationSpecV1) {
  const commerce = application.commerce
  if (!commerce) throw new Error('Missing validated commerce contract.')
  const tables = Object.fromEntries(
    Object.entries(commerce.entities).map(([key, id]) => {
      const entity = application.dataModel.entities.find((entry) => entry.id === id)
      if (!entity) throw new Error('Missing validated commerce entity.')
      return [
        key,
        {
          table: sqlIdentifier('public') + '.' + sqlIdentifier(entity.name),
          columns: Object.fromEntries(
            entity.fields.map((field) => [field.id, sqlIdentifier(field.name)])
          ),
          projection: entity.fields
            .map((field) => nestJSReadColumn(field) + ' AS ' + sqlIdentifier(field.id))
            .join(', ')
        }
      ]
    })
  )
  return { applicationId: application.applicationId, ...commerce, tables }
}

export function nestJSCommandResultEntity(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
) {
  const result = command.steps.find(
    (step) => step.kind !== 'assert' && step.resultName === command.return.resultName
  )
  const sourceEntityId = result && result.kind !== 'assert' ? result.entityId : undefined
  const id =
    command.commerceOperation && application.commerce
      ? application.commerce.entities[commerceOperationEntityKey(command.commerceOperation)]
      : sourceEntityId
  const entity = application.dataModel.entities.find((entry) => entry.id === id)
  if (!entity) throw new Error('Missing validated command return entity.')
  return entity
}

export function commerceAffectedEntities(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): string[] {
  if (!command.commerceOperation || !application.commerce) return []
  // Every commerce write may also complete a cross-resource business transition.
  // The closed ten-table set keeps cache invalidation bounded and complete.
  return Object.values(application.commerce.entities)
}
