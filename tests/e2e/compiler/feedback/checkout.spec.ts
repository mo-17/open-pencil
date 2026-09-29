import { expect, test, type Route } from '@playwright/test'

import {
  dismissSuccess,
  expectUnavailable,
  successNotification
} from '#tests/helpers/compiler/feedback/assertions'
import { mobileBrowserOptions } from '#tests/helpers/compiler/mobile/layout'
import { mobileId, mobileProduct, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'
import { withMobileStarter } from '#tests/helpers/compiler/mobile/starter'

test.use({ ...mobileBrowserOptions, reducedMotion: 'reduce' })

for (const target of ['react', 'vue'] as const) {
  test(`${target} checkout keeps accepted and unknown outcomes silent until a same-key retry returns a result`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withMobileStarter(page, 'shop', target, async ({ base, open }) => {
      const calls: { payload: unknown; key?: string }[] = []
      let held: Route | undefined
      const order = {
        id: mobileId(21),
        sku_id: mobileProduct.id,
        product_title: mobileProduct.title,
        quantity: 2,
        unit_price: mobileProduct.price,
        total: mobileProduct.price * 2,
        status: 'pending',
        created_at: mobileRecordedAt
      }
      await page.route('**/*', async (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (!url.pathname.startsWith(base + '/')) return route.continue()
        if (request.method() === 'GET')
          return route.fulfill({
            json: {
              data: url.pathname.endsWith('/products') ? [mobileProduct] : [],
              nextCursor: null
            }
          })
        calls.push({ payload: request.postDataJSON(), key: request.headers()['idempotency-key'] })
        if (calls.length === 1) {
          held = route
          return
        }
        if (calls.length === 2)
          return route.fulfill({ status: 503, json: { message: 'Completion is unknown.' } })
        return route.fulfill({ json: order })
      })
      await open('main')
      await page.getByRole('button', { name: 'Choose product', exact: true }).tap()
      await page.getByPlaceholder('1–99', { exact: true }).fill('2')
      const placeOrder = page.getByRole('button', { name: 'Place order', exact: true })
      await page.clock.fastForward(350)
      await placeOrder.tap()
      await page.getByRole('button', { name: 'Keep editing', exact: true }).tap()
      expect(calls).toHaveLength(0)
      await expect(successNotification(page)).toHaveCount(0)
      await page.clock.fastForward(350)
      await placeOrder.tap()
      await page.getByRole('button', { name: 'Confirm order', exact: true }).tap()
      await expect.poll(() => calls.length).toBe(1)
      await expectUnavailable(placeOrder)
      await expect(successNotification(page)).toHaveCount(0)
      if (!held) throw new Error('Missing held checkout request')
      await held.fulfill({ status: 202, json: { status: 'pending' } })
      const retry = page.getByRole('button', { name: 'Retry saved request', exact: true })
      await expect(retry).toBeVisible()
      await expect(page.getByText(/Completion is not confirmed/u)).toBeVisible()
      await expect(successNotification(page)).toHaveCount(0)
      await page.getByRole('button', { name: 'View saved attempt', exact: true }).tap()
      await expect(successNotification(page)).toHaveCount(0)
      expect(calls).toHaveLength(1)

      await retry.tap()
      await expect.poll(() => calls.length).toBe(2)
      await expect(retry).toBeVisible()
      await expect(successNotification(page)).toHaveCount(0)
      expect(calls[1]).toEqual(calls[0])
      await page.clock.fastForward(350)
      await retry.tap()
      await expect.poll(() => calls.length).toBe(3)
      expect(calls[2]).toEqual(calls[0])
      expect(calls[0].payload).toEqual({ skuId: mobileProduct.id, quantity: 2 })
      expect(calls[0].key).toMatch(/^[A-Za-z0-9._:-]{16,128}$/u)
      await expect(successNotification(page)).toContainText(
        'Order recorded. No payment was collected.'
      )
      await expect(successNotification(page)).not.toContainText(
        /paid|payment successful|order completed|fulfilled/iu
      )
      await expect(page.getByRole('button', { name: 'Start new order', exact: true })).toBeVisible()
      await page.clock.runFor(200)
      await page.screenshot({
        path: info.outputPath(`checkout-${target}-recorded.png`),
        animations: 'disabled'
      })
      await dismissSuccess(page, 'Order recorded. No payment was collected.')
      await page.getByRole('button', { name: 'View saved attempt', exact: true }).tap()
      await expect(successNotification(page)).toHaveCount(0)
      expect(calls).toHaveLength(3)
    })
  })
}
