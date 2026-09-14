import { BACKEND_LIMITS } from '../limits'
import {
  boundedText,
  diagnostic,
  id,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from '../validation-helpers'
import {
  BACKEND_MODULE_IR_VERSION,
  type BackendModuleDefinitionIR,
  type BackendModuleIRV1
} from './types'

function moduleId(
  value: unknown,
  path: string,
  context: BackendValidationContext
): string | undefined {
  if (typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value)) return value
  diagnostic(
    context,
    'backend-module-invalid',
    path,
    'Module IDs require a lowercase letter followed by at most 47 lowercase letters, digits or hyphens.'
  )
  return undefined
}

function moduleDefinition(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendModuleDefinitionIR | undefined {
  const source = record(value, path, context, [
    'id',
    'name',
    'entityIds',
    'resourceIds',
    'commandIds',
    'dependsOn'
  ])
  if (!source) return undefined
  const module = moduleId(source.id, path + '.id', context)
  const name = boundedText(source.name, path + '.name', context, 128)
  const entityIds = parseArrayItems(
    source.entityIds,
    path + '.entityIds',
    context,
    BACKEND_LIMITS.maxEntities,
    id
  )
  const resourceIds = parseArrayItems(
    source.resourceIds,
    path + '.resourceIds',
    context,
    BACKEND_LIMITS.maxHttpApiResources,
    id
  )
  const commandIds = parseArrayItems(source.commandIds, path + '.commandIds', context, 16, id)
  const dependsOn = parseArrayItems(source.dependsOn, path + '.dependsOn', context, 16, moduleId)
  for (const [key, entries] of Object.entries({ entityIds, resourceIds, commandIds, dependsOn }))
    if (entries) uniqueBy(entries, path + '.' + key, context, 'module reference')
  if (!entityIds?.length)
    diagnostic(
      context,
      'backend-module-invalid',
      path + '.entityIds',
      'A module must own at least one entity.'
    )
  if (!module || !name || !entityIds || !resourceIds || !commandIds || !dependsOn) return undefined
  return {
    id: module,
    name,
    entityIds: sorted(entityIds, String),
    resourceIds: sorted(resourceIds, String),
    commandIds: sorted(commandIds, String),
    dependsOn: sorted(dependsOn, String)
  }
}

export function parseBackendModuleIRV1(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendModuleIRV1 | undefined {
  const start = context.diagnostics.length
  const source = record(value, path, context, ['version', 'modules'])
  if (!source) return undefined
  if (source.version !== BACKEND_MODULE_IR_VERSION)
    diagnostic(
      context,
      'backend-module-invalid',
      path + '.version',
      'Unsupported module contract version.'
    )
  const modules = parseArrayItems(source.modules, path + '.modules', context, 16, moduleDefinition)
  if (!modules?.length)
    diagnostic(
      context,
      'backend-module-invalid',
      path + '.modules',
      'Omit modules when no module partition is declared.'
    )
  if (modules)
    uniqueBy(
      modules.map((module) => module.id),
      path + '.modules',
      context,
      'module id'
    )
  if (!modules || context.diagnostics.slice(start).some((entry) => entry.severity === 'error'))
    return undefined
  return { version: BACKEND_MODULE_IR_VERSION, modules: sorted(modules, (module) => module.id) }
}
