import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const assetStatusChoices = [
  { value: 'available', label: t('Available', '在库可用') },
  { value: 'in_use', label: t('In use', '已交付使用') },
  { value: 'repair', label: t('Under repair', '维修中') },
  { value: 'retired', label: t('Retired', '已报废') }
] as const
export const assetRequestStatusChoices = [
  { value: 'requested', label: t('Awaiting handover', '待交付') },
  { value: 'issued', label: t('Issued', '已交付') },
  { value: 'returned', label: t('Returned', '已归还') },
  { value: 'cancelled', label: t('Cancelled', '已取消') },
  { value: 'rejected', label: t('Rejected', '已拒绝') }
] as const
export const assetColumns: BusinessColumn[] = [
  { field: 'tag', label: t('Asset tag', '资产标签') },
  { field: 'title', label: t('Asset name', '资产名称') },
  { field: 'category', label: t('Category', '类别') },
  { field: 'location', label: t('Storage location', '存放地点') },
  { field: 'status', label: t('Asset status', '资产状态') }
]
export const assetDetails: BusinessColumn[] = [
  ...assetColumns,
  { field: 'description', label: t('Description', '资产说明'), multiline: true },
  { field: 'version', label: t('Version', '资产版本') }
]
export const assetRequestColumns: BusinessColumn[] = [
  { field: 'asset_tag', label: t('Asset tag', '资产标签') },
  { field: 'asset_title', label: t('Asset name at request', '申请时资产名称') },
  { field: 'borrower_name', label: t('Applicant display name', '申请人显示名称') },
  { field: 'kind', label: t('Assignment or loan', '领用或借用') },
  { field: 'status', label: t('Request status', '申请状态') }
]
export const assetRequestDetails: BusinessColumn[] = [
  ...assetRequestColumns,
  { field: 'due_at', label: t('Loan due time', '借用归还截止时间') },
  { field: 'purpose', label: t('Purpose', '使用用途'), multiline: true },
  { field: 'issued_at', label: t('Handover recorded at', '交付登记时间') },
  { field: 'returned_at', label: t('Return recorded at', '归还登记时间') },
  { field: 'fulfillment_note', label: t('Latest handling note', '最近处理说明'), multiline: true },
  { field: 'version', label: t('Request version', '申请版本') }
]
export const assetHistoryColumns: BusinessColumn[] = [
  { field: 'action', label: t('Action', '操作') },
  { field: 'before_status', label: t('Previous asset status', '原资产状态') },
  { field: 'after_status', label: t('Resulting asset status', '新资产状态') },
  { field: 'after_request_status', label: t('Resulting request status', '新申请状态') },
  { field: 'note', label: t('Explanation', '说明'), multiline: true },
  { field: 'created_at', label: t('Recorded at', '记录时间') }
]
export const assetNote = (): BusinessInput => ({
  ...textInput('note', 'Handling explanation', '处理说明', 500),
  required: true
})
export function assetInputs(editing = false): BusinessInput[] {
  return [
    textInput('title', 'Asset name', '资产名称', 200),
    textInput('category', 'Category', '类别'),
    textInput('location', 'Storage location', '存放地点', 200),
    textInput('description', 'Description', '资产说明', 2000)
  ].map((input) => ({ ...input, ...(editing ? { fromSelection: input.key } : {}) }))
}
