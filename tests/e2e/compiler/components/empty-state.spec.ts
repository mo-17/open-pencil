import { expect, test } from '@playwright/test'

import { withEmptyState } from '#tests/helpers/compiler/modules/empty-state/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} Empty State has readable authored copy and decorative geometry in compact containers`, async ({
    page
  }, info) => {
    await withEmptyState(page, target, async () => {
      const host = page.getByRole('group', { name: '暂无资料' })
      await expect(host).toHaveAccessibleDescription(
        '添加资料后，可在这里继续整理。 English content stays editable.'
      )
      await expect(host.locator('button,input,a,[role="status"],[role="alert"]')).toHaveCount(0)
      await expect(host.locator('[data-empty-illustration]')).toHaveAttribute('aria-hidden', 'true')
      for (const width of [320, 140]) {
        await host.evaluate((element, width) => {
          element.style.width = width + 'px'
        }, width)
        const [bounds, icon, title, description] = await Promise.all([
          host.boundingBox(),
          host.locator('[data-empty-illustration]').boundingBox(),
          host.locator('[data-empty-title]').boundingBox(),
          host.locator('[data-empty-description]').boundingBox()
        ])
        if (!bounds || !icon || !title || !description)
          throw new Error('Empty state geometry missing')
        expect(icon.x).toBeGreaterThanOrEqual(bounds.x)
        expect(icon.x + icon.width).toBeLessThanOrEqual(bounds.x + bounds.width)
        expect(title.y).toBeGreaterThanOrEqual(icon.y + icon.height + 11)
        expect(description.y).toBeGreaterThanOrEqual(title.y + title.height + 11)
        expect(
          await host.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
      }
      await page.screenshot({ path: info.outputPath(`${target}-empty-state.png`), fullPage: true })
    })
  })
  test(`${target} Empty State replaces illustrations and long literal text independently without fake actions`, async ({
    page
  }) => {
    await withEmptyState(
      page,
      target,
      async () => {
        const hosts = page.locator('[data-openpencil-empty-state]'),
          first = hosts.first(),
          second = hosts.last()
        const firstId = await first.getAttribute('aria-labelledby'),
          secondId = await second.getAttribute('aria-labelledby')
        if (!firstId || !secondId) throw new Error('Empty state requires a labelled title')
        expect(firstId).not.toBe(secondId)
        await page.getByRole('button', { name: 'Long search result' }).click()
        await expect(first).toHaveAttribute('data-alignment', 'left')
        await expect(first.locator('[data-empty-title]')).toHaveText('<b>无结果</b>')
        await expect(first.locator('b,img,button,a')).toHaveCount(0)
        await expect(second.locator('[data-empty-title]')).toHaveText('暂无资料')
        await first.evaluate((element) => {
          element.style.width = '120px'
        })
        expect(
          await first.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
        const body = await first.locator('[data-empty-body]').boundingBox(),
          icon = await first.locator('[data-empty-illustration]').boundingBox()
        if (!body || !icon) throw new Error('Long empty state missing')
        expect(icon.y - body.y).toBeCloseTo(30, 0)
        expect(await first.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
          true
        )
        await page.getByRole('button', { name: 'Text only' }).click()
        await expect(
          first.locator('[data-empty-illustration],[data-empty-description]')
        ).toHaveCount(0)
        await expect(first).not.toHaveAttribute('aria-describedby')
        await expect(second.locator('[data-empty-description]')).toHaveCount(1)
        await page.getByRole('button', { name: 'Restore defaults' }).click()
        await expect(first.locator('[data-empty-illustration]')).toHaveCount(1)
        await expect(first).toHaveAttribute('aria-labelledby', firstId)
        await expect(first).toHaveAccessibleDescription('添加资料后，在这里整理。')
      },
      true
    )
  })
}
