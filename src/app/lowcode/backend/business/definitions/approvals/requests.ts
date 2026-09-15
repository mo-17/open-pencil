import type { ApprovalKind } from '@/app/lowcode/backend/business/model/approvals/fields'
import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction } from '../shared'
import {
  approvalColumns,
  approvalDetails,
  approvalHistoryListing,
  approvalInputs,
  approvalKindLabels,
  approvalNote,
  approvalSelected,
  approvalStatusChoices
} from './fields'

export function approvalDraftPage(kind: ApprovalKind): BusinessPageDefinition {
  const label = approvalKindLabels[kind]
  return {
    id: `oa-${kind}-requests`,
    path: `/approvals/${kind}`,
    title: t(label.en + ' drafts', label.zh + '申请'),
    description:
      kind === 'leave'
        ? t(
            'Create or edit your leave draft, then submit it from My applications. End time must be later than start time. This records requested dates; it does not calculate working days, payroll or leave balances.',
            '创建或编辑本人请假草稿，再到我的申请提交。结束时间须晚于开始时间，仅记录申请时段，不计算工作日、薪资或假期余额。'
          )
        : t(
            'Create or edit your own draft, then submit it from My applications. Amounts are integer CNY cents. Approval records a decision only; reimbursement, supplier payment and inventory changes are connected after export.',
            '创建或编辑本人草稿，再到我的申请提交。金额以人民币分填写整数。通过审批仅记录决定，报销付款、供应商付款及库存变化需导出后另行接入。'
          ),
    listing: {
      resourceId: `oa-${kind}-requests`,
      columns: approvalColumns,
      search: true,
      filter: { field: 'status', choices: approvalStatusChoices }
    },
    details: approvalDetails,
    actions: [
      formAction({
        id: `create-oa-${kind}`,
        en: 'Create ' + label.en.toLowerCase() + ' draft',
        zh: '创建' + label.zh + '草稿',
        inputs: approvalInputs(kind)
      }),
      formAction({
        id: `update-oa-${kind}`,
        en: 'Edit ' + label.en.toLowerCase() + ' draft',
        zh: '编辑' + label.zh + '草稿',
        inputs: [...approvalInputs(kind, true), approvalNote()],
        parameters: approvalSelected(),
        when: { field: 'status', values: ['draft'] },
        description: t(
          'Only your draft can be changed. The server compares the selected revision; refresh and select again if another operation changed it.',
          '只能修改本人的草稿。服务器核对选中版本，若记录已被其他操作修改，请刷新后重新选择。'
        )
      })
    ]
  }
}

export function approvalRequestsPage(): BusinessPageDefinition {
  return {
    id: 'oa-requests',
    path: '/approvals/requests',
    title: t('My applications', '我的申请'),
    description: t(
      'Track your leave, expense and purchase records. Submit a draft for two different reviewers. Reopen a rejected request, edit it on its draft page, then submit again. Approved means an administrative decision, not payment or fulfillment. Refresh manually for current progress.',
      '追踪本人的请假、报销与采购申请。草稿提交后由两名不同审批人处理。驳回后重新打开，在相应申请页编辑，再次提交。通过仅表示行政审批结果，不代表付款或履约。请手动刷新进度。'
    ),
    listing: {
      resourceId: 'oa-requests',
      columns: approvalColumns,
      search: true,
      filter: { field: 'status', choices: approvalStatusChoices }
    },
    details: approvalDetails,
    related: [approvalHistoryListing],
    actions: [
      formAction({
        id: 'submit-oa-request',
        en: 'Submit for first review',
        zh: '提交一级审批',
        inputs: [approvalNote()],
        parameters: approvalSelected(),
        when: { field: 'status', values: ['draft'] },
        description: t(
          'Start a new review round at level one. Neither reviewer may be the applicant, and the second reviewer must differ from the first.',
          '从一级审批开始新一轮流程。两级审批人均不能是申请人，二级审批人也不能与一级相同。'
        )
      }),
      formAction({
        id: 'reopen-oa-request',
        en: 'Reopen rejected draft',
        zh: '重新打开驳回申请',
        inputs: [approvalNote()],
        parameters: approvalSelected(),
        when: { field: 'status', values: ['rejected'] },
        description: t(
          'Return this record to draft and clear the current reviewers. Previous decisions remain in your history. Edit the draft and submit it again.',
          '将原记录恢复为草稿并清除本轮审批人，历史决定仍保留。请编辑草稿后再次提交。'
        )
      }),
      formAction({
        id: 'cancel-oa-request',
        en: 'Cancel application',
        zh: '取消申请',
        inputs: [approvalNote()],
        parameters: approvalSelected(),
        when: { field: 'status', values: ['draft', 'pending_first', 'pending_second', 'rejected'] },
        description: t(
          'Cancel your unfinished application. Approved and already cancelled records cannot be cancelled; no payment or refund occurs.',
          '取消本人的未完成申请。已通过或已取消的记录不可再次取消；此操作不付款或退款。'
        )
      })
    ]
  }
}
