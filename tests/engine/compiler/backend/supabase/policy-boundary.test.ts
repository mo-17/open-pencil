import { describe, expect, test } from 'bun:test'

import {
  SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
  createBackendProviderPlan,
  createBuiltinBackendProviderRegistry,
  evaluateSupabaseRowAccess
} from '@open-pencil/compiler/backend'

import { fakeBackendApplication } from '../helpers'

const PACKAGE_DIGEST = `app-bundle-sha256:${'A'.repeat(43)}`

function conditionalDenyApplication() {
  const application = fakeBackendApplication([
    'auth.identity',
    'data.read',
    'migrations.schema',
    'policy.row-level'
  ])
  application.dataModel.entities.push({
    id: 'notes',
    name: 'notes',
    management: 'managed',
    fields: [
      { id: 'id', name: 'id', type: 'uuid', nullable: false },
      { id: 'owner_id', name: 'owner_id', type: 'uuid', nullable: false }
    ],
    primaryKey: { fields: ['id'] }
  })
  application.auth.identities.push({ id: 'user', kind: 'user' })
  application.auth.ownership.push({
    id: 'note-owner',
    entityId: 'notes',
    identityFieldId: 'owner_id'
  })
  application.auth.rowAccess.push(
    {
      id: 'allow-owner',
      entityId: 'notes',
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: 'note-owner' }
    },
    {
      id: 'deny-owner',
      entityId: 'notes',
      effect: 'deny',
      operations: ['select'],
      principal: { kind: 'owner', ownershipId: 'note-owner' }
    }
  )
  return application
}

describe('Supabase RLS semantic boundary', () => {
  test('fails production before SQL when a conditional deny cannot be translated exactly', () => {
    const application = conditionalDenyApplication()
    expect(
      evaluateSupabaseRowAccess(application, {
        entityId: 'notes',
        operation: 'select',
        actor: { authenticated: true, userId: 'user-1' },
        row: { id: 'note-1', owner_id: 'user-1' }
      })
    ).toBe(false)

    const result = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: {
        descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
        packageDigest: PACKAGE_DIGEST,
        enabled: true
      },
      application,
      target: 'react',
      mode: 'production'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'supabase-conditional-deny-unsupported',
          severity: 'error'
        })
      )
    }

    const prototype = createBackendProviderPlan(createBuiltinBackendProviderRegistry(), {
      selection: {
        descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
        packageDigest: PACKAGE_DIGEST,
        enabled: true
      },
      application,
      target: 'react',
      mode: 'source-only-prototype'
    })
    expect(prototype.ok).toBe(true)
    if (prototype.ok) {
      expect(prototype.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'supabase-conditional-deny-unsupported',
          severity: 'warning'
        })
      )
    }
  })

  test('blocks broad authenticated allow in production but keeps prototype review explicit', () => {
    const application = conditionalDenyApplication()
    application.auth.rowAccess = [
      {
        id: 'broad-authenticated-read',
        entityId: 'notes',
        effect: 'allow',
        operations: ['select'],
        principal: { kind: 'authenticated' }
      }
    ]
    const registry = createBuiltinBackendProviderRegistry()
    const selection = {
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: PACKAGE_DIGEST,
      enabled: true
    } as const
    const production = createBackendProviderPlan(registry, {
      selection,
      application,
      target: 'react',
      mode: 'production'
    })
    expect(production.ok).toBe(false)
    if (!production.ok) {
      expect(production.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'supabase-broad-row-policy-blocked', severity: 'error' })
      )
    }

    const prototype = createBackendProviderPlan(registry, {
      selection,
      application,
      target: 'react',
      mode: 'source-only-prototype'
    })
    expect(prototype.ok).toBe(true)
    if (prototype.ok) {
      expect(prototype.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'supabase-broad-row-policy-blocked', severity: 'warning' })
      )
    }
  })

  test('rejects owner and tenant fields that cannot compare safely with Supabase auth identity', () => {
    const registry = createBuiltinBackendProviderRegistry()
    const selection = {
      descriptor: SUPABASE_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: PACKAGE_DIGEST,
      enabled: true
    } as const
    const plan = (application: ReturnType<typeof conditionalDenyApplication>) =>
      createBackendProviderPlan(registry, {
        selection,
        application,
        target: 'react',
        mode: 'production'
      })

    const ownerType = conditionalDenyApplication()
    ownerType.auth.rowAccess.pop()
    ownerType.dataModel.entities[0].fields[1].type = 'string'
    const ownerResult = plan(ownerType)
    expect(ownerResult.ok).toBe(false)
    if (!ownerResult.ok) {
      expect(ownerResult.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-owner-identity-type-unsupported'
      )
    }

    const tenantIdentity = conditionalDenyApplication()
    tenantIdentity.auth.rowAccess = []
    tenantIdentity.dataModel.entities[0].fields.push({
      id: 'tenant_id',
      name: 'tenant_id',
      type: 'uuid',
      nullable: false
    })
    tenantIdentity.dataModel.entities.push({
      id: 'memberships',
      name: 'memberships',
      management: 'managed',
      fields: [
        { id: 'user_id', name: 'user_id', type: 'string', nullable: false },
        { id: 'tenant_id', name: 'tenant_id', type: 'uuid', nullable: false }
      ]
    })
    tenantIdentity.auth.tenants = [
      {
        id: 'note-tenant',
        entityId: 'notes',
        tenantFieldId: 'tenant_id',
        membershipEntityId: 'memberships',
        membershipIdentityFieldId: 'user_id',
        membershipTenantFieldId: 'tenant_id'
      }
    ]
    tenantIdentity.auth.rowAccess = [
      {
        id: 'tenant-read',
        entityId: 'notes',
        effect: 'allow',
        operations: ['select'],
        principal: { kind: 'tenant-member', tenantId: 'note-tenant' }
      }
    ]
    const identityResult = plan(tenantIdentity)
    expect(identityResult.ok).toBe(false)
    if (!identityResult.ok) {
      expect(identityResult.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-tenant-identity-type-unsupported'
      )
    }

    const tenantType = structuredClone(tenantIdentity)
    tenantType.dataModel.entities[1].fields[0].type = 'uuid'
    tenantType.dataModel.entities[1].fields[1].type = 'string'
    const tenantResult = plan(tenantType)
    expect(tenantResult.ok).toBe(false)
    if (!tenantResult.ok) {
      expect(tenantResult.diagnostics.map((entry) => entry.code)).toContain(
        'supabase-tenant-field-type-mismatch'
      )
    }
  })
})
