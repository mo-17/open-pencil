import { describe, expect, test } from 'bun:test'

import type { AuthRowAccessIntentIR } from '@open-pencil/lowcode/backend'

import { createBusinessBase } from '@/app/lowcode/backend/business/model/base'
import { addBusinessEntity, businessField } from '@/app/lowcode/backend/business/model/entities'
import {
  BackendDraftOperationError,
  removeBackendEntity,
  removeBackendField,
  removeBackendRole,
  removeBackendRowAccess,
  setBackendRowAccessEntity
} from '@/app/lowcode/backend/draft'
import { backendPolicyNeedsAdvancedEditor } from '@/app/lowcode/backend/draft/references'

function fixture() {
  const app = createBusinessBase(
    'reference-test',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'test',
      scopes: ['openid'],
      callbackPath: '/_openpencil/auth/callback'
    },
    ['manager']
  )
  const parent = addBusinessEntity(app, 'parents', [businessField('status', 'string')])
  const members = addBusinessEntity(app, 'members', [businessField('active', 'boolean')])
  // Isolate the new references from existing owner/key/FK guards.
  app.auth.ownership = []
  const policy: AuthRowAccessIntentIR = {
    id: 'member-read',
    entityId: parent.id,
    effect: 'allow',
    operations: ['select'],
    conditions: [{ fieldId: 'status', value: 'published' }],
    principal: {
      kind: 'related-member',
      entityFieldId: 'id',
      membershipEntityId: members.id,
      membershipFieldId: 'id',
      identityFieldId: 'owner_id',
      conditions: [{ fieldId: 'active', value: true }],
      roleId: 'manager'
    }
  }
  app.auth.rowAccess = [policy]
  return { app, parent, members, policy }
}

describe('business authority draft reference protection', () => {
  test('cannot delete a membership entity or fixed condition field and preserves the draft', () => {
    const { app, parent, members } = fixture()
    const before = structuredClone(app)
    for (const operation of [
      () => removeBackendEntity(app, members.id),
      () => removeBackendField(app, parent.id, 'status'),
      () => removeBackendField(app, members.id, 'active'),
      () => removeBackendRole(app, 'manager')
    ]) {
      expect(operation).toThrow(BackendDraftOperationError)
      expect(app).toEqual(before)
    }
  })
  test('cannot move compound authority through the basic entity selector', () => {
    const { app, members, policy } = fixture()
    const before = structuredClone(app)
    expect(backendPolicyNeedsAdvancedEditor(app, policy)).toBe(true)
    expect(() => setBackendRowAccessEntity(app, policy, members.id)).toThrow(
      BackendDraftOperationError
    )
    expect(app).toEqual(before)
    setBackendRowAccessEntity(app, policy, policy.entityId)
    expect(app).toEqual(before)
  })
  test('cannot remove a resource-bound policy until its reference is explicitly removed', () => {
    const { app, parent, policy } = fixture()
    if (!app.httpApi) throw new Error('Missing HTTP API')
    app.httpApi.resources = [
      {
        id: 'parents',
        path: '/parents',
        entityId: parent.id,
        operations: ['list', 'read'],
        readFields: ['id', 'status'],
        readPolicyIds: [policy.id],
        maxPageSize: 50
      }
    ]
    const before = structuredClone(app)
    expect(() => removeBackendRowAccess(app, policy.id)).toThrow(BackendDraftOperationError)
    expect(app).toEqual(before)
    app.httpApi.resources = []
    expect(removeBackendRowAccess(app, policy.id)).toBe(true)
    expect(removeBackendRowAccess(app, policy.id)).toBe(false)
  })
  test('row-policy command references preserve roles, entities and policies even without HTTP resources', () => {
    const { app, parent, policy } = fixture()
    app.commands = {
      version: 1,
      commands: [
        {
          id: 'protected-change',
          name: 'Protected change',
          path: '/protected-change',
          idempotency: { kind: 'required', header: 'Idempotency-Key' },
          parameters: [{ name: 'parentId', type: 'uuid', required: true }],
          access: {
            kind: 'row-policy',
            entityId: parent.id,
            parameter: 'parentId',
            policyIds: [policy.id],
            roleId: 'manager'
          },
          steps: [],
          return: { resultName: 'parent', fields: ['id'] }
        }
      ]
    }
    policy.principal = { kind: 'authenticated' }
    delete policy.conditions
    expect(backendPolicyNeedsAdvancedEditor(app, policy)).toBe(true)
    expect(() => removeBackendRole(app, 'manager')).toThrow(BackendDraftOperationError)
    expect(() => removeBackendRowAccess(app, policy.id)).toThrow(BackendDraftOperationError)
    expect(() => removeBackendEntity(app, parent.id)).toThrow(BackendDraftOperationError)
  })
})
