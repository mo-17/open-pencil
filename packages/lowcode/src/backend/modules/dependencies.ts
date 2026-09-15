import type { BackendCommandDefinitionIR } from '../commands/types'
import type { AuthRowAccessIntentIR, BackendApplicationSpecV1 } from '../types'
import type { BackendModuleDefinitionIR } from './types'

export type BackendModuleReferences = Pick<
  BackendApplicationSpecV1,
  | 'dataModel'
  | 'auth'
  | 'httpApi'
  | 'commands'
  | 'commerce'
  | 'foodOrdering'
  | 'workflows'
  | 'storage'
>

function policyEntities(
  policy: AuthRowAccessIntentIR,
  application: BackendModuleReferences
): string[] {
  const principal = policy.principal
  if (principal.kind === 'related-member') return [principal.membershipEntityId]
  if (principal.kind !== 'tenant-member') return []
  const tenant = application.auth.tenants.find((entry) => entry.id === principal.tenantId)
  return tenant?.membershipEntityId ? [tenant.membershipEntityId] : []
}

function commandEntities(
  command: BackendCommandDefinitionIR,
  application: BackendModuleReferences
): string[] {
  const entities = command.steps.flatMap((step) => (step.kind === 'assert' ? [] : [step.entityId]))
  if (command.commerceOperation && application.commerce)
    entities.push(...Object.values(application.commerce.entities))
  if (command.foodOrderingOperation && application.foodOrdering)
    entities.push(...Object.values(application.foodOrdering.entities))
  const access = command.access
  if (access.kind === 'row-policy') {
    entities.push(access.entityId)
    for (const policy of application.auth.rowAccess)
      if (access.policyIds.includes(policy.id))
        entities.push(...policyEntities(policy, application))
  }
  if (access.kind === 'tenant-member') {
    const tenant = application.auth.tenants.find((entry) => entry.id === access.tenantId)
    if (tenant)
      entities.push(
        tenant.entityId,
        ...(tenant.membershipEntityId ? [tenant.membershipEntityId] : [])
      )
  }
  return entities
}

function resourceEntities(
  module: BackendModuleDefinitionIR,
  application: BackendModuleReferences
): Set<string> {
  const entities = new Set<string>()
  for (const resource of application.httpApi?.resources ?? [])
    if (module.resourceIds.includes(resource.id))
      for (const policy of application.auth.rowAccess)
        if (
          policy.entityId === resource.entityId &&
          (policy.effect === 'deny' ||
            !resource.readPolicyIds ||
            resource.readPolicyIds.includes(policy.id) ||
            policy.operations.some((operation) => operation !== 'select'))
        )
          for (const entity of policyEntities(policy, application)) entities.add(entity)
  return entities
}

/** Entity references that must remain visible when reviewing module dependencies. */
export function backendModuleReferencedEntities(
  module: BackendModuleDefinitionIR,
  application: BackendModuleReferences
): Set<string> {
  const entities = new Set<string>()
  for (const entity of application.dataModel.entities)
    if (module.entityIds.includes(entity.id))
      for (const foreignKey of entity.foreignKeys ?? []) entities.add(foreignKey.targetEntityId)
  for (const relation of application.dataModel.relations)
    if (module.entityIds.includes(relation.sourceEntityId)) {
      entities.add(relation.targetEntityId)
      if (relation.junctionEntityId) entities.add(relation.junctionEntityId)
    }
  for (const entity of resourceEntities(module, application)) entities.add(entity)
  for (const command of application.commands?.commands ?? [])
    if (module.commandIds.includes(command.id))
      for (const entity of commandEntities(command, application)) entities.add(entity)
  return entities
}
