import { expect, test } from '@playwright/test'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import {
  finishBusinessRequest,
  submitBusinessAction,
  withBusinessBrowser
} from '#tests/helpers/compiler/business/helpers'
import {
  hospitalAppointment,
  hospitalCatalogResources,
  hospitalDepartment as department,
  hospitalDoctor as doctor,
  hospitalHistoryRow,
  hospitalPatient,
  hospitalSlot as slot
} from '#tests/helpers/compiler/business/hospital/helpers'

for (const target of ['react', 'vue'] as const) {
  test(`${target} registers a patient, reserves, cancels and restores one appointment before hospital check-in and completion`, async ({
    page
  }, info) => {
    test.setTimeout(120_000)
    // The generated React/Vue application is real. Mocked authentication and HTTP
    // do not prove actual identity, role authority, capacity races or payment.
    await withBusinessBrowser(page, 'hospital-registration', target, async ({ api, open }) => {
      Object.assign(api.resources, hospitalCatalogResources())
      const navigate = (label: string) =>
        page.getByRole('button', { name: label, exact: true }).click()
      const choose = () => navigate('Select record')
      const submit = async (
        label: string,
        commandId: string,
        payload: object,
        result: BusinessTestRow,
        resources: Record<string, BusinessTestRow[]> = {}
      ) => {
        const before = api.calls.length
        api.steps.push({ commandId, payload, result, resources })
        await submitBusinessAction(page, label)
        await expect.poll(() => api.calls.length).toBe(before + 1)
        await finishBusinessRequest(page)
      }
      await open('hospital-departments')
      await choose()
      await expect(page.getByText('Doctor: Dr Lin', { exact: true })).toBeVisible()
      await navigate('Hospital doctors')
      await choose()
      await expect(page.getByText('Session: Morning session', { exact: true })).toBeVisible()
      await navigate('My patients')
      await navigate('Add patient')
      await page.getByPlaceholder('Patient name', { exact: true }).fill('Alice')
      await submit(
        'Add patient',
        'create-hospital-patient',
        { title: 'Alice', contact: '', relationship: '' },
        hospitalPatient,
        { 'hospital-patients': [hospitalPatient] }
      )
      await navigate('Hospital registration')
      await choose()
      await expect(page.getByText('Reference fee (CNY cents): 2500', { exact: true })).toBeVisible()
      await expect(page.getByText(/No payment is collected/u)).toBeVisible()
      await navigate('Reserve appointment')
      await navigate('Choose · My active patient')
      let appointment = { ...hospitalAppointment }
      const history = [hospitalHistoryRow('reserved', '', 0)]
      await submit(
        'Reserve appointment',
        'reserve-hospital-appointment',
        {
          patientId: hospitalPatient.id,
          departmentId: department.id,
          doctorId: doctor.id,
          slotId: slot.id
        },
        appointment,
        {
          'hospital-appointments': [appointment],
          'hospital-management-appointments': [appointment],
          'hospital-appointment-history': [...history],
          'hospital-management-appointment-history': [...history],
          'hospital-slots': [{ ...slot, reserved: 1 }]
        }
      )
      const transition = async (
        label: string,
        commandId: string,
        status: string,
        note: string,
        reserved: number,
        patient = hospitalPatient
      ) => {
        await choose()
        await navigate(label)
        await page.getByPlaceholder('Administrative explanation', { exact: true }).fill(note)
        appointment = {
          ...appointment,
          status,
          patient_name: patient.title,
          patient_contact: patient.contact,
          patient_relationship: patient.relationship,
          version: appointment.version + 1
        }
        let event = status
        if (commandId === 'restore-hospital-appointment') event = 'restored'
        if (commandId === 'cancel-managed-hospital-appointment') event = 'cancelled_by_staff'
        history.push(hospitalHistoryRow(event, note, appointment.version))
        await submit(
          label,
          commandId,
          { patientId: hospitalPatient.id, appointmentId: appointment.id, note },
          appointment,
          {
            'hospital-appointments': [appointment],
            'hospital-management-appointments': [appointment],
            'hospital-appointment-history': [...history],
            'hospital-management-appointment-history': [...history],
            'hospital-slots': [{ ...slot, reserved }]
          }
        )
        await expect(page.getByText('Status: ' + status, { exact: true }).first()).toBeVisible()
      }
      await navigate('My appointments')
      await transition(
        'Cancel my appointment',
        'cancel-hospital-appointment',
        'cancelled',
        'Schedule change',
        0
      )
      await navigate('My patients')
      await choose()
      await navigate('Edit patient')
      await page.getByPlaceholder('Patient name', { exact: true }).fill('Alice updated')
      const updatedPatient = { ...hospitalPatient, title: 'Alice updated', version: 1 }
      await submit(
        'Edit patient',
        'update-hospital-patient',
        {
          patientId: hospitalPatient.id,
          title: 'Alice updated',
          contact: '',
          relationship: '',
          active: true
        },
        updatedPatient,
        { 'hospital-patients': [updatedPatient] }
      )
      await navigate('My appointments')
      await transition(
        'Restore my appointment',
        'restore-hospital-appointment',
        'confirmed',
        'Keep this session',
        1,
        updatedPatient
      )
      await choose()
      await expect(page.getByText('Patient: Alice updated', { exact: true }).first()).toBeVisible()
      await expect(
        page.getByText('Appointment ID: ' + hospitalAppointment.id, { exact: true })
      ).toBeVisible()
      await expect(page.getByText('Action: restored', { exact: true })).toBeVisible()
      await page.screenshot({
        path: info.outputPath('hospital-restored-appointment.png'),
        fullPage: true
      })
      await navigate('Registration desk')
      await transition(
        'Cancel as hospital',
        'cancel-managed-hospital-appointment',
        'cancelled',
        'Desk correction',
        0,
        updatedPatient
      )
      await navigate('My appointments')
      await transition(
        'Restore my appointment',
        'restore-hospital-appointment',
        'confirmed',
        'Appointment retained',
        1,
        updatedPatient
      )
      // Advance only this isolated browser clock to the advertised session before check-in.
      await page.clock.setSystemTime(new Date('2030-01-01T01:10:00.000Z'))
      await navigate('Registration desk')
      await transition(
        'Check in appointment',
        'check-in-hospital-appointment',
        'checked_in',
        'Arrival recorded',
        1,
        updatedPatient
      )
      await transition(
        'Complete registration handling',
        'complete-hospital-appointment',
        'completed',
        'Desk handling complete',
        1,
        updatedPatient
      )
      await choose()
      await expect(
        page.getByText('Appointment ID: ' + hospitalAppointment.id, { exact: true })
      ).toBeVisible()
      await expect(page.getByText('Action: completed', { exact: true })).toBeVisible()
      await page.screenshot({
        path: info.outputPath('hospital-desk-completed.png'),
        fullPage: true
      })
      expect(api.calls).toHaveLength(9)
      expect(new Set(api.calls.map((call) => call.key)).size).toBe(9)
      expect(
        api.calls
          .filter((call) => call.commandId === 'restore-hospital-appointment')
          .map((call) => call.payload)
      ).toEqual([
        {
          patientId: hospitalPatient.id,
          appointmentId: hospitalAppointment.id,
          note: 'Keep this session'
        },
        {
          patientId: hospitalPatient.id,
          appointmentId: hospitalAppointment.id,
          note: 'Appointment retained'
        }
      ])
      expect(api.reads).toEqual(
        expect.arrayContaining([
          'hospital-appointment-history',
          'hospital-management-appointment-history'
        ])
      )
    })
  })
}
