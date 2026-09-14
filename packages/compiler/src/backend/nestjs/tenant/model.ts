import type { AuthTenantIR, BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { sqlIdentifier } from '../artifact'

export interface NestJSTenant {
  readonly id: string
  readonly fieldId: string
  readonly column: string
  readonly rowColumn: string
  readonly membershipTable: string
  readonly membershipIdentityColumn: string
  readonly membershipTenantColumn: string
}

export function nestJSTenant(
  application: BackendApplicationSpecV1,
  tenant: AuthTenantIR
): NestJSTenant {
  const entity = application.dataModel.entities.find((entry) => entry.id === tenant.entityId)
  const membership = application.dataModel.entities.find(
    (entry) => entry.id === tenant.membershipEntityId
  )
  const field = entity?.fields.find((entry) => entry.id === tenant.tenantFieldId)
  const identity = membership?.fields.find((entry) => entry.id === tenant.membershipIdentityFieldId)
  const key = membership?.fields.find((entry) => entry.id === tenant.membershipTenantFieldId)
  if (!entity || !membership || !field || !identity || !key)
    throw new Error('Missing validated NestJS tenant locator.')
  return {
    id: tenant.id,
    fieldId: field.id,
    column: sqlIdentifier(field.name),
    rowColumn: sqlIdentifier(entity.name) + '.' + sqlIdentifier(field.name),
    membershipTable: sqlIdentifier('public') + '.' + sqlIdentifier(membership.name),
    membershipIdentityColumn: sqlIdentifier(identity.name),
    membershipTenantColumn: sqlIdentifier(key.name)
  }
}

export function nestJSSameTenantLocator(left: AuthTenantIR, right: AuthTenantIR): boolean {
  return (
    left.membershipEntityId === right.membershipEntityId &&
    left.membershipIdentityFieldId === right.membershipIdentityFieldId &&
    left.membershipTenantFieldId === right.membershipTenantFieldId
  )
}
