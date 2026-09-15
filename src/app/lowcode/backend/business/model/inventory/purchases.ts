import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
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
  INVENTORY_MAX,
  INVENTORY_PURCHASE_FIELDS,
  INVENTORY_SUPPLIER_FIELDS,
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

function readPurchase(entities: InventoryEntities) {
  return [
    readInventoryBalance(entities),
    businessRead(
      entities.purchases,
      'purchase',
      businessParameter('purchaseId'),
      INVENTORY_PURCHASE_FIELDS
    ),
    businessAssert(
      'purchase_balance_matches',
      businessResult('purchase', 'balance_id'),
      businessResult('balance', 'id')
    ),
    businessAssert(
      'purchase_ordered',
      businessResult('purchase', 'status'),
      businessLiteral('ordered')
    )
  ]
}

function purchaseReceipt(
  entities: InventoryEntities,
  supplierReturn: boolean
): BackendCommandDefinitionIR {
  const counter = supplierReturn ? 'returned_quantity' : 'received_quantity'
  const next = inventoryArithmetic(
    'add',
    businessResult('purchase', counter),
    businessParameter('quantity')
  )
  return businessCommand(
    supplierReturn ? 'return-inventory-purchase' : 'receive-inventory-purchase',
    supplierReturn
      ? 'Return received stock to the original supplier'
      : 'Receive part of an existing purchase',
    inventoryAccess(entities),
    [
      businessUUIDParameter('balanceId'),
      businessUUIDParameter('purchaseId'),
      inventoryQuantity(),
      businessStringParameter('note', 500)
    ],
    [
      ...readPurchase(entities),
      businessAssert(
        'bounded_purchase_quantity',
        next,
        businessResult('purchase', supplierReturn ? 'received_quantity' : 'ordered_quantity'),
        'lte'
      ),
      businessUpdate(
        entities.purchases,
        'purchase',
        'updated_purchase',
        [{ field: counter, value: next }, inventoryRevision('purchase')],
        INVENTORY_PURCHASE_FIELDS
      ),
      ...inventoryMovement(
        entities,
        supplierReturn ? 'supplier_return' : 'receipt',
        businessResult('purchase', 'id'),
        inventoryArithmetic(
          supplierReturn ? 'subtract' : 'add',
          businessResult('balance', 'quantity'),
          businessParameter('quantity')
        )
      )
    ],
    { resultName: 'updated_purchase', fields: [...INVENTORY_PURCHASE_FIELDS] }
  )
}

export function inventoryPurchaseCommands(
  entities: InventoryEntities
): BackendCommandDefinitionIR[] {
  const total = inventoryArithmetic(
    'multiply',
    businessParameter('quantity'),
    businessParameter('unitCostCents')
  )
  return [
    businessCommand(
      'create-inventory-purchase',
      'Order one SKU into one warehouse',
      inventoryAccess(entities, true),
      [
        businessUUIDParameter('balanceId'),
        businessUUIDParameter('supplierId'),
        inventoryQuantity(),
        { name: 'unitCostCents', type: 'integer', required: true, min: 0, max: 1000000 },
        businessStringParameter('note', 500)
      ],
      [
        readInventoryBalance(entities),
        ...activeInventoryCatalog(entities),
        businessRead(
          entities.suppliers,
          'supplier',
          businessParameter('supplierId'),
          INVENTORY_SUPPLIER_FIELDS
        ),
        businessAssert(
          'active_supplier',
          businessResult('supplier', 'active'),
          businessLiteral(true)
        ),
        businessAssert('bounded_purchase_cost', total, businessLiteral(INVENTORY_MAX), 'lte'),
        businessInsert(
          entities.purchases,
          'purchase',
          [
            { field: 'owner_id', value: businessResult('balance', 'owner_id') },
            { field: 'balance_id', value: businessResult('balance', 'id') },
            { field: 'supplier_id', value: businessResult('supplier', 'id') },
            { field: 'sku_title', value: businessResult('balance', 'sku_title') },
            { field: 'warehouse_title', value: businessResult('balance', 'warehouse_title') },
            { field: 'supplier_title', value: businessResult('supplier', 'title') },
            { field: 'ordered_quantity', value: businessParameter('quantity') },
            { field: 'unit_cost_cents', value: businessParameter('unitCostCents') },
            { field: 'total_cost_cents', value: total },
            { field: 'ordered_by', value: businessCaller() },
            { field: 'note', value: businessParameter('note') }
          ],
          INVENTORY_PURCHASE_FIELDS
        )
      ],
      { resultName: 'purchase', fields: [...INVENTORY_PURCHASE_FIELDS] }
    ),
    businessCommand(
      'cancel-inventory-purchase',
      'Cancel an unreceived purchase',
      inventoryAccess(entities, true),
      [
        businessUUIDParameter('balanceId'),
        businessUUIDParameter('purchaseId'),
        businessStringParameter('note', 500)
      ],
      [
        ...readPurchase(entities),
        businessAssert(
          'not_received',
          businessResult('purchase', 'received_quantity'),
          businessLiteral(0)
        ),
        businessUpdate(
          entities.purchases,
          'purchase',
          'updated_purchase',
          [
            { field: 'status', value: businessLiteral('cancelled') },
            { field: 'cancel_note', value: businessParameter('note') },
            { field: 'cancelled_by', value: businessCaller() },
            { field: 'cancelled_at', value: { kind: 'server-now' } },
            inventoryRevision('purchase')
          ],
          INVENTORY_PURCHASE_FIELDS
        )
      ],
      { resultName: 'updated_purchase', fields: [...INVENTORY_PURCHASE_FIELDS] }
    ),
    purchaseReceipt(entities, false),
    purchaseReceipt(entities, true)
  ]
}
