import type {
  BackendApplicationSpecV1,
  BackendHttpAPIQueryIRV1,
  DataEntityIR
} from '@open-pencil/lowcode/backend'

import { businessGrant, businessOwnerGrant, businessReadResource } from '../permissions'
import {
  HOSPITAL_ADMIN,
  HOSPITAL_ROLES,
  HOSPITAL_DEPARTMENT_FIELDS,
  HOSPITAL_DOCTOR_FIELDS,
  HOSPITAL_SLOT_FIELDS,
  HOSPITAL_PATIENT_FIELDS,
  HOSPITAL_APPOINTMENT_FIELDS,
  HOSPITAL_HISTORY_FIELDS,
  type HospitalEntities
} from './fields'

export const HOSPITAL_PATIENT_STAFF_POLICIES = HOSPITAL_ROLES.map(
  (role) => 'hospital-patient-command-' + role
)

export function hospitalPermissions(
  app: BackendApplicationSpecV1,
  entities: HospitalEntities
): void {
  const add = (
    entity: DataEntityIR,
    id: string,
    fields: readonly string[],
    policyIds: string[],
    query: BackendHttpAPIQueryIRV1
  ) => {
    businessReadResource(app, entity, id, fields, policyIds).query = query
  }
  const catalog = [
    [
      'departments',
      entities.departments,
      HOSPITAL_DEPARTMENT_FIELDS,
      ['active'],
      ['title', 'location']
    ],
    [
      'doctors',
      entities.doctors,
      HOSPITAL_DOCTOR_FIELDS,
      ['department_id', 'active'],
      ['title', 'department_title']
    ],
    [
      'slots',
      entities.slots,
      HOSPITAL_SLOT_FIELDS,
      ['department_id', 'doctor_id', 'active'],
      ['title', 'department_title', 'doctor_title']
    ]
  ] as const
  for (const [suffix, entity, fields, filters, searches] of catalog) {
    const publicId = 'hospital-public-' + suffix
    app.auth.rowAccess.push({
      id: publicId,
      entityId: entity.id,
      effect: 'allow',
      operations: ['select'],
      principal: { kind: 'anonymous' },
      conditions: [{ fieldId: 'active', value: true }]
    })
    const management = businessGrant(app, entity, 'hospital-manage-' + suffix, {
      kind: 'role',
      roleId: HOSPITAL_ADMIN
    })
    const query = {
      filterFields: [...filters],
      searchFields: [...searches],
      sortFields: suffix === 'slots' ? ['starts_at', 'created_at'] : ['created_at']
    }
    add(entity, 'hospital-' + suffix, fields, [publicId], query)
    add(entity, 'hospital-management-' + suffix, fields, [management], query)
  }
  const ownPatient = businessOwnerGrant(app, entities.patients)
  app.auth.rowAccess.push({
    id: 'hospital-active-patient',
    entityId: entities.patients.id,
    effect: 'allow',
    operations: ['select'],
    principal: { kind: 'owner', ownershipId: ownPatient },
    conditions: [{ fieldId: 'active', value: true }]
  })
  // These grants authorize administrative commands only. The patient directory below
  // deliberately selects only the owner policy; staff read the necessary appointment snapshot.
  for (const roleId of HOSPITAL_ROLES)
    businessGrant(app, entities.patients, 'hospital-patient-command-' + roleId, {
      kind: 'role',
      roleId
    })
  add(entities.patients, 'hospital-patients', HOSPITAL_PATIENT_FIELDS, [ownPatient], {
    filterFields: ['active'],
    searchFields: ['title'],
    sortFields: ['created_at']
  })
  for (const [entity, suffix, fields, filters, searches, sorts] of [
    [
      entities.appointments,
      'appointments',
      HOSPITAL_APPOINTMENT_FIELDS,
      ['patient_id', 'department_id', 'doctor_id', 'slot_id', 'status'],
      ['department_title', 'doctor_title', 'patient_name'],
      ['starts_at', 'created_at']
    ],
    [
      entities.history,
      'appointment-history',
      HOSPITAL_HISTORY_FIELDS,
      ['appointment_id', 'patient_id', 'action'],
      [],
      ['created_at']
    ]
  ] as const) {
    const owner = businessOwnerGrant(app, entity)
    const staff = HOSPITAL_ROLES.map((roleId) =>
      businessGrant(app, entity, 'hospital-' + suffix + '-' + roleId, { kind: 'role', roleId })
    )
    const query = {
      filterFields: [...filters],
      searchFields: [...searches],
      sortFields: [...sorts]
    }
    add(entity, 'hospital-' + suffix, fields, [owner], query)
    add(entity, 'hospital-management-' + suffix, fields, staff, query)
  }
}
