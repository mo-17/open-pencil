import type {
  BackendCommandDefinitionIR,
  BackendCommandLeafIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessUpdate,
  businessCaller
} from '../commands'
import {
  HOSPITAL_PATIENT_FIELDS,
  HOSPITAL_DEPARTMENT_FIELDS,
  HOSPITAL_DOCTOR_FIELDS,
  HOSPITAL_SLOT_FIELDS,
  HOSPITAL_APPOINTMENT_FIELDS,
  HOSPITAL_HISTORY_FIELDS,
  type HospitalEntities
} from './fields'
import { HOSPITAL_PATIENT_STAFF_POLICIES } from './permissions'

export function hospitalPatientAccess(
  entities: HospitalEntities,
  mode: 'active' | 'owner' | 'staff'
): BackendCommandDefinitionIR['access'] {
  return {
    kind: 'row-policy',
    entityId: entities.patients.id,
    parameter: 'patientId',
    policyIds:
      mode === 'staff'
        ? [...HOSPITAL_PATIENT_STAFF_POLICIES]
        : [mode === 'active' ? 'hospital-active-patient' : 'own-hospital-patients']
  }
}
export function hospitalPatientRead(
  entities: HospitalEntities,
  staff = false
): BackendCommandStepIR {
  return businessRead(
    entities.patients,
    'patient',
    businessParameter('patientId'),
    ['owner_id', ...HOSPITAL_PATIENT_FIELDS],
    staff ? 'command' : 'owner'
  )
}
export function hospitalRevision(record: string): BackendCommandValueIR {
  return {
    field: 'version',
    value: {
      kind: 'integer-arithmetic',
      operator: 'add',
      left: businessResult(record, 'version'),
      right: businessLiteral(1)
    }
  }
}
export function hospitalActive(record: string): BackendCommandStepIR {
  return businessAssert(record + '_active', businessResult(record, 'active'), businessLiteral(true))
}
export function hospitalTitle(): BackendCommandStepIR {
  return businessAssert('nonempty_title', businessParameter('title'), businessLiteral(''), 'neq')
}
export function hospitalDepartmentRead(
  entities: HospitalEntities,
  key = businessParameter('departmentId')
): BackendCommandStepIR {
  return businessRead(entities.departments, 'department', key, HOSPITAL_DEPARTMENT_FIELDS)
}
export function hospitalDoctorRead(
  entities: HospitalEntities,
  key = businessParameter('doctorId')
): BackendCommandStepIR[] {
  return [
    businessRead(entities.doctors, 'doctor', key, HOSPITAL_DOCTOR_FIELDS),
    businessAssert(
      'doctor_department',
      businessResult('doctor', 'department_id'),
      businessResult('department', 'id')
    )
  ]
}
export function hospitalSlotRead(
  entities: HospitalEntities,
  key = businessParameter('slotId')
): BackendCommandStepIR[] {
  return [
    businessRead(entities.slots, 'slot', key, HOSPITAL_SLOT_FIELDS),
    businessAssert(
      'slot_department',
      businessResult('slot', 'department_id'),
      businessResult('department', 'id')
    ),
    businessAssert(
      'slot_doctor',
      businessResult('slot', 'doctor_id'),
      businessResult('doctor', 'id')
    )
  ]
}
export function hospitalSlotCounter(
  entities: HospitalEntities,
  operator: 'add' | 'subtract'
): BackendCommandStepIR {
  return businessUpdate(
    entities.slots,
    'slot',
    'slot_updated',
    [
      {
        field: 'reserved',
        value: {
          kind: 'integer-arithmetic',
          operator,
          left: businessResult('slot', 'reserved'),
          right: businessLiteral(1)
        }
      },
      hospitalRevision('slot')
    ],
    HOSPITAL_SLOT_FIELDS
  )
}
export function hospitalAppointmentRead(
  entities: HospitalEntities,
  staff = false
): BackendCommandStepIR[] {
  return [
    hospitalPatientRead(entities, staff),
    businessRead(
      entities.appointments,
      'appointment',
      businessParameter('appointmentId'),
      ['owner_id', ...HOSPITAL_APPOINTMENT_FIELDS],
      staff ? 'command' : 'owner'
    ),
    businessAssert(
      'appointment_patient',
      businessResult('appointment', 'patient_id'),
      businessResult('patient', 'id')
    ),
    businessAssert(
      'appointment_owner',
      businessResult('appointment', 'owner_id'),
      businessResult('patient', 'owner_id')
    )
  ]
}
export function hospitalAppointmentCatalog(entities: HospitalEntities): BackendCommandStepIR[] {
  return [
    hospitalDepartmentRead(entities, businessResult('appointment', 'department_id')),
    ...hospitalDoctorRead(entities, businessResult('appointment', 'doctor_id')),
    ...hospitalSlotRead(entities, businessResult('appointment', 'slot_id'))
  ]
}
export function hospitalHistory(
  entities: HospitalEntities,
  action: string,
  note: BackendCommandLeafIR = businessParameter('note')
): BackendCommandStepIR {
  return businessInsert(
    entities.history,
    'history',
    [
      { field: 'owner_id', value: businessResult('patient', 'owner_id') },
      { field: 'patient_id', value: businessResult('patient', 'id') },
      { field: 'appointment_id', value: businessResult('appointment', 'id') },
      { field: 'actor_subject', value: businessCaller() },
      { field: 'action', value: businessLiteral(action) },
      { field: 'note', value: note }
    ],
    HOSPITAL_HISTORY_FIELDS
  )
}
