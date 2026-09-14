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

export const SUPPORT_ROLES = ['support-manager', 'support-agent', 'support-approver']
export const TICKET_FIELDS = [
  'id',
  'title',
  'description',
  'priority',
  'assignee_id',
  'assignee_subject',
  'status',
  'resolution',
  'approval_requested_by',
  'reviewed_by',
  'version',
  'created_at'
]
export const TICKET_HISTORY_FIELDS = [
  'id',
  'ticket_id',
  'actor_subject',
  'action',
  'note',
  'before_status',
  'after_status',
  'created_at'
]

export interface SupportEntities {
  users: DataEntityIR
  tickets: DataEntityIR
  history: DataEntityIR
}

export function createSupportEntities(application: BackendApplicationSpecV1): SupportEntities {
  const users = addBusinessUsers(application, ['support-manager'])
  businessEnum(application, 'ticket-status', [
    'open',
    'assigned',
    'in_progress',
    'pending_approval',
    'approved',
    'rejected',
    'closed'
  ])
  const tickets = addBusinessEntity(application, 'tickets', [
    businessField('title', 'string'),
    businessField('description', 'string'),
    businessField('priority', 'integer', 2),
    businessField('assignee_id', 'uuid', null, true),
    businessField('assignee_subject', 'uuid'),
    businessEnumField('status', 'ticket-status', 'open'),
    businessField('resolution', 'string', ''),
    businessField('approval_requested_by', 'uuid', null, true),
    businessField('reviewed_by', 'uuid', null, true),
    businessField('version', 'integer', 0)
  ])
  const history = addBusinessEntity(application, 'ticket_history', [
    businessField('ticket_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string'),
    businessEnumField('before_status', 'ticket-status', 'open'),
    businessEnumField('after_status', 'ticket-status', 'open')
  ])
  linkBusinessOwner(history, 'ticket_id', tickets)
  const owner = businessOwnerGrant(application, tickets)
  const historicalOwner = businessOwnerGrant(application, history)
  for (const [entity, field, id] of [
    [tickets, 'id', 'support-assignee'],
    [history, 'ticket_id', 'support-assignee-history']
  ] as const)
    businessGrant(application, entity, id, {
      kind: 'related-member',
      entityFieldId: field,
      membershipEntityId: tickets.id,
      membershipFieldId: 'id',
      identityFieldId: 'assignee_subject',
      roleId: 'support-agent'
    })
  for (const roleId of ['support-manager', 'support-approver']) {
    businessGrant(application, tickets, `${roleId}-tickets`, { kind: 'role', roleId })
    businessGrant(application, history, `${roleId}-history`, { kind: 'role', roleId })
  }
  const resource = businessReadResource(application, tickets, 'tickets', TICKET_FIELDS, [
    owner,
    'support-assignee',
    'support-manager-tickets',
    'support-approver-tickets'
  ])
  resource.query = {
    filterFields: ['status', 'priority', 'assignee_id'],
    searchFields: ['title'],
    sortFields: ['created_at']
  }
  const events = businessReadResource(
    application,
    history,
    'ticket-history',
    TICKET_HISTORY_FIELDS,
    [
      historicalOwner,
      'support-assignee-history',
      'support-manager-history',
      'support-approver-history'
    ]
  )
  events.query = { filterFields: ['ticket_id'], searchFields: [], sortFields: ['created_at'] }
  return { users, tickets, history }
}
