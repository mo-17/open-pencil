import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

type Definition = NonNullable<BackendApplicationSpecV1['commands']>['commands'][number]
type Leaf = Extract<Definition['steps'][number], { kind: 'data.read' }>['key']
const parameter = (name: string): Leaf => ({ kind: 'parameter', name })
const result = (name: string, field: string): Leaf => ({ kind: 'result', name, field })
const literal = (value: string | number | boolean): Leaf => ({ kind: 'literal', value })
export const COMMERCE_ORDER_FIELDS = [
  'id',
  'sku_id',
  'product_title',
  'unit_price',
  'quantity',
  'total',
  'status',
  'created_at'
]

export function commerceCommands(products: string, orders: string): Definition[] {
  return [
    {
      id: 'checkout',
      name: 'Place an order',
      path: '/commands/checkout',
      access: { kind: 'authenticated' },
      idempotency: { kind: 'required', header: 'Idempotency-Key' },
      parameters: [
        { name: 'skuId', type: 'uuid', required: true },
        { name: 'quantity', type: 'integer', required: true, min: 1, max: 99 }
      ],
      steps: [
        {
          id: 'product',
          kind: 'data.read',
          entityId: products,
          resultName: 'product',
          fields: ['id', 'title', 'price', 'stock', 'active'],
          key: parameter('skuId'),
          scope: 'command',
          lock: 'update'
        },
        {
          id: 'available',
          kind: 'assert',
          left: result('product', 'active'),
          operator: 'eq',
          right: literal(true),
          error: 'conflict'
        },
        {
          id: 'price',
          kind: 'assert',
          left: result('product', 'price'),
          operator: 'gte',
          right: literal(0),
          error: 'conflict'
        },
        {
          id: 'stock',
          kind: 'assert',
          left: result('product', 'stock'),
          operator: 'gte',
          right: parameter('quantity'),
          error: 'conflict'
        },
        {
          id: 'reserve',
          kind: 'data.mutate',
          operation: 'update',
          entityId: products,
          record: 'product',
          resultName: 'reserved',
          fields: ['id', 'stock'],
          values: [
            {
              field: 'stock',
              value: {
                kind: 'integer-arithmetic',
                operator: 'subtract',
                left: result('product', 'stock'),
                right: parameter('quantity')
              }
            }
          ]
        },
        {
          id: 'order',
          kind: 'data.mutate',
          operation: 'insert',
          entityId: orders,
          resultName: 'order',
          fields: [...COMMERCE_ORDER_FIELDS],
          values: [
            { field: 'owner_id', value: { kind: 'caller-sub' } },
            { field: 'sku_id', value: result('product', 'id') },
            { field: 'product_title', value: result('product', 'title') },
            { field: 'unit_price', value: result('product', 'price') },
            { field: 'quantity', value: parameter('quantity') },
            {
              field: 'total',
              value: {
                kind: 'integer-arithmetic',
                operator: 'multiply',
                left: result('product', 'price'),
                right: parameter('quantity')
              }
            },
            { field: 'status', value: literal('pending') }
          ]
        }
      ],
      return: { resultName: 'order', fields: [...COMMERCE_ORDER_FIELDS] }
    },
    {
      id: 'cancel-order',
      name: 'Cancel an order',
      path: '/commands/cancel-order',
      access: { kind: 'authenticated' },
      idempotency: { kind: 'required', header: 'Idempotency-Key' },
      parameters: [{ name: 'orderId', type: 'uuid', required: true }],
      steps: [
        {
          id: 'order',
          kind: 'data.read',
          entityId: orders,
          resultName: 'order',
          fields: [...COMMERCE_ORDER_FIELDS],
          key: parameter('orderId'),
          scope: 'owner',
          lock: 'update'
        },
        {
          id: 'pending',
          kind: 'assert',
          left: result('order', 'status'),
          operator: 'eq',
          right: literal('pending'),
          error: 'conflict'
        },
        {
          id: 'product',
          kind: 'data.read',
          entityId: products,
          resultName: 'product',
          fields: ['id', 'stock'],
          key: result('order', 'sku_id'),
          scope: 'command',
          lock: 'update'
        },
        {
          id: 'release',
          kind: 'data.mutate',
          operation: 'update',
          entityId: products,
          record: 'product',
          resultName: 'released',
          fields: ['id', 'stock'],
          values: [
            {
              field: 'stock',
              value: {
                kind: 'integer-arithmetic',
                operator: 'add',
                left: result('product', 'stock'),
                right: result('order', 'quantity')
              }
            }
          ]
        },
        {
          id: 'cancel',
          kind: 'data.mutate',
          operation: 'update',
          entityId: orders,
          record: 'order',
          resultName: 'cancelled',
          fields: [...COMMERCE_ORDER_FIELDS],
          values: [{ field: 'status', value: literal('cancelled') }]
        }
      ],
      return: { resultName: 'cancelled', fields: [...COMMERCE_ORDER_FIELDS] }
    },
    {
      id: 'restock-product',
      name: 'Restock a product',
      path: '/commands/restock-product',
      access: { kind: 'role', roleId: 'catalog-manager' },
      idempotency: { kind: 'required', header: 'Idempotency-Key' },
      parameters: [
        { name: 'skuId', type: 'uuid', required: true },
        { name: 'quantity', type: 'integer', required: true, min: 1, max: 100000 }
      ],
      steps: [
        {
          id: 'product',
          kind: 'data.read',
          entityId: products,
          resultName: 'product',
          fields: ['id', 'stock'],
          key: parameter('skuId'),
          scope: 'command',
          lock: 'update'
        },
        {
          id: 'stock',
          kind: 'assert',
          left: result('product', 'stock'),
          operator: 'gte',
          right: literal(0),
          error: 'conflict'
        },
        {
          id: 'restock',
          kind: 'data.mutate',
          operation: 'update',
          entityId: products,
          record: 'product',
          resultName: 'restocked',
          fields: ['id', 'title', 'price', 'stock', 'active'],
          values: [
            {
              field: 'stock',
              value: {
                kind: 'integer-arithmetic',
                operator: 'add',
                left: result('product', 'stock'),
                right: parameter('quantity')
              }
            }
          ]
        }
      ],
      return: { resultName: 'restocked', fields: ['id', 'title', 'price', 'stock', 'active'] }
    }
  ]
}
