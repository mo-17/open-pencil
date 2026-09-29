import { expect, test } from '@playwright/test'

import { withBusinessBrowser } from '#tests/helpers/compiler/business/helpers'
import {
  longTextKinds,
  presentationResources
} from '#tests/helpers/compiler/business/presentation/fixtures'

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, actionTimeout: 10_000 })

for (const kind of longTextKinds) {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} ${kind} contains long card titles and preserves complete detail text`, async ({
      page
    }, info) => {
      test.setTimeout(90_000)
      await withBusinessBrowser(
        page,
        kind,
        target,
        async ({ fixture, api, open }) => {
          const { resources, entry, listing, rows, primary } = presentationResources(
            fixture.application,
            fixture.definition
          )
          const title = '完整记录业务背景与协作事项，确保每一条重要信息都能阅读。'
            .repeat(10)
            .slice(0, 200)
          rows[0][primary.field] = title
          const multiline = entry.details?.find((column) => column.multiline)
          if (multiline)
            rows[0][multiline.field] =
              '这是完整的业务正文，记录背景、进展和后续安排。\n'.repeat(100) + '正文结束。'
          resources[listing.resourceId] = [rows[0]]
          Object.assign(api.resources, resources)
          await open(entry.id)
          const titleText = `${primary.label.zh}: ${title}`
          const cardTitle = page.getByText(titleText, { exact: true })
          const choose = page.getByRole('button', { name: '选择记录', exact: true })
          await expect(cardTitle).toBeVisible()
          const [titleBox, buttonBox] = await Promise.all([
            cardTitle.boundingBox(),
            choose.boundingBox()
          ])
          if (!titleBox || !buttonBox)
            throw new Error('The record title and selection must be visible')
          expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(buttonBox.y)
          await expect(cardTitle).not.toHaveCSS('overflow-y', 'visible')
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
          ).toBe(true)
          await choose.click()
          const detail = (entry.details ?? entry.listing?.columns)?.find(
            (column) => column.field === primary.field
          )
          if (detail)
            await expect(
              page.getByText(`${detail.label.zh}: ${title}`, { exact: true }).last()
            ).toBeVisible()
          if (multiline) {
            const body = page.getByText(`${multiline.label.zh}: ${rows[0][multiline.field]}`, {
              exact: true
            })
            await expect(body).toBeVisible()
            await expect(body).toHaveCSS('overflow-y', 'auto')
            expect(
              await body.evaluate((element) => element.scrollHeight > element.clientHeight)
            ).toBe(true)
          }
          await page.screenshot({ path: info.outputPath(`${kind}-${target}-long-text-zh.png`) })
        },
        { locale: 'zh-cn' }
      )
    })
  }
}
