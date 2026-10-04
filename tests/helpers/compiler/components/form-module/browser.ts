import { execFileSync } from 'node:child_process'

import { expect, type Page } from '@playwright/test'

import { moduleFormDiagnostics } from './diagnostics'
import { withModuleFormCleanup } from './lifecycle'
import { startFormPreviewSidecar } from './sidecar'

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
  const server = await startFormPreviewSidecar(target, files)
  const diagnostics = moduleFormDiagnostics(page, new URL(server.url).origin)
  const errors: string[] = []
  const capture = (error: Error) => errors.push(error.message)
  page.on('pageerror', capture)
  await withModuleFormCleanup(
    async () => {
      try {
        await page.goto(server.url, { waitUntil: 'networkidle' })
        await run()
        expect(errors).toEqual([])
      } catch (error) {
        const attached = await Promise.allSettled([diagnostics.attach()])
        if (attached[0].status === 'rejected')
          console.warn('Controlled preview failure diagnostics were unavailable.')
        throw error
      }
    },
    async () => {
      diagnostics.dispose()
      page.off('pageerror', capture)
      if (!page.isClosed()) await page.goto('about:blank')
    },
    () => server.close()
  )
}
