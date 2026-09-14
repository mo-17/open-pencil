import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { nestJSCommandPlan } from '#compiler/backend/nestjs/commands/plan'

import { parseBackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createMerchantCommerceApplication } from '@/app/lowcode/backend/commerce/merchant/application'
import type { CommerceMerchantMode } from '@/app/lowcode/backend/commerce/merchant/types'

import {
  COMMAND_ITEM,
  COMMAND_SUBJECT,
  commandRuntime,
  type RuntimeCommandDatabase,
  type RuntimeCommandQuery
} from '#tests/engine/compiler/backend/nestjs/commands/helpers'

const STORE_ID = '30000000-0000-4000-8000-000000000003'
const OTHER_STORE_ID = '40000000-0000-4000-8000-000000000004'
const ORDER_ID = '50000000-0000-4000-8000-000000000005'
const CREATED_AT = '2026-09-13T01:02:03.123456Z'

function application(mode: CommerceMerchantMode) {
  return createMerchantCommerceApplication(
    'merchant-commands',
    {
      kind: 'oidc-pkce',
      issuer: 'https://identity.example.com',
      clientId: 'shop-public-client',
      scopes: ['openid', 'profile'],
      callbackPath: '/_openpencil/auth/callback'
    },
    mode
  )
}

function commandPlan(mode: CommerceMerchantMode, id: string) {
  const app = application(mode)
  const command = app.commands?.commands.find((entry) => entry.id === id)
  if (!command) throw new Error('Missing merchant command')
  return nestJSCommandPlan(app, command)
}

function resource(app: ReturnType<typeof application>, id: string) {
  const entry = app.httpApi?.resources.find((value) => value.id === id)
  if (!entry) throw new Error('Missing merchant resource')
  return entry
}

// Substitute PostgreSQL row storage/defaults only. Generated input validation, SQL,
// ordering, assertions, value evaluation, and result projections run unchanged.
function databaseFixture(storeId = STORE_ID) {
  const queries: RuntimeCommandQuery[] = []
  const store = { id: storeId, title: "Tea shop '春茶'" }
  const product = {
    id: COMMAND_ITEM,
    store_id: STORE_ID,
    title: 'Original tea',
    price: 1299,
    stock: 6,
    active: true
  }
  let order: Record<string, unknown> | undefined
  const storedOrder = () => {
    if (!order) throw new Error('Order has not been inserted')
    return order
  }
  const database: RuntimeCommandDatabase = {
    query: async (text, values = []) => {
      queries.push({ text, values })
      if (text.startsWith('SELECT') && text.includes('FROM "public"."stores"'))
        return { rowCount: 1, rows: [{ ...store }] }
      if (text.startsWith('SELECT') && text.includes('FROM "public"."products"'))
        return { rowCount: 1, rows: [{ ...product }] }
      if (text.startsWith('UPDATE "public"."products"')) {
        product.stock = Number(values[0])
        return { rowCount: 1, rows: [{ ...product }] }
      }
      if (text.startsWith('INSERT INTO "public"."orders"')) {
        const columns = text
          .slice(text.indexOf('(') + 1, text.indexOf(') VALUES'))
          .split(', ')
          .map((column) => column.replaceAll('"', ''))
        order = { id: ORDER_ID, created_at: CREATED_AT }
        for (const [index, column] of columns.entries()) order[column] = values[index]
        return { rowCount: 1, rows: [{ ...order }] }
      }
      if (text.startsWith('SELECT') && text.includes('FROM "public"."orders"'))
        return { rowCount: 1, rows: [{ ...storedOrder() }] }
      if (text.startsWith('UPDATE "public"."orders"')) {
        storedOrder().status = values[0]
        return { rowCount: 1, rows: [{ ...storedOrder() }] }
      }
      throw new Error('Unexpected generated merchant query')
    }
  }
  return { database, queries, store, product, storedOrder }
}

