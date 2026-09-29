import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import {
  presentationKinds,
  presentationResources
} from '#tests/helpers/compiler/business/presentation/fixtures'

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, actionTimeout: 10_000 })

for (const kind of presentationKinds) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} presents and navigates its Chinese business workspace`, async ({
      page
    }, info) => {
      test.setTimeout(90_000)
      await withBusinessBrowser(
        page,
        kind,
        target,
        async ({ fixture, api, open }) => {
          const { resources, entry, rows, primary } = presentationResources(
            fixture.application,
            fixture.definition
          )
          Object.assign(api.resources, resources)
          await open(entry.id)
          const firstTitle = `${primary.label.zh}: ${rows[0][primary.field]}`
          const secondTitle = `${primary.label.zh}: ${rows[1][primary.field]}`
          await expect(page.getByText(firstTitle, { exact: true })).toBeVisible()
          await expect(page.getByText(secondTitle, { exact: true })).toBeVisible()
          await expect(page.getByRole('button', { name: '选择记录', exact: true })).toHaveCount(2)
          const search = page.getByPlaceholder('搜索记录', { exact: true })
          const apply = page.getByRole('button', { name: '应用筛选', exact: true })
          const [searchBox, applyBox] = await Promise.all([
            search.boundingBox(),
            apply.boundingBox()
          ])
          if (!searchBox || !applyBox) throw new Error('Search controls must remain visible')
          expect(searchBox.x + searchBox.width).toBeLessThanOrEqual(applyBox.x)
          expect(Math.abs(searchBox.y - applyBox.y)).toBeLessThan(2)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true)
          await page.screenshot({ path: info.outputPath(`${kind}-${target}-entry-zh.png`) })

          await search.fill(String(rows[0][primary.field]))
          await apply.click()
          await expect(page.getByText(secondTitle, { exact: true })).toHaveCount(0)
          await page.getByRole('button', { name: '选择记录', exact: true }).click()
          const detail = (entry.details ?? entry.listing?.columns)?.[0]
          if (!detail) throw new Error('A selected record must expose its details')
          await expect(
            page.getByText(`${detail.label.zh}: ${rows[0][detail.field]}`, { exact: true }).last()
          ).toBeVisible()
          await page.screenshot({ path: info.outputPath(`${kind}-${target}-details-zh.png`) })
          await page.getByRole('button', { name: '账号设置', exact: true }).click()
          await expect(page).toHaveURL(/\/account-setup$/u)
          await expect(
            page.getByRole('button', { name: '登记本人资料', exact: true })
          ).toBeVisible()
          expect(api.calls).toHaveLength(0)
        },
        { locale: 'zh-cn' }
      )
    })
  }
}
