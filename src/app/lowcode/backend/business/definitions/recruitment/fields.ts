import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { selectedParameter, textInput } from '../shared'

export const hrPositionColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Position', '职位') },
  { field: 'department', label: t('Department', '部门') },
  { field: 'active', label: t('Accepting candidates', '接受候选人') },
  { field: 'version', label: t('Revision', '版本') }
]
export const hrCandidateColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Candidate', '候选人') },
  { field: 'status', label: t('Application status', '申请状态') },
  { field: 'interview_count', label: t('Recorded feedback', '反馈条数') },
  { field: 'version', label: t('Revision', '版本') }
]
export const hrEmployeeColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Employee', '员工') },
  { field: 'position_title', label: t('Position snapshot', '职位快照') },
  { field: 'status', label: t('Employment stage', '员工阶段') },
  { field: 'checklist_total', label: t('Current-stage required items', '当前阶段必做项') },
  { field: 'checklist_completed', label: t('Current-stage completed items', '当前阶段已完成项') },
  { field: 'version', label: t('Revision', '版本') }
]
export const hrChecklistColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Required task', '必做事项') },
  { field: 'phase', label: t('Stage', '所属阶段') },
  { field: 'completed', label: t('Completed', '已完成') },
  { field: 'version', label: t('Revision', '版本') }
]
export const hrHistoryColumns: readonly BusinessColumn[] = [
  { field: 'action', label: t('Action', '操作') },
  { field: 'target_kind', label: t('Record type', '记录类型') },
  { field: 'before_version', label: t('Previous revision', '原版本') },
  { field: 'after_version', label: t('New revision', '新版本') },
  { field: 'actor_subject', label: t('Verified operator', '已验证操作人') },
  { field: 'note', label: t('Explanation', '操作说明'), multiline: true },
  { field: 'created_at', label: t('Recorded at', '记录时间') }
]
export const hrNote = () => textInput('note', 'Explanation', '操作说明', 500)
export const hrSelectedCandidate = () => ({
  positionId: selectedParameter('position_id'),
  candidateId: selectedParameter(),
  expectedVersion: selectedParameter('version')
})
export const hrSelectedEmployee = () => ({
  positionId: selectedParameter('position_id'),
  employeeId: selectedParameter(),
  expectedVersion: selectedParameter('version')
})
export function hrPersonInputs(edit = false): BusinessInput[] {
  return [
    textInput('title', 'Candidate name', '候选人姓名', 100),
    textInput('contact', 'Contact details', '联系方式', 200),
    {
      ...textInput('experience', 'Relevant experience · plain text', '相关经历 · 纯文本', 4000),
      required: false
    }
  ].map((field) => ({ ...field, ...(edit ? { fromSelection: field.key } : {}) }))
}
