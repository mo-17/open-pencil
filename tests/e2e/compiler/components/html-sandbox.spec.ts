import { execFileSync } from 'node:child_process'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'
import { parseCompilerFiles } from '#tests/helpers/compiler/output'

test('Vue HTML module renders inert srcdoc and blocks active content and network escape', async ({
  page
}, info) => {
  test.setTimeout(90000)
  const source = `import {vueHTMLFixture} from './tests/helpers/compiler/modules/html/fixture';const out=vueHTMLFixture();if(out.warnings.length)throw new Error(JSON.stringify(out.warnings));process.stdout.write(JSON.stringify([...out.files]));`
  const files = new Map(
    parseCompilerFiles(
      execFileSync('bun', ['-e', source], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    )
  )
  const attemptedRequests: string[] = []
  await page.route('https://blocked.openpencil.invalid/**', (route) => {
    attemptedRequests.push(route.request().url())
    return route.abort()
  })
  await withComponentTemplateFiles(page, 'vue', files, async () => {
    const host = page.locator('[data-openpencil-html-preview]')
    const iframe = host.locator(':scope > iframe')
    await expect(iframe).toHaveAttribute('sandbox', '')
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect(iframe).toHaveAttribute('tabindex', '-1')
    await expect(iframe).toHaveCSS('pointer-events', 'none')
    const body = iframe.contentFrame()
    await expect(body.getByRole('heading', { name: '隔离 HTML', exact: true })).toBeVisible()
    await expect(body.getByText('Sandbox content', { exact: true })).toHaveCSS(
      'color',
      'rgb(220, 38, 38)'
    )
    await expect(host.getByText('Host overlay', { exact: true })).toBeVisible()
    await expect
      .poll(async () =>
        body.locator('body').evaluate((element) => {
          try {
            return element.ownerDocument.defaultView?.parent.document === element.ownerDocument
          } catch {
            return 'blocked'
          }
        })
      )
      .toBe('blocked')
    expect(await page.evaluate(() => '__htmlEscaped' in window)).toBe(false)
    expect(attemptedRequests).toEqual([])
    expect(page.url()).not.toContain('blocked.openpencil.invalid')
    await page.screenshot({ path: info.outputPath('vue-html-isolation.png') })
  })
})
