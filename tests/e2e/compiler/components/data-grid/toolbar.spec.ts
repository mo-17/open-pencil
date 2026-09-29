import { expect, test } from '@playwright/test'

import { withDataModules } from '#tests/helpers/compiler/modules/data-grid/browser'

test.use({ viewport: { width: 2040, height: 1000 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} compact data grid keeps rows reachable and restores sticky headers after resize`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await withDataModules(
      page,
      target,
      async () => {
        const grid = page.locator('[data-openpencil-data-grid]')
        const header = grid.locator('thead')
        const compact = page.getByRole('checkbox', { name: 'Compact grid', exact: true })
        const filter = grid.getByRole('searchbox', { name: 'Filter Name', exact: true })
        const firstRow = grid.getByRole('checkbox', { name: 'Select row row-0', exact: true })
        await expect(grid).toHaveCSS('width', '284px')
        await expect(grid).toHaveCSS('height', '240px')
        await filter.fill('Item 0')
        await expect(header).toHaveCSS('position', 'static')
        await firstRow.check()
        await expect(firstRow).toBeChecked()
        await grid.getByRole('button', { name: 'Clear selection', exact: true }).click()
        await expect(firstRow).not.toBeChecked()
        await expect(
          grid.getByRole('checkbox', { name: 'Select all rows on this page', exact: true })
        ).toBeFocused()
        await grid.getByRole('button', { name: 'Clear column filters', exact: true }).click()
        await expect(filter).toHaveValue('')
        await expect(filter).toBeFocused()

        await compact.uncheck()
        await expect(grid).toHaveCSS('width', '620px')
        await expect(header).toHaveCSS('position', 'sticky')
        const scrollArea = grid.locator('[data-openpencil-data-grid-scroll]')
        await scrollArea.evaluate((element) => {
          element.scrollTop = 80
        })
        await expect
          .poll(() => scrollArea.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0)
        const headerBounds = await header.boundingBox()
        const scrollBounds = await scrollArea.boundingBox()
        expect(headerBounds).not.toBeNull()
        expect(scrollBounds).not.toBeNull()
        if (!headerBounds || !scrollBounds) throw new Error('Data grid layout is missing')
        expect(Math.abs(headerBounds.y - scrollBounds.y)).toBeLessThan(2)

        await compact.check()
        await expect(grid).toHaveCSS('width', '284px')
        await filter.fill('Item 0')
        await expect(header).toHaveCSS('position', 'static')
        await firstRow.check()
        await expect(firstRow).toBeChecked()
        await page.screenshot({ path: test.info().outputPath(target + '-data-grid-compact.png') })
      },
      'en',
      false,
      false,
      { compactLayout: true }
    )
  })

  test(`${target} default data grid keeps CSV tools hidden and reveals only actionable clear controls`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await withDataModules(page, target, async () => {
      const grid = page.locator('[data-openpencil-data-grid]').first()
      const csvButton = grid.getByRole('button', { name: 'Paste CSV (local session)' })
      const prepare = grid.getByRole('button', { name: 'Prepare CSV text' })
      const clearSelection = grid.getByRole('button', { name: 'Clear selection', exact: true })
      const clearFilters = grid.getByRole('button', { name: 'Clear column filters', exact: true })
      const summary = grid.getByRole('status')
      await expect(grid.getByRole('cell', { name: 'Item 0', exact: true })).toBeVisible()
      await expect(csvButton).toHaveCount(0)
      await expect(prepare).toHaveCount(0)
      await expect(grid.getByRole('textbox', { name: 'CSV import text', exact: true })).toHaveCount(
        0
      )
      await expect(clearSelection).toHaveCount(0)
      await expect(clearFilters).toHaveCount(0)
      await expect(summary).toHaveText('0 selected')
      await expect(summary).toHaveAttribute('aria-live', 'polite')
      await page.screenshot({ path: test.info().outputPath(target + '-data-grid-default.png') })

      await grid.getByRole('button', { name: 'Next page', exact: true }).click()
      await expect(grid.getByRole('cell', { name: 'Item 11', exact: true })).toBeVisible()
      await grid.getByRole('button', { name: 'Score', exact: true }).click()
      await expect(grid.locator('tbody tr').first()).toContainText('Item 11')
      await expect(grid.getByRole('navigation')).toContainText('Page 1 of 2')
      const selected = grid.getByRole('checkbox', { name: 'Select row row-11', exact: true })
      await selected.check()
      await expect(clearSelection).toBeVisible()
      await expect(clearSelection).toBeEnabled()
      await clearSelection.click()
      await expect(selected).not.toBeChecked()
      await expect(clearSelection).toHaveCount(0)
      await expect(
        grid.getByRole('checkbox', { name: 'Select all rows on this page', exact: true })
      ).toBeFocused()

      const search = grid.getByRole('searchbox', { name: 'Filter Name' })
      await search.fill('Item 11')
      await expect(grid.getByRole('navigation')).toContainText('1 rows')
      await expect(clearFilters).toBeVisible()
      await clearFilters.click()
      await expect(search).toHaveValue('')
      await expect(search).toBeFocused()
      await expect(clearFilters).toHaveCount(0)
      await expect(grid.getByRole('navigation')).toContainText('12 rows')
      await expect(csvButton).toHaveCount(0)
    })
  })

  test(`${target} CSV tools are an opt-in that preserves imported rows when hidden and re-enabled`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await withDataModules(
      page,
      target,
      async () => {
        const grid = page.locator('[data-openpencil-data-grid]')
        const toggle = page.getByRole('checkbox', { name: 'Show CSV tools', exact: true })
        const paste = grid.getByRole('button', { name: 'Paste CSV (local session)' })
        const prepare = grid.getByRole('button', { name: 'Prepare CSV text' })
        const tools = grid.getByRole('region', { name: 'Data grid CSV tools', exact: true })
        const csv = 'Name,Status,Score\nLocal CSV,Ready,10\nOther CSV,Draft,3'
        await expect(grid.getByRole('cell', { name: 'Landing page', exact: true })).toBeVisible()
        await expect(toggle).not.toBeChecked()
        await expect(paste).toHaveCount(0)
        await expect(prepare).toHaveCount(0)
        await expect(tools).toHaveCount(0)

        await toggle.check()
        await paste.click()
        const source = grid.getByRole('textbox', { name: 'CSV import text', exact: true })
        await source.fill(csv)
        await grid.getByRole('button', { name: 'Import pasted CSV' }).click()
        await expect(grid.getByRole('cell', { name: 'Local CSV', exact: true })).toBeVisible()
        await expect(grid.getByRole('navigation')).toContainText('2 rows')
        await prepare.click()
        const output = grid.getByRole('textbox', { name: 'Prepared CSV text' })
        await expect(output).toHaveValue(csv + '\n')

        await grid.getByRole('checkbox', { name: 'Select row csv_row_1', exact: true }).check()
        await toggle.uncheck()
        await expect(paste).toHaveCount(0)
        await expect(prepare).toHaveCount(0)
        await expect(source).toHaveCount(0)
        await expect(output).toHaveCount(0)
        await expect(tools).toHaveCount(0)
        await expect(grid.getByRole('cell', { name: 'Local CSV', exact: true })).toBeVisible()
        await expect(
          grid.getByRole('checkbox', { name: 'Select row csv_row_1', exact: true })
        ).toBeChecked()

        await toggle.check()
        await expect(tools).toBeVisible()
        await expect(prepare).toBeVisible()
        await expect(grid.getByRole('cell', { name: 'Local CSV', exact: true })).toBeVisible()
        await expect(grid.getByRole('cell', { name: 'Landing page', exact: true })).toHaveCount(0)
        await prepare.click()
        await expect(output).toHaveValue(csv + '\n')
      },
      'en',
      false,
      false,
      { toolbarLifecycle: true }
    )
  })
}
