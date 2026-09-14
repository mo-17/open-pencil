import { commerceResultFields } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendCommerceEntitiesIR,
  BackendHttpAPIResourceIRV1
} from '@open-pencil/lowcode/backend'

import type { CommerceEntityMap } from './entities'

export function configureCommerceOperationResources(
  application: BackendApplicationSpecV1,
  entities: CommerceEntityMap
): void {
  const api = application.httpApi
  if (!api) throw new Error('Commerce requires a configured HTTP API.')
  api.resources = []
  const add = (
    id: string,
    key: keyof BackendCommerceEntitiesIR,
    policies: string[],
    filters: string[] = []
  ): BackendHttpAPIResourceIRV1 => {
    const resource: BackendHttpAPIResourceIRV1 = {
      id,
      path: '/' + id,
      entityId: entities[key].id,
      operations: ['list', 'read'],
      readFields: commerceResultFields(key),
      readPolicyIds: policies,
      maxPageSize: 50,
      query: { filterFields: filters, searchFields: [], sortFields: ['created_at'] }
    }
    api.resources.push(resource)
    return resource
  }
  const products = add('products', 'products', ['public-products'], ['active', 'store_id'])
  products.operations.push('create', 'update')
  products.createFields = ['store_id', 'title', 'price', 'stock', 'active']
  products.updateFields = ['title', 'price', 'active']
  products.query = {
    filterFields: ['active', 'store_id'],
    searchFields: ['title'],
    sortFields: ['price', 'created_at']
  }
  const stores = add('stores', 'stores', ['public-stores'])
  stores.readFields = ['id', 'title']
  stores.operations.push('create')
  stores.createFields = ['title']
  stores.query = { filterFields: [], searchFields: ['title'], sortFields: ['id'] }
  const mine = add('my-store', 'stores', ['buyer-stores'])
  mine.readFields = ['id', 'title']
  mine.maxPageSize = 1
  delete mine.query
  const cart = add('carts', 'carts', ['buyer-carts'])
  cart.maxPageSize = 1
  delete cart.query
  add('cart-items', 'cartItems', ['buyer-cartItems'], ['active'])
  add('purchases', 'paymentGroups', ['buyer-paymentGroups'], ['status'])
  add('orders', 'orders', ['buyer-orders'], ['payment_group_id', 'status'])
  add('order-items', 'orderItems', ['buyer-orderItems'], ['order_id', 'payment_group_id'])
  add('refunds', 'refunds', ['buyer-refunds'], ['order_id', 'status'])
  add('shipments', 'shipments', ['buyer-shipments'], ['order_id'])
  const restrictedRead = (
    id: string,
    key: keyof BackendCommerceEntitiesIR,
    scope: 'merchant' | 'operator'
  ) => {
    const filters = entities[key].fields
      .filter((field) => ['store_id', 'order_id', 'status'].includes(field.id))
      .map((field) => field.id)
    add(id, key, [scope + '-' + key], filters)
  }
  for (const [id, key] of [
    ['merchant-orders', 'orders'],
    ['merchant-items', 'orderItems'],
    ['merchant-refunds', 'refunds'],
    ['merchant-shipments', 'shipments'],
    ['merchant-settlements', 'settlements']
  ] as const)
    restrictedRead(id, key, 'merchant')
  for (const [id, key] of [
    ['operator-purchases', 'paymentGroups'],
    ['operator-orders', 'orders'],
    ['operator-refunds', 'refunds'],
    ['operator-settlements', 'settlements']
  ] as const)
    restrictedRead(id, key, 'operator')
}
