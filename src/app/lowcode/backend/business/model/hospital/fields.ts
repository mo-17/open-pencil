import type { DataEntityIR } from '@open-pencil/lowcode/backend'

export const HOSPITAL_ROLES = ['hospital-admin', 'hospital-staff'] as const
export const HOSPITAL_ADMIN = HOSPITAL_ROLES[0]
export const HOSPITAL_DEPARTMENT_FIELDS = [
  'id',
  'title',
  'description',
  'location',
  'active',
  'version',
  'created_at'
]
export const HOSPITAL_DOCTOR_FIELDS = [
  'id',
  'department_id',
  'department_title',
  'title',
  'professional_title',
  'description',
  'active',
  'version',
  'created_at'
]
export const HOSPITAL_SLOT_FIELDS = [
  'id',
  'department_id',
  'doctor_id',
  'department_title',
  'doctor_title',
  'title',
  'location',
  'starts_at',
  'ends_at',
  'capacity',
  'reserved',
  'fee_cents',
  'active',
  'version',
  'created_at'
]
export const HOSPITAL_PATIENT_FIELDS = [
  'id',
  'title',
  'contact',
  'relationship',
  'active',
  'version',
  'created_at'
]
export const HOSPITAL_APPOINTMENT_FIELDS = [
  'id',
  'patient_id',
  'department_id',
  'doctor_id',
  'slot_id',
  'department_title',
  'doctor_title',
  'patient_name',
  'patient_contact',
  'patient_relationship',
  'starts_at',
  'ends_at',
  'location',
  'fee_cents',
  'status',
  'version',
  'created_at'
]
export const HOSPITAL_HISTORY_FIELDS = [
  'id',
  'appointment_id',
  'patient_id',
  'actor_subject',
  'action',
  'note',
  'created_at'
]

export interface HospitalEntities {
  users: DataEntityIR
  departments: DataEntityIR
  doctors: DataEntityIR
  slots: DataEntityIR
  patients: DataEntityIR
  appointments: DataEntityIR
  history: DataEntityIR
}
