import { expect, test } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'
import {
  hospitalDepartment as department,
  hospitalDoctor as doctor,
  hospitalSlot as slot,
  hospitalTestId,
  hospitalRecordedAt
} from '#tests/helpers/compiler/business/hospital/helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} configures hospital departments, doctors and sessions through real generated forms`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    // Scripted identity/HTTP prove UI wiring; real database tests verify hospital roles and locks.
    await withBusinessBrowser(page, 'hospital-registration', target, async ({ api, open }) => {
      const navigate = (label: string) =>
        page.getByRole('button', { name: label, exact: true }).click()
      const choose = () => navigate('Select record')
      const fill = async (values: Record<string, string>) => {
        for (const [label, value] of Object.entries(values))
          await page.getByPlaceholder(label, { exact: true }).fill(value)
      }
      const submit = async (
        label: string,
        commandId: string,
        payload: object,
        result: BusinessTestRow,
        resources: Record<string, BusinessTestRow[]>
      ) => {
        const before = api.calls.length
        api.steps.push({ commandId, payload, result, resources })
        await submitBusinessAction(page, label)
        await expect.poll(() => api.calls.length).toBe(before + 1)
        await finishBusinessRequest(page)
      }
      const profile = {
        id: hospitalTestId('1'),
        title: 'Administrator',
        active: true,
        created_at: hospitalRecordedAt
      }
      await open('account')
      await navigate('Register my profile')
      await fill({ 'Display name': profile.title })
      await submit(
        'Register my profile',
        'register-business-user',
        { title: profile.title },
        profile,
        { 'my-profile': [profile] }
      )

      await navigate('Manage departments')
      await navigate('Create department')
      await navigate('Choose · Registered account')
      await fill({
        'Department name': department.title,
        'Directory description': department.description,
        Location: department.location
      })
      await page.getByRole('combobox').last().selectOption({ label: 'Active / open' })
      await submit(
        'Create department',
        'create-hospital-department',
        {
          userId: profile.id,
          title: department.title,
          description: department.description,
          location: department.location,
          active: true
        },
        department,
        { 'hospital-management-departments': [department], 'hospital-departments': [department] }
      )
      await choose()
      await navigate('Edit department')
      await expect(page.getByRole('combobox').last()).toHaveValue('Active / open')
      await submit(
        'Edit department',
        'update-hospital-department',
        {
          departmentId: department.id,
          title: department.title,
          description: department.description,
          location: department.location,
          active: true
        },
        { ...department, version: 1 },
        { 'hospital-management-departments': [{ ...department, version: 1 }] }
      )

      await navigate('Manage doctors')
      await navigate('Create doctor')
      await navigate('Choose · Active department')
      await fill({
        'Doctor name': doctor.title,
        'Professional title': doctor.professional_title,
        'Directory description': doctor.description
      })
      await page.getByRole('combobox').last().selectOption({ label: 'Active / open' })
      await submit(
        'Create doctor',
        'create-hospital-doctor',
        {
          departmentId: department.id,
          title: doctor.title,
          professionalTitle: doctor.professional_title,
          description: doctor.description,
          active: true
        },
        doctor,
        { 'hospital-management-doctors': [doctor], 'hospital-doctors': [doctor] }
      )
      await choose()
      await navigate('Edit doctor')
      await expect(page.getByPlaceholder('Professional title', { exact: true })).toHaveValue(
        'Consultant'
      )
      await expect(
        page.getByRole('button', { name: 'Choose · Active department', exact: true })
      ).toHaveCount(0)
      await submit(
        'Edit doctor',
        'update-hospital-doctor',
        {
          doctorId: doctor.id,
          title: doctor.title,
          professionalTitle: doctor.professional_title,
          description: doctor.description,
          active: true
        },
        { ...doctor, version: 1 },
        { 'hospital-management-doctors': [{ ...doctor, version: 1 }] }
      )

      await navigate('Manage hospital sessions')
      await navigate('Create hospital session')
      await expect(
        page.getByRole('button', { name: 'Choose · Active doctor', exact: true })
      ).toHaveCount(0)
      await navigate('Choose · Active department')
      await navigate('Choose · Active doctor')
      // Re-selecting the parent must revoke the chosen doctor until chosen again.
      await navigate('Choose · Active department')
      await expect(page.getByText('Selected: Dr Lin', { exact: true })).toHaveCount(0)
      await navigate('Choose · Active doctor')
      await fill({
        'Session name': slot.title,
        Location: slot.location,
        'Start time (zoned ISO 8601)': slot.starts_at,
        'End time (zoned ISO 8601)': slot.ends_at,
        Capacity: '2',
        'Reference fee (CNY cents)': '2500'
      })
      await submit(
        'Create hospital session',
        'create-hospital-slot',
        {
          departmentId: department.id,
          doctorId: doctor.id,
          title: slot.title,
          location: slot.location,
          // The reviewed datetime parameter codec emits canonical microseconds.
          startsAt: '2030-01-01T01:00:00.000000Z',
          endsAt: '2030-01-01T02:00:00.000000Z',
          capacity: 2,
          feeCents: 2500
        },
        slot,
        { 'hospital-management-slots': [slot], 'hospital-slots': [slot] }
      )
      await choose()
      await navigate('Edit session capacity')
      await expect(
        page.getByPlaceholder('Start time (zoned ISO 8601)', { exact: true })
      ).toHaveCount(0)
      await expect(page.getByPlaceholder('Reference fee (CNY cents)', { exact: true })).toHaveCount(
        0
      )
      await fill({ Capacity: '3' })
      await page.getByRole('combobox').last().selectOption({ label: 'Inactive / closed' })
      await submit(
        'Edit session capacity',
        'update-hospital-slot',
        { slotId: slot.id, capacity: 3, active: false },
        { ...slot, capacity: 3, active: false, version: 1 },
        {
          'hospital-management-slots': [{ ...slot, capacity: 3, active: false, version: 1 }],
          'hospital-slots': []
        }
      )
      await expect(page.getByText('Capacity: 3', { exact: true }).first()).toBeVisible()
      await page.screenshot({ path: info.outputPath('hospital-admin-session.png'), fullPage: true })
      expect(api.calls).toHaveLength(7)
      expect(new Set(api.calls.map((call) => call.key)).size).toBe(7)
    })
  })
}
