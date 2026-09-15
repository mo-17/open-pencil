import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { addBusinessUsers } from '../directory'
import {
  addBusinessEntity,
  businessEnum,
  businessEnumField,
  businessField,
  linkBusinessOwner
} from '../entities'
import { HOSPITAL_ADMIN, type HospitalEntities } from './fields'
import { hospitalPermissions } from './permissions'

export function createHospitalEntities(application: BackendApplicationSpecV1): HospitalEntities {
  const users = addBusinessUsers(application, [HOSPITAL_ADMIN])
  const text = (id: string) => businessField(id, 'string')
  const uuid = (id: string) => businessField(id, 'uuid')
  const revision = () => businessField('version', 'integer', 0)
  const active = () => businessField('active', 'boolean', true)
  businessEnum(application, 'hospital-appointment-status', [
    'confirmed',
    'cancelled',
    'checked_in',
    'completed'
  ])
  const departments = addBusinessEntity(application, 'hospital_departments', [
    ...['title', 'description', 'location'].map(text),
    active(),
    revision()
  ])
  const doctors = addBusinessEntity(application, 'hospital_doctors', [
    uuid('department_id'),
    ...['department_title', 'title', 'professional_title', 'description'].map(text),
    active(),
    revision()
  ])
  const slots = addBusinessEntity(application, 'hospital_slots', [
    uuid('department_id'),
    uuid('doctor_id'),
    ...['department_title', 'doctor_title', 'title', 'location'].map(text),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('capacity', 'integer'),
    businessField('reserved', 'integer', 0),
    businessField('fee_cents', 'integer'),
    active(),
    revision()
  ])
  slots.uniques?.push({ id: 'doctor-start', fields: ['doctor_id', 'starts_at'] })
  const patients = addBusinessEntity(application, 'hospital_patients', [
    ...['title', 'contact', 'relationship'].map(text),
    active(),
    revision()
  ])
  const appointments = addBusinessEntity(application, 'hospital_appointments', [
    ...['patient_id', 'department_id', 'doctor_id', 'slot_id'].map(uuid),
    ...[
      'department_title',
      'doctor_title',
      'patient_name',
      'patient_contact',
      'patient_relationship',
      'location'
    ].map(text),
    businessField('starts_at', 'datetime'),
    businessField('ends_at', 'datetime'),
    businessField('fee_cents', 'integer'),
    businessEnumField('status', 'hospital-appointment-status', 'confirmed'),
    revision()
  ])
  appointments.uniques?.push({ id: 'patient-slot', fields: ['patient_id', 'slot_id'] })
  linkBusinessOwner(appointments, 'patient_id', patients)
  // Conditionally public catalog records may belong to different hospital operators.
  // Commands lock and verify catalog references; no endpoint deletes catalog records.
  // Private patient/appointment references retain composite ownership foreign keys.
  const history = addBusinessEntity(application, 'hospital_appointment_history', [
    uuid('appointment_id'),
    uuid('patient_id'),
    uuid('actor_subject'),
    text('action'),
    text('note')
  ])
  linkBusinessOwner(history, 'appointment_id', appointments)
  linkBusinessOwner(history, 'patient_id', patients)
  const entities = { users, departments, doctors, slots, patients, appointments, history }
  hospitalPermissions(application, entities)
  return entities
}