describe('merchant commerce model and generated command execution', () => {
  let multi: Awaited<ReturnType<typeof commandRuntime>>
  let single: Awaited<ReturnType<typeof commandRuntime>>
  beforeAll(async () => {
    multi = await commandRuntime(application('multi-merchant'))
    single = await commandRuntime(application('single-merchant'))
  })
  afterAll(async () => {
    await multi.dispose()
    await single.dispose()
  })

  test.each(['single-merchant', 'multi-merchant'] as const)(
    '%s keeps buyer reads separate from merchant reads and public owner metadata',
    (mode) => {
      const app = application(mode)
      expect(parseBackendApplicationSpecV1(app).ok).toBe(true)
      const buyerOrders = resource(app, 'orders')
      const merchantOrders = resource(app, 'merchant-orders')
      const products = resource(app, 'products')
      expect(buyerOrders.readPolicyIds).toEqual(['own-orders'])
      expect(merchantOrders.readPolicyIds).toEqual([
        mode === 'multi-merchant' ? 'merchant-orders' : 'manage-orders'
      ])
      expect(buyerOrders.operations).toEqual(['list', 'read'])
      expect(merchantOrders.operations).toEqual(['list', 'read'])
      expect(products.readFields).not.toContain('owner_id')
      if (mode === 'single-merchant') {
        expect(app.auth.tenants).toEqual([])
        expect(app.auth.roles.map((role) => role.id)).toEqual(['catalog-manager'])
        return
      }
      const stores = resource(app, 'stores')
      const myStore = resource(app, 'my-store')
      expect(stores.readFields).toEqual(['id', 'title'])
      expect(stores.createFields).toEqual(['title'])
      expect(stores.operations).toEqual(['list', 'read', 'create'])
      expect(myStore.readPolicyIds).toEqual(['own-store'])
      expect(myStore.operations).toEqual(['list', 'read'])
      expect(myStore.readFields).toEqual(['id', 'title'])
      expect(myStore.maxPageSize).toBe(1)
    }
  )

  test('multi checkout locks the selected store before its product and snapshots server values', async () => {
    const { database, queries, store, product, storedOrder } = databaseFixture()
    const plan = commandPlan('multi-merchant', 'checkout')
    const input = multi.input.commandInput(plan.parameters, {
      skuId: COMMAND_ITEM,
      quantity: 2,
      storeId: STORE_ID
    })
    const placed = await multi.execution.executeCommand(database, plan, input, COMMAND_SUBJECT)
    expect(queries).toHaveLength(4)
    expect(queries[0].text).toContain('FROM "public"."stores" WHERE "id" = $1 FOR UPDATE')
    expect(queries[0].values).toEqual([STORE_ID])
    expect(queries[1].text).toContain('FROM "public"."products" WHERE "id" = $1 FOR UPDATE')
    expect(queries[1].values).toEqual([COMMAND_ITEM])
    expect(queries[2].text).toStartWith('UPDATE "public"."products" SET "stock" = $1')
    expect(queries[2].values).toEqual([4, COMMAND_ITEM])
    expect(queries[3].text).toStartWith('INSERT INTO "public"."orders"')
    expect(queries[3].text).not.toContain(store.title)
    expect(placed).toEqual({
      id: ORDER_ID,
      sku_id: COMMAND_ITEM,
      product_title: 'Original tea',
      unit_price: 1299,
      quantity: 2,
      total: 2598,
      status: 'pending',
      created_at: CREATED_AT,
      store_id: STORE_ID,
      store_title: store.title
    })
    expect(storedOrder().owner_id).toBe(COMMAND_SUBJECT)
    store.title = 'Renamed store'
    product.title = 'Renamed product'
    product.price = 1
    expect(storedOrder()).toMatchObject({
      store_id: STORE_ID,
      store_title: "Tea shop '春茶'",
      product_title: 'Original tea',
      unit_price: 1299,
      total: 2598
    })
    expect(product.stock).toBe(4)
  })

  test('multi checkout rejects a different selected store before inventory or order writes', async () => {
    const { database, queries, product } = databaseFixture(OTHER_STORE_ID)
    await expect(
      multi.execution.executeCommand(
        database,
        commandPlan('multi-merchant', 'checkout'),
        { skuId: COMMAND_ITEM, quantity: 2, storeId: OTHER_STORE_ID },
        COMMAND_SUBJECT
      )
    ).rejects.toThrow('Request conflict')
    expect(queries).toHaveLength(2)
    expect(queries[0].values).toEqual([OTHER_STORE_ID])
    expect(queries[1].values).toEqual([COMMAND_ITEM])
    expect(queries.every((query) => query.text.startsWith('SELECT'))).toBe(true)
    expect(product.stock).toBe(6)
  })

  test('multi checkout rejects forged snapshot or authority fields before opening a transaction', async () => {
    const plan = commandPlan('multi-merchant', 'checkout')
    let transactions = 0
    const service = new multi.service.CommandService({
      transaction: async () => {
        transactions += 1
        throw new Error('Untrusted payload reached the database')
      }
    })
    const payload = { skuId: COMMAND_ITEM, quantity: 2, storeId: STORE_ID }
    for (const extra of [
      { store_id: OTHER_STORE_ID },
      { store_title: 'Forged store' },
      { product_title: 'Forged title' },
      { unit_price: 1 },
      { total: 2 },
      { owner_id: OTHER_STORE_ID },
      { status: 'fulfilled' }
    ]) {
      await expect(
        service.execute(
          plan,
          { subject: COMMAND_SUBJECT, roles: [] },
          'merchant-checkout-forgery-0001',
          { ...payload, ...extra }
        )
      ).rejects.toThrow('Invalid request')
    }
    expect(transactions).toBe(0)
  })

  test('single fulfillment commits pending to fulfilled and subsequent buyer cancellation cannot release stock', async () => {
    const { database, queries, product, storedOrder } = databaseFixture()
    const placed = await single.execution.executeCommand(
      database,
      commandPlan('single-merchant', 'checkout'),
      { skuId: COMMAND_ITEM, quantity: 2 },
      COMMAND_SUBJECT
    )
    const fulfillPlan = commandPlan('single-merchant', 'fulfill-order')
    expect(fulfillPlan.access).toEqual({ kind: 'role', roleId: 'catalog-manager' })
    const fulfilled = await single.execution.executeCommand(
      database,
      fulfillPlan,
      { orderId: ORDER_ID },
      COMMAND_SUBJECT
    )
    expect(fulfilled).toEqual({ ...placed, status: 'fulfilled' })
    expect(storedOrder().status).toBe('fulfilled')
    expect(product.stock).toBe(4)
    const afterFulfill = queries.length
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        single.execution.executeCommand(
          database,
          commandPlan('single-merchant', 'cancel-order'),
          { orderId: ORDER_ID },
          COMMAND_SUBJECT
        )
      ).rejects.toThrow('Request conflict')
    }
    expect(queries.slice(afterFulfill)).toHaveLength(2)
    for (const query of queries.slice(afterFulfill)) {
      expect(query.text).toContain('FROM "public"."orders"')
      expect(query.text).toEndWith('FOR UPDATE')
      expect(query.values).toEqual([ORDER_ID, COMMAND_SUBJECT])
    }
    expect(product.stock).toBe(4)
    expect(storedOrder().status).toBe('fulfilled')
    expect(
      queries.filter((query) => query.text.startsWith('UPDATE "public"."products"'))
    ).toHaveLength(1)
  })
})
