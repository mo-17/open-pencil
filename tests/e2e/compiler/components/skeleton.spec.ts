import { expect, test } from '@playwright/test'

import { withSkeleton } from '#tests/helpers/compiler/modules/skeleton/browser'

test.use({ viewport: { width: 375, height: 700 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} Skeleton fits authored shapes and descriptions without inventing measured progress`, async ({
    page
  }, info) => {
    await withSkeleton(page, target, async () => {
      const text = page.getByRole('status', { name: '正在加载内容', exact: true })
      await expect(text.locator('[data-skeleton-label]')).toHaveText('正在加载内容')
      await expect(text.locator('[data-skeleton-line]')).toHaveCount(3)
      await expect(text).not.toHaveAttribute('aria-valuenow')
      await expect(page.getByRole('progressbar')).toHaveCount(0)
      const lines = text.locator('[data-skeleton-line]'),
        first = await lines.first().boundingBox(),
        last = await lines.last().boundingBox()
      if (!first || !last) throw new Error('Missing skeleton text geometry')
      expect(first.height).toBeCloseTo(16, 1)
      expect(last.width / first.width).toBeCloseTo(0.6, 2)
      const second = await lines.nth(1).boundingBox()
      if (!second) throw new Error('Missing second line')
      expect(second.y - first.y - first.height).toBeCloseTo(12, 1)
      const rectangle = page.getByRole('status', { name: '图片占位', exact: true })
      await expect(rectangle.locator('[data-skeleton-label]')).toBeVisible()
      await expect(rectangle.locator('[data-skeleton-rectangle]')).toBeVisible()
      const circle = await page
        .getByRole('status', { name: '头像占位', exact: true })
        .locator('circle')
        .boundingBox()
      if (!circle) throw new Error('Missing circle geometry')
      expect(circle.width).toBeCloseTo(48, 1)
      expect(circle.height).toBeCloseTo(48, 1)
      const narrow = page.getByRole('status', { name: '窄容器', exact: true })
      await expect(narrow.locator('[data-skeleton-line]')).toHaveCount(12)
      const narrowBounds = await narrow.boundingBox()
      if (!narrowBounds) throw new Error('Missing narrow host')
      for (const line of await narrow.locator('[data-skeleton-line]').all()) {
        const bounds = await line.boundingBox()
        if (!bounds) throw new Error('Missing narrow line')
        expect(bounds.height).toBeGreaterThan(0)
        expect(bounds.x).toBeGreaterThanOrEqual(narrowBounds.x)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(
          narrowBounds.x + narrowBounds.width + 0.1
        )
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(
          narrowBounds.y + narrowBounds.height + 0.1
        )
      }
      const exhausted = page.getByRole('status', { name: '<b>等待详情</b>', exact: true })
      await expect(exhausted.locator('b')).toHaveCount(0)
      await expect(exhausted.locator('[data-skeleton-shapes]')).toHaveCSS('height', '0px')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect(text.locator('[data-skeleton-shapes]')).toHaveCSS(
        'animation-name',
        'op-skeleton-pulse'
      )
      await expect(rectangle.locator('[data-skeleton-shapes]')).toHaveCSS('animation-name', 'none')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(text.locator('[data-skeleton-shapes]')).toHaveCSS('animation-name', 'none')
      await expect(text.locator('[data-skeleton-shapes]')).toHaveCSS('opacity', '1')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.screenshot({ path: info.outputPath(`${target}-skeleton-375.png`), fullPage: true })
    })
  })
  test(`${target} Skeleton changes only when caller config or conditional visibility changes`, async ({
    page
  }) => {
    await withSkeleton(
      page,
      target,
      async () => {
        const status = page.getByRole('status', { name: 'Loading profile', exact: true })
        await expect(status.locator('[data-skeleton-line]')).toHaveCount(3)
        await page.getByRole('button', { name: 'Circle', exact: true }).click()
        await expect(status.locator('[data-skeleton-circle]')).toBeVisible()
        await expect(status.locator('[data-skeleton-line]')).toHaveCount(0)
        await expect(status.locator('[data-skeleton-shapes]')).toHaveCSS('animation-name', 'none')
        await page.getByRole('button', { name: 'Toggle loading' }).click()
        await expect(status).toHaveCount(0)
        await expect(page.getByText('Profile ready', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Toggle loading' }).click()
        await expect(status.locator('[data-skeleton-circle]')).toBeVisible()
      },
      true
    )
  })
}
