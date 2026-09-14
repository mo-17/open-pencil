import {
  COMMERCE_ENUMS,
  commerceCommandDefinitions,
  commerceEntityFields,
  commerceEntityForeignKeys,
  commerceResultFields,
  deriveBackendApplicationCapabilities,
  type BackendCommerceEntitiesIR,
  type BackendCommerceIRV1,
  type DataEntityIR
} from '@open-pencil/lowcode/backend'

import { httpApplication } from '../http-api/fixtures'

export function commerceApplication(mode: BackendCommerceIRV1['mode'] = 'multi-merchant') {
  const base = httpApplication()
  const entities: BackendCommerceEntitiesIR = {
    stores: 'stores',
    products: 'products',
    carts: 'carts',
    cartItems: 'cart_items',
    paymentGroups: 'payment_groups',
    orders: 'orders',
    orderItems: 'order_items',
    refunds: 'refunds',
    shipments: 'shipments',
    settlements: 'settlements'
  }
  const commerce: BackendCommerceIRV1 = {
    version: 1,
    mode,
    currency: 'CNY',
    commissionBasisPoints: 500,
    maxItems: 20,
    maxStores: mode === 'single-merchant' ? 1 : 5,
    reservationSeconds: 900,
    settlementDelaySeconds: 86400,
    entities,
    roles: { merchant: 'merchant', operator: 'commerce-operator' }
  }
  const uniques: Partial<Record<keyof BackendCommerceEntitiesIR, string[][]>> = {
    stores: [['owner_id'], ...(mode === 'single-merchant' ? [['single_store']] : [])],
    carts: [['owner_id']],
    cartItems: [['cart_id', 'sku_id']],
    orders: [['payment_group_id', 'store_id']],
    orderItems: [['order_id', 'sku_id']],
    refunds: [['order_id']],
    shipments: [['order_id']],
    settlements: [['order_id']]
  }
  base.dataModel = {
    version: 1,
    relations: [],
    enums: Object.entries(COMMERCE_ENUMS).map(([id, values]) => ({
      id,
      name: id.replaceAll('-', '_'),
      values: [...values]
    })),
    entities: (Object.keys(entities) as (keyof BackendCommerceEntitiesIR)[]).map(
      (key): DataEntityIR => ({
        id: entities[key],
        name: entities[key],
        management: 'managed',
        primaryKey: { fields: ['id'] },
        fields: commerceEntityFields(key),
        foreignKeys: commerceEntityForeignKeys(key, entities),
        uniques: [['id', 'owner_id'], ...(uniques[key] ?? [])].map((fields, index) => ({
          id: entities[key] + '-unique-' + index,
          fields
        }))
      })
    )
  }
  base.auth.roles = [
    { id: 'merchant', name: 'merchant' },
    { id: 'commerce-operator', name: 'commerce_operator' }
  ]
  base.auth.ownership = Object.values(entities).map((entityId) => ({
    id: entityId + '-owner',
    entityId,
    identityFieldId: 'owner_id'
  }))
  base.auth.rowAccess = base.auth.ownership.map((entry) => ({
    id: entry.id + '-read',
    entityId: entry.entityId,
    effect: 'allow',
    operations: ['select'],
    principal:
      entry.entityId === entities.settlements
        ? { kind: 'role', roleId: commerce.roles.operator }
        : { kind: 'owner', ownershipId: entry.id }
  }))
  base.httpApi.resources = (Object.keys(entities) as (keyof BackendCommerceEntitiesIR)[]).map(
    (key) => ({
      id: entities[key],
      path: '/data/' + entities[key],
      entityId: entities[key],
      operations: ['list', 'read'],
      readFields: commerceResultFields(key),
      maxPageSize: 50
    })
  )
  const application = {
    ...base,
    commerce,
    commands: { version: 1 as const, commands: commerceCommandDefinitions({ commerce }) }
  }
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing commerce fixture value')
  return value
}
