import { expect, test } from '@playwright/test'

import {
  dateRangeFitsWidth,
  dateRangeLocalInputOwnership,
  withDateRangeModules
} from '#tests/helpers/compiler/modules/date-range/browser'

test.use({ viewport: { width: 375, height: 820 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} date ranges show localized validation, preserve drafts, clear and honor disabled state`, async ({
    page
  }, info) => {
    await withDateRangeModules(page, target, async () => {
      const ranges = page.locator('[data-openpencil-date-range]')
      await expect(ranges).toHaveCount(4)
      const range = ranges.first(),
        start = range.getByLabel('开始日期', { exact: true }),
        end = range.getByLabel('结束日期', { exact: true })
      await expect(start).toHaveValue('2026-09-01')
      await expect(end).toHaveValue('2026-09-05')
      await start.fill('2026-10-01')
      await expect(range.getByRole('status')).toHaveText('开始日期不能晚于结束日期。')
      await expect(start).toHaveValue('2026-10-01')
      await expect(start).toHaveAttribute('aria-invalid', 'true')
      await end.fill('2026-10-03')
      await expect(range.getByRole('status')).toHaveText('已选择日期范围。')
      await start.fill('2025-12-31')
      await expect(range.getByRole('status')).toHaveText('请选择允许范围内的日期。')
      await expect(start).toHaveValue('2025-12-31')
      await expect(ranges.nth(1).locator('input')).toHaveCount(2)
      await expect(ranges.nth(1).locator('input').first()).toBeDisabled()
      await expect(ranges.nth(1).getByRole('button', { name: '清空' })).toBeDisabled()
      expect(await dateRangeFitsWidth(ranges.nth(2))).toBe(true)
      await expect(ranges.nth(2).getByLabel('很长的开始日期说明')).toBeVisible()
      await expect(ranges.last().locator('b')).toHaveCount(0)
      await expect(ranges.last().getByRole('button')).toHaveCount(0)
      await page.screenshot({ path: info.outputPath(`${target}-date-range-validation.png`) })
      const clear = range.getByRole('button', { name: '清空', exact: true })
      await clear.focus()
      await page.keyboard.press('Enter')
      await expect(start).toHaveValue('')
      await expect(end).toHaveValue('')
      await expect(start).toBeFocused()
      await expect(clear).toBeDisabled()
      await expect(range.getByRole('status')).toHaveText('请选择开始和结束日期。')
    })
  })
  test(`${target} date range local values survive equal props, reset on replacement, and stay outside surrounding forms`, async ({
    page
  }) => {
    await withDateRangeModules(
      page,
      target,
      async () => {
        const ranges = page.locator('[data-openpencil-date-range]'),
          range = ranges.first()
        const start = range.getByLabel('Start date', { exact: true }),
          end = range.getByLabel('End date', { exact: true })
        expect(await dateRangeLocalInputOwnership(range)).toBe(true)
        await start.fill('2026-09-01')
        await end.fill('2026-09-04')
        await page.getByRole('button', { name: 'Equal config', exact: true }).click()
        await expect(start).toHaveValue('2026-09-01')
        await expect(ranges.last().getByLabel('开始日期', { exact: true })).toHaveValue('')
        await start.focus()
        await page.keyboard.press('Enter')
        await expect(page.locator('output')).toHaveText('0')
        await start.fill('2025-01-01')
        await expect(range.getByRole('status')).toHaveText('Choose dates within the allowed range.')
        await page.getByRole('button', { name: 'Submit outer form', exact: true }).click()
        await expect(page.locator('output')).toHaveText('1')
        await page.getByRole('button', { name: 'Replace config', exact: true }).click()
        await expect(start).toHaveValue('2026-10-01')
        await expect(end).toHaveValue('2026-10-02')
        await range.getByRole('button', { name: 'Clear', exact: true }).click()
        await expect(start).toBeFocused()
        await expect(start).toHaveValue('')
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await page.getByRole('button', { name: 'Toggle mount', exact: true }).click()
        await expect(start).toHaveValue('2026-10-01')
        await expect(end).toHaveValue('2026-10-02')
        await expect(page.locator('output')).toHaveText('1')
      },
      true
    )
  })
}
