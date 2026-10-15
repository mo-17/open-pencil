import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import { withModuleFormCleanup } from '../form-module/lifecycle'
import type { TemplateId, TemplateTarget } from './fixture'

export async function withComponentTemplate(
  page: Page,
  target: TemplateTarget,
  id: TemplateId | readonly TemplateId[],
  run: () => Promise<void>,
  locale = 'en'
): Promise<void> {
  const ids = typeof id === 'string' ? [id] : id
  const source = `import { compileComponentTemplates } from './tests/helpers/compiler/components/templates/fixture'; const output = compileComponentTemplates(${JSON.stringify(target)}, ${JSON.stringify(ids)}, ${JSON.stringify(locale)}); if (output.warnings.length) throw new Error(JSON.stringify(output.warnings)); process.stdout.write(JSON.stringify([...output.files]));`
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync('bun', ['-e', source], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
  )
  await withComponentTemplateFiles(page, target, new Map(files), run)
}

export async function withComponentTemplateFiles(
  page: Page,
  target: TemplateTarget,
  files: Map<string, string>,
  run: () => Promise<void>
): Promise<void> {
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: files })
  const errors: string[] = []
  const capture = (error: Error) => errors.push(error.message)
  page.on('pageerror', capture)
  try {
    await withModuleFormCleanup(
      async () => {
        await page.goto(server.url, { waitUntil: 'networkidle' })
        await run()
        expect(errors).toEqual([])
      },
      async () => {
        if (!page.isClosed()) await page.goto('about:blank')
      },
      () => server.close()
    )
  } finally {
    page.off('pageerror', capture)
  }
}
