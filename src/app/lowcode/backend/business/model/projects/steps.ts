import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult
} from '../commands'
import {
  MEMBER_FIELDS,
  PROJECT_FIELDS,
  PROJECT_ROLE,
  TASK_FIELDS,
  TASK_HISTORY_FIELDS,
  type ProjectEntities
} from './schema'

export function projectAccess(
  entities: ProjectEntities,
  manager = false
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.projects.id,
    parameter: 'projectId',
    policyIds: manager ? ['own-projects'] : ['own-projects', 'members-projects'],
    ...(manager ? { roleId: PROJECT_ROLE } : {})
  }
}

export function readProject(entities: ProjectEntities): BackendCommandStepIR {
  return businessRead(entities.projects, 'project', businessParameter('projectId'), [
    'owner_id',
    ...PROJECT_FIELDS
  ])
}

export function readMember(entities: ProjectEntities, active = true): BackendCommandStepIR[] {
  return [
    businessRead(entities.members, 'member', businessParameter('memberId'), MEMBER_FIELDS),
    businessAssert(
      'member_project',
      businessResult('member', 'project_id'),
      businessResult('project', 'id')
    ),
    ...(active
      ? [businessAssert('active_member', businessResult('member', 'active'), businessLiteral(true))]
      : [])
  ]
}

export function readTask(entities: ProjectEntities, assignee = false): BackendCommandStepIR[] {
  return [
    readProject(entities),
    businessRead(entities.tasks, 'task', businessParameter('taskId'), ['owner_id', ...TASK_FIELDS]),
    businessAssert(
      'task_project',
      businessResult('task', 'project_id'),
      businessResult('project', 'id')
    ),
    ...(assignee
      ? [
          businessAssert(
            'assigned_account',
            businessResult('task', 'assignee_subject'),
            businessCaller()
          )
        ]
      : [])
  ]
}

export function taskHistory(entities: ProjectEntities, action: string): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessResult('project', 'owner_id') },
      { field: 'project_id', value: businessResult('project', 'id') },
      { field: 'task_id', value: businessResult('task', 'id') },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: businessParameter('note') }
    ],
    TASK_HISTORY_FIELDS
  )
}

export function taskRevision(): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult('task', 'version'),
      right: businessLiteral(1)
    }
  }
}
