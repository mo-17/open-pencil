import { expect, test } from '@playwright/test'

import { withCompositionPreview } from '#tests/helpers/compiler/components/composition-browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} modal projects a real validated form and restores focus and draft`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withCompositionPreview(page, target, async () => {
      const trigger = page.getByRole('button', { name: 'Open profile', exact: true })
      await expect(page.getByPlaceholder('Dialog email')).toHaveCount(0)
      await trigger.click()
      const dialog = page.getByRole('dialog', { name: 'Profile dialog' })
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Save Dialog', exact: true }).click()
      await expect(dialog.getByText('Dialog is required', { exact: true })).toBeVisible()
      await expect(page.getByText('Not submitted', { exact: true })).toBeVisible()
      await dialog.getByPlaceholder('Dialog email').fill('dialog@example.test')
      await dialog.getByRole('button', { name: 'Save Dialog', exact: true }).click()
      await expect(page.getByText('Dialog saved', { exact: true })).toBeVisible()
      await expect(dialog).toBeVisible()
      const bounds = await dialog.boundingBox()
      const viewport = page.viewportSize()
      if (!bounds || !viewport) throw new Error('Missing dialog geometry')
      expect(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2)).toBeLessThan(2)
      expect(Math.abs(bounds.y + bounds.height / 2 - viewport.height / 2)).toBeLessThan(2)
      const fieldBounds = await dialog.getByPlaceholder('Dialog email').boundingBox()
      if (!fieldBounds) throw new Error('Missing nested form field')
      expect(fieldBounds.y).toBeGreaterThan(bounds.y + 30)
      expect(fieldBounds.y + fieldBounds.height).toBeLessThan(bounds.y + bounds.height)
      for (let index = 0; index < 8; index++) await page.keyboard.press('Tab')
      await expect
        .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true)
      await page.screenshot({ path: info.outputPath('modal-form-content.png') })
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(trigger).toBeFocused()
      await trigger.click()
      await expect(dialog.getByPlaceholder('Dialog email')).toHaveValue('dialog@example.test')
      await expect(page.getByText('Dialog saved', { exact: true })).toBeVisible()
    })
  })

  test(`${target} conditional mapped content stays empty without showing legacy fallback`, async ({
    page
  }) => {
    test.setTimeout(120_000)
    await withCompositionPreview(
      page,
      target,
      async () => {
        await expect(page.getByRole('tabpanel')).toBeEmpty()
        await expect(page.getByText('Legacy profile', { exact: true })).toHaveCount(0)
        await page.getByRole('button', { name: 'Open profile', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Profile dialog' })
        await expect(dialog).toBeVisible()
        await expect(dialog.getByPlaceholder('Dialog email')).toHaveCount(0)
        await expect(
          dialog.getByText('Add supporting content for this dialog.', { exact: true })
        ).toHaveCount(0)
      },
      true
    )
  })

  test(`${target} tabs mount only the active panel and retain controlled form state`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withCompositionPreview(page, target, async () => {
      const profile = page.getByRole('tab', { name: 'Profile', exact: true })
      const rows = page.getByRole('tab', { name: 'Rows', exact: true })
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await expect(page.getByText('Item: Alpha', { exact: true })).toHaveCount(0)
      await page.getByPlaceholder('Tab email').fill('tab@example.test')
      await profile.focus()
      await page.keyboard.press('ArrowRight')
      await expect(rows).toBeFocused()
      await expect(profile).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByPlaceholder('Tab email')).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(rows).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByPlaceholder('Tab email')).toHaveCount(0)
      await expect(page.getByText('Item: Alpha', { exact: true })).toBeVisible()
      await expect(page.getByText('Item: Beta', { exact: true })).toBeVisible()
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await page.screenshot({ path: info.outputPath('tabs-list-content.png') })
      await page.keyboard.press('Home')
      await expect(profile).toBeFocused()
      await expect(rows).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Space')
      await expect(page.getByPlaceholder('Tab email')).toHaveValue('tab@example.test')
      await expect(page.getByText('Item: Alpha', { exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Save Tab', exact: true }).click()
      await expect(page.getByText('Tab saved', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath('tabs-form-content.png') })
    })
  })
}
