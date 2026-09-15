import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

export const inventoryActiveChoices = [
  { value: true, label: t('Active', '启用') },
  { value: false, label: t('Inactive', '停用') }
]
export const inventoryBalanceColumns: BusinessColumn[] = [
  { field: 'sku_title', label: t('SKU', '商品') },
  { field: 'warehouse_title', label: t('Warehouse', '仓库') },
  { field: 'quantity', label: t('On hand', '当前库存') },
  { field: 'unit', label: t('Unit', '单位') }
]
export const inventoryMovementColumns: BusinessColumn[] = [
  { field: 'action', label: t('Movement', '业务类型') },
  { field: 'quantity_delta', label: t('Quantity change', '数量变动') },
  { field: 'before_quantity', label: t('Before', '变动前') },
  { field: 'after_quantity', label: t('After', '变动后') },
  { field: 'note', label: t('Reason', '说明') },
  { field: 'created_at', label: t('Recorded at', '记账时间') }
]
export const inventoryPurchaseColumns: BusinessColumn[] = [
  { field: 'sku_title', label: t('SKU', '商品') },
  { field: 'warehouse_title', label: t('Warehouse', '仓库') },
  { field: 'supplier_title', label: t('Supplier', '供应商') },
  { field: 'ordered_quantity', label: t('Ordered', '采购数量') },
  { field: 'received_quantity', label: t('Received to date', '累计收货') },
  { field: 'returned_quantity', label: t('Returned to supplier', '累计退供') },
  { field: 'status', label: t('Status', '状态') }
]
export const inventoryDispatchColumns: BusinessColumn[] = [
  { field: 'sku_title', label: t('SKU', '商品') },
  { field: 'warehouse_title', label: t('Warehouse', '仓库') },
  { field: 'quantity', label: t('Issued', '出库数量') },
  { field: 'returned_quantity', label: t('Returned to date', '累计退回') },
  { field: 'recipient', label: t('Recipient', '领用人或客户') }
]
export const inventoryQuantityInput = (): BusinessInput => ({
  key: 'quantity',
  label: t('Quantity', '本次数量'),
  kind: 'number',
  min: 1,
  max: 1000000,
  required: true
})
export const inventoryNoteInput = (): BusinessInput => ({
  key: 'note',
  label: t('Reason or reference', '原因或业务单号'),
  kind: 'textarea',
  maxLength: 500,
  required: true
})
export function inventoryRelation(
  key: string,
  resourceId: string,
  en: string,
  zh: string,
  active = false
): BusinessInput {
  return {
    key,
    label: t(en, zh),
    kind: 'relation',
    required: true,
    relation: {
      resourceId,
      labelField: resourceId === 'inventory-balances' ? 'sku_title' : 'title',
      ...(resourceId === 'inventory-balances' ? { columns: inventoryBalanceColumns } : {}),
      ...(active ? { filters: { active: { kind: 'literal', value: true } } } : {})
    }
  }
}
