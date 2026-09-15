import type { ApprovalKind } from '@/app/lowcode/backend/business/model/approvals/fields'
import {
  businessText as t,
  type BusinessChoice,
  type BusinessInput,
  type BusinessColumn
} from '@/app/lowcode/backend/business/types'

import { textInput, selectedParameter } from '../shared'

export const approvalKindLabels = {
  leave: t('Leave', '请假'),
  expense: t('Expense claim', '报销'),
  purchase: t('Purchase request', '采购')
} as const
export const approvalKindChoices: readonly BusinessChoice[] = Object.entries(
  approvalKindLabels
).map(([value, label]) => ({ value, label }))
export const approvalStatusChoices: readonly BusinessChoice[] = [
  { value: 'draft', label: t('Draft', '草稿') },
  { value: 'pending_first', label: t('Awaiting first review', '待一级审批') },
  { value: 'pending_second', label: t('Awaiting second review', '待二级审批') },
  { value: 'approved', label: t('Approved record', '审批通过') },
  { value: 'rejected', label: t('Rejected', '已驳回') },
  { value: 'cancelled', label: t('Cancelled', '已取消') }
]
export const approvalColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Title', '标题') },
  { field: 'kind', label: t('Application type', '申请类型') },
  { field: 'status', label: t('Status', '状态') }
]
export const approvalDetails: readonly BusinessColumn[] = [
  ...approvalColumns,
  { field: 'description', label: t('Application details', '申请说明'), multiline: true },
  { field: 'applicant_subject', label: t('Verified account reference', '验证账号编号') },
  { field: 'starts_at', label: t('Leave starts at', '请假开始时间') },
  { field: 'ends_at', label: t('Leave ends at', '请假结束时间') },
  { field: 'amount_cents', label: t('Requested amount (CNY cents)', '申请金额（人民币分）') },
  { field: 'first_reviewer_subject', label: t('First reviewer account', '一级审批账号') },
  { field: 'second_reviewer_subject', label: t('Second reviewer account', '二级审批账号') },
  { field: 'submitted_at', label: t('Current submission time', '本轮提交时间') },
  { field: 'version', label: t('Revision', '版本') }
]
export const approvalSelected = () => ({
  requestId: selectedParameter(),
  expectedVersion: selectedParameter('version')
})
export const approvalNote = (required = false): BusinessInput => ({
  ...textInput('note', 'Decision or change note', '审批或修改说明', 500),
  required
})

export function approvalInputs(kind: ApprovalKind, edit = false): BusinessInput[] {
  const inputs: BusinessInput[] = [
    textInput('title', 'Title', '标题', 200),
    { ...textInput('description', 'Application details', '申请说明', 2000), required: false },
    ...(kind === 'leave'
      ? [
          textInput('startsAt', 'Start time (zoned ISO 8601)', '开始时间（含时区 ISO 8601）', 100),
          textInput('endsAt', 'End time (zoned ISO 8601)', '结束时间（含时区 ISO 8601）', 100)
        ]
      : [
          {
            key: 'amountCents',
            label: t('Requested amount (CNY cents)', '申请金额（人民币分）'),
            kind: 'number' as const,
            min: 1,
            max: 100000000
          }
        ])
  ]
  const names: Readonly<Record<string, string>> = {
    startsAt: 'starts_at',
    endsAt: 'ends_at',
    amountCents: 'amount_cents'
  }
  return edit
    ? inputs.map((input) => ({ ...input, fromSelection: names[input.key] ?? input.key }))
    : inputs
}

export const approvalHistoryListing = {
  resourceId: 'oa-history',
  foreignKey: 'request_id',
  title: t('Application history', '申请操作记录'),
  columns: [
    { field: 'actor_subject', label: t('Actor account', '操作账号') },
    { field: 'action', label: t('Action', '操作') },
    { field: 'before_status', label: t('Previous status', '原状态') },
    { field: 'after_status', label: t('New status', '新状态') },
    { field: 'after_version', label: t('Revision', '版本') },
    { field: 'note', label: t('Note', '说明'), multiline: true },
    { field: 'created_at', label: t('Recorded at', '记录时间') }
  ]
}
