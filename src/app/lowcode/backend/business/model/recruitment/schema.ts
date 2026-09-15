import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { HR_CANDIDATE_STATES, HR_EMPLOYEE_STATES, type RecruitmentEntities } from './fields'
import { recruitmentPermissions } from './permissions'

export function createRecruitmentEntities(app: BackendApplicationSpecV1): RecruitmentEntities {
  addBusinessUsers(app, [])
  businessEnum(app, 'hr-candidate-status', HR_CANDIDATE_STATES)
  businessEnum(app, 'hr-employee-status', HR_EMPLOYEE_STATES)
  const positions = addBusinessEntity(app, 'hr_positions', [
    businessField('title', 'string'),
    businessField('department', 'string'),
    businessField('description', 'string'),
    businessField('active', 'boolean', true),
    businessField('version', 'integer', 0)
  ])
  const candidates = addBusinessEntity(app, 'hr_candidates', [
    businessField('position_id', 'uuid'),
    businessField('title', 'string'),
    businessField('contact', 'string'),
    businessField('experience', 'string'),
    businessEnumField('status', 'hr-candidate-status', 'applied'),
    businessField('interview_count', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  const interviews = addBusinessEntity(app, 'hr_interviews', [
    businessField('position_id', 'uuid'),
    businessField('candidate_id', 'uuid'),
    businessField('score', 'integer'),
    businessField('feedback', 'string'),
    businessField('actor_subject', 'uuid'),
    businessField('candidate_version', 'integer')
  ])
  linkBusinessOwner(interviews, 'candidate_id', candidates)
  const employees = addBusinessEntity(app, 'hr_employees', [
    businessField('position_id', 'uuid'),
    businessField('candidate_id', 'uuid'),
    businessField('title', 'string'),
    businessField('contact', 'string'),
    businessField('position_title', 'string'),
    businessEnumField('status', 'hr-employee-status', 'onboarding'),
    businessField('checklist_total', 'integer', 0),
    businessField('checklist_completed', 'integer', 0),
    businessField('version', 'integer', 0)
  ])
  employees.uniques?.push({ id: 'one-employee-per-candidate', fields: ['candidate_id'] })
  linkBusinessOwner(employees, 'candidate_id', candidates)
  const checklist = addBusinessEntity(app, 'hr_checklist_items', [
    businessField('position_id', 'uuid'),
    businessField('employee_id', 'uuid'),
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessEnumField('phase', 'hr-employee-status', 'onboarding'),
    businessField('completed', 'boolean', false),
    businessField('completed_by', 'uuid', null, true),
    businessField('completed_at', 'datetime', null, true),
    businessField('version', 'integer', 0)
  ])
  linkBusinessOwner(checklist, 'employee_id', employees)
  const history = addBusinessEntity(app, 'hr_history', [
    businessField('position_id', 'uuid'),
    businessField('target_id', 'uuid'),
    businessField('target_kind', 'string'),
    businessField('related_id', 'uuid', null, true),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string'),
    businessField('before_version', 'integer', 0),
    businessField('after_version', 'integer', 0)
  ])
  history.uniques?.push({ id: 'target-revision', fields: ['target_id', 'after_version'] })
  for (const entity of [candidates, interviews, employees, checklist, history])
    linkBusinessOwner(entity, 'position_id', positions)
  const entities = { positions, candidates, interviews, employees, checklist, history }
  recruitmentPermissions(app, entities)
  return entities
}
