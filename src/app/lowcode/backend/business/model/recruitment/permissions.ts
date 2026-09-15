import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { businessGrant, businessReadResource } from '../permissions'
import {
  HR_CANDIDATE_FIELDS,
  HR_CHECKLIST_FIELDS,
  HR_EMPLOYEE_FIELDS,
  HR_HISTORY_FIELDS,
  HR_INTERVIEW_FIELDS,
  HR_POSITION_FIELDS,
  type RecruitmentEntities
} from './fields'

export const recruitmentPolicy = (entity: DataEntityIR) => `hr-access-${entity.name}`

/** The existing bounded membership principal requires both the current role and record owner. */
export function recruitmentPermissions(
  app: BackendApplicationSpecV1,
  entities: RecruitmentEntities
): void {
  for (const [key, resourceId, fields, filters, search] of [
    ['positions', 'hr-positions', HR_POSITION_FIELDS, ['id', 'active'], ['title', 'department']],
    [
      'candidates',
      'hr-candidates',
      HR_CANDIDATE_FIELDS,
      ['id', 'position_id', 'status'],
      ['title']
    ],
    ['interviews', 'hr-interviews', HR_INTERVIEW_FIELDS, ['position_id', 'candidate_id'], []],
    [
      'employees',
      'hr-employees',
      HR_EMPLOYEE_FIELDS,
      ['id', 'position_id', 'candidate_id', 'status'],
      ['title', 'position_title']
    ],
    [
      'checklist',
      'hr-checklist',
      HR_CHECKLIST_FIELDS,
      ['position_id', 'employee_id', 'phase', 'completed'],
      ['title']
    ],
    ['history', 'hr-history', HR_HISTORY_FIELDS, ['position_id', 'target_id', 'action'], []]
  ] as const) {
    const entity = entities[key]
    const policy = businessGrant(app, entity, recruitmentPolicy(entity), {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: entity.id,
      membershipFieldId: 'id',
      identityFieldId: 'owner_id',
      roleId: 'recruitment-hr'
    })
    const resource = businessReadResource(app, entity, resourceId, fields, [policy])
    resource.query = {
      filterFields: [...filters],
      searchFields: [...search],
      sortFields: ['created_at']
    }
  }
}
