import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandParameterIR,
  BackendCommandStepIR,
  BackendCommandValueIR,
  BackendCommandValueSourceIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessUpdate
} from '../commands'
import {
  INVENTORY_BALANCE_FIELDS,
  INVENTORY_MANAGER,
  INVENTORY_MAX,
  INVENTORY_MOVEMENT_FIELDS,
  INVENTORY_QUANTITY_MAX,
  INVENTORY_SKU_FIELDS,
  INVENTORY_WAREHOUSE_FIELDS,
  type InventoryEntities
} from './fields'
import { inventoryPolicyIds } from './schema'

export const inventoryQuantity = (name = 'quantity', min = 1): BackendCommandParameterIR => ({
  name,
  type: 'integer',
  required: true,
  min,
  max: INVENTORY_QUANTITY_MAX
})
export function inventoryArithmetic(
  operator: 'add' | 'subtract' | 'multiply',
  left: BackendCommandLeafIR,
  right: BackendCommandLeafIR
): BackendCommandValueSourceIR {
  return { kind: 'integer-arithmetic', operator, left, right }
}
export const inventoryRevision = (record: string): BackendCommandValueIR => ({
  field: 'version',
  value: inventoryArithmetic('add', businessResult(record, 'version'), businessLiteral(1))
})
export function inventoryAccess(
  entities: InventoryEntities,
  manager = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.balances.id,
    parameter: 'balanceId',
    policyIds: inventoryPolicyIds(entities.balances),
    ...(manager ? { roleId: INVENTORY_MANAGER } : {})
  }
}
export const readInventoryBalance = (entities: InventoryEntities) =>
  businessRead(entities.balances, 'balance', businessParameter('balanceId'), [
    'owner_id',
    ...INVENTORY_BALANCE_FIELDS
  ])

export function activeInventoryCatalog(entities: InventoryEntities): BackendCommandStepIR[] {
  return [
    businessRead(entities.skus, 'sku', businessResult('balance', 'sku_id'), INVENTORY_SKU_FIELDS),
    businessAssert('active_sku', businessResult('sku', 'active'), businessLiteral(true)),
    businessRead(
      entities.warehouses,
      'warehouse',
      businessResult('balance', 'warehouse_id'),
      INVENTORY_WAREHOUSE_FIELDS
    ),
    businessAssert('active_warehouse', businessResult('warehouse', 'active'), businessLiteral(true))
  ]
}

/** All quantity changes and their immutable ledger entry commit together under the balance lock. */
export function inventoryMovement(
  entities: InventoryEntities,
  action: string,
  source: BackendCommandLeafIR,
  nextQuantity: BackendCommandValueSourceIR
): BackendCommandStepIR[] {
  return [
    businessAssert('nonnegative_balance', nextQuantity, businessLiteral(0), 'gte'),
    businessAssert('bounded_balance', nextQuantity, businessLiteral(INVENTORY_MAX), 'lte'),
    businessUpdate(
      entities.balances,
      'balance',
      'updated_balance',
      [{ field: 'quantity', value: nextQuantity }, inventoryRevision('balance')],
      INVENTORY_BALANCE_FIELDS
    ),
    businessInsert(
      entities.movements,
      'movement',
      [
        { field: 'owner_id', value: businessResult('balance', 'owner_id') },
        { field: 'balance_id', value: businessResult('balance', 'id') },
        { field: 'source_id', value: source },
        { field: 'action', value: businessLiteral(action) },
        {
          field: 'quantity_delta',
          value: inventoryArithmetic(
            'subtract',
            businessResult('updated_balance', 'quantity'),
            businessResult('balance', 'quantity')
          )
        },
        { field: 'before_quantity', value: businessResult('balance', 'quantity') },
        { field: 'after_quantity', value: businessResult('updated_balance', 'quantity') },
        { field: 'actor_subject', value: businessCaller() },
        { field: 'note', value: businessParameter('note') }
      ],
      INVENTORY_MOVEMENT_FIELDS
    )
  ]
}
