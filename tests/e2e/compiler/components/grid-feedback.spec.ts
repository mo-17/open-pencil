import { expect, test } from '@playwright/test'

import { withDataModules } from '#tests/helpers/compiler/modules/data-grid/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} grid keeps selection visible across pages and filters and clears it explicitly`, async ({
    page
  }) => {
    test.setTimeout(90000)
    await withDataModules(page, target, async () => {
      const grid = page.locator('[data-openpencil-data-grid]').first()
      const summary = grid.getByRole('status')
      await expect(summary).toHaveText('0 selected')
      await expect(grid.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(
        0
      )
      await grid.getByRole('checkbox', { name: 'Select row row-0', exact: true }).check()
      await grid.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(summary).toHaveText('1 selected · 1 not on this page')
      await grid.getByRole('checkbox', { name: 'Select all rows on this page' }).check()
      await expect(summary).toHaveText('3 selected · 1 not on this page')
      await grid.getByRole('searchbox', { name: 'Filter Name' }).fill('no match')
      await expect(summary).toHaveText('3 selected · 3 not on this page')
      await expect(grid.getByText('No matching rows', { exact: true })).toBeVisible()
      await expect(
        grid.getByRole('checkbox', { name: 'Select all rows on this page' })
      ).toBeDisabled()
      await expect(grid.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled()
      await expect(grid.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled()
      await grid.getByRole('button', { name: 'Clear column filters', exact: true }).click()
      await expect(grid.getByRole('searchbox', { name: 'Filter Name' })).toHaveValue('')
      await expect(grid.getByRole('navigation')).toContainText('Page 1 of 2 · 12 rows')
      await expect(summary).toHaveText('3 selected · 2 not on this page')
      await expect(
        grid.getByRole('checkbox', { name: 'Select row row-0', exact: true })
      ).toBeChecked()
      await grid.getByRole('button', { name: 'Clear selection', exact: true }).click()
      await expect(summary).toHaveText('0 selected')
      await expect(grid.getByRole('button', { name: 'Clear selection', exact: true })).toHaveCount(
        0
      )
      await grid.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(grid.locator('tbody input:checked')).toHaveCount(0)
      const single = page.locator('[data-openpencil-data-grid]').nth(1)
      await single.getByRole('radio', { name: 'Select row row-0', exact: true }).check()
      await expect(single.getByRole('status')).toHaveText('1 selected')
      await expect(summary).toHaveText('0 selected')
      await single.getByRole('button', { name: 'Clear selection', exact: true }).click()
      await expect(
        single.getByRole('radio', { name: 'Select row row-0', exact: true })
      ).not.toBeChecked()
    })
  })

  test(`${target} grid clears only user filters and explains the configured baseline in Chinese`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    await withDataModules(
      page,
      target,
      async () => {
        const grid = page.locator('[data-openpencil-data-grid]').first()
        await expect(grid.getByRole('navigation')).toContainText('共 10 行')
        await expect(
          grid.getByText('设计中配置的筛选条件仍然生效。', { exact: true })
        ).toBeVisible()
        await grid.getByRole('checkbox', { name: '选择行 row-0', exact: true }).check()
        await grid.getByRole('button', { name: 'Score', exact: true }).click()
        await grid.getByRole('searchbox', { name: '筛选 Name' }).fill('不存在')
        await expect(grid.getByRole('status')).toHaveText('已选择 1 行 · 1 行不在当前页')
        await grid.getByRole('button', { name: '清空列筛选', exact: true }).click()
        await expect(grid.getByRole('navigation')).toContainText('共 10 行')
        await expect(grid.getByRole('status')).toHaveText('已选择 1 行')
        await expect(
          grid.getByRole('columnheader', { name: 'Score', exact: true })
        ).toHaveAttribute('aria-sort', 'ascending')
        await expect(grid.getByRole('cell', { name: 'Item 10', exact: true })).toHaveCount(0)
        await expect(grid.getByRole('button', { name: '清空列筛选', exact: true })).toHaveCount(0)
        await page.screenshot({ path: info.outputPath(target + '-grid-feedback-zh.png') })
      },
      'zh-CN',
      false,
      true
    )
  })
}
