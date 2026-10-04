import { expect, test, type Locator } from '@playwright/test'

import { withChartData } from '#tests/helpers/compiler/modules/chart/data/browser'

function cells(host: Locator) {
  return host.locator('[data-chart-table]').getByRole('cell')
}
function marks(host: Locator) {
  return host.locator('[data-chart-bar],[data-chart-path],[data-chart-circle]')
}

test.use({ viewport: { width: 375, height: 700 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} controlled charts update all geometry and preserve local authored instances`, async ({
    page
  }, info) => {
    await withChartData(page, target, async () => {
      const hosts = page.locator('[data-openpencil-chart]')
      await expect(hosts).toHaveCount(9)
      const before = []
      for (let index = 0; index < 5; index++) {
        const host = hosts.nth(index)
        await expect(cells(host)).toHaveText(['15', '45'])
        await expect(host.getByRole('rowheader')).toHaveText(['绑定甲', '绑定乙'])
        await expect(host).toHaveAttribute('data-chart-invalid', 'false')
        before.push(await host.locator('[data-chart-svg]').innerHTML())
      }
      await expect(cells(hosts.nth(5))).toHaveText(['24'])
      await expect(cells(hosts.nth(6))).toHaveText(['15', '45'])
      await expect(cells(hosts.nth(7))).toHaveText(['15', '45'])
      await expect(cells(hosts.last())).toHaveText(['99'])
      await page.getByRole('button', { name: 'Replace data', exact: true }).click()
      for (let index = 0; index < 5; index++) {
        const host = hosts.nth(index)
        await expect(cells(host)).toHaveText(['30', '10', '60'])
        await expect(host.getByRole('rowheader')).toHaveText(['新收入', '<b>支出</b>', '净额'])
        await expect(host.locator('b')).toHaveCount(0)
        expect(await host.locator('[data-chart-svg]').innerHTML()).not.toBe(before[index])
      }
      await expect(cells(hosts.nth(6))).toHaveText(['30', '10', '60'])
      await expect(cells(hosts.nth(7))).toHaveText(['30', '10', '60'])
      await expect(cells(hosts.nth(5))).toHaveText(['24'])
      await expect(cells(hosts.last())).toHaveText(['99'])
      const updated = await hosts.first().locator('[data-chart-svg]').innerHTML()
      await hosts.first().evaluate((node) => {
        node.setAttribute('data-instance-survives', 'true')
      })
      await page.getByRole('button', { name: 'Rerender host', exact: true }).click()
      await expect(page.getByText('Revision: 1', { exact: true })).toBeVisible()
      await expect(hosts.first()).toHaveAttribute('data-instance-survives', 'true')
      expect(await hosts.first().locator('[data-chart-svg]').innerHTML()).toBe(updated)
      await page.getByRole('button', { name: 'Replace document', exact: true }).click()
      await expect(cells(hosts.nth(5))).toHaveText(['80', '20'])
      await expect(cells(hosts.first())).toHaveText(['30', '10', '60'])
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 700 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        )
        await page.screenshot({
          path: info.outputPath(`${target}-chart-data-${width}.png`),
          fullPage: true
        })
      }
    })
  })
  test(`${target} invalid and empty controlled chart data never reveals authored sample values`, async ({
    page
  }) => {
    await withChartData(page, target, async () => {
      const hosts = page.locator('[data-openpencil-chart]')
      await page.getByRole('button', { name: 'Invalid data', exact: true }).click()
      for (const index of [0, 1, 2, 3, 4, 6, 7]) {
        const host = hosts.nth(index)
        await expect(host).toHaveAttribute('data-chart-invalid', 'true')
        await expect(cells(host)).toHaveCount(0)
        await expect(marks(host)).toHaveCount(0)
        await expect(host.getByRole('img')).toHaveAccessibleDescription('图表数据不可用')
        await expect(host.getByRole('status')).toHaveText('图表数据不可用')
        await expect(host.getByRole('rowheader', { name: 'Authored example' })).toHaveCount(0)
      }
      await expect(cells(hosts.nth(5))).toHaveText(['24'])
      await expect(cells(hosts.last())).toHaveText(['99'])
      await page.getByRole('button', { name: 'Empty data', exact: true }).click()
      for (const index of [0, 1, 2, 3, 4, 6, 7]) {
        const host = hosts.nth(index)
        await expect(host).toHaveAttribute('data-chart-invalid', 'false')
        await expect(host).toHaveAttribute('data-chart-empty', 'true')
        await expect(cells(host)).toHaveCount(0)
        await expect(marks(host)).toHaveCount(0)
        await expect(host.getByRole('img')).toHaveAccessibleDescription('暂无数据')
      }
      await page.getByRole('button', { name: 'Repair data', exact: true }).click()
      for (const index of [0, 1, 2, 3, 4, 6, 7]) {
        const host = hosts.nth(index)
        await expect(host).toHaveAttribute('data-chart-invalid', 'false')
        await expect(cells(host)).toHaveText(['15', '45'])
        expect(await marks(host).count()).toBeGreaterThan(0)
        await expect(host.getByRole('status')).toHaveCount(0)
      }
    })
  })
}
