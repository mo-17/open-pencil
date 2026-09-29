import { expect, test } from '@playwright/test'

import { expectDescriptionsBorders } from '#tests/helpers/compiler/modules/descriptions/borders'
import { withDescriptions } from '#tests/helpers/compiler/modules/descriptions/browser'
import { expectDescriptionsEmptyValue } from '#tests/helpers/compiler/modules/descriptions/empty-value'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Descriptions renders semantic literal pairs and reduces columns in narrow containers`, async ({
    page
  }, info) => {
    await withDescriptions(page, target, async () => {
      const host = page.locator('[data-openpencil-descriptions]')
      await expect(host.locator('dl')).toHaveAttribute('aria-label', '项目详情')
      await expect(host.locator('dt')).toHaveText(['名称', '说明'])
      await expect(host.locator('dd')).toHaveText(['示例项目', '中文 English 详情\n继续阅读'])
      await expect(host.locator('button,input,a,[role="status"],[role="alert"]')).toHaveCount(0)
      for (const width of [680, 480, 399, 180]) {
        await host.evaluate((element, width) => {
          element.style.width = width + 'px'
        }, width)
        expect(
          await host.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
        const first = await host.locator('[data-description-item]').nth(0).boundingBox(),
          second = await host.locator('[data-description-item]').nth(1).boundingBox()
        if (!first || !second) throw new Error('Descriptions geometry missing')
        if (width >= 400) expect(second.y).toBeCloseTo(first.y, 0)
        else expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1)
      }
      await expectDescriptionsBorders(page, host)
      await page.screenshot({ path: info.outputPath(target + '-descriptions.png'), fullPage: true })
    })
  })
  test(`${target} Descriptions updates layout and long inert text without stale rows or horizontal overflow`, async ({
    page
  }) => {
    await withDescriptions(
      page,
      target,
      async () => {
        const hosts = page.locator('[data-openpencil-descriptions]'),
          first = hosts.first(),
          second = hosts.last()
        await page.getByRole('button', { name: 'Replace content' }).click()
        await expect(first).toHaveAttribute('data-layout', 'vertical')
        await expect(first).toHaveAttribute('data-bordered', 'false')
        await expect(first.locator('dt')).toHaveText(['<b>标签</b>', '新项目'])
        await expect(first.locator('b,img,button,a')).toHaveCount(0)
        await expect(second.locator('dt')).toHaveCount(6)
        for (const width of [680, 480, 399, 120]) {
          await first.evaluate((element, width) => {
            element.style.width = width + 'px'
          }, width)
          expect(
            await first.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
          ).toBe(true)
        }
        expect(await first.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
          true
        )
        await first.evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        await expect(first.locator('dd').last()).toBeInViewport()
        await page.getByRole('button', { name: 'Restore', exact: true }).click()
        await expect(first.locator('dt')).toHaveCount(6)
        await expect(first).toHaveAttribute('data-layout', 'horizontal')
        await expect(first).toHaveAttribute('data-bordered', 'true')
        await expectDescriptionsEmptyValue(page, first)
      },
      true
    )
  })
}
