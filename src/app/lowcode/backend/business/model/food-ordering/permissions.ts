import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  FOOD_CART_FIELDS,
  FOOD_CART_ITEM_FIELDS,
  FOOD_MENU_FIELDS,
  FOOD_ORDER_FIELDS,
  FOOD_ORDER_HISTORY_FIELDS,
  FOOD_ORDER_ITEM_FIELDS,
  FOOD_ORDERING_MANAGER_ROLE,
  type FoodOrderingEntities
} from './fields'

function manager(application: BackendApplicationSpecV1, entity: DataEntityIR, id: string): string {
  return businessGrant(application, entity, id, {
    kind: 'role',
    roleId: FOOD_ORDERING_MANAGER_ROLE
  })
}

function menuResources(
  application: BackendApplicationSpecV1,
  entities: FoodOrderingEntities
): void {
  const policy = 'food-available-menu'
  application.auth.rowAccess.push({
    id: policy,
    entityId: entities.menuItems.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId: 'available', value: true }]
  })
  const publicMenu = businessReadResource(
    application,
    entities.menuItems,
    'food-menu',
    FOOD_MENU_FIELDS,
    [policy]
  )
  publicMenu.query = {
    filterFields: ['category'],
    searchFields: ['title', 'category', 'description'],
    sortFields: ['created_at']
  }
  const managedMenu = businessReadResource(
    application,
    entities.menuItems,
    'food-menu-management',
    FOOD_MENU_FIELDS,
    [manager(application, entities.menuItems, 'food-manager-menu')]
  )
  managedMenu.query = {
    filterFields: ['category', 'available'],
    searchFields: ['title', 'category', 'description'],
    sortFields: ['created_at']
  }
}

export function addFoodOrderingPermissions(
  application: BackendApplicationSpecV1,
  entities: FoodOrderingEntities
): void {
  menuResources(application, entities)
  businessReadResource(application, entities.carts, 'food-carts', FOOD_CART_FIELDS, [
    businessOwnerGrant(application, entities.carts)
  ])
  const itemPolicy = businessOwnerGrant(application, entities.cartItems)
  const activeItems = application.auth.rowAccess.find((entry) => entry.id === itemPolicy)
  if (!activeItems) throw new Error('Missing food cart-item ownership policy')
  activeItems.conditions = [{ fieldId: 'active', value: true }]
  const items = businessReadResource(
    application,
    entities.cartItems,
    'food-cart-items',
    FOOD_CART_ITEM_FIELDS,
    [itemPolicy]
  )
  items.query = {
    filterFields: ['cart_id', 'menu_item_id'],
    searchFields: [],
    sortFields: ['created_at']
  }
  for (const [target, customerId, kitchenId, fields, filters] of [
    [
      entities.orders,
      'food-orders',
      'food-kitchen-orders',
      FOOD_ORDER_FIELDS,
      ['status', 'fulfillment']
    ],
    [
      entities.orderItems,
      'food-order-items',
      'food-kitchen-items',
      FOOD_ORDER_ITEM_FIELDS,
      ['order_id']
    ],
    [
      entities.orderHistory,
      'food-order-history',
      'food-kitchen-history',
      FOOD_ORDER_HISTORY_FIELDS,
      ['order_id', 'action']
    ]
  ] as const) {
    const own = businessOwnerGrant(application, target)
    const staff = manager(application, target, kitchenId + '-manager')
    for (const [id, policy] of [
      [customerId, own],
      [kitchenId, staff]
    ] as const) {
      const resource = businessReadResource(application, target, id, fields, [policy])
      resource.query = { filterFields: [...filters], searchFields: [], sortFields: ['created_at'] }
    }
  }
}
