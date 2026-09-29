import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

for (const variant of ['react', 'vue', 'shadcn'] as const) {
  const target = variant === 'vue' ? 'vue' : 'react'
  test(`${variant} SELECT preserves placeholders, business values, clearing, and disabled options`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import { selectFoundationFixture } from './tests/helpers/compiler/components/select/foundation'; process.stdout.write(JSON.stringify(selectFoundationFixture(${JSON.stringify(target)}, ${variant === 'shadcn'})))`
        ],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(fixture.files), async () => {
      const placeholder = page.getByRole('combobox', { name: 'Placeholder only', exact: true })
      await expect(placeholder).toHaveValue('')
      await expect(placeholder.locator('option:checked')).toHaveText('请选择状态')
      await expect(placeholder.locator('option[value=""]')).toBeDisabled()
      await expect(placeholder).toHaveCSS('color', 'rgb(120, 154, 188)')
      await placeholder.selectOption('ready')
      await expect(placeholder).toHaveCSS('color', 'rgb(18, 52, 86)')
      await expect(placeholder.locator('option[value="blocked"]')).toBeDisabled()

      const clear = page.getByRole('combobox', { name: 'Clearable status', exact: true })
      // A binding wins over the authored literal default "paused".
      await expect(clear).toHaveValue('')
      await clear.selectOption('paused')
      await expect(page.getByText('Selected[paused] Dynamic[]', { exact: true })).toBeVisible()
      await clear.selectOption('')
      await clear.focus()
      await clear.blur()
      await expect(page.getByText('Selected[] Dynamic[]', { exact: true })).toBeVisible()
      await expect(page.getByRole('alert')).toHaveText('Choose a status')
      await expect(clear).toHaveCSS('color', 'rgb(120, 154, 188)')
      await clear.focus()
      // Native menu arrow handling is platform-owned. Typeahead performs real
      // keyboard selection in headless Chromium too; tab away/back resets its prefix.
      await clear.press('r')
      await expect(clear).toHaveValue('ready')
      await expect(page.getByText('Selected[ready] Dynamic[]', { exact: true })).toBeVisible()
      await clear.press('Tab')
      await page.keyboard.press('Shift+Tab')
      await expect(clear).toBeFocused()
      await clear.press('c')
      await expect(clear).toHaveValue('')
      await expect(page.getByText('Selected[] Dynamic[]', { exact: true })).toBeVisible()
      await expect(
        page
          .getByRole('combobox', { name: 'Clearable fallback', exact: true })
          .locator('option:checked')
      ).toHaveText('Select an option')

      // Legacy controls without opt-in props retain native/default semantics.
      if (variant !== 'shadcn') {
        await expect(
          page.getByRole('combobox', { name: 'Legacy unmatched empty', exact: true })
        ).toHaveValue('ready')
        await expect(
          page.getByRole('combobox', { name: 'Legacy unmatched literal', exact: true })
        ).toHaveValue('ready')
        await expect(
          page.getByRole('combobox', { name: 'Legacy default', exact: true })
        ).toHaveValue('paused')
        await expect(
          page.getByRole('combobox', { name: 'Legacy disabled default', exact: true })
        ).toHaveValue('blocked')
        await expect(
          page.getByRole('combobox', { name: 'Legacy first available', exact: true })
        ).toHaveValue('ready')
      }
      await expect(
        page.getByRole('combobox', { name: 'Legacy empty default', exact: true })
      ).toHaveValue('')
      const authored = page.getByRole('combobox', { name: 'Authored empty status', exact: true })
      await expect(authored.locator('option[value=""]')).toHaveCount(1)
      await expect(authored.locator('option:checked')).toHaveText('All statuses')
      await expect(authored.locator('option[value=""]')).toBeDisabled()
      const disabled = page.getByRole('combobox', { name: 'Disabled status', exact: true })
      await expect(disabled).toBeDisabled()
      await disabled.focus()
      await expect(disabled).not.toBeFocused()
      await expect(disabled).toHaveValue('paused')

      const dynamic = page.getByRole('combobox', { name: 'Dynamic status', exact: true })
      await expect(dynamic.locator('option[value=""]')).toHaveCount(1)
      await expect(dynamic.locator('option:checked')).toHaveText('Choose dynamic status')
      await page.getByRole('button', { name: 'Add business empty', exact: true }).click()
      await expect(dynamic.locator('option[value=""]')).toHaveCount(1)
      await expect(dynamic.locator('option:checked')).toHaveText('All statuses')
      await dynamic.selectOption('ready')
      await expect(page.getByText('Selected[] Dynamic[ready]', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Remove business empty', exact: true }).click()
      await expect(dynamic).toHaveValue('ready')
      await expect(dynamic.locator('option[value=""]')).toHaveCount(1)
      await dynamic.selectOption('')
      await expect(dynamic.locator('option:checked')).toHaveText('Choose dynamic status')
      await expect(page.getByText('Selected[] Dynamic[]', { exact: true })).toBeVisible()

      await expect(
        page.getByRole('combobox', { name: 'Colored kit status', exact: true })
      ).toHaveCSS('color', 'rgb(18, 52, 86)')
      await page.screenshot({ path: info.outputPath(`runtime-${variant}.png`), fullPage: true })
    })
  })
}
