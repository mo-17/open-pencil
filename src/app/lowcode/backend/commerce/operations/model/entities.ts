import {
  COMMERCE_ENUMS,
  commerceEntityFields,
  commerceEntityForeignKeys
} from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendCommerceEntitiesIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { addNestJSEntity } from '@/app/lowcode/backend/nestjs-draft'

const ENTITY_NAMES: Record<keyof BackendCommerceEntitiesIR, string> = {
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

export type CommerceEntityMap = Record<keyof BackendCommerceEntitiesIR, DataEntityIR>

export function createCommerceOperationEntities(
  application: BackendApplicationSpecV1
): CommerceEntityMap {
  application.dataModel.entities = []
  application.auth.ownership = []
  application.auth.rowAccess = []
  const api = application.httpApi
  if (!api) throw new Error('Commerce requires a configured HTTP API.')
  api.resources = []
  application.dataModel.enums = Object.entries(COMMERCE_ENUMS).map(([id, values]) => ({
    id,
    name: id.replaceAll('-', '_'),
    values: [...values]
  }))
  const entries = Object.entries(ENTITY_NAMES).map(([key, name]) => {
    const kind = key as keyof BackendCommerceEntitiesIR
    const entity = addNestJSEntity(application, name)
    entity.fields = commerceEntityFields(kind)
    entity.indexes = [
      { id: 'owner-created', fields: ['owner_id', 'created_at', 'id'], order: 'desc' }
    ]
    return [kind, entity] as const
  })
  return Object.fromEntries(entries) as CommerceEntityMap
}

export function linkCommerceOperationEntities(
  entities: CommerceEntityMap,
  singleMerchant: boolean
): void {
  const { stores, carts, cartItems, orders, orderItems, refunds, shipments, settlements } = entities
  stores.uniques = [
    { id: 'one-store-per-owner', fields: ['owner_id'] },
    ...(singleMerchant ? [{ id: 'one-store-per-application', fields: ['single_store'] }] : [])
  ]
  carts.uniques = [{ id: 'one-cart-per-owner', fields: ['owner_id'] }]
  cartItems.uniques = [{ id: 'one-item-per-sku', fields: ['cart_id', 'sku_id'] }]
  orders.uniques = [{ id: 'one-order-per-store', fields: ['payment_group_id', 'store_id'] }]
  orderItems.uniques = [{ id: 'one-line-per-sku', fields: ['order_id', 'sku_id'] }]
  for (const entity of [refunds, shipments, settlements])
    entity.uniques = [{ id: 'one-record-per-order', fields: ['order_id'] }]
  const references: BackendCommerceEntitiesIR = {
    stores: stores.id,
    products: entities.products.id,
    carts: carts.id,
    cartItems: cartItems.id,
    paymentGroups: entities.paymentGroups.id,
    orders: orders.id,
    orderItems: orderItems.id,
    refunds: refunds.id,
    shipments: shipments.id,
    settlements: settlements.id
  }
  for (const [key, entity] of Object.entries(entities)) {
    entity.uniques = [...(entity.uniques ?? []), { id: 'owner-key', fields: ['id', 'owner_id'] }]
    entity.foreignKeys = commerceEntityForeignKeys(
      key as keyof BackendCommerceEntitiesIR,
      references
    )
    if (entity.fields.some((field) => field.id === 'store_id'))
      entity.indexes?.push({ id: 'store-created', fields: ['store_id', 'created_at', 'id'] })
  }
}
