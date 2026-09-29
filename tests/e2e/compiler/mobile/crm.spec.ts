import { expect, test } from '@playwright/test'

import {
  BUSINESS_BROWSER_USER_ID,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'
import {
  exerciseReducedViewport,
  expectNoHorizontalOverflow,
  mobileBrowserOptions,
  mobileNavigation,
  tapBusinessReceipt,
  tapBusinessSubmit
} from '#tests/helpers/compiler/mobile/layout'
import { mobileId, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'

test.use(mobileBrowserOptions)

for (const target of ['react', 'vue'] as const) {
  test(`${target} mobile CRM preserves relation selection and exact create and follow-up payloads`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withBusinessBrowser(page, 'customer-crm', target, async ({ api, open }) => {
      const profile = {
        id: mobileId(10),
        title: 'Alice',
        active: true,
        created_at: mobileRecordedAt
      }
      await open('account')
      await page.getByRole('button', { name: 'Register my profile', exact: true }).tap()
      await page.getByPlaceholder('Display name', { exact: true }).fill(profile.title)
      api.steps.push({
        commandId: 'register-business-user',
        payload: { title: profile.title },
        result: profile,
        resources: { 'my-profile': [profile], users: [profile] }
      })
      await tapBusinessSubmit(page, 'Register my profile')
      await expect.poll(() => api.calls.length).toBe(1)
      await tapBusinessReceipt(page)
      await mobileNavigation(page).selectOption({ label: 'Customers' })
      await page.getByRole('button', { name: 'New customer', exact: true }).tap()
      await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).tap()
      const payload = {
        userId: profile.id,
        title: 'Mobile Acme',
        company: 'Acme Studio',
        email: 'contact@example.test',
        phone: '10000000000',
        description: 'Keep the relationship and this draft through orientation changes.'
      }
      for (const [label, value] of [
        ['Customer name', payload.title],
        ['Company', payload.company],
        ['Email', payload.email],
        ['Phone', payload.phone],
        ['Customer notes', payload.description]
      ])
        await page.getByPlaceholder(label, { exact: true }).fill(value)
      await exerciseReducedViewport(
        page,
        page.getByPlaceholder('Customer notes', { exact: true }),
        payload.description,
        page.getByRole('button', { name: 'New customer', exact: true }).last()
      )
      const customer = {
        id: mobileId(20),
        ...payload,
        assignee_id: profile.id,
        assignee_subject: BUSINESS_BROWSER_USER_ID,
        stage: 'new',
        closed: false,
        version: 0,
        created_at: mobileRecordedAt
      }
      api.steps.push({
        commandId: 'create-customer',
        payload,
        result: customer,
        resources: { customers: [customer] }
      })
      await tapBusinessSubmit(page, 'New customer')
      await expect.poll(() => api.calls.length).toBe(2)
      await tapBusinessReceipt(page)
      await page.getByRole('button', { name: 'Select record', exact: true }).tap()
      await page.getByRole('button', { name: 'Add follow-up', exact: true }).tap()
      await page.getByPlaceholder('Explanation', { exact: true }).fill('Mobile discussion recorded')
      api.steps.push({
        commandId: 'add-customer-follow-up',
        payload: { customerId: customer.id, note: 'Mobile discussion recorded' },
        result: { ...customer, version: 1 },
        resources: { customers: [{ ...customer, version: 1 }] }
      })
      await tapBusinessSubmit(page, 'Add follow-up')
      await expect.poll(() => api.calls.length).toBe(3)
      await tapBusinessReceipt(page)
      expect(new Set(api.calls.map((call) => call.key)).size).toBe(3)
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`customer-crm-${target}-mobile-flow.png`) })
    })
  })
}
