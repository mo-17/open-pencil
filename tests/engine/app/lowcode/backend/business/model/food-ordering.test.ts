import { describe, expect, test } from 'bun:test'

import {
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
  createBuiltinBackendProviderRegistry,
  createBackendProviderPlan,
  emitBackendProviderPlan,
  planNestJSLocalPreviewMigration
} from '@open-pencil/compiler/backend'
import {
  lowerBackendApplicationSpecV1ToV2,
  parseBackendApplicationSpecV1,
  parseBackendApplicationSpecV2,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'

import { composeBusinessModules } from '@/app/lowcode/backend/business/composition'
import { createBusinessApplication } from '@/app/lowcode/backend/business/model'
import { createFoodOrderingApplication } from '@/app/lowcode/backend/business/model/food-ordering/application'
import { createCommerceOperationsApplication } from '@/app/lowcode/backend/commerce/operations/application'

import { httpAPIApplicationV2 } from '#tests/engine/compiler/backend/http-api/helpers'

const authentication = {
  kind: 'oidc-pkce' as const,
  issuer: 'https://identity.example.com',
  clientId: 'food-public-client',
  scopes: ['openid', 'profile'],
  callbackPath: '/_openpencil/auth/callback'
}
const application = () => createFoodOrderingApplication('food-ordering-contract', authentication)

function command(app: BackendApplicationSpecV1, id: string) {
  const result = app.commands?.commands.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing food command: ' + id)
  return result
}
function resource(app: BackendApplicationSpecV1, id: string) {
  const result = app.httpApi?.resources.find((entry) => entry.id === id)
  if (!result) throw new Error('Missing food resource: ' + id)
  return result
}
function policies(app: BackendApplicationSpecV1, id: string) {
  const ids = resource(app, id).readPolicyIds
  return app.auth.rowAccess.filter((entry) => ids?.includes(entry.id))
}
function entity(app: BackendApplicationSpecV1, name: string) {
  const result = app.dataModel.entities.find((entry) => entry.name === name)
  if (!result) throw new Error('Missing food entity: ' + name)
  return result
}

describe('single-restaurant food ordering model', () => {
  test('normalizes a closed single-store profile without payment, stock or delivery authority', () => {
    const app = application()
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok, JSON.stringify(parsed.diagnostics)).toBe(true)
    expect(parsed.diagnostics).toEqual([])
    expect(app.dataModel.entities).toHaveLength(7)
    expect(app.commands?.commands).toHaveLength(13)
    expect(app.httpApi?.resources).toHaveLength(12)
    expect(app.foodOrdering).toMatchObject({
      version: 1,
      currency: 'CNY',
      maxItems: 50,
      maxQuantity: 99,
      managerRoleId: 'food-manager'
    })
    expect(app.auth.roles.map((entry) => entry.id)).toEqual(['food-manager'])
    expect(app.commerce).toBeUndefined()
    expect(
      app.dataModel.entities
        .flatMap((entry) => entry.fields.map((field) => field.id))
        .some((id) => /stock|payment|secret|token|printer|delivery/i.test(id))
    ).toBe(false)
    expect(
      app.httpApi?.resources.every((entry) =>
        entry.operations.every((operation) => operation === 'list' || operation === 'read')
      )
    ).toBe(true)
    expect(app.commands?.commands.every((entry) => entry.idempotency.kind === 'required')).toBe(
      true
    )
    expect(app.httpApi?.browserClient?.authentication).not.toBe(authentication)
  })

  test('only available menu rows are public and restaurant staff cannot read customer carts', () => {
    const app = application()
    expect(policies(app, 'food-menu')).toMatchObject([
      { principal: { kind: 'anonymous' }, conditions: [{ fieldId: 'available', value: true }] }
    ])
    for (const id of [
      'food-carts',
      'food-cart-items',
      'food-orders',
      'food-order-items',
      'food-order-history'
    ]) {
      expect(policies(app, id).map((entry) => entry.principal.kind)).toEqual(['owner'])
      expect(resource(app, id).readFields).not.toContain('owner_id')
    }
    expect(policies(app, 'food-cart-items')[0]?.conditions).toEqual([
      { fieldId: 'active', value: true }
    ])
    for (const id of [
      'food-menu-management',
      'food-kitchen-orders',
      'food-kitchen-items',
      'food-kitchen-history'
    ])
      expect(policies(app, id).map((entry) => entry.principal)).toEqual([
        { kind: 'role', roleId: 'food-manager' }
      ])
    expect(
      app.auth.rowAccess
        .filter((entry) => entry.principal.kind === 'anonymous')
        .map((entry) => entry.entityId)
    ).toEqual(['business-food-menu-items'])
  })

  test('the cart and line constraints preserve caller ownership and immutable order references', () => {
    const app = application()
    expect(entity(app, 'food_carts').uniques).toContainEqual({
      id: 'one-cart-per-owner',
      fields: ['owner_id']
    })
    expect(entity(app, 'food_cart_items').uniques).toContainEqual({
      id: 'one-cart-line-per-dish',
      fields: ['cart_id', 'menu_item_id']
    })
    expect(entity(app, 'food_order_items').uniques).toContainEqual({
      id: 'one-order-line-per-dish',
      fields: ['order_id', 'menu_item_id']
    })
    for (const [name, parent, target] of [
      ['food_cart_items', 'cart_id', 'business-food-carts'],
      ['food_order_items', 'order_id', 'business-food-orders'],
      ['food_order_history', 'order_id', 'business-food-orders']
    ] as const) {
      expect(entity(app, name).foreignKeys).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fields: [parent, 'owner_id'],
            targetEntityId: target,
            targetFields: ['id', 'owner_id'],
            onDelete: 'restrict'
          })
        ])
      )
      expect(
        entity(app, name).foreignKeys?.some((key) => key.fields.includes('menu_item_id'))
      ).toBe(false)
    }
    expect(entity(app, 'food_orders').fields.find((field) => field.id === 'status')?.enumId).toBe(
      'food-order-status'
    )
    expect(app.dataModel.enums.find((entry) => entry.id === 'food-order-status')?.values).toEqual([
      'pending',
      'accepted',
      'preparing',
      'ready',
      'completed',
      'cancelled'
    ])
    expect(app.dataModel.enums.find((entry) => entry.id === 'food-fulfillment')?.values).toEqual([
      'dine_in',
      'pickup'
    ])
  })

  test('fixed order commands accept only caller intent, never prices, amounts or selected ownership', () => {
    const app = application()
    const fixed = app.commands?.commands.filter((entry) => entry.foodOrderingOperation) ?? []
    expect(fixed).toHaveLength(10)
    for (const entry of fixed) {
      expect(entry.steps).toEqual([])
      expect(entry.return.resultName).toBe('result')
      expect(entry.return.fields).not.toContain('owner_id')
      expect(
        entry.parameters.some((parameter) =>
          /price|total|amount|owner|userId|role|status|currency/i.test(parameter.name)
        )
      ).toBe(false)
      expect(entry.commerceOperation).toBeUndefined()
    }
    expect(command(app, 'food.cart.set').parameters).toEqual(
      expect.arrayContaining([
        { name: 'menuItemId', type: 'uuid', required: true },
        { name: 'quantity', type: 'integer', required: true, min: 1, max: 99 }
      ])
    )
    const dineIn = command(app, 'food.checkout.dine-in')
    expect(dineIn.parameters).toEqual(
      expect.arrayContaining([
        { name: 'cartRevision', type: 'integer', required: true, min: 0, max: 2147483647 },
        { name: 'tableNumber', type: 'string', required: true, maxLength: 32 }
      ])
    )
    expect(
      command(app, 'food.checkout.pickup').parameters.some(
        (parameter) => parameter.name === 'tableNumber'
      )
    ).toBe(false)
    for (const suffix of ['accept', 'prepare', 'ready', 'complete', 'reject'])
      expect(command(app, 'food.order.' + suffix).access).toEqual({
        kind: 'role',
        roleId: 'food-manager'
      })
    expect(command(app, 'food.order.cancel').access).toEqual({ kind: 'authenticated' })
  })

  test('ordinary menu writes require restaurant authority and profile creation cannot grant it', () => {
    const app = application()
    const create = command(app, 'create-food-menu-item')
    const update = command(app, 'update-food-menu-item')
    for (const entry of [create, update]) {
      expect(entry.access).toEqual({ kind: 'role', roleId: 'food-manager' })
      expect(entry.parameters).toContainEqual({
        name: 'price',
        type: 'integer',
        required: true,
        min: 0,
        max: 1_000_000
      })
      expect(entry.parameters.some((parameter) => /owner|role|version/.test(parameter.name))).toBe(
        false
      )
    }
    expect(create.steps[0]).toMatchObject({
      kind: 'data.read',
      entityId: 'business-users',
      scope: 'owner',
      lock: 'update'
    })
    expect(create.steps[1]).toMatchObject({
      kind: 'assert',
      left: { kind: 'result', name: 'profile', field: 'active' },
      operator: 'eq',
      right: { kind: 'literal', value: true }
    })
    expect(update.steps[0]).toMatchObject({
      kind: 'data.read',
      entityId: 'business-food-menu-items',
      lock: 'update'
    })
    expect(
      command(app, 'register-business-user').parameters.map((parameter) => parameter.name)
    ).toEqual(['title'])
  })

  test('refuses authored shortcuts around fixed prices and private cart ownership', () => {
    const priced = application()
    command(priced, 'food.cart.set').parameters.push({
      name: 'unitPrice',
      type: 'integer',
      required: true,
      min: 0,
      max: 1_000_000
    })
    expect(parseBackendApplicationSpecV1(priced).ok).toBe(false)

    const exposed = application()
    const cartOwner = exposed.auth.rowAccess.find(
      (entry) => entry.entityId === 'business-food-carts'
    )
    if (!cartOwner) throw new Error('Missing cart ownership')
    cartOwner.principal = { kind: 'role', roleId: 'food-manager' }
    expect(parseBackendApplicationSpecV1(exposed).ok).toBe(false)

    const overwritten = application()
    overwritten.commands?.commands.push({
      id: 'unsafe-cart-override',
      name: 'Override a cart subtotal',
      path: '/commands/unsafe-cart-override',
      access: { kind: 'authenticated' },
      idempotency: { kind: 'required', header: 'Idempotency-Key' },
      parameters: [{ name: 'cartId', type: 'uuid', required: true }],
      steps: [
        {
          id: 'cart',
          kind: 'data.read',
          entityId: 'business-food-carts',
          resultName: 'cart',
          fields: ['id', 'subtotal'],
          key: { kind: 'parameter', name: 'cartId' },
          scope: 'owner',
          lock: 'update'
        },
        {
          id: 'update',
          kind: 'data.mutate',
          entityId: 'business-food-carts',
          operation: 'update',
          record: 'cart',
          resultName: 'updated',
          fields: ['id', 'subtotal'],
          values: [{ field: 'subtotal', value: { kind: 'literal', value: 0 } }]
        }
      ],
      return: { resultName: 'updated', fields: ['id', 'subtotal'] }
    })
    expect(parseBackendApplicationSpecV1(overwritten).ok).toBe(false)
  })

  test('the trusted NestJS provider emits separately owned food schema and a closed runtime', () => {
    const registry = createBuiltinBackendProviderRegistry()
    const selection = {
      descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
      packageDigest: 'sha256:' + 'A'.repeat(43),
      enabled: true
    }
    const planned = createBackendProviderPlan(registry, {
      application: application(),
      selection,
      target: 'vue',
      mode: 'production'
    })
    expect(planned.ok, JSON.stringify(planned.diagnostics)).toBe(true)
    if (!planned.ok) throw new Error('Food ordering provider plan failed')
    const emitted = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
    expect(emitted.ok).toBe(true)
    if (!emitted.ok) throw new Error('Food ordering provider emission failed')
    const files = emitted.emission.files
    const sql = files.get('backend/nestjs/migrations/001-initial.sql')
    expect(sql).toContain('"food_order_items"')
    expect(sql).toContain('UNIQUE ("cart_id", "menu_item_id")')
    expect(sql).toContain('FOREIGN KEY ("order_id", "owner_id")')
    expect(files.get('backend/nestjs/src/command-plans.ts')).toContain('food.checkout.dine-in')
    expect(files.get('backend/nestjs/src/command.service.ts')).toContain('executeFoodOrdering')
    expect(files.has('backend/nestjs/src/food-checkout.ts')).toBe(true)
    expect(files.has('backend/nestjs/src/food-authorization.ts')).toBe(true)
    expect(files.get('backend/nestjs/src/resources/food-menu.service.ts')).toContain('available')
    expect(files.get('backend/nestjs/src/resources/food-cart-items.service.ts')).toContain(
      'owner_id'
    )
    expect(files.get('backend/nestjs/package.json')).toContain('"pg"')
  })

  test('the full parser rejects menu deletion even with an empty assignment list', () => {
    const app = application()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    const update = command(app, 'update-food-menu-item')
    const mutation = update.steps.find((step) => step.kind === 'data.mutate')
    if (!mutation) throw new Error('Missing menu mutation')
    // Malformed input is intentionally constructed without widening the typed Command IR.
    Reflect.set(mutation, 'operation', 'delete')
    Reflect.set(mutation, 'values', [])
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok).toBe(false)
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-enum-invalid',
        path: expect.stringMatching(/\.operation$/u)
      })
    )
    expect(Object.hasOwn(parsed, 'value')).toBe(false)
  })

  test('rejects commands selecting both fixed domains before a provider can dispatch them', () => {
    const app = application()
    expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
    command(app, 'food.cart.set').commerceOperation = 'cart.set'
    const parsed = parseBackendApplicationSpecV1(app)
    expect(parsed.ok).toBe(false)
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ message: 'A command cannot select two fixed operation domains.' })
    )
    expect(Object.hasOwn(parsed, 'value')).toBe(false)
  })

  test.each(['business-users', 'business-food-menu-items', 'missing-food-cart'])(
    'rejects the wrong, duplicated or missing cart entity %s',
    (cartEntity) => {
      const app = application()
      if (!app.foodOrdering) throw new Error('Missing food profile')
      app.foodOrdering.entities.carts = cartEntity
      const parsed = parseBackendApplicationSpecV1(app)
      expect(parsed.ok).toBe(false)
      expect(parsed.diagnostics).toContainEqual(
        expect.objectContaining({
          code: 'backend-food-ordering-invalid',
          path: '$.foodOrdering.entities.carts'
        })
      )
      expect(Object.hasOwn(parsed, 'value')).toBe(false)
    }
  )

  test('V2 lowering and direct parsing explicitly refuse to discard the food profile', () => {
    const app = application()
    const before = structuredClone(app)
    const lowered = lowerBackendApplicationSpecV1ToV2(app)
    expect(lowered.ok).toBe(false)
    expect(lowered.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'backend-food-ordering-v2-unsupported',
        path: '$.foodOrdering'
      })
    )
    expect(Object.hasOwn(lowered, 'value')).toBe(false)
    expect(app).toEqual(before)
    const ordinary = httpAPIApplicationV2()
    expect(parseBackendApplicationSpecV2(ordinary).ok).toBe(true)
    const direct = parseBackendApplicationSpecV2({
      ...ordinary,
      foodOrdering: app.foodOrdering
    })
    expect(direct.ok).toBe(false)
    expect(direct.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'backend-food-ordering-v2-unsupported' })
    )
    expect(Object.hasOwn(direct, 'value')).toBe(false)
  })

  test.each(['single-merchant', 'multi-merchant'] as const)(
    'composes food with %s commerce while preserving separate profile and module ownership',
    (mode) => {
      const base = createCommerceOperationsApplication('food-commerce', authentication, mode)
      const before = structuredClone(base)
      const standalone = application()
      const combined = composeBusinessModules(base, ['food-ordering']).application
      expect(base).toEqual(before)
      expect(combined.commerce).toEqual(before.commerce)
      expect(combined.foodOrdering).toEqual(standalone.foodOrdering)
      expect(parseBackendApplicationSpecV1(combined).diagnostics).toEqual([])
      const modules = combined.modules?.modules ?? []
      const food = modules.find((entry) => entry.id === 'food-ordering')
      const commerce = modules.find((entry) => entry.id === 'existing-application')
      expect(new Set(food?.entityIds)).toEqual(
        new Set(Object.values(standalone.foodOrdering?.entities ?? {}))
      )
      expect(food?.dependsOn).toEqual(['shared-accounts'])
      expect(commerce?.entityIds).toEqual(before.dataModel.entities.map((entry) => entry.id))
      expect(commerce?.commandIds).toEqual(before.commands?.commands.map((entry) => entry.id))
      expect(food?.entityIds.some((id) => commerce?.entityIds.includes(id))).toBe(false)
      expect(food?.commandIds.some((id) => commerce?.commandIds.includes(id))).toBe(false)
      for (const original of before.commands?.commands ?? [])
        expect(command(combined, original.id)).toEqual(original)
      for (const original of before.auth.rowAccess)
        expect(combined.auth.rowAccess.find((entry) => entry.id === original.id)).toEqual(original)
      for (const fixed of combined.commands?.commands.filter(
        (entry) => entry.foodOrderingOperation
      ) ?? []) {
        expect(food?.commandIds).toContain(fixed.id)
        expect(fixed.commerceOperation).toBeUndefined()
      }
    }
  )

  test('adding food ordering to CRM preserves prior authority and only plans new module schema', async () => {
    const from = createBusinessApplication('food-crm', authentication, 'customer-crm')
    const before = structuredClone(from)
    const to = composeBusinessModules(from, ['customer-crm', 'food-ordering'], {
      adoptExisting: ['customer-crm']
    }).application
    expect(from).toEqual(before)
    expect(parseBackendApplicationSpecV1(to).diagnostics).toEqual([])
    const modules = to.modules?.modules ?? []
    const food = modules.find((entry) => entry.id === 'food-ordering')
    const crm = modules.find((entry) => entry.id === 'customer-crm')
    expect(new Set(food?.entityIds)).toEqual(
      new Set(Object.values(to.foodOrdering?.entities ?? {}))
    )
    expect(food?.dependsOn).toEqual(['shared-accounts'])
    expect(crm?.dependsOn).toEqual(['shared-accounts'])
    expect(food?.entityIds.some((id) => crm?.entityIds.includes(id))).toBe(false)
    expect(food?.commandIds.some((id) => crm?.commandIds.includes(id))).toBe(false)
    expect(modules.find((entry) => entry.id === 'shared-accounts')?.commandIds).toEqual([
      'register-business-user'
    ])
    for (const policy of from.auth.rowAccess)
      expect(to.auth.rowAccess.find((entry) => entry.id === policy.id)).toEqual(policy)
    for (const original of from.httpApi?.resources ?? [])
      expect(resource(to, original.id)).toEqual(original)
    for (const original of from.commands?.commands ?? [])
      expect(command(to, original.id)).toEqual(original)
    const migration = await planNestJSLocalPreviewMigration({
      fromApplication: from,
      toApplication: to
    })
    expect(migration.ok, migration.ok ? undefined : JSON.stringify(migration.diagnostics)).toBe(
      true
    )
    if (!migration.ok) throw new Error('Food module addition was not additive')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."users"')
    expect(migration.plan.sql).not.toContain('ALTER TABLE "public"."customers"')
    expect(migration.plan.sql).toContain('CREATE TABLE "public"."food_orders"')
  })
})
