import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import type { BackendApplicationSpecV1, BackendDiagnostic } from '@open-pencil/lowcode/backend'

import { localMigrationDiagnostic } from './diagnostic'

function same(left: unknown, right: unknown): boolean {
  return (
    digestCanonicalBackendValue(left ?? null, '$.moduleMigration') ===
    digestCanonicalBackendValue(right ?? null, '$.moduleMigration')
  )
}

function unchanged<T extends { id: string }>(from: readonly T[], to: readonly T[]): boolean {
  return from.every((entry) =>
    same(
      entry,
      to.find((candidate) => candidate.id === entry.id)
    )
  )
}

function existingRecordsUnchanged(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): boolean {
  return (
    unchanged(from.dataModel.entities, to.dataModel.entities) &&
    unchanged(from.dataModel.enums, to.dataModel.enums) &&
    unchanged(from.dataModel.relations, to.dataModel.relations) &&
    unchanged(from.commands?.commands ?? [], to.commands?.commands ?? []) &&
    unchanged(from.auth.roles, to.auth.roles) &&
    unchanged(from.auth.ownership, to.auth.ownership) &&
    unchanged(from.auth.rowAccess, to.auth.rowAccess) &&
    unchanged(from.httpApi?.resources ?? [], to.httpApi?.resources ?? [])
  )
}

function identityUnchanged(from: BackendApplicationSpecV1, to: BackendApplicationSpecV1): boolean {
  return (
    same(from.auth.identities, to.auth.identities) &&
    same(from.auth.tenants, to.auth.tenants) &&
    same(from.httpApi?.authentication, to.httpApi?.authentication) &&
    same(from.httpApi?.browserClient, to.httpApi?.browserClient) &&
    same(from.secrets, to.secrets) &&
    same(from.commerce, to.commerce) &&
    (!from.foodOrdering || same(from.foodOrdering, to.foodOrdering)) &&
    same(from.storage, to.storage) &&
    same(from.workflows, to.workflows)
  )
}

function moduleOwnershipUnchanged(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  oldIds: Set<string>
): boolean {
  const target = to.modules?.modules ?? []
  if (
    target.some(
      (module) =>
        module.entityIds.some((id) => oldIds.has(id)) &&
        module.entityIds.some((id) => !oldIds.has(id))
    )
  )
    return false
  return (from.modules?.modules ?? []).every((module) => {
    const next = target.find((entry) => entry.id === module.id)
    if (!next) return false
    const { resourceIds: oldResources, ...oldDefinition } = module
    const { resourceIds: nextResources, ...nextDefinition } = next
    return (
      same(oldDefinition, nextDefinition) && oldResources.every((id) => nextResources.includes(id))
    )
  })
}

function isolatedOldEntityReads(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  oldIds: Set<string>
): boolean {
  const newPolicies = to.auth.rowAccess.filter(
    (policy) =>
      !from.auth.rowAccess.some((entry) => entry.id === policy.id) && oldIds.has(policy.entityId)
  )
  for (const policy of newPolicies) {
    const principal = policy.principal
    if (
      policy.effect !== 'allow' ||
      !same(policy.operations, ['select']) ||
      principal.kind !== 'role' ||
      from.auth.roles.some((role) => role.id === principal.roleId)
    )
      return false
    if (
      (from.httpApi?.resources ?? []).some(
        (resource) => resource.entityId === policy.entityId && !resource.readPolicyIds?.length
      )
    )
      return false
  }
  return isolatedNewProjections(from, to, oldIds)
}

function isolatedNewProjections(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  oldIds: Set<string>
): boolean {
  for (const resource of to.httpApi?.resources ?? []) {
    if (
      !oldIds.has(resource.entityId) ||
      from.httpApi?.resources.some((entry) => entry.id === resource.id)
    )
      continue
    const readable = new Set(
      (from.httpApi?.resources ?? [])
        .filter((entry) => entry.entityId === resource.entityId)
        .flatMap((entry) => entry.readFields)
    )
    if (
      !resource.readPolicyIds?.length ||
      resource.operations.some((operation) => operation !== 'list' && operation !== 'read') ||
      resource.readFields.some((field) => !readable.has(field))
    )
      return false
  }
  return true
}

function newRecordsAreAdditive(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1,
  oldIds: Set<string>
): boolean {
  if (
    to.auth.ownership.some(
      (owner) =>
        oldIds.has(owner.entityId) && !from.auth.ownership.some((entry) => entry.id === owner.id)
    )
  )
    return false
  if (
    to.dataModel.relations.some(
      (relation) =>
        oldIds.has(relation.sourceEntityId) &&
        !from.dataModel.relations.some((entry) => entry.id === relation.id)
    )
  )
    return false
  return (to.commands?.commands ?? [])
    .filter((command) => !from.commands?.commands.some((entry) => entry.id === command.id))
    .every(
      (command) =>
        !command.commerceOperation &&
        (!command.foodOrderingOperation ||
          (to.foodOrdering !== undefined &&
            Object.values(to.foodOrdering.entities).every((id) => !oldIds.has(id)))) &&
        command.steps.every((step) => step.kind !== 'data.mutate' || !oldIds.has(step.entityId))
    )
}

/** No existing schema object, route, authority record, or idempotency definition may be rewritten. */
export function validateModuleSchemaAddition(
  from: BackendApplicationSpecV1,
  to: BackendApplicationSpecV1
): BackendDiagnostic[] {
  const oldIds = new Set(from.dataModel.entities.map((entity) => entity.id))
  const newEntities = to.dataModel.entities.filter((entity) => !oldIds.has(entity.id))
  const safe =
    Boolean(to.modules) &&
    newEntities.length > 0 &&
    existingRecordsUnchanged(from, to) &&
    identityUnchanged(from, to) &&
    moduleOwnershipUnchanged(from, to, oldIds) &&
    isolatedOldEntityReads(from, to, oldIds) &&
    newRecordsAreAdditive(from, to, oldIds)
  return safe
    ? []
    : [
        localMigrationDiagnostic(
          'module-schema-change-blocked',
          '$.toApplication.modules',
          'Module migrations may only add separately owned tables, enums and constraints while preserving existing schema, commands, authority and identity. Existing-table writes or widened existing projections require a separately reviewed migration.'
        )
      ]
}
