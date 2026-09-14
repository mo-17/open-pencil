import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { BUSINESS_TEMPLATE_IDS } from '@/app/lowcode/backend/business/model/types'

import { BUSINESS_BROWSER_USER_ID } from './helpers'
import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const profileId = '00000000-0000-4000-8000-000000000010'
const agentId = '00000000-0000-4000-8000-000000000011'
const customerId = '00000000-0000-4000-8000-000000000020'
const ticketId = '00000000-0000-4000-8000-000000000030'
const recordedAt = '2026-09-14T00:00:00.000Z'

// HTTP and OIDC are explicit test doubles; the combined model, generated routes,
// rendered controls, state, request payloads and invalidation are production code.
describe('generated modular business application', () => {
  test.each(['react', 'vue'] as const)(
    '%s shares account/navigation and keeps CRM and ticket requests separate',
    async (target) => {
      await withBusinessBrowser(
        'customer-crm',
        target,
        async ({ page, fixture, api, open }) => {
          const routes = fixture.graph.getPages().map((entry) => entry.lowcodeRoutePattern)
          expect(routes.filter((path) => path === '/business-login')).toHaveLength(1)
          expect(routes.filter((path) => path === '/account-setup')).toHaveLength(1)
          expect(fixture.application.modules?.modules.map((entry) => entry.id)).toEqual(
            expect.arrayContaining([...BUSINESS_TEMPLATE_IDS])
          )
          const profile = {
            id: profileId,
            title: 'Combined Alice',
            active: true,
            created_at: recordedAt
          }
          const agent = { ...profile, id: agentId, title: 'Support-only colleague' }
          api.resources.users = [{ ...agent, title: 'CRM-only colleague' }]
          api.resources['service-desk-users'] = [agent]
          api.steps.push({
            commandId: 'register-business-user',
            payload: { title: profile.title },
            result: profile,
            resources: { 'my-profile': [profile] }
          })
          await open('login')
          await page.getByRole('button', { name: 'Account setup', exact: true }).click()
          await page.getByRole('button', { name: 'Register my profile', exact: true }).click()
          await page.getByPlaceholder('Display name', { exact: true }).fill(profile.title)
          await submitBusinessAction(page, 'Register my profile')
          await browserExpect(
            page.getByText('Name: ' + profile.title, { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)
          for (const label of [
            'Customers',
            'Tickets',
            'Approvals',
            'Writing desk',
            'Public knowledge base',
            'Services and booking',
            'My bookings',
            'Projects',
            'Tasks'
          ])
            await browserExpect(
              page.getByRole('button', { name: label, exact: true })
            ).toBeVisible()

          const customerInput = {
            userId: profileId,
            title: 'Combined customer',
            company: 'Customer company',
            email: 'customer@example.test',
            phone: '10000000000',
            description: 'CRM-only details'
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
          await page
            .getByRole('button', { name: 'Choose · Registered account', exact: true })
            .click()
          for (const [label, value] of [
            ['Customer name', customerInput.title],
            ['Company', customerInput.company],
            ['Email', customerInput.email],
            ['Phone', customerInput.phone],
            ['Customer notes', customerInput.description]
          ])
            await page.getByPlaceholder(label, { exact: true }).fill(value)
          await submitBusinessAction(page, 'New customer')
          await browserExpect(
            page.getByText('Customer: ' + customerInput.title, { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)
          await page.getByRole('button', { name: 'Select record', exact: true }).click()
          await browserExpect(page.getByText('Stage: new', { exact: true }).first()).toBeVisible()

          const ticketInput = {
            userId: profileId,
            title: 'Combined ticket',
            description: 'Ticket-only details',
            priority: 3
          }
          const ticket = {
            id: ticketId,
            title: ticketInput.title,
            description: ticketInput.description,
            priority: ticketInput.priority,
            assignee_id: null,
            assignee_subject: BUSINESS_BROWSER_USER_ID,
            status: 'open',
            resolution: '',
            approval_requested_by: null,
            reviewed_by: null,
            version: 0,
            created_at: recordedAt
          }
          api.steps.push({
            commandId: 'create-ticket',
            payload: ticketInput,
            result: ticket,
            resources: { tickets: [ticket] }
          })
          await page.getByRole('button', { name: 'Tickets', exact: true }).click()
          await browserExpect(
            page.getByText('Customer: ' + customerInput.title, { exact: true })
          ).toHaveCount(0)
          await browserExpect(page.getByPlaceholder('Customer name', { exact: true })).toHaveCount(
            0
          )
          await page.getByRole('button', { name: 'New ticket', exact: true }).click()
          await page
            .getByRole('button', { name: 'Choose · Registered account', exact: true })
            .click()
          await browserExpect(page.getByPlaceholder('Ticket title', { exact: true })).toHaveValue(
            ''
          )
          await page.getByPlaceholder('Ticket title', { exact: true }).fill(ticketInput.title)
          await page
            .getByPlaceholder('Issue description', { exact: true })
            .fill(ticketInput.description)
          await page.getByRole('spinbutton', { name: 'Priority (1–3)', exact: true }).fill('3')
          await submitBusinessAction(page, 'New ticket')
          await browserExpect(
            page.getByText('Ticket: ' + ticketInput.title, { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)

          const assigned = { ...ticket, assignee_id: agentId, status: 'assigned', version: 1 }
          api.steps.push({
            commandId: 'assign-ticket',
            payload: { ticketId, userId: agentId, note: 'Support-specific assignment' },
            result: assigned,
            resources: { tickets: [assigned] }
          })
          await page.getByRole('button', { name: 'Select record', exact: true }).click()
          await page.getByRole('button', { name: 'Assign ticket', exact: true }).click()
          await browserExpect(
            page.getByText('Registered account: Support-only colleague', { exact: true })
          ).toBeVisible()
          await browserExpect(
            page.getByText('Registered account: CRM-only colleague', { exact: true })
          ).toHaveCount(0)
          await page
            .getByRole('button', { name: 'Choose · Registered account', exact: true })
            .click()
          await page
            .getByPlaceholder('Assignment reason', { exact: true })
            .fill('Support-specific assignment')
          await submitBusinessAction(page, 'Assign ticket')
          await browserExpect(
            page.getByText('Status: assigned', { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)
          await page.getByRole('button', { name: 'Customers', exact: true }).click()
          await browserExpect(
            page.getByText('Customer: ' + customerInput.title, { exact: true }).first()
          ).toBeVisible()
          await browserExpect(
            page.getByText('Ticket: ' + ticketInput.title, { exact: true })
          ).toHaveCount(0)
          await browserExpect(
            page.getByText('Select a record to view its details or perform an action.', {
              exact: true
            })
          ).toBeVisible()
          await browserExpect(
            page.getByPlaceholder('Assignment reason', { exact: true })
          ).toHaveCount(0)
          await page.getByRole('button', { name: 'Select record', exact: true }).click()
          await page.getByRole('button', { name: 'Assign customer', exact: true }).click()
          await browserExpect(
            page.getByText('Registered account: CRM-only colleague', { exact: true })
          ).toBeVisible()
          await browserExpect(
            page.getByText('Registered account: Support-only colleague', { exact: true })
          ).toHaveCount(0)
          await browserExpect(
            page.getByPlaceholder('Assignment reason', { exact: true })
          ).toHaveValue('')
          await page.getByRole('button', { name: 'Account setup', exact: true }).click()
          await browserExpect(
            page.getByText('Name: ' + profile.title, { exact: true }).first()
          ).toBeVisible()
          expect(api.calls.map((call) => call.commandId)).toEqual([
            'register-business-user',
            'create-customer',
            'create-ticket',
            'assign-ticket'
          ])
          expect(new Set(api.calls.map((call) => call.key)).size).toBe(4)
          expect(api.reads).toEqual(
            expect.arrayContaining([
              'my-profile',
              'customers',
              'tickets',
              'service-desk-users',
              'users'
            ])
          )
          expect(api.resources.customers).toEqual([customer])
          expect(api.resources.tickets).toEqual([assigned])
        },
        { modules: BUSINESS_TEMPLATE_IDS.filter((kind) => kind !== 'customer-crm') }
      )
    },
    120_000
  )
})
