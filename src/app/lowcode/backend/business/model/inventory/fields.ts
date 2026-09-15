import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const INVENTORY_ROLES = ['inventory-manager', 'inventory-operator'] as const
export const INVENTORY_MANAGER = 'inventory-manager'
export const INVENTORY_MAX = 2147483647
export const INVENTORY_QUANTITY_MAX = 1000000
export const INVENTORY_CATALOG_FIELDS = [
  'id',
  'title',
  'description',
  'active',
  'version',
  'created_at'
]
export const INVENTORY_SKU_FIELDS = [...INVENTORY_CATALOG_FIELDS, 'code', 'unit']
export const INVENTORY_WAREHOUSE_FIELDS = [...INVENTORY_CATALOG_FIELDS, 'code']
export const INVENTORY_SUPPLIER_FIELDS = [...INVENTORY_CATALOG_FIELDS, 'contact']
export const INVENTORY_BALANCE_FIELDS = [
  'id',
  'sku_id',
  'warehouse_id',
  'sku_title',
  'warehouse_title',
  'unit',
  'quantity',
  'version',
  'created_at'
]
export const INVENTORY_PURCHASE_FIELDS = [
  'id',
  'balance_id',
  'supplier_id',
  'sku_title',
  'warehouse_title',
  'supplier_title',
  'ordered_quantity',
  'received_quantity',
  'returned_quantity',
  'unit_cost_cents',
  'total_cost_cents',
  'status',
  'note',
  'ordered_by',
  'cancel_note',
  'cancelled_by',
  'cancelled_at',
  'version',
  'created_at'
]
export const INVENTORY_DISPATCH_FIELDS = [
  'id',
  'balance_id',
  'sku_title',
  'warehouse_title',
  'quantity',
  'returned_quantity',
  'recipient',
  'note',
  'version',
  'created_at'
]
export const INVENTORY_MOVEMENT_FIELDS = [
  'id',
  'balance_id',
  'source_id',
  'action',
  'quantity_delta',
  'before_quantity',
  'after_quantity',
  'actor_subject',
  'note',
  'created_at'
]

export interface InventoryEntities {
  skus: DataEntityIR
  warehouses: DataEntityIR
  suppliers: DataEntityIR
  balances: DataEntityIR
  purchases: DataEntityIR
  dispatches: DataEntityIR
  movements: DataEntityIR
}
