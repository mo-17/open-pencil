import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const RECRUITMENT_ROLES = ['recruitment-hr'] as const
export const HR_CANDIDATE_STATES = ['applied', 'offered', 'rejected', 'hired'] as const
export const HR_EMPLOYEE_STATES = ['onboarding', 'active', 'offboarding', 'departed'] as const
export const HR_POSITION_FIELDS = [
  'id',
  'title',
  'department',
  'description',
  'active',
  'version',
  'created_at'
]
export const HR_CANDIDATE_FIELDS = [
  'id',
  'position_id',
  'title',
  'contact',
  'experience',
  'status',
  'interview_count',
  'version',
  'created_at'
]
export const HR_INTERVIEW_FIELDS = [
  'id',
  'position_id',
  'candidate_id',
  'score',
  'feedback',
  'actor_subject',
  'candidate_version',
  'created_at'
]
export const HR_EMPLOYEE_FIELDS = [
  'id',
  'position_id',
  'candidate_id',
  'title',
  'contact',
  'position_title',
  'status',
  'checklist_total',
  'checklist_completed',
  'version',
  'created_at'
]
export const HR_CHECKLIST_FIELDS = [
  'id',
  'position_id',
  'employee_id',
  'title',
  'description',
  'phase',
  'completed',
  'completed_by',
  'completed_at',
  'version',
  'created_at'
]
export const HR_HISTORY_FIELDS = [
  'id',
  'position_id',
  'target_id',
  'target_kind',
  'related_id',
  'actor_subject',
  'action',
  'note',
  'before_version',
  'after_version',
  'created_at'
]

export interface RecruitmentEntities {
  positions: DataEntityIR
  candidates: DataEntityIR
  interviews: DataEntityIR
  employees: DataEntityIR
  checklist: DataEntityIR
  history: DataEntityIR
}
