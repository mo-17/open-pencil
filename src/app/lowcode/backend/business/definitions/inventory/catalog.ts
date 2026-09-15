import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import { inventoryActiveChoices } from './fields'

const catalogKinds = [
  {
    kind: 'sku',
    plural: 'skus',
    en: 'SKUs',
    zh: '商品档案',
    immutable: ['code', 'unit'],
    mutable: []
  },
  {
    kind: 'warehouse',
    plural: 'warehouses',
    en: 'Warehouses',
    zh: '仓库档案',
    immutable: ['code'],
    mutable: []
  },
  {
    kind: 'supplier',
    plural: 'suppliers',
    en: 'Suppliers',
    zh: '供应商档案',
    immutable: [],
    mutable: ['contact']
  }
] as const

function fieldInput(field: 'code' | 'unit' | 'contact'): BusinessInput {
  const labels = {
    code: t('Code', '编码'),
    unit: t('Stock unit', '库存单位'),
    contact: t('Contact', '联系方式')
  }
  return {
    key: field,
    label: labels[field],
    kind: 'text',
    maxLength: field === 'contact' ? 100 : 50,
    required: true
  }
}

export function inventoryCatalogPages(): BusinessPageDefinition[] {
  return catalogKinds.map((entry) => {
    const columns: BusinessColumn[] = [
      { field: 'title', label: t('Name', '名称') },
      ...entry.immutable.map((field) => ({ field, label: fieldInput(field).label })),
      ...entry.mutable.map((field) => ({ field, label: fieldInput(field).label })),
      { field: 'active', label: t('Active', '启用状态') }
    ]
    const inputs = (editing: boolean): BusinessInput[] => {
      const fields: BusinessInput[] = [
        textInput('title', 'Name', '名称'),
        textInput('description', 'Description', '说明', 1000),
        ...entry.mutable.map(fieldInput),
        {
          key: 'active',
          label: t('Active', '启用状态'),
          kind: 'select',
          required: true,
          choices: inventoryActiveChoices
        }
      ]
      return fields.map((input) => ({ ...input, ...(editing ? { fromSelection: input.key } : {}) }))
    }
    return {
      id: `inventory-${entry.plural}`,
      path: `/inventory/${entry.plural}`,
      title: t(entry.en, entry.zh),
      description: t(
        'Inventory managers maintain this organization’s catalog. SKU codes and units, and warehouse codes, cannot be changed after creation. Disabling prevents new purchase and issue operations; existing receipts, returns and audited counts remain possible.',
        '由 inventory-manager 管理本组织档案。商品编码、库存单位及仓库编码创建后不可修改。停用会阻止新采购与出库，已有单据收货、退货及留痕盘点仍可处理。'
      ),
      listing: {
        resourceId: `inventory-${entry.plural}`,
        columns,
        search: true,
        filter: { field: 'active', choices: inventoryActiveChoices }
      },
      details: [
        ...columns,
        { field: 'description', label: t('Description', '说明'), multiline: true }
      ],
      actions: [
        formAction({
          id: `create-inventory-${entry.kind}`,
          en: `Create ${entry.kind}`,
          zh: '新增档案',
          inputs: [...entry.immutable.map(fieldInput), ...inputs(false)]
        }),
        formAction({
          id: `update-inventory-${entry.kind}`,
          en: `Edit ${entry.kind}`,
          zh: '编辑档案',
          inputs: inputs(true),
          parameters: { [entry.kind + 'Id']: selectedParameter() }
        })
      ]
    }
  })
}
