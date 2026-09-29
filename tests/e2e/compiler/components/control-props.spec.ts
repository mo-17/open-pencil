import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

for (const target of ['react', 'vue'] as const) {
  test(`${target} native controls keep string drafts, accessible names and disabled boundaries`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import {controlFoundationFixture} from './tests/helpers/compiler/components/controls'; process.stdout.write(JSON.stringify(controlFoundationFixture('${target}')))`
        ],
        { encoding: 'utf8', cwd: process.cwd() }
      )
    )
    const preview = await import(
      pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
    )
    const server: PreviewServer = await preview.createPreviewServer({
      target,
      initialFiles: new Map(fixture.files)
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await page.goto(server.url)
      const amount = page.getByRole('spinbutton', { name: 'Amount', exact: true })
      await expect(amount).toHaveAttribute('inputmode', 'decimal')
      await expect(amount).toHaveAttribute('autocomplete', 'off')
      await amount.fill('0')
      await expect(page.getByText('Amount[0] Delivery[standard]', { exact: true })).toBeVisible()
      await amount.fill('1.5')
      await expect(page.getByText('Amount[1.5] Delivery[standard]', { exact: true })).toBeVisible()
      await amount.fill('')
      await expect(page.getByText('Amount[] Delivery[standard]', { exact: true })).toBeVisible()
      await amount.fill('12')
      expect(
        await amount.evaluate((element) => (element as HTMLInputElement).validity.rangeOverflow)
      ).toBe(true)
      await amount.fill('0.3')
      expect(
        await amount.evaluate((element) => (element as HTMLInputElement).validity.stepMismatch)
      ).toBe(true)
      const delivery = page.getByRole('combobox', { name: 'Delivery', exact: true })
      await delivery.selectOption('express')
      await expect(page.getByText('Amount[0.3] Delivery[express]', { exact: true })).toBeVisible()
      await expect(delivery.getByRole('option', { name: 'Unavailable delivery' })).toBeDisabled()
      await expect(
        page.getByRole('combobox', { name: 'Default delivery', exact: true })
      ).toHaveValue('saved')
      await expect(page.getByRole('textbox', { name: 'Read only notes' })).toHaveAttribute(
        'readonly',
        ''
      )
      await expect(page.getByLabel('Read only date', { exact: true })).toHaveAttribute(
        'readonly',
        ''
      )
      await expect(page.getByRole('checkbox', { name: 'Disabled checkbox' })).toBeDisabled()
      await expect(page.getByRole('switch', { name: 'Disabled switch' })).toBeDisabled()
      const group = page.getByRole('radiogroup', { name: 'Disabled delivery group' })
      await expect(group.getByRole('radio', { name: 'First' })).toBeDisabled()
      await expect(group.getByRole('radio', { name: 'Second' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Disabled action' })).toBeDisabled()
      const contact = page.getByRole('textbox', { name: 'Contact name', exact: true })
      await contact.focus()
      await expect(page.getByText('Contact[] Event[focus]', { exact: true })).toBeVisible()
      await contact.press('Tab')
      await expect(page.getByText('Contact[] Event[blur]', { exact: true })).toBeVisible()
      await expect(contact).toHaveAttribute('aria-invalid', 'true')
      await expect(page.getByRole('alert')).toContainText('Enter a contact name')
      await contact.fill('Ada')
      await expect(page.getByText('Contact[Ada] Event[change]', { exact: true })).toBeVisible()
      await contact.press('Tab')
      await expect(page.getByText('Contact[Ada] Event[blur]', { exact: true })).toBeVisible()
      await expect(contact).not.toHaveAttribute('aria-invalid', 'true')
      await page.screenshot({
        path: info.outputPath(`native-controls-${target}.png`),
        fullPage: true
      })
      expect(errors).toEqual([])
    } finally {
      await page.close()
      await server.close()
    }
  })
}
