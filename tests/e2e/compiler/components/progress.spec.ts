import { expect, test } from '@playwright/test'

import { withProgress } from '#tests/helpers/compiler/modules/progress/browser'

test.use({ viewport: { width: 375, height: 760 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} Progress exposes measured values while indeterminate and narrow variants remain readable`, async ({
    page
  }, info) => {
    await withProgress(page, target, async () => {
      const linear = page.getByRole('progressbar', { name: '文件进度', exact: true })
      await expect(linear).toHaveAttribute('aria-valuemin', '0')
      await expect(linear).toHaveAttribute('aria-valuemax', '100')
      await expect(linear).toHaveAttribute('aria-valuenow', '37.5')
      await expect(linear.locator('[data-progress-value]')).toHaveText('37.5%')
      const fill = await linear.locator('[data-progress-fill]').boundingBox()
      const track = await linear.locator('[data-progress-track]').boundingBox()
      if (!fill || !track) throw new Error('Missing progress geometry')
      expect(fill.width / track.width).toBeCloseTo(0.375, 2)
      const circular = page.getByRole('progressbar', { name: '圆形进度' })
      await expect(circular).toHaveAttribute('aria-valuenow', '75')
      await expect(circular.locator('[data-progress-arc]')).toHaveAttribute(
        'stroke-dasharray',
        '75 100'
      )
      const pending = page.getByRole('progressbar', { name: '正在处理', exact: true })
      await expect(pending).not.toHaveAttribute('aria-valuenow')
      await expect(pending).toHaveAttribute('aria-valuetext', '进度未提供')
      await expect(pending.locator('[data-progress-value]')).toHaveText('进度未提供')
      await expect(pending.locator('[data-progress-value]')).not.toContainText('%')
      const narrow = page.getByRole('progressbar', { name: '<b>等待结果</b>', exact: true })
      await expect(narrow.locator('b')).toHaveCount(0)
      await expect(narrow.locator('[data-progress-value]')).toHaveText('等待结果')
      for (const host of [linear, circular, pending, narrow])
        expect(
          await host.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
        ).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      )
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect(pending.locator('[data-progress-fill]')).toHaveCSS(
        'animation-name',
        'op-progress-slide'
      )
      await expect(narrow.locator('[data-progress-rotation]')).toHaveCSS(
        'animation-name',
        'op-progress-spin'
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect(pending.locator('[data-progress-fill]')).toHaveCSS('animation-name', 'none')
      await expect(narrow.locator('[data-progress-rotation]')).toHaveCSS('animation-name', 'none')
      await expect(pending).not.toHaveAttribute('aria-valuenow')
      await expect(pending.locator('[data-progress-value]')).toBeVisible()
      await expect(linear).toHaveAttribute('aria-valuenow', '37.5')
      for (const name of ['大直径', '矮容器', '<b>等待结果</b>']) {
        const meter = page.getByRole('progressbar', { name, exact: true })
        const geometry = await meter.evaluate((host) => {
          const body = host.querySelector('[data-progress-body]')?.getBoundingClientRect()
          const circle = host.querySelector('circle')
          if (!body || !(circle instanceof SVGCircleElement))
            throw new Error('Missing circle geometry')
          const box = circle.getBoundingClientRect()
          const matrix = circle.getScreenCTM()
          if (!matrix) throw new Error('Missing circle transform')
          const stroke =
            Number(circle.getAttribute('stroke-width')) * Math.hypot(matrix.a, matrix.b)
          return {
            size: box.width + stroke,
            bottom: box.bottom + stroke / 2,
            top: box.top - stroke / 2,
            expected: Math.min(240, body.width, body.height),
            bodyTop: body.top,
            bodyBottom: body.bottom
          }
        })
        expect(geometry.size).toBeCloseTo(geometry.expected, 1)
        expect(geometry.top).toBeCloseTo(geometry.bodyTop, 1)
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.bodyBottom + 0.1)
      }
      const empty = page.getByRole('progressbar', { name: '零剩余高度' })
      await expect(empty.locator('[data-progress-body]')).toHaveCSS('height', '0px')
      await page.screenshot({ path: info.outputPath(`${target}-progress-375.png`), fullPage: true })
    })
  })

  test(`${target} Progress updates only from configured values and clears the numeric ARIA value while unknown`, async ({
    page
  }) => {
    await withProgress(
      page,
      target,
      async () => {
        const meter = page.getByRole('progressbar', { name: 'Configured progress' })
        await expect(meter).toHaveAttribute('aria-valuenow', '0')
        await page.getByRole('button', { name: 'Set 75' }).click()
        await expect(meter).toHaveAttribute('aria-valuenow', '75')
        await page.getByRole('button', { name: 'Unknown', exact: true }).click()
        await expect(meter).not.toHaveAttribute('aria-valuenow')
        await expect(meter.locator('[data-progress-value]')).toHaveText('Value unavailable')
        await page.getByRole('button', { name: 'Reset 0' }).click()
        await expect(meter).toHaveAttribute('aria-valuenow', '0')
        await expect(meter.locator('[data-progress-value]')).toHaveText('0%')
      },
      true
    )
  })
}
