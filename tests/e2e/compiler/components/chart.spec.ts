import { expect, test } from '@playwright/test'

import { withChart } from '#tests/helpers/compiler/modules/chart/browser'

test.use({ viewport: { width: 375, height: 700 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} charts render shared local geometry, Chinese labels and every accessible value`, async ({
    page
  }, info) => {
    await withChart(page, target, async () => {
      const hosts = page.locator('[data-openpencil-chart]')
      await expect(hosts).toHaveCount(10)
      for (const [index, label] of ['柱状图', '折线图', '面积图', '饼图', '环形图'].entries()) {
        const host = hosts.nth(index)
        await expect(host.getByRole('img', { name: label, exact: true })).toBeVisible()
        await expect(host.getByRole('table', { name: '图表数据' }).getByRole('row')).toHaveCount(4)
        await expect(host.getByRole('rowheader', { name: '设计', exact: true })).toHaveCount(1)
        await expect(host.getByRole('columnheader', { name: '数值', exact: true })).toHaveCount(1)
        await expect(host.locator('[data-chart-svg]')).toHaveAttribute(
          'preserveAspectRatio',
          'xMidYMid meet'
        )
        const bounds = await host.boundingBox()
        if (!bounds) throw new Error('Missing chart host bounds')
        for (const mark of await host
          .locator('[data-chart-bar],[data-chart-path],[data-chart-circle]')
          .all()) {
          const box = await mark.boundingBox()
          if (!box) throw new Error('Missing chart mark')
          expect(box.x).toBeGreaterThanOrEqual(bounds.x - 0.5)
          expect(box.y).toBeGreaterThanOrEqual(bounds.y - 0.5)
          expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5)
          expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5)
        }
      }
      await expect(hosts.nth(0).getByRole('cell', { name: '-12', exact: true })).toHaveCount(1)
      await expect(hosts.nth(0).locator('[data-chart-text="category"]')).toContainText([
        '设计',
        '开发',
        '评审'
      ])
      const empty = hosts.nth(5)
      await expect(empty).toHaveAttribute('data-chart-empty', 'true')
      await expect(empty.getByRole('img')).toHaveAccessibleDescription(/暂无非零数据/)
      await expect(empty.locator('[data-chart-text="empty"]')).toHaveText('暂无非零数据')
      await expect(empty.getByRole('table').getByRole('cell')).toHaveText(['0', '0'])
      const dense = hosts.nth(6)
      await expect(dense.getByRole('table').getByRole('row')).toHaveCount(65)
      await expect(dense.getByRole('rowheader', { name: '完整类别64', exact: true })).toHaveCount(1)
      await expect(dense.getByRole('img')).toHaveAccessibleDescription(/完整数据见数据表/)
      await expect(
        hosts.nth(7).getByRole('rowheader', { name: '<b>唯一项</b>', exact: true })
      ).toHaveCount(1)
      await expect(hosts.nth(7).locator('b')).toHaveCount(0)
      await expect(hosts.nth(7).locator('[data-chart-circle]')).toHaveCount(1)
      const round = hosts.nth(8),
        mark = round.locator('[data-chart-path]').first()
      await expect(mark).toBeVisible()
      for (const width of [240, 80]) {
        await round.evaluate((element, width) => {
          element.style.width = width + 'px'
        }, width)
        const box = await mark.boundingBox()
        if (!box) throw new Error('Missing pie mark')
        expect(box.width).toBeGreaterThan(0)
        expect(box.width).toBeCloseTo(box.height, 1)
      }
      await expect(hosts.nth(9).getByRole('img')).toHaveAccessibleDescription(/当前尺寸较小/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({ path: info.outputPath(`${target}-charts-375.png`), fullPage: true })
    })
  })
  test(`${target} chart payload replacement and inherited language remain instance local`, async ({
    page
  }) => {
    await withChart(
      page,
      target,
      async () => {
        const hosts = page.locator('[data-openpencil-chart]')
        const first = hosts.first(),
          second = hosts.last()
        const firstTitle = await first.getByRole('img').getAttribute('aria-labelledby')
        const secondTitle = await second.getByRole('img').getAttribute('aria-labelledby')
        expect(firstTitle).not.toBe(secondTitle)
        await page.getByRole('button', { name: 'Donut', exact: true }).click()
        await expect(first).toHaveAttribute('data-chart-type', 'donut')
        await expect(first.getByRole('img', { name: '环形图', exact: true })).toBeVisible()
        await expect(second.getByRole('img', { name: '柱状图', exact: true })).toBeVisible()
        await expect(first.getByRole('table').getByRole('cell')).toHaveText(['35', '45', '20'])
        await expect(second.getByRole('table').getByRole('cell')).toHaveText(['32', '-12', '46'])
        await page.getByRole('button', { name: 'Language', exact: true }).click()
        await expect(first.getByRole('img', { name: 'Donut chart', exact: true })).toBeVisible()
        await expect(
          second
            .getByRole('table', { name: 'Chart data' })
            .getByRole('columnheader', { name: 'Category', exact: true })
        ).toHaveCount(1)
        await page.getByRole('button', { name: 'Toggle chart', exact: true }).click()
        await expect(hosts).toHaveCount(1)
        await page.getByRole('button', { name: 'Language', exact: true }).click()
        await expect(hosts.getByRole('img', { name: '柱状图', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Toggle chart', exact: true }).click()
        await expect(hosts).toHaveCount(2)
        await expect(first.getByRole('img', { name: '环形图', exact: true })).toBeVisible()
      },
      true
    )
  })
}
