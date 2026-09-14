import type { BackendCommandDefinitionIR, BackendCommandParameterIR } from '../commands/types'
import type { BackendApplicationSpecV1 } from '../types'
import { commerceResultFields } from './schema'
import {
  COMMERCE_OPERATIONS,
  type BackendCommerceEntitiesIR,
  type BackendCommerceIRV1,
  type BackendCommerceOperation
} from './types'

const uuid = (name: string): BackendCommandParameterIR => ({ name, type: 'uuid', required: true })
const text = (name: string, maxLength: number): BackendCommandParameterIR => ({
  name,
  type: 'string',
  required: true,
  maxLength
})
const integer = (name: string, min: number, max: number): BackendCommandParameterIR => ({
  name,
  type: 'integer',
  required: true,
  min,
  max
})

export function commerceOperationEntityKey(
  operation: BackendCommerceOperation
): keyof BackendCommerceEntitiesIR {
  const entities: Record<BackendCommerceOperation, keyof BackendCommerceEntitiesIR> = {
    'cart.set': 'carts',
    'cart.remove': 'carts',
    'cart.checkout': 'paymentGroups',
    'purchase.cancel': 'paymentGroups',
    'payment.simulate': 'paymentGroups',
    'refund.request': 'refunds',
    'refund.approve': 'refunds',
    'refund.reject': 'refunds',
    'shipment.dispatch': 'shipments',
    'shipment.deliver': 'orders',
    'settlement.record': 'settlements',
    'inventory.restock': 'products'
  }
  return entities[operation]
}

function parameters(operation: BackendCommerceOperation): BackendCommandParameterIR[] {
  const byOperation: Record<BackendCommerceOperation, BackendCommandParameterIR[]> = {
    'cart.set': [uuid('skuId'), integer('quantity', 1, 99)],
    'cart.remove': [uuid('itemId')],
    'cart.checkout': [
      integer('cartRevision', 0, 2147483647),
      text('recipient', 100),
      text('phone', 64),
      text('address', 1000)
    ],
    'purchase.cancel': [uuid('purchaseId')],
    'payment.simulate': [uuid('purchaseId'), text('outcome', 16)],
    'refund.request': [uuid('orderId'), text('reason', 500)],
    'refund.approve': [uuid('refundId'), text('reference', 200)],
    'refund.reject': [uuid('refundId'), text('reference', 200)],
    'shipment.dispatch': [uuid('orderId'), text('carrier', 100), text('trackingNumber', 200)],
    'shipment.deliver': [uuid('orderId')],
    'settlement.record': [uuid('settlementId'), text('reference', 200)],
    'inventory.restock': [uuid('skuId'), integer('quantity', 1, 100000), uuid('storeId')]
  }
  return byOperation[operation].sort((left, right) => left.name.localeCompare(right.name, 'en'))
}

/** Shared closed signatures keep authoring, validation, OpenAPI and runtime projections aligned. */
export function commerceCommandDefinition(
  commerce: BackendCommerceIRV1,
  operation: BackendCommerceOperation
): BackendCommandDefinitionIR {
  const operator = ['refund.approve', 'refund.reject', 'settlement.record'].includes(operation)
  let roleId: string | undefined
  if (operator) roleId = commerce.roles.operator
  else if (['shipment.dispatch', 'inventory.restock'].includes(operation))
    roleId = commerce.roles.merchant
  return {
    id: operation === 'inventory.restock' ? 'restock-product' : operation,
    name: operation,
    path: '/commands/' + operation.replace('.', '-'),
    access: roleId ? { kind: 'role', roleId } : { kind: 'authenticated' },
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: parameters(operation),
    commerceOperation: operation,
    steps: [],
    return: {
      resultName: 'result',
      fields: commerceResultFields(commerceOperationEntityKey(operation)).sort((left, right) =>
        left.localeCompare(right, 'en')
      )
    }
  }
}

export function commerceCommandDefinitions(
  application: Pick<BackendApplicationSpecV1, 'commerce'>
): BackendCommandDefinitionIR[] {
  const commerce = application.commerce
  return commerce
    ? COMMERCE_OPERATIONS.map((operation) => commerceCommandDefinition(commerce, operation))
    : []
}
