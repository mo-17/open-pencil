import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { expect, test } from '@playwright/test'

import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} preserves text field styles and bindings from an on-disk FIG`, async ({
    page
  }, info) => {
    test.setTimeout(90000)
    const suppliedPath = process.env.OPENPENCIL_TEMPLATE_FIG_PATH
    const path = suppliedPath ? resolve(suppliedPath) : info.outputPath('all-templates.fig')
    if (!suppliedPath) mkdirSync(dirname(path), { recursive: true })
    const compiled = JSON.parse(
      execFileSync(
        'bun',
        [
          'tests/helpers/compiler/components/templates/compile-fig.ts',
          target,
          path,
          ...(suppliedPath ? [] : ['--create-fixture'])
        ],
        { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
      )
    ) as { files: [string, string][]; sha256: string; byteLength: number }
    await withComponentTemplateFiles(page, target, new Map(compiled.files), async () => {
      const measurements = []
      const input = page.locator('input[aria-label="输入内容"]')
      const textarea = page.locator('textarea[aria-label="输入内容"]')
      await expect(input).toHaveCount(1)
      await expect(textarea).toHaveCount(1)
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 })
        for (const [name, field, height, padding] of [
          ['input', input, 44, '9px'],
          ['textarea', textarea, 128, '12px']
        ] as const) {
          await expect(field).toHaveCSS('font-size', '16px')
          await expect(field).toHaveCSS('line-height', '24px')
          await expect(field).toHaveCSS('padding-left', '12px')
          await expect(field).toHaveCSS('padding-right', '12px')
          await expect(field).toHaveCSS('padding-top', padding)
          await expect(field).toHaveCSS('padding-bottom', padding)
          await expect(field).toHaveCSS('height', `${height}px`)
          const measurement = await field.evaluate((element) => {
            const style = getComputedStyle(element)
            return {
              fontSize: style.fontSize,
              fontFamily: style.fontFamily,
              lineHeight: style.lineHeight,
              padding: style.padding,
              height: element.getBoundingClientRect().height,
              width: element.getBoundingClientRect().width
            }
          })
          measurements.push({ target, viewport: width, name, ...measurement })
          const screenshot = info.outputPath(`${target}-${width}-${name}.png`)
          await field.locator('..').screenshot({ path: screenshot })
          await info.attach(`${target}-${width}-${name}`, {
            path: screenshot,
            contentType: 'image/png'
          })
        }
      }
      await input.fill('单行内容')
      await textarea.fill('多行内容\n第二行')
      await expect(input).toHaveValue('单行内容')
      await expect(textarea).toHaveValue('多行内容\n第二行')
      await expect(page.getByText('当前值: 单行内容', { exact: true })).toBeVisible()
      await expect(page.getByText('当前值: 多行内容 第二行', { exact: true })).toBeVisible()
      const evidencePath = info.outputPath('fig-style-measurements.json')
      writeFileSync(
        evidencePath,
        JSON.stringify(
          { path, sha256: compiled.sha256, byteLength: compiled.byteLength, measurements },
          null,
          2
        )
      )
      await info.attach('fig-style-measurements', {
        path: evidencePath,
        contentType: 'application/json'
      })
    })
  })
}
