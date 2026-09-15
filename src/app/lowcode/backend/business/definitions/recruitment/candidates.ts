import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, textInput } from '../shared'
import {
  hrCandidateColumns,
  hrHistoryColumns,
  hrNote,
  hrPersonInputs,
  hrSelectedCandidate
} from './fields'

export function hrCandidatesPage(): BusinessPageDefinition {
  return {
    id: 'hr-candidates',
    path: '/hr/candidates',
    title: t('Candidates and hiring decisions', '候选人与录用决定'),
    description: t(
      'Private HR records, not user accounts. Record interview feedback, then make an explicit offer after reviewing the current revision. Scores never automatically select a candidate. Converting an offer creates one employee per candidate record; rejected or hired records cannot be edited. No resume uploads, automated screening or offer notifications.',
      '候选人资料是 HR 私人业务记录，不是登录账号。登记面试反馈后，核对当前版本并明确录用；评分不会自动录用。每份候选人记录仅可转为一份员工记录，拒绝或已转入职后不可编辑。首版不含简历上传、自动筛选和录用通知。'
    ),
    listing: {
      resourceId: 'hr-candidates',
      columns: hrCandidateColumns,
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'applied', label: t('Applied', '待评估') },
          { value: 'offered', label: t('Offered', '已录用') },
          { value: 'rejected', label: t('Rejected', '已拒绝') },
          { value: 'hired', label: t('Converted to employee', '已转员工') }
        ]
      }
    },
    details: [
      { field: 'contact', label: t('Contact details', '联系方式') },
      { field: 'experience', label: t('Relevant experience', '相关经历'), multiline: true }
    ],
    related: [
      {
        resourceId: 'hr-interviews',
        foreignKey: 'candidate_id',
        title: t('Immutable HR interview feedback', '不可改写的 HR 面试反馈'),
        columns: [
          { field: 'score', label: t('Score · 1 to 5', '评分 · 1 至 5') },
          { field: 'feedback', label: t('Feedback', '反馈'), multiline: true },
          { field: 'candidate_version', label: t('Reviewed revision', '评估时版本') },
          { field: 'actor_subject', label: t('HR operator', 'HR 操作人') }
        ]
      },
      {
        resourceId: 'hr-history',
        foreignKey: 'target_id',
        title: t('Application history', '申请操作记录'),
        columns: hrHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-hr-candidate',
        en: 'Add candidate',
        zh: '添加候选人',
        inputs: [
          {
            key: 'positionId',
            label: t('My position', '我负责的职位'),
            kind: 'relation',
            relation: { resourceId: 'hr-positions', labelField: 'title' }
          },
          ...hrPersonInputs()
        ]
      }),
      formAction({
        id: 'update-hr-candidate',
        en: 'Edit application',
        zh: '编辑应聘记录',
        inputs: [...hrPersonInputs(true), hrNote()],
        parameters: hrSelectedCandidate(),
        when: { field: 'status', values: ['applied'] }
      }),
      formAction({
        id: 'record-hr-interview',
        en: 'Record interview feedback',
        zh: '登记面试反馈',
        inputs: [
          {
            key: 'score',
            label: t('Score · 1 to 5', '评分 · 1 至 5'),
            kind: 'number',
            min: 1,
            max: 5,
            initial: 3
          },
          textInput('feedback', 'HR feedback', 'HR 面试反馈', 2000),
          hrNote()
        ],
        parameters: hrSelectedCandidate(),
        when: { field: 'status', values: ['applied'] }
      }),
      formAction({
        id: 'offer-hr-candidate',
        en: 'Record hiring offer',
        zh: '登记录用决定',
        inputs: [hrNote()],
        parameters: hrSelectedCandidate(),
        when: { field: 'status', values: ['applied'] },
        description: t(
          'Requires at least one feedback record and an open position. This is a manual HR decision; it sends no message and grants no account access.',
          '至少需要一条反馈且职位仍开放。这是人工 HR 录用决定，不会发送通知或授予账号权限。'
        )
      }),
      formAction({
        id: 'reject-hr-candidate',
        en: 'Reject or withdraw offer',
        zh: '拒绝或撤回录用',
        inputs: [hrNote()],
        parameters: hrSelectedCandidate(),
        when: { field: 'status', values: ['applied', 'offered'] }
      }),
      formAction({
        id: 'start-hr-onboarding',
        en: 'Create onboarding record',
        zh: '转为入职待办',
        inputs: [hrNote()],
        parameters: hrSelectedCandidate(),
        when: { field: 'status', values: ['offered'] }
      })
    ]
  }
}
