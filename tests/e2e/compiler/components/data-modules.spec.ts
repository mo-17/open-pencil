import { expect, test } from '@playwright/test'

import { withDataModules } from '#tests/helpers/compiler/modules/data-grid/browser'

test.use({ viewport: { width: 2040, height: 900 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} data modules render plain text and support local sort, filter, pagination and independent selection`, async ({
    page
  }) => {
    test.setTimeout(90000)
    await withDataModules(page, target, async () => {
      const table = page.locator('[data-openpencil-table]')
      await expect(table.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
      await expect(table.locator('img')).toHaveCount(0)
      await expect(table.getByRole('cell', { name: '中文内容' })).toBeVisible()
      const grids = page.locator('[data-openpencil-data-grid]')
      await expect(grids).toHaveCount(3)
      const grid = grids.nth(0)
      const pagination = grid.getByRole('navigation', { name: 'Data grid pagination' })
      await expect(pagination).toContainText('Page 1 of 2 · 12 rows')
      await grid.getByRole('button', { name: 'Next page' }).click()
      await expect(grid.getByRole('cell', { name: 'Item 11', exact: true })).toBeVisible()
      await grid.getByRole('button', { name: 'Score', exact: true }).click()
      await expect(pagination).toContainText('Page 1 of 2')
      await expect(grid.locator('tbody tr').first()).toContainText('Item 11')
      await grid.getByRole('button', { name: 'Score', exact: true }).click()
      await expect(grid.locator('tbody tr').first()).toContainText('Item 0')
      await grid.getByRole('searchbox', { name: 'Filter Name' }).fill('Item 1')
      await expect(pagination).toContainText('3 rows')
      const first = grid.getByRole('checkbox', { name: 'Select row row-1', exact: true })
      await first.check()
      const all = grid.getByRole('checkbox', { name: 'Select all rows on this page' })
      await expect(all).toHaveAttribute('aria-checked', 'mixed')
      expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true)
      await all.check()
      await expect(grid.locator('tbody input:checked')).toHaveCount(3)
      await grid.getByRole('searchbox', { name: 'Filter Name' }).fill('no results')
      await expect(grid.getByText('No matching rows')).toBeVisible()
      const hidden = grids.nth(1)
      await expect(hidden.getByRole('columnheader', { name: 'Name' })).toHaveCount(1)
      await expect(hidden.getByRole('searchbox')).toHaveCount(0)
      const a = hidden.getByRole('radio', { name: 'Select row row-0', exact: true })
      const b = grids.nth(2).getByRole('radio', { name: 'Select row row-0', exact: true })
      await a.check()
      await b.check()
      await expect(a).toBeChecked()
      await expect(b).toBeChecked()
      expect(await a.getAttribute('name')).not.toBe(await b.getAttribute('name'))
    })
  })

  test(`${target} local CSV rejects malformed input, protects formulas and resets on reload`, async ({
    page
  }) => {
    test.setTimeout(90000)
    await withDataModules(
      page,
      target,
      async () => {
        const grid = page.locator('[data-openpencil-data-grid]').first()
        await grid.getByRole('button', { name: 'Paste CSV (local session)' }).click()
        const source = grid.getByRole('textbox', { name: 'CSV import text', exact: true })
        await source.fill('Name,Score\n"Broken,1')
        await grid.getByRole('button', { name: 'Import pasted CSV' }).click()
        await expect(grid.getByRole('alert')).toContainText('unterminated quoted field')
        await expect(grid.getByRole('navigation')).toContainText('12 rows')
        await source.fill('\uFEFFName,Score\n=SUM(A1:A2),10\nGamma,3')
        await grid.getByRole('button', { name: 'Import pasted CSV' }).click()
        await expect(grid.getByRole('cell', { name: '=SUM(A1:A2)', exact: true })).toBeVisible()
        await grid.getByRole('button', { name: 'Prepare CSV text' }).click()
        await expect(grid.getByRole('textbox', { name: 'Prepared CSV text' })).toHaveValue(
          "Name,Score\n'=SUM(A1:A2),10\nGamma,3\n"
        )
        await expect(
          grid.getByText('1 formula-like text fields were neutralized.', { exact: false })
        ).toBeVisible()
        await page.reload()
        await expect(grid.getByRole('cell', { name: 'Item 0', exact: true })).toBeVisible()
        await expect(grid.getByText('=SUM(A1:A2)', { exact: true })).toHaveCount(0)
      },
      'en',
      false,
      false,
      { showCsvTools: true }
    )
  })
}

test('Vue generated data grid uses the document language for actionable feedback', async ({
  page
}, info) => {
  test.setTimeout(90000)
  await withDataModules(
    page,
    'vue',
    async () => {
      const grid = page.locator('[data-openpencil-data-grid]').first()
      await expect(grid.getByRole('button', { name: '下一页' })).toBeVisible()
      await grid.getByRole('searchbox', { name: '筛选 Name' }).fill('无结果')
      await expect(grid.getByText('没有匹配的数据')).toBeVisible()
      await grid.getByRole('button', { name: '粘贴 CSV（仅本次运行）' }).click()
      await grid
        .getByRole('textbox', { name: 'CSV 导入文本', exact: true })
        .fill('Name,Score\nBad,NaN')
      await grid.getByRole('button', { name: '导入粘贴的 CSV' }).click()
      await expect(grid.getByRole('alert')).toContainText('修改内容后重试')
      await page.screenshot({ path: info.outputPath('vue-data-grid-zh.png') })
    },
    'zh-CN',
    false,
    false,
    { showCsvTools: true }
  )
})

test('Vue data grid preserves local work on equal props and resets changed data and remounts', async ({
  page
}) => {
  test.setTimeout(90000)
  await withDataModules(
    page,
    'vue',
    async () => {
      const grid = page.locator('[data-openpencil-data-grid]')
      await grid.getByRole('button', { name: 'Paste CSV (local session)' }).click()
      await grid
        .getByRole('textbox', { name: 'CSV import text', exact: true })
        .fill('Name,Score\nLocal,10\nOther,3')
      await grid.getByRole('button', { name: 'Import pasted CSV' }).click()
      await grid.getByRole('searchbox', { name: 'Filter Name' }).fill('Local')
      await grid.getByRole('button', { name: 'Score', exact: true }).click()
      await grid.getByRole('checkbox', { name: 'Select row csv_row_1', exact: true }).check()
      await page.getByRole('button', { name: 'Rerender host' }).click()
      await expect(page.getByLabel('Host revision')).toHaveText('1')
      await expect(grid.getByRole('cell', { name: 'Local', exact: true })).toBeVisible()
      await expect(
        grid.getByRole('checkbox', { name: 'Select row csv_row_1', exact: true })
      ).toBeChecked()
      await expect(grid.getByRole('searchbox', { name: 'Filter Name' })).toHaveValue('Local')
      await expect(grid.getByRole('columnheader', { name: 'Score' })).toHaveAttribute(
        'aria-sort',
        'ascending'
      )
      await page.getByRole('button', { name: 'Replace source data' }).click()
      await expect(grid.getByRole('cell', { name: 'Replacement', exact: true })).toBeVisible()
      await expect(grid.getByRole('searchbox', { name: 'Filter Name' })).toHaveValue('')
      await expect(grid.getByRole('textbox', { name: 'CSV import text', exact: true })).toHaveValue(
        ''
      )
      await expect(grid.locator('tbody input:checked')).toHaveCount(0)
      await expect(grid.getByRole('columnheader', { name: 'Score' })).toHaveAttribute(
        'aria-sort',
        'none'
      )
      await grid.getByRole('searchbox', { name: 'Filter Name' }).fill('no match')
      await page.getByRole('button', { name: 'Toggle grid' }).click()
      await expect(grid).toHaveCount(0)
      await page.getByRole('button', { name: 'Toggle grid' }).click()
      await expect(grid.getByRole('cell', { name: 'Replacement', exact: true })).toBeVisible()
      await expect(grid.getByRole('searchbox', { name: 'Filter Name' })).toHaveValue('')
    },
    'en',
    true,
    false,
    { showCsvTools: true }
  )
})
