import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction } from '../shared'
import {
  approvalColumns,
  approvalDetails,
  approvalKindChoices,
  approvalNote,
  approvalSelected
} from './fields'

export function approvalReviewPage(level: 'first' | 'second'): BusinessPageDefinition {
  const first = level === 'first'
  return {
    id: `oa-${level}-queue`,
    path: first ? '/approvals/review' : '/approvals/approve',
    title: first
      ? t('First review queue', '一级审批待办')
      : t('Second review queue', '二级审批待办'),
    description: first
      ? t(
          'Requires oa-reviewer. This queue contains requests awaiting first review, not other people’s drafts. You cannot approve or reject your own application. A decision moves the item out of this queue; the applicant retains the full history. Refresh manually.',
          '需要 oa-reviewer 角色。仅显示待一级审批的申请，不展示他人的草稿。不能审批或驳回本人申请。决定提交后记录移出本级待办，申请人保留完整历史。请手动刷新。'
        )
      : t(
          'Requires oa-approver. You must be different from both the applicant and the first reviewer. Final approval records a decision only; it does not make a payment or create a purchase order. Refresh manually for current requests.',
          '需要 oa-approver 角色，且与申请人、一级审批人均不同。最终通过仅记录审批决定，不付款或创建采购订单。请手动刷新待办。'
        ),
    listing: {
      resourceId: `oa-${level}-queue`,
      columns: approvalColumns,
      search: true,
      filter: { field: 'kind', choices: approvalKindChoices }
    },
    details: approvalDetails,
    actions: [
      formAction({
        id: `approve-oa-${level}`,
        en: first ? 'Approve first review' : 'Approve final review',
        zh: first ? '一级审批通过' : '二级审批通过',
        inputs: [approvalNote()],
        parameters: approvalSelected(),
        when: { field: 'status', values: [`pending_${level}`] }
      }),
      formAction({
        id: `reject-oa-${level}`,
        en: first ? 'Reject first review' : 'Reject final review',
        zh: first ? '一级审批驳回' : '二级审批驳回',
        inputs: [approvalNote(true)],
        parameters: approvalSelected(),
        when: { field: 'status', values: [`pending_${level}`] },
        description: t(
          'Enter a reason. Rejection returns the application to its owner, who can reopen and edit the original record before resubmitting.',
          '请填写驳回原因。申请人可重新打开原记录，编辑后再次提交。'
        )
      })
    ]
  }
}
