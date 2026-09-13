import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'

import {
  createBuiltinBackendProviderRegistry,
  createBackendProviderPlan,
  emitBackendProviderPlan,
  NESTJS_BACKEND_PROVIDER_DESCRIPTOR
} from '@open-pencil/compiler/backend'
import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createCommerceApplication } from '@/app/lowcode/backend/commerce/application'

import {
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  commandRuntime,
  type RuntimeCommandDatabase,
  type RuntimeCommandQuery
} from '#tests/engine/compiler/backend/nestjs/commands/helpers'

function fixture() {
  const application = createCommerceApplication('catalog-management', {
    kind: 'oidc-pkce',
    issuer: 'https://identity.example.com',
    clientId: 'shop-public-client',
    scopes: ['openid', 'profile'],
    callbackPath: '/_openpencil/auth/callback'
  })
  const command = application.commands?.commands.find((entry) => entry.id === 'restock-product')
  if (!command) throw new Error('Missing restock command')
  return { application, command, plan: nestJSCommandPlan(application, command) }
}

describe('commerce catalog restocking', () => {
  let loaded: Awaited<ReturnType<typeof commandRuntime>>
  beforeAll(async () => {
    loaded = await commandRuntime()
  })
  afterAll(async () => {
    await loaded.dispose()
  })

  test('exposes bounded manager restocking and removes absolute stock updates from product PATCH', () => {
    const { application, command } = fixture()
    expect(parseBackendApplicationSpecV1(application).ok).toBe(true)
    const resource = application.httpApi?.resources.find((entry) => entry.id === 'products')
    expect(resource?.createFields).toEqual(['title', 'price', 'stock', 'active'])
    expect(resource?.updateFields).toEqual(['title', 'price', 'active'])
    expect(command.access).toEqual({ kind: 'role', roleId: 'catalog-manager' })
    expect(command.idempotency).toEqual({ kind: 'required', header: 'Idempotency-Key' })
    expect(command.parameters).toEqual([
      { name: 'skuId', type: 'uuid', required: true },
      { name: 'quantity', type: 'integer', required: true, min: 1, max: 100000 }
    ])
    expect(command.return.fields).toEqual(['id', 'title', 'price', 'stock', 'active'])
  })

  test.each(['react', 'vue'] as const)(
    '%s provider emits the closed stock allowlist and role command',
    (target) => {
      const { application } = fixture()
      const registry = createBuiltinBackendProviderRegistry()
      const selection = {
        descriptor: NESTJS_BACKEND_PROVIDER_DESCRIPTOR,
        packageDigest: `sha256:${'A'.repeat(43)}`,
        enabled: true
      }
      const planned = createBackendProviderPlan(registry, {
        selection,
        application,
        target,
        mode: 'production'
      })
      expect(planned.ok).toBe(true)
      if (!planned.ok) throw new Error(JSON.stringify(planned.diagnostics))
      const output = emitBackendProviderPlan(registry, { selection, plan: planned.plan })
      expect(output.ok).toBe(true)
      if (!output.ok) throw new Error(JSON.stringify(output.diagnostics))
      const service = output.emission.files.get('backend/nestjs/src/resources/products.service.ts')
      expect(service).toContain('const UPDATE_FIELDS = ')
      const updateFields = service?.split('const UPDATE_FIELDS = ')[1]?.split('\n')[0]
      for (const field of ['title', 'price', 'active'])
        expect(updateFields).toContain('"id":"' + field + '"')
      expect(updateFields).not.toContain('stock')
      const plans = output.emission.files.get('backend/nestjs/src/command-plans.ts')
      expect(plans).toContain('restock-product')
      expect(plans).toContain('catalog-manager')
      expect(output.emission.files.get('backend/nestjs/client.ts')).toContain('restock-product')
    }
  )

  test('rejects invalid quantities and unknown authority or stock parameters', () => {
    const { plan } = fixture()
    const input = loaded.input
    for (const quantity of [0, -1, 1.5, 100001, '2', null])
      expect(() => input.commandInput(plan.parameters, { skuId: COMMAND_ITEM, quantity })).toThrow()
    for (const extra of [{ stock: 999 }, { owner_id: COMMAND_SUBJECT }, { active: true }])
      expect(() =>
        input.commandInput(plan.parameters, { skuId: COMMAND_ITEM, quantity: 2, ...extra })
      ).toThrow()
    expect(
      loaded.input.commandInput(plan.parameters, { skuId: COMMAND_ITEM, quantity: 100000 })
    ).toEqual({
      skuId: COMMAND_ITEM,
      quantity: 100000
    })
  })

  test('locks the current stock and changes only its checked sum even for inactive products', async () => {
    const { plan } = fixture()
    const queries: RuntimeCommandQuery[] = []
    const product = {
      id: COMMAND_ITEM,
      title: 'Inactive product',
      price: 1299,
      stock: 7,
      active: false
    }
    const response = await loaded.execution.executeCommand(
      {
        query: async (text, values = []) => {
          queries.push({ text, values })
          if (text.startsWith('UPDATE')) product.stock = Number(values[0])
          return { rowCount: 1, rows: [{ ...product }] }
        }
      },
      plan,
      { skuId: COMMAND_ITEM, quantity: 3 },
      COMMAND_SUBJECT
    )
    expect(queries).toHaveLength(2)
    expect(queries[0].text).toContain('WHERE "id" = $1 FOR UPDATE')
    expect(queries[0].values).toEqual([COMMAND_ITEM])
    expect(queries[1].text).toStartWith('UPDATE "public"."products" SET "stock" = $1')
    expect(queries[1].values).toEqual([10, COMMAND_ITEM])
    expect(queries.some((query) => query.text.includes('"orders"'))).toBe(false)
    expect(response).toEqual({ ...product, stock: 10 })
  })

  test.each([-1, 2147483647])(
    'invalid current stock %s rejects before any product mutation',
    async (stock) => {
      const { plan } = fixture()
      const queries: string[] = []
      await expect(
        loaded.execution.executeCommand(
          {
            query: async (text) => {
              queries.push(text)
              return { rowCount: 1, rows: [{ id: COMMAND_ITEM, stock }] }
            }
          },
          plan,
          { skuId: COMMAND_ITEM, quantity: 1 },
          COMMAND_SUBJECT
        )
      ).rejects.toThrow('Request conflict')
      expect(queries).toHaveLength(1)
      expect(queries[0]).toStartWith('SELECT')
    }
  )

  test('checks the exact verified manager role before opening a transaction or replaying a result', async () => {
    const { plan } = fixture()
    let calls = 0
    const service = new loaded.service.CommandService({
      transaction: async () => {
        calls += 1
        throw new Error('Must not reach ledger')
      }
    })
    const body = { skuId: COMMAND_ITEM, quantity: 2 }
    await expect(service.execute(plan, null, 'restock-attempt-0001', body)).rejects.toThrow(
      'Authentication required'
    )
    for (const roles of [[], ['catalog_manager'], ['manager']])
      await expect(
        service.execute(plan, { subject: COMMAND_SUBJECT, roles }, 'restock-attempt-0001', body)
      ).rejects.toThrow('Access denied')
    expect(calls).toBe(0)
  })

  test('same-key retries return the first transaction snapshot without overwriting later inventory', async () => {
    const { plan } = fixture()
    const saved: Record<string, unknown> = {}
    const product = { id: COMMAND_ITEM, title: 'Original', price: 200, stock: 10, active: true }
    let productWrites = 0
    const database: RuntimeCommandDatabase = {
      query: async (text, values = []) => {
        if (text.startsWith('INSERT INTO public.openpencil_command_requests')) {
          if (saved.response_json) return { rows: [], rowCount: 0 }
          saved.command_digest = values[4]
          saved.request_digest = values[5]
          return { rows: [{ request_key: values[3] }], rowCount: 1 }
        }
        if (text.startsWith('SELECT command_digest')) return { rows: [saved], rowCount: 1 }
        if (text.startsWith('UPDATE public.openpencil_command_requests')) {
          saved.response_json = values[4]
          return { rows: [], rowCount: 1 }
        }
        if (text.startsWith('UPDATE "public"."products"')) {
          productWrites += 1
          product.stock = Number(values[0])
        }
        return { rows: [{ ...product }], rowCount: 1 }
      }
    }
    const service = new loaded.service.CommandService({
      transaction: async (operation) => operation(database)
    })
    const principal = { subject: COMMAND_SUBJECT, roles: ['catalog-manager'] }
    const key = 'restock-attempt-0001'
    const body = { skuId: COMMAND_ITEM, quantity: 2 }
    const first = await service.execute(plan, principal, key, body)
    expect(first.stock).toBe(12)
    product.stock = 4
    product.title = 'Renamed after restock'
    expect(await service.execute(plan, principal, key, body)).toEqual(first)
    expect(product.stock).toBe(4)
    expect(productWrites).toBe(1)
    await expect(service.execute(plan, principal, key, { ...body, quantity: 3 })).rejects.toThrow(
      'Request conflict'
    )
    await expect(service.execute(plan, { ...principal, roles: [] }, key, body)).rejects.toThrow(
      'Access denied'
    )
    expect(productWrites).toBe(1)
  })
})
