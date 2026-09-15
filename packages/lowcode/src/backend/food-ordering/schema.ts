import type { DataFieldIR, DataForeignKeyIR } from '../types'
import type { BackendFoodOrderingEntitiesIR } from './types'

export const FOOD_ORDERING_ENUMS = {
  'food-order-status': ['pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'],
  'food-fulfillment': ['dine_in', 'pickup']
} as const

type EntityKey = keyof BackendFoodOrderingEntitiesIR

const scalar = (id: string, type: DataFieldIR['type']): DataFieldIR => ({
  id,
  name: id,
  type,
  nullable: false
})
const count = (id: string): DataFieldIR => ({
  ...scalar(id, 'integer'),
  default: { kind: 'literal', value: 0 }
})
const flag = (id: string): DataFieldIR => ({
  ...scalar(id, 'boolean'),
  default: { kind: 'literal', value: true }
})
const status = (
  id: string,
  enumId: keyof typeof FOOD_ORDERING_ENUMS,
  value: string
): DataFieldIR => ({
  ...scalar(id, 'enum'),
  enumId,
  default: { kind: 'literal', value }
})

export function foodOrderingEntityFields(key: EntityKey): DataFieldIR[] {
  const common: DataFieldIR[] = [
    { ...scalar('id', 'uuid'), default: { kind: 'generated', generator: 'uuid' } },
    scalar('owner_id', 'uuid'),
    { ...scalar('created_at', 'datetime'), default: { kind: 'generated', generator: 'created-at' } }
  ]
  const fields: Record<EntityKey, DataFieldIR[]> = {
    menuItems: [
      ...['title', 'category', 'description', 'image_url'].map((id) => scalar(id, 'string')),
      count('price'),
      flag('available'),
      count('version')
    ],
    carts: ['version', 'subtotal', 'item_count'].map(count),
    cartItems: [
      scalar('cart_id', 'uuid'),
      scalar('menu_item_id', 'uuid'),
      scalar('product_title', 'string'),
      count('quantity'),
      count('unit_price'),
      count('line_total'),
      flag('active')
    ],
    orders: [
      status('status', 'food-order-status', 'pending'),
      status('fulfillment', 'food-fulfillment', 'pickup'),
      ...['table_number', 'contact_name', 'phone', 'note', 'currency'].map((id) =>
        scalar(id, 'string')
      ),
      count('total'),
      count('version')
    ],
    orderItems: [
      scalar('order_id', 'uuid'),
      scalar('menu_item_id', 'uuid'),
      scalar('product_title', 'string'),
      count('quantity'),
      count('unit_price'),
      count('line_total')
    ],
    orderHistory: [
      scalar('order_id', 'uuid'),
      scalar('actor_subject', 'uuid'),
      scalar('action', 'string'),
      scalar('note', 'string'),
      status('before_status', 'food-order-status', 'pending'),
      status('after_status', 'food-order-status', 'pending')
    ]
  }
  return [...common, ...fields[key]]
}

export function foodOrderingResultFields(key: EntityKey): string[] {
  return foodOrderingEntityFields(key)
    .map((entry) => entry.id)
    .filter((id) => id !== 'owner_id')
}

export function foodOrderingEntityForeignKeys(
  key: EntityKey,
  entities: BackendFoodOrderingEntitiesIR
): DataForeignKeyIR[] {
  let parent: 'carts' | 'orders' | undefined
  if (key === 'cartItems') parent = 'carts'
  else if (key === 'orderItems' || key === 'orderHistory') parent = 'orders'
  if (!parent) return []
  const field = parent === 'carts' ? 'cart_id' : 'order_id'
  return [
    {
      id: entities[key] + '-' + field,
      fields: [field, 'owner_id'],
      targetEntityId: entities[parent],
      targetFields: ['id', 'owner_id'],
      onDelete: 'restrict'
    }
  ]
}
