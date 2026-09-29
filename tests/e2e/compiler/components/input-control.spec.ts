import { expect, test } from '@playwright/test'

import { withInputControl } from '#tests/helpers/compiler/components/input-control/browser'

test.use({ viewport: { width: 375, height: 1000 } })
for (const target of ['react', 'vue'] as const) {
  test(`${target} enhanced fields preserve authored focus, disabled and placeholder styles`, async ({
    page
  }) => {
    await withInputControl(page, target, async () => {
      const input = page.getByLabel('Styled password', { exact: true })
      const control = page.locator('[data-op-input-control]').filter({ has: input })
      await expect(control).toHaveCSS('background-color', 'rgb(255, 255, 255)')
      expect(
        await input.evaluate((element) => getComputedStyle(element, '::placeholder').color)
      ).toBe('rgb(18, 52, 86)')
      await input.focus()
      await expect(control).toHaveCSS('background-color', 'rgb(51, 102, 153)')
      await expect(input).toHaveCSS('outline-style', 'none')
      await expect(control).toHaveCSS('outline-style', 'solid')
      await expect(control).toHaveCSS('outline-width', '2px')
      await control.getByRole('button', { name: '显示密码' }).focus()
      await expect(control).toHaveCSS('background-color', 'rgb(51, 102, 153)')
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(input).toBeDisabled()
      await expect(control).toHaveCSS('opacity', '0.35')
      await expect(control).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    })
  })
  test(`${target} number steps natively without duplicate writes and preserves empty input`, async ({
    page
  }) => {
    await withInputControl(page, target, async () => {
      const input = page.getByRole('spinbutton', { name: 'Quantity', exact: true }),
        control = page.locator('[data-op-input-control]').filter({ has: input }),
        up = control.getByRole('button', { name: '增加数值' }),
        down = control.getByRole('button', { name: '减少数值' })
      await expect(input).toHaveValue('0.2')
      const nodeBoundary = page.locator('[data-node-id="quantity-node"]')
      await expect(nodeBoundary).toHaveCount(1)
      await expect(input).not.toHaveAttribute('data-node-id')
      const nodeBox = await nodeBoundary.boundingBox(),
        inputBox = await input.boundingBox()
      expect(nodeBox?.width).toBe(320)
      expect(nodeBox?.height).toBe(44)
      expect(nodeBox?.width ?? 0).toBeGreaterThan(inputBox?.width ?? 0)
      expect(
        await up.evaluate((element) =>
          element.closest('[data-node-id]')?.getAttribute('data-node-id')
        )
      ).toBe('quantity-node')
      await expect(input).toHaveAttribute('id', 'quantity')
      await expect(input).toHaveAttribute('name', 'quantity')
      await input.evaluate((element) => {
        element.setAttribute('data-input-count', '0')
        element.setAttribute('data-change-count', '0')
        for (const name of ['input', 'change'])
          element.addEventListener(name, () => {
            const attribute = `data-${name}-count`
            element.setAttribute(attribute, String(Number(element.getAttribute(attribute)) + 1))
          })
      })
      await up.click()
      await expect(input).toHaveValue('0.3')
      await expect(input).toHaveAttribute('data-input-count', '1')
      await expect(input).toHaveAttribute('data-change-count', '1')
      await expect(page.locator('output')).toHaveText(
        'Value[0.3] Changes[1] Password changes[0] Submit[0]'
      )
      await up.focus()
      await up.press('Enter')
      await expect(input).toHaveValue('0.4')
      await up.click()
      await expect(page.locator('output')).toContainText('Changes[2]')
      await down.click()
      await expect(input).toHaveValue('0.3')
      await input.fill('')
      await input.press('Tab')
      await expect(input).toHaveValue('')
      await page.getByRole('button', { name: 'Placement', exact: true }).click()
      await expect(input).toHaveValue('')
      await expect(control.locator('[data-input-actions=start]')).toHaveCount(1)
      await expect(control.locator('[data-input-actions=finish]')).toHaveCount(1)
      await up.click()
      await expect(input).toHaveValue('0.1')
      await page.getByRole('button', { name: 'Controls', exact: true }).click()
      await expect(control.getByRole('button')).toHaveCount(0)
      await input.press('ArrowUp')
      await expect(input).toHaveValue('0.2')
      await page.getByRole('button', { name: 'Controls', exact: true }).click()
      await page.getByRole('button', { name: 'Step any', exact: true }).click()
      await expect(up).toBeDisabled()
      await expect(down).toBeDisabled()
      await input.fill('0.333')
      expect(await input.evaluate((element) => (element as HTMLInputElement).validity.valid)).toBe(
        true
      )
      await expect(page.locator('output')).toContainText('Submit[0]')
    })
  })
  test(`${target} input controls preserve reset, readonly, disabled and native form ownership`, async ({
    page
  }) => {
    await withInputControl(page, target, async () => {
      const input = page.getByRole('spinbutton', { name: 'Quantity', exact: true }),
        free = page.getByRole('spinbutton', { name: 'Free number' }),
        control = page.locator('[data-op-input-control]').filter({ has: input })
      await page.getByRole('button', { name: 'External', exact: true }).click()
      await expect(input).toHaveValue('0.1')
      await free.fill('2.5')
      const before = await page.locator('output').textContent()
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveValue('0.1')
      await expect(free).toHaveValue('1.5')
      await expect(page.locator('output')).toHaveText(before ?? '')
      // Repeated native resets preserve the current controlled value, not an empty default.
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveValue('0.1')
      await expect(page.getByLabel('Password', { exact: true })).toHaveValue('初始密码')
      await expect(page.locator('output')).toHaveText(before ?? '')
      expect(
        await input.evaluate((element) => {
          const input = element as HTMLInputElement
          return input.form ? [...new FormData(input.form).entries()] : []
        })
      ).toEqual([
        ['quantity', '0.1'],
        ['password', '初始密码'],
        ['free', '1.5'],
        ['other', 'second']
      ])
      await page.getByRole('button', { name: 'Readonly', exact: true }).click()
      await expect(input).toHaveAttribute('readonly', '')
      for (const button of await control.getByRole('button').all())
        await expect(button).toBeDisabled()
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(input).toBeDisabled()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(input).toHaveCount(0)
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(input).toHaveValue('0.1')
      await expect(page.locator('output')).toHaveText(before ?? '')
      expect(await page.locator('body').evaluate((element) => element.scrollWidth <= 375)).toBe(
        true
      )
      const box = await control.boundingBox()
      expect(box?.width).toBeLessThanOrEqual(351)
    })
  })
  test(`${target} password reveal is local, accessible and never writes values or submits`, async ({
    page
  }) => {
    await withInputControl(page, target, async () => {
      const input = page.getByLabel('Password', { exact: true }),
        other = page.getByLabel('Other password'),
        control = page.locator('[data-op-input-control]').filter({ has: input })
      await expect(input).toHaveAttribute('type', 'password')
      const before = await page.locator('output').textContent()
      const toggle = control.getByRole('button', { name: '显示密码' })
      await toggle.focus()
      await toggle.press('Space')
      await expect(input).toHaveAttribute('type', 'text')
      await expect(control.getByRole('button', { name: '隐藏密码' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(other).toHaveAttribute('type', 'password')
      await expect(page.locator('output')).toHaveText(before ?? '')
      await page.getByRole('button', { name: 'Type', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'password')
      await page.getByRole('button', { name: 'Readonly', exact: true }).click()
      await control.getByRole('button', { name: '显示密码' }).click()
      await expect(input).toHaveAttribute('type', 'text')
      await expect(input).toHaveAttribute('readonly', '')
      await input.evaluate((element) => {
        const field = element as HTMLInputElement
        field.form?.addEventListener('reset', (event) => event.preventDefault(), { once: true })
      })
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'text')
      await expect(input).toHaveValue('初始密码')
      await page.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'password')
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(control.getByRole('button', { name: 'Show password' })).toBeVisible()
      const otherControl = page.locator('[data-op-input-control]').filter({ has: other })
      await expect(otherControl.getByRole('button', { name: 'Show password' })).toBeVisible()
      const freeControl = page.locator('[data-op-input-control]').filter({
        has: page.getByRole('spinbutton', { name: 'Free number' })
      })
      await expect(freeControl.getByRole('button', { name: 'Increase value' })).toBeVisible()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await expect(otherControl.getByRole('button', { name: '显示密码' })).toBeVisible()
      await page.getByRole('button', { name: 'Language', exact: true }).click()
      await page.getByRole('button', { name: 'Disabled', exact: true }).click()
      await expect(control.getByRole('button')).toBeDisabled()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await page.getByRole('button', { name: 'Mount', exact: true }).click()
      await expect(input).toHaveAttribute('type', 'password')
      await expect(page.locator('output')).toHaveText(before ?? '')
    })
  })
}
