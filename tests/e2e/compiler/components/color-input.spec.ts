import { expect, test } from '@playwright/test'

import { chooseColor, withColorInputs } from '#tests/helpers/compiler/components/color/browser'

test.use({ viewport: { width: 375, height: 1000 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} color picker preserves page/doc bindings and controlled FORM validation`, async ({
    page
  }) => {
    await withColorInputs(page, target, false, async () => {
      const primary = page.getByRole('textbox', { name: 'Primary color', exact: true }),
        picker = page.getByLabel('Choose color: Primary color', { exact: true })
      await expect(primary).toHaveValue('#2563eb')
      await chooseColor(picker, '#aabbcc')
      await expect(primary).toHaveValue('#aabbcc')
      await chooseColor(page.getByLabel('Choose color: Document color', { exact: true }), '#ccddff')
      await expect(
        page.getByText('Color[#aabbcc] Doc[#ccddff] Submitted[0]', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Empty color', exact: true }).click()
      await expect(primary).toHaveValue('')
      await expect(picker).toHaveValue('#000000')
      await page.getByRole('button', { name: 'Submit colors', exact: true }).click()
      await expect(page.getByText('Choose a color', { exact: true })).toBeVisible()
      await expect(
        page.getByText('Color[] Doc[#ccddff] Submitted[0]', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Invalid color', exact: true }).click()
      await expect(primary).toHaveValue('not-a-color')
      // Programmatic submit exercises business validation independently of native chooser validity.
      await page
        .locator('form')
        .evaluate((form) =>
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        )
      await expect(page.getByText('Use six hex digits', { exact: true })).toBeVisible()
      await expect(
        page.getByText('Color[not-a-color] Doc[#ccddff] Submitted[0]', { exact: true })
      ).toBeVisible()
      await chooseColor(picker, '#123456')
      await page.getByRole('button', { name: 'Submit colors', exact: true }).click()
      await expect(
        page.getByText('Color[#123456] Doc[#ccddff] Submitted[1]', { exact: true })
      ).toBeVisible()
    })
  })
  test(`${target} color picker does not fabricate empty/invalid values or duplicate native changes`, async ({
    page
  }) => {
    await withColorInputs(page, target, true, async () => {
      const input = page.getByRole('textbox', { name: 'Primary', exact: true }),
        picker = page.getByLabel('Choose color: Primary', { exact: true }),
        output = page.locator('output')
      await expect(input).not.toHaveAttribute('readonly', '')
      await expect(picker).not.toHaveAttribute('name')
      await picker.focus()
      await expect(page.locator('[data-color-swatch]').filter({ has: picker })).toHaveCSS(
        'outline-style',
        'solid'
      )
      await chooseColor(picker, '#aabbcc')
      await expect(output).toHaveText('Value[#aabbcc] Changes[1] Submit[0]')
      await expect(page.getByRole('textbox', { name: 'Other', exact: true })).toHaveValue('#abcdef')
      await page.getByRole('button', { name: 'Empty', exact: true }).click()
      await expect(input).toHaveValue('')
      await expect(picker).toHaveValue('#000000')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(output).toHaveText('Value[] Changes[1] Submit[0]')
      expect(await picker.evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false)
      await page.getByRole('button', { name: 'Invalid', exact: true }).click()
      await expect(input).toHaveValue('not-a-color')
      await expect(output).toHaveText('Value[not-a-color] Changes[1] Submit[0]')
      expect(
        await page
          .locator('form')
          .evaluate((form: HTMLFormElement) => Object.fromEntries(new FormData(form)))
      ).toEqual({
        primary: 'not-a-color',
        other: '#abcdef',
        readonly: '#112233',
        external: '#445566'
      })
      // Keyboard input can explicitly select fallback black even if an OS popup
      // does not emit events when confirming its unchanged default.
      await input.fill('#000000')
      await expect(output).toHaveText('Value[#000000] Changes[2] Submit[0]')
      await page.getByRole('button', { name: 'Submit', exact: true }).click()
      await expect(output).toContainText('Submit[1]')
    })
  })
  test(`${target} color lifecycle retains readonly submission, disables edits and refreshes reset and locale`, async ({
    page
  }) => {
    await withColorInputs(page, target, true, async () => {
      const input = page.getByRole('textbox', { name: 'Primary', exact: true }),
        picker = page.getByLabel('Choose color: Primary', { exact: true }),
        other = page.getByRole('textbox', { name: 'Other', exact: true })
      await chooseColor(page.getByLabel('Choose color: Other', { exact: true }), '#eeeeee')
      await page.getByRole('button', { name: 'External', exact: true }).click()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveValue('#123456')
      expect(
        await page
          .getByLabel('Choose color: Detached', { exact: true })
          .evaluate((e: HTMLInputElement) => e.form)
      ).toBeNull()
      expect(
        await page
          .getByLabel('Choose color: External form color', { exact: true })
          .evaluate((e: HTMLInputElement) => e.form?.id)
      ).toBe('colors')
      await expect(other).toHaveValue('#abcdef')
      await expect(page.getByLabel('Choose color: Other', { exact: true })).toHaveValue('#abcdef')
      await expect(page.locator('output')).toHaveText('Value[#123456] Changes[0] Submit[0]')
      await page.getByRole('button', { name: 'Readonly', exact: true }).click()
      await expect(picker).toBeDisabled()
      await expect(input).toHaveAttribute('readonly', '')
      await chooseColor(picker, '#ffffff')
      await expect(input).toHaveValue('#123456')
      expect(
        await page
          .locator('form')
          .evaluate((form: HTMLFormElement) => new FormData(form).get('primary'))
      ).toBe('#123456')
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(input).toBeDisabled()
      expect(
        await page
          .locator('form')
          .evaluate((form: HTMLFormElement) => new FormData(form).has('primary'))
      ).toBe(false)
      const stale = await picker.elementHandle()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(input).toHaveCount(0)
      await stale?.evaluate((e: HTMLInputElement) => {
        e.value = '#111111'
        e.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(input).toHaveValue('#123456')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(page.getByLabel('选择颜色: Other', { exact: true })).toHaveCount(1)
      expect(await page.locator('body').evaluate((e) => e.scrollWidth <= 375)).toBe(true)
    })
  })
}
