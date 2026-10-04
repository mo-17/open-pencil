import { expect, test } from '@playwright/test'

import { withDataGridRows } from '#tests/helpers/compiler/modules/data-grid/rows-browser'

for (const target of ['react', 'vue'] as const) {
  for (const document of [false, true]) {
    test(`${target} ${document ? 'document' : 'page'} data grid rows stay controlled across equal, changed, empty and invalid values`, async ({
      page
    }) => {
      test.setTimeout(90_000)
      await withDataGridRows(page, target, document, async () => {
        const grid = page.locator('[data-openpencil-data-grid]')
        const filter = grid.getByRole('searchbox', { name: 'Filter Name', exact: true })
        const selected = grid.getByRole('checkbox', { name: 'Select row row0', exact: true })
        const prepare = grid.getByRole('button', { name: 'Prepare CSV text', exact: true })
        await expect(grid.getByRole('cell', { name: 'Item 0', exact: true })).toBeVisible()
        await expect(grid.getByRole('cell', { name: 'Authored example', exact: true })).toHaveCount(
          0
        )
        await expect(grid.getByRole('navigation')).toContainText('Page 1 of 2 · 12 rows')
        await expect(
          grid.getByRole('button', { name: 'Paste CSV (local session)', exact: true })
        ).toBeDisabled()
        await selected.check()
        await filter.fill('Item 0')
        await grid.getByRole('button', { name: 'Score', exact: true }).click()
        await page.getByRole('button', { name: 'Equal rows', exact: true }).click()
        await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
        await expect(page.getByText('Host revision: 1', { exact: true })).toBeVisible()
        await expect(filter).toHaveValue('Item 0')
        await expect(selected).toBeChecked()
        await expect(
          grid.getByRole('columnheader', { name: 'Score', exact: true })
        ).toHaveAttribute('aria-sort', 'ascending')
        await prepare.click()
        const csv = grid.getByRole('textbox', { name: 'Prepared CSV text', exact: true })
        await expect(csv).toHaveValue('Name,Score\nItem 0,12\n')

        await page.getByRole('button', { name: 'Replace rows', exact: true }).click()
        await expect(grid.getByRole('cell', { name: 'Replacement', exact: true })).toBeVisible()
        await expect(filter).toHaveValue('')
        await expect(grid.getByRole('status')).toHaveText('0 selected')
        await expect(
          grid.getByRole('columnheader', { name: 'Score', exact: true })
        ).toHaveAttribute('aria-sort', 'none')
        await expect(grid.getByRole('navigation')).toContainText('Page 1 of 1 · 1 rows')
        await expect(csv).toHaveCount(0)
        await page.getByRole('button', { name: 'Empty rows', exact: true }).click()
        await expect(grid.getByText('No matching rows', { exact: true })).toBeVisible()
        await expect(grid.getByRole('alert')).toHaveCount(0)
        await expect(prepare).toBeEnabled()
        await page.getByRole('button', { name: 'Invalid rows', exact: true }).click()
        await expect(grid.getByRole('alert')).toHaveText('Bound data grid rows are unavailable.')
        await expect(prepare).toBeDisabled()
        await expect(grid.getByRole('cell', { name: 'Authored example', exact: true })).toHaveCount(
          0
        )
        await page.getByRole('button', { name: 'Restore rows', exact: true }).click()
        await expect(grid.getByRole('alert')).toHaveCount(0)
        await expect(grid.getByRole('cell', { name: 'Item 0', exact: true })).toBeVisible()
        await expect(grid.getByRole('navigation')).toContainText('Page 1 of 2 · 12 rows')
        await page.screenshot({
          path: test
            .info()
            .outputPath(`${target}-${document ? 'document' : 'page'}-data-grid-rows.png`)
        })
      })
    })
  }
}
