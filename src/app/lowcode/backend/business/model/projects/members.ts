import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { MEMBER_FIELDS, PROJECT_FIELDS, PROJECT_ROLE, type ProjectEntities } from './schema'
import { projectAccess, readMember, readProject } from './steps'

function createProject(entities: ProjectEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'create-project',
    'Create a project and its initial owner membership',
    { kind: 'role', roleId: PROJECT_ROLE },
    [
      businessUUIDParameter('userId'),
      businessStringParameter('title'),
      businessStringParameter('description', 500)
    ],
    [
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'title', 'active'],
        'owner'
      ),
      businessAssert(
        'registered_owner',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      businessInsert(
        entities.projects,
        'project',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'title', value: businessParameter('title') },
          { field: 'description', value: businessParameter('description') }
        ],
        PROJECT_FIELDS
      ),
      businessInsert(
        entities.members,
        'member',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'project_id', value: businessResult('project', 'id') },
          { field: 'user_id', value: businessResult('profile', 'id') },
          { field: 'member_subject', value: businessCaller() },
          { field: 'title', value: businessResult('profile', 'title') }
        ],
        MEMBER_FIELDS
      )
    ],
    { resultName: 'project', fields: [...PROJECT_FIELDS] }
  )
}

function addMember(entities: ProjectEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'add-project-member',
    'Add a registered account to this project',
    projectAccess(entities, true),
    [businessUUIDParameter('projectId'), businessUUIDParameter('userId')],
    [
      readProject(entities),
      businessRead(entities.users, 'profile', businessParameter('userId'), [
        'id',
        'owner_id',
        'title',
        'active'
      ]),
      businessAssert(
        'registered_member',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      businessInsert(
        entities.members,
        'member',
        [
          { field: 'owner_id', value: businessResult('project', 'owner_id') },
          { field: 'project_id', value: businessResult('project', 'id') },
          { field: 'user_id', value: businessResult('profile', 'id') },
          { field: 'member_subject', value: businessResult('profile', 'owner_id') },
          { field: 'title', value: businessResult('profile', 'title') }
        ],
        MEMBER_FIELDS
      )
    ],
    { resultName: 'member', fields: [...MEMBER_FIELDS] }
  )
}

function membershipState(entities: ProjectEntities, active: boolean): BackendCommandDefinitionIR {
  return businessCommand(
    active ? 'restore-project-member' : 'remove-project-member',
    active ? 'Restore project membership' : 'Revoke project membership',
    projectAccess(entities, true),
    [businessUUIDParameter('projectId'), businessUUIDParameter('memberId')],
    [
      readProject(entities),
      ...readMember(entities, false),
      businessAssert(
        'retain_project_owner',
        businessResult('member', 'member_subject'),
        businessResult('project', 'owner_id'),
        'neq'
      ),
      businessUpdate(
        entities.members,
        'member',
        'updated',
        [{ field: 'active', value: businessLiteral(active) }],
        MEMBER_FIELDS
      )
    ],
    { resultName: 'updated', fields: [...MEMBER_FIELDS] }
  )
}

export function projectMemberCommands(entities: ProjectEntities): BackendCommandDefinitionIR[] {
  return [
    createProject(entities),
    addMember(entities),
    membershipState(entities, false),
    membershipState(entities, true)
  ]
}
