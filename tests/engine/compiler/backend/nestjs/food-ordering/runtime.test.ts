import { afterAll, beforeAll, expect, mock, test } from 'bun:test'

import { foodRuntime, type FoodQuery, type FoodRow } from './helpers'

const buyer = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const cart: FoodRow = {
  id: '20000000-0000-4000-8000-000000000001',
  owner_id: buyer,
  version: 4,
  subtotal: 999999,
  item_count: 2
}
const first = '30000000-0000-4000-8000-000000000001'
const second = '30000000-0000-4000-8000-000000000002'
const body = {
  cartRevision: 4,
  tableNumber: ' A1 ',
  contactName: ' Buyer ',
  phone: '',
  note: ' less salt '
}
let runtime: Awaited<ReturnType<typeof foodRuntime>>
beforeAll(async () => {
  runtime = await foodRuntime()
})
afterAll(async () => {
  await runtime?.dispose()
})
const reply = (rows: FoodRow[]) => ({ rows, rowCount: rows.length })

test('generated food money accepts free items and rejects fractional, negative and overflowing amounts', () => {
  const operations = runtime.operations
  for (const amount of [-1, 1.5, Number.NaN, Infinity, 2147483648n, '100'])
    expect(() => operations.foodAmount(amount)).toThrow()
  expect(runtime.operations.foodAmount(0n)).toBe(0)
  expect(runtime.operations.foodAmount(2147483647n)).toBe(2147483647)
})

test('food commands reject anonymous callers, revoked roles and forged amount/owner before database access', async () => {
  const transaction = mock(async () => {
    throw new Error('Unexpected database access')
  })
  const service = new runtime.service.CommandService({ transaction })
  const key = 'food-request-key-0001'
  await expect(
    service.execute(runtime.plan('cart.set'), null, key, { menuItemId: first, quantity: 1 })
  ).rejects.toThrow('Authentication required')
  await expect(
    service.execute(runtime.plan('order.accept'), { subject: buyer, roles: [] }, key, {
      orderId: first,
      note: ''
    })
  ).rejects.toThrow('Access denied')
  await expect(
    service.execute(runtime.plan('checkout.pickup'), { subject: buyer, roles: [] }, key, {
      cartRevision: 4,
      contactName: 'Buyer',
      phone: '',
      note: '',
      total: 1,
      owner_id: other
    })
  ).rejects.toThrow()
  expect(transaction).not.toHaveBeenCalled()
})

test('current order ownership is queried before any idempotent response replay', async () => {
  const queries: { sql: string; values?: unknown[] }[] = []
  const service = new runtime.service.CommandService({
    transaction: (run) =>
      run({
        query: async (sql, values) => {
          queries.push({ sql, values })
          return reply([])
        }
      })
  })
  await expect(
    service.execute(
      runtime.plan('order.cancel'),
      { subject: other, roles: [] },
      'food-saved-key-00001',
      { orderId: first, note: '' }
    )
  ).rejects.toThrow('Record not found')
  expect(queries).toHaveLength(1)
  expect(queries[0].sql).toContain('"owner_id"=$2')
  expect(queries[0].sql).toEndWith('FOR UPDATE')
  expect(queries[0].values).toEqual([first, other])
  expect(queries[0].sql).not.toContain('openpencil_command_requests')
})

function checkoutQuery(prices: readonly number[], available = true) {
  const writes: { sql: string; values?: unknown[] }[] = []
  const menuOrder: unknown[] = []
  const items: FoodRow[] = [
    { id: second, menu_item_id: second, quantity: 1, unit_price: 800 },
    { id: first, menu_item_id: first, quantity: 2, unit_price: 1250 }
  ]
  let line = 0
  const query: FoodQuery = async (sql, values) => {
    if (sql.startsWith('SELECT') && sql.includes('"food_cart_items"')) return reply(items)
    if (sql.startsWith('SELECT') && sql.includes('"food_menu_items"')) {
      menuOrder.push(values?.[0])
      expect(sql).toEndWith('FOR SHARE')
      return reply([
        { id: String(values?.[0]), price: prices[line++], available, title: 'Current menu title' }
      ])
    }
    writes.push({ sql, values })
    return reply([{ id: first, owner_id: buyer, status: 'pending', total: 3300, version: 0 }])
  }
  return { query, writes, menuOrder, items }
}

test('stale revision, changed price and sold-out menu fail before checkout writes', async () => {
  const noQuery = mock(async () => reply([]))
  await expect(
    runtime.operations.checkoutFoodCart(
      { query: noQuery },
      cart,
      { ...body, cartRevision: 3 },
      buyer,
      'dine_in'
    )
  ).rejects.toThrow('state conflict')
  expect(noQuery).not.toHaveBeenCalled()
  for (const changed of [checkoutQuery([1250, 900]), checkoutQuery([1250, 800], false)]) {
    await expect(
      runtime.operations.checkoutFoodCart(changed, cart, body, buyer, 'dine_in')
    ).rejects.toThrow('state conflict')
    expect(changed.writes).toEqual([])
  }
})

test('checkout locks menu IDs in order and derives totals from prices, then writes snapshots/history and consumes the cart', async () => {
  const database = checkoutQuery([1250, 800])
  await runtime.operations.checkoutFoodCart(database, cart, body, buyer, 'dine_in')
  expect(database.menuOrder).toEqual([first, second])
  expect(database.writes[0].sql).toStartWith('INSERT INTO "public"."food_orders"')
  expect(database.writes[0].values).toEqual([
    buyer,
    'pending',
    'dine_in',
    'A1',
    'Buyer',
    '',
    'less salt',
    'CNY',
    3300,
    0
  ])
  const snapshots = database.writes.filter((entry) =>
    entry.sql.startsWith('INSERT INTO "public"."food_order_items"')
  )
  expect(snapshots.map((entry) => entry.values?.slice(-3))).toEqual([
    [2, 1250, 2500],
    [1, 800, 800]
  ])
  const history = database.writes.find((entry) => entry.sql.includes('"food_order_history"'))
  expect(history?.values).toEqual([
    buyer,
    first,
    buyer,
    'checkout.dine-in',
    'pending',
    'pending',
    'less salt'
  ])
  expect(database.writes.at(-1)?.values).toEqual([cart.id, 5, 0, 0])
})

test('kitchen state transitions forbid jumps and preserve customer ownership in history', async () => {
  const writes: { sql: string; values?: unknown[] }[] = []
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      writes.push({ sql, values })
      return reply([{ id: first, owner_id: buyer, status: 'accepted', version: 1 }])
    }
  }
  const pending: FoodRow = { id: first, owner_id: buyer, status: 'pending', version: 0 }
  await expect(
    runtime.operations.transitionFoodOrder(
      client,
      pending,
      runtime.plan('order.complete'),
      { note: '' },
      other
    )
  ).rejects.toThrow('state conflict')
  await expect(
    runtime.operations.transitionFoodOrder(
      client,
      { ...pending, status: 'accepted' },
      runtime.plan('order.cancel'),
      { note: '' },
      buyer
    )
  ).rejects.toThrow('state conflict')
  expect(writes).toEqual([])
  await runtime.operations.transitionFoodOrder(
    client,
    pending,
    runtime.plan('order.accept'),
    { note: ' started ' },
    other
  )
  expect(writes[0].values).toEqual([first, 'accepted', 1])
  expect(writes[1].values).toEqual([
    buyer,
    first,
    other,
    'order.accept',
    'pending',
    'accepted',
    'started'
  ])
})
