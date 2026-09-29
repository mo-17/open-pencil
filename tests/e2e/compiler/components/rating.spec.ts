import { expect, test } from '@playwright/test'

import { withRating } from '#tests/helpers/compiler/modules/rating/browser'

test.use({ viewport: { width: 900, height: 720 } })

for (const target of ['react', 'vue'] as const) {
  test(`${target} Rating supports whole/half pointer values, keyboard, clear and independent read-only states`, async ({
    page
  }, info) => {
    await withRating(page, target, async () => {
      const whole = page.getByRole('slider', { name: '服务评分', exact: true })
      const half = page.getByRole('slider', { name: '半星评分', exact: true })
      await expect(whole).toHaveAttribute('aria-valuenow', '3')
      await whole.focus()
      await page.keyboard.press('ArrowRight')
      await expect(whole).toHaveAttribute('aria-valuenow', '4')
      await page.keyboard.press('End')
      await expect(whole).toHaveAttribute('aria-valuenow', '5')
      await page.keyboard.press('ArrowRight')
      await expect(whole).toHaveAttribute('aria-valuenow', '5')
      await page.keyboard.press('Home')
      await expect(whole).toHaveAttribute('aria-valuenow', '0')
      await half.focus()
      await page.keyboard.press('ArrowUp')
      await expect(half).toHaveAttribute('aria-valuenow', '3')
      const box = await half.boundingBox()
      if (!box) throw new Error('Rating bounds missing')
      await half.click({ position: { x: box.width * 0.65, y: box.height / 2 } })
      await expect(half).toHaveAttribute('aria-valuenow', '3.5')
      await expect(whole).toHaveAttribute('aria-valuenow', '0')
      const halfHost = page.locator('[data-openpencil-rating]').filter({ has: half })
      await halfHost.getByRole('button', { name: '清空评分' }).click()
      await expect(half).toHaveAttribute('aria-valuenow', '0')
      await expect(halfHost.getByRole('button', { name: '清空评分' })).toBeDisabled()
      const readonly = page.getByRole('slider', { name: '只读评分' })
      await readonly.focus()
      await page.keyboard.press('Home')
      await readonly.click()
      await expect(readonly).toHaveAttribute('aria-valuenow', '4')
      const disabled = page.getByRole('slider', { name: '禁用评分' })
      await expect(disabled).toHaveAttribute('tabindex', '-1')
      await disabled.dispatchEvent('keydown', { key: 'Home' })
      await disabled.dispatchEvent('pointerdown', { button: 0, isPrimary: true, clientX: 0 })
      await expect(disabled).toHaveAttribute('aria-valuenow', '2')
      const narrow = page.locator('[data-openpencil-rating]').last()
      expect(
        await narrow.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      await expect(narrow.getByRole('slider')).toHaveAccessibleName('<b>纯文本</b>')
      await expect(narrow.locator('b')).toHaveCount(0)
      await page.screenshot({ path: info.outputPath(`${target}-rating.png`) })
    })
  })

  test(`${target} Rating retains instance state across equal config and resets for new defaults or remount`, async ({
    page
  }) => {
    await withRating(
      page,
      target,
      async () => {
        const slider = page.getByRole('slider', { name: '服务评分' })
        await slider.focus()
        await page.keyboard.press('End')
        await page.getByRole('button', { name: 'Rerender 0', exact: true }).click()
        await expect(slider).toHaveAttribute('aria-valuenow', '5')
        await page.getByRole('button', { name: 'Change initial', exact: true }).click()
        await expect(slider).toHaveAttribute('aria-valuenow', '1')
        await slider.focus()
        await page.keyboard.press('End')
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(slider).toHaveCount(0)
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(slider).toHaveAttribute('aria-valuenow', '1')
      },
      true
    )
  })
}
