import { execFileSync } from 'node:child_process'

import { expect, test, type Page } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

function output(target: 'react' | 'vue', retention: 'preserve' | 'reset') {
  return parseCompilerBrowserOutput(
    execFileSync(
      'bun',
      [
        '-e',
        `import {compileApplicationSessionFixture} from './tests/helpers/compiler/application-session/fixture';const r=compileApplicationSessionFixture(${JSON.stringify(target)},${JSON.stringify(retention)});process.stdout.write(JSON.stringify({files:[...r.files],warnings:r.warnings}));`
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
}
async function clickWithoutScrolling(page: Page, name: string) {
  await page
    .getByRole('button', { name, exact: true })
    .evaluate((button: HTMLButtonElement) => button.click())
}
for (const target of ['react', 'vue'] as const) {
  test(`${target} restores declared list values, recomputes derived state and restores window scroll`, async ({
    page
  }) => {
    const result = output(target, 'preserve')
    expect(result.warnings).toEqual([])
    await withComponentTemplateFiles(page, target, new Map(result.files), async () => {
      await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
      await page.getByPlaceholder('Filter products').fill('pending order')
      await page.getByRole('button', { name: 'Next list page', exact: true }).click()
      await expect(page.getByText('Page: 2', { exact: true })).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 450))
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(450)
      await clickWithoutScrolling(page, 'Open products')
      await expect(page).toHaveURL(/\/products\/42$/)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
      await page.getByPlaceholder('Detail draft').fill('unsaved detail')
      await page.getByRole('button', { name: 'Back to previous page', exact: true }).click()
      await expect(page).toHaveURL(/\/home$/)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(450)
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('pending order')
      await expect(page.getByText('Page: 2', { exact: true })).toBeVisible()
      await clickWithoutScrolling(page, 'Open products')
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('unsaved detail')
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/\/products\/42$/)
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
    })
  })

  test(`${target} isolates concrete route and query instances while fragments reuse one page session`, async ({
    page
  }) => {
    const result = output(target, 'preserve')
    expect(result.warnings).toEqual([])
    await withComponentTemplateFiles(page, target, new Map(result.files), async () => {
      await page.getByPlaceholder('Filter products').fill('first query')
      await page.getByRole('button', { name: 'Change fragment', exact: true }).click()
      await expect(page).toHaveURL(/\/home#selection$/)
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('first query')
      await page.getByRole('button', { name: 'Open second query', exact: true }).click()
      await expect(page).toHaveURL(/\/home\?category=second$/)
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('')
      await page.getByPlaceholder('Filter products').fill('second query')
      await page.getByRole('button', { name: 'Open first query', exact: true }).click()
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('first query')
      await page.getByRole('button', { name: 'Open second query', exact: true }).click()
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('second query')
      await page.getByRole('button', { name: 'Open products', exact: true }).click()
      await page.getByPlaceholder('Detail draft').fill('product 42 draft')
      await page.getByRole('button', { name: 'Open next product', exact: true }).click()
      await expect(page).toHaveURL(/\/products\/43$/)
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
      await page.getByPlaceholder('Detail draft').fill('product 43 draft')
      await page.getByRole('button', { name: 'Open previous product', exact: true }).click()
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('product 42 draft')
      await page.getByRole('button', { name: 'Open next product', exact: true }).click()
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('product 43 draft')
    })
  })

  test(`${target} reset pages reset on reentry and same-component query or route changes`, async ({
    page
  }) => {
    const result = output(target, 'reset')
    expect(result.warnings).toEqual([])
    await withComponentTemplateFiles(page, target, new Map(result.files), async () => {
      await page.getByPlaceholder('Filter products').fill('discarded filter')
      await page.getByRole('button', { name: 'Next list page', exact: true }).click()
      await page.getByRole('button', { name: 'Open second query', exact: true }).click()
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('')
      await expect(page.getByText('Page: 1', { exact: true })).toBeVisible()
      await page.getByPlaceholder('Filter products').fill('second discarded')
      await page.getByRole('button', { name: 'Open products', exact: true }).click()
      await page.getByPlaceholder('Detail draft').fill('discarded detail')
      await page.getByRole('button', { name: 'Open next product', exact: true }).click()
      await expect(page.getByPlaceholder('Detail draft')).toHaveValue('')
      await page.getByRole('button', { name: 'Return second query', exact: true }).click()
      await expect(page.getByPlaceholder('Filter products')).toHaveValue('')
      await expect(page.getByText('Page: 1', { exact: true })).toBeVisible()
    })
  })
}
