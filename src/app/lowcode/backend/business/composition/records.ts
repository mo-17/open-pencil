import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { BUSINESS_ACCOUNT_ENTITY_ID, BUSINESS_REGISTRATION_COMMAND_ID } from './catalog'
import { appendEntries, conflict, requireEntries, requireEquivalent } from './compare'

/** Adoption is explicit and checks every template-owned authority record, not its display name. */
export function verifyBusinessRecords(
  base: BackendApplicationSpecV1,
  source: BackendApplicationSpecV1
): void {
  if (source.foodOrdering)
    requireEquivalent(base.foodOrdering, source.foodOrdering, '$.foodOrdering')
  requireEntries(base.dataModel.entities, source.dataModel.entities, '$.dataModel.entities')
  requireEntries(base.dataModel.enums, source.dataModel.enums, '$.dataModel.enums')
  requireEntries(base.dataModel.relations, source.dataModel.relations, '$.dataModel.relations')
  requireEntries(base.auth.roles, source.auth.roles, '$.auth.roles')
  requireEntries(base.auth.ownership, source.auth.ownership, '$.auth.ownership')
  requireEntries(base.auth.tenants, source.auth.tenants, '$.auth.tenants')
  requireEntries(base.auth.rowAccess, source.auth.rowAccess, '$.auth.rowAccess')
  requireEntries(
    base.httpApi?.resources ?? [],
    source.httpApi?.resources ?? [],
    '$.httpApi.resources'
  )
  requireEntries(
    base.commands?.commands ?? [],
    source.commands?.commands ?? [],
    '$.commands.commands'
  )
}

export function appendBusinessRecords(
  actual: BackendApplicationSpecV1,
  checked: BackendApplicationSpecV1,
  source: BackendApplicationSpecV1,
  sharedAccount: boolean
): void {
  const entityShared = sharedAccount ? [BUSINESS_ACCOUNT_ENTITY_ID] : []
  if (source.foodOrdering) {
    if (actual.foodOrdering)
      conflict('$.foodOrdering', 'This application already owns a restaurant ordering profile.')
    actual.foodOrdering = structuredClone(source.foodOrdering)
    checked.foodOrdering = structuredClone(source.foodOrdering)
  }
  const ownerShared = sharedAccount ? ['own-users'] : []
  appendEntries(
    actual.dataModel.entities,
    checked.dataModel.entities,
    source.dataModel.entities,
    '$.dataModel.entities',
    entityShared,
    (entity) => entity.name
  )
  appendEntries(
    actual.dataModel.enums,
    checked.dataModel.enums,
    source.dataModel.enums,
    '$.dataModel.enums',
    [],
    (entry) => entry.name
  )
  appendEntries(
    actual.dataModel.relations,
    checked.dataModel.relations,
    source.dataModel.relations,
    '$.dataModel.relations'
  )
  appendEntries(
    actual.auth.roles,
    checked.auth.roles,
    source.auth.roles,
    '$.auth.roles',
    [],
    (entry) => entry.name
  )
  appendEntries(
    actual.auth.ownership,
    checked.auth.ownership,
    source.auth.ownership,
    '$.auth.ownership',
    ownerShared
  )
  appendEntries(actual.auth.tenants, checked.auth.tenants, source.auth.tenants, '$.auth.tenants')
  appendEntries(
    actual.auth.rowAccess,
    checked.auth.rowAccess,
    source.auth.rowAccess,
    '$.auth.rowAccess',
    ownerShared
  )
  appendHTTPRecords(actual, checked, source, sharedAccount)
}

function appendHTTPRecords(
  actual: BackendApplicationSpecV1,
  checked: BackendApplicationSpecV1,
  source: BackendApplicationSpecV1,
  sharedAccount: boolean
): void {
  if (!actual.httpApi || !checked.httpApi || !source.httpApi)
    conflict('$.httpApi', 'Business modules require an HTTP API.')
  requireHTTPPaths(checked, source, sharedAccount)
  appendEntries(
    actual.httpApi.resources,
    checked.httpApi.resources,
    source.httpApi.resources,
    '$.httpApi.resources',
    sharedAccount ? ['my-profile'] : [],
    (entry) => entry.path
  )
  actual.commands ??= { version: 1, commands: [] }
  checked.commands ??= { version: 1, commands: [] }
  appendEntries(
    actual.commands.commands,
    checked.commands.commands,
    source.commands?.commands ?? [],
    '$.commands.commands',
    sharedAccount ? [BUSINESS_REGISTRATION_COMMAND_ID] : [],
    (entry) => entry.path
  )
}

function requireHTTPPaths(
  checked: BackendApplicationSpecV1,
  source: BackendApplicationSpecV1,
  sharedAccount: boolean
): void {
  const oldPaths = new Set([
    ...(checked.httpApi?.resources ?? []).map((entry) => entry.path),
    ...(checked.commands?.commands ?? []).map((entry) => entry.path)
  ])
  const incoming = [...(source.httpApi?.resources ?? []), ...(source.commands?.commands ?? [])]
  const shared = sharedAccount ? ['my-profile', BUSINESS_REGISTRATION_COMMAND_ID] : []
  for (const entry of incoming)
    if (!shared.includes(entry.id) && oldPaths.has(entry.path))
      conflict('$.httpApi.' + entry.id, 'A business module HTTP path is already in use.')
}
