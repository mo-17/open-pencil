import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter, textInput } from '../shared'
import { hospitalActive, hospitalActiveInput, hospitalPatientColumns } from './fields'

export function hospitalPatientsPage(): BusinessPageDefinition {
  const fields = [
    textInput('title', 'Patient name', '就诊人姓名'),
    { ...textInput('contact', 'Contact (optional)', '联系方式（可选）'), required: false },
    {
      ...textInput('relationship', 'Relationship (optional)', '与本人关系（可选）', 50),
      required: false
    }
  ]
  return {
    id: 'hospital-patients',
    path: '/hospital/patients',
    title: t('My patients', '我的就诊人'),
    description: t(
      'Save names and contact details for patients you manage. Only your account can read or edit these records. No government ID, diagnosis or medical history is requested, and the template does not verify a real-world identity or relationship. Inactive patients cannot receive new reservations.',
      '登记本人管理的就诊人姓名、联系方式和关系，仅本账号可以读取或编辑这些记录。不采集身份证、诊断或病历，也不核验自然人身份或关系。停用后不能为该就诊人新增预约。'
    ),
    listing: {
      resourceId: 'hospital-patients',
      columns: hospitalPatientColumns,
      search: true,
      filter: { field: 'active', choices: hospitalActive }
    },
    actions: [
      formAction({
        id: 'create-hospital-patient',
        en: 'Add patient',
        zh: '新增就诊人',
        inputs: fields
      }),
      formAction({
        id: 'update-hospital-patient',
        en: 'Edit patient',
        zh: '编辑就诊人',
        inputs: [
          ...fields.map((input) => ({ ...input, fromSelection: input.key })),
          hospitalActiveInput(true)
        ],
        parameters: { patientId: selectedParameter() },
        description: t(
          'Update this patient or mark the record inactive. Existing appointments keep their recorded patient details; restoring a cancelled appointment refreshes them from the active patient record.',
          '更新就诊人资料或停用记录。已有预约保留当时的资料快照；恢复已取消预约时，会从启用的就诊人记录重新获取资料。'
        )
      })
    ]
  }
}
