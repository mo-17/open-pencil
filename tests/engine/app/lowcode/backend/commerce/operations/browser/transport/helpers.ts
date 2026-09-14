import { expect } from 'bun:test'

import type { Page } from '@playwright/test'

export const ids = {
  tea: '00000000-0000-4000-8000-000000000010',
  coffee: '00000000-0000-4000-8000-000000000011',
  cart: '00000000-0000-4000-8000-000000000020',
  item: '00000000-0000-4000-8000-000000000021',
  coffeeItem: '00000000-0000-4000-8000-000000000022',
  purchase: '00000000-0000-4000-8000-000000000030',
  order: '00000000-0000-4000-8000-000000000031',
  secondOrder: '00000000-0000-4000-8000-000000000032',
  settlement: '00000000-0000-4000-8000-000000000040'
}
type Row = Record<string, string | number | boolean | null>
export interface BrowserCommandStep {
  path: string
  payload: object
  result: Row
  resources?: Record<string, Row[]>
}

/** Scripted server replies test bindings and invalidation, not payment or authorization logic. */
export async function installCommerceTransport(page: Page, base: string) {
  const steps: BrowserCommandStep[] = []
  const calls: { path: string; payload: unknown; key: string | undefined }[] = []
  const failures: string[] = []
  const resources: Record<string, Row[]> = {
    products: [
      { id: ids.tea, title: 'Tea', price: 1200, stock: 8, active: true },
      { id: ids.coffee, title: 'Coffee', price: 800, stock: 9, active: true }
    ],
    carts: [],
    'cart-items': [],
    purchases: [],
    orders: [],
    'order-items': [],
    shipments: [],
    refunds: [],
    'merchant-orders': [],
    'merchant-items': [],
    'merchant-shipments': [],
    'merchant-refunds': [],
    'merchant-settlements': [],
    'operator-refunds': [],
    'operator-settlements': []
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith(base + '/')) return route.continue()
    const path = url.pathname.slice(base.length)
    try {
      if (route.request().method() === 'POST') {
        const request = route.request()
        const payload: unknown = request.postDataJSON()
        const key = request.headers()['idempotency-key']
        const step = steps.shift()
        expect(step).toBeDefined()
        if (!step) throw new Error('Unexpected command: ' + path)
        expect(path).toBe('/commands/' + step.path)
        expect(payload).toEqual(step.payload)
        expect(key).toMatch(/^[A-Za-z0-9._:-]{16,128}$/u)
        expect(request.headers().authorization).toBe('Bearer test-session-only')
        Object.assign(resources, step.resources)
        calls.push({ path, payload, key })
        return route.fulfill({ json: step.result })
      }
      const name = path.slice(1)
      const rows = resources[name] ?? []
      const filter: unknown = JSON.parse(url.searchParams.get('filter') ?? '{}')
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new Error('Unexpected list filter')
      const filters = Object.entries(filter)
      const data = rows.filter((row) => filters.every(([key, value]) => row[key] === value))
      return route.fulfill({ json: { data, nextCursor: null } })
    } catch (error) {
      failures.push(String(error))
      return route.fulfill({ status: 500, json: { message: 'UI fixture mismatch' } })
    }
  })
  return { steps, calls, resources, failures }
}

export function cartReply(version: number, quantity: number, coffee = false): Row {
  return {
    id: ids.cart,
    version,
    subtotal: quantity * 1200 + (coffee ? 800 : 0),
    item_count: coffee ? 2 : 1
  }
}

export function cartRows(quantity: number, coffee = false): Row[] {
  return [
    {
      id: ids.item,
      sku_id: ids.tea,
      product_title: 'Tea',
      quantity,
      unit_price: 1200,
      line_total: quantity * 1200,
      active: true
    },
    ...(coffee
      ? [
          {
            id: ids.coffeeItem,
            sku_id: ids.coffee,
            product_title: 'Coffee',
            quantity: 1,
            unit_price: 800,
            line_total: 800,
            active: true
          }
        ]
      : [])
  ]
}
