import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import {
  exerciseReducedViewport,
  expectActionNotClipped,
  expectNoHorizontalOverflow,
  mobileBrowserOptions,
  mobileNavigation,
  tapBusinessReceipt,
  tapBusinessSubmit
} from '#tests/helpers/compiler/mobile/layout'
import { mobileDishes, mobileId, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'

test.use(mobileBrowserOptions)

for (const target of ['react', 'vue'] as const) {
  test(`${target} mobile restaurant edits its cart and submits the reviewed revision by touch`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withBusinessBrowser(page, 'food-ordering', target, async ({ api, open }) => {
      const dish = mobileDishes[0]
      const cart = (version: number, subtotal: number, item_count = 1) => ({
        id: mobileId(50),
        version,
        subtotal,
        item_count,
        created_at: mobileRecordedAt
      })
      const line = {
        id: mobileId(51),
        cart_id: mobileId(50),
        menu_item_id: dish.id,
        product_title: dish.title,
        quantity: 2,
        unit_price: dish.price,
        line_total: dish.price * 2,
        active: true,
        created_at: mobileRecordedAt
      }
      api.resources['food-menu'] = [dish]
      await open('food-menu')
      const dishSelection = page.getByRole('button', { name: 'View details', exact: true })
      await expectActionNotClipped(dishSelection)
      await dishSelection.tap()
      await page.getByRole('button', { name: 'Save dish quantity', exact: true }).tap()
      await page.getByPlaceholder('Quantity', { exact: true }).fill('2')
      api.steps.push({
        commandId: 'food.cart.set',
        payload: { menuItemId: dish.id, quantity: 2 },
        result: cart(1, 6400),
        resources: { 'food-carts': [cart(1, 6400)], 'food-cart-items': [line] }
      })
      await tapBusinessSubmit(page, 'Save dish quantity')
      await expect.poll(() => api.calls.length).toBe(1)
      await tapBusinessReceipt(page)
      await mobileNavigation(page).selectOption({ label: 'My food cart' })
      await page.getByRole('button', { name: 'View details', exact: true }).tap()
      await page.getByRole('button', { name: 'Update dish quantity', exact: true }).tap()
      await expect(page.getByPlaceholder('Quantity', { exact: true })).toHaveValue('2')
      await page.getByPlaceholder('Quantity', { exact: true }).fill('1')
      const singleLine = { ...line, quantity: 1, line_total: dish.price }
      api.steps.push({
        commandId: 'food.cart.set',
        payload: { menuItemId: dish.id, quantity: 1 },
        result: cart(2, 3200),
        resources: { 'food-carts': [cart(2, 3200)], 'food-cart-items': [singleLine] }
      })
      await tapBusinessSubmit(page, 'Update dish quantity')
      await expect.poll(() => api.calls.length).toBe(2)
      await tapBusinessReceipt(page)
      await mobileNavigation(page).selectOption({ label: 'Confirm food order' })
      await expect(page.getByText('Cart revision: 2', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'View details', exact: true }).tap()
      await page.getByRole('button', { name: 'Submit dine-in order', exact: true }).tap()
      await page.getByPlaceholder('Table number', { exact: true }).fill('A12')
      await page.getByPlaceholder('Contact name', { exact: true }).fill('Alice')
      await exerciseReducedViewport(
        page,
        page.getByPlaceholder('Explanation / note', { exact: true }),
        'No chilli',
        page.getByRole('button', { name: 'Submit dine-in order', exact: true }).last()
      )
      const order = {
        id: mobileId(60),
        status: 'pending',
        fulfillment: 'dine_in',
        table_number: 'A12',
        contact_name: 'Alice',
        phone: '',
        note: 'No chilli',
        total: dish.price,
        currency: 'CNY',
        version: 0,
        created_at: mobileRecordedAt
      }
      api.steps.push({
        commandId: 'food.checkout.dine-in',
        payload: {
          cartRevision: 2,
          tableNumber: 'A12',
          contactName: 'Alice',
          phone: '',
          note: 'No chilli'
        },
        result: order,
        resources: {
          'food-carts': [cart(3, 0, 0)],
          'food-cart-items': [],
          'food-orders': [order],
          'food-order-items': [{ ...singleLine, order_id: order.id }]
        }
      })
      await tapBusinessSubmit(page, 'Submit dine-in order')
      await expect.poll(() => api.calls.length).toBe(3)
      await tapBusinessReceipt(page)
      await mobileNavigation(page).selectOption({ label: 'My food orders' })
      await page.getByRole('button', { name: 'View details', exact: true }).tap()
      await expect(page.getByText('Dining method: Dine-in', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Table number: A12', { exact: true })).toBeVisible()
      expect(new Set(api.calls.map((call) => call.key)).size).toBe(3)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`food-ordering-${target}-mobile-flow.png`) })
    })
  })
}
