import { describe, expect, test } from 'bun:test'

import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import {
  BackendDraftOperationError,
  removeBackendRole,
  removeBackendTenant,
  setBackendRowAccessEntity,
  setBackendTenantEntity
} from '@/app/lowcode/backend/draft'

function application() {
  return createMerchantCommerceApplication(
    'merchant-draft',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    'multi-merchant'
  )
}

describe('merchant authorization draft edits', () => {
  test('preserves the required role while rebinding tenant access to another tenant entity', () => {
    const app = application()
    const policy = app.auth.rowAccess.find((entry) => entry.id === 'merchant-products')
    const target = app.auth.tenants.find((entry) => entry.id === 'orders-store')
    if (!policy || !target) throw new Error('Missing merchant policies')
    setBackendRowAccessEntity(app, policy, target.entityId)
    expect(policy.entityId).toBe(target.entityId)
    expect(policy.principal).toEqual({
      kind: 'tenant-member',
      tenantId: target.id,
      roleId: 'merchant'
    })
  })

  test('rejects moving tenant access to an entity without a tenant rule without broadening access', () => {
    const app = application()
    const policy = app.auth.rowAccess.find((entry) => entry.id === 'merchant-products')
    const stores = app.dataModel.entities.find((entry) => entry.name === 'stores')
    if (!policy || !stores) throw new Error('Missing merchant model')
    const before = structuredClone(app)
    expect(() => setBackendRowAccessEntity(app, policy, stores.id)).toThrow(
      BackendDraftOperationError
    )
    expect(app).toEqual(before)
  })

  test.each(['row', 'command'] as const)(
    'preserves roles referenced by compound tenant %s access',
    (source) => {
      const app = application()
      app.auth.rowAccess =
        source === 'row'
          ? app.auth.rowAccess.filter((entry) => entry.principal.kind === 'tenant-member')
          : []
      if (source === 'row') delete app.commands
      const before = structuredClone(app)
      expect(() => removeBackendRole(app, 'merchant')).toThrow(BackendDraftOperationError)
      expect(app).toEqual(before)
      app.auth.rowAccess = []
      delete app.commands
      expect(removeBackendRole(app, 'merchant')).toBe(true)
    }
  )

  test('preserves a tenant still used by an atomic command after row policies are removed', () => {
    const app = application()
    app.auth.rowAccess = []
    const tenant = app.auth.tenants.find((entry) => entry.id === 'products-store')
    const orders = app.dataModel.entities.find((entry) => entry.name === 'orders')
    if (!tenant || !orders) throw new Error('Missing merchant model')
    const before = structuredClone(app)
    expect(() => removeBackendTenant(app, tenant.id)).toThrow(BackendDraftOperationError)
    expect(() => setBackendTenantEntity(app, tenant, orders.id)).toThrow(BackendDraftOperationError)
    expect(app).toEqual(before)
    delete app.commands
    expect(removeBackendTenant(app, tenant.id)).toBe(true)
  })
})
