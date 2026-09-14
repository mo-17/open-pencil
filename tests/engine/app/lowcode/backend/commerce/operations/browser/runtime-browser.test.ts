import { describe, expect, test } from 'bun:test'

import { chromium, expect as browserExpect, type Page } from '@playwright/test'

import { createPreviewServer } from '@open-pencil/compiler/dev-server'

import { commerceBrowserFixture } from './helpers'
import { cartReply, cartRows, ids, installCommerceTransport } from './transport/helpers'

async function confirm(page: Page, label: string) {
  // Generated request handlers intentionally ignore clicks inside their 300 ms throttle window.
  await page.clock.fastForward(350)
  await page.getByRole('button', { name: label, exact: true }).click()
  await browserExpect(
    page.getByText('Confirm this action? ' + label, { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: label, exact: true }).last().click()
}

async function acknowledge(page: Page) {
  await page.getByRole('button', { name: 'Finish reviewed request', exact: true }).click()
  await page.getByRole('button', { name: /^(OK|Confirm)$/u }).click()
  await browserExpect(
    page.getByRole('button', { name: 'Finish reviewed request', exact: true })
  ).toHaveCount(0)
}

describe('compiled commerce pages with a test session and scripted API', () => {
  test.each(['react', 'vue'] as const)(
    '%s cart, payment, shipment and settlement controls execute the reviewed commands',
    async (target) => {
      const fixture = await commerceBrowserFixture(target)
      const server = await createPreviewServer({ target, initialFiles: fixture.files })
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
      try {
        browser = await chromium.launch()
        const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } })
        page.setDefaultTimeout(8_000)
        await page.clock.install()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        const api = await installCommerceTransport(page, fixture.apiBasePath)
        // The unconnected VFS has no server history fallback. Serve its real entry at /shop.
        const startURL = new URL(fixture.paths.shop, server.url).href
        await page.route(startURL, async (route) =>
          route.fulfill({ response: await route.fetch({ url: server.url }) })
        )
        await page.goto(startURL)
        await browserExpect(page.getByText('Tea', { exact: true }).first()).toBeVisible()

        // Saved attempts must be reviewed before another cart mutation uses a fresh key.
        api.steps.push({
          path: 'cart-set',
          payload: { skuId: ids.tea, quantity: 2 },
          result: cartReply(1, 2),
          resources: { carts: [cartReply(1, 2)], 'cart-items': cartRows(2) }
        })
        await page.getByRole('button', { name: 'Select', exact: true }).first().click()
        await page.getByPlaceholder('Quantity', { exact: true }).fill('2')
        await confirm(page, 'Save cart quantity')
        await browserExpect.poll(() => api.calls.length).toBe(1)
        await browserExpect(page.getByPlaceholder('Quantity', { exact: true })).toHaveCount(0)
        await acknowledge(page)

        api.steps.push({
          path: 'cart-set',
          payload: { skuId: ids.coffee, quantity: 1 },
          result: cartReply(2, 2, true),
          resources: { carts: [cartReply(2, 2, true)], 'cart-items': cartRows(2, true) }
        })
        await page.getByRole('button', { name: 'Select', exact: true }).nth(1).click()
        await confirm(page, 'Save cart quantity')
        await browserExpect.poll(() => api.calls.length).toBe(2)
        await acknowledge(page)

        await page.getByRole('button', { name: 'Shopping cart', exact: true }).click()
        await browserExpect(page.getByText('Tea · 2 × 1200 = 2400', { exact: true })).toBeVisible()
        api.steps.push({
          path: 'cart-set',
          payload: { skuId: ids.tea, quantity: 3 },
          result: cartReply(3, 3, true),
          resources: { carts: [cartReply(3, 3, true)], 'cart-items': cartRows(3, true) }
        })
        await page.getByRole('button', { name: 'Select', exact: true }).first().click()
        await page.getByPlaceholder('Quantity', { exact: true }).fill('3')
        await confirm(page, 'Save cart quantity')
        await browserExpect(page.getByText('Tea · 3 × 1200 = 3600', { exact: true })).toBeVisible()
        await acknowledge(page)

        api.steps.push({
          path: 'cart-remove',
          payload: { itemId: ids.coffeeItem },
          result: cartReply(4, 3),
          resources: { carts: [cartReply(4, 3)], 'cart-items': cartRows(3) }
        })
        await page.getByRole('button', { name: 'Select', exact: true }).nth(1).click()
        await confirm(page, 'Remove from cart')
        await browserExpect(page.getByText('Coffee · 1 × 800 = 800', { exact: true })).toHaveCount(
          0
        )
        await acknowledge(page)
        await page.getByRole('button', { name: 'Commerce shop', exact: true }).click()
        api.steps.push({
          path: 'cart-set',
          payload: { skuId: ids.coffee, quantity: 1 },
          result: cartReply(5, 3, true),
          resources: { carts: [cartReply(5, 3, true)], 'cart-items': cartRows(3, true) }
        })
        await page.getByRole('button', { name: 'Select', exact: true }).nth(1).click()
        await confirm(page, 'Save cart quantity')
        await browserExpect.poll(() => api.calls.length).toBe(5)
        await acknowledge(page)
        await page.getByRole('button', { name: 'Shopping cart', exact: true }).click()
        const artifactDirectory = process.env.COMMERCE_BROWSER_ARTIFACT_DIR
        if (artifactDirectory)
          await page.screenshot({
            path: artifactDirectory + '/' + target + '-cart.png',
            fullPage: true
          })
        await page.getByRole('button', { name: 'Checkout', exact: true }).click()
        await page.getByRole('button', { name: 'Review this cart', exact: true }).click()
        await page.getByPlaceholder('Recipient', { exact: true }).fill('UI Buyer')
        await page.getByPlaceholder('Phone', { exact: true }).fill('10000000000')
        await page.getByPlaceholder('Delivery address', { exact: true }).fill('Test address')
        const purchase = {
          id: ids.purchase,
          status: 'pending',
          total: 4400,
          currency: 'CNY',
          order_count: 2
        }
        const orders = [
          {
            id: ids.order,
            payment_group_id: ids.purchase,
            store_title: 'Tea House',
            status: 'awaiting_payment',
            total: 3600,
            recipient: 'UI Buyer',
            phone: '10000000000',
            address: 'Test address'
          },
          {
            id: ids.secondOrder,
            payment_group_id: ids.purchase,
            store_title: 'Coffee House',
            status: 'awaiting_payment',
            total: 800
          }
        ]
        api.steps.push({
          path: 'cart-checkout',
          payload: {
            cartRevision: 5,
            recipient: 'UI Buyer',
            phone: '10000000000',
            address: 'Test address'
          },
          result: purchase,
          resources: { purchases: [purchase], orders, carts: [], 'cart-items': [] }
        })
        await confirm(page, 'Place purchase')
        await browserExpect.poll(() => api.calls.length).toBe(6)
        await page.getByRole('button', { name: 'My purchases', exact: true }).first().click()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await browserExpect(
          page.getByText('Tea House · awaiting_payment · 3600', { exact: true })
        ).toBeVisible()
        await browserExpect(
          page.getByText('Coffee House · awaiting_payment · 800', { exact: true })
        ).toBeVisible()
        const paid = orders.map((order) => ({ ...order, status: 'paid' }))
        api.steps.push({
          path: 'payment-simulate',
          payload: { purchaseId: ids.purchase, outcome: 'succeeded' },
          result: { ...purchase, status: 'paid' },
          resources: {
            purchases: [{ ...purchase, status: 'paid' }],
            orders: paid,
            'merchant-orders': [paid[0]]
          }
        })
        await confirm(page, 'Run payment simulation')
        await browserExpect(
          page.getByText('Tea House · paid · 3600', { exact: true })
        ).toBeVisible()

        // Separate buyer/merchant/operator authorization is exercised by the PostgreSQL suite.
        await page.getByRole('button', { name: 'My store', exact: true }).click()
        await page.getByRole('button', { name: 'Merchant fulfillment', exact: true }).click()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await browserExpect(
          page.getByText('UI Buyer · 10000000000 · Test address', { exact: true })
        ).toBeVisible()
        await page.getByPlaceholder('Carrier', { exact: true }).fill('Test carrier')
        await page.getByPlaceholder('Tracking number', { exact: true }).fill('TRACK-UI-1')
        const shipment = {
          id: ids.order,
          order_id: ids.order,
          carrier: 'Test carrier',
          tracking_number: 'TRACK-UI-1',
          status: 'shipped'
        }
        api.steps.push({
          path: 'shipment-dispatch',
          payload: { orderId: ids.order, carrier: 'Test carrier', trackingNumber: 'TRACK-UI-1' },
          result: shipment,
          resources: {
            orders: [{ ...paid[0], status: 'shipped' }],
            shipments: [shipment],
            'merchant-shipments': [shipment],
            'merchant-orders': [{ ...paid[0], status: 'shipped' }]
          }
        })
        await confirm(page, 'Record shipment')
        await browserExpect(
          page.getByText('Test carrier · TRACK-UI-1 · shipped', { exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'My purchases', exact: true }).click()
        // Route to the child's delivery page through the generated purchase row.
        await acknowledge(page)
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page
          .getByRole('button', { name: 'Delivery and refunds', exact: true })
          .first()
          .click()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        const settlement = {
          id: ids.settlement,
          order_id: ids.order,
          gross_amount: 3600,
          commission: 180,
          merchant_amount: 3420,
          currency: 'CNY',
          status: 'pending',
          available_at: '2026-09-13T00:00:00Z',
          reference: null
        }
        api.steps.push({
          path: 'shipment-deliver',
          payload: { orderId: ids.order },
          result: { ...paid[0], status: 'delivered' },
          resources: {
            orders: [{ ...paid[0], status: 'delivered' }],
            'operator-settlements': [settlement],
            'merchant-settlements': [settlement]
          }
        })
        await confirm(page, 'Confirm delivery')
        await browserExpect(
          page.getByText('Tea House · delivered · 3600', { exact: true })
        ).toBeVisible()
        await page.getByRole('button', { name: 'My store', exact: true }).click()
        await page.getByRole('button', { name: 'Platform bookkeeping', exact: true }).click()
        await browserExpect(page.getByText('3600 - 180 = 3420 CNY', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Select', exact: true }).click()
        await page
          .getByPlaceholder('External record reference', { exact: true })
          .fill('external-record-only')
        api.steps.push({
          path: 'settlement-record',
          payload: { settlementId: ids.settlement, reference: 'external-record-only' },
          result: { ...settlement, status: 'recorded' },
          resources: {
            'operator-settlements': [
              { ...settlement, status: 'recorded', reference: 'external-record-only' }
            ]
          }
        })
        await confirm(page, 'Record settlement')
        await browserExpect(
          page.getByText(ids.order + ' · recorded', { exact: true })
        ).toBeVisible()
        expect(api.steps).toEqual([])
        expect(api.failures).toEqual([])
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(10)
        expect(errors).toEqual([])
        if (artifactDirectory)
          await page.screenshot({
            path: artifactDirectory + '/' + target + '-settlement.png',
            fullPage: true
          })
      } finally {
        await browser?.close()
        await server.close()
      }
    },
    90_000
  )
})
