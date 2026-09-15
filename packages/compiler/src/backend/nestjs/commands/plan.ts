import { digestCanonicalBackendValue } from '#compiler/backend/canonical'

import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'
import { nestJSAuthorization } from '../authorization'
import { nestJSReadColumn } from '../schema-fields'
import { nestJSTenant, nestJSSameTenantLocator } from '../tenant/model'
import { nestJSCommandAssertion } from './plan-values'

function fieldColumn(entity: DataEntityIR, id: string): string {
  const field = entity.fields.find((candidate) => candidate.id === id)
  if (!field) throw new Error('Missing validated command field.')
  return sqlIdentifier(field.name)
}

function commandStep(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR,
  step: BackendCommandStepIR
) {
  if (step.kind === 'assert') return nestJSCommandAssertion(application, command, step)
  const entity = application.dataModel.entities.find((candidate) => candidate.id === step.entityId)
  const owner = application.auth.ownership.find((candidate) => candidate.entityId === step.entityId)
  const keyField = entity?.primaryKey?.fields[0]
  if (!entity || !owner || !keyField) throw new Error('Missing validated command entity.')
  const table = sqlIdentifier('public') + '.' + sqlIdentifier(entity.name)
  const projection = step.fields
    .map((id) => {
      const field = entity.fields.find((candidate) => candidate.id === id)
      if (!field) throw new Error('Missing validated command projection.')
      return nestJSReadColumn(field) + ' AS ' + sqlIdentifier(id)
    })
    .join(', ')
  const common = { resultName: step.resultName, table, projection }
  if (step.kind === 'data.read') {
    const access = command.access
    const granted =
      access.kind === 'tenant-member'
        ? application.auth.tenants.find((entry) => entry.id === access.tenantId)
        : undefined
    const tenant =
      step.scope === 'tenant' && granted
        ? application.auth.tenants.find(
            (entry) => entry.entityId === step.entityId && nestJSSameTenantLocator(entry, granted)
          )
        : undefined
    if (step.scope === 'tenant' && (!tenant || access.kind !== 'tenant-member'))
      throw new Error('Missing validated command tenant scope.')
    return {
      ...common,
      kind: 'read' as const,
      keyColumn: fieldColumn(entity, keyField),
      ownerColumn: fieldColumn(entity, owner.identityFieldId),
      scope: step.scope,
      key: step.key,
      ...(tenant && access.kind === 'tenant-member'
        ? {
            tenantColumn: fieldColumn(entity, tenant.tenantFieldId),
            tenantParameter: access.parameter
          }
        : {})
    }
  }
  const values = step.values.map((entry) => ({
    column: fieldColumn(entity, entry.field),
    source: entry.value
  }))
  if (step.operation === 'insert') return { ...common, kind: 'insert' as const, values }
  return {
    ...common,
    kind: 'update' as const,
    record: step.record,
    keyColumn: fieldColumn(entity, keyField),
    keyField,
    values
  }
}

/** Only normalized, provider-validated command data reaches this static SQL metadata compiler. */
export function nestJSCommandDefinitionDigest(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
): string {
  return digestCanonicalBackendValue(
    {
      command,
      dataModel: application.dataModel,
      ownership: application.auth.ownership,
      ...(application.auth.tenants.length ? { tenants: application.auth.tenants } : {}),
      ...(command.access.kind === 'row-policy'
        ? { rowAccess: application.auth.rowAccess, roles: application.auth.roles }
        : {}),
      ...(application.commerce ? { commerce: application.commerce } : {}),
      ...(application.foodOrdering ? { foodOrdering: application.foodOrdering } : {})
    },
    '$.commandDefinition'
  )
}

export function nestJSCommandPlan(
  application: BackendApplicationSpecV1,
  command: BackendCommandDefinitionIR
) {
  const tenant =
    command.access.kind === 'tenant-member'
      ? application.auth.tenants.find(
          (entry) => command.access.kind === 'tenant-member' && entry.id === command.access.tenantId
        )
      : undefined
  if (command.access.kind === 'tenant-member' && !tenant)
    throw new Error('Missing validated command membership.')
  const access = command.access
  const authority =
    access.kind === 'row-policy'
      ? application.dataModel.entities.find((entity) => entity.id === access.entityId)
      : undefined
  const ownership = authority
    ? application.auth.ownership.find((owner) => owner.entityId === authority.id)
    : undefined
  if (access.kind === 'row-policy' && (!authority?.primaryKey || !ownership))
    throw new Error('Missing validated command row authority.')
  const existingAccess = tenant
    ? { ...command.access, tenant: nestJSTenant(application, tenant) }
    : command.access
  return {
    applicationId: application.applicationId,
    id: command.id,
    digest: nestJSCommandDefinitionDigest(application, command),
    access:
      access.kind === 'row-policy' && authority?.primaryKey && ownership
        ? {
            ...access,
            table: sqlIdentifier('public') + '.' + sqlIdentifier(authority.name),
            keyColumn: fieldColumn(authority, authority.primaryKey.fields[0]),
            ownerColumn: fieldColumn(authority, ownership.identityFieldId),
            policy: nestJSAuthorization(application, ownership, access.policyIds).select
          }
        : existingAccess,
    ...(command.commerceOperation ? { commerceOperation: command.commerceOperation } : {}),
    ...(command.foodOrderingOperation
      ? { foodOrderingOperation: command.foodOrderingOperation }
      : {}),
    parameters: command.parameters,
    steps: command.steps.map((step) => commandStep(application, command, step)),
    return: command.return
  }
}
