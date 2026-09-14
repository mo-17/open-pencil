import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { TASK_FIELDS, type ProjectEntities } from './schema'
import {
  projectAccess,
  readMember,
  readProject,
  readTask,
  taskHistory,
  taskRevision
} from './steps'

const taskReturn = { resultName: 'updated', fields: [...TASK_FIELDS] }
const mutationParameters = () => [
  businessUUIDParameter('projectId'),
  businessUUIDParameter('taskId'),
  businessStringParameter('note', 500)
]

function createTask(entities: ProjectEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'create-task',
    'Create a task for an active project member',
    projectAccess(entities, true),
    [
      businessUUIDParameter('projectId'),
      businessUUIDParameter('memberId'),
      businessStringParameter('title'),
      businessStringParameter('description', 500),
      { name: 'dueAt', type: 'datetime', required: true }
    ],
    [
      readProject(entities),
      ...readMember(entities),
      businessAssert('future_deadline', businessParameter('dueAt'), { kind: 'server-now' }, 'gte'),
      businessInsert(
        entities.tasks,
        'task',
        [
          { field: 'owner_id', value: businessResult('project', 'owner_id') },
          { field: 'project_id', value: businessResult('project', 'id') },
          { field: 'member_id', value: businessResult('member', 'id') },
          { field: 'assignee_subject', value: businessResult('member', 'member_subject') },
          { field: 'title', value: businessParameter('title') },
          { field: 'description', value: businessParameter('description') },
          { field: 'due_at', value: businessParameter('dueAt') }
        ],
        TASK_FIELDS
      )
    ],
    { resultName: 'task', fields: [...TASK_FIELDS] }
  )
}

function assignTask(entities: ProjectEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'assign-task',
    'Assign a task to an active member of this project',
    projectAccess(entities, true),
    [...mutationParameters(), businessUUIDParameter('memberId')],
    [
      ...readTask(entities),
      ...readMember(entities),
      businessAssert(
        'not_cancelled',
        businessResult('task', 'status'),
        businessLiteral('cancelled'),
        'neq'
      ),
      businessAssert('not_done', businessResult('task', 'status'), businessLiteral('done'), 'neq'),
      taskHistory(entities, 'assigned'),
      businessUpdate(
        entities.tasks,
        'task',
        'updated',
        [
          { field: 'member_id', value: businessResult('member', 'id') },
          { field: 'assignee_subject', value: businessResult('member', 'member_subject') },
          taskRevision()
        ],
        TASK_FIELDS
      )
    ],
    taskReturn
  )
}

function editTask(entities: ProjectEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'edit-task',
    'Edit task details and deadline',
    projectAccess(entities, true),
    [
      ...mutationParameters(),
      businessStringParameter('title'),
      businessStringParameter('description', 500),
      { name: 'dueAt', type: 'datetime', required: true }
    ],
    [
      ...readTask(entities),
      businessAssert(
        'not_cancelled',
        businessResult('task', 'status'),
        businessLiteral('cancelled'),
        'neq'
      ),
      businessAssert('not_done', businessResult('task', 'status'), businessLiteral('done'), 'neq'),
      businessAssert('future_deadline', businessParameter('dueAt'), { kind: 'server-now' }, 'gte'),
      taskHistory(entities, 'edited'),
      businessUpdate(
        entities.tasks,
        'task',
        'updated',
        [
          { field: 'title', value: businessParameter('title') },
          { field: 'description', value: businessParameter('description') },
          { field: 'due_at', value: businessParameter('dueAt') },
          taskRevision()
        ],
        TASK_FIELDS
      )
    ],
    taskReturn
  )
}

function transition(
  entities: ProjectEntities,
  id: string,
  before: string,
  after: string,
  manager = false
): BackendCommandDefinitionIR {
  return businessCommand(
    id,
    id.replaceAll('-', ' '),
    projectAccess(entities, manager),
    mutationParameters(),
    [
      ...readTask(entities, !manager),
      businessAssert('expected_status', businessResult('task', 'status'), businessLiteral(before)),
      taskHistory(entities, after),
      businessUpdate(
        entities.tasks,
        'task',
        'updated',
        [{ field: 'status', value: businessLiteral(after) }, taskRevision()],
        TASK_FIELDS
      )
    ],
    taskReturn
  )
}

export function projectTaskCommands(entities: ProjectEntities): BackendCommandDefinitionIR[] {
  return [
    createTask(entities),
    assignTask(entities),
    editTask(entities),
    transition(entities, 'start-task', 'todo', 'in_progress'),
    transition(entities, 'complete-task', 'in_progress', 'done'),
    transition(entities, 'reopen-task', 'done', 'todo', true),
    transition(entities, 'cancel-task', 'todo', 'cancelled', true)
  ]
}
