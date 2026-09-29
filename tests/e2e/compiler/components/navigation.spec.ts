import { expect, test } from '@playwright/test'

import { withNavigationModules } from '#tests/helpers/compiler/modules/navigation/browser'

test.use({ viewport: { width: 900, height: 820 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} steps support local keyboard selection without changing disabled or read-only steps`, async ({
    page
  }, info) => {
    await withNavigationModules(page, target, async () => {
      const controls = page.locator('[data-openpencil-stepper]').first()
      const readonly = page.locator('[data-openpencil-stepper]').nth(1)
      const steps = controls.locator('li')
      const lastTitle = await controls.locator('[data-step-title]').last().boundingBox()
      const controlsBox = await controls.boundingBox()
      if (!lastTitle || !controlsBox) throw new Error('Last horizontal step is unavailable')
      expect(lastTitle.x + lastTitle.width).toBeLessThanOrEqual(controlsBox.x + controlsBox.width)
      expect(
        await controls.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      const manySteps = page.locator('[data-openpencil-stepper]').nth(2)
      expect(await manySteps.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true
      )
      await manySteps.evaluate((element) => {
        element.scrollLeft = element.scrollWidth
      })
      expect(await manySteps.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
      await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')
      await controls.getByRole('button').nth(1).focus()
      await page.keyboard.press('Enter')
      await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
      await expect(steps.nth(0)).toHaveAttribute('data-state', 'completed')
      await expect(controls.getByRole('button').nth(2)).toBeDisabled()
      await expect(readonly.getByRole('button')).toHaveCount(0)
      await expect(readonly.locator('li').first()).toHaveAttribute('aria-current', 'step')
      const descriptionBox = await readonly.locator('[data-step-description]').first().boundingBox()
      const nextTitleBox = await readonly.locator('[data-step-title]').nth(1).boundingBox()
      if (!descriptionBox || !nextTitleBox) throw new Error('Vertical step copy is unavailable')
      expect(nextTitleBox.y).toBeGreaterThanOrEqual(descriptionBox.y + descriptionBox.height + 10)
      await expect(controls.getByText('<b>纯文本</b>', { exact: true })).toBeVisible()
      await expect(controls.locator('b')).toHaveCount(0)
      await expect(controls.getByRole('button').first()).toHaveAttribute('type', 'button')
      await page.screenshot({ path: info.outputPath(`${target}-navigation.png`) })
    })
  })
  test(`${target} breadcrumbs use real safe links and an unlinked current-page label at narrow widths`, async ({
    page
  }) => {
    await withNavigationModules(page, target, async () => {
      const nav = page.getByRole('navigation', { name: '导航路径' })
      await expect(nav.getByRole('link')).toHaveCount(1)
      await expect(nav.getByRole('link', { name: '首页' })).toHaveAttribute('href', '#home')
      await expect(nav.locator('[aria-current=page]')).toHaveText('当前页面')
      await expect(nav.locator('[aria-current=page]')).not.toHaveAttribute('href')
      expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true
      )
      await page.setViewportSize({ width: 375, height: 820 })
      await expect(nav.locator('[aria-current=page]')).toBeVisible()
      const currentBox = await nav.locator('[aria-current=page]').boundingBox()
      const navBox = await nav.boundingBox()
      if (!currentBox || !navBox) throw new Error('Current breadcrumb is unavailable')
      expect(currentBox.width).toBeGreaterThan(10)
      expect(currentBox.x + currentBox.width).toBeLessThanOrEqual(navBox.x + navBox.width)
      expect(await nav.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
        true
      )
    })
  })
}
