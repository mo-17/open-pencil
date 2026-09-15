import { expect, test } from 'bun:test'

import { validatePrismaCRMApplication } from '#compiler/backend/nestjs/prisma-crm/profile'

import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { prismaCRMApplication, prismaCRMCustomerResource } from './helpers'

test('accepts the current CRM with independently configured OIDC, routes, paging and command paths', () => {
  const application = prismaCRMApplication()
  expect(validatePrismaCRMApplication(application)).toEqual([])
  application.applicationId = 'another-crm'
  const client = application.httpApi?.browserClient
  if (!client) throw new Error('Missing CRM browser client.')
  client.authentication.issuer = 'https://login.example.org'
  client.authentication.clientId = 'custom-public-client'
  const customer = prismaCRMCustomerResource(application)
  customer.path = '/client-records'
  customer.maxPageSize = 10
  const command = application.commands?.commands[0]
  if (!command) throw new Error('Missing CRM command.')
  command.path = '/commands/reassigned'
  expect(validatePrismaCRMApplication(application)).toEqual([])
})

test('matches customer policy semantics rather than opaque policy identifiers', () => {
  const application = prismaCRMApplication()
  const policies = application.auth.rowAccess.filter(
    (entry) => entry.entityId === 'business-customers'
  )
  const resource = prismaCRMCustomerResource(application)
  for (const policy of policies) {
    const oldId = policy.id
    policy.id = 'custom-' + oldId
    resource.readPolicyIds = resource.readPolicyIds?.map((id) => (id === oldId ? policy.id : id))
    for (const command of application.commands?.commands ?? []) {
      if (command.access.kind === 'row-policy')
        command.access.policyIds = command.access.policyIds.map((id) =>
          id === oldId ? policy.id : id
        )
    }
  }
  expect(validatePrismaCRMApplication(application)).toEqual([])
})

const customerEntity = (application: BackendApplicationSpecV1) => {
  const entity = application.dataModel.entities.find((entry) => entry.id === 'business-customers')
  if (!entity) throw new Error('Missing customer entity.')
  return entity
}

const changes: ReadonlyArray<readonly [string, (application: BackendApplicationSpecV1) => void]> = [
  [
    'extra entity',
    (app) =>
      app.dataModel.entities.push({
        ...structuredClone(customerEntity(app)),
        id: 'extra',
        name: 'extra'
      })
  ],
  [
    'table name',
    (app) => {
      customerEntity(app).name = 'other_customers'
    }
  ],
  [
    'column name',
    (app) => {
      customerEntity(app).fields[0].name = 'other_column'
    }
  ],
  [
    'field type',
    (app) => {
      customerEntity(app).fields[0].type = 'string'
    }
  ],
  [
    'nullable field',
    (app) => {
      customerEntity(app).fields[0].nullable = true
    }
  ],
  [
    'extra field',
    (app) => {
      customerEntity(app).fields.push({
        id: 'extra',
        name: 'extra',
        type: 'string',
        nullable: true
      })
    }
  ],
  [
    'removed field',
    (app) => {
      customerEntity(app).fields.pop()
    }
  ],
  [
    'changed default',
    (app) => {
      const field = customerEntity(app).fields.find((entry) => entry.id === 'version')
      if (field) field.default = { kind: 'literal', value: 2 }
    }
  ],
  [
    'extra unique',
    (app) => {
      customerEntity(app).uniques?.push({ id: 'extra', fields: ['email'] })
    }
  ],
  [
    'enum ordering',
    (app) => {
      app.dataModel.enums[0].values.reverse()
    }
  ],
  [
    'enum name',
    (app) => {
      app.dataModel.enums[0].name = 'other_stage'
    }
  ],
  [
    'history reference action',
    (app) => {
      const key = app.dataModel.entities.find((entry) => entry.id === 'business-customer-history')
        ?.foreignKeys?.[0]
      if (key) key.onDelete = 'no-action'
    }
  ],
  [
    'customer resource alias',
    (app) => {
      prismaCRMCustomerResource(app).id = 'clients'
    }
  ],
  [
    'extra customer resource',
    (app) => {
      app.httpApi?.resources.push({
        ...structuredClone(prismaCRMCustomerResource(app)),
        id: 'all-customers',
        path: '/all-customers'
      })
    }
  ],
  [
    'customer mutation',
    (app) => {
      prismaCRMCustomerResource(app).operations.push('delete')
    }
  ],
  [
    'owner projection',
    (app) => {
      prismaCRMCustomerResource(app).readFields.push('owner_id')
    }
  ],
  [
    'omitted projection',
    (app) => {
      prismaCRMCustomerResource(app).readFields.pop()
    }
  ],
  [
    'expanded filter',
    (app) => {
      prismaCRMCustomerResource(app).query?.filterFields.push('assignee_subject')
    }
  ],
  [
    'changed search',
    (app) => {
      const query = prismaCRMCustomerResource(app).query
      if (query) query.searchFields = ['email']
    }
  ],
  [
    'implicit policy selection',
    (app) => {
      delete prismaCRMCustomerResource(app).readPolicyIds
    }
  ],
  [
    'omitted policy',
    (app) => {
      prismaCRMCustomerResource(app).readPolicyIds?.pop()
    }
  ],
  [
    'extra public grant',
    (app) => {
      app.auth.rowAccess.push({
        id: 'public-customer',
        entityId: 'business-customers',
        operations: ['select'],
        effect: 'allow',
        principal: { kind: 'anonymous' }
      })
    }
  ],
  [
    'module metadata',
    (app) => {
      app.modules = { version: 1, modules: [] }
    }
  ]
]

for (const [label, change] of changes) {
  test('rejects unreviewed CRM change: ' + label, () => {
    const application = prismaCRMApplication()
    change(application)
    expect(
      validatePrismaCRMApplication(application).some(
        (entry) => entry.code === 'backend-prisma-crm-unsupported'
      )
    ).toBe(true)
  })
}

test.each([
  'policy-condition',
  'membership-condition',
  'membership-role',
  'owner-principal',
  'wrong-role',
  'wrong-identity',
  'wrong-join'
] as const)('does not discard customer authorization: %s', (change) => {
  const application = prismaCRMApplication()
  const policy = application.auth.rowAccess.find((entry) => entry.id === 'crm-assignee')
  if (policy?.principal.kind !== 'related-member') throw new Error('Missing assignee policy.')
  if (change === 'policy-condition') policy.conditions = [{ fieldId: 'closed', value: false }]
  if (change === 'membership-condition')
    policy.principal.conditions = [{ fieldId: 'closed', value: false }]
  if (change === 'membership-role') policy.principal.roleId = 'crm-manager'
  if (change === 'wrong-identity') policy.principal.identityFieldId = 'owner_id'
  if (change === 'wrong-join') policy.principal.membershipFieldId = 'assignee_id'
  if (change === 'owner-principal')
    policy.principal = { kind: 'owner', ownershipId: 'own-customers' }
  if (change === 'wrong-role') policy.principal = { kind: 'role', roleId: 'crm-manager' }
  expect(
    validatePrismaCRMApplication(application).some(
      (entry) => entry.code === 'backend-prisma-crm-unsupported'
    )
  ).toBe(true)
})
