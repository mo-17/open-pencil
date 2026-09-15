import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'
import { BUSINESS_BROWSER_USER_ID } from '#tests/helpers/compiler/business/helpers'

export const hospitalTestId = (suffix: string) =>
  '00000000-0000-4000-8000-' + suffix.padStart(12, '0')
export const hospitalRecordedAt = '2026-09-15T00:00:00.000Z'
export const hospitalDepartment = {
  id: hospitalTestId('10'),
  title: 'General outpatient',
  description: 'Outpatient registration directory',
  location: 'West wing',
  active: true,
  version: 0,
  created_at: hospitalRecordedAt
}
export const hospitalDoctor = {
  id: hospitalTestId('20'),
  department_id: hospitalDepartment.id,
  department_title: hospitalDepartment.title,
  title: 'Dr Lin',
  professional_title: 'Consultant',
  description: 'Outpatient sessions',
  active: true,
  version: 0,
  created_at: hospitalRecordedAt
}
export const hospitalSlot = {
  id: hospitalTestId('30'),
  department_id: hospitalDepartment.id,
  doctor_id: hospitalDoctor.id,
  department_title: hospitalDepartment.title,
  doctor_title: hospitalDoctor.title,
  title: 'Morning session',
  location: 'Room 12',
  starts_at: '2030-01-01T01:00:00.000Z',
  ends_at: '2030-01-01T02:00:00.000Z',
  capacity: 2,
  reserved: 0,
  fee_cents: 2500,
  active: true,
  version: 0,
  created_at: hospitalRecordedAt
}
export const hospitalPatient = {
  id: hospitalTestId('40'),
  title: 'Alice',
  contact: '',
  relationship: '',
  active: true,
  version: 0,
  created_at: hospitalRecordedAt
}
export const hospitalAppointment = {
  id: hospitalTestId('50'),
  patient_id: hospitalPatient.id,
  department_id: hospitalDepartment.id,
  doctor_id: hospitalDoctor.id,
  slot_id: hospitalSlot.id,
  department_title: hospitalDepartment.title,
  doctor_title: hospitalDoctor.title,
  patient_name: hospitalPatient.title,
  patient_contact: '',
  patient_relationship: '',
  starts_at: hospitalSlot.starts_at,
  ends_at: hospitalSlot.ends_at,
  location: hospitalSlot.location,
  fee_cents: 2500,
  status: 'confirmed',
  version: 0,
  created_at: hospitalRecordedAt
}
export function hospitalCatalogResources(): Record<string, BusinessTestRow[]> {
  return {
    'hospital-departments': [hospitalDepartment],
    'hospital-management-departments': [hospitalDepartment],
    'hospital-doctors': [hospitalDoctor],
    'hospital-management-doctors': [hospitalDoctor],
    'hospital-slots': [hospitalSlot],
    'hospital-management-slots': [hospitalSlot]
  }
}
export function hospitalHistoryRow(action: string, note: string, version: number) {
  return {
    id: hospitalTestId('6' + version),
    appointment_id: hospitalAppointment.id,
    patient_id: hospitalPatient.id,
    actor_subject: BUSINESS_BROWSER_USER_ID,
    action,
    note,
    created_at: hospitalRecordedAt
  }
}
