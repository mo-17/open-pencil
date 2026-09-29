import { expect, test } from '@playwright/test'

import { withBadge } from '#tests/helpers/compiler/modules/badge/browser'

test.use({ viewport: { width: 640, height: 600 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} Badge distinguishes zero, numeric overflow and decorative dots without clipping`, async ({
    page
  }, info) => {
    await withBadge(page, target, async () => {
      const badges = page.locator('[data-openpencil-badge]')
      await expect(badges).toHaveCount(6)
      await expect(badges.nth(0).locator('[data-badge-value]')).toHaveCount(0)
      await expect(badges.nth(0)).toContainText('隐藏零值')
      await expect(badges.nth(1).locator('[data-badge-value]')).toHaveText('0')
      const numeric = badges.nth(2)
      await expect(numeric.locator('[data-badge-value]')).toHaveText('99+')
      await expect(numeric.locator('[data-badge-count-label]')).toHaveText('消息数: 120')
      const numericSpeech = await numeric.ariaSnapshot()
      expect(numericSpeech).toContain('120')
      expect(numericSpeech).not.toContain('99+')
      await expect(badges.nth(3)).toContainText('<b>纯文本</b>')
      await expect(badges.nth(3).locator('[data-badge-count-label]')).toHaveText('<i>数量</i>: 44')
      await expect(badges.nth(3).locator('b,i')).toHaveCount(0)
      await expect(badges.nth(3).locator('[data-badge-host]')).toHaveCSS(
        'background-color',
        'rgb(219, 234, 254)'
      )
      const dot = badges.nth(4)
      await expect(dot.locator('[data-badge-value]')).toHaveText('')
      await expect(dot.locator('[data-badge-value]')).toHaveAttribute('aria-hidden', 'true')
      await expect(dot.locator('[data-badge-count-label]')).toHaveCount(0)
      expect(await dot.ariaSnapshot()).toContain('装饰圆点')
      expect(await dot.ariaSnapshot()).not.toContain('999999999')
      expect(await dot.ariaSnapshot()).not.toContain('不可作为状态读出')
      await expect(badges.nth(5).locator('[data-badge-value]')).toHaveText('999999+')
      for (const badge of await badges.all()) {
        expect(await badge.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
        const indicator = badge.locator('[data-badge-value]')
        if (await indicator.count()) {
          const hostBox = await badge.boundingBox(),
            valueBox = await indicator.boundingBox()
          if (!hostBox || !valueBox) throw new Error('Badge bounds missing')
          expect(valueBox.x).toBeGreaterThanOrEqual(hostBox.x - 0.5)
          expect(valueBox.y).toBeGreaterThanOrEqual(hostBox.y - 0.5)
          expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width + 0.5)
          expect(valueBox.y + valueBox.height).toBeLessThanOrEqual(hostBox.y + hostBox.height + 0.5)
        }
      }
      await expect(page.getByRole('status')).toHaveCount(0)
      await expect(page.getByRole('button')).toHaveCount(0)
      await page.screenshot({ path: info.outputPath(`${target}-badge.png`) })
    })
  })

  test(`${target} Badge reacts to count, mode, size, color and placement without leaking into other instances`, async ({
    page
  }) => {
    await withBadge(
      page,
      target,
      async () => {
        const current = page
          .getByRole('region', { name: 'Current badge' })
          .locator('[data-openpencil-badge]')
        const other = page
          .getByRole('region', { name: 'Other badge' })
          .locator('[data-openpencil-badge]')
        await expect(current.locator('[data-badge-value]')).toHaveText('99+')
        await page.getByRole('button', { name: 'Zero', exact: true }).click()
        await expect(current.locator('[data-badge-value]')).toHaveCount(0)
        await expect(current.locator('[data-badge-count-label]')).toHaveCount(0)
        await page.getByRole('button', { name: 'Show zero', exact: true }).click()
        await expect(current.locator('[data-badge-value]')).toHaveText('0')
        await expect(current.locator('[data-badge-count-label]')).toHaveText('消息数: 0')
        await page.getByRole('button', { name: 'Overflow', exact: true }).click()
        await expect(current.locator('[data-badge-value]')).toHaveText('9+')
        await expect(current.locator('[data-badge-count-label]')).toHaveText('消息数: 999')
        await page.getByRole('button', { name: 'Toggle dot', exact: true }).click()
        await expect(current.locator('[data-badge-count-label]')).toHaveCount(0)
        await expect(current.locator('[data-badge-value]')).toHaveCSS('width', '10px')
        await page.getByRole('button', { name: 'Restyle', exact: true }).click()
        await expect(current).toHaveAttribute('data-badge-placement', 'bottom-left')
        await expect(current.locator('[data-badge-value]')).toHaveCSS('width', '12px')
        await expect(current.locator('[data-badge-value]')).toHaveCSS(
          'background-color',
          'rgb(21, 128, 61)'
        )
        await expect(current.locator('[data-badge-host]')).toHaveCSS(
          'background-color',
          'rgb(240, 253, 244)'
        )
        const hostBox = await current.boundingBox(),
          valueBox = await current.locator('[data-badge-value]').boundingBox()
        if (!hostBox || !valueBox) throw new Error('Badge bounds missing')
        expect(valueBox.x).toBeCloseTo(hostBox.x, 1)
        expect(valueBox.y + valueBox.height).toBeCloseTo(hostBox.y + hostBox.height, 1)
        await page.getByRole('button', { name: 'Toggle dot', exact: true }).click()
        await expect(current.locator('[data-badge-value]')).toHaveText('9+')
        await expect(current.locator('[data-badge-value]')).toHaveCSS('height', '26px')
        await expect(other.locator('[data-badge-value]')).toHaveText('99+')
        await expect(other.locator('[data-badge-count-label]')).toHaveText('消息数: 120')
      },
      true
    )
  })
}
