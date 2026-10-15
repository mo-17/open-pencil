import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, type Page } from '@playwright/test'
import * as v from 'valibot'

import type { PreviewServer } from '@open-pencil/compiler/dev-server'
import {
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1
} from '@open-pencil/lowcode/backend'
import { canonicalManifestJSON } from '@open-pencil/scene-graph'

import { businessTemplateDefinition } from '@/app/lowcode/backend/business/definitions'
import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import { preflightBusinessPages } from '@/app/lowcode/backend/business/pages/preflight'
import type { BusinessTemplateDefinition } from '@/app/lowcode/backend/business/types'

import { installBusinessTransport } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'

const EmittedBusinessFixture = v.object({
  files: v.array(v.tuple([v.string(), v.string()])),
  application: v.unknown(),
  definition: v.unknown(),
  apiBasePath: v.string(),
  paths: v.record(v.string(), v.string())
})

export const BUSINESS_BROWSER_USER_ID = '00000000-0000-4000-8000-000000000001'

export async function withBusinessBrowser(
  page: Page,
  kind: BusinessTemplateId,
  target: 'react' | 'vue',
  run: (session: {
    page: Page
    fixture: {
      application: BackendApplicationSpecV1
      definition: BusinessTemplateDefinition
      apiBasePath: string
    }
    api: Awaited<ReturnType<typeof installBusinessTransport>>
    open: (pageId: string) => Promise<void>
  }) => Promise<void>,
  options: { locale?: string; observeSignIn?: boolean } = {}
): Promise<void> {
  const emitted = execFileSync(
    'bun',
    [
      '-e',
      `import {businessBrowserFixture} from './tests/engine/app/lowcode/backend/business/browser/helpers'; const v=await businessBrowserFixture(${JSON.stringify(kind)},${JSON.stringify(target)},[],${JSON.stringify(options.locale ?? 'en')},${JSON.stringify(options.observeSignIn ?? false)}); process.stdout.write(JSON.stringify({files:[...v.files],application:v.application,definition:v.definition,apiBasePath:v.apiBasePath,paths:v.paths}))`
    ],
    { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  const decoded = v.parse(v.pipe(v.string(), v.parseJson(), EmittedBusinessFixture), emitted)
  const application = parseBackendApplicationSpecV1(decoded.application)
  if (!application.ok) throw new Error('Invalid generated business Backend application')
  const definition = businessTemplateDefinition(kind)
  if (canonicalManifestJSON(decoded.definition) !== canonicalManifestJSON(definition)) {
    throw new Error('Generated business definition differs from the reviewed template')
  }
  preflightBusinessPages(application.value, definition)
  const fixture = { ...decoded, application: application.value, definition }
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
