import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type ConsoleMessage, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

export async function withAvatar(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  updates = false
): Promise<void> {
  const script = `import {avatarFixture} from './tests/helpers/compiler/modules/avatar/fixture';const result=avatarFixture(${JSON.stringify(target)},${updates});if(result.warnings.length)throw new Error(JSON.stringify(result.warnings));process.stdout.write(JSON.stringify([...result.files].map(([path,content])=>[path,typeof content==='string'?content:Array.from(content)])));`
  const serialized = JSON.parse(
    execFileSync('bun', ['-e', script], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      cwd: process.cwd()
    })
  ) as [string, string | number[]][]
  const files = new Map(
    serialized.map(([path, content]) => [
      path,
      typeof content === 'string' ? content : Uint8Array.from(content)
    ])
  )
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: files })
  const errors: string[] = [],
    capture = (error: Error) => errors.push(error.message)
  const captureModuleError = (message: ConsoleMessage) => {
    if (message.type() === 'error' && message.text().includes('Failed to load module script'))
      errors.push(message.text())
  }
  page.on('pageerror', capture)
  page.on('console', captureModuleError)
  try {
    await page.goto(server.url, { waitUntil: 'networkidle' })
    expect(errors, 'Preview must mount before component behavior assertions').toEqual([])
    await run()
    expect(errors).toEqual([])
  } finally {
    page.off('pageerror', capture)
    page.off('console', captureModuleError)
    if (!page.isClosed()) await page.goto('about:blank')
    await server.close()
  }
}
