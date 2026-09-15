import {
  APPROVALS_KINDS,
  APPROVALS_ROLES
} from '@/app/lowcode/backend/business/model/approvals/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { approvalDraftPage, approvalRequestsPage } from './requests'
import { approvalReviewPage } from './reviews'

export function enterpriseApprovalsDefinition(): BusinessTemplateDefinition {
  return {
    id: 'enterprise-approvals',
    title: t('Enterprise approvals', '企业审批 / OA'),
    description: t(
      'Leave, expense and purchase requests with two distinct approval levels, private drafts, revision checks and recorded decisions. Payments, payroll, inventory and notifications are connected after export.',
      '请假、报销及采购申请，固定两级不同人审批，保留私人草稿、版本校验与操作记录。付款、薪资、库存及通知在导出后接入。'
    ),
    entryPage: 'oa-requests',
    roles: APPROVALS_ROLES,
    pages: [
      accountSetupPage(APPROVALS_ROLES),
      ...APPROVALS_KINDS.map(approvalDraftPage),
      approvalRequestsPage(),
      approvalReviewPage('first'),
      approvalReviewPage('second')
    ]
  }
}
