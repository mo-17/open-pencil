import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'
import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'

import { installBusinessTransport } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'

export const BUSINESS_BROWSER_USER_ID = '00000000-0000-4000-8000-000000000001'

export async function withBusinessBrowser(
  page: Page,
  kind: BusinessTemplateId,
  target: 'react' | 'vue',
  run: (session: {
    page: Page
    fixture: { application: BackendApplicationSpecV1; apiBasePath: string }
    api: Awaited<ReturnType<typeof installBusinessTransport>>
    open: (pageId: string) => Promise<void>
  }) => Promise<void>
): Promise<void> {
  const emitted = execFileSync(
    'bun',
    [
      '-e',
      `import {businessBrowserFixture} from './tests/engine/app/lowcode/backend/business/browser/helpers'; const v=await businessBrowserFixture('${kind}','${target}'); process.stdout.write(JSON.stringify({files:[...v.files],application:v.application,apiBasePath:v.apiBasePath,paths:v.paths}))`
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  const fixture = JSON.parse(emitted) as {
    files: [string, string][]
    application: BackendApplicationSpecV1
    apiBasePath: string
    paths: Record<string, string>
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
    const api = await installBusinessTransport(page, fixture.application)
    const open = async (id: string) => {
      if (!fixture.paths[id]) throw new Error('Missing generated business route')
      const url = new URL(fixture.paths[id], server.url).href
      await page.route(url, async (route) =>
        route.fulfill({ response: await route.fetch({ url: server.url }) })
      )
      await page.goto(url)
    }
    await run({ page, fixture, api, open })
    expect(api.failures).toEqual([])
    expect(api.steps).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await page.close()
    await server.close()
  }
}

export async function submitBusinessAction(page: Page, label: string): Promise<void> {
  await page.clock.fastForward(350)
  await page.getByRole('button', { name: label, exact: true }).last().click()
  await expect(page.getByText('Submit this request? ' + label, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: label, exact: true }).last().click()
}

export async function finishBusinessRequest(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish reviewed request', exact: true }).click()
  await page.getByRole('button', { name: /^(OK|Confirm)$/u }).click()
  await expect(
    page.getByRole('button', { name: 'Finish reviewed request', exact: true })
  ).toHaveCount(0)
}
