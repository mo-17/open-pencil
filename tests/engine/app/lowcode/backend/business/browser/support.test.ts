import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { BUSINESS_BROWSER_USER_ID } from './helpers'
import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const profileId = '00000000-0000-4000-8000-000000000010'
const agentId = '00000000-0000-4000-8000-000000000011'
const ticketId = '00000000-0000-4000-8000-000000000020'
const recordedAt = '2026-09-14T00:00:00.000Z'

describe('generated service desk browser workflow', () => {
  test.each(['react', 'vue'] as const)(
    '%s creates, assigns, processes and approves a ticket',
    async (target) => {
      await withBusinessBrowser('service-desk', target, async ({ page, api, open }) => {
        const profile = { id: profileId, title: 'Requester', active: true, created_at: recordedAt }
        const agent = { ...profile, id: agentId, title: 'Support colleague' }
        api.resources['my-profile'] = [profile]
        api.resources.users = [agent]
        const input = {
          userId: profileId,
          title: 'Account correction',
          description: 'Please correct the account details',
          priority: 2
        }
        let ticket = {
          id: ticketId,
          title: input.title,
          description: input.description,
          priority: input.priority,
          assignee_id: null as string | null,
          assignee_subject: BUSINESS_BROWSER_USER_ID,
          status: 'open',
          resolution: '',
          approval_requested_by: null as string | null,
          reviewed_by: null as string | null,
          version: 0,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-ticket',
          payload: input,
          result: ticket,
          resources: { tickets: [ticket] }
        })
        await open('tickets')
        await page.getByRole('button', { name: 'New ticket', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        await page.getByPlaceholder('Ticket title', { exact: true }).fill(input.title)
        await page.getByPlaceholder('Issue description', { exact: true }).fill(input.description)
        await submitBusinessAction(page, 'New ticket')
        await browserExpect(
          page.getByText('Ticket: Account correction', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)

        ticket = { ...ticket, assignee_id: agentId, status: 'assigned', version: 1 }
        api.steps.push({
          commandId: 'assign-ticket',
          payload: { ticketId, userId: agentId, note: 'Route to support' },
          result: ticket,
          resources: { tickets: [ticket] }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Assign ticket', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        await page.getByPlaceholder('Assignment reason', { exact: true }).fill('Route to support')
        await submitBusinessAction(page, 'Assign ticket')
        await browserExpect(
          page.getByText('Status: assigned', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)

        const transitions = [
          ['start-ticket', 'Start ticket', 'Investigating', 'in_progress', 'Tickets'],
          [
            'request-ticket-approval',
            'Request approval',
            'Correction verified',
            'pending_approval',
            'Tickets'
          ],
          [
            'approve-ticket',
            'Approve ticket',
            'Independent review completed',
            'approved',
            'Approvals'
          ],
          [
            'close-ticket',
            'Close approved ticket',
            'Requester confirmed resolution',
            'closed',
            'Tickets'
          ]
        ] as const
        for (const [commandId, label, note, status, navigation] of transitions) {
          const previous = ticket.status
          ticket = { ...ticket, status, version: ticket.version + 1 }
          const history = {
            id: '00000000-0000-4000-8000-' + String(30 + ticket.version).padStart(12, '0'),
            ticket_id: ticketId,
            actor_subject: BUSINESS_BROWSER_USER_ID,
            action: commandId,
            note,
            before_status: previous,
            after_status: status,
            created_at: recordedAt
          }
          api.steps.push({
            commandId,
            payload: { ticketId, note },
            result: ticket,
            resources: { tickets: [ticket], 'ticket-history': [history] }
          })
          await page.getByRole('button', { name: navigation, exact: true }).click()
          await page.getByRole('button', { name: 'Select record', exact: true }).click()
          await page.getByRole('button', { name: label, exact: true }).click()
          await page.getByPlaceholder('Explanation', { exact: true }).fill(note)
          await submitBusinessAction(page, label)
          await browserExpect(
            page.getByText('Status: ' + status, { exact: true }).first()
          ).toBeVisible()
          await finishBusinessRequest(page)
        }
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(
          page.getByText('Note: Requester confirmed resolution', { exact: true })
        ).toBeVisible()
        expect(api.calls).toHaveLength(6)
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(6)
        expect(api.reads).toContain('ticket-history')
      })
    },
    120_000
  )
})
