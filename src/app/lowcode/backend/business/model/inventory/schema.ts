import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessReadResource } from '../permissions'
import {
  INVENTORY_BALANCE_FIELDS,
  INVENTORY_DISPATCH_FIELDS,
  INVENTORY_MOVEMENT_FIELDS,
  INVENTORY_PURCHASE_FIELDS,
  INVENTORY_ROLES,
  INVENTORY_SKU_FIELDS,
  INVENTORY_SUPPLIER_FIELDS,
  INVENTORY_WAREHOUSE_FIELDS,
  type InventoryEntities
} from './fields'

function catalog(
  application: BackendApplicationSpecV1,
  name: string,
  extras: string[]
): DataEntityIR {
  const entity = addBusinessEntity(application, 'inventory_' + name, [
    ...['title', 'description', ...extras].map((field) => businessField(field, 'string')),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
  if (extras.includes('code')) entity.uniques?.push({ id: 'unique-code', fields: ['code'] })
  return entity
}

export function inventoryPolicyIds(entity: DataEntityIR): string[] {
  return INVENTORY_ROLES.map((role) => `${entity.id}-${role}`)
}

function resources(application: BackendApplicationSpecV1, entities: InventoryEntities): void {
  const declarations = [
    [entities.skus, INVENTORY_SKU_FIELDS, ['active'], ['code', 'title', 'description']],
    [entities.warehouses, INVENTORY_WAREHOUSE_FIELDS, ['active'], ['code', 'title', 'description']],
    [entities.suppliers, INVENTORY_SUPPLIER_FIELDS, ['active'], ['title', 'contact']],
    [
      entities.balances,
      INVENTORY_BALANCE_FIELDS,
      ['sku_id', 'warehouse_id'],
      ['sku_title', 'warehouse_title']
    ],
    [
      entities.purchases,
      INVENTORY_PURCHASE_FIELDS,
      ['balance_id', 'supplier_id', 'status'],
      ['sku_title', 'supplier_title']
    ],
    [entities.dispatches, INVENTORY_DISPATCH_FIELDS, ['balance_id'], ['sku_title', 'recipient']],
    [entities.movements, INVENTORY_MOVEMENT_FIELDS, ['balance_id', 'source_id', 'action'], []]
  ] as const
  for (const [entity, fields, filterFields, searchFields] of declarations) {
    const policies = INVENTORY_ROLES.map((roleId, index) =>
      businessGrant(application, entity, inventoryPolicyIds(entity)[index], {
        kind: 'role',
        roleId
      })
    )
    const resource = businessReadResource(
      application,
      entity,
      entity.name.replaceAll('_', '-'),
      fields,
      policies
    )
    resource.query = {
      filterFields: [...filterFields],
      searchFields: [...searchFields],
      sortFields: ['created_at']
    }
  }
}

export function createInventoryEntities(application: BackendApplicationSpecV1): InventoryEntities {
  addBusinessUsers(application, [])
  const skus = catalog(application, 'skus', ['code', 'unit'])
  const warehouses = catalog(application, 'warehouses', ['code'])
  const suppliers = catalog(application, 'suppliers', ['contact'])
  const balances = addBusinessEntity(application, 'inventory_balances', [
    businessField('sku_id', 'uuid'),
    businessField('warehouse_id', 'uuid'),
    ...['sku_title', 'warehouse_title', 'unit'].map((field) => businessField(field, 'string')),
    businessField('quantity', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  balances.uniques?.push({ id: 'sku-warehouse', fields: ['sku_id', 'warehouse_id'] })
  businessEnum(application, 'inventory-purchase-status', ['ordered', 'cancelled'])
  businessEnum(application, 'inventory-movement-action', [
    'receipt',
    'issue',
    'supplier_return',
    'customer_return',
    'adjustment'
  ])
  const purchases = addBusinessEntity(application, 'inventory_purchases', [
    businessField('balance_id', 'uuid'),
    businessField('supplier_id', 'uuid'),
    ...['sku_title', 'warehouse_title', 'supplier_title', 'note'].map((field) =>
      businessField(field, 'string')
    ),
    businessField('ordered_quantity', 'integer'),
    businessField('received_quantity', 'integer', 0),
    businessField('returned_quantity', 'integer', 0),
    businessField('unit_cost_cents', 'integer'),
    businessField('total_cost_cents', 'integer'),
    businessField('ordered_by', 'uuid'),
    businessField('cancel_note', 'string', ''),
    businessField('cancelled_by', 'uuid', null, true),
    businessField('cancelled_at', 'datetime', null, true),
    businessEnumField('status', 'inventory-purchase-status', 'ordered'),
    businessField('version', 'integer', 0)
  ])
  const dispatches = addBusinessEntity(application, 'inventory_dispatches', [
    businessField('balance_id', 'uuid'),
    ...['sku_title', 'warehouse_title', 'recipient', 'note'].map((field) =>
      businessField(field, 'string')
    ),
    businessField('quantity', 'integer'),
    businessField('returned_quantity', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  const movements = addBusinessEntity(application, 'inventory_movements', [
    businessField('balance_id', 'uuid'),
    businessField('source_id', 'uuid'),
    businessEnumField('action', 'inventory-movement-action', 'adjustment'),
    ...['quantity_delta', 'before_quantity', 'after_quantity'].map((field) =>
      businessField(field, 'integer')
    ),
    businessField('actor_subject', 'uuid'),
    businessField('note', 'string')
  ])
  for (const entity of [purchases, dispatches, movements]) {
    linkBusinessOwner(entity, 'balance_id', balances)
    entity.indexes?.push({
      id: 'balance-created',
      fields: ['balance_id', 'created_at', 'id'],
      order: 'desc'
    })
  }
  // Catalog records can belong to different operators in this one organization.
  // Locked commands maintain their references; no delete or direct write route exists.
  const entities = { skus, warehouses, suppliers, balances, purchases, dispatches, movements }
  resources(application, entities)
  return entities
}
