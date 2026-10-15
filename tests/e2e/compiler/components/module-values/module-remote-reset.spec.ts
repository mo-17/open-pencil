import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFiles } from '#tests/helpers/compiler/output'

for (const scenario of ['blur', 'submit', 'cancelled reset'] as const)
  test(`React module ${scenario} remote validation respects reset without stale errors or business submission`, async ({
    page
  }) => {
    const source = `import {remoteModuleResetFixture} from './tests/helpers/compiler/components/form-modules/remote-reset';const output=remoteModuleResetFixture();if(output.warnings.length)throw new Error(JSON.stringify(output.warnings));process.stdout.write(JSON.stringify([...output.files]));`
    const files = new Map(
      parseCompilerFiles(
        execFileSync('bun', ['-e', source], {
          cwd: process.cwd(),
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024
        })
      )
    )
    let release: (() => void) | undefined,
      finish: (() => void) | undefined,
      requested = false
    const pending = new Promise<void>((resolve) => {
        release = resolve
      }),
      fulfilled = new Promise<void>((resolve) => {
        finish = resolve
      })
    await page.route('https://validation.example.test/module-reset', async (route) => {
      requested = true
      await pending
      try {
        await route.fulfill({ json: { valid: scenario !== 'blur', message: 'Old remote error' } })
      } finally {
        finish?.()
      }
    })
    try {
      await withComponentTemplateFiles(page, 'react', files, async () => {
        const rating = page.getByRole('slider', { name: 'Remote score' }),
          form = page.locator('form')
        await rating.focus()
        await page.keyboard.press('ArrowRight')
        await expect(page.getByText('Score:3; Submitted:0', { exact: true })).toBeVisible()
        if (scenario === 'blur') await rating.blur()
        else await form.evaluate((element) => (element as HTMLFormElement).requestSubmit())
        await expect.poll(() => requested).toBe(true)
        await form.evaluate((element, cancel) => {
          if (cancel)
            element.addEventListener('reset', (event) => event.preventDefault(), { once: true })
          ;(element as HTMLFormElement).reset()
        }, scenario === 'cancelled reset')
        if (scenario !== 'cancelled reset')
          await expect(rating).toHaveAttribute('aria-valuenow', '2')
        release?.()
        await fulfilled
        if (scenario === 'cancelled reset') {
          await expect(page.getByText('Score:3; Submitted:1', { exact: true })).toBeVisible()
        } else {
          await page.evaluate(
            () =>
              new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
              })
          )
          await expect(page.getByText('Score:2; Submitted:0', { exact: true })).toBeVisible()
          await expect(page.locator('[data-module-field-error]')).toHaveCount(0)
          await expect(rating).not.toHaveAttribute('aria-invalid', 'true')
        }
      })
    } finally {
      release?.()
    }
  })
