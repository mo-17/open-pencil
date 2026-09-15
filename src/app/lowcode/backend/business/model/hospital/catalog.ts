import type {
  BackendCommandDefinitionIR,
  BackendCommandParameterIR,
  BackendCommandValueIR
} from '@open-pencil/lowcode/backend'

import {
  businessAssert,
  businessCaller,
  businessCommand,
  businessInsert,
  businessLiteral,
  businessParameter,
  businessRead,
  businessResult,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import {
  HOSPITAL_ADMIN,
  HOSPITAL_DEPARTMENT_FIELDS,
  HOSPITAL_DOCTOR_FIELDS,
  type HospitalEntities
} from './fields'
import { hospitalActive, hospitalDepartmentRead, hospitalRevision, hospitalTitle } from './steps'

const access = { kind: 'role', roleId: HOSPITAL_ADMIN } as const
const active: BackendCommandParameterIR = { name: 'active', type: 'boolean', required: true }
const deptParams = () => [
  businessStringParameter('title', 100),
  businessStringParameter('description', 1000),
  businessStringParameter('location', 200),
  active
]
const doctorParams = () => [
  businessStringParameter('title', 100),
  businessStringParameter('professionalTitle', 100),
  businessStringParameter('description', 1000),
  active
]
const values = (fields: readonly (readonly [string, string])[]): BackendCommandValueIR[] =>
  fields.map(([field, parameter]) => ({ field, value: businessParameter(parameter) }))
const deptValues = () =>
  values([
    ['title', 'title'],
    ['description', 'description'],
    ['location', 'location'],
    ['active', 'active']
  ])
const doctorValues = () =>
  values([
    ['title', 'title'],
    ['professional_title', 'professionalTitle'],
    ['description', 'description'],
    ['active', 'active']
  ])

export function hospitalCatalogCommands(entities: HospitalEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'create-hospital-department',
      'Create a hospital department',
      access,
      [businessUUIDParameter('userId'), ...deptParams()],
      [
        businessRead(
          entities.users,
          'profile',
          businessParameter('userId'),
          ['id', 'active'],
          'owner'
        ),
        businessAssert(
          'active_profile',
          businessResult('profile', 'active'),
          businessLiteral(true)
        ),
        hospitalTitle(),
        businessInsert(
          entities.departments,
          'department',
          [{ field: 'owner_id', value: businessCaller() }, ...deptValues()],
          HOSPITAL_DEPARTMENT_FIELDS
        )
      ],
      { resultName: 'department', fields: [...HOSPITAL_DEPARTMENT_FIELDS] }
    ),
    businessCommand(
      'update-hospital-department',
      'Update department display and availability',
      access,
      [businessUUIDParameter('departmentId'), ...deptParams()],
      [
        hospitalDepartmentRead(entities),
        hospitalTitle(),
        businessUpdate(
          entities.departments,
          'department',
          'updated',
          [...deptValues(), hospitalRevision('department')],
          HOSPITAL_DEPARTMENT_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...HOSPITAL_DEPARTMENT_FIELDS] }
    ),
    businessCommand(
      'create-hospital-doctor',
      'Create a doctor under an active department',
      access,
      [businessUUIDParameter('departmentId'), ...doctorParams()],
      [
        hospitalDepartmentRead(entities),
        hospitalActive('department'),
        hospitalTitle(),
        businessInsert(
          entities.doctors,
          'doctor',
          [
            { field: 'owner_id', value: businessCaller() },
            { field: 'department_id', value: businessResult('department', 'id') },
            { field: 'department_title', value: businessResult('department', 'title') },
            ...doctorValues()
          ],
          HOSPITAL_DOCTOR_FIELDS
        )
      ],
      { resultName: 'doctor', fields: [...HOSPITAL_DOCTOR_FIELDS] }
    ),
    businessCommand(
      'update-hospital-doctor',
      'Update doctor display without changing department',
      access,
      [businessUUIDParameter('doctorId'), ...doctorParams()],
      [
        businessRead(
          entities.doctors,
          'doctor',
          businessParameter('doctorId'),
          HOSPITAL_DOCTOR_FIELDS
        ),
        hospitalTitle(),
        businessUpdate(
          entities.doctors,
          'doctor',
          'updated',
          [...doctorValues(), hospitalRevision('doctor')],
          HOSPITAL_DOCTOR_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...HOSPITAL_DOCTOR_FIELDS] }
    )
  ]
}
