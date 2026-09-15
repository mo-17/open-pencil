export const FOOD_ORDERING_OPERATIONS = [
  'cart.set',
  'cart.remove',
  'checkout.dine-in',
  'checkout.pickup',
  'order.cancel',
  'order.accept',
  'order.prepare',
  'order.ready',
  'order.complete',
  'order.reject'
] as const

export type BackendFoodOrderingOperation = (typeof FOOD_ORDERING_OPERATIONS)[number]

export interface BackendFoodOrderingEntitiesIR {
  menuItems: string
  carts: string
  cartItems: string
  orders: string
  orderItems: string
  orderHistory: string
}

/** One restaurant per application; only compiled, reviewed operations may change order state. */
export interface BackendFoodOrderingIRV1 {
  version: 1
  currency: 'CNY'
  maxItems: number
  maxQuantity: number
  managerRoleId: string
  entities: BackendFoodOrderingEntitiesIR
}

export const FOOD_ORDERING_ENTITY_KEYS = [
  'menuItems',
  'carts',
  'cartItems',
  'orders',
  'orderItems',
  'orderHistory'
] as const satisfies readonly (keyof BackendFoodOrderingEntitiesIR)[]
