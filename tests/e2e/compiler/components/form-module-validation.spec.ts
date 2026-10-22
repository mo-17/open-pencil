import { expect, test } from '@playwright/test'

import { withModuleForm } from '#tests/helpers/compiler/components/form-module/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} module form validates mounted owned fields and retains ordinary required validation`, async ({
    page
  }) => {
    test.setTimeout(90000)
    await withModuleForm(page, target, async () => {
      const counts = (outer: number, nested = 0, normal = 0) =>
        page.getByText(`Outer ${outer}; Nested ${nested}; Normal ${normal}`, { exact: true })
      const submit = page.getByRole('button', { name: 'Submit outer', exact: true })
      await expect(counts(0)).toBeVisible()
      await expect(page.getByPlaceholder('discarded field')).toHaveCount(0)
      await submit.click()
      await expect(page.getByText('first required', { exact: true }).first()).toBeVisible()
      await expect(counts(0)).toBeVisible()
      await page.getByPlaceholder('first field').fill('first value')
      await submit.click()
      await expect(counts(1)).toBeVisible()
      await page.getByRole('tab', { name: 'Second panel' }).click()
      await expect(page.getByPlaceholder('first field')).toHaveCount(0)
      await submit.click()
      await expect(page.getByText('second required', { exact: true }).first()).toBeVisible()
      await expect(counts(1)).toBeVisible()
      await page.getByPlaceholder('second field').fill('second value')
      await submit.click()
      await expect(counts(2)).toBeVisible()
      await page.getByPlaceholder('second field').fill('')
      await submit.click()
      await expect(page.getByRole('listitem').filter({ hasText: 'second required' })).toBeVisible()
      await page.getByRole('tab', { name: 'First panel' }).click()
      await expect(page.getByText('second required', { exact: true })).toHaveCount(0)
      await submit.click()
      await expect(counts(3)).toBeVisible()

      await page.getByRole('button', { name: 'Open nested form', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Nested dialog' })
      await expect(dialog.getByPlaceholder('portal field')).toBeVisible()
      await dialog.getByRole('button', { name: 'Submit nested', exact: true }).click()
      await expect(dialog.getByText('nested required', { exact: true })).toBeVisible()
      await expect(counts(3)).toBeVisible()
      await dialog.getByPlaceholder('nested field').fill('nested value')
      await dialog.getByRole('button', { name: 'Submit nested', exact: true }).click()
      await expect(counts(3, 1)).toBeVisible()
      await page.keyboard.press('Escape')
      await submit.click()
      await expect(counts(4, 1)).toBeVisible()

      const ordinary = page.getByPlaceholder('normal field')
      await expect(ordinary).not.toHaveAttribute('data-openpencil-validation-key')
      await page.getByRole('button', { name: 'Submit normal', exact: true }).click()
      await expect(page.getByText('normal required', { exact: true })).toBeVisible()
      await expect(counts(4, 1)).toBeVisible()
      await ordinary.fill('normal value')
      await page.getByRole('button', { name: 'Submit normal', exact: true }).click()
      await expect(counts(4, 1, 1)).toBeVisible()
    })
  })
}

