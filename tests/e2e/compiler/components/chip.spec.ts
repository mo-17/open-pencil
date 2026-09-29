import { expect, test } from '@playwright/test'

import { withChipModules } from '#tests/helpers/compiler/modules/chip/browser'

test.use({ viewport: { width: 375, height: 820 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} chips expose full labels and isolated selection, removal and disabled state`, async ({
    page
  }, info) => {
    await withChipModules(page, target, async () => {
      const chips = page.locator('[data-openpencil-chip]')
      await expect(chips).toHaveCount(6)
      await expect(chips.first().getByRole('button')).toHaveCount(0)
      const selected = chips.nth(1).getByRole('button', { name: '可选择标签', exact: true })
      await selected.focus()
      await page.keyboard.press('Space')
      await expect(selected).toHaveAttribute('aria-pressed', 'true')
      await expect(
        chips.nth(2).getByRole('button', { name: '另一标签', exact: true })
      ).toHaveAttribute('aria-pressed', 'false')
      await expect(chips.nth(3).getByRole('button')).toHaveCount(2)
      await expect(chips.nth(3).locator('button:enabled')).toHaveCount(0)
      const longLabel = chips.nth(4).locator('[data-chip-label]')
      expect(await longLabel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
        true
      )
      await expect(chips.nth(4).getByRole('button').first()).toHaveAccessibleName(
        '很长的中文和English标签文字'.repeat(3)
      )
      expect(
        await chips.nth(4).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
      ).toBe(true)
      await expect(chips.nth(5).locator('b')).toHaveCount(0)
      await expect(chips.nth(5).getByText('<b>纯文本</b>', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath(`${target}-chip-states.png`) })
      await selected.press('Delete')
      await expect(chips.nth(1)).toHaveAttribute('data-removed', 'true')
      await expect(chips.nth(1)).toBeFocused()
      await expect(chips.nth(1).getByRole('status')).toHaveText('可选择标签: 已移除')
      await page.keyboard.press('Tab')
      await expect(chips.nth(2).getByRole('button').first()).toBeFocused()
    })
  })
  test(`${target} chip state survives equal props, resets on replacement and remount, and never submits forms`, async ({
    page
  }) => {
    await withChipModules(
      page,
      target,
      async () => {
        const chip = page.locator('[data-openpencil-chip]')
        await chip.getByRole('button').first().click()
        await page.getByRole('button', { name: 'Equal config', exact: true }).click()
        await expect(chip.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')
        await chip.getByRole('button').last().focus()
        await page.keyboard.press('Enter')
        await expect(chip).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(page.getByRole('button', { name: 'Next control', exact: true })).toBeFocused()
        await page.getByRole('button', { name: 'Equal config', exact: true }).click()
        await expect(chip).toHaveAttribute('data-removed', 'true')
        await page.getByRole('button', { name: 'Replace config', exact: true }).click()
        await expect(chip.getByRole('button').first()).toHaveAttribute('aria-pressed', 'false')
        await chip.getByRole('button').first().click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(chip.getByRole('button').first()).toHaveAttribute('aria-pressed', 'false')
        await expect(page.locator('output')).toHaveText('0')
        await expect(page.locator('button button')).toHaveCount(0)
      },
      true
    )
  })
}
