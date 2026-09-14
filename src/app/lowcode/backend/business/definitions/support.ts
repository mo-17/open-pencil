import { businessText as t, type BusinessColumn, type BusinessTemplateDefinition } from '../types'
import { accountSetupPage, inputParameter, profileInput, recordAction, textInput } from './shared'

export function serviceDeskDefinition(): BusinessTemplateDefinition {
  const roles = ['support-manager', 'support-agent', 'support-approver']
  const columns: BusinessColumn[] = [
    { field: 'title', label: t('Ticket', '工单') },
    { field: 'priority', label: t('Priority (1–3)', '优先级（1–3）') },
    { field: 'status', label: t('Status', '状态') }
  ]
  const choices = [
    ['open', 'Open', '新建'],
    ['assigned', 'Assigned', '已分配'],
    ['in_progress', 'In progress', '处理中'],
    ['pending_approval', 'Pending approval', '待审批'],
    ['approved', 'Approved', '已批准'],
    ['rejected', 'Rejected', '已拒绝'],
    ['closed', 'Closed', '已关闭']
  ].map(([value, en, zh]) => ({ value, label: t(en, zh) }))
  const related = [
    {
      resourceId: 'ticket-history',
      foreignKey: 'ticket_id',
      title: t('Ticket history', '工单历史'),
      columns: [
        { field: 'action', label: t('Action', '操作') },
        { field: 'note', label: t('Note', '说明') },
        { field: 'after_status', label: t('Resulting status', '变更后状态') }
      ]
    }
  ]
  const transition = (id: string, en: string, zh: string, status: string) =>
    recordAction({
      id,
      en,
      zh,
      commandId: id + '-ticket',
      parameter: 'ticketId',
      when: { field: 'status', values: [status] }
    })
  const inputs = [
    profileInput('my-profile'),
    textInput('title', 'Ticket title', '工单标题'),
    textInput('description', 'Issue description', '问题说明', 500),
    {
      key: 'priority',
      label: t('Priority (1–3)', '优先级（1–3）'),
      kind: 'number' as const,
      min: 1,
      max: 3,
      initial: 2
    }
  ]
  const listing = {
    resourceId: 'tickets',
    columns,
    search: true,
    filter: { field: 'status', choices }
  }
  const details: BusinessColumn[] = [
    ...columns,
    { field: 'description', label: t('Description', '详情'), multiline: true },
    { field: 'resolution', label: t('Resolution', '处理结果'), multiline: true }
  ]
  return {
    id: 'service-desk',
    title: t('Service desk', '工单与审批'),
    description: t(
      'Assignment, resolution and independent single-stage approval.',
      '工单分配、处理与独立单级审批。'
    ),
    entryPage: 'tickets',
    roles,
    pages: [
      accountSetupPage(roles),
      {
        id: 'tickets',
        path: '/tickets',
        title: t('Tickets', '工单工作台'),
        description: t(
          'Register your profile first. Managers assign tickets; assigned support-agent accounts process them. Reviewers approve in the separate Approvals page.',
          '首次使用先登记资料。经理分配工单，获分配的 support-agent 账号负责处理，审核人员在审批页审核。'
        ),
        listing,
        details,
        related,
        actions: [
          {
            id: 'create',
            commandId: 'create-ticket',
            label: t('New ticket', '提交工单'),
            description: t(
              'Choose your own profile and describe the issue.',
              '选择本人资料并填写问题说明。'
            ),
            inputs,
            parameters: Object.fromEntries(
              inputs.map((input) => [input.key, inputParameter(input.key)])
            )
          },
          recordAction({
            id: 'assign',
            en: 'Assign ticket',
            zh: '分配工单',
            commandId: 'assign-ticket',
            parameter: 'ticketId',
            inputs: [profileInput(), textInput('note', 'Assignment reason', '分配说明', 500)],
            when: { field: 'status', values: ['open', 'assigned'] }
          }),
          transition('start', 'Start ticket', '开始处理', 'assigned'),
          recordAction({
            id: 'request-approval',
            en: 'Request approval',
            zh: '提交审批',
            commandId: 'request-ticket-approval',
            parameter: 'ticketId',
            when: { field: 'status', values: ['in_progress'] }
          }),
          transition('reopen', 'Resume rejected ticket', '继续处理被拒工单', 'rejected'),
          transition('close', 'Close approved ticket', '关闭已批准工单', 'approved')
        ]
      },
      {
        id: 'approvals',
        path: '/ticket-approvals',
        title: t('Approvals', '工单审批'),
        description: t(
          'Requires support-approver. You cannot approve your own ticket or the approval request you submitted. The server enforces this boundary.',
          '需要 support-approver。不能审批本人创建或本人提交审批的工单，服务器会独立校验。'
        ),
        listing,
        details,
        related,
        actions: [
          transition('approve', 'Approve ticket', '批准工单', 'pending_approval'),
          transition('reject', 'Reject ticket', '拒绝工单', 'pending_approval')
        ]
      }
    ]
  }
}
