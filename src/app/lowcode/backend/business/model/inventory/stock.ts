import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUpdate,
  businessUUIDParameter
} from '../commands'
import {
  INVENTORY_BALANCE_FIELDS,
  INVENTORY_DISPATCH_FIELDS,
  INVENTORY_MAX,
  type InventoryEntities
} from './fields'
import {
  activeInventoryCatalog,
  inventoryAccess,
  inventoryArithmetic,
  inventoryMovement,
  inventoryQuantity,
  inventoryRevision,
  readInventoryBalance
} from './steps'

export function inventoryStockCommands(entities: InventoryEntities): BackendCommandDefinitionIR[] {
  const returned = inventoryArithmetic(
    'add',
    businessResult('dispatch', 'returned_quantity'),
    businessParameter('quantity')
  )
  return [
    businessCommand(
      'issue-inventory-stock',
      'Issue stock and record its original recipient',
      inventoryAccess(entities),
      [
        businessUUIDParameter('balanceId'),
        inventoryQuantity(),
        businessStringParameter('recipient', 100),
        businessStringParameter('note', 500)
      ],
      [
        readInventoryBalance(entities),
        ...activeInventoryCatalog(entities),
        businessAssert(
          'nonempty_recipient',
          businessParameter('recipient'),
          businessLiteral(''),
          'neq'
        ),
        businessInsert(
          entities.dispatches,
          'dispatch',
          [
            { field: 'owner_id', value: businessResult('balance', 'owner_id') },
            { field: 'balance_id', value: businessResult('balance', 'id') },
            { field: 'sku_title', value: businessResult('balance', 'sku_title') },
            { field: 'warehouse_title', value: businessResult('balance', 'warehouse_title') },
            { field: 'quantity', value: businessParameter('quantity') },
            { field: 'recipient', value: businessParameter('recipient') },
            { field: 'note', value: businessParameter('note') }
          ],
          INVENTORY_DISPATCH_FIELDS
        ),
        ...inventoryMovement(
          entities,
          'issue',
          businessResult('dispatch', 'id'),
          inventoryArithmetic(
            'subtract',
            businessResult('balance', 'quantity'),
            businessParameter('quantity')
          )
        )
      ],
      { resultName: 'dispatch', fields: [...INVENTORY_DISPATCH_FIELDS] }
    ),
    businessCommand(
      'return-inventory-dispatch',
      'Return stock from an existing issue',
      inventoryAccess(entities),
      [
        businessUUIDParameter('balanceId'),
        businessUUIDParameter('dispatchId'),
        inventoryQuantity(),
        businessStringParameter('note', 500)
      ],
      [
        readInventoryBalance(entities),
        businessRead(
          entities.dispatches,
          'dispatch',
          businessParameter('dispatchId'),
          INVENTORY_DISPATCH_FIELDS
        ),
        businessAssert(
          'dispatch_balance_matches',
          businessResult('dispatch', 'balance_id'),
          businessResult('balance', 'id')
        ),
        businessAssert(
          'bounded_return_quantity',
          returned,
          businessResult('dispatch', 'quantity'),
          'lte'
        ),
        businessUpdate(
          entities.dispatches,
          'dispatch',
          'updated_dispatch',
          [{ field: 'returned_quantity', value: returned }, inventoryRevision('dispatch')],
          INVENTORY_DISPATCH_FIELDS
        ),
        ...inventoryMovement(
          entities,
          'customer_return',
          businessResult('dispatch', 'id'),
          inventoryArithmetic(
            'add',
            businessResult('balance', 'quantity'),
            businessParameter('quantity')
          )
        )
      ],
      { resultName: 'updated_dispatch', fields: [...INVENTORY_DISPATCH_FIELDS] }
    ),
    businessCommand(
      'adjust-inventory-stock',
      'Post a counted stock balance with version protection',
      inventoryAccess(entities, true),
      [
        businessUUIDParameter('balanceId'),
        { name: 'expectedVersion', type: 'integer', required: true, min: 0, max: INVENTORY_MAX },
        { name: 'countedQuantity', type: 'integer', required: true, min: 0, max: INVENTORY_MAX },
        businessStringParameter('note', 500)
      ],
      [
        readInventoryBalance(entities),
        businessAssert(
          'current_count_version',
          businessResult('balance', 'version'),
          businessParameter('expectedVersion')
        ),
        businessAssert(
          'count_changed',
          businessResult('balance', 'quantity'),
          businessParameter('countedQuantity'),
          'neq'
        ),
        businessAssert(
          'count_reason_required',
          businessParameter('note'),
          businessLiteral(''),
          'neq'
        ),
        ...inventoryMovement(
          entities,
          'adjustment',
          businessResult('balance', 'id'),
          businessParameter('countedQuantity')
        )
      ],
      { resultName: 'updated_balance', fields: [...INVENTORY_BALANCE_FIELDS] }
    )
  ]
}
