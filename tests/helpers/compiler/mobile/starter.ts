import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'

import type { StarterPresentationKind } from '#tests/helpers/compiler/starter/fixtures'

export const mobileStarterKinds = [
  'notes',
  'shop',
  'single-merchant-shop',
  'multi-merchant-marketplace',
  'single-merchant-commerce',
  'multi-merchant-commerce'
] as const satisfies readonly StarterPresentationKind[]

export function mobileStarterId(kind: StarterPresentationKind): string {
  if (kind === 'notes') return 'personal-notes'
  return kind === 'shop' ? 'single-sku-shop' : kind
}

/** Reuse the actual generated starter; this session never changes the caller's viewport. */
export async function withMobileStarter(
  page: Page,
  kind: StarterPresentationKind,
  target: 'react' | 'vue',
  run: (session: {
    base: string
    paths: Record<string, string>
    open: (key: string) => Promise<void>
  }) => Promise<void>,
  locale = 'en'
): Promise<void> {
  const fixture = JSON.parse(
    execFileSync(
      'bun',
      [
        '-e',
        `import {starterPresentationFixture} from './tests/helpers/compiler/starter/fixtures'; process.stdout.write(JSON.stringify(await starterPresentationFixture(${JSON.stringify(kind)},${JSON.stringify(target)},${JSON.stringify(locale)})))`
      ],
      { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    )
  ) as {
    files: [string, string][]
    paths: Record<string, string>
    apiBasePath: string
  }
  const { createPreviewServer } = await import(
    pathToFileURL(join(process.cwd(), 'packages/compiler/dist/dev-server.mjs')).href
  )
  const server: PreviewServer = await createPreviewServer({
    target,
    initialFiles: new Map(fixture.files)
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.clock.install()
    await run({
      base: fixture.apiBasePath,
      paths: fixture.paths,
      open: async (key) => {
        if (!fixture.paths[key]) throw new Error('Missing generated starter route')
        const url = new URL(fixture.paths[key], server.url).href
        await page.route(url, async (route) =>
          route.fulfill({ response: await route.fetch({ url: server.url }) })
        )
        await page.goto(url)
      }
    })
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await server.close()
  }
}
