import type { DataFieldIR } from '../types'
import type { BackendCommerceEntitiesIR } from './types'

export const COMMERCE_ENUMS = {
  'commerce-order-status': [
    'awaiting_payment',
    'paid',
    'shipped',
    'delivered',
    'cancelled',
    'refund_pending',
    'refunded'
  ],
  'commerce-payment-status': [
    'pending',
    'paid',
    'cancelled',
    'partially_refunded',
    'refunded',
    'refund_required'
  ],
  'commerce-refund-status': ['requested', 'approved', 'rejected'],
  'commerce-shipment-status': ['shipped', 'delivered'],
  'commerce-settlement-status': ['pending', 'recorded', 'reversed']
} as const

const field = (id: string, type: DataFieldIR['type'], nullable = false): DataFieldIR => ({
  id,
  name: id,
  type,
  nullable
})
const integer = (id: string): DataFieldIR => ({
  ...field(id, 'integer'),
  default: { kind: 'literal', value: 0 }
})
const status = (enumId: keyof typeof COMMERCE_ENUMS): DataFieldIR => ({
  ...field('status', 'enum'),
  enumId,
  default: { kind: 'literal', value: COMMERCE_ENUMS[enumId][0] }
})
const createdAt = (): DataFieldIR => ({
  ...field('created_at', 'datetime'),
  default: { kind: 'generated', generator: 'created-at' }
})

/** Semantic field IDs are fixed; providers resolve the validated entity and column names. */
export function commerceEntityFields(key: keyof BackendCommerceEntitiesIR): DataFieldIR[] {
  const common: DataFieldIR[] = [
    { ...field('id', 'uuid'), default: { kind: 'generated', generator: 'uuid' } },
    field('owner_id', 'uuid'),
    createdAt()
  ]
  const byEntity: Record<keyof BackendCommerceEntitiesIR, DataFieldIR[]> = {
    stores: [
      field('title', 'string'),
      { ...field('single_store', 'boolean'), default: { kind: 'literal', value: true } }
    ],
    products: [
      field('store_id', 'uuid'),
      field('title', 'string'),
      integer('price'),
      integer('stock'),
      { ...field('active', 'boolean'), default: { kind: 'literal', value: true } }
    ],
    carts: [integer('version'), integer('subtotal'), integer('item_count')],
    cartItems: [
      field('cart_id', 'uuid'),
      field('sku_id', 'uuid'),
      field('store_id', 'uuid'),
      field('product_title', 'string'),
      integer('quantity'),
      integer('unit_price'),
      integer('line_total'),
      { ...field('active', 'boolean'), default: { kind: 'literal', value: true } }
    ],
    paymentGroups: [
      status('commerce-payment-status'),
      integer('total'),
      integer('refunded_amount'),
      field('currency', 'string'),
      integer('cart_revision'),
      integer('commission_basis_points'),
      integer('order_count'),
      field('expires_at', 'datetime'),
      field('payment_reference', 'string', true)
    ],
    orders: [
      field('payment_group_id', 'uuid'),
      field('store_id', 'uuid'),
      field('store_title', 'string'),
      status('commerce-order-status'),
      { ...field('stock_released', 'boolean'), default: { kind: 'literal', value: false } },
      integer('total'),
      integer('commission'),
      integer('merchant_amount'),
      field('currency', 'string'),
      field('recipient', 'string'),
      field('phone', 'string'),
      field('address', 'string'),
      field('delivered_at', 'datetime', true)
    ],
    orderItems: [
      field('order_id', 'uuid'),
      field('payment_group_id', 'uuid'),
      field('store_id', 'uuid'),
      field('sku_id', 'uuid'),
      field('product_title', 'string'),
      integer('quantity'),
      integer('unit_price'),
      integer('line_total')
    ],
    refunds: [
      field('order_id', 'uuid'),
      field('payment_group_id', 'uuid'),
      field('store_id', 'uuid'),
      integer('amount'),
      field('reason', 'string'),
      status('commerce-refund-status'),
      field('decision_reference', 'string', true)
    ],
    shipments: [
      field('order_id', 'uuid'),
      field('store_id', 'uuid'),
      field('carrier', 'string'),
      field('tracking_number', 'string'),
      status('commerce-shipment-status'),
      field('delivered_at', 'datetime', true)
    ],
    settlements: [
      field('order_id', 'uuid'),
      field('store_id', 'uuid'),
      field('merchant_id', 'uuid'),
      field('payment_group_id', 'uuid'),
      integer('gross_amount'),
      integer('commission'),
      integer('merchant_amount'),
      field('currency', 'string'),
      status('commerce-settlement-status'),
      field('available_at', 'datetime', true),
      field('reference', 'string', true),
      field('recorded_at', 'datetime', true)
    ]
  }
  return [...common, ...byEntity[key]]
}

export function commerceResultFields(key: keyof BackendCommerceEntitiesIR): string[] {
  return commerceEntityFields(key)
    .filter((entry) => entry.id !== 'owner_id')
    .map((entry) => entry.id)
}
