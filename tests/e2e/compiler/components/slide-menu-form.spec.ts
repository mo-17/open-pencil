import { expect, test } from '@playwright/test'

import { withSlideMenuForm } from '#tests/helpers/compiler/components/slide-menu/form-browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} portaled SlideMenu FORM owns native controls and isolates invalid and valid submit`, async ({
    page
  }) => {
    await withSlideMenuForm(page, target, async () => {
      const outerField = page.getByRole('textbox', { name: 'Outer value' })
      const outerFeedback = page.getByText(/^Outer:/)
      await outerField.fill('outer-draft')
      await page.getByRole('button', { name: 'Open inner form' }).click()
      const drawer = page.getByRole('dialog', { name: 'Inner drawer' })
      const inner = drawer.locator('form')
      const innerField = drawer.getByRole('textbox', { name: 'Inner value' })
      await expect(drawer).toBeVisible()
      expect(
        await inner.evaluate((element) => ({
          outerForm: element.parentElement?.closest('form') !== null,
          inputs: [...(element as HTMLFormElement).elements]
            .filter((control) => control instanceof HTMLInputElement)
            .map((control) => control.getAttribute('aria-label'))
        }))
      ).toEqual({ outerForm: false, inputs: ['Inner value'] })
      expect(
        await outerField.evaluate((element) => {
          const form = (element as HTMLInputElement).form
          if (!form) throw new Error('Outer field must belong to its native form')
          return [...form.elements]
            .filter((control) => control instanceof HTMLInputElement)
            .map((control) => control.getAttribute('aria-label'))
        })
      ).toEqual(['Outer value'])

      await innerField.fill('')
      await drawer.getByRole('button', { name: 'Save Dialog' }).click()
      await expect(drawer.getByRole('alert')).toHaveText('Inner is required')
      await expect(innerField).toHaveAttribute('aria-invalid', 'true')
      await expect(outerField).not.toHaveAttribute('aria-invalid', 'true')
      await expect(outerFeedback).toHaveText('Outer:outer-draft/0')
      await expect(drawer.getByText(/^Inner:/)).toHaveText('Inner:/Not submitted')

      await innerField.fill('inner-draft')
      await drawer.getByRole('button', { name: 'Save Dialog' }).click()
      await expect(drawer.getByRole('alert')).toHaveCount(0)
      await expect(drawer.getByText(/^Inner:/)).toHaveText('Inner:inner-draft/Dialog saved')
      await expect(outerFeedback).toHaveText('Outer:outer-draft/0')
      await page.keyboard.press('Escape')
      await expect(drawer).not.toBeVisible()
      await page.getByRole('button', { name: 'Save outer' }).click()
      await expect(outerFeedback).toHaveText('Outer:outer-draft/1')
      await page.getByRole('button', { name: 'Open inner form' }).click()
      await expect(innerField).toHaveValue('inner-draft')
      await expect(drawer.getByText(/^Inner:/)).toHaveText('Inner:inner-draft/Dialog saved')
    })
  })

  test(`${target} portaled SlideMenu FORM preserves cancelled reset and isolates native accepted resets`, async ({
    page
  }) => {
    await withSlideMenuForm(page, target, async () => {
      const outerField = page.getByRole('textbox', { name: 'Outer value' })
      const outer = page.locator('form').filter({ has: outerField })
      const outerFeedback = page.getByText(/^Outer:/)
      await outerField.fill('outer-draft')
      await page.getByRole('button', { name: 'Open inner form' }).click()
      const drawer = page.getByRole('dialog', { name: 'Inner drawer' })
      const inner = drawer.locator('form')
      const innerField = drawer.getByRole('textbox', { name: 'Inner value' })
      const innerFeedback = drawer.getByText(/^Inner:/)
      await innerField.fill('submitted-draft')
      await drawer.getByRole('button', { name: 'Save Dialog' }).click()
      await expect(innerFeedback).toHaveText('Inner:submitted-draft/Dialog saved')
      await innerField.fill('')
      await innerField.blur()
      await expect(innerField).toHaveAttribute('aria-invalid', 'true')

      await inner.evaluate((element) => {
        element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
        ;(element as HTMLFormElement).reset()
      })
      await expect(innerField).toHaveValue('')
      await expect(innerField).toHaveAttribute('aria-invalid', 'true')
      await expect(innerFeedback).toHaveText('Inner:/Dialog saved')
      await expect(outerFeedback).toHaveText('Outer:outer-draft/0')

      await inner.evaluate((element) => {
        element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
      })
      await drawer.getByRole('button', { name: 'Reset inner' }).click()
      await expect(innerField).toHaveValue('')
      await expect(innerField).toHaveAttribute('aria-invalid', 'true')
      await expect(innerFeedback).toHaveText('Inner:/Dialog saved')
      await expect(outerField).toHaveValue('outer-draft')

      await inner.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(innerField).toHaveValue('inner-default')
      await expect(innerField).not.toHaveAttribute('aria-invalid', 'true')
      await expect(drawer.getByRole('alert')).toHaveCount(0)
      await expect(innerFeedback).toHaveText('Inner:inner-default/Dialog saved')
      await expect(outerFeedback).toHaveText('Outer:outer-draft/0')

      await innerField.fill('button-draft')
      await drawer.getByRole('button', { name: 'Reset inner' }).click()
      await expect(innerField).toHaveValue('inner-default')
      await expect(innerFeedback).toHaveText('Inner:inner-default/Dialog saved')
      await expect(outerFeedback).toHaveText('Outer:outer-draft/0')

      await innerField.fill('kept-inner-draft')
      await outer.evaluate((element) => (element as HTMLFormElement).reset())
      await expect(outerField).toHaveValue('outer-default')
      await expect(outerFeedback).toHaveText('Outer:outer-default/0')
      await expect(innerField).toHaveValue('kept-inner-draft')
      await expect(innerFeedback).toHaveText('Inner:kept-inner-draft/Dialog saved')
    })
  })
}
