import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  inventoryDispatchColumns,
  inventoryMovementColumns,
  inventoryNoteInput,
  inventoryPurchaseColumns,
  inventoryQuantityInput,
  inventoryRelation
} from './fields'

export function inventoryPurchasesPage(): BusinessPageDefinition {
  const selection = { balanceId: selectedParameter('balance_id'), purchaseId: selectedParameter() }
  return {
    id: 'inventory-purchases',
    path: '/inventory/purchases',
    title: t('Purchases and receipts', '采购与收货'),
    description: t(
      'Each purchase has one SKU, one warehouse and one supplier. Managers record the agreed unit cost in cents; the server calculates the total. Receive in parts up to the ordered quantity. Supplier returns cannot exceed cumulative receipts or available stock and do not reopen the original receipt allowance. Multiple-SKU orders and payments are added after export.',
      '每张采购单只含一个商品、一个仓库与一个供应商。管理员填写约定单价（分），总价由服务器计算。允许分批收货但不得超采；退供不能超过累计收货或现存库存，退供不会恢复原单收货额度。多商品整单和付款需导出后接入。'
    ),
    listing: {
      resourceId: 'inventory-purchases',
      columns: inventoryPurchaseColumns,
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'ordered', label: t('Ordered', '已采购') },
          { value: 'cancelled', label: t('Cancelled', '已取消') }
        ]
      }
    },
    details: [
      ...inventoryPurchaseColumns,
      { field: 'unit_cost_cents', label: t('Unit cost (cents)', '采购单价（分）') },
      { field: 'total_cost_cents', label: t('Order total (cents)', '采购总额（分）') },
      { field: 'note', label: t('Order note', '采购说明'), multiline: true },
      { field: 'cancel_note', label: t('Cancellation reason', '取消原因') }
    ],
    related: [
      {
        resourceId: 'inventory-movements',
        foreignKey: 'source_id',
        title: t('Receipt and return ledger', '该采购单收退货流水'),
        columns: inventoryMovementColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-inventory-purchase',
        en: 'Create purchase',
        zh: '登记采购单',
        inputs: [
          inventoryRelation(
            'balanceId',
            'inventory-balances',
            'SKU and warehouse balance',
            '商品与仓库库存位'
          ),
          inventoryRelation(
            'supplierId',
            'inventory-suppliers',
            'Active supplier',
            '启用的供应商',
            true
          ),
          inventoryQuantityInput(),
          {
            key: 'unitCostCents',
            label: t('Agreed unit cost (cents)', '约定采购单价（分）'),
            kind: 'number',
            min: 0,
            max: 1000000,
            required: true
          },
          inventoryNoteInput()
        ]
      }),
      ...[
        ['receive-inventory-purchase', 'Receive purchase', '登记采购收货'],
        ['return-inventory-purchase', 'Return to supplier', '登记退供']
      ].map(([id, en, zh]) =>
        formAction({
          id,
          en,
          zh,
          inputs: [inventoryQuantityInput(), inventoryNoteInput()],
          parameters: selection,
          when: { field: 'status', values: ['ordered'] }
        })
      ),
      formAction({
        id: 'cancel-inventory-purchase',
        en: 'Cancel unreceived purchase',
        zh: '取消尚未收货采购',
        inputs: [inventoryNoteInput()],
        parameters: selection,
        when: { field: 'status', values: ['ordered'] },
        description: t(
          'Only a manager may cancel a purchase with zero receipts. A received purchase stays in history and uses supplier returns instead.',
          '仅管理员可取消尚未收货的采购单。有收货记录的采购单必须保留，退货请登记退供。'
        )
      })
    ]
  }
}

export function inventoryDispatchesPage(): BusinessPageDefinition {
  return {
    id: 'inventory-dispatches',
    path: '/inventory/issues',
    title: t('Issues and customer returns', '出库与退回'),
    description: t(
      'Review original issues, then record returned quantities against the same issue. Cumulative returns cannot exceed the issued quantity. Stock is returned to the original warehouse; no refund is performed.',
      '核对原出库单后登记退回。累计退回不得超过原出库数量，库存回到原仓库；此操作不退款。'
    ),
    listing: {
      resourceId: 'inventory-dispatches',
      columns: inventoryDispatchColumns,
      search: true
    },
    details: [
      ...inventoryDispatchColumns,
      { field: 'note', label: t('Issue note', '出库说明'), multiline: true }
    ],
    related: [
      {
        resourceId: 'inventory-movements',
        foreignKey: 'source_id',
        title: t('Issue and return ledger', '该出库单流水'),
        columns: inventoryMovementColumns
      }
    ],
    actions: [
      formAction({
        id: 'return-inventory-dispatch',
        en: 'Record returned stock',
        zh: '登记客户或领用退回',
        inputs: [inventoryQuantityInput(), inventoryNoteInput()],
        parameters: { balanceId: selectedParameter('balance_id'), dispatchId: selectedParameter() }
      })
    ]
  }
}
