import {
  deriveBackendApplicationCapabilities,
  type BackendCommandDefinitionIR,
  type BackendCommandLeafIR,
  type BackendCommandStepIR
} from '@open-pencil/lowcode/backend'

import { httpApplication } from '../http-api/fixtures'

export const parameter = (name: string): BackendCommandLeafIR => ({ kind: 'parameter', name })
export const result = (name: string, field: string): BackendCommandLeafIR => ({
  kind: 'result',
  name,
  field
})
export const literal = (value: string | number | boolean | null): BackendCommandLeafIR => ({
  kind: 'literal',
  value
})

export function checkoutCommand(): BackendCommandDefinitionIR {
  return {
    id: 'checkout',
    name: 'Create purchase',
    path: '/commands/checkout',
    access: { kind: 'authenticated' },
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: [
      { name: 'productId', type: 'uuid', required: true },
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 99 }
    ],
    steps: [
      {
        id: 'read-product',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'product',
        fields: ['id', 'price', 'stock', 'status'],
        key: parameter('productId'),
        scope: 'command',
        lock: 'update'
      },
      {
        id: 'active',
        kind: 'assert',
        left: result('product', 'status'),
        operator: 'eq',
        right: literal('active'),
        error: 'conflict'
      },
      {
        id: 'available',
        kind: 'assert',
        left: result('product', 'stock'),
        operator: 'gte',
        right: parameter('quantity'),
        error: 'conflict'
      },
      {
        id: 'decrement',
        kind: 'data.mutate',
        operation: 'update',
        entityId: 'notes',
        record: 'product',
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
        ],
        resultName: 'inventory',
        fields: ['id', 'stock']
      },
      {
        id: 'order',
        kind: 'data.mutate',
        operation: 'insert',
        entityId: 'orders',
        values: [
          { field: 'owner_id', value: { kind: 'caller-sub' } },
          { field: 'product_id', value: result('product', 'id') },
          { field: 'quantity', value: parameter('quantity') },
          {
            field: 'total',
            value: {
              kind: 'integer-arithmetic',
              operator: 'multiply',
              left: result('product', 'price'),
              right: parameter('quantity')
            }
          }
        ],
        resultName: 'order',
        fields: ['id', 'quantity', 'total', 'status']
      }
    ],
    return: { resultName: 'order', fields: ['id', 'quantity', 'total', 'status'] }
  }
}

export function cancelCommand(): BackendCommandDefinitionIR {
  return {
    id: 'cancel',
    name: 'Cancel purchase',
    path: '/commands/cancel',
    access: { kind: 'authenticated' },
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: [{ name: 'orderId', type: 'uuid', required: true }],
    steps: [
      {
        id: 'read-order',
        kind: 'data.read',
        entityId: 'orders',
        resultName: 'order',
        fields: ['id', 'product_id', 'quantity', 'status'],
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
        id: 'read-product',
        kind: 'data.read',
        entityId: 'notes',
        resultName: 'product',
        fields: ['id', 'stock'],
        key: result('order', 'product_id'),
        scope: 'command',
        lock: 'update'
      },
      {
        id: 'restore',
        kind: 'data.mutate',
        operation: 'update',
        entityId: 'notes',
        record: 'product',
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
        ],
        resultName: 'inventory',
        fields: ['id']
      },
      {
        id: 'cancel-order',
        kind: 'data.mutate',
        operation: 'update',
        entityId: 'orders',
        record: 'order',
        values: [{ field: 'status', value: literal('cancelled') }],
        resultName: 'cancelled',
        fields: ['id', 'status']
      }
    ],
    return: { resultName: 'cancelled', fields: ['id', 'status'] }
  }
}

export function commandApplication() {
  const application = httpApplication()
  application.dataModel.enums.push({
    id: 'status',
    name: 'status',
    values: ['active', 'pending', 'cancelled']
  })
  application.dataModel.entities[0].fields.push(
    {
      id: 'price',
      name: 'price',
      type: 'integer',
      nullable: false,
      default: { kind: 'literal', value: 100 }
    },
    {
      id: 'stock',
      name: 'stock',
      type: 'integer',
      nullable: false,
      default: { kind: 'literal', value: 10 }
    },
    {
      id: 'status',
      name: 'status',
      type: 'enum',
      enumId: 'status',
      nullable: false,
      default: { kind: 'literal', value: 'active' }
    }
  )
  application.dataModel.entities.push({
    id: 'orders',
    name: 'orders',
    management: 'managed',
    primaryKey: { fields: ['id'] },
    fields: [
      {
        id: 'id',
        name: 'id',
        type: 'uuid',
        nullable: false,
        default: { kind: 'generated', generator: 'uuid' }
      },
      { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false },
      { id: 'product_id', name: 'product_id', type: 'uuid', nullable: false },
      { id: 'quantity', name: 'quantity', type: 'integer', nullable: false },
      { id: 'total', name: 'total', type: 'integer', nullable: false },
      {
        id: 'status',
        name: 'status',
        type: 'enum',
        enumId: 'status',
        nullable: false,
        default: { kind: 'literal', value: 'pending' }
      }
    ]
  })
  application.auth.ownership.push({
    id: 'order-owner',
    entityId: 'orders',
    identityFieldId: 'owner_id'
  })
  application.commands = { version: 1, commands: [checkoutCommand(), cancelCommand()] }
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}

export function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing command fixture entry')
  return value
}
export function updateStep(step: BackendCommandStepIR) {
  if (step.kind !== 'data.mutate' || step.operation !== 'update') throw new Error('Expected update')
  return step
}
export function insertStep(step: BackendCommandStepIR) {
  if (step.kind !== 'data.mutate' || step.operation !== 'insert') throw new Error('Expected insert')
  return step
}
export function readStep(step: BackendCommandStepIR) {
  if (step.kind !== 'data.read') throw new Error('Expected read')
  return step
}
