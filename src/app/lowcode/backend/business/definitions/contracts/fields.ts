import {
  businessText as t,
  type BusinessInput,
  type BusinessParameterSource
} from '@/app/lowcode/backend/business/types'

import { selectedParameter, textInput } from '../shared'

export const contractSelected = (key: string): Record<string, BusinessParameterSource> => ({
  [key]: selectedParameter(),
  expectedVersion: selectedParameter('version')
})

export const contractEvidenceInputs = (requiredNote = false): BusinessInput[] => [
  { ...textInput('reference', 'External evidence reference', '外部凭据编号', 200), required: true },
  { ...textInput('note', 'Administrative note', '操作说明', 500), required: requiredNote }
]

export const contractActiveInput = (): BusinessInput => ({
  key: 'active',
  label: t('Available for new quotes', '可用于新报价'),
  kind: 'select',
  initial: 'true',
  choices: [
    { value: true, label: t('Active', '有效') },
    { value: false, label: t('Inactive', '停用') }
  ]
})

export function contractPrefill(inputs: BusinessInput[], edit: boolean): BusinessInput[] {
  const fields: Record<string, string> = {
    partyId: 'party_id',
    itemTitle: 'item_title',
    unitPriceCents: 'unit_price_cents'
  }
  return inputs.map((input) =>
    edit ? { ...input, fromSelection: fields[input.key] ?? input.key } : input
  )
}

export const quoteColumns = [
  { field: 'title', label: t('Quote', '报价') },
  { field: 'party_title', label: t('Counterparty', '对方') },
  { field: 'total_cents', label: t('Total (CNY cents)', '总额（人民币分）') }
]

export const quoteDetails = [
  { field: 'item_title', label: t('Item', '项目') },
  { field: 'quantity', label: t('Quantity', '数量') },
  { field: 'unit_price_cents', label: t('Unit price (CNY cents)', '单价（人民币分）') },
  { field: 'party_contact', label: t('Counterparty contact', '对方联系方式') },
  { field: 'description', label: t('Scope and terms', '范围与条款'), multiline: true }
]

export const contractStatusChoices = [
  { value: 'active', label: t('In progress', '履行中') },
  { value: 'closed', label: t('Closed', '已结案') },
  { value: 'cancelled', label: t('Cancelled', '已取消') }
]

export const deliveryColumns = [
  { field: 'title', label: t('Delivery stage', '交付阶段') },
  { field: 'sequence', label: t('Sequence', '顺序') },
  { field: 'quantity', label: t('Quantity', '数量') },
  { field: 'status', label: t('Status', '状态') }
]
