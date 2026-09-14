import { describe, expect, test } from 'bun:test'

import { expect as browserExpect } from '@playwright/test'

import { finishBusinessRequest, submitBusinessAction, withBusinessBrowser } from './session/helpers'

const profileId = '00000000-0000-4000-8000-000000000010'
const serviceId = '00000000-0000-4000-8000-000000000020'
const slotId = '00000000-0000-4000-8000-000000000030'
const bookingId = '00000000-0000-4000-8000-000000000040'
const recordedAt = '2026-09-14T00:00:00.000Z'
const startsAt = '2030-01-01T09:00:00+08:00'
const endsAt = '2030-01-01T10:00:00+08:00'
const canonicalStartsAt = '2030-01-01T01:00:00.000000Z'
const canonicalEndsAt = '2030-01-01T02:00:00.000000Z'

describe('generated booking browser workflow', () => {
  test.each(['react', 'vue'] as const)(
    '%s creates a service and time slot, books and cancels places',
    async (target) => {
      await withBusinessBrowser('booking-registration', target, async ({ page, api, open }) => {
        api.resources['my-profile'] = [
          { id: profileId, title: 'Alice', active: true, created_at: recordedAt }
        ]
        const service = {
          id: serviceId,
          title: 'Studio visit',
          description: 'A guided studio tour',
          active: true,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-service',
          payload: { title: service.title, description: service.description },
          result: service,
          resources: { services: [service] }
        })
        await open('services')
        await page.getByRole('button', { name: 'Create service', exact: true }).click()
        await page.getByPlaceholder('Service name', { exact: true }).fill(service.title)
        await page
          .getByPlaceholder('Service description', { exact: true })
          .fill(service.description)
        await submitBusinessAction(page, 'Create service')
        await browserExpect(
          page.getByText('Service: Studio visit', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)

        const slot = {
          id: slotId,
          service_id: serviceId,
          title: 'Morning tour',
          starts_at: canonicalStartsAt,
          ends_at: canonicalEndsAt,
          capacity: 2,
          reserved: 0,
          active: true,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'create-slot',
          payload: {
            serviceId,
            title: slot.title,
            startsAt: canonicalStartsAt,
            endsAt: canonicalEndsAt,
            capacity: 2
          },
          result: slot,
          resources: { slots: [slot] }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Create time slot', exact: true }).click()
        await page.getByPlaceholder('Slot name', { exact: true }).fill(slot.title)
        await page.getByPlaceholder('Start time (ISO 8601)', { exact: true }).fill(startsAt)
        await page.getByPlaceholder('End time (ISO 8601)', { exact: true }).fill(endsAt)
        await page.getByPlaceholder('Capacity', { exact: true }).fill('2')
        await submitBusinessAction(page, 'Create time slot')
        await browserExpect
          .poll(() => ({ calls: api.calls.length, failures: api.failures }))
          .toEqual({ calls: 2, failures: [] })
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(
          page.getByText('Time slot: Morning tour', { exact: true })
        ).toBeVisible()

        const booking = {
          id: bookingId,
          service_id: serviceId,
          slot_id: slotId,
          service_title: service.title,
          starts_at: canonicalStartsAt,
          ends_at: canonicalEndsAt,
          quantity: 2,
          attendee_name: 'Alice',
          contact: 'alice@example.test',
          note: 'Two visitors',
          status: 'confirmed',
          version: 0,
          created_at: recordedAt
        }
        api.steps.push({
          commandId: 'reserve-booking',
          payload: {
            serviceId,
            slotId,
            userId: profileId,
            quantity: 2,
            attendeeName: 'Alice',
            contact: booking.contact,
            note: booking.note
          },
          result: booking,
          resources: { bookings: [booking], slots: [{ ...slot, reserved: 2 }] }
        })
        await page.getByRole('button', { name: 'Reserve places', exact: true }).click()
        await page.getByRole('button', { name: 'Choose · Registered account', exact: true }).click()
        await page
          .getByRole('button', { name: 'Choose · Available time slot', exact: true })
          .click()
        await page.getByPlaceholder('Number of places', { exact: true }).fill('2')
        await page.getByPlaceholder('Attendee name', { exact: true }).fill('Alice')
        await page.getByPlaceholder('Contact details', { exact: true }).fill(booking.contact)
        await page.getByPlaceholder('Booking note', { exact: true }).fill(booking.note)
        await submitBusinessAction(page, 'Reserve places')
        await browserExpect.poll(() => api.calls.length).toBe(3)
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'My bookings', exact: true }).click()
        await browserExpect(
          page.getByText('Status: confirmed', { exact: true }).first()
        ).toBeVisible()

        const cancelled = { ...booking, status: 'cancelled', version: 1 }
        api.steps.push({
          commandId: 'cancel-booking',
          payload: { serviceId, bookingId, note: 'Plans changed' },
          result: cancelled,
          resources: {
            bookings: [cancelled],
            slots: [slot],
            'booking-history': [
              {
                id: '00000000-0000-4000-8000-000000000050',
                booking_id: bookingId,
                action: 'cancel',
                note: 'Plans changed',
                created_at: recordedAt
              }
            ]
          }
        })
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await page.getByRole('button', { name: 'Cancel booking', exact: true }).click()
        await page.getByPlaceholder('Booking note', { exact: true }).fill('Plans changed')
        await submitBusinessAction(page, 'Cancel booking')
        await browserExpect(
          page.getByText('Status: cancelled', { exact: true }).first()
        ).toBeVisible()
        await finishBusinessRequest(page)
        await page.getByRole('button', { name: 'Select record', exact: true }).click()
        await browserExpect(page.getByText('Note: Plans changed', { exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Manage time slots', exact: true }).click()
        await browserExpect(page.getByText('Reserved: 0', { exact: true }).first()).toBeVisible()
        expect(api.calls).toHaveLength(4)
        expect(new Set(api.calls.map((call) => call.key)).size).toBe(4)
        expect(api.reads).toContain('booking-history')
      })
    },
    120_000
  )
})
