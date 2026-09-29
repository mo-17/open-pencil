import { expect, test, type Route } from '@playwright/test'

import {
  BUSINESS_BROWSER_USER_ID,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'
import { dismissSuccess, successNotification } from '#tests/helpers/compiler/feedback/assertions'
import {
  mobileBrowserOptions,
  tapBusinessReceipt,
  tapBusinessSubmit
} from '#tests/helpers/compiler/mobile/layout'
import { mobileId, mobileRecordedAt } from '#tests/helpers/compiler/mobile/samples'

test.use({ ...mobileBrowserOptions, reducedMotion: 'reduce' })

for (const target of ['react', 'vue'] as const) {
  test(`${target} CRM keeps confirmation cancellation silent and announces the completed command once`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    await withBusinessBrowser(page, 'customer-crm', target, async ({ fixture, api, open }) => {
      const customer = {
        id: mobileId(20),
        title: 'Acme',
        company: 'Acme Studio',
        email: 'contact@example.test',
        phone: '',
        description: 'A customer with a retryable follow-up.',
        assignee_id: BUSINESS_BROWSER_USER_ID,
        assignee_subject: BUSINESS_BROWSER_USER_ID,
        stage: 'new',
        closed: false,
        version: 0,
        created_at: mobileRecordedAt
      }
      api.resources.customers = [customer]
      let held: Route | undefined
      let posts = 0
      await page.route('**/*', async (route) => {
        if (
          route.request().method() === 'POST' &&
          new URL(route.request().url()).pathname.startsWith(fixture.apiBasePath + '/')
        ) {
          posts++
          held = route
          return
        }
        return route.fallback()
      })
      await open('customers')
      await page.getByRole('button', { name: 'Select record', exact: true }).tap()
      await page.getByRole('button', { name: 'Add follow-up', exact: true }).tap()
      const explanation = page.getByPlaceholder('Explanation', { exact: true })
      await explanation.fill('Customer requested another demonstration.')
      const submit = page.getByRole('button', { name: 'Add follow-up', exact: true }).last()
      await page.clock.fastForward(350)
      await submit.tap()
      await expect(
        page.getByText('Submit this request? Add follow-up', { exact: true })
      ).toBeVisible()
      await page.getByRole('button', { name: /^(Cancel|Keep editing)$/u }).tap()
      expect(posts).toBe(0)
      await expect(successNotification(page)).toHaveCount(0)
      await expect(explanation).toHaveValue('Customer requested another demonstration.')

      api.steps.push({
        commandId: 'add-customer-follow-up',
        payload: { customerId: customer.id, note: 'Customer requested another demonstration.' },
        result: { ...customer, version: 1 },
        resources: { customers: [{ ...customer, version: 1 }] }
      })
      await tapBusinessSubmit(page, 'Add follow-up')
      await expect.poll(() => posts).toBe(1)
      await expect(
        page.getByRole('button', { name: 'Request in progress…', exact: true })
      ).toBeDisabled()
      await expect(successNotification(page)).toHaveCount(0)
      if (!held) throw new Error('Missing held CRM command')
      await held.fallback()
      await expect.poll(() => api.calls.length).toBe(1)
      await expect(successNotification(page)).toContainText(/processed|handled/iu)
      await expect(
        page.getByRole('button', { name: 'Finish reviewed request', exact: true })
      ).toBeVisible()
      await page.clock.runFor(200)
      await page.screenshot({
        path: info.outputPath(`crm-${target}-feedback.png`),
        animations: 'disabled'
      })
      await dismissSuccess(page, /processed|handled/iu)
      await page
        .getByRole('button', { name: 'Inspect saved request · Add follow-up', exact: true })
        .last()
        .tap()
      await expect(successNotification(page)).toHaveCount(0)
      await tapBusinessReceipt(page)
      await expect(successNotification(page)).toHaveCount(0)
      expect(posts).toBe(1)
    })
  })
}
