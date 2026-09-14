import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

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
import { TICKET_FIELDS, TICKET_HISTORY_FIELDS, type SupportEntities } from './schema'

function access(
  entities: SupportEntities,
  policyIds: string[],
  roleId?: string
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.tickets.id,
    parameter: 'ticketId',
    policyIds,
    ...(roleId ? { roleId } : {})
  }
}

function history(entities: SupportEntities, action: string, after: string): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessResult('ticket', 'owner_id') },
      { field: 'ticket_id', value: businessResult('ticket', 'id') },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: businessParameter('note') },
      { field: 'before_status', value: businessResult('ticket', 'status') },
      { field: 'after_status', value: businessLiteral(after) }
    ],
    TICKET_HISTORY_FIELDS
  )
}

function revision(): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult('ticket', 'version'),
      right: businessLiteral(1)
    }
  }
}

function readTicket(entities: SupportEntities): BackendCommandStepIR {
  return businessRead(entities.tickets, 'ticket', businessParameter('ticketId'), [
    'owner_id',
    ...TICKET_FIELDS
  ])
}

function createTicket(entities: SupportEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'create-ticket',
    'Create a support request',
    { kind: 'authenticated' },
    [
      businessUUIDParameter('userId'),
      businessStringParameter('title'),
      businessStringParameter('description', 500),
      { name: 'priority', type: 'integer', required: true, min: 1, max: 3 }
    ],
    [
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'active'],
        'owner'
      ),
      businessAssert('registered_user', businessResult('profile', 'active'), businessLiteral(true)),
      businessInsert(
        entities.tickets,
        'ticket',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'assignee_subject', value: businessCaller() },
          ...['title', 'description', 'priority'].map((field) => ({
            field,
            value: businessParameter(field)
          }))
        ],
        TICKET_FIELDS
      )
    ],
    { resultName: 'ticket', fields: [...TICKET_FIELDS] }
  )
}

function assignTicket(entities: SupportEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'assign-ticket',
    'Assign a ticket to a registered agent',
    access(entities, ['support-manager-tickets'], 'support-manager'),
    [
      businessUUIDParameter('ticketId'),
      businessUUIDParameter('userId'),
      businessStringParameter('note', 500)
    ],
    [
      readTicket(entities),
      ...['pending_approval', 'approved', 'closed'].map((status) =>
        businessAssert(
          `not_${status}`,
          businessResult('ticket', 'status'),
          businessLiteral(status),
          'neq'
        )
      ),
      businessRead(entities.users, 'profile', businessParameter('userId'), [
        'id',
        'owner_id',
        'active'
      ]),
      businessAssert(
        'registered_assignee',
        businessResult('profile', 'active'),
        businessLiteral(true)
      ),
      history(entities, 'assigned', 'assigned'),
      businessUpdate(
        entities.tickets,
        'ticket',
        'updated',
        [
          { field: 'assignee_id', value: businessResult('profile', 'id') },
          { field: 'assignee_subject', value: businessResult('profile', 'owner_id') },
          { field: 'status', value: businessLiteral('assigned') },
          { field: 'approval_requested_by', value: businessLiteral(null) },
          { field: 'reviewed_by', value: businessLiteral(null) },
          revision()
        ],
        TICKET_FIELDS
      )
    ],
    { resultName: 'updated', fields: [...TICKET_FIELDS] }
  )
}

function transition(
  entities: SupportEntities,
  id: string,
  before: string,
  after: string,
  policies: string[],
  roleId?: string,
  additional: BackendCommandStepIR[] = [],
  values: BackendCommandValueIR[] = []
): BackendCommandDefinitionIR {
  return businessCommand(
    id,
    id.replaceAll('-', ' '),
    access(entities, policies, roleId),
    [businessUUIDParameter('ticketId'), businessStringParameter('note', 500)],
    [
      readTicket(entities),
      businessAssert(
        'expected_status',
        businessResult('ticket', 'status'),
        businessLiteral(before)
      ),
      ...additional,
      history(entities, id, after),
      businessUpdate(
        entities.tickets,
        'ticket',
        'updated',
        [{ field: 'status', value: businessLiteral(after) }, ...values, revision()],
        TICKET_FIELDS
      )
    ],
    { resultName: 'updated', fields: [...TICKET_FIELDS] }
  )
}

export function supportCommands(entities: SupportEntities): BackendCommandDefinitionIR[] {
  const agent = ['support-assignee']
  const review = ['support-approver-tickets']
  const selfApproval = [
    businessAssert('not_requester', businessResult('ticket', 'owner_id'), businessCaller(), 'neq'),
    businessAssert(
      'not_submitter',
      businessResult('ticket', 'approval_requested_by'),
      businessCaller(),
      'neq'
    )
  ]
  return [
    createTicket(entities),
    assignTicket(entities),
    transition(entities, 'start-ticket', 'assigned', 'in_progress', agent, 'support-agent'),
    transition(
      entities,
      'request-ticket-approval',
      'in_progress',
      'pending_approval',
      agent,
      'support-agent',
      [],
      [
        { field: 'resolution', value: businessParameter('note') },
        { field: 'approval_requested_by', value: businessCaller() },
        { field: 'reviewed_by', value: businessLiteral(null) }
      ]
    ),
    transition(
      entities,
      'approve-ticket',
      'pending_approval',
      'approved',
      review,
      'support-approver',
      selfApproval,
      [{ field: 'reviewed_by', value: businessCaller() }]
    ),
    transition(
      entities,
      'reject-ticket',
      'pending_approval',
      'rejected',
      review,
      'support-approver',
      selfApproval,
      [{ field: 'reviewed_by', value: businessCaller() }]
    ),
    transition(
      entities,
      'reopen-ticket',
      'rejected',
      'in_progress',
      agent,
      'support-agent',
      [],
      [{ field: 'approval_requested_by', value: businessLiteral(null) }]
    ),
    transition(entities, 'close-ticket', 'approved', 'closed', ['own-tickets', 'support-assignee'])
  ]
}
