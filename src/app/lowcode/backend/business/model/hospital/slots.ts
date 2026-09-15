import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { businessFutureSlotWindow } from '../scheduling'
import { HOSPITAL_ADMIN, HOSPITAL_SLOT_FIELDS, type HospitalEntities } from './fields'
import {
  hospitalActive,
  hospitalDepartmentRead,
  hospitalDoctorRead,
  hospitalRevision,
  hospitalTitle
} from './steps'

const access = { kind: 'role', roleId: HOSPITAL_ADMIN } as const
const capacity = { name: 'capacity', type: 'integer', required: true, min: 1, max: 10000 } as const

export function hospitalSlotCommands(entities: HospitalEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'create-hospital-slot',
      'Create future doctor registration capacity',
      access,
      [
        businessUUIDParameter('departmentId'),
        businessUUIDParameter('doctorId'),
        businessStringParameter('title', 100),
        businessStringParameter('location', 200),
        { name: 'startsAt', type: 'datetime', required: true },
        { name: 'endsAt', type: 'datetime', required: true },
        capacity,
        { name: 'feeCents', type: 'integer', required: true, min: 0, max: 1000000 }
      ],
      [
        hospitalDepartmentRead(entities),
        hospitalActive('department'),
        ...hospitalDoctorRead(entities),
        hospitalActive('doctor'),
        hospitalTitle(),
        ...businessFutureSlotWindow(),
        businessInsert(
          entities.slots,
          'slot',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'department_id', value: businessResult('department', 'id') },
            { field: 'doctor_id', value: businessResult('doctor', 'id') },
            { field: 'department_title', value: businessResult('department', 'title') },
            { field: 'doctor_title', value: businessResult('doctor', 'title') },
            ...(['title', 'location', 'capacity'] as const).map((field) => ({
              field,
              value: businessParameter(field)
            })),
            { field: 'starts_at', value: businessParameter('startsAt') },
            { field: 'ends_at', value: businessParameter('endsAt') },
            { field: 'fee_cents', value: businessParameter('feeCents') }
          ],
          HOSPITAL_SLOT_FIELDS
        )
      ],
      { resultName: 'slot', fields: [...HOSPITAL_SLOT_FIELDS] }
    ),
    businessCommand(
      'update-hospital-slot',
      'Adjust capacity and availability without rewriting booked time or fees',
      access,
      [
        businessUUIDParameter('slotId'),
        capacity,
        { name: 'active', type: 'boolean', required: true }
      ],
      [
        businessRead(entities.slots, 'slot', businessParameter('slotId'), HOSPITAL_SLOT_FIELDS),
        businessAssert(
          'preserve_reserved',
          businessParameter('capacity'),
          businessResult('slot', 'reserved'),
          'gte'
        ),
        businessUpdate(
          entities.slots,
          'slot',
          'updated',
          [
            { field: 'capacity', value: businessParameter('capacity') },
            { field: 'active', value: businessParameter('active') },
            hospitalRevision('slot')
          ],
          HOSPITAL_SLOT_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...HOSPITAL_SLOT_FIELDS] }
    )
  ]
}
