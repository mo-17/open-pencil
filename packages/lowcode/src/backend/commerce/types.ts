export const BACKEND_COMMERCE_IR_VERSION = 1 as const

export const COMMERCE_OPERATIONS = [
  'cart.set',
  'cart.remove',
  'cart.checkout',
  'purchase.cancel',
  'payment.simulate',
  'refund.request',
  'refund.approve',
  'refund.reject',
  'shipment.dispatch',
  'shipment.deliver',
  'settlement.record',
  'inventory.restock'
] as const

export type BackendCommerceOperation = (typeof COMMERCE_OPERATIONS)[number]

export interface BackendCommerceEntitiesIR {
  stores: string
  products: string
  carts: string
  cartItems: string
  paymentGroups: string
  orders: string
  orderItems: string
  refunds: string
  shipments: string
  settlements: string
}

/** Fixed, reviewed commerce semantics; no executable handler, endpoint or credential data. */
export interface BackendCommerceIRV1 {
  version: typeof BACKEND_COMMERCE_IR_VERSION
  mode: 'single-merchant' | 'multi-merchant'
  currency: 'CNY' | 'USD'
  commissionBasisPoints: number
  maxItems: number
  maxStores: number
  reservationSeconds: number
  settlementDelaySeconds: number
  entities: BackendCommerceEntitiesIR
  roles: { merchant: string; operator: string }
}
