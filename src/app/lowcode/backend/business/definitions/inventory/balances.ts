import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import {
  inventoryBalanceColumns,
  inventoryMovementColumns,
  inventoryNoteInput,
  inventoryQuantityInput,
  inventoryRelation
} from './fields'

export function inventoryBalancesPage(): BusinessPageDefinition {
  return {
    id: 'inventory-balances',
    path: '/inventory/stock',
    title: t('Stock balances', '库存余额'),
    description: t(
      'Open one empty balance per SKU and warehouse before purchasing. Receipts, issues and returns atomically change quantity and append ledger rows. Counts require inventory-manager and the selected current version. This catalog is separate from existing commerce and food templates; stock is not synchronized automatically.',
      '采购前先为商品与仓库建立唯一的零库存位。收货、出库和退货会原子更新数量并追加流水。盘点需要 inventory-manager，提交时复核选中版本。本目录与电商、点餐模板独立，不自动同步库存。'
    ),
    listing: { resourceId: 'inventory-balances', columns: inventoryBalanceColumns, search: true },
    details: [
      ...inventoryBalanceColumns,
      { field: 'version', label: t('Current version', '库存版本') }
    ],
    related: [
      {
        resourceId: 'inventory-movements',
        foreignKey: 'balance_id',
        title: t('Stock ledger', '该库存位流水'),
        columns: inventoryMovementColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-inventory-balance',
        en: 'Open stock balance',
        zh: '建立零库存位',
        inputs: [
          inventoryRelation('skuId', 'inventory-skus', 'Active SKU', '启用的商品', true),
          inventoryRelation(
            'warehouseId',
            'inventory-warehouses',
            'Active warehouse',
            '启用的仓库',
            true
          )
        ]
      }),
      formAction({
        id: 'issue-inventory-stock',
        en: 'Issue stock',
        zh: '登记出库',
        inputs: [
          inventoryQuantityInput(),
          textInput('recipient', 'Recipient or customer', '领用人或客户'),
          inventoryNoteInput()
        ],
        parameters: { balanceId: selectedParameter() },
        description: t(
          'Record one issue. The server locks this balance and refuses negative stock. No sale, shipment or payment is created.',
          '登记一笔出库，服务器锁定该库存位并拒绝负库存。不自动创建销售、物流或付款记录。'
        )
      }),
      formAction({
        id: 'adjust-inventory-stock',
        en: 'Post physical count',
        zh: '登记盘点调整',
        inputs: [
          {
            key: 'countedQuantity',
            label: t('Counted on-hand quantity', '实盘库存数量'),
            kind: 'number',
            min: 0,
            max: 2147483647,
            required: true
          },
          inventoryNoteInput()
        ],
        parameters: {
          balanceId: selectedParameter(),
          expectedVersion: selectedParameter('version')
        },
        description: t(
          'Count actual stock and explain the difference. If another transaction changed the version, refresh and recount. This appends a correction; it never rewrites earlier ledger rows.',
          '核对实盘数量并填写差异原因。如期间发生收发货导致版本变化，请刷新后重新盘点。此操作追加调整流水，不改写历史。'
        )
      })
    ]
  }
}
