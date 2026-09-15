import {
  FOOD_ORDERING_ENUMS,
  foodOrderingEntityFields,
  foodOrderingEntityForeignKeys,
  type BackendApplicationSpecV1,
  type BackendFoodOrderingEntitiesIR,
  type DataEntityIR
} from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import { addBusinessEntity, businessEnum } from '../entities'
import {
  FOOD_ORDERING_MANAGER_ROLE,
  foodOrderingEntityReferences,
  type FoodOrderingEntities
} from './fields'

function entity(
  application: BackendApplicationSpecV1,
  key: keyof BackendFoodOrderingEntitiesIR,
  name: string
): DataEntityIR {
  const result = addBusinessEntity(application, name, [])
  result.fields = foodOrderingEntityFields(key)
  return result
}

export function createFoodOrderingEntities(
  application: BackendApplicationSpecV1
): FoodOrderingEntities {
  const users = addBusinessUsers(application, [FOOD_ORDERING_MANAGER_ROLE])
  for (const [id, values] of Object.entries(FOOD_ORDERING_ENUMS))
    businessEnum(application, id, values)
  const entities: FoodOrderingEntities = {
    users,
    menuItems: entity(application, 'menuItems', 'food_menu_items'),
    carts: entity(application, 'carts', 'food_carts'),
    cartItems: entity(application, 'cartItems', 'food_cart_items'),
    orders: entity(application, 'orders', 'food_orders'),
    orderItems: entity(application, 'orderItems', 'food_order_items'),
    orderHistory: entity(application, 'orderHistory', 'food_order_history')
  }
  entities.carts.uniques?.push({ id: 'one-cart-per-owner', fields: ['owner_id'] })
  entities.cartItems.uniques?.push({
    id: 'one-cart-line-per-dish',
    fields: ['cart_id', 'menu_item_id']
  })
  entities.orderItems.uniques?.push({
    id: 'one-order-line-per-dish',
    fields: ['order_id', 'menu_item_id']
  })
  const references = foodOrderingEntityReferences(entities)
  for (const key of Object.keys(references) as (keyof BackendFoodOrderingEntitiesIR)[])
    entities[key].foreignKeys = foodOrderingEntityForeignKeys(key, references)
  // Dish references are validated by the closed handlers. There is no dish delete
  // route, and snapshots must not require unconditional publication of menu rows.
  entities.menuItems.indexes?.push({
    id: 'menu-category',
    fields: ['available', 'category', 'created_at', 'id']
  })
  entities.orders.indexes?.push({ id: 'kitchen-status', fields: ['status', 'created_at', 'id'] })
  for (const [target, parent] of [
    [entities.cartItems, 'cart_id'],
    [entities.orderItems, 'order_id'],
    [entities.orderHistory, 'order_id']
  ] as const)
    target.indexes?.push({ id: 'parent-created', fields: [parent, 'created_at', 'id'] })
  return entities
}
