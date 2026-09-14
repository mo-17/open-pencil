import type { DataEntityIR, DataForeignKeyIR } from '../types'
import type { BackendValidationContext } from '../validation-helpers'
import { commerceError } from './shape'
import type { BackendCommerceEntitiesIR } from './types'

type EntityKey = keyof BackendCommerceEntitiesIR

/** Private references preserve the buyer owner; public catalog references remain single-column. */
export function commerceEntityForeignKeys(
  key: EntityKey,
  entities: BackendCommerceEntitiesIR
): DataForeignKeyIR[] {
  const references: Partial<Record<EntityKey, Record<string, EntityKey>>> = {
    products: { store_id: 'stores' },
    cartItems: { cart_id: 'carts', sku_id: 'products', store_id: 'stores' },
    orders: { payment_group_id: 'paymentGroups', store_id: 'stores' },
    orderItems: {
      order_id: 'orders',
      payment_group_id: 'paymentGroups',
      sku_id: 'products',
      store_id: 'stores'
    },
    refunds: { order_id: 'orders', payment_group_id: 'paymentGroups', store_id: 'stores' },
    shipments: { order_id: 'orders', store_id: 'stores' },
    settlements: { order_id: 'orders', payment_group_id: 'paymentGroups', store_id: 'stores' }
  }
  return Object.entries(references[key] ?? {}).map(([field, target]): DataForeignKeyIR => {
    const privateTarget = !['stores', 'products'].includes(target)
    return {
      id: entities[key] + '-' + field,
      fields: privateTarget ? [field, 'owner_id'] : [field],
      targetEntityId: entities[target],
      targetFields: privateTarget ? ['id', 'owner_id'] : ['id'],
      onDelete: 'restrict'
    }
  })
}

function sameReference(actual: DataForeignKeyIR, expected: DataForeignKeyIR): boolean {
  return (
    actual.targetEntityId === expected.targetEntityId &&
    actual.fields.length === expected.fields.length &&
    actual.targetFields.length === expected.targetFields.length &&
    expected.fields.every((field, index) => actual.fields[index] === field) &&
    expected.targetFields.every((field, index) => actual.targetFields[index] === field) &&
    ['restrict', 'no-action'].includes(actual.onDelete)
  )
}

export function validateCommerceRelationships(
  entity: DataEntityIR,
  key: EntityKey,
  entities: BackendCommerceEntitiesIR,
  context: BackendValidationContext
): void {
  const expected = commerceEntityForeignKeys(key, entities)
  const actual = entity.foreignKeys ?? []
  if (
    actual.length !== expected.length ||
    expected.some((reference) => !actual.some((entry) => sameReference(entry, reference)))
  ) {
    commerceError(
      context,
      '$.commerce.entities.' + key,
      'Commerce relationships must preserve exact owner-composite private references and single-column public catalog references.'
    )
  }
}
