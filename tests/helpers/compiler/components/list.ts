import { writeFile } from 'node:fs/promises'

import { expect, type Page, type Route, type TestInfo } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  BUSINESS_BROWSER_USER_ID,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

export function customerRow(title: string, suffix = '1'): BusinessTestRow {
  return {
    id: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
    title,
    company: 'List state fixture',
    email: 'fixture@example.test',
    phone: '',
    description: 'Scripted HTTP; no live account or database.',
    assignee_id: BUSINESS_BROWSER_USER_ID,
    assignee_subject: BUSINESS_BROWSER_USER_ID,
    stage: 'new',
    closed: false,
    version: 0,
    created_at: '2026-09-22T00:00:00.000Z'
  }
}

async function holdCustomerReads(page: Page, path: string) {
  const pending: Route[] = []
  const requests: string[] = []
  const writes: string[] = []
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // CRM also prepares a conditional stage-filtered source; this driver owns its visible
    // unfiltered/search source, while the existing fixture serves the other subscriptions.
    if (url.pathname !== path || url.searchParams.has('filter')) return route.fallback()
    if (request.method() !== 'GET') {
      writes.push(request.method())
      return route.fulfill({ status: 405, json: { message: 'Read-only test fixture' } })
    }
    requests.push(request.url())
    pending.push(route)
  })
  return {
    requests,
    writes,
    async next(query?: string): Promise<Route> {
      await expect.poll(() => pending.length).toBeGreaterThan(0)
      const route = pending.shift()
      if (!route) throw new Error('Missing held customer GET')
      if (query !== undefined)
        expect(new URL(route.request().url()).searchParams.get('q') ?? '').toBe(query)
      return route
    }
  }
}

export async function answerList(route: Route, rows: BusinessTestRow[]): Promise<void> {
  await route.fulfill({ json: { data: rows, nextCursor: null } })
}

/** Replace only the generated authentication module; no real OIDC/account claims are made. */
async function installAccountBoundary(page: Page) {
  let moduleLoads = 0
  const eventName = 'openpencil-list-test-account'
  await page.route('**/src/lowcode-backend-auth.ts*', async (route) => {
    moduleLoads++
    await route.fulfill({
      contentType: 'text/javascript',
      body: `
let state = {ready:true,signedIn:true,id:'${BUSINESS_BROWSER_USER_ID}',email:null,generation:1,notice:null};
const listeners = new Set();
export const getSession = () => state;
export const getSnapshot = getSession;
export function subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)}
export async function initialize(){}
export async function getAccessToken(){return 'business-test-session'}
export function cancelSignIn(){}
export async function signIn(){throw new Error('Real OIDC is outside this fixture')}
export async function signOut(){throw new Error('Use the scripted account boundary')}
addEventListener('${eventName}', event => {
  state = {...state,id:event.detail,generation:state.generation+1};
  for (const listener of [...listeners]) listener();
});
`
    })
  })
  return async (id: string) => {
    expect(moduleLoads).toBeGreaterThan(0)
    await page.evaluate(
      ({ event, account }) => dispatchEvent(new CustomEvent(event, { detail: account })),
      { event: eventName, account: id }
    )
  }
}

export async function withCustomerList(
  page: Page,
  target: 'react' | 'vue',
  info: TestInfo,
  run: (driver: {
    reads: Awaited<ReturnType<typeof holdCustomerReads>>
    state: ReturnType<Page['locator']>
    retry: ReturnType<Page['locator']>
    open: () => Promise<void>
    refresh: () => Promise<void>
    search: (query: string) => Promise<void>
    navigate: (label: string) => Promise<void>
    switchAccount: (id: string) => Promise<void>
    useAutoHeight: () => Promise<void>
    statusGeometry: () => Promise<{ height: number; contained: boolean }>
  }) => Promise<void>
): Promise<void> {
  const errors: string[] = []
  const consoleErrors: string[] = []
  const failedResponses: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400)
      failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`)
  })
  await withBusinessBrowser(page, 'customer-crm', target, async ({ fixture, open }) => {
    const resource = fixture.application.httpApi?.resources.find(
      (entry) => entry.id === 'customers'
    )
    if (!resource) throw new Error('Customer fixture requires its real HTTP resource')
    const switchAccount = await installAccountBoundary(page)
    const reads = await holdCustomerReads(page, fixture.apiBasePath + resource.path)
    const state = page.locator('[data-backend-list-status="customers"]')
    const navigate = async (label: string) => {
      await page.clock.fastForward(350)
      await page.getByRole('button', { name: label, exact: true }).click()
    }
    try {
      await run({
        reads,
        state,
        retry: page.locator('[data-backend-list-retry="customers"]'),
        open: () => open('customers'),
        refresh: () => navigate('Refresh list'),
        search: async (query) => {
          await page.getByPlaceholder('Search records', { exact: true }).fill(query)
          await navigate('Apply filters')
        },
        navigate,
        switchAccount,
        useAutoHeight: () =>
          state.evaluate((element) => {
            const container = element.parentElement
            if (!container) throw new Error('Missing generated list container')
            container.style.height = 'auto'
            container.style.minHeight = '0'
          }),
        statusGeometry: () =>
          state.evaluate((element) => {
            const container = element.parentElement
            if (!container) throw new Error('Missing generated list container')
            const outer = container.getBoundingClientRect()
            const status = element.getBoundingClientRect()
            return {
              height: outer.height,
              contained:
                status.top >= outer.top &&
                status.bottom <= outer.bottom &&
                status.left >= outer.left &&
                status.right <= outer.right
            }
          })
      })
      expect(reads.writes).toEqual([])
      expect(errors).toEqual([])
    } catch (error) {
      const path = info.outputPath('generated-list-browser-diagnostics.json')
      await writeFile(
        path,
        JSON.stringify(
          {
            target,
            url: page.url(),
            errors,
            consoleErrors,
            failedResponses,
            reads: reads.requests,
            body: await page
              .locator('body')
              .innerText()
              .catch(() => '[page unavailable]')
          },
          null,
          2
        )
      )
      await info.attach('generated-list-browser-diagnostics', {
        path,
        contentType: 'application/json'
      })
      throw error
    }
  })
}
