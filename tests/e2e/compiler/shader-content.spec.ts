import { execFileSync } from 'node:child_process'

import * as v from 'valibot'

import { expect, test } from '#tests/e2e/fixtures'
import { withComponentTemplateFiles } from '#tests/helpers/compiler/components/templates/browser'

for (const target of ['react', 'vue'] as const) {
  test(`${target} static Shader decoration leaves bound controls interactive`, async ({ page }) => {
    test.setTimeout(90_000)
    const script = `import { compileShaderControls } from './tests/helpers/compiler/shaders/fixture'; process.stdout.write(JSON.stringify(await compileShaderControls(${JSON.stringify(target)})));`
    const output = v.parse(
      v.pipe(
        v.string(),
        v.parseJson(),
        v.object({
          feedbackId: v.string(),
          files: v.array(v.tuple([v.string(), v.union([v.string(), v.array(v.number())])]))
        })
      ),
      execFileSync('bun', ['-e', script], {
        cwd: process.cwd(),
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024
      })
    )
    const files = new Map(
      output.files.flatMap(([path, content]) =>
        typeof content === 'string' ? [[path, content] as const] : []
      )
    )
    const assets = new Map(
      output.files.flatMap(([path, content]) =>
        typeof content === 'string' ? [] : [[path, Buffer.from(content)] as const]
      )
    )
    await page.route('**/assets/**', async (route) => {
      const bytes = assets.get(`public${new URL(route.request().url()).pathname}`)
      if (bytes) await route.fulfill({ status: 200, body: bytes, contentType: 'image/png' })
      else await route.continue()
    })
    await withComponentTemplateFiles(page, target, files, async () => {
      const input = page.getByRole('textbox')
      const select = page.getByRole('combobox')
      const shown = page.locator(`[data-node-id="${output.feedbackId}"]`)
      await input.fill('typed')
      await expect(input).toBeFocused()
      await expect(shown).toHaveText('typed')
      await select.click()
      await select.press('Escape')
      await select.focus()
      await expect(select).toBeFocused()
      await select.selectOption('b')
      await expect(input).toHaveValue('b')
      await expect(shown).toHaveText('b')
      await page.getByRole('button', { name: 'Set value', exact: true }).click()
      await expect(input).toHaveValue('clicked')
      await expect(shown).toHaveText('clicked')
      await expect(page.getByText('Editable source', { exact: true })).toHaveCount(0)
    })
  })
}
