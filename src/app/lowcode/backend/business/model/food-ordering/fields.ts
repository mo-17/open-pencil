import type { BackendFoodOrderingEntitiesIR, DataEntityIR } from '@open-pencil/lowcode/backend'

export const FOOD_ORDERING_ROLES = ['food-manager'] as const
export const FOOD_ORDERING_MANAGER_ROLE = FOOD_ORDERING_ROLES[0]

export const FOOD_MENU_FIELDS = [
  'id',
  'title',
  'category',
  'description',
  'image_url',
  'price',
  'available',
  'version',
  'created_at'
] as const
export const FOOD_CART_FIELDS = ['id', 'version', 'subtotal', 'item_count', 'created_at'] as const
export const FOOD_CART_ITEM_FIELDS = [
  'id',
  'cart_id',
  'menu_item_id',
  'product_title',
  'quantity',
  'unit_price',
  'line_total',
  'active',
  'created_at'
] as const
export const FOOD_ORDER_FIELDS = [
  'id',
  'status',
  'fulfillment',
  'table_number',
  'contact_name',
  'phone',
  'note',
  'total',
  'currency',
  'version',
  'created_at'
] as const
export const FOOD_ORDER_ITEM_FIELDS = [
  'id',
  'order_id',
  'menu_item_id',
  'product_title',
  'quantity',
  'unit_price',
  'line_total',
  'created_at'
] as const
export const FOOD_ORDER_HISTORY_FIELDS = [
  'id',
  'order_id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'created_at'
] as const

export type FoodOrderingEntities = Record<keyof BackendFoodOrderingEntitiesIR, DataEntityIR> & {
  users: DataEntityIR
}

export function foodOrderingEntityReferences(
  entities: FoodOrderingEntities
): BackendFoodOrderingEntitiesIR {
  return {
    menuItems: entities.menuItems.id,
    carts: entities.carts.id,
    cartItems: entities.cartItems.id,
    orders: entities.orders.id,
    orderItems: entities.orderItems.id,
    orderHistory: entities.orderHistory.id
  }
}
