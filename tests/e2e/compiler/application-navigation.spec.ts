import { expect, test } from '@playwright/test'

import { withApplicationNavigation } from '#tests/helpers/compiler/application-navigation/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} binds concrete parameters and query changes through browser history`, async ({
    page
  }) => {
    await withApplicationNavigation(page, target, async () => {
      await expect(page).toHaveURL(/\/home$/)
      await page.getByRole('button', { name: 'Increment shared count', exact: true }).click()
      await page.getByRole('button', { name: 'Open products', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/42\?tab=details&filter=a%2Fb#reviews$/)
      await expect(page.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
      await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Open related product', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/73\?tab=related#specs$/)
      await expect(page.getByText('Product: 73 / tab: related', { exact: true })).toBeVisible()
      await page.goBack()
      await expect(page.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
      await page.goBack()
      await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
      await page.goForward()
      await expect(page.getByText('Product: 42 / tab: details', { exact: true })).toBeVisible()
      await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
    })
  })
}
