import { expect, test } from '@playwright/test'

import {
  dateTimeValidity,
  withDateTimeInputs
} from '#tests/helpers/compiler/components/date-time/browser'

test.use({ viewport: { width: 375, height: 850 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} datetime preserves civil string state across leap dates, validates and submits FORM`, async ({
    page
  }, info) => {
    await withDateTimeInputs(page, target, async () => {
      const input = page.getByLabel('预约日期时间', { exact: true })
      const documentTime = page.getByLabel('Document time', { exact: true })
      const status = (value: string, submits: number) =>
        page.getByText(`DateTime[${value}] Doc[2028-03-01T20:45] Submitted[${submits}]`, {
          exact: true
        })
      await expect(input).toHaveAttribute('type', 'datetime-local')
      await expect(input).toHaveValue('2028-02-29T09:30:15')
      await documentTime.fill('2028-03-01T20:45')
      await input.fill('2028-03-01T10:15:30')
      await expect(status('2028-03-01T10:15:30', 0)).toBeVisible()
      await expect(page.getByLabel('Uncontrolled time', { exact: true })).toHaveValue(
        '2028-02-29T12:00'
      )
      await input.fill('2028-02-28T23:59:45')
      expect((await dateTimeValidity(input)).rangeUnderflow).toBe(true)
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(status('2028-02-28T23:59:45', 0)).toBeVisible()
      await input.fill('2028-03-01T18:00:15')
      expect((await dateTimeValidity(input)).rangeOverflow).toBe(true)
      await input.fill('2028-02-29T09:30:01')
      expect((await dateTimeValidity(input)).stepMismatch).toBe(true)
      await page.getByRole('button', { name: 'Clear time', exact: true }).click()
      await expect(input).toHaveValue('')
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('请选择预约日期时间')
      await expect(status('', 0)).toBeVisible()
      await input.fill('2028-02-29T09:45:30')
      await input.press('Tab')
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(status('2028-02-29T09:45:30', 1)).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await input.fill('')
      await expect(status('', 1)).toBeVisible()
      await page.screenshot({
        path: info.outputPath(`${target}-datetime-fields.png`),
        fullPage: true
      })
    })
  })
  test(`${target} datetime respects readonly, disabled and keyboard focus without shifting local values`, async ({
    page
  }) => {
    await withDateTimeInputs(page, target, async () => {
      const readonly = page.getByLabel('Read only time', { exact: true })
      const disabled = page.getByLabel('Disabled time', { exact: true })
      await expect(readonly).not.toBeEditable()
      await expect(readonly).toHaveValue('2028-02-29T10:00')
      await expect(disabled).toBeDisabled()
      const input = page.getByLabel('预约日期时间', { exact: true })
      await input.focus()
      await input.press('ArrowRight')
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('2028-02-29T09:30:15')
      await expect(disabled).toHaveValue('2028-02-29T11:00')
    })
  })
}
