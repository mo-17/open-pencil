import { writeFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { withFormFeedback } from '#tests/helpers/compiler/components/form-validation/browser'

for (const scenario of ['react', 'vue', 'react-shadcn'] as const) {
  const target = scenario === 'vue' ? 'vue' : 'react'
  test(`${scenario} invalid submission focuses an editable field and group blur reports errors`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    await withFormFeedback(
      page,
      target,
      async () => {
        const quantity = page.getByRole('textbox', { name: 'Quantity', exact: true })
        const choice = page.getByRole('radiogroup', { name: 'Choice', exact: true })
        const alpha = choice.getByRole('radio', { name: 'Alpha', exact: true })
        const tags = page.getByRole('group', { name: 'Tags', exact: true })
        const city = page.getByRole('combobox', { name: 'City', exact: true })
        const submit = page.getByRole('button', { name: 'Submit feedback', exact: true })
        await expect(quantity).toHaveAttribute('aria-required', 'true')
        await expect(choice).toHaveAttribute('aria-required', 'true')
        await expect(city).toHaveAttribute('aria-required', 'true')
        await expect(page.getByRole('textbox', { name: 'Disabled value' })).toBeDisabled()
        await expect(page.getByRole('textbox', { name: 'Read only value' })).toHaveAttribute(
          'readonly',
          ''
        )

        await alpha.focus()
        await page.keyboard.press('Tab')
        await expect(choice).toHaveAttribute('aria-invalid', 'true')
        await expect(page.getByText('Choice required', { exact: true })).toBeVisible()
        await expect(page.getByText('Submitted[0] Blur[choice]', { exact: true })).toBeVisible()
        await tags.getByRole('checkbox', { name: 'One', exact: true }).focus()
        await page.keyboard.press('Tab')
        await expect(tags).toHaveAttribute('aria-invalid', 'true')

        await submit.click()
        await expect(quantity).toBeFocused()
        await expect(
          page.getByText('Quantity must be a number from 1 to 10', { exact: true })
        ).toBeVisible()
        await expect(quantity).toHaveAccessibleDescription('Quantity must be a number from 1 to 10')
        await expect(page.getByText('Submitted[0] Blur[choice]', { exact: true })).toBeVisible()
        await quantity.fill('2')
        await submit.click()
        await expect(alpha).toBeFocused()
        await alpha.check()
        await expect(choice).toHaveAttribute('aria-invalid', 'false')
        await submit.click()
        const firstTag = tags.getByRole('checkbox', { name: 'One', exact: true })
        try {
          await expect(firstTag).toBeFocused()
        } catch (error) {
          const diagnosticPath = test.info().outputPath(`${scenario}-invalid-focus.json`)
          await writeFile(
            diagnosticPath,
            JSON.stringify(
              await page.evaluate(() => ({
                activeElement: document.activeElement?.outerHTML,
                form: document.querySelector('form')?.outerHTML,
                fields: Array.from(
                  document.querySelectorAll<HTMLElement>('[data-openpencil-validation-field-key]')
                ).map((field) => ({
                  label: field.getAttribute('aria-label'),
                  invalid: field.getAttribute('aria-invalid'),
                  inputs: Array.from(field.querySelectorAll('input')).map((input) => ({
                    value: input.value,
                    checked: input.checked,
                    focused: input.matches(':focus')
                  }))
                }))
              })),
              null,
              2
            )
          )
          await test.info().attach(`${scenario}-invalid-focus`, {
            contentType: 'application/json',
            path: diagnosticPath
          })
          throw error
        }
        await firstTag.check()
        await expect(tags).toHaveAttribute('aria-invalid', 'false')
        await submit.click()
        await expect(city).toBeFocused()
        await expect(city).toHaveAccessibleDescription('City required')
        await city.click()
        await page.getByRole('option', { name: 'Xiamen', exact: true }).click()
        await submit.click()
        await expect(page.getByText('Submitted[1] Blur[choice]', { exact: true })).toBeVisible()
        await expect(submit).toBeFocused()
        await page.screenshot({
          path: test.info().outputPath(`${scenario}-form-feedback.png`),
          fullPage: true
        })
      },
      scenario === 'react-shadcn'
    )
  })
}

for (const returnBeforeResponse of [false, true]) {
  test(`React stale remote validation does not steal focus after a panel switch (return: ${returnBeforeResponse})`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    const { withModuleForm } =
      await import('#tests/helpers/compiler/components/form-module/browser')
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let requested = false
    await page.route('https://validation.example.test/check*', async (route) => {
      requested = true
      await pending
      await route.fulfill({ json: { valid: false, message: 'The old panel is invalid' } })
    })
    try {
      await withModuleForm(
        page,
        'react',
        async () => {
          await page.getByPlaceholder('first field').fill('pending value')
          await page.getByRole('button', { name: 'Submit outer', exact: true }).click()
          await expect.poll(() => requested).toBe(true)
          const tab = page.getByRole('tab', {
            name: returnBeforeResponse ? 'First panel' : 'Second panel'
          })
          await page.getByRole('tab', { name: 'Second panel' }).click()
          if (returnBeforeResponse) await tab.click()
          await expect(tab).toBeFocused()
          const response = page.waitForResponse('https://validation.example.test/check*')
          release?.()
          await response
          await expect(
            page.getByText('The old panel is invalid', { exact: true }).first()
          ).toHaveCount(returnBeforeResponse ? 1 : 0)
          await expect(tab).toBeFocused()
          await expect(page.getByText('Outer 0; Nested 0; Normal 0', { exact: true })).toBeVisible()
        },
        true
      )
    } finally {
      release?.()
    }
  })
}
