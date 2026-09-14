import type { BackendApplicationSpecV1, DataEntityIR } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { businessGrant, businessReadResource } from '../permissions'

export const CRM_MANAGER_ROLE = 'crm-manager'
export const CRM_CUSTOMER_FIELDS = [
  'id',
  'title',
  'company',
  'email',
  'phone',
  'description',
  'assignee_id',
  'assignee_subject',
  'stage',
  'closed',
  'version',
  'created_at'
]
export const CRM_HISTORY_FIELDS = [
  'id',
  'customer_id',
  'actor_subject',
  'action',
  'note',
  'before_stage',
  'after_stage',
  'created_at'
]
export const CRM_CUSTOMER_POLICIES = ['crm-assignee', 'crm-manager-customers']

export interface CRMEntities {
  users: DataEntityIR
  customers: DataEntityIR
  history: DataEntityIR
}

export function createCRMEntities(application: BackendApplicationSpecV1): CRMEntities {
  const users = addBusinessUsers(application, [CRM_MANAGER_ROLE])
  businessEnum(application, 'customer-stage', [
    'new',
    'contacted',
    'qualified',
    'proposal',
    'won',
    'lost'
  ])
  const customers = addBusinessEntity(application, 'customers', [
    ...['title', 'company', 'email', 'phone', 'description'].map((id) =>
      businessField(id, 'string')
    ),
    businessField('assignee_id', 'uuid'),
    businessField('assignee_subject', 'uuid'),
    businessEnumField('stage', 'customer-stage', 'new'),
    businessField('closed', 'boolean', false),
    businessField('version', 'integer', 0)
  ])
  const history = addBusinessEntity(application, 'customer_history', [
    businessField('customer_id', 'uuid'),
    businessField('actor_subject', 'uuid'),
    businessField('action', 'string'),
    businessField('note', 'string'),
    businessEnumField('before_stage', 'customer-stage', 'new'),
    businessEnumField('after_stage', 'customer-stage', 'new')
  ])
  linkBusinessOwner(history, 'customer_id', customers)
  businessGrant(application, customers, 'crm-assignee', {
    kind: 'related-member',
    entityFieldId: 'id',
    membershipEntityId: customers.id,
    membershipFieldId: 'id',
    identityFieldId: 'assignee_subject'
  })
  businessGrant(application, customers, 'crm-manager-customers', {
    kind: 'role',
    roleId: CRM_MANAGER_ROLE
  })
  businessGrant(application, history, 'crm-assignee-history', {
    kind: 'related-member',
    entityFieldId: 'customer_id',
    membershipEntityId: customers.id,
    membershipFieldId: 'id',
    identityFieldId: 'assignee_subject'
  })
  businessGrant(application, history, 'crm-manager-history', {
    kind: 'role',
    roleId: CRM_MANAGER_ROLE
  })
  const resource = businessReadResource(
    application,
    customers,
    'customers',
    CRM_CUSTOMER_FIELDS,
    CRM_CUSTOMER_POLICIES
  )
  resource.query = {
    filterFields: ['stage', 'closed', 'assignee_id'],
    searchFields: ['title', 'company'],
    sortFields: ['created_at']
  }
  const audit = businessReadResource(application, history, 'follow-ups', CRM_HISTORY_FIELDS, [
    'crm-assignee-history',
    'crm-manager-history'
  ])
  audit.query = { filterFields: ['customer_id'], searchFields: [], sortFields: ['created_at'] }
  return { users, customers, history }
}
