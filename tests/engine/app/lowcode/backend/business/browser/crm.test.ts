import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { BUSINESS_BROWSER_USER_ID } from './helpers'
import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const profileId = '00000000-0000-4000-8000-000000000010'
const colleagueId = '00000000-0000-4000-8000-000000000011'
const customerId = '00000000-0000-4000-8000-000000000020'
const recordedAt = '2026-09-14T00:00:00.000Z'

describe('generated CRM browser workflow', () => {
  test.each(['react', 'vue'] as const)(
    '%s registers, creates, follows up, advances and assigns a customer',
    async (target) => {
      await withBusinessBrowser('customer-crm', target, async ({ page, api, open }) => {
        const profile = { id: profileId, title: 'Alice', active: true, created_at: recordedAt }
        const colleague = { ...profile, id: colleagueId, title: 'Bob' }
        api.resources.users = [colleague]
        api.steps.push({
          commandId: 'register-business-user',
          payload: { title: 'Alice' },
          result: profile,
          resources: { 'my-profile': [profile], users: [profile, colleague] }
        })
        await open('account')
        await page.getByRole('button', { name: 'Register my profile', exact: true }).click()
        await page.getByPlaceholder('Display name', { exact: true }).fill('Alice')
        await submitBusinessAction(page, 'Register my profile')
        await browserExpect(page.getByText('Name: Alice', { exact: true }).first()).toBeVisible()
        await finishBusinessRequest(page)

        const customerInput = {
          userId: profileId,
          title: 'Acme',
          company: 'Acme Studio',
          email: 'contact@example.test',
          phone: '10000000000',
          description: 'Website redesign'
        }
        const customer = {
          id: customerId,
          title: customerInput.title,
          company: customerInput.company,
          email: customerInput.email,
          phone: customerInput.phone,
          description: customerInput.description,
          assignee_id: profileId,
          assignee_subject: BUSINESS_BROWSER_USER_ID,
          stage: 'new',
          closed: false,
          version: 0,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-customer',
          payload: customerInput,
          result: customer,
          resources: { customers: [customer] }
        })
        await page.getByRole('button', { name: 'Customers', exact: true }).click()
        await page.getByRole('button', { name: 'New customer', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        for (const [label, value] of [
          ['Customer name', customerInput.title],
          ['Company', customerInput.company],
          ['Email', customerInput.email],
          ['Phone', customerInput.phone],
          ['Customer notes', customerInput.description]
        ])
          await page.getByPlaceholder(label, { exact: true }).fill(value)
        await submitBusinessAction(page, 'New customer')
        await browserExpect(page.getByText('Customer: Acme', { exact: true }).first()).toBeVisible()
        await finishBusinessRequest(page)

        const followUp = {
          id: '00000000-0000-4000-8000-000000000030',
          customer_id: customerId,
          actor_subject: BUSINESS_BROWSER_USER_ID,
          action: 'follow-up',
          note: 'Confirmed the project scope',
          before_stage: 'new',
          after_stage: 'new',
          created_at: recordedAt
        }
        const followed = { ...customer, version: 1 }
        api.steps.push({
          commandId: 'add-customer-follow-up',
          payload: { customerId, note: followUp.note },
          result: followed,
          resources: { customers: [followed], 'follow-ups': [followUp] }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Add follow-up', exact: true }).click()
        await page.getByPlaceholder('Explanation', { exact: true }).fill(followUp.note)
        await submitBusinessAction(page, 'Add follow-up')
        await browserExpect.poll(() => api.calls.length).toBe(3)
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(page.getByText('Note: ' + followUp.note, { exact: true })).toBeVisible()

        const contacted = { ...followed, stage: 'contacted', version: 2 }
        api.steps.push({
          commandId: 'customer-contacted',
          payload: { customerId, note: 'First call completed' },
          result: contacted,
          resources: { customers: [contacted] }
        })
        await page.getByRole('button', { name: 'Mark Contacted', exact: true }).click()
        await page.getByPlaceholder('Explanation', { exact: true }).fill('First call completed')
        await submitBusinessAction(page, 'Mark Contacted')
        await browserExpect(
          page.getByText('Stage: contacted', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)

        const assigned = {
          ...contacted,
          assignee_id: colleagueId,
          assignee_subject: '00000000-0000-4000-8000-000000000002',
          version: 3
        }
        api.steps.push({
          commandId: 'assign-customer',
          payload: { customerId, userId: colleagueId, note: 'Bob owns the next meeting' },
          result: assigned,
          resources: { customers: [assigned] }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Assign customer', exact: true }).click()
        await page
          .getByRole('button', { name: 'Choose · Registered account', exact: true })
          .last()
          .click()
        await page
          .getByPlaceholder('Assignment reason', { exact: true })
          .fill('Bob owns the next meeting')
        await submitBusinessAction(page, 'Assign customer')
        await browserExpect.poll(() => api.calls.length).toBe(5)
        await finishBusinessRequest(page)
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(5)
        expect(api.reads).toContain('follow-ups')
      })
    },
    120_000
  )
})
