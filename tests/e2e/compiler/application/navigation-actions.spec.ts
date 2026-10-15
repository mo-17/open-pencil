import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

for (const target of ['react', 'vue'] as const) {
  test(`${target} authored replacement and repeated Back stay within application-owned history`, async ({
    page
  }, info) => {
    const result = parseCompilerBrowserOutput(
      execFileSync(
        'bun',
        [
          '-e',
          `import {compileApplicationNavigationActionsFixture} from './tests/helpers/compiler/application-navigation-actions/fixture';const r=compileApplicationNavigationActionsFixture(${JSON.stringify(target)});process.stdout.write(JSON.stringify({files:[...r.files],warnings:r.warnings}));`
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    )
    expect(result.warnings).toEqual([])
    await page.goto('data:text/html,<title>External host</title><h1>External host</h1>')
    await withComponentTemplateFiles(page, target, new Map(result.files), async () => {
      await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
      const initialLength = await page.evaluate(() => history.length)
      const initialPosition = await page.evaluate(() => ({
        react: history.state?.idx,
        vue: history.state?.position
      }))
      await page.getByRole('button', { name: 'Safe back', exact: true }).click()
      await expect(page).toHaveURL(/\/home\?category=fallback#top$/)
      expect(await page.evaluate(() => history.length)).toBe(initialLength)
      await page.getByRole('button', { name: 'Replace with details', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/42\?mode=edit#form$/)
      await expect(page.getByText('Products screen', { exact: true })).toBeVisible()
      expect(await page.evaluate(() => history.length)).toBe(initialLength)
      await page
        .getByRole('button', { name: 'Safe back', exact: true })
        .evaluate((button: HTMLButtonElement) => {
          button.click()
          button.click()
        })
      await expect(page).toHaveURL(/\/home\?category=fallback#top$/)
      expect(await page.evaluate(() => history.length)).toBe(initialLength)
      await page.getByPlaceholder('Filter products').fill('keep list filter')
      await page.getByRole('button', { name: 'Open products', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/42$/)
      expect(await page.evaluate(() => history.length)).toBe(initialLength + 1)
      await page
        .getByRole('button', { name: 'Safe back', exact: true })
        .evaluate((button: HTMLButtonElement) => {
          button.click()
          button.click()
        })
      await expect(page).toHaveURL(/\/home\?category=fallback#top$/)
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('keep list filter')
      await expect(page.getByText('External host', { exact: true })).toHaveCount(0)
      const index = await page.evaluate(() => ({
        react: history.state?.idx,
        vue: history.state?.position
      }))
      expect(target === 'react' ? index.react : index.vue).toBe(
        target === 'react' ? initialPosition.react : initialPosition.vue
      )
      await page.screenshot({ path: info.outputPath(`${target}-safe-back.png`), fullPage: false })
    })
  })
}
