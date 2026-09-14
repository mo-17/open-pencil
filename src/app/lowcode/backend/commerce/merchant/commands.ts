import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR,
  BackendCommandStepIR
} from '@open-pencil/lowcode/backend'

import type { CommerceMerchantMode } from './types'

function fulfillmentCommand(
  entityId: string,
  fields: string[],
  mode: CommerceMerchantMode
): BackendCommandDefinitionIR {
  const multi = mode === 'multi-merchant'
  return {
    id: 'fulfill-order',
    name: 'Complete an order',
    path: '/commands/fulfill-order',
    access: multi
      ? {
          kind: 'tenant-member',
          tenantId: 'orders-store',
          parameter: 'storeId',
          roleId: 'merchant'
        }
      : { kind: 'role', roleId: 'catalog-manager' },
    idempotency: { kind: 'required', header: 'Idempotency-Key' },
    parameters: [
      { name: 'orderId', type: 'uuid', required: true },
      ...(multi ? [{ name: 'storeId', type: 'uuid', required: true } as const] : [])
    ],
    steps: [
      {
        id: 'order',
        kind: 'data.read',
        entityId,
        resultName: 'order',
        fields: [...fields],
        key: { kind: 'parameter', name: 'orderId' },
        scope: multi ? 'tenant' : 'command',
        lock: 'update'
      },
      {
        id: 'pending',
        kind: 'assert',
        left: { kind: 'result', name: 'order', field: 'status' },
        operator: 'eq',
        right: { kind: 'literal', value: 'pending' },
        error: 'conflict'
      },
      {
        id: 'fulfill',
        kind: 'data.mutate',
        operation: 'update',
        entityId,
        record: 'order',
        resultName: 'fulfilled',
        fields: [...fields],
        values: [{ field: 'status', value: { kind: 'literal', value: 'fulfilled' } }]
      }
    ],
    return: { resultName: 'fulfilled', fields: [...fields] }
  }
}

function storeCheckout(app: BackendApplicationSpecV1, checkout: BackendCommandDefinitionIR): void {
  const stores = app.dataModel.entities.find((entity) => entity.name === 'stores')
  const product = checkout.steps.find((step) => step.id === 'product')
  const order = checkout.steps.find((step) => step.id === 'order')
  if (!stores || product?.kind !== 'data.read' || order?.kind !== 'data.mutate')
    throw new Error('Missing store checkout model.')
  product.fields.push('store_id')
  const store: BackendCommandStepIR = {
    id: 'store',
    kind: 'data.read',
    entityId: stores.id,
    resultName: 'store',
    fields: ['id', 'title'],
    key: { kind: 'parameter', name: 'storeId' },
    scope: 'command',
    lock: 'update'
  }
  // Match merchant operations' store-before-product lock order. The submitted selector is
  // checked against the locked product; it never supplies the order's store identity.
  checkout.parameters.push({ name: 'storeId', type: 'uuid', required: true })
  checkout.steps.unshift(store)
  checkout.steps.splice(2, 0, {
    id: 'same-store',
    kind: 'assert',
    left: { kind: 'result', name: 'product', field: 'store_id' },
    operator: 'eq',
    right: { kind: 'result', name: 'store', field: 'id' },
    error: 'conflict'
  })
  order.values.push(
    { field: 'store_id', value: { kind: 'result', name: 'product', field: 'store_id' } },
    { field: 'store_title', value: { kind: 'result', name: 'store', field: 'title' } }
  )
}

export function extendMerchantCommands(
  app: BackendApplicationSpecV1,
  mode: CommerceMerchantMode
): void {
  const commands = app.commands?.commands
  const orders = app.dataModel.entities.find((entity) => entity.name === 'orders')
  const resource = app.httpApi?.resources.find((entry) => entry.id === 'orders')
  if (!commands || !orders || !resource) throw new Error('Missing commerce commands.')
  for (const command of commands) {
    if (command.id === 'restock-product') continue
    for (const step of command.steps)
      if (step.kind !== 'assert' && step.entityId === orders.id)
        step.fields = [...resource.readFields]
    command.return.fields = [...resource.readFields]
  }
  if (mode === 'multi-merchant') {
    const checkout = commands.find((command) => command.id === 'checkout')
    const restock = commands.find((command) => command.id === 'restock-product')
    if (!checkout || !restock) throw new Error('Missing catalog commands.')
    storeCheckout(app, checkout)
    restock.access = {
      kind: 'tenant-member',
      tenantId: 'products-store',
      parameter: 'storeId',
      roleId: 'merchant'
    }
    restock.parameters.push({ name: 'storeId', type: 'uuid', required: true })
    for (const step of restock.steps) if (step.kind === 'data.read') step.scope = 'tenant'
  }
  commands.push(fulfillmentCommand(orders.id, resource.readFields, mode))
}
