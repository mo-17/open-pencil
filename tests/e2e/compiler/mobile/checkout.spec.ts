import { expect, test } from '@playwright/test'

import {
  exerciseReducedViewport,
  expectNoHorizontalOverflow,
  mobileBrowserOptions
} from '#tests/helpers/compiler/mobile/layout'
import { mobileId, mobileProduct, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'
import { withMobileStarter } from '#tests/helpers/compiler/mobile/starter'

test.use(mobileBrowserOptions)

for (const target of ['react', 'vue'] as const) {
  test(`${target} mobile checkout keeps confirmation and the idempotent receipt lifecycle`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withMobileStarter(page, 'shop', target, async ({ base, open }) => {
      const calls: { payload: unknown; key?: string }[] = []
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
        return route.fulfill({
          json: {
            id: mobileId(21),
            sku_id: mobileProduct.id,
            product_title: mobileProduct.title,
            quantity: 2,
            unit_price: mobileProduct.price,
            total: 4800,
            status: 'pending',
            created_at: mobileRecordedAt
          }
        })
      })
      await open('main')
      await page.getByRole('button', { name: 'Choose product', exact: true }).tap()
      await exerciseReducedViewport(
        page,
        page.getByPlaceholder('1–99', { exact: true }),
        '2',
        page.getByRole('button', { name: 'Place order', exact: true })
      )
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: 'Place order', exact: true }).tap()
      expect(calls).toHaveLength(0)
      const confirm = page.getByRole('button', { name: 'Confirm order', exact: true })
      await expect(confirm).toBeInViewport()
      await confirm.tap()
      await expect.poll(() => calls.length).toBe(1)
      expect(calls[0].payload).toEqual({ skuId: mobileProduct.id, quantity: 2 })
      expect(calls[0].key).toMatch(/^[A-Za-z0-9._:-]{16,128}$/u)
      await page.getByRole('button', { name: 'Start new order', exact: true }).tap()
      await page.getByRole('button', { name: /^(OK|Confirm)$/u }).tap()
      await expect(page.getByRole('button', { name: 'Start new order', exact: true })).toHaveCount(
        0
      )
      expect(calls).toHaveLength(1)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`single-sku-shop-${target}-mobile-flow.png`) })
    })
  })
}
