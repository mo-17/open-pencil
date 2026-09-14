import { deriveBackendApplicationCapabilities } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendHttpAPIOIDCAuthenticationIRV1,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { addNestJSEntity } from '@/app/lowcode/backend/nestjs-draft'

import { createCommerceApplication } from '../application'
import { extendMerchantCommands } from './commands'
import { assertCommerceMerchantMode, type CommerceMerchantMode } from './types'

function addStoreOwnership(
  app: BackendApplicationSpecV1,
  products: DataEntityIR,
  orders: DataEntityIR
): void {
  const stores = addNestJSEntity(app, 'stores')
  stores.fields = stores.fields.filter((field) => field.id !== 'content')
  stores.uniques = [{ id: 'one-store-per-owner', fields: ['owner_id'] }]
  const storeOwner = app.auth.ownership.find((rule) => rule.entityId === stores.id)
  if (!storeOwner) throw new Error('Missing store ownership.')
  app.auth.roles = [{ id: 'merchant', name: 'merchant' }]
  app.auth.rowAccess = app.auth.rowAccess.filter(
    (policy) => policy.entityId !== stores.id && policy.id !== 'manage-products'
  )
  app.auth.rowAccess.push(
    {
      id: 'public-stores',
      entityId: stores.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' }
    },
    {
      id: 'open-own-store',
      entityId: stores.id,
      effect: 'allow',
      operations: ['insert'],
      principal: { kind: 'role', roleId: 'merchant' }
    },
    {
      id: 'own-store',
      entityId: stores.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: storeOwner.id }
    }
  )
  for (const entity of [products, orders]) {
    entity.fields.push({ id: 'store_id', name: 'store_id', type: 'uuid', nullable: false })
    entity.foreignKeys = [
      ...(entity.foreignKeys ?? []),
      {
        id: 'belongs-to-store',
        fields: ['store_id'],
        targetEntityId: stores.id,
        targetFields: ['id'],
        onDelete: 'restrict'
      }
    ]
    entity.indexes = [
      ...(entity.indexes ?? []),
      { id: 'store-records', fields: ['store_id', 'id'] }
    ]
    const tenantId = entity === products ? 'products-store' : 'orders-store'
    app.auth.tenants.push({
      id: tenantId,
      entityId: entity.id,
      tenantFieldId: 'store_id',
      membershipEntityId: stores.id,
      membershipIdentityFieldId: 'owner_id',
      membershipTenantFieldId: 'id'
    })
    app.auth.rowAccess.push({
      id: 'merchant-' + entity.name,
      entityId: entity.id,
      effect: 'allow',
      operations: entity === products ? ['insert', 'update'] : ['select'],
      principal: { kind: 'tenant-member', tenantId, roleId: 'merchant' }
    })
  }
  orders.fields.push({ id: 'store_title', name: 'store_title', type: 'string', nullable: false })
  const api = app.httpApi
  if (!api) throw new Error('Missing commerce HTTP API.')
  for (const resource of api.resources) {
    if (resource.entityId === stores.id) {
      resource.operations = ['list', 'read', 'create']
      resource.readFields = ['id', 'title']
      resource.createFields = ['title']
      delete resource.updateFields
      resource.query = { filterFields: [], searchFields: ['title'], sortFields: ['id'] }
    } else {
      resource.readFields.push('store_id')
      resource.query?.filterFields.push('store_id')
      if (resource.entityId === products.id) resource.createFields?.push('store_id')
      if (resource.entityId === orders.id) resource.readFields.push('store_title')
    }
  }
  api.resources.push({
    id: 'my-store',
    path: '/my-store',
    entityId: stores.id,
    operations: ['list', 'read'],
    readFields: ['id', 'title'],
    readPolicyIds: ['own-store'],
    maxPageSize: 1
  })
}

/** Fresh application only: existing checkouts retain their original model and migration identity. */
export function createMerchantCommerceApplication(
  applicationId: string,
  authentication: BackendHttpAPIOIDCAuthenticationIRV1,
  mode: CommerceMerchantMode
): BackendApplicationSpecV1 {
  assertCommerceMerchantMode(mode)
  const app = createCommerceApplication(applicationId, authentication)
  const products = app.dataModel.entities.find((entity) => entity.name === 'products')
  const orders = app.dataModel.entities.find((entity) => entity.name === 'orders')
  const status = app.dataModel.enums.find((entry) => entry.id === 'order-status')
  const resource = app.httpApi?.resources.find((entry) => entry.id === 'orders')
  if (!products || !orders || !status || !resource) throw new Error('Missing commerce model.')
  status.values.push('fulfilled')
  resource.readPolicyIds = ['own-orders']
  resource.query = {
    filterFields: ['status'],
    searchFields: [],
    sortFields: ['created_at']
  }
  if (mode === 'multi-merchant') addStoreOwnership(app, products, orders)
  else
    app.auth.rowAccess.push({
      id: 'manage-orders',
      entityId: orders.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'role', roleId: 'catalog-manager' }
    })
  app.httpApi?.resources.push({
    ...structuredClone(resource),
    id: 'merchant-orders',
    path: '/merchant-orders',
    readPolicyIds: [mode === 'multi-merchant' ? 'merchant-orders' : 'manage-orders']
  })
  extendMerchantCommands(app, mode)
  app.capabilities = deriveBackendApplicationCapabilities(app).map((capability) => ({
    capability,
    required: true
  }))
  return app
}
