import { expect, test } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  BUSINESS_BROWSER_USER_ID,
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

const id = (suffix: string) => '00000000-0000-4000-8000-' + suffix.padStart(12, '0')
const recordedAt = '2026-09-15T00:00:00.000Z'

for (const target of ['react', 'vue'] as const) {
  test(`${target} orders two dishes, changes cart lines, checks out dine-in and pickup, and handles the kitchen order`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    // Authentication and HTTP responses are scripted. The app, compiler, forms,
    // client validation, command payloads and response invalidation are real.
    // PostgreSQL tests separately verify ownership, pricing and atomicity.
    await withBusinessBrowser(page, 'food-ordering', target, async ({ api, open }) => {
      const menu = [
        {
          id: id('40'),
          title: 'Noodle bowl',
          category: 'Lunch',
          description: 'Daily noodles',
          image_url: '',
          price: 2500,
          available: true,
          version: 0,
          created_at: recordedAt
        },
        {
          id: id('41'),
          title: 'Rice bowl',
          category: 'Lunch',
          description: 'Steamed rice',
          image_url: '',
          price: 1800,
          available: true,
          version: 0,
          created_at: recordedAt
        }
      ]
      const cart = (version: number, subtotal: number, item_count: number) => ({
        id: id('50'),
        version,
        subtotal,
        item_count,
        created_at: recordedAt
      })
      const noodle = {
        id: id('51'),
        cart_id: id('50'),
        menu_item_id: menu[0].id,
        product_title: menu[0].title,
        quantity: 2,
        unit_price: 2500,
        line_total: 5000,
        active: true,
        created_at: recordedAt
      }
      const rice = {
        id: id('52'),
        cart_id: id('50'),
        menu_item_id: menu[1].id,
        product_title: menu[1].title,
        quantity: 3,
        unit_price: 1800,
        line_total: 5400,
        active: true,
        created_at: recordedAt
      }
      api.resources['food-menu'] = menu
      const choose = (index = 0) =>
        page.getByRole('button', { name: 'Select record', exact: true }).nth(index).click()
      const navigate = (label: string) =>
        page.getByRole('button', { name: label, exact: true }).click()
      const submit = async (
        label: string,
        commandId: string,
        payload: object,
        result: BusinessTestRow,
        resources: Record<string, BusinessTestRow[]> = {}
      ) => {
        const count = api.calls.length
        api.steps.push({ commandId, payload, result, resources })
        await submitBusinessAction(page, label)
        await expect.poll(() => api.calls.length).toBe(count + 1)
        await finishBusinessRequest(page)
      }
      const saveFromMenu = async (
        index: number,
        quantity: number,
        result: BusinessTestRow,
        items: BusinessTestRow[]
      ) => {
        await choose(index)
        await navigate('Save dish quantity')
        await page.getByPlaceholder('Quantity', { exact: true }).fill(String(quantity))
        await submit(
          'Save dish quantity',
          'food.cart.set',
          { menuItemId: menu[index].id, quantity },
          result,
          { 'food-carts': [result], 'food-cart-items': items }
        )
      }

      await open('food-menu')
      await expect(page.getByText('Dish: Noodle bowl', { exact: true })).toBeVisible()
      await expect(page.getByText('Dish: Rice bowl', { exact: true })).toBeVisible()
      await saveFromMenu(0, 2, cart(1, 5000, 1), [noodle])
      await saveFromMenu(1, 3, cart(2, 10400, 2), [noodle, rice])
      await navigate('My food cart')
      await expect(page.getByText('Line total (minor units): 5400', { exact: true })).toBeVisible()
      await choose()
      await navigate('Update dish quantity')
      await expect(page.getByPlaceholder('Quantity', { exact: true })).toHaveValue('2')
      await page.getByPlaceholder('Quantity', { exact: true }).fill('1')
      const singleNoodle = { ...noodle, quantity: 1, line_total: 2500 }
      await submit(
        'Update dish quantity',
        'food.cart.set',
        { menuItemId: menu[0].id, quantity: 1 },
        cart(3, 7900, 2),
        { 'food-carts': [cart(3, 7900, 2)], 'food-cart-items': [singleNoodle, rice] }
      )
      await choose(1)
      await navigate('Remove dish')
      await submit('Remove dish', 'food.cart.remove', { itemId: rice.id }, cart(4, 2500, 1), {
        'food-carts': [cart(4, 2500, 1)],
        'food-cart-items': [singleNoodle]
      })
      await expect(page.getByText('Dish: Rice bowl', { exact: true })).toHaveCount(0)
      await navigate('Order food')
      const singleRice = { ...rice, quantity: 1, line_total: 1800 }
      await saveFromMenu(1, 1, cart(5, 4300, 2), [singleNoodle, singleRice])

      await navigate('Confirm food order')
      await expect(page.getByText('Subtotal (minor units): 4300', { exact: true })).toBeVisible()
      await expect(page.getByText('Cart revision: 5', { exact: true })).toBeVisible()
      await choose()
      await expect(page.getByText('Dish: Noodle bowl', { exact: true })).toBeVisible()
      await expect(page.getByText('Dish: Rice bowl', { exact: true })).toBeVisible()
      await expect(page.getByText(/No payment is collected/u)).toBeVisible()
      await navigate('Submit dine-in order')
      await page.getByPlaceholder('Table number', { exact: true }).fill('A12')
      await page.getByPlaceholder('Contact name', { exact: true }).fill('Alice')
      await page.getByPlaceholder('Explanation / note', { exact: true }).fill('No chilli')
      let order = {
        id: id('60'),
        status: 'pending',
        fulfillment: 'dine_in',
        table_number: 'A12',
        contact_name: 'Alice',
        phone: '',
        note: 'No chilli',
        total: 4300,
        currency: 'CNY',
        version: 0,
        created_at: recordedAt
      }
      const orderItems = [singleNoodle, singleRice].map((line, index) => ({
        id: id('7' + index),
        order_id: order.id,
        menu_item_id: line.menu_item_id,
        product_title: line.product_title,
        quantity: 1,
        unit_price: line.unit_price,
        line_total: line.line_total,
        created_at: recordedAt
      }))
      const history = [
        {
          id: id('80'),
          order_id: order.id,
          actor_subject: BUSINESS_BROWSER_USER_ID,
          action: 'checkout.dine-in',
          note: 'No chilli',
          before_status: 'pending',
          after_status: 'pending',
          created_at: recordedAt
        }
      ]
      await submit(
        'Submit dine-in order',
        'food.checkout.dine-in',
        { cartRevision: 5, tableNumber: 'A12', contactName: 'Alice', phone: '', note: 'No chilli' },
        order,
        {
          'food-carts': [cart(6, 0, 0)],
          'food-cart-items': [],
          'food-orders': [order],
          'food-order-items': orderItems,
          'food-order-history': history,
          'food-kitchen-orders': [order],
          'food-kitchen-items': orderItems,
          'food-kitchen-history': history
        }
      )
      await navigate('My food orders')
      await choose()
      await expect(page.getByText('Dining method: dine_in', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('Table number: A12', { exact: true })).toBeVisible()
      await expect(page.getByText('Dish: Rice bowl', { exact: true })).toBeVisible()
      await expect(page.getByText('Action: checkout.dine-in', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('food-dine-in-order.png'), fullPage: true })
      await navigate('My food cart')
      await expect(page.getByRole('button', { name: 'Select record', exact: true })).toHaveCount(0)

      await navigate('Kitchen orders')
      await expect(page.getByText(/not a realtime feed/u)).toBeVisible()
      for (const [label, operation, status] of [
        ['Accept order', 'accept', 'accepted'],
        ['Start preparation', 'prepare', 'preparing'],
        ['Mark ready', 'ready', 'ready'],
        ['Complete order', 'complete', 'completed']
      ]) {
        await choose()
        await expect(page.getByText('Dish: Noodle bowl', { exact: true })).toBeVisible()
        await navigate(label)
        await page.getByPlaceholder('Explanation / note', { exact: true }).fill('Kitchen ' + status)
        const next = { ...order, status, version: order.version + 1 }
        history.push({
          ...history[0],
          id: id('8' + next.version),
          action: 'order.' + operation,
          note: 'Kitchen ' + status,
          before_status: order.status,
          after_status: status
        })
        await submit(
          label,
          'food.order.' + operation,
          { orderId: order.id, note: 'Kitchen ' + status },
          next,
          {
            'food-orders': [next],
            'food-kitchen-orders': [next],
            'food-order-history': [...history],
            'food-kitchen-history': [...history]
          }
        )
        order = next
        await expect(page.getByText('Status: ' + status, { exact: true }).first()).toBeVisible()
      }
      await choose()
      await expect(page.getByText('Action: order.ready', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('food-kitchen-completed.png'), fullPage: true })

      await navigate('Order food')
      await saveFromMenu(0, 1, cart(7, 2500, 1), [singleNoodle])
      await navigate('Confirm food order')
      await choose()
      await navigate('Submit pickup order')
      await expect(page.getByPlaceholder('Table number', { exact: true })).toHaveCount(0)
      await page.getByPlaceholder('Contact name', { exact: true }).fill('Alice pickup')
      await page.getByPlaceholder('Phone (optional)', { exact: true }).fill('10000000000')
      const pickup = {
        ...order,
        id: id('61'),
        status: 'pending',
        fulfillment: 'pickup',
        table_number: '',
        contact_name: 'Alice pickup',
        phone: '10000000000',
        note: '',
        total: 2500,
        version: 0
      }
      await submit(
        'Submit pickup order',
        'food.checkout.pickup',
        { cartRevision: 7, contactName: 'Alice pickup', phone: '10000000000', note: '' },
        pickup,
        { 'food-orders': [order, pickup], 'food-carts': [cart(8, 0, 0)], 'food-cart-items': [] }
      )
      await navigate('My food orders')
      await choose(1)
      await expect(page.getByText('Contact name: Alice pickup', { exact: true })).toBeVisible()
      await expect(page.getByText('Dining method: pickup', { exact: true }).first()).toBeVisible()
      await page.screenshot({ path: info.outputPath('food-pickup-order.png'), fullPage: true })
      expect(api.calls).toHaveLength(12)
      expect(new Set(api.calls.map((call) => call.key)).size).toBe(12)
      expect(api.reads).toEqual(
        expect.arrayContaining([
          'food-order-items',
          'food-order-history',
          'food-kitchen-items',
          'food-kitchen-history'
        ])
      )
    })
  })
}
