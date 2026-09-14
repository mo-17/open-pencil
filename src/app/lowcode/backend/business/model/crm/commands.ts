import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR
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
import {
  CRM_CUSTOMER_FIELDS,
  CRM_CUSTOMER_POLICIES,
  CRM_HISTORY_FIELDS,
  CRM_MANAGER_ROLE,
  type CRMEntities
} from './schema'

const customerFields = ['owner_id', ...CRM_CUSTOMER_FIELDS]
const customerReturn = { resultName: 'updated', fields: [...CRM_CUSTOMER_FIELDS] }

function access(entities: CRMEntities, manager = false): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.customers.id,
    parameter: 'customerId',
    policyIds: manager ? ['crm-manager-customers'] : [...CRM_CUSTOMER_POLICIES],
    ...(manager ? { roleId: CRM_MANAGER_ROLE } : {})
  }
}

function readCustomer(entities: CRMEntities): BackendCommandStepIR {
  return businessRead(
    entities.customers,
    'customer',
    businessParameter('customerId'),
    customerFields
  )
}

function activeCustomer(): BackendCommandStepIR {
  return businessAssert(
    'open_customer',
    businessResult('customer', 'closed'),
    businessLiteral(false)
  )
}

function revision() {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic' as const,
      operator: 'add' as const,
      left: businessResult('customer', 'version'),
      right: businessLiteral(1)
    }
  }
}

function history(
  entities: CRMEntities,
  action: string,
  note: BackendCommandLeafIR,
  nextStage: BackendCommandLeafIR = businessResult('customer', 'stage')
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessResult('customer', 'owner_id') },
      { field: 'customer_id', value: businessResult('customer', 'id') },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: note },
      { field: 'before_stage', value: businessResult('customer', 'stage') },
      { field: 'after_stage', value: nextStage }
    ],
    CRM_HISTORY_FIELDS
  )
}

function createCustomer(entities: CRMEntities): BackendCommandDefinitionIR {
  const text = ['title', 'company', 'email', 'phone', 'description']
  return businessCommand(
    'create-customer',
    'Create a customer assigned to me',
    { kind: 'authenticated' },
    [
      businessUUIDParameter('userId'),
      ...text.map((name) => businessStringParameter(name, name === 'description' ? 500 : 100))
    ],
    [
      businessRead(
        entities.users,
        'profile',
        businessParameter('userId'),
        ['id', 'owner_id', 'active'],
        'owner'
      ),
      businessAssert('registered_user', businessResult('profile', 'active'), businessLiteral(true)),
      businessInsert(
        entities.customers,
        'customer',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'assignee_id', value: businessResult('profile', 'id') },
          { field: 'assignee_subject', value: businessResult('profile', 'owner_id') },
          ...text.map((field) => ({ field, value: businessParameter(field) }))
        ],
        CRM_CUSTOMER_FIELDS
      )
    ],
    { resultName: 'customer', fields: [...CRM_CUSTOMER_FIELDS] }
  )
}

function assignCustomer(entities: CRMEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'assign-customer',
    'Assign a customer to a registered account',
    access(entities, true),
    [
      businessUUIDParameter('customerId'),
      businessUUIDParameter('userId'),
      businessStringParameter('note', 500)
    ],
    [
      readCustomer(entities),
      activeCustomer(),
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
      history(entities, 'assigned', businessParameter('note')),
      businessUpdate(
        entities.customers,
        'customer',
        'updated',
        [
          { field: 'assignee_id', value: businessResult('profile', 'id') },
          { field: 'assignee_subject', value: businessResult('profile', 'owner_id') },
          revision()
        ],
        CRM_CUSTOMER_FIELDS
      )
    ],
    customerReturn
  )
}

function followUp(entities: CRMEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'add-customer-follow-up',
    'Record a customer follow-up',
    access(entities),
    [businessUUIDParameter('customerId'), businessStringParameter('note', 500)],
    [
      readCustomer(entities),
      activeCustomer(),
      history(entities, 'follow-up', businessParameter('note')),
      businessUpdate(entities.customers, 'customer', 'updated', [revision()], CRM_CUSTOMER_FIELDS)
    ],
    customerReturn
  )
}

function transition(
  entities: CRMEntities,
  before: string,
  after: string,
  closed = false
): BackendCommandDefinitionIR {
  return businessCommand(
    `customer-${after}`,
    `Move customer to ${after}`,
    access(entities),
    [businessUUIDParameter('customerId'), businessStringParameter('note', 500)],
    [
      readCustomer(entities),
      activeCustomer(),
      ...(before
        ? [
            businessAssert(
              'current_stage',
              businessResult('customer', 'stage'),
              businessLiteral(before)
            )
          ]
        : []),
      history(entities, `stage-${after}`, businessParameter('note'), businessLiteral(after)),
      businessUpdate(
        entities.customers,
        'customer',
        'updated',
        [
          { field: 'stage', value: businessLiteral(after) },
          { field: 'closed', value: businessLiteral(closed) },
          revision()
        ],
        CRM_CUSTOMER_FIELDS
      )
    ],
    customerReturn
  )
}

export function crmCommands(entities: CRMEntities): BackendCommandDefinitionIR[] {
  return [
    createCustomer(entities),
    businessCommand(
      'edit-customer',
      'Edit customer contact details',
      access(entities),
      [
        businessUUIDParameter('customerId'),
        ...['title', 'company', 'email', 'phone', 'description', 'note'].map((field) =>
          businessStringParameter(field, ['description', 'note'].includes(field) ? 500 : 100)
        )
      ],
      [
        readCustomer(entities),
        activeCustomer(),
        history(entities, 'edited', businessParameter('note')),
        businessUpdate(
          entities.customers,
          'customer',
          'updated',
          [
            ...['title', 'company', 'email', 'phone', 'description'].map((field) => ({
              field,
              value: businessParameter(field)
            })),
            revision()
          ],
          CRM_CUSTOMER_FIELDS
        )
      ],
      customerReturn
    ),
    assignCustomer(entities),
    followUp(entities),
    transition(entities, 'new', 'contacted'),
    transition(entities, 'contacted', 'qualified'),
    transition(entities, 'qualified', 'proposal'),
    transition(entities, 'proposal', 'won', true),
    transition(entities, '', 'lost', true)
  ]
}
