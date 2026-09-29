import { expect, test } from '@playwright/test'

import { timeValidity, withTimeInputs } from '#tests/helpers/compiler/components/time/browser'

test.use({ viewport: { width: 375, height: 850 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} native time keeps string page/document state, clears, validates and submits its FORM`, async ({
    page
  }, info) => {
    await withTimeInputs(page, target, async () => {
      const input = page.getByLabel('预约时间', { exact: true }),
        documentTime = page.getByLabel('Document time', { exact: true })
      const submitted = (count: number) => page.getByText(new RegExp(`Submitted\\[${count}\\]`))
      await expect(input).toHaveAttribute('type', 'time')
      await expect(input).toHaveValue('09:30:15')
      await expect(documentTime).toHaveValue('21:00')
      await input.fill('10:15:30')
      await documentTime.fill('20:45')
      await expect(
        page.getByText('Time[10:15:30] Doc[20:45] Submitted[0]', { exact: true })
      ).toBeVisible()
      await expect(page.getByLabel('Uncontrolled time', { exact: true })).toHaveValue('12:00')
      await input.fill('07:59:45')
      expect((await timeValidity(input)).rangeUnderflow).toBe(true)
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(submitted(0)).toBeVisible()
      await input.fill('18:00:15')
      expect((await timeValidity(input)).rangeOverflow).toBe(true)
      await input.fill('09:30:01')
      expect((await timeValidity(input)).stepMismatch).toBe(true)
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(submitted(0)).toBeVisible()
      await page.getByRole('button', { name: 'Clear time', exact: true }).click()
      await expect(input).toHaveValue('')
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(submitted(0)).toBeVisible()
      await expect(page.getByRole('alert')).toContainText('请选择预约时间')
      await input.fill('09:45:30')
      await input.press('Tab')
      await page.getByRole('button', { name: 'Submit time', exact: true }).click()
      await expect(submitted(1)).toBeVisible()
      await expect(page.getByRole('alert')).toHaveCount(0)
      await input.fill('')
      await expect(page.getByText('Time[] Doc[20:45] Submitted[1]', { exact: true })).toBeVisible()
      await page.screenshot({ path: info.outputPath(`${target}-time-fields.png`), fullPage: true })
    })
  })
  test(`${target} time honors periodic overnight bounds, keyboard focus, readonly and disabled state`, async ({
    page
  }) => {
    await withTimeInputs(page, target, async () => {
      const night = page.getByLabel('Night shift', { exact: true }),
        readonly = page.getByLabel('Read only time', { exact: true }),
        disabled = page.getByLabel('Disabled time', { exact: true })
      await expect(readonly).toHaveAttribute('readonly', '')
      await expect(readonly).not.toBeEditable()
      await expect(readonly).toHaveValue('10:00')
      await expect(disabled).toBeDisabled()
      await expect(disabled).toHaveValue('11:00')
      await night.focus()
      await expect(night).toBeFocused()
      await night.press('ArrowRight')
      await expect(night).toBeFocused()
      for (const value of ['23:00', '00:30', '22:00', '02:00']) {
        await night.fill(value)
        expect((await timeValidity(night)).valid).toBe(true)
      }
      await night.fill('12:00')
      expect((await timeValidity(night)).valid).toBe(false)
      await expect(readonly).toHaveValue('10:00')
      await expect(disabled).toHaveValue('11:00')
    })
  })
}
