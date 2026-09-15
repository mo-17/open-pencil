import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const APPROVALS_ROLES = ['oa-reviewer', 'oa-approver'] as const
export const APPROVALS_KINDS = ['leave', 'expense', 'purchase'] as const
export const APPROVALS_STATUSES = [
  'draft',
  'pending_first',
  'pending_second',
  'approved',
  'rejected',
  'cancelled'
] as const
export type ApprovalKind = (typeof APPROVALS_KINDS)[number]
export type ApprovalStatus = (typeof APPROVALS_STATUSES)[number]
export const APPROVAL_REQUEST_FIELDS = [
  'id',
  'applicant_subject',
  'kind',
  'title',
  'description',
  'starts_at',
  'ends_at',
  'amount_cents',
  'currency',
  'status',
  'first_reviewer_subject',
  'second_reviewer_subject',
  'submitted_at',
  'version',
  'created_at'
]
export const APPROVAL_HISTORY_FIELDS = [
  'id',
  'request_id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'before_version',
  'after_version',
  'created_at'
]
export interface ApprovalEntities {
  users: DataEntityIR
  requests: DataEntityIR
  history: DataEntityIR
}
