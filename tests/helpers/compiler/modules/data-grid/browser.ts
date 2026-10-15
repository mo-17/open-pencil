import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import type { DataModulesFixtureOptions } from './fixtures'

export async function withDataModules(
  page: Page,
  target: 'react' | 'vue',
  run: () => Promise<void>,
  lang = 'en',
  lifecycle = false,
  configuredFilters = false,
  options: DataModulesFixtureOptions = {}
): Promise<void> {
  const files = v.parse(
    v.pipe(v.string(), v.parseJson(), v.array(v.tuple([v.string(), v.string()]))),
    execFileSync(
      'bun',
      [
        '-e',
        `import {dataModulesFixture} from './tests/helpers/compiler/modules/data-grid/fixtures'; process.stdout.write(JSON.stringify([...dataModulesFixture(${JSON.stringify(target)},${JSON.stringify(lang)},${JSON.stringify(lifecycle)},${JSON.stringify(configuredFilters)},${JSON.stringify(options)}).files]));`
      ],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  )
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({ target, initialFiles: new Map(files) })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(server.url)
    await run()
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await server.close()
  }
}
