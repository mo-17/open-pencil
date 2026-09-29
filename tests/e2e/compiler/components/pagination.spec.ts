import { expect, test } from '@playwright/test'

import { withPagination } from '#tests/helpers/compiler/components/pagination/browser'

test.use({ viewport: { width: 375, height: 1000 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Pagination updates page and document states, responds to size and total without hidden writes`, async ({
    page
  }) => {
    await withPagination(page, target, false, async () => {
      const main = page.getByRole('navigation', { name: 'Results pages', exact: true }),
        doc = page.getByRole('navigation', { name: 'Document pages', exact: true })
      await main.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(
        page.getByText('Page[2] Doc[2] Total[95] Size[10]', { exact: true })
      ).toBeVisible()
      await doc.getByRole('button', { name: 'Next page', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(
        page.getByText('Page[2] Doc[3] Total[95] Size[10]', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Big page', exact: true }).click()
      await page.getByRole('button', { name: 'Shrink', exact: true }).click()
      await expect(main).toHaveAttribute('data-clamped', 'true')
      await expect(main.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
      await expect(
        page.getByText('Page[10] Doc[3] Total[5] Size[10]', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Restore', exact: true }).click()
      await expect(main).toHaveAttribute('data-clamped', 'false')
      await page.getByRole('button', { name: 'Size 20', exact: true }).click()
      await expect(main).toHaveAttribute('data-clamped', 'true')
      await main.getByRole('button', { name: 'Previous page', exact: true }).click()
      await expect(
        page.getByText('Page[4] Doc[3] Total[95] Size[20]', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Empty', exact: true }).click()
      await expect(main.getByRole('status')).toHaveText('No items')
      await expect(main.locator('[data-pagination-summary]')).toHaveText('0 / 0')
      await page.getByRole('button', { name: 'Bad total', exact: true }).click()
      await expect(main).toHaveAttribute('data-invalid', 'true')
      await expect(main.getByRole('status')).toContainText('unavailable')
      await page.getByRole('button', { name: 'Restore', exact: true }).click()
      await page.getByRole('button', { name: 'Bad page', exact: true }).click()
      await expect(main).toHaveAttribute('data-invalid', 'true')
      await expect(doc).toHaveAttribute('data-invalid', 'false')
      expect(await page.locator('body').evaluate((e) => e.scrollWidth <= 375)).toBe(true)
    })
  })
  test(`${target} Pagination isolates instances, disables actions, cleans up unmount and localizes`, async ({
    page
  }) => {
    await withPagination(page, target, true, async () => {
      const main = page.getByRole('navigation', { name: 'Live pages', exact: true }),
        other = page.getByRole('navigation', { name: 'Independent pages', exact: true }),
        output = page.locator('output')
      await main.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(output).toHaveText('Page[3] Changes[1]')
      await expect(other.getByRole('status')).toHaveText('Page 1 of 100')
      await expect(other.locator('[data-pagination-summary]')).toHaveText('1 / 100')
      await expect(other.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled()
      await page.getByRole('button', { name: 'Disable', exact: true }).click()
      for (const button of await main.getByRole('button').all()) await expect(button).toBeDisabled()
      await expect(output).toHaveText('Page[3] Changes[1]')
      await page.getByRole('button', { name: 'Disable', exact: true }).click()
      const stale = await main
        .getByRole('button', { name: 'Next page', exact: true })
        .elementHandle()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await stale.evaluate((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })))
      await expect(output).toHaveText('Page[3] Changes[1]')
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(main.getByRole('status')).toHaveText('Page 3 of 100')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(main.getByRole('button', { name: '下一页', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Huge total', exact: true }).click()
      await page.getByRole('button', { name: 'Last page', exact: true }).last().click()
      await page.getByRole('button', { name: 'Narrow', exact: true }).click()
      await expect(main).toHaveAttribute('data-pagination-mode', 'summary')
      expect(await main.getByRole('button').count()).toBeLessThanOrEqual(4)
      await expect.poll(() => main.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
      await expect
        .poll(() =>
          main
            .locator('[data-pagination-summary]')
            .evaluate((e) => e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight)
        )
        .toBe(true)
      await page.getByRole('button', { name: 'Invalid total', exact: true }).click()
      await expect(main).toHaveAttribute('data-invalid', 'true')
      await expect(main.getByRole('status')).toContainText('不可用')
      await page.getByRole('button', { name: 'Huge total', exact: true }).click()
      await page.getByRole('button', { name: 'Missing page', exact: true }).click()
      await expect(main).toHaveAttribute('data-invalid', 'true')
      await expect(output).toHaveText('Page[undefined] Changes[1]')
    })
  })
}
