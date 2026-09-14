import { afterAll, beforeAll, expect } from 'bun:test'

import {
  chromium,
  expect as browserExpect,
  type Browser,
  type BrowserContext,
  type Page
} from '@playwright/test'

import { createPreviewServer } from '@open-pencil/compiler/dev-server'

import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'

import { businessBrowserFixture } from '../helpers'
import { installBusinessTransport } from '../transport/helpers'

let browser: Browser | undefined

beforeAll(async () => {
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  browser = undefined
})

export interface BusinessBrowserSession {
  page: Page
  fixture: Awaited<ReturnType<typeof businessBrowserFixture>>
  api: Awaited<ReturnType<typeof installBusinessTransport>>
  open(pageId: string): Promise<void>
}

export async function withBusinessBrowser(
  kind: BusinessTemplateId,
  target: 'react' | 'vue',
  run: (session: BusinessBrowserSession) => Promise<void>,
  options: { modules?: readonly BusinessTemplateId[] } = {}
): Promise<void> {
  const trace = (stage: string) => {
    if (process.env.BUSINESS_BROWSER_TRACE)
      process.stderr.write(`[business-browser ${kind}/${target}] ${stage}\n`)
  }
  trace('fixture')
  const fixture = await businessBrowserFixture(kind, target, options.modules)
  let server: Awaited<ReturnType<typeof createPreviewServer>> | undefined
  let context: BrowserContext | undefined
  let diagnosticPage: Page | undefined
  const errors: string[] = []
  const networkErrors: string[] = []
  const pendingRequests = new Set<string>()
  try {
    if (!browser) throw new Error('Business browser was not started')
    trace('preview')
    server = await createPreviewServer({ target, initialFiles: fixture.files })
    const previewURL = server.url
    trace('newPage')
    // Share only the worker process; each target gets isolated cookies, storage and routes.
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    diagnosticPage = page
    page.setDefaultTimeout(8_000)
    trace('clock')
    await page.clock.install()
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      pendingRequests.add(request.url())
      trace('request ' + request.url())
    })
    page.on('framenavigated', (frame) => trace('navigated ' + frame.url()))
    page.on('crash', () => errors.push('Browser page crashed'))
    page.on('requestfinished', (request) => pendingRequests.delete(request.url()))
    page.on('requestfailed', (request) => {
      pendingRequests.delete(request.url())
      networkErrors.push(request.url() + ': ' + (request.failure()?.errorText ?? 'failed'))
    })
    page.on('response', (response) => {
      if (response.status() >= 400) networkErrors.push(response.status() + ': ' + response.url())
    })
    trace('transport')
    const api = await installBusinessTransport(page, fixture.application)
    const open = async (pageId: string) => {
      const path = fixture.paths[pageId]
      if (!path) throw new Error('Unknown generated page: ' + pageId)
      const url = new URL(path, previewURL).href
      // Supply the real generated entry for the VFS server's unconnected history routes.
      await page.route(url, async (route) =>
        route.fulfill({ response: await route.fetch({ url: previewURL }) })
      )
      trace('goto ' + path)
      const response = await page.goto(url)
      trace('opened ' + path + ' at ' + page.url() + ' status ' + response?.status())
    }
    trace('workflow')
    await run({ page, fixture, api, open })
    trace('workflow done')
    expect(api.steps).toEqual([])
    expect(api.failures).toEqual([])
    expect(errors).toEqual([])
    const artifactDirectory = process.env.BUSINESS_BROWSER_ARTIFACT_DIR
    if (artifactDirectory)
      await page.screenshot({
        path: artifactDirectory + '/' + kind + '-' + target + '.png',
        fullPage: true
      })
  } catch (cause) {
    console.error('[business-browser] Workflow failed before cleanup:', cause)
    console.error('[business-browser] Page errors:', errors)
    console.error('[business-browser] Network errors:', networkErrors)
    console.error('[business-browser] Pending requests:', [...pendingRequests])
    console.error('[business-browser] Page URL:', diagnosticPage?.url())
    if (diagnosticPage && !diagnosticPage.isClosed()) {
      const body = await diagnosticPage.locator('body').innerText({ timeout: 1_000 }).catch(String)
      console.error('[business-browser] Page text:', body.slice(0, 2_000))
    }
    throw cause
  } finally {
    trace('context close')
    await context?.close()
    trace('server close')
    await server?.close()
    trace('closed')
  }
}

export async function submitBusinessAction(page: Page, label: string): Promise<void> {
  // Keep the generated request throttle; advance the isolated browser clock instead.
  await page.clock.fastForward(350)
  await page.getByRole('button', { name: label, exact: true }).last().click()
  await browserExpect(
    page.getByText('Submit this request? ' + label, { exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: label, exact: true }).last().click()
}

export async function finishBusinessRequest(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Finish reviewed request', exact: true }).click()
  await page.getByRole('button', { name: /^(OK|Confirm)$/u }).click()
  await browserExpect(
    page.getByRole('button', { name: 'Finish reviewed request', exact: true })
  ).toHaveCount(0)
}
