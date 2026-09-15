import { expect, test } from '@playwright/test'

import {
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} menu editing restores and submits the false availability choice`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withBusinessBrowser(page, 'food-ordering', target, async ({ api, open }) => {
      const dish = {
        id: '00000000-0000-4000-8000-000000000040',
        title: 'Noodle bowl',
        category: 'Lunch',
        description: 'Daily noodles',
        image_url: '',
        price: 2500,
        available: false,
        version: 0,
        created_at: '2026-09-15T00:00:00.000Z'
      }
      api.resources['food-menu-management'] = [dish]
      await open('food-menu-management')
      await page.getByRole('button', { name: 'Select record', exact: true }).click()
      await page.getByRole('button', { name: 'Edit menu item', exact: true }).click()
      const availability = page.getByRole('combobox').last()
      await expect(availability).toHaveValue('Unavailable / sold out')
      const form = page.locator('form')
      await availability.selectOption('')
      await expect(form.getByRole('button', { name: 'Edit menu item', exact: true })).toHaveCount(0)
      await availability.selectOption({ label: 'Unavailable / sold out' })
      await expect(form.getByRole('button', { name: 'Edit menu item', exact: true })).toBeVisible()
      api.steps.push({
        commandId: 'update-food-menu-item',
        payload: {
          menuItemId: dish.id,
          title: dish.title,
          category: dish.category,
          description: dish.description,
          imageUrl: '',
          price: 2500,
          available: false
        },
        result: { ...dish, version: 1 }
      })
      await submitBusinessAction(page, 'Edit menu item')
      await expect.poll(() => api.calls.length).toBe(1)
      expect(api.calls[0].payload).toMatchObject({ available: false })
      await finishBusinessRequest(page)
      await page.screenshot({ path: info.outputPath('food-menu-false.png') })
    })
  })
}
