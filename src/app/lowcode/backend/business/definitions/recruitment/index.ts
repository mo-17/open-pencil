import { RECRUITMENT_ROLES } from '@/app/lowcode/backend/business/model/recruitment/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { hrCandidatesPage } from './candidates'
import { hrChecklistPage, hrEmployeesPage } from './employees'
import { hrHistoryColumns } from './fields'
import { hrPositionsPage } from './positions'

export function recruitmentHrDefinition(): BusinessTemplateDefinition {
  return {
    id: 'recruitment-hr',
    title: t('Recruitment and employee lifecycle', '招聘与员工入离职'),
    description: t(
      'Internal, owner-scoped HR positions, candidate feedback, explicit offers and required onboarding/offboarding checklists. No employee self-service, automated hiring, resume files, payroll, notifications or identity-service account actions. Separate candidate records are not deduplicated by real-world identity.',
      'HR 内部版：按负责人隔离职位、候选人反馈、明确录用和必做入离职清单。不含员工自助、自动录用、简历文件、薪资、通知或身份服务账号操作；不同候选人记录不进行真实身份去重。'
    ),
    entryPage: 'hr-positions',
    roles: RECRUITMENT_ROLES,
    pages: [
      accountSetupPage(RECRUITMENT_ROLES),
      hrPositionsPage(),
      hrCandidatesPage(),
      hrEmployeesPage(),
      hrChecklistPage(),
      {
        id: 'hr-history',
        path: '/hr/history',
        title: t('My HR audit records', '我负责的 HR 操作记录'),
        description: t(
          'Append-only records of the verified operator, affected record and revision. Feedback, employee conversion and checklist counters commit together with their audit records. Only the responsible HR account with a current role can read them.',
          '追加记录已验证操作人、目标记录及版本。反馈、员工转化及清单计数与操作记录同事务保存。仅负责该职位且当前持有角色的 HR 账号可见。'
        ),
        listing: { resourceId: 'hr-history', columns: hrHistoryColumns },
        details: [
          { field: 'target_id', label: t('Affected record ID', '目标记录 ID') },
          {
            field: 'related_id',
            label: t('Related employee, feedback or task ID', '关联员工、反馈或事项 ID')
          }
        ],
        actions: []
      }
    ]
  }
}
