import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import { dismissSuccess, successNotification } from '#tests/helpers/compiler/feedback/assertions'
import {
  mobileBrowserOptions,
  mobileNavigation,
  tapBusinessReceipt,
  tapBusinessSubmit
} from '#tests/helpers/compiler/mobile/layout'
import { mobileDishes, mobileId, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'

test.use({ ...mobileBrowserOptions, reducedMotion: 'reduce' })

for (const target of ['react', 'vue'] as const) {
  test(`${target} restaurant confirms the cart write and keeps the updated dish usable after dismissal`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withBusinessBrowser(page, 'food-ordering', target, async ({ api, open }) => {
      const dish = mobileDishes[0]
      api.resources['food-menu'] = [dish]
      await open('food-menu')
      await page.getByRole('button', { name: 'View details', exact: true }).tap()
      await page.getByRole('button', { name: 'Save dish quantity', exact: true }).tap()
      await page.getByPlaceholder('Quantity', { exact: true }).fill('2')
      const cart = {
        id: mobileId(50),
        version: 1,
        subtotal: dish.price * 2,
        item_count: 1,
        created_at: mobileRecordedAt
      }
      const line = {
        id: mobileId(51),
        cart_id: cart.id,
        menu_item_id: dish.id,
        product_title: dish.title,
        quantity: 2,
        unit_price: dish.price,
        line_total: dish.price * 2,
        active: true,
        created_at: mobileRecordedAt
      }
      api.steps.push({
        commandId: 'food.cart.set',
        payload: { menuItemId: dish.id, quantity: 2 },
        result: cart,
        resources: { 'food-carts': [cart], 'food-cart-items': [line] }
      })
      await tapBusinessSubmit(page, 'Save dish quantity')
      await expect.poll(() => api.calls.length).toBe(1)
      await expect(successNotification(page)).toContainText(/processed|handled/iu)
      await page.clock.runFor(200)
      await page.screenshot({
        path: info.outputPath(`food-${target}-feedback.png`),
        animations: 'disabled'
      })
      await dismissSuccess(page, /processed|handled/iu)
      await tapBusinessReceipt(page)
      await mobileNavigation(page).selectOption({ label: 'My food cart' })
      await page.getByRole('button', { name: 'View details', exact: true }).tap()
      await page.getByRole('button', { name: 'Update dish quantity', exact: true }).tap()
      await expect(page.getByPlaceholder('Quantity', { exact: true })).toHaveValue('2')
      await expect(successNotification(page)).toHaveCount(0)
      expect(api.calls).toHaveLength(1)
    })
  })
}
