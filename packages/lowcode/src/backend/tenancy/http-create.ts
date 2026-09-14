import type { AuthPolicyIR, DataEntityIR } from '../types'

/** HTTP creation may accept a tenant selector only with an explicit membership grant. */
export function allowTenantCreateSelectors(
  entity: DataEntityIR,
  auth: AuthPolicyIR,
  protectedFields: Set<string>
): void {
  for (const tenant of auth.tenants) {
    if (
      tenant.entityId !== entity.id ||
      !tenant.membershipEntityId ||
      !tenant.membershipIdentityFieldId ||
      !tenant.membershipTenantFieldId
    )
      continue
    const allowed = auth.rowAccess.some(
      (policy) =>
        policy.entityId === entity.id &&
        policy.effect === 'allow' &&
        policy.operations.includes('insert') &&
        policy.principal.kind === 'tenant-member' &&
        policy.principal.tenantId === tenant.id
    )
    const otherIdentity =
      auth.ownership.some(
        (owner) => owner.entityId === entity.id && owner.identityFieldId === tenant.tenantFieldId
      ) ||
      auth.tenants.some(
        (other) =>
          other.membershipEntityId === entity.id &&
          [other.membershipIdentityFieldId, other.membershipTenantFieldId].includes(
            tenant.tenantFieldId
          )
      )
    if (allowed && !otherIdentity) protectedFields.delete(tenant.tenantFieldId)
  }
}
