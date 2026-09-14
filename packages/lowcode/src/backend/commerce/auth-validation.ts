import type { AuthPolicyIR, AuthPrincipalIntent, BackendHttpAPIIRV1 } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { commerceError } from './shape'
import type { BackendCommerceIRV1 } from './types'

function merchantTenant(
  principal: AuthPrincipalIntent,
  entityId: string,
  commerce: BackendCommerceIRV1,
  auth: AuthPolicyIR
): boolean {
  if (principal.kind !== 'tenant-member' || principal.roleId !== commerce.roles.merchant)
    return false
  const tenant = auth.tenants.find((entry) => entry.id === principal.tenantId)
  return (
    tenant?.entityId === entityId &&
    tenant.tenantFieldId === 'store_id' &&
    tenant.membershipEntityId === commerce.entities.stores &&
    tenant.membershipIdentityFieldId === 'owner_id' &&
    tenant.membershipTenantFieldId === 'id'
  )
}

function safeReader(
  principal: AuthPrincipalIntent,
  entityId: string,
  commerce: BackendCommerceIRV1,
  auth: AuthPolicyIR
): boolean {
  if (principal.kind === 'owner') return entityId !== commerce.entities.settlements
  const { entities, roles } = commerce
  if ([entities.carts, entities.cartItems].includes(entityId)) return false
  if (principal.kind === 'role') return principal.roleId === roles.operator
  if (principal.kind === 'tenant-member') return merchantTenant(principal, entityId, commerce, auth)
  return [entities.stores, entities.products].includes(entityId)
}

/** Financial rows are private; public catalog projections cannot accidentally include owners. */
export function validateCommerceAuth(
  commerce: BackendCommerceIRV1,
  auth: AuthPolicyIR,
  api: BackendHttpAPIIRV1 | undefined,
  context: BackendValidationContext
): void {
  const entities = new Set(Object.values(commerce.entities))
  for (const policy of auth.rowAccess) {
    if (!entities.has(policy.entityId) || policy.effect !== 'allow') continue
    const path = '$.auth.rowAccess.' + policy.id
    if (
      policy.operations.includes('select') &&
      !safeReader(policy.principal, policy.entityId, commerce, auth)
    )
      commerceError(
        context,
        path,
        'Commerce reads require buyer ownership, exact merchant membership or the platform operator role; carts are buyer-private and settlements exclude buyer access.'
      )
    for (const operation of policy.operations.filter((entry) => entry !== 'select')) {
      const safeStore =
        policy.entityId === commerce.entities.stores &&
        operation === 'insert' &&
        policy.principal.kind === 'role' &&
        policy.principal.roleId === commerce.roles.merchant
      const safeProduct =
        policy.entityId === commerce.entities.products &&
        ['insert', 'update'].includes(operation) &&
        merchantTenant(policy.principal, policy.entityId, commerce, auth)
      if (!safeStore && !safeProduct)
        commerceError(
          context,
          path,
          'Only merchant store creation and exact tenant-scoped catalog policies may grant ordinary commerce writes.'
        )
    }
  }
  for (const resource of api?.resources ?? []) {
    if (!entities.has(resource.entityId) || !resource.readFields.includes('owner_id')) continue
    const publicRead = auth.rowAccess.some(
      (policy) =>
        policy.entityId === resource.entityId &&
        policy.effect === 'allow' &&
        policy.operations.includes('select') &&
        ['anonymous', 'authenticated'].includes(policy.principal.kind) &&
        (!resource.readPolicyIds || resource.readPolicyIds.includes(policy.id))
    )
    if (publicRead)
      commerceError(
        context,
        '$.httpApi.resources.' + resource.id + '.readFields',
        'Public commerce metadata cannot expose owner identities.'
      )
  }
}
