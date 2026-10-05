import { expect, test } from '@playwright/test'

import { withApplicationMode } from '#tests/helpers/compiler/application-mode/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} starts on the selected page, scopes entries and keeps shared state across navigation`, async ({
    page
  }) => {
    await withApplicationMode(page, target, async () => {
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
      await expect(page.getByText('REFERENCE ONLY', { exact: true })).toHaveCount(0)
      await expect(page.getByText('OUTSIDE ENTRY', { exact: true })).toHaveCount(0)
      const root = page.locator('[data-node-id]').first()
      const box = await root.boundingBox()
      expect(box?.x).toBeCloseTo(0, 0)
      expect(box?.y).toBeCloseTo(0, 0)
      await page.getByRole('button', { name: 'Increment shared count', exact: true }).click()
      await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Open products', exact: true }).click()
      await expect(page).toHaveURL(/\/products$/)
      await expect(page.getByText('Products screen', { exact: true })).toBeVisible()
      await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Return home', exact: true }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
    })
  })
}
