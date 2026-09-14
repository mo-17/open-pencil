import type {
  AuthAccessOperation,
  AuthPrincipalIntent,
  BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import type { CommerceEntityMap } from './entities'

export function configureCommerceOperationPermissions(
  application: BackendApplicationSpecV1,
  entities: CommerceEntityMap
): void {
  application.auth.roles = [
    { id: 'merchant', name: 'merchant' },
    { id: 'commerce-operator', name: 'commerce_operator' }
  ]
  application.auth.rowAccess = []
  application.auth.tenants = []
  for (const [key, entity] of Object.entries(entities)) {
    const owner = application.auth.ownership.find((entry) => entry.entityId === entity.id)
    if (!owner) throw new Error('Missing commerce ownership.')
    const grant = (
      id: string,
      principal: AuthPrincipalIntent,
      operations: AuthAccessOperation[] = ['select']
    ) => {
      application.auth.rowAccess.push({
        id,
        entityId: entity.id,
        effect: 'allow',
        operations,
        principal
      })
    }
    if (key !== 'settlements') grant('buyer-' + key, { kind: 'owner', ownershipId: owner.id })
    if (!['carts', 'cartItems'].includes(key))
      grant('operator-' + key, { kind: 'role', roleId: 'commerce-operator' })
    if (key === 'stores' || key === 'products') grant('public-' + key, { kind: 'anonymous' })
    if (key === 'stores')
      grant('create-own-store', { kind: 'role', roleId: 'merchant' }, ['insert'])
    if (key === 'cartItems' || !entity.fields.some((field) => field.id === 'store_id')) continue
    const tenantId = 'store-' + key
    application.auth.tenants.push({
      id: tenantId,
      entityId: entity.id,
      tenantFieldId: 'store_id',
      membershipEntityId: entities.stores.id,
      membershipIdentityFieldId: 'owner_id',
      membershipTenantFieldId: 'id'
    })
    grant(
      'merchant-' + key,
      { kind: 'tenant-member', tenantId, roleId: 'merchant' },
      key === 'products' ? ['select', 'insert', 'update'] : ['select']
    )
  }
}
