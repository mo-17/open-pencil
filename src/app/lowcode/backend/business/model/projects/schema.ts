import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'

export const PROJECT_ROLE = 'project-manager'
export const PROJECT_FIELDS = ['id', 'title', 'description', 'created_at']
export const MEMBER_FIELDS = [
  'id',
  'project_id',
  'user_id',
  'member_subject',
  'title',
  'active',
  'created_at'
]
export const TASK_FIELDS = [
  'id',
  'project_id',
  'title',
  'description',
  'member_id',
  'assignee_subject',
  'due_at',
  'status',
  'version',
  'created_at'
]
export const TASK_HISTORY_FIELDS = [
  'id',
  'project_id',
  'task_id',
  'actor_subject',
  'action',
  'note',
  'created_at'
]

export interface ProjectEntities {
  users: DataEntityIR
  projects: DataEntityIR
  members: DataEntityIR
  tasks: DataEntityIR
  history: DataEntityIR
}

export function createProjectEntities(application: BackendApplicationSpecV1): ProjectEntities {
  const users = addBusinessUsers(application, [PROJECT_ROLE])
  businessEnum(application, 'task-status', ['todo', 'in_progress', 'done', 'cancelled'])
  const projects = addBusinessEntity(application, 'projects', [
    businessField('title', 'string'),
    businessField('description', 'string')
  ])
  const members = addBusinessEntity(application, 'project_members', [
    businessField('project_id', 'uuid'),
    businessField('user_id', 'uuid'),
    businessField('member_subject', 'uuid'),
    businessField('title', 'string'),
    businessField('active', 'boolean', true)
  ])
  members.uniques?.push({ id: 'one-project-membership', fields: ['project_id', 'member_subject'] })
  const tasks = addBusinessEntity(application, 'tasks', [
    businessField('project_id', 'uuid'),
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessField('member_id', 'uuid'),
    businessField('assignee_subject', 'uuid'),
    businessField('due_at', 'datetime'),
    businessEnumField('status', 'task-status', 'todo'),
    businessField('version', 'integer', 0)
  ])
  const history = addBusinessEntity(application, 'task_history', [
    businessField('project_id', 'uuid'),
    businessField('task_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string')
  ])
  for (const entity of [members, tasks, history]) linkBusinessOwner(entity, 'project_id', projects)
  linkBusinessOwner(tasks, 'member_id', members)
  linkBusinessOwner(history, 'task_id', tasks)
  for (const [entity, field] of [
    [projects, 'id'],
    [members, 'project_id'],
    [tasks, 'project_id'],
    [history, 'project_id']
  ] as const) {
    businessOwnerGrant(application, entity)
    businessGrant(application, entity, `members-${entity.name.replaceAll('_', '-')}`, {
      kind: 'related-member',
      entityFieldId: field,
      membershipEntityId: members.id,
      membershipFieldId: 'project_id',
      identityFieldId: 'member_subject',
      conditions: [{ fieldId: 'active', value: true }]
    })
  }
  const definitions = [
    [projects, 'projects', PROJECT_FIELDS],
    [members, 'project-members', MEMBER_FIELDS],
    [tasks, 'tasks', TASK_FIELDS],
    [history, 'task-history', TASK_HISTORY_FIELDS]
  ] as const
  for (const [entity, id, fields] of definitions) {
    const resource = businessReadResource(application, entity, id, fields, [
      `own-${entity.name.replaceAll('_', '-')}`,
      `members-${entity.name.replaceAll('_', '-')}`
    ])
    resource.query = {
      filterFields: entity === projects ? [] : ['project_id'],
      searchFields: fields.includes('title') ? ['title'] : [],
      sortFields: ['created_at']
    }
    if (entity === history) resource.query.filterFields.push('task_id')
    if (entity === members) resource.query.filterFields.push('active')
    if (entity === tasks) resource.query.filterFields.push('status', 'member_id')
  }
  return { users, projects, members, tasks, history }
}
