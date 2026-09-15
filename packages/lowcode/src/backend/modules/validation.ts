import { diagnostic, type BackendValidationContext } from '../validation-helpers'
import { backendModuleReferencedEntities, type BackendModuleReferences } from './dependencies'
import type { BackendModuleDefinitionIR, BackendModuleIRV1 } from './types'

function ownership(
  modules: BackendModuleDefinitionIR[],
  key: 'entityIds' | 'resourceIds' | 'commandIds',
  expected: string[],
  context: BackendValidationContext
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const module of modules)
    for (const id of module[key]) {
      if (!expected.includes(id) || owners.has(id))
        diagnostic(
          context,
          'backend-module-partition-invalid',
          '$.modules.modules.' + module.id + '.' + key,
          'Module references must exist and have exactly one owner.'
        )
      owners.set(id, module.id)
    }
  if (expected.some((id) => !owners.has(id)))
    diagnostic(
      context,
      'backend-module-partition-invalid',
      '$.modules',
      'Modules must partition every entity, HTTP resource and command without omissions.'
    )
  return owners
}

function validateDependencyGraph(
  modules: BackendModuleDefinitionIR[],
  context: BackendValidationContext
): void {
  const byId = new Map(modules.map((module) => [module.id, module]))
  for (const module of modules)
    if (module.dependsOn.some((id) => id === module.id || !byId.has(id)))
      diagnostic(
        context,
        'backend-module-dependency-invalid',
        '$.modules.modules.' + module.id + '.dependsOn',
        'Dependencies must name other declared modules.'
      )
  const active = new Set<string>(),
    visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (active.has(id)) return false
    if (visited.has(id)) return true
    active.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) if (!visit(dependency)) return false
    active.delete(id)
    visited.add(id)
    return true
  }
  if (modules.some((module) => !visit(module.id)))
    diagnostic(
      context,
      'backend-module-dependency-cycle',
      '$.modules',
      'Module dependencies must be acyclic.'
    )
}

function validateCommercePartition(
  application: BackendModuleReferences,
  entities: Map<string, string>,
  commands: Map<string, string>,
  context: BackendValidationContext
): void {
  if (!application.commerce) return
  const owners = Object.values(application.commerce.entities).map((id) => entities.get(id))
  owners.push(
    ...(application.commands?.commands ?? [])
      .filter((command) => command.commerceOperation)
      .map((command) => commands.get(command.id))
  )
  if (new Set(owners).size !== 1)
    diagnostic(
      context,
      'backend-module-commerce-split',
      '$.modules',
      'All commerce entities and fixed commerce operations must belong to one module; its financial and stock authority cannot be split.'
    )
}

export function validateBackendModules(
  modules: BackendModuleIRV1,
  application: BackendModuleReferences,
  context: BackendValidationContext
): void {
  if (application.workflows.workflows.length || application.storage !== undefined)
    diagnostic(
      context,
      'backend-module-feature-unsupported',
      '$.modules',
      'Module ownership for workflows and storage is not implemented; module declarations cannot silently omit these features.'
    )
  const entities = ownership(
    modules.modules,
    'entityIds',
    application.dataModel.entities.map((entity) => entity.id),
    context
  )
  const resources = ownership(
    modules.modules,
    'resourceIds',
    (application.httpApi?.resources ?? []).map((resource) => resource.id),
    context
  )
  const commands = ownership(
    modules.modules,
    'commandIds',
    (application.commands?.commands ?? []).map((command) => command.id),
    context
  )
  for (const resource of application.httpApi?.resources ?? [])
    if (entities.get(resource.entityId) !== resources.get(resource.id))
      diagnostic(
        context,
        'backend-module-resource-owner',
        '$.modules',
        'Each HTTP resource must belong to the module that owns its entity.'
      )
  validateDependencyGraph(modules.modules, context)
  for (const module of modules.modules)
    for (const entity of backendModuleReferencedEntities(module, application)) {
      const owner = entities.get(entity)
      if (owner && owner !== module.id && !module.dependsOn.includes(owner))
        diagnostic(
          context,
          'backend-module-dependency-missing',
          '$.modules.modules.' + module.id + '.dependsOn',
          'Cross-module entity access requires the direct dependency ' +
            owner +
            '. Dependencies do not grant access permissions.'
        )
    }
  validateCommercePartition(application, entities, commands, context)
  if (application.foodOrdering) {
    const owners = Object.values(application.foodOrdering.entities).map((id) => entities.get(id))
    owners.push(
      ...(application.commands?.commands ?? [])
        .filter((command) => command.foodOrderingOperation)
        .map((command) => commands.get(command.id))
    )
    if (new Set(owners).size !== 1)
      diagnostic(
        context,
        'backend-module-food-ordering-split',
        '$.modules',
        'Restaurant menu, carts, orders and fixed operations must belong to one module.'
      )
  }
}
