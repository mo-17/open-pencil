import type {
  BackendApplicationSpecV1,
  BackendModuleDefinitionIR
} from '@open-pencil/lowcode/backend'

import type { BusinessTemplateId } from '../model/types'
import {
  BUSINESS_ACCOUNTS_MODULE_ID,
  BUSINESS_ACCOUNT_ENTITY_ID,
  BUSINESS_REGISTRATION_COMMAND_ID
} from './catalog'
import { conflict, requireEquivalent } from './compare'

export function businessModuleDefinition(
  source: BackendApplicationSpecV1,
  kind: BusinessTemplateId
): BackendModuleDefinitionIR {
  return {
    id: kind,
    name: kind.replaceAll('-', ' '),
    entityIds: source.dataModel.entities
      .filter((entry) => entry.id !== BUSINESS_ACCOUNT_ENTITY_ID)
      .map((entry) => entry.id),
    resourceIds: (source.httpApi?.resources ?? [])
      .filter((entry) => entry.entityId !== BUSINESS_ACCOUNT_ENTITY_ID)
      .map((entry) => entry.id),
    commandIds: (source.commands?.commands ?? [])
      .filter((entry) => entry.id !== BUSINESS_REGISTRATION_COMMAND_ID)
      .map((entry) => entry.id),
    dependsOn: [BUSINESS_ACCOUNTS_MODULE_ID]
  }
}

export function accountsModuleDefinition(
  application: BackendApplicationSpecV1
): BackendModuleDefinitionIR {
  return {
    id: BUSINESS_ACCOUNTS_MODULE_ID,
    name: 'Shared business accounts',
    entityIds: [BUSINESS_ACCOUNT_ENTITY_ID],
    resourceIds: (application.httpApi?.resources ?? [])
      .filter((entry) => entry.entityId === BUSINESS_ACCOUNT_ENTITY_ID)
      .map((entry) => entry.id),
    commandIds: [BUSINESS_REGISTRATION_COMMAND_ID],
    dependsOn: []
  }
}

export function verifyBusinessModule(
  actual: BackendModuleDefinitionIR,
  expected: BackendModuleDefinitionIR
): void {
  for (const key of ['entityIds', 'resourceIds', 'commandIds', 'dependsOn'] as const)
    requireEquivalent(
      [...actual[key]].sort(),
      [...expected[key]].sort(),
      '$.modules.' + actual.id + '.' + key
    )
}

/** Existing unannotated records remain together; composition does not infer domain ownership. */
export function addExistingModule(
  application: BackendApplicationSpecV1,
  modules: BackendModuleDefinitionIR[]
): void {
  const rest = (key: 'entityIds' | 'resourceIds' | 'commandIds', ids: string[]) => {
    const claimed = new Set(modules.flatMap((module) => module[key]))
    return ids.filter((id) => !claimed.has(id))
  }
  const entityIds = rest(
    'entityIds',
    application.dataModel.entities.map((entry) => entry.id)
  )
  const resourceIds = rest(
    'resourceIds',
    (application.httpApi?.resources ?? []).map((entry) => entry.id)
  )
  const commandIds = rest(
    'commandIds',
    (application.commands?.commands ?? []).map((entry) => entry.id)
  )
  if (!entityIds.length && !resourceIds.length && !commandIds.length) return
  if (!entityIds.length || modules.some((entry) => entry.id === 'existing-application'))
    conflict('$.modules', 'Existing records cannot be assigned a distinct module owner.')
  modules.unshift({
    id: 'existing-application',
    name: 'Existing application',
    entityIds,
    resourceIds,
    commandIds,
    dependsOn: []
  })
}
