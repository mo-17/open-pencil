import type {
  AuthTenantIR,
  BackendApplicationSpecV1,
  BackendDiagnostic,
  DataEntityIR,
  DataFieldIR
} from '@open-pencil/lowcode/backend'

import { nestJSDiagnostic } from '../model'

function nonNullUUID(field: DataFieldIR | undefined): field is DataFieldIR {
  return field?.type === 'uuid' && !field.nullable
}

function validMembership(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  membership: DataEntityIR
): boolean {
  const identity = membership.fields.find((entry) => entry.id === tenant.membershipIdentityFieldId)
  const key = membership.fields.find((entry) => entry.id === tenant.membershipTenantFieldId)
  const owner = application.auth.ownership.find((entry) => entry.entityId === membership.id)
  return (
    nonNullUUID(identity) &&
    !identity.default &&
    nonNullUUID(key) &&
    key.id !== identity.id &&
    membership.primaryKey?.fields.length === 1 &&
    membership.primaryKey.fields[0] === key.id &&
    owner?.identityFieldId === identity.id &&
    Boolean(
      membership.uniques?.some(
        (entry) => entry.fields.length === 1 && entry.fields[0] === identity.id
      )
    )
  )
}

function validLocator(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR,
  entity: DataEntityIR,
  membership: DataEntityIR
): boolean {
  const field = entity.fields.find((entry) => entry.id === tenant.tenantFieldId)
  const owner = application.auth.ownership.find((entry) => entry.entityId === entity.id)
  const foreignKey = entity.foreignKeys?.some(
    (entry) =>
      entry.targetEntityId === membership.id &&
      entry.fields.some(
        (id, index) =>
          id === tenant.tenantFieldId &&
          entry.targetFields[index] === tenant.membershipTenantFieldId
      )
  )
  return (
    entity.id !== membership.id &&
    application.auth.tenants.filter((entry) => entry.entityId === entity.id).length === 1 &&
    !application.auth.tenants.some((entry) => entry.entityId === membership.id) &&
    nonNullUUID(field) &&
    !field.default &&
    field.id !== owner?.identityFieldId &&
    Boolean(foreignKey) &&
    validMembership(application, tenant, membership)
  )
}

/** First tenant adapter: one immutable owner per store, one store per owner, no claim-selected tenant. */
export function validateNestJSTenants(application: BackendApplicationSpecV1): BackendDiagnostic[] {
  const diagnostics: BackendDiagnostic[] = []
  for (const tenant of application.auth.tenants) {
    const path = '$.application.auth.tenants.' + tenant.id
    if (
      application.auth.rowAccess.some(
        (policy) =>
          policy.entityId === tenant.entityId &&
          policy.effect === 'allow' &&
          policy.operations.includes('insert') &&
          (policy.principal.kind !== 'tenant-member' || policy.principal.tenantId !== tenant.id)
      )
    )
      diagnostics.push(
        nestJSDiagnostic(
          path,
          'Tenant insertion requires tenant-member grants only; owner and global-role grants cannot bypass the explicit tenant selector.'
        )
      )
    const entity = application.dataModel.entities.find((entry) => entry.id === tenant.entityId)
    const membership = application.dataModel.entities.find(
      (entry) => entry.id === tenant.membershipEntityId
    )
    if (!entity || !membership || !validLocator(application, tenant, entity, membership))
      diagnostics.push(
        nestJSDiagnostic(
          path,
          'NestJS tenants require one non-null UUID tenant field with a store foreign key, a complete store primary-key/owner locator, a unique immutable store owner, and no nested or multiple tenant locators.'
        )
      )
    if (
      application.httpApi?.resources.some(
        (resource) =>
          resource.entityId === membership?.id &&
          resource.operations.some((operation) => operation === 'update' || operation === 'delete')
      )
    )
      diagnostics.push(
        nestJSDiagnostic(
          path,
          'NestJS store membership locators cannot expose update or delete operations.'
        )
      )
    if (
      application.httpApi?.resources.some(
        (resource) =>
          resource.entityId === entity?.id &&
          resource.operations.includes('create') &&
          !resource.createFields?.includes(tenant.tenantFieldId)
      )
    )
      diagnostics.push(
        nestJSDiagnostic(
          path,
          'Tenant resource creation requires an explicit, membership-validated tenant selector.'
        )
      )
  }
  return diagnostics
}
