import { test, expect, expect as browserExpect, type Route } from '@playwright/test'

import {
  BUSINESS_BROWSER_USER_ID,
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} refresh preserves filters, forms, pending commands and rejects late rows`, async ({
    page
  }, info) => {
    test.setTimeout(90_000)
    await withBusinessBrowser(
      page,
      'customer-crm',
      target,
      async ({ page, fixture, api, open }) => {
        const customer = {
          id: '00000000-0000-4000-8000-000000000020',
          title: 'Acme first',
          company: 'Acme',
          email: 'contact@example.test',
          phone: '',
          description: 'Website',
          assignee_id: BUSINESS_BROWSER_USER_ID,
          assignee_subject: BUSINESS_BROWSER_USER_ID,
          stage: 'new',
          closed: false,
          version: 0,
          created_at: '2026-09-15T00:00:00.000Z'
        }
        api.resources.customers = [customer]
        const path = fixture.application.httpApi?.resources.find(
          (resource) => resource.id === 'customers'
        )?.path
        if (!path) throw new Error('Missing customers path')
        const calls: URL[] = []
        let holdNext = false
        let heldList: Route | undefined
        let heldPost: Route | undefined
        let title = customer.title
        await page.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          if (
            route.request().method() === 'POST' &&
            url.pathname.startsWith(fixture.apiBasePath + '/')
          ) {
            heldPost = route
            return
          }
          if (route.request().method() !== 'GET' || url.pathname !== fixture.apiBasePath + path)
            return route.fallback()
          calls.push(url)
          if (holdNext) {
            holdNext = false
            heldList = route
            return
          }
          await route.fulfill({ json: { data: [{ ...customer, title }], nextCursor: 'next-page' } })
        })
        await open('customers')
        await browserExpect(page.getByText('Customer: Acme first', { exact: true })).toBeVisible()
        await page.getByRole('combobox').selectOption({ label: 'New' })
        await page.getByPlaceholder('Search records').fill('Acme')
        await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
        await browserExpect
          .poll(() =>
            calls.some(
              (url) =>
                url.searchParams.get('q') === 'Acme' || url.searchParams.get('search') === 'Acme'
            )
          )
          .toBe(true)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Add follow-up', exact: true }).click()
        await page.getByPlaceholder('Explanation', { exact: true }).fill('Keep my unsent note')
        const initialURL = page.url()
        const count = calls.length
        await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
        await browserExpect.poll(() => calls.length).toBeGreaterThan(count)
        await browserExpect(page.getByPlaceholder('Explanation', { exact: true })).toHaveValue(
          'Keep my unsent note'
        )
        await browserExpect(page.getByRole('combobox')).toHaveValue('New')
        expect(page.url()).toBe(initialURL)
        expect(JSON.parse(calls.at(-1)?.searchParams.get('filter') ?? '{}')).toEqual({
          stage: 'new'
        })
        await page.getByRole('button', { name: 'Next page', exact: true }).first().click()
        await browserExpect.poll(() => calls.at(-1)?.searchParams.get('after')).toBe('next-page')
        await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
        await browserExpect.poll(() => calls.at(-1)?.searchParams.get('after') ?? '').toBe('')

        // A held old GET must not win after a second refresh. Real generated watchers own cancellation.
        holdNext = true
        await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
        await browserExpect.poll(() => !!heldList).toBe(true)
        title = 'Acme newest'
        await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
        await browserExpect(page.getByText('Customer: Acme newest', { exact: true })).toBeVisible()
        if (!heldList) throw new Error('Missing held old list')
        await heldList.fulfill({
          json: { data: [{ ...customer, title: 'Acme stale' }], nextCursor: null }
        })
        await page.clock.runFor(100)
        await browserExpect(page.getByText('Customer: Acme stale', { exact: true })).toHaveCount(0)
        await browserExpect(page.getByText('Customer: Acme newest', { exact: true })).toBeVisible()

        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Add follow-up', exact: true }).click()
        await page
          .getByPlaceholder('Explanation', { exact: true })
          .fill('Preserve my pending request')
        api.steps.push({
          commandId: 'add-customer-follow-up',
          payload: { customerId: customer.id, note: 'Preserve my pending request' },
          result: { ...customer, version: 1 }
        })
        await submitBusinessAction(page, 'Add follow-up')
        await browserExpect.poll(() => !!heldPost).toBe(true)
        await page.getByRole('button', { name: 'Refresh list', exact: true }).click()
        await browserExpect(page.getByText('Request in progress…', { exact: true })).toBeVisible()
        await browserExpect(page.getByPlaceholder('Explanation', { exact: true })).toHaveValue(
          'Preserve my pending request'
        )
        if (!heldPost) throw new Error('Missing held command')
        await heldPost.fallback()
        await browserExpect.poll(() => api.calls.length).toBe(1)
        await finishBusinessRequest(page)
        expect(api.calls[0].key).toBeTruthy()
        await page.screenshot({ path: info.outputPath('business-refresh.png') })
      }
    )
  })
}