test('React shadcn native select fallback and projected option groups remain required in their current form', async ({
  page
}) => {
  test.setTimeout(90000)
  page.setDefaultTimeout(10000)
  await withModuleForm(
    page,
    'react',
    async () => {
      const submit = page.getByRole('button', { name: 'Submit outer', exact: true })
      const count = (value: number) =>
        page.getByText(`Outer ${value}; Nested 0; Normal 0`, { exact: true })
      const select = page.getByRole('combobox')
      expect(await select.evaluate((element) => element.tagName)).toBe('SELECT')
      await expect(select).toHaveAttribute('data-openpencil-validation-key')
      await submit.click()
      await expect(page.getByText('first required', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('choices required', { exact: true }).first()).toBeVisible()
      await expect(count(0)).toBeVisible()
      await test.step('Select the native option One', () => select.selectOption('One'))
      await expect(select).toHaveValue('One')
      await test.step('Check the projected Accept option', () =>
        page.getByRole('checkbox', { name: 'Accept', exact: true }).check())
      await submit.click()
      await expect(count(1)).toBeVisible()
      await page.getByRole('tab', { name: 'Second panel' }).click()
      await expect(page.getByRole('radiogroup')).toHaveAttribute('data-openpencil-validation-key')
      await submit.click()
      await expect(page.getByText('second required', { exact: true }).first()).toBeVisible()
      await expect(count(1)).toBeVisible()
      await test.step('Check the projected Two radio option', () =>
        page.getByRole('radio', { name: 'Two', exact: true }).check())
      await submit.click()
      await expect(count(2)).toBeVisible()
    },
    false,
    true
  )
})

test('React real Radix select supports keyboard and pointer selection with mounted FORM validation', async ({
  page
}) => {
  test.setTimeout(90000)
  page.setDefaultTimeout(10000)
  await withModuleForm(
    page,
    'react',
    async () => {
      const select = page.getByRole('combobox'),
        submit = page.getByRole('button', { name: 'Submit outer', exact: true }),
        count = (value: number) =>
          page.getByText(`Outer ${value}; Nested 0; Normal 0`, { exact: true })
      expect(await select.evaluate((element) => element.tagName)).toBe('BUTTON')
      await expect(select).toHaveAttribute('aria-expanded', 'false')
      await expect(select).toHaveAttribute('data-state', 'closed')
      await expect(select).toHaveAttribute('data-openpencil-validation-key')
      await submit.click()
      await expect(page.getByText('first required', { exact: true }).first()).toBeVisible()
      await expect(page.getByText('choices required', { exact: true }).first()).toBeVisible()
      await expect(count(0)).toBeVisible()

      await select.focus()
      await page.keyboard.press('ArrowDown')
      const list = page.getByRole('listbox')
      await expect(list).toBeVisible()
      // Radix hides the trigger from the accessibility tree while its modal listbox is open.
      const openTrigger = page.locator('button[role="combobox"]')
      await expect(openTrigger).toHaveAttribute('data-state', 'open')
      await expect(openTrigger).toHaveAttribute('aria-expanded', 'true')
      const popupId = await list.getAttribute('id')
      expect(popupId).toBeTruthy()
      if (!popupId) throw new Error('The accessible Radix listbox requires an id')
      await expect(openTrigger).toHaveAttribute('aria-controls', popupId)
      await expect(list.locator('[data-radix-collection-item]')).toHaveCount(2)
      await expect(list.getByRole('option', { name: 'One', exact: true })).toBeFocused()
      await page.keyboard.press('End')
      // Radix defers keyboard focus changes until after the key event.
      await expect(list.getByRole('option', { name: 'Two', exact: true })).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(select).toHaveText('Two')
      await expect(select).toBeFocused()
      await test.step('Check the projected Accept option', () =>
        page.getByRole('checkbox', { name: 'Accept', exact: true }).check())
      await submit.click()
      await expect(count(1)).toBeVisible()

      await select.click()
      await page.getByRole('option', { name: 'One', exact: true }).click()
      await expect(select).toHaveText('One')
      await expect(list).toHaveCount(0)
      await submit.click()
      await expect(count(2)).toBeVisible()
      await page.getByRole('tab', { name: 'Second panel' }).click()
      await submit.click()
      await expect(page.getByText('second required', { exact: true }).first()).toBeVisible()
      await expect(count(2)).toBeVisible()
      await test.step('Check the projected Two radio option', () =>
        page.getByRole('radio', { name: 'Two', exact: true }).check())
      await submit.click()
      await expect(count(3)).toBeVisible()
    },
    false,
    true,
    true
  )
})

for (const returnBeforeResponse of [false, true]) {
  test(`React discards delayed validation after switching panels (returns before response: ${returnBeforeResponse})`, async ({
    page
  }) => {
    test.setTimeout(90000)
    let releaseValidation: (() => void) | undefined
    const pendingValidation = new Promise<void>((resolve) => {
      releaseValidation = resolve
    })
    let requested = false
    let hold = true
    await page.route('https://validation.example.test/check*', async (route) => {
      requested = true
      if (hold) await pendingValidation
      await route.fulfill({ json: { valid: true } })
    })
    try {
      await withModuleForm(
        page,
        'react',
        async () => {
          await page.getByPlaceholder('first field').fill('validated value')
          await page.getByRole('button', { name: 'Submit outer', exact: true }).click()
          await expect.poll(() => requested).toBe(true)
          await page.getByRole('tab', { name: 'Second panel' }).click()
          if (returnBeforeResponse) await page.getByRole('tab', { name: 'First panel' }).click()
          hold = false
          const completedValidation = page.waitForResponse('https://validation.example.test/check*')
          releaseValidation?.()
          await completedValidation
          await page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              })
          )
          await expect(page.getByText('Outer 0; Nested 0; Normal 0', { exact: true })).toBeVisible()
          if (!returnBeforeResponse) await page.getByRole('tab', { name: 'First panel' }).click()
          await page.getByRole('button', { name: 'Submit outer', exact: true }).click()
          await expect(page.getByText('Outer 1; Nested 0; Normal 0', { exact: true })).toBeVisible()
        },
        true
      )
    } finally {
      releaseValidation?.()
      await page.unrouteAll({ behavior: 'wait' })
    }
  })
}
