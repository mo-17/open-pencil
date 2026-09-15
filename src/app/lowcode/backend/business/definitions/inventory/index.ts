import { INVENTORY_ROLES } from '@/app/lowcode/backend/business/model/inventory/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { inventoryBalancesPage } from './balances'
import { inventoryCatalogPages } from './catalog'
import { inventoryMovementColumns } from './fields'
import { inventoryDispatchesPage, inventoryPurchasesPage } from './orders'

export function procurementInventoryDefinition(): BusinessTemplateDefinition {
  return {
    id: 'procurement-inventory',
    title: t('Purchasing and inventory', '采购与进销存'),
    description: t(
      'Operate one organization’s SKU and warehouse balances through audited receipts, issues, returns and physical counts.',
      '通过留痕的收货、出库、退货和盘点命令管理单组织商品与仓库库存。'
    ),
    entryPage: 'inventory-balances',
    roles: INVENTORY_ROLES,
    pages: [
      accountSetupPage(INVENTORY_ROLES),
      ...inventoryCatalogPages(),
      inventoryBalancesPage(),
      inventoryPurchasesPage(),
      inventoryDispatchesPage(),
      {
        id: 'inventory-movements',
        path: '/inventory/ledger',
        title: t('Stock movement ledger', '库存流水台账'),
        description: t(
          'Append-only quantity history. Managers and operators may read it; there are no create, edit or delete controls. Correct a mistake with a new, version-checked physical count or a bounded return against the original document.',
          '数量变动历史只追加。管理员与操作员可以查阅，不能直接新增、编辑或删除流水。错误通过新的版本校验盘点或关联原单的限额退货修正。'
        ),
        listing: { resourceId: 'inventory-movements', columns: inventoryMovementColumns },
        details: [
          ...inventoryMovementColumns,
          { field: 'balance_id', label: t('Balance reference', '库存位编号') },
          { field: 'source_id', label: t('Source reference', '原单编号') },
          { field: 'actor_subject', label: t('Recorded by', '操作账号') }
        ],
        actions: []
      }
    ]
  }
}
