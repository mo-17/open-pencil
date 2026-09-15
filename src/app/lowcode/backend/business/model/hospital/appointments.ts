import type {
  BackendCommandDefinitionIR,
  BackendCommandStepIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import { availableSlot, futureSlot } from '../booking/steps'
import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { HOSPITAL_APPOINTMENT_FIELDS, type HospitalEntities } from './fields'
import {
  hospitalActive,
  hospitalAppointmentCatalog,
  hospitalAppointmentRead,
  hospitalDepartmentRead,
  hospitalDoctorRead,
  hospitalHistory,
  hospitalPatientAccess,
  hospitalPatientRead,
  hospitalRevision,
  hospitalSlotCounter,
  hospitalSlotRead
} from './steps'

const mutationParameters = () => [
  businessUUIDParameter('patientId'),
  businessUUIDParameter('appointmentId'),
  businessStringParameter('note', 500)
]
const returns = { resultName: 'updated', fields: [...HOSPITAL_APPOINTMENT_FIELDS] }
const state = (status: string) =>
  businessAssert(
    'appointment_state',
    businessResult('appointment', 'status'),
    businessLiteral(status)
  )

function snapshots(): BackendCommandValueIR[] {
  return [
    ...['department_title', 'doctor_title', 'starts_at', 'ends_at', 'location', 'fee_cents'].map(
      (field) => ({ field, value: businessResult('slot', field) })
    ),
    ...(
      [
        ['patient_name', 'title'],
        ['patient_contact', 'contact'],
        ['patient_relationship', 'relationship']
      ] as const
    ).map(([field, source]) => ({ field, value: businessResult('patient', source) }))
  ]
}
function availability(): BackendCommandStepIR[] {
  return [
    hospitalActive('patient'),
    hospitalActive('department'),
    hospitalActive('doctor'),
    ...futureSlot('slot'),
    ...availableSlot('slot', businessLiteral(1))
  ]
}
function reserve(entities: HospitalEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'reserve-hospital-appointment',
    'Reserve one place for my active patient record',
    hospitalPatientAccess(entities, 'active'),
    ['patientId', 'departmentId', 'doctorId', 'slotId'].map(businessUUIDParameter),
    [
      hospitalPatientRead(entities),
      hospitalDepartmentRead(entities),
      ...hospitalDoctorRead(entities),
      ...hospitalSlotRead(entities),
      ...availability(),
      hospitalSlotCounter(entities, 'add'),
      businessInsert(
        entities.appointments,
        'appointment',
        [
          { field: 'owner_id', value: businessCaller() },
          { field: 'patient_id', value: businessResult('patient', 'id') },
          { field: 'department_id', value: businessResult('department', 'id') },
          { field: 'doctor_id', value: businessResult('doctor', 'id') },
          { field: 'slot_id', value: businessResult('slot', 'id') },
          ...snapshots()
        ],
        HOSPITAL_APPOINTMENT_FIELDS
      ),
      hospitalHistory(entities, 'reserved', businessLiteral(''))
    ],
    { resultName: 'appointment', fields: [...HOSPITAL_APPOINTMENT_FIELDS] }
  )
}
function cancel(entities: HospitalEntities, staff: boolean): BackendCommandDefinitionIR {
  return businessCommand(
    staff ? 'cancel-managed-hospital-appointment' : 'cancel-hospital-appointment',
    staff
      ? 'Cancel an unchecked appointment for administrative reasons'
      : 'Cancel my future appointment once',
    hospitalPatientAccess(entities, staff ? 'staff' : 'owner'),
    mutationParameters(),
    [
      ...hospitalAppointmentRead(entities, staff),
      state('confirmed'),
      ...hospitalAppointmentCatalog(entities),
      ...(staff
        ? []
        : [
            businessAssert(
              'future_appointment',
              businessResult('appointment', 'starts_at'),
              { kind: 'server-now' },
              'gte'
            )
          ]),
      businessAssert(
        'held_capacity',
        businessResult('slot', 'reserved'),
        businessLiteral(1),
        'gte'
      ),
      hospitalSlotCounter(entities, 'subtract'),
      hospitalHistory(entities, staff ? 'cancelled_by_staff' : 'cancelled'),
      businessUpdate(
        entities.appointments,
        'appointment',
        'updated',
        [{ field: 'status', value: businessLiteral('cancelled') }, hospitalRevision('appointment')],
        HOSPITAL_APPOINTMENT_FIELDS
      )
    ],
    returns
  )
}
function restore(entities: HospitalEntities): BackendCommandDefinitionIR {
  return businessCommand(
    'restore-hospital-appointment',
    'Restore my cancelled appointment after rechecking current capacity',
    hospitalPatientAccess(entities, 'active'),
    mutationParameters(),
    [
      ...hospitalAppointmentRead(entities),
      state('cancelled'),
      ...hospitalAppointmentCatalog(entities),
      ...availability(),
      hospitalSlotCounter(entities, 'add'),
      hospitalHistory(entities, 'restored'),
      businessUpdate(
        entities.appointments,
        'appointment',
        'updated',
        [
          ...snapshots(),
          { field: 'status', value: businessLiteral('confirmed') },
          hospitalRevision('appointment')
        ],
        HOSPITAL_APPOINTMENT_FIELDS
      )
    ],
    returns
  )
}
function attendance(entities: HospitalEntities, complete: boolean): BackendCommandDefinitionIR {
  const next = complete ? 'completed' : 'checked_in'
  return businessCommand(
    complete ? 'complete-hospital-appointment' : 'check-in-hospital-appointment',
    complete
      ? 'Record administrative completion of a checked-in appointment'
      : 'Check in a confirmed appointment within its scheduled time',
    hospitalPatientAccess(entities, 'staff'),
    mutationParameters(),
    [
      ...hospitalAppointmentRead(entities, true),
      state(complete ? 'checked_in' : 'confirmed'),
      ...hospitalAppointmentCatalog(entities),
      businessAssert(
        'appointment_started',
        { kind: 'server-now' },
        businessResult('appointment', 'starts_at'),
        'gte'
      ),
      ...(complete
        ? []
        : [
            businessAssert(
              'checkin_window',
              { kind: 'server-now' },
              businessResult('appointment', 'ends_at'),
              'lte'
            )
          ]),
      hospitalHistory(entities, next),
      businessUpdate(
        entities.appointments,
        'appointment',
        'updated',
        [{ field: 'status', value: businessLiteral(next) }, hospitalRevision('appointment')],
        HOSPITAL_APPOINTMENT_FIELDS
      )
    ],
    returns
  )
}

export function hospitalAppointmentCommands(
  entities: HospitalEntities
): BackendCommandDefinitionIR[] {
  return [
    reserve(entities),
    cancel(entities, false),
    restore(entities),
    cancel(entities, true),
    attendance(entities, false),
    attendance(entities, true)
  ]
}
