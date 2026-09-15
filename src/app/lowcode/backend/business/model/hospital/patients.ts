import type { BackendCommandDefinitionIR } from '@open-pencil/lowcode/backend'

import {
  businessCaller,
  businessCommand,
  businessInsert,
  businessParameter,
  businessStringParameter,
  businessUUIDParameter,
  businessUpdate
} from '../commands'
import { HOSPITAL_PATIENT_FIELDS, type HospitalEntities } from './fields'
import {
  hospitalPatientAccess,
  hospitalPatientRead,
  hospitalRevision,
  hospitalTitle
} from './steps'

const fields = ['title', 'contact', 'relationship'] as const
const parameters = () =>
  fields.map((name) => businessStringParameter(name, name === 'relationship' ? 50 : 100))
const values = () => fields.map((field) => ({ field, value: businessParameter(field) }))

export function hospitalPatientCommands(entities: HospitalEntities): BackendCommandDefinitionIR[] {
  return [
    businessCommand(
      'create-hospital-patient',
      'Create a private patient contact record',
      { kind: 'authenticated' },
      parameters(),
      [
        hospitalTitle(),
        businessInsert(
          entities.patients,
          'patient',
          [{ field: 'owner_id', value: businessCaller() }, ...values()],
          HOSPITAL_PATIENT_FIELDS
        )
      ],
      { resultName: 'patient', fields: [...HOSPITAL_PATIENT_FIELDS] }
    ),
    businessCommand(
      'update-hospital-patient',
      'Update my patient contact record',
      hospitalPatientAccess(entities, 'owner'),
      [
        businessUUIDParameter('patientId'),
        ...parameters(),
        { name: 'active', type: 'boolean', required: true }
      ],
      [
        hospitalPatientRead(entities),
        hospitalTitle(),
        businessUpdate(
          entities.patients,
          'patient',
          'updated',
          [
            ...values(),
            { field: 'active', value: businessParameter('active') },
            hospitalRevision('patient')
          ],
          HOSPITAL_PATIENT_FIELDS
        )
      ],
      { resultName: 'updated', fields: [...HOSPITAL_PATIENT_FIELDS] }
    )
  ]
}
