import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendCommandDefinitionIR
} from '@open-pencil/lowcode/backend'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import {
  BUSINESS_TEMPLATE_IDS,
  type BusinessTemplateId
} from '@/app/lowcode/backend/business/model/types'

function application(kind: BusinessTemplateId) {
  return createBusinessApplication(
    'business-contract-test',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'business-public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    kind
  )
}

function command(app: BackendApplicationSpecV1, id: string) {
  const entry = app.commands?.commands.find((item) => item.id === id)
  if (!entry) throw new Error('Missing business command: ' + id)
  return entry
}

function resource(app: BackendApplicationSpecV1, id: string) {
  const entry = app.httpApi?.resources.find((item) => item.id === id)
  if (!entry) throw new Error('Missing business resource: ' + id)
  return entry
}

function asserted(command: BackendCommandDefinitionIR, name: string) {
  const entry = command.steps.find((step) => step.id === name)
  if (!entry || entry.kind !== 'assert') throw new Error('Missing business assertion: ' + name)
  return entry
}

describe('business application template contracts', () => {
  test.each(BUSINESS_TEMPLATE_IDS)(
    '%s is a normalized ordinary-command application with readable UI projections',
    (kind) => {
      const app = application(kind)
      const definition = businessTemplateDefinition(kind)
      expect(definition.id).toBe(kind)
      expect(
        new Set(definition.pages.flatMap((page) => page.actions.map((action) => action.commandId)))
      ).toEqual(new Set(app.commands?.commands.map((entry) => entry.id)))
      expect(parseBackendApplicationSpecV1(app).diagnostics).toEqual([])
      expect(app.commerce).toBeUndefined()
      expect(
        app.commands?.commands.every(
          (entry) =>
            !entry.commerceOperation &&
            (entry.foodOrderingOperation
              ? entry.steps.length === 0
              : entry.steps.length > 0 && entry.steps.length <= 32)
        )
      ).toBe(true)
      for (const entry of app.httpApi?.resources ?? []) {
        expect(entry.operations).toEqual(['list', 'read'])
        expect(entry.readFields).toContain('id')
        expect(entry.createFields).toBeUndefined()
        expect(entry.updateFields).toBeUndefined()
      }
    }
  )

  test.each(BUSINESS_TEMPLATE_IDS)(
    '%s bootstraps a verified profile without assigning itself a role or another identity',
    (kind) => {
      const app = application(kind)
      const registration = command(app, 'register-business-user')
      expect(registration.access).toEqual({ kind: 'authenticated' })
      expect(registration.parameters.map((entry) => entry.name)).toEqual(['title'])
      const insert = registration.steps.find((step) => step.kind === 'data.mutate')
      if (!insert || insert.kind !== 'data.mutate') throw new Error('Missing registration insert')
      expect(insert.values.find((value) => value.field === 'owner_id')?.value).toEqual({
        kind: 'caller-sub'
      })
      expect(
        insert.values.some((value) => ['role', 'roles', 'member_subject'].includes(value.field))
      ).toBe(false)
      const myProfile = resource(app, 'my-profile')
      const profilePolicies = app.auth.rowAccess.filter((entry) =>
        myProfile.readPolicyIds?.includes(entry.id)
      )
      expect(profilePolicies).toHaveLength(1)
      expect(profilePolicies[0]?.principal.kind).toBe('owner')
      const users = app.dataModel.entities.find((entry) => entry.id === myProfile.entityId)
      expect(users?.uniques?.map((entry) => entry.fields)).toContainEqual(['owner_id'])
    }
  )

  test('CRM author ownership does not retain access after reassignment, including history and committed attempt recovery', () => {
    const app = application('customer-crm')
    const customers = resource(app, 'customers')
    const policies = app.auth.rowAccess.filter((entry) =>
      customers.readPolicyIds?.includes(entry.id)
    )
    expect(policies.some((entry) => entry.principal.kind === 'owner')).toBe(false)
    const assigned = policies.find((entry) => entry.principal.kind === 'related-member')?.principal
    expect(assigned).toMatchObject({
      kind: 'related-member',
      membershipEntityId: customers.entityId,
      entityFieldId: 'id',
      membershipFieldId: 'id',
      identityFieldId: 'assignee_subject'
    })
    const history = resource(app, 'follow-ups')
    const historyMember = app.auth.rowAccess.find(
      (entry) =>
        history.readPolicyIds?.includes(entry.id) && entry.principal.kind === 'related-member'
    )?.principal
    expect(historyMember).toMatchObject({
      kind: 'related-member',
      membershipEntityId: customers.entityId,
      entityFieldId: 'customer_id',
      identityFieldId: 'assignee_subject'
    })
    for (const entry of app.commands?.commands ?? []) {
      if (['register-business-user', 'create-customer'].includes(entry.id)) continue
      expect(entry.access).toMatchObject({
        kind: 'row-policy',
        entityId: customers.entityId,
        parameter: 'customerId'
      })
    }
    const assign = command(app, 'assign-customer')
    expect(assign.access).toMatchObject({ roleId: 'crm-manager' })
    expect(asserted(assign, 'registered_assignee').right).toEqual({ kind: 'literal', value: true })
    const update = assign.steps.find(
      (step) => step.kind === 'data.mutate' && step.operation === 'update'
    )
    if (!update || update.kind !== 'data.mutate') throw new Error('Missing assignment update')
    expect(update.values.find((value) => value.field === 'assignee_subject')?.value).toEqual({
      kind: 'result',
      name: 'profile',
      field: 'owner_id'
    })
  })

  test('support approval requires a submitted proposal and separates requester, submitter and approver', () => {
    const app = application('service-desk')
    for (const id of ['approve-ticket', 'reject-ticket']) {
      const review = command(app, id)
      expect(review.access).toMatchObject({ kind: 'row-policy', roleId: 'support-approver' })
      expect(asserted(review, 'expected_status').right).toEqual({
        kind: 'literal',
        value: 'pending_approval'
      })
      expect(asserted(review, 'not_requester')).toMatchObject({
        operator: 'neq',
        left: { kind: 'result', name: 'ticket', field: 'owner_id' },
        right: { kind: 'caller-sub' }
      })
      expect(asserted(review, 'not_submitter')).toMatchObject({
        operator: 'neq',
        left: { kind: 'result', name: 'ticket', field: 'approval_requested_by' },
        right: { kind: 'caller-sub' }
      })
    }
    expect(asserted(command(app, 'reopen-ticket'), 'expected_status').right).toEqual({
      kind: 'literal',
      value: 'rejected'
    })
    expect(asserted(command(app, 'close-ticket'), 'expected_status').right).toEqual({
      kind: 'literal',
      value: 'approved'
    })
    const ticket = resource(app, 'tickets')
    const assigned = app.auth.rowAccess.find(
      (entry) =>
        ticket.readPolicyIds?.includes(entry.id) && entry.principal.kind === 'related-member'
    )?.principal
    expect(assigned).toMatchObject({
      kind: 'related-member',
      roleId: 'support-agent',
      identityFieldId: 'assignee_subject'
    })
  })

  test('booking locks one service for cross-slot changes and keeps capacity and time checks inside the command', () => {
    const app = application('booking-registration')
    const services = resource(app, 'services')
    for (const entry of app.commands?.commands ?? []) {
      if (['register-business-user', 'create-service'].includes(entry.id)) continue
      expect(entry.access).toMatchObject({
        kind: 'row-policy',
        entityId: services.entityId,
        parameter: 'serviceId'
      })
    }
    const reschedule = command(app, 'reschedule-booking')
    expect(asserted(reschedule, 'target_service').right).toEqual({
      kind: 'result',
      name: 'service',
      field: 'id'
    })
    expect(asserted(reschedule, 'target_future').right).toEqual({ kind: 'server-now' })
    expect(asserted(reschedule, 'target_capacity').operator).toBe('gte')
    const firstWrite = reschedule.steps.findIndex((step) => step.kind === 'data.mutate')
    expect(reschedule.steps.findIndex((step) => step.id === 'target_capacity')).toBeLessThan(
      firstWrite
    )
    expect(
      reschedule.steps.filter(
        (step) => step.kind === 'data.mutate' && step.entityId === resource(app, 'slots').entityId
      )
    ).toHaveLength(2)
    const cancel = command(app, 'cancel-booking')
    expect(asserted(cancel, 'confirmed_booking').right).toEqual({
      kind: 'literal',
      value: 'confirmed'
    })
    expect(asserted(cancel, 'held_capacity').operator).toBe('gte')
    const privateBooking = resource(app, 'bookings')
    expect(
      app.auth.rowAccess
        .filter((entry) => privateBooking.readPolicyIds?.includes(entry.id))
        .map((entry) => entry.principal.kind)
        .sort()
    ).toEqual(['owner', 'role'])
    for (const publicId of ['services', 'slots'])
      expect(resource(app, publicId).readFields).not.toContain('owner_id')
  })

  test('project membership is per project and removal shares the same authority parent as task writes', () => {
    const app = application('project-tasks')
    const projects = resource(app, 'projects')
    const members = resource(app, 'project-members')
    const tasks = resource(app, 'tasks')
    const selected = app.auth.rowAccess.filter((entry) => tasks.readPolicyIds?.includes(entry.id))
    expect(
      selected.some(
        (entry) => entry.principal.kind === 'role' || entry.principal.kind === 'authenticated'
      )
    ).toBe(false)
    expect(
      selected.find((entry) => entry.principal.kind === 'related-member')?.principal
    ).toMatchObject({
      kind: 'related-member',
      entityFieldId: 'project_id',
      membershipEntityId: members.entityId,
      membershipFieldId: 'project_id',
      identityFieldId: 'member_subject',
      conditions: [{ fieldId: 'active', value: true }]
    })
    for (const entry of app.commands?.commands ?? []) {
      if (['register-business-user', 'create-project'].includes(entry.id)) continue
      expect(entry.access).toMatchObject({
        kind: 'row-policy',
        entityId: projects.entityId,
        parameter: 'projectId'
      })
    }
    expect(command(app, 'remove-project-member').access).toMatchObject({
      policyIds: ['own-projects'],
      roleId: 'project-manager'
    })
    const initial = command(app, 'create-project').steps.filter(
      (step) => step.kind === 'data.mutate'
    )
    expect(initial.map((step) => step.entityId)).toEqual([projects.entityId, members.entityId])
    expect(asserted(command(app, 'create-task'), 'active_member').right).toEqual({
      kind: 'literal',
      value: true
    })
    expect(asserted(command(app, 'start-task'), 'assigned_account').right).toEqual({
      kind: 'caller-sub'
    })
  })
})
