import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerBrowserOutput } from '#tests/helpers/compiler/output'

for (const target of ['react', 'vue'] as const)
  for (const device of ['desktop', 'mobile'] as const) {
    test(`${target} ${device} reuses layout, navigates and shares document data`, async ({
      page
    }, info) => {
      await page.setViewportSize(
        device === 'mobile' ? { width: 390, height: 844 } : { width: 1200, height: 900 }
      )
      const result = parseCompilerBrowserOutput(
        execFileSync(
          'bun',
          [
            '-e',
            `import {compileApplicationShellFixture} from './tests/helpers/compiler/application-shell/fixture';const r=compileApplicationShellFixture(${JSON.stringify(target)},${JSON.stringify(device)});process.stdout.write(JSON.stringify({files:[...r.files],warnings:r.warnings}));`
          ],
          { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
        )
      )
      expect(result.warnings).toEqual([])
      await withComponentTemplateFiles(page, target, new Map(result.files), async () => {
        await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
        await expect(page.getByText('REFERENCE ONLY', { exact: true })).toHaveCount(0)
        await expect(page.getByText('OUTSIDE ENTRY', { exact: true })).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'Products', exact: true })).toHaveCount(1)
        const header = page.getByText(
          device === 'mobile' ? 'Mobile workspace' : 'OpenPencil workspace',
          { exact: true }
        )
        await expect(header).toBeVisible()
        const before = await header.boundingBox()
        const navigationBox = await page
          .getByRole('button', { name: 'Home', exact: true })
          .boundingBox()
        if (!before || !navigationBox) throw new Error('Shared layout geometry unavailable')
        if (device === 'desktop') expect(navigationBox.x).toBeLessThan(before.x)
        else expect(navigationBox.y).toBeGreaterThan(before.y)

        await page.getByRole('button', { name: 'Increment shared count', exact: true }).click()
        await expect(page.getByText('Workspace: 1', { exact: true })).toBeVisible()
        await page.screenshot({
          path: info.outputPath(`${target}-${device}-home.png`),
          fullPage: true
        })
        await page.getByRole('button', { name: 'Products', exact: true }).click()
        await expect(page).toHaveURL(/\/products$/)
        await expect(page.getByText('Products screen', { exact: true })).toBeVisible()
        await expect(page.getByText('Workspace: 1', { exact: true })).toBeVisible()
        expect(await header.boundingBox()).toEqual(before)
        await page.getByRole('button', { name: 'Home', exact: true }).click()
        await expect(page.getByText('Home screen', { exact: true })).toBeVisible()
        await expect(page.getByText('Shared count: 1', { exact: true })).toBeVisible()
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
        expect(overflow).toBe(false)
      })
    })
  }
