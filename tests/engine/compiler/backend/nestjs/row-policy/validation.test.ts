import { expect, test } from 'bun:test'

import { unsupportedBackendHttpAPIDiagnostics } from '#compiler/backend/http-api-support'
import { nestJSConstraintDiagnostics } from '#compiler/backend/nestjs/model-constraints'
import {
  isSupabaseAllowPolicyEmittable,
  evaluateSupabaseRowAccess
} from '#compiler/backend/supabase/policy'
import { unsupportedSupabaseTenantSemantics } from '#compiler/backend/supabase/tenant-semantics'

import {
  deriveBackendApplicationCapabilities,
  lowerBackendApplicationSpecV1ToV2
} from '@open-pencil/lowcode/backend'

import { commandApplication } from '../commands/helpers'

test('providers and V2 cannot discard fixed row predicates even without an HTTP surface', () => {
  const application = commandApplication()
  const policy = application.auth.rowAccess[0]
  policy.operations = ['select']
  policy.conditions = [{ fieldId: 'title', value: 'published' }]
  for (const resource of application.httpApi?.resources ?? []) {
    resource.operations = ['list', 'read']
    Reflect.deleteProperty(resource, 'createFields')
    Reflect.deleteProperty(resource, 'updateFields')
  }
  application.capabilities = deriveBackendApplicationCapabilities(application).map(
    (capability) => ({ capability, required: true })
  )
  const firstEntity = application.dataModel.entities[0]
  expect(isSupabaseAllowPolicyEmittable(application, policy)).toBe(false)
  expect(
    evaluateSupabaseRowAccess(application, {
      entityId: firstEntity.id,
      operation: 'select',
      actor: { authenticated: true, userId: '11111111-1111-4111-8111-111111111111' },
      row: { owner_id: '11111111-1111-4111-8111-111111111111', title: 'draft' }
    })
  ).toBe(false)
  expect(
    unsupportedSupabaseTenantSemantics(application).some(
      (entry) => entry.code === 'supabase-conditional-membership-unimplemented'
    )
  ).toBe(true)
  const v2 = lowerBackendApplicationSpecV1ToV2(application)
  expect(v2.ok).toBe(false)
  if (!v2.ok)
    expect(v2.diagnostics.map((entry) => entry.code)).toContain(
      'backend-row-authority-v2-unsupported'
    )
  application.httpApi = undefined
  application.commands = undefined
  expect(
    unsupportedBackendHttpAPIDiagnostics(application).some(
      (entry) => entry.code === 'backend-row-authority-provider-unimplemented'
    )
  ).toBe(true)
})

test('conditionally public parent IDs do not satisfy the unrestricted public foreign-key exception', () => {
  const application = commandApplication()
  const parent = application.dataModel.entities[0]
  const child = structuredClone(parent)
  child.id = 'child'
  child.name = 'child'
  child.fields.push({ id: 'parent_id', name: 'parent_id', type: 'uuid', nullable: false })
  child.foreignKeys = [
    {
      id: 'parent',
      fields: ['parent_id'],
      targetEntityId: parent.id,
      targetFields: ['id'],
      onDelete: 'restrict'
    }
  ]
  application.dataModel.entities.push(child)
  application.auth.ownership.push({
    id: 'child-owner',
    entityId: child.id,
    identityFieldId: 'owner_id'
  })
  application.auth.rowAccess.push({
    id: 'published',
    entityId: parent.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'anonymous' },
    conditions: [{ fieldId: 'title', value: 'published' }]
  })
  expect(nestJSConstraintDiagnostics(application).length).toBeGreaterThan(0)
  const published = application.auth.rowAccess.at(-1)
  if (!published) throw new Error('Missing policy')
  Reflect.deleteProperty(published, 'conditions')
  expect(nestJSConstraintDiagnostics(application)).toEqual([])
})
