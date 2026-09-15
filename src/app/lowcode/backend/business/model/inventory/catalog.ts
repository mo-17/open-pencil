import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

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
  INVENTORY_BALANCE_FIELDS,
  INVENTORY_MANAGER,
  INVENTORY_SKU_FIELDS,
  INVENTORY_SUPPLIER_FIELDS,
  INVENTORY_WAREHOUSE_FIELDS,
  type InventoryEntities
} from './fields'
import { inventoryRevision } from './steps'

function catalogCommands(
  entity: DataEntityIR,
  kind: string,
  fields: readonly string[],
  immutable: string[] = [],
  mutable: string[] = []
): BackendCommandDefinitionIR[] {
  const parameters = (): BackendCommandParameterIR[] => [
    businessStringParameter('title', 100),
    businessStringParameter('description', 1000),
    ...mutable.map((name) => businessStringParameter(name, 100)),
    { name: 'active', type: 'boolean', required: true }
  ]
  const values = () =>
    ['title', 'description', ...mutable, 'active'].map((field) => ({
      field,
      value: businessParameter(field)
    }))
  const required = (field: string) =>
    businessAssert('nonempty_' + field, businessParameter(field), businessLiteral(''), 'neq')
  return [
    businessCommand(
      `create-inventory-${kind}`,
      `Create inventory ${kind}`,
      { kind: 'role', roleId: INVENTORY_MANAGER },
      [...immutable.map((name) => businessStringParameter(name, 50)), ...parameters()],
      [
        required('title'),
        ...immutable.map(required),
        businessInsert(
          entity,
          'catalog',
          [
            { field: 'owner_id', value: businessCaller() },
            ...immutable.map((field) => ({ field, value: businessParameter(field) })),
            ...values()
          ],
          fields
        )
      ],
      { resultName: 'catalog', fields: [...fields] }
    ),
    businessCommand(
      `update-inventory-${kind}`,
      `Update inventory ${kind}`,
      { kind: 'role', roleId: INVENTORY_MANAGER },
      [businessUUIDParameter(kind + 'Id'), ...parameters()],
      [
        businessRead(entity, 'catalog', businessParameter(kind + 'Id'), fields),
        required('title'),
        businessUpdate(
          entity,
          'catalog',
          'updated',
          [...values(), inventoryRevision('catalog')],
          fields
        )
      ],
      { resultName: 'updated', fields: [...fields] }
    )
  ]
}

export function inventoryCatalogCommands(
  entities: InventoryEntities
): BackendCommandDefinitionIR[] {
  return [
    ...catalogCommands(entities.skus, 'sku', INVENTORY_SKU_FIELDS, ['code', 'unit']),
    ...catalogCommands(entities.warehouses, 'warehouse', INVENTORY_WAREHOUSE_FIELDS, ['code']),
    ...catalogCommands(entities.suppliers, 'supplier', INVENTORY_SUPPLIER_FIELDS, [], ['contact']),
    businessCommand(
      'create-inventory-balance',
      'Open an empty SKU and warehouse stock balance',
      { kind: 'role', roleId: INVENTORY_MANAGER },
      [businessUUIDParameter('skuId'), businessUUIDParameter('warehouseId')],
      [
        businessRead(entities.skus, 'sku', businessParameter('skuId'), INVENTORY_SKU_FIELDS),
        businessAssert('active_sku', businessResult('sku', 'active'), businessLiteral(true)),
        businessRead(
          entities.warehouses,
          'warehouse',
          businessParameter('warehouseId'),
          INVENTORY_WAREHOUSE_FIELDS
        ),
        businessAssert(
          'active_warehouse',
          businessResult('warehouse', 'active'),
          businessLiteral(true)
        ),
        businessInsert(
          entities.balances,
          'balance',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'sku_id', value: businessResult('sku', 'id') },
            { field: 'warehouse_id', value: businessResult('warehouse', 'id') },
            { field: 'sku_title', value: businessResult('sku', 'title') },
            { field: 'warehouse_title', value: businessResult('warehouse', 'title') },
            { field: 'unit', value: businessResult('sku', 'unit') }
          ],
          INVENTORY_BALANCE_FIELDS
        )
      ],
      { resultName: 'balance', fields: [...INVENTORY_BALANCE_FIELDS] }
    )
  ]
}
