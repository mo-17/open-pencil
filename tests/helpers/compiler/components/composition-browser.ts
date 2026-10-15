import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

export async function withCompositionPreview(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  hiddenContent = false
): Promise<void> {
  const emitted = execFileSync(
    'bun',
    [
      '-e',
      `
    import { compositionFiles } from './tests/helpers/compiler/components/composition';
    const output = compositionFiles(${JSON.stringify(target)}, ${JSON.stringify(hiddenContent)});
    if (output.warnings.length) throw new Error(JSON.stringify(output.warnings));
    process.stdout.write(JSON.stringify([...output.files].filter(([, value]) => typeof value === 'string')));
  `
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  )
  const files = new Map(
    v.parse(v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))), emitted)
  )
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: files })
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.message)
  page.on('pageerror', onError)
  try {
    await page.goto(server.url, { waitUntil: 'networkidle' })
    await run()
    expect(errors).toEqual([])
  } finally {
    page.off('pageerror', onError)
    await page.goto('about:blank')
    await server.close()
  }
}
