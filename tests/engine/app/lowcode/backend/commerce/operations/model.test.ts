import { describe, expect, test } from 'bun:test'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendCommerceEntitiesIR
} from '@open-pencil/lowcode/backend'

import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import type { CommerceMerchantMode } from '@/app/lowcode/backend/commerce/merchant/types'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'commerce-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}

function application(mode: CommerceMerchantMode = 'multi-merchant', commission = 0) {
  return createCommerceOperationsApplication(
    'commerce-operations-test',
    authentication,
    mode,
    commission
  )
}

function entity(app: BackendApplicationSpecV1, key: keyof BackendCommerceEntitiesIR) {
  const result = app.dataModel.entities.find((entry) => entry.id === app.commerce?.entities[key])
  if (!result) throw new Error('Missing commerce entity: ' + key)
  return result
}

function resource(app: BackendApplicationSpecV1, id: string) {
  const result = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing commerce resource: ' + id)
  return result
}

describe('commerce operations application templates', () => {
  test.each(['single-merchant', 'multi-merchant'] as const)(
    '%s exposes complete validated operations without legacy fulfillment bypasses',
    (mode) => {
      const app = application(mode, 375)
      const result = parseBackendApplicationSpecV1(app)
      expect(result.diagnostics).toEqual([])
      expect(result.ok).toBe(true)
      expect(app.dataModel.entities).toHaveLength(10)
      const operations = app.commands?.commands
      if (!operations) throw new Error('Missing commands')
      expect(operations).toHaveLength(12)
      expect(
        operations.every((command) => command.commerceOperation && command.steps.length === 0)
      ).toBe(true)
      expect(operations.map((command) => command.id)).not.toContain('fulfill-order')
      expect(operations.map((command) => command.id)).not.toContain('checkout')
      expect(
        operations
          .find((command) => command.id === 'restock-product')
          ?.parameters.map((parameter) => parameter.name)
      ).toEqual(['quantity', 'skuId', 'storeId'])
      expect(app.commerce?.commissionBasisPoints).toBe(375)
      expect(app.commerce?.settlementDelaySeconds).toBe(604800)
    }
  )

  test('single merchant restricts store creation at the database and HTTP boundary', () => {
    const app = application('single-merchant')
    const stores = entity(app, 'stores')
    expect(stores.uniques?.map((unique) => unique.fields)).toContainEqual(['owner_id'])
    expect(stores.uniques?.map((unique) => unique.fields)).toContainEqual(['single_store'])
    expect(stores.fields.find((field) => field.id === 'single_store')?.default).toEqual({
      kind: 'literal',
      value: true
    })
    expect(resource(app, 'stores').createFields).toEqual(['title'])
    expect(resource(app, 'stores').operations).not.toContain('update')
    expect(
      entity(application(), 'stores').uniques?.map((unique) => unique.fields)
    ).not.toContainEqual(['single_store'])
  })

  test('buyer cart and address-bearing orders are not exposed through public or merchant cart reads', () => {
    const app = application()
    for (const id of [
      'carts',
      'cart-items',
      'purchases',
      'orders',
      'order-items',
      'refunds',
      'shipments'
    ]) {
      const declaration = resource(app, id)
      expect(declaration.operations).toEqual(['list', 'read'])
      const policies = app.auth.rowAccess.filter((policy) =>
        declaration.readPolicyIds?.includes(policy.id)
      )
      expect(policies).toHaveLength(1)
      expect(policies[0]?.principal.kind).toBe('owner')
      expect(declaration.readFields).not.toContain('owner_id')
    }
    const cartId = entity(app, 'cartItems').id
    expect(
      app.auth.rowAccess
        .filter((policy) => policy.entityId === cartId)
        .every((policy) => policy.principal.kind === 'owner')
    ).toBe(true)
    expect(resource(app, 'stores').readFields).toEqual(['id', 'title'])
    expect(resource(app, 'products').readFields).not.toContain('owner_id')
  })

  test('merchant order and settlement queries require both role and store membership', () => {
    const app = application()
    for (const id of [
      'merchant-orders',
      'merchant-items',
      'merchant-refunds',
      'merchant-shipments',
      'merchant-settlements'
    ]) {
      const declaration = resource(app, id)
      const policy = app.auth.rowAccess.find((entry) =>
        declaration.readPolicyIds?.includes(entry.id)
      )
      expect(policy?.principal.kind).toBe('tenant-member')
      if (policy?.principal.kind !== 'tenant-member')
        throw new Error('Missing merchant tenant policy')
      const principal = policy.principal
      expect(principal.roleId).toBe('merchant')
      expect(
        app.auth.tenants.find((tenant) => tenant.id === principal.tenantId)?.membershipEntityId
      ).toBe(entity(app, 'stores').id)
      expect(declaration.operations).toEqual(['list', 'read'])
    }
    for (const id of [
      'operator-purchases',
      'operator-orders',
      'operator-refunds',
      'operator-settlements'
    ]) {
      const declaration = resource(app, id)
      expect(
        app.auth.rowAccess.find((entry) => declaration.readPolicyIds?.includes(entry.id))?.principal
      ).toEqual({ kind: 'role', roleId: 'commerce-operator' })
    }
  })

  test('financial records and cart version remain command-owned, with one line or settlement per business identity', () => {
    const app = application()
    expect(entity(app, 'carts').uniques?.map((unique) => unique.fields)).toContainEqual([
      'owner_id'
    ])
    expect(entity(app, 'cartItems').uniques?.map((unique) => unique.fields)).toContainEqual([
      'cart_id',
      'sku_id'
    ])
    expect(entity(app, 'orders').uniques?.map((unique) => unique.fields)).toContainEqual([
      'payment_group_id',
      'store_id'
    ])
    expect(entity(app, 'orderItems').uniques?.map((unique) => unique.fields)).toContainEqual([
      'order_id',
      'sku_id'
    ])
    for (const key of ['refunds', 'shipments', 'settlements'] as const)
      expect(entity(app, key).uniques?.map((unique) => unique.fields)).toContainEqual(['order_id'])
    const checkout = app.commands?.commands.find(
      (command) => command.commerceOperation === 'cart.checkout'
    )
    expect(checkout?.parameters.map((parameter) => parameter.name)).toEqual([
      'address',
      'cartRevision',
      'phone',
      'recipient'
    ])
    expect(resource(app, 'products').updateFields).not.toContain('stock')
  })

  test('new operations do not upgrade existing starter factories or accept an invalid commission', () => {
    application()
    const starter = createMerchantCommerceApplication(
      'unchanged-starter',
      authentication,
      'single-merchant'
    )
    expect(starter.commerce).toBeUndefined()
    expect(starter.commands?.commands.some((command) => command.id === 'fulfill-order')).toBe(true)
    expect(application().commerce?.commissionBasisPoints).toBe(0)
    for (const amount of [-1, 10001, 0.5, Number.NaN])
      expect(() => application('multi-merchant', amount)).toThrow('Commission')
  })

  test('private order relations bind the buyer while settlement payees remain merchant-only', () => {
    const app = application()
    for (const declaration of app.dataModel.entities) {
      expect(declaration.uniques?.map((unique) => unique.fields)).toContainEqual(['id', 'owner_id'])
      for (const foreignKey of declaration.foreignKeys ?? []) {
        if (!['cart_id', 'order_id', 'payment_group_id'].includes(foreignKey.fields[0] ?? ''))
          continue
        expect(foreignKey.fields).toEqual([foreignKey.fields[0], 'owner_id'])
        expect(foreignKey.targetFields).toEqual(['id', 'owner_id'])
      }
    }
    const settlements = entity(app, 'settlements')
    expect(settlements.fields.some((field) => field.id === 'merchant_id')).toBe(true)
    expect(
      app.auth.rowAccess
        .filter((policy) => policy.entityId === settlements.id)
        .some((policy) => policy.principal.kind === 'owner')
    ).toBe(false)
    expect(resource(app, 'merchant-settlements').readFields).toContain('merchant_id')
    expect(resource(app, 'merchant-settlements').readFields).not.toContain('owner_id')
  })
})
