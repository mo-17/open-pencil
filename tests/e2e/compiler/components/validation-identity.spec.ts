import { expect, test } from '@playwright/test'

import { withValidationIdentity } from '#tests/helpers/compiler/components/form-validation/browser'

for (const scenario of ['react', 'vue', 'react-shadcn'] as const) {
  test(`${scenario} repeated fields and component instances describe their own unique errors`, async ({
    page
  }) => {
    test.setTimeout(90_000)
    const target = scenario === 'vue' ? 'vue' : 'react'
    await withValidationIdentity(
      page,
      target,
      async () => {
        const repeated = page.getByRole('textbox', { name: 'Repeated value', exact: true })
        await expect(repeated).toHaveCount(4)
        await page.getByRole('button', { name: 'Validate repeated fields', exact: true }).click()
        await expect(repeated.first()).toBeFocused()
        const instances = page.getByRole('textbox', { name: 'Instance value', exact: true })
        await expect(instances).toHaveCount(2)
        const submit = page.getByRole('button', { name: 'Validate instance', exact: true })
        for (let index = 0; index < 2; index++) {
          await submit.nth(index).click()
          await expect(instances.nth(index)).toBeFocused()
        }
        const fields = page.getByRole('textbox')
        await expect(fields).toHaveCount(6)
        const ids: string[] = []
        for (const field of await fields.all()) {
          await expect(field).toHaveAttribute('aria-invalid', 'true')
          const id = await field.getAttribute('aria-describedby')
          if (!id) throw new Error('Invalid field has no error description')
          ids.push(id)
          expect(
            await field.evaluate((element) => {
              const error = element.nextElementSibling
              return (
                error?.id === element.getAttribute('aria-describedby') &&
                error?.getAttribute('role') === 'alert'
              )
            })
          ).toBe(true)
          await expect(field).toHaveAccessibleDescription(/value required/)
        }
        expect(new Set(ids).size).toBe(6)
        await page.screenshot({
          path: test.info().outputPath(`${scenario}-validation-identity.png`),
          fullPage: true
        })
      },
      scenario === 'react-shadcn'
    )
  })
}
