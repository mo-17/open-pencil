import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import {
  withComponentTemplate,
  withComponentTemplateFiles
} from '#tests/helpers/compiler/components/templates/browser'

test.use({ locale: 'zh-CN' })

for (const target of ['react', 'vue'] as const) {
  test(`${target} switch template starts off and updates feedback by click and Space`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withComponentTemplate(
      page,
      target,
      'switch',
      async () => {
        const control = page.getByRole('switch', { name: '启用选项', exact: true })
        const feedback = (value: string) => page.getByText(`当前值: ${value}`, { exact: true })
        await expect(control).not.toBeChecked()
        await expect(feedback('未启用')).toBeVisible()
        await page.screenshot({
          path: info.outputPath(`runtime-switch-${target}-off.png`),
          animations: 'disabled'
        })

        await control.click()
        await expect(control).toBeChecked()
        await expect(feedback('已启用')).toBeVisible()
        await page.screenshot({
          path: info.outputPath(`runtime-switch-${target}-on.png`),
          animations: 'disabled'
        })

        await control.focus()
        await control.press('Space')
        await expect(control).not.toBeChecked()
        await expect(feedback('未启用')).toBeVisible()
        await expect(control).toBeFocused()
        await control.press('Space')
        await expect(control).toBeChecked()
        await expect(feedback('已启用')).toBeVisible()
      },
      'zh-CN'
    )
  })

  test(`${target} date template preserves ISO state when cleared and set to a leap day`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withComponentTemplate(
      page,
      target,
      'datepicker',
      async () => {
        const control = page.getByLabel('日期', { exact: true })
        const feedback = page.getByText(/^当前值:/)
        await expect(control).toHaveAttribute('type', 'date')
        await expect(control).toHaveValue('2026-09-22')
        await expect(feedback).toHaveText('当前值: 2026-09-22')
        await page.screenshot({ path: info.outputPath(`runtime-date-${target}-initial.png`) })

        await control.fill('')
        await control.blur()
        await expect(control).toHaveValue('')
        await expect(feedback).toHaveText('当前值:')

        await control.fill('2028-02-29')
        await control.blur()
        await expect(control).toHaveValue('2028-02-29')
        await expect(feedback).toHaveText('当前值: 2028-02-29')
        expect(
          await control.evaluate((element) => (element as HTMLInputElement).validity.valid)
        ).toBe(true)
        // Native date segments follow the browser locale; the bound value remains ISO.
        await page.screenshot({ path: info.outputPath(`runtime-date-${target}-leap-day.png`) })
      },
      'zh-CN'
    )
  })

  test(`${target} disabled switch and read-only date reject pointer and keyboard edits`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    const fixture: { files: [string, string][] } = JSON.parse(
      execFileSync(
        'bun',
        [
          '-e',
          `import { controlFoundationFixture } from './tests/helpers/compiler/components/controls'; process.stdout.write(JSON.stringify(controlFoundationFixture(${JSON.stringify(target)})))`
        ],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    await withComponentTemplateFiles(page, target, new Map(fixture.files), async () => {
      const disabled = page.getByRole('switch', { name: 'Disabled switch', exact: true })
      await expect(disabled).toBeDisabled()
      await expect(disabled).not.toBeChecked()
      // A real pointer attempt must not dispatch the switch's state update.
      await disabled.click({ force: true })
      await expect(disabled).not.toBeChecked()
      await disabled.focus()
      await expect(disabled).not.toBeFocused()

      const readOnly = page.getByLabel('Read only date', { exact: true })
      await expect(readOnly).toHaveAttribute('readonly', '')
      await expect(readOnly).toHaveValue('2026-09-22')
      await readOnly.click()
      await expect(readOnly).toBeFocused()
      await readOnly.press('ArrowUp')
      await readOnly.press('Backspace')
      await readOnly.press('Delete')
      await readOnly.blur()
      await expect(readOnly).toHaveValue('2026-09-22')
      await page.screenshot({
        path: info.outputPath(`runtime-disabled-readonly-${target}.png`),
        fullPage: true
      })
    })
  })
}
