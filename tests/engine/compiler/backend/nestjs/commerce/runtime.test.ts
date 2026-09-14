import { afterAll, beforeAll, expect, test } from 'bun:test'

import { commerceApplication, commerceRuntime } from './helpers'

const SUBJECT = '10000000-0000-4000-8000-000000000001'
const ITEM = '20000000-0000-4000-8000-000000000002'
let loaded: Awaited<ReturnType<typeof commerceRuntime>>
beforeAll(async () => {
  loaded = await commerceRuntime(commerceApplication())
})
afterAll(async () => {
  await loaded.dispose()
})

test('generated commerce money rejects overflow, fractions and negative inventory', () => {
  const { amount } = loaded.data
  for (const value of [-1, 1.5, Number.NaN, Infinity, 2147483648n, '100'])
    expect(() => amount(value)).toThrow()
  expect(loaded.data.amount(2147483647n)).toBe(2147483647)
})

test('current store membership is checked before an old command ledger can be queried', async () => {
  const queries: string[] = []
  const service = new loaded.service.CommandService({
    transaction: async (run) =>
      run({
        query: async (sql) => {
          queries.push(sql)
          return { rows: [], rowCount: 0 }
        }
      })
  })
  await expect(
    service.execute(
      loaded.plan('restock-product'),
      { subject: SUBJECT, roles: ['merchant'] },
      'old-request-key-00001',
      { skuId: ITEM, storeId: ITEM, quantity: 1 }
    )
  ).rejects.toThrow('Record not found')
  expect(queries).toHaveLength(1)
  expect(queries[0]).toEndWith('FOR SHARE')
  expect(queries[0]).not.toContain('openpencil_command_requests')
})

test('production simulator rejection occurs before any database access or response replay', async () => {
  const previous = process.env.NODE_ENV
  const previousMode = process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE
  let queries = 0
  process.env.NODE_ENV = 'production'
  process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE = 'simulator'
  try {
    const service = new loaded.service.CommandService({
      transaction: async (run) =>
        run({
          query: async () => {
            queries++
            return { rows: [], rowCount: 0 }
          }
        })
    })
    await expect(
      service.execute(
        loaded.plan('payment.simulate'),
        { subject: SUBJECT, roles: [] },
        'old-request-key-00001',
        { purchaseId: ITEM, outcome: 'succeeded' }
      )
    ).rejects.toThrow('simulator is disabled')
    expect(queries).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
    if (previousMode === undefined) delete process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE
    else process.env.OPENPENCIL_COMMERCE_PAYMENT_MODE = previousMode
  }
})

test('zero-price child orders prevent premature full refund despite amount equality', () => {
  const group = { status: 'paid', total: 1250, refunded_amount: 1250 }
  const children = [
    { status: 'refunded', total: 1250 },
    { status: 'paid', total: 0 }
  ]
  expect(loaded.refund.refundGroupStatus(group, children)).toBe('partially_refunded')
  expect(loaded.refund.refundGroupStatus({ ...group, status: 'refund_required' }, children)).toBe(
    'refund_required'
  )
  expect(
    loaded.refund.refundGroupStatus(
      group,
      children.map((order) => ({ ...order, status: 'refunded' }))
    )
  ).toBe('refunded')
  expect(() => loaded.refund.refundGroupStatus(group, [])).toThrow()
})
