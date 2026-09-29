import { expect, test } from '@playwright/test'

import {
  composedInput,
  nativeFormValue,
  popupFits,
  withAutocomplete
} from '#tests/helpers/compiler/components/autocomplete/browser'

test.use({ viewport: { width: 375, height: 900 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} autocomplete keeps free input, single selection events and existing FORM validation`, async ({
    page
  }) => {
    await withAutocomplete(page, target, false, async () => {
      const input = page.getByRole('combobox', { name: '城市', exact: true })
      await input.fill('北')
      await expect(page.getByRole('option')).toHaveCount(2)
      await expect(
        page.getByText('City[北] Changes[1] Submitted[0]', { exact: true })
      ).toBeVisible()
      await input.press('ArrowDown')
      const active = await input.getAttribute('aria-activedescendant')
      expect(active).toBeTruthy()
      await input.press('Enter')
      await expect(input).toHaveValue('北京 Beijing')
      await expect(
        page.getByText('City[北京 Beijing] Changes[2] Submitted[0]', { exact: true })
      ).toBeVisible()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await input.fill('自由城市')
      await expect(page.getByRole('listbox').getByRole('status')).toHaveText(
        '无匹配建议，可继续输入'
      )
      await input.press('Escape')
      await expect(input).toHaveValue('自由城市')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await input.click()
      await page.getByRole('button', { name: '清空输入' }).click()
      await expect(input).toHaveValue('')
      await input.press('Tab')
      await expect(page.getByText('请输入城市', { exact: true })).toBeVisible()
      await input.fill('任意有效值')
      await input.press('Tab')
      await expect(page.getByText('请输入城市', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('combobox', { name: 'Independent city' })).toHaveValue('自由初值')
      await page.getByRole('combobox', { name: 'Readonly city' }).focus()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(page.getByRole('combobox', { name: 'Disabled city' })).toBeDisabled()
    })
  })
  test(`${target} autocomplete respects IME, Escape, Tab and text-only suggestions`, async ({
    page
  }) => {
    await withAutocomplete(page, target, true, async () => {
      const input = page.getByRole('combobox', { name: 'Runtime city' })
      await input.focus()
      await popupFits(page)
      await composedInput(input, '北')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(page.locator('output')).toContainText('Submit[0]')
      await input.dispatchEvent('compositionend', { data: '北' })
      await expect(page.getByRole('option')).toHaveCount(2)
      await input.press('ArrowDown')
      await input.press('Tab')
      await expect(input).toHaveValue('北')
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await input.fill('示例')
      await expect(page.getByRole('option')).toHaveText('示例 <script>alert(1)</script>')
      await expect(page.locator('[data-op-autocomplete-popup] script')).toHaveCount(0)
      await input.press('Escape')
      await expect(input).toHaveValue('示例')
      await input.fill('no match')
      await input.press('Enter')
      await expect(page.locator('output')).toContainText('Submit[1]')
      await expect(input).toHaveValue('no match')
    })
  })
  test(`${target} autocomplete reacts to props, resets without writes and removes portals on unmount`, async ({
    page
  }) => {
    await withAutocomplete(page, target, true, async () => {
      const input = page.getByRole('combobox', { name: 'Runtime city' }),
        free = page.getByRole('combobox', { name: 'Free city' })
      await input.fill('北')
      await input.press('ArrowDown')
      await input.press('Enter')
      await expect(page.locator('output')).toContainText('Changes[2]')
      expect(await nativeFormValue(input, 'city')).toEqual(['北京 Beijing'])
      await page.getByRole('button', { name: 'External', exact: true }).click()
      await expect(input).toHaveValue('外部值')
      const before = await page.locator('output').textContent()
      await input.evaluate((element) => {
        if (element instanceof HTMLInputElement) element.form?.reset()
      })
      await expect(input).toHaveValue('外部值')
      await expect(page.locator('output')).toHaveText(before ?? '')
      await free.fill('自行输入')
      await free.press('Tab')
      const resetFree = page.getByRole('button', { name: 'Reset free' })
      await expect(resetFree).toBeFocused()
      await resetFree.press('Enter')
      await expect(free).toHaveValue('自由初值')
      expect(await nativeFormValue(free, 'free')).toEqual(['自由初值'])
      await expect(input).toHaveValue('外部值')
      await page.getByRole('button', { name: 'Readonly', exact: true }).click()
      await input.focus()
      await expect(page.getByRole('listbox')).toHaveCount(0)
      await expect(input).toHaveAttribute('readonly', '')
      await page.getByRole('button', { name: 'Readonly', exact: true }).click()
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(input).toBeDisabled()
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await page.getByRole('button', { name: 'Replace', exact: true }).click()
      await input.fill('')
      await expect(page.getByRole('option')).toHaveText('全新建议')
      await input.press('Escape')
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(page.locator('[data-op-autocomplete-popup]')).toHaveCount(0)
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await input.focus()
      await expect(page.getByRole('option')).toHaveText('全新建议')
      await input.press('Escape')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await input.fill('unmatched')
      await expect(page.getByRole('listbox').getByRole('status')).toHaveText(
        'No suggestions. Keep typing your own value.'
      )
      await popupFits(page)
    })
  })
}
