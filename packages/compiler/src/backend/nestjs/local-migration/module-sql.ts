import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { nestJSModelSchemaStatements } from '../schema'
import type { NestJSLocalPreviewMigrationOperation } from './types'

/** The caller must pass the strict module-addition boundary before invoking this emitter. */
export function emitModuleSchemaAddition(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): NestJSLocalPreviewMigrationOperation {
  const entityIds = to.dataModel.entities
    .filter((entity) => !from.dataModel.entities.some((entry) => entry.id === entity.id))
    .map((entry) => entry.id)
  const enumIds = to.dataModel.enums
    .filter((entity) => !from.dataModel.enums.some((entry) => entry.id === entity.id))
    .map((entry) => entry.id)
  const moduleIds = (to.modules?.modules ?? [])
    .filter((module) => module.entityIds.some((id) => entityIds.includes(id)))
    .map((module) => module.id)
  return {
    id: 'add-module-schema',
    kind: 'add-module-schema',
    entityIds,
    enumIds,
    moduleIds,
    summary:
      'Add ' +
      entityIds.length +
      ' module tables and ' +
      enumIds.length +
      ' enum types with their reviewed indexes and foreign keys. Existing rows and ledgers remain unchanged.',
    risk: 'medium',
    sql: nestJSModelSchemaStatements(to, entityIds, enumIds).join('\n\n')
  }
}
