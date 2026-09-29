import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { withModuleFormCleanup } from './lifecycle'

export async function withModuleForm(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  remote = false,
  kit = false,
  radixSelect = false
): Promise<void> {
  const source = `import {moduleFormFixture} from './tests/helpers/compiler/components/form-module/fixtures'; process.stdout.write(JSON.stringify([...moduleFormFixture(${JSON.stringify(target)}, ${JSON.stringify(remote)}, ${JSON.stringify(kit)}, ${JSON.stringify(radixSelect)}).files]));`
  const files = JSON.parse(
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    })
  ) as [string, string][]
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: new Map(files) })
  const errors: string[] = []
  const capture = (error: Error) => errors.push(error.message)
  page.on('pageerror', capture)
  await withModuleFormCleanup(
    async () => {
      await page.goto(server.url, { waitUntil: 'networkidle' })
      await run()
      expect(errors).toEqual([])
    },
    async () => {
      page.off('pageerror', capture)
      if (!page.isClosed()) await page.goto('about:blank')
    },
    () => server.close()
  )
}
