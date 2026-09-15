import type {
  BackendApplicationSpecV1,
  BackendModuleDefinitionIR
} from '@open-pencil/lowcode/backend'

import { directoryBinding } from '../business/composition/catalog'
import type { BusinessTemplateDefinition } from '../business/types'

function referencedPolicies(
  application: BackendApplicationSpecV1,
  definition: BusinessTemplateDefinition,
  module: BackendModuleDefinitionIR,
  roles: Set<string>
): Set<string> {
  const policyIds = new Set<string>()
  const resources = new Set([...module.resourceIds, directoryBinding(application, definition.id)])
  for (const resource of application.httpApi?.resources ?? []) {
    if (!resources.has(resource.id)) continue
    for (const policy of application.auth.rowAccess) {
      if (policy.entityId !== resource.entityId || !policy.operations.includes('select')) continue
      if (resource.readPolicyIds && !resource.readPolicyIds.includes(policy.id)) continue
      policyIds.add(policy.id)
    }
  }
  for (const command of application.commands?.commands ?? []) {
    if (!module.commandIds.includes(command.id)) continue
    if ('roleId' in command.access && command.access.roleId) roles.add(command.access.roleId)
    if (command.access.kind === 'row-policy')
      for (const id of command.access.policyIds) policyIds.add(id)
  }
  return policyIds
}

/** Template roles still used by current API/command authority, not the signed-in user's grants. */
export function currentBusinessRoles(
  application: BackendApplicationSpecV1,
  definition: BusinessTemplateDefinition,
  module: BackendModuleDefinitionIR
): string[] {
  const used = new Set<string>()
  const policyIds = referencedPolicies(application, definition, module, used)
  for (const policy of application.auth.rowAccess) {
    if (policy.effect !== 'allow' || !policyIds.has(policy.id)) continue
    if ('roleId' in policy.principal && policy.principal.roleId) used.add(policy.principal.roleId)
  }
  const declared = new Set(application.auth.roles.map((role) => role.id))
  return definition.roles.filter((role) => declared.has(role) && used.has(role))
}
