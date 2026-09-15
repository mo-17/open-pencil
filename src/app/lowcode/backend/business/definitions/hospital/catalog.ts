import {
  businessText as t,
  type BusinessInput,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, profileInput, selectedParameter, textInput } from '../shared'
import {
  hospitalActive,
  hospitalActiveInput,
  hospitalDepartmentColumns,
  hospitalDoctorColumns,
  hospitalSlotColumns
} from './fields'

const description = {
  field: 'description',
  label: t('Directory description', '目录说明'),
  multiline: true
}
const active = { field: 'active', label: t('Active', '启用') }

export function hospitalDepartmentsPage(): BusinessPageDefinition {
  return {
    id: 'hospital-departments',
    path: '/hospital/departments',
    title: t('Hospital departments', '医院科室'),
    public: true,
    description: t(
      'Browse the hospital directory and its listed doctors. Use Doctors or Registration to review published sessions. Directory descriptions are administrative information, not a diagnosis or treatment recommendation.',
      '浏览本院科室及所属医生，再前往医生目录或排班挂号查看开放排班。目录说明仅为行政信息，不提供诊断或治疗建议。'
    ),
    listing: {
      resourceId: 'hospital-departments',
      columns: hospitalDepartmentColumns,
      search: true
    },
    details: [...hospitalDepartmentColumns, description],
    related: [
      {
        resourceId: 'hospital-doctors',
        foreignKey: 'department_id',
        title: t('Department doctors', '科室医生'),
        columns: hospitalDoctorColumns
      }
    ],
    actions: []
  }
}
export function hospitalDoctorsPage(): BusinessPageDefinition {
  return {
    id: 'hospital-doctors',
    path: '/hospital/doctors',
    title: t('Hospital doctors', '医生目录'),
    public: true,
    description: t(
      'Search by doctor or department, select a doctor and inspect their open sessions. Go to Registration to select a session and one of your saved patients. The server checks time and capacity when reserving.',
      '按医生或科室搜索，选择医生查看开放排班，再前往排班挂号选择时段及本人管理的就诊人。预约时服务器会检查时间与余量。'
    ),
    listing: { resourceId: 'hospital-doctors', columns: hospitalDoctorColumns, search: true },
    details: [...hospitalDoctorColumns, description],
    related: [
      {
        resourceId: 'hospital-slots',
        foreignKey: 'doctor_id',
        title: t('Doctor sessions', '医生排班'),
        columns: hospitalSlotColumns
      }
    ],
    actions: []
  }
}
export function hospitalDepartmentManagementPage(): BusinessPageDefinition {
  const inputs = [
    textInput('title', 'Department name', '科室名称'),
    textInput('description', 'Directory description', '目录说明', 1000),
    textInput('location', 'Location', '地点', 200)
  ]
  return {
    id: 'hospital-management-departments',
    path: '/hospital/admin/departments',
    title: t('Manage departments', '科室管理'),
    description: t(
      'Requires hospital-admin. Maintain the hospital directory and availability. Disabling a department stops new registrations but does not cancel existing appointments; handle those individually in Registration desk.',
      '需要 hospital-admin。维护科室目录及启用状态；停用科室会阻止新预约，但不会自动取消已有预约，请到挂号处理逐条处理。'
    ),
    listing: {
      resourceId: 'hospital-management-departments',
      columns: [...hospitalDepartmentColumns, active],
      search: true,
      filter: { field: 'active', choices: hospitalActive }
    },
    details: [...hospitalDepartmentColumns, description, active],
    actions: [
      formAction({
        id: 'create-hospital-department',
        en: 'Create department',
        zh: '新增科室',
        inputs: [profileInput('my-profile'), ...inputs, hospitalActiveInput()]
      }),
      formAction({
        id: 'update-hospital-department',
        en: 'Edit department',
        zh: '编辑科室',
        inputs: [
          ...inputs.map((input) => ({ ...input, fromSelection: input.key })),
          hospitalActiveInput(true)
        ],
        parameters: { departmentId: selectedParameter() }
      })
    ]
  }
}
export function hospitalDoctorManagementPage(): BusinessPageDefinition {
  const fields: BusinessInput[] = [
    textInput('title', 'Doctor name', '医生姓名'),
    textInput('professionalTitle', 'Professional title', '职称'),
    textInput('description', 'Directory description', '目录说明', 1000)
  ]
  return {
    id: 'hospital-management-doctors',
    path: '/hospital/admin/doctors',
    title: t('Manage doctors', '医生管理'),
    description: t(
      'Requires hospital-admin. Choose an active department when creating a doctor. The department cannot be changed afterward. Directory edits do not rewrite existing session or appointment snapshots. Do not enter patient medical information.',
      '需要 hospital-admin。创建医生时选择启用科室，创建后不可更换所属科室。目录编辑不会改写已有排班或预约快照；请勿填写患者医疗信息。'
    ),
    listing: {
      resourceId: 'hospital-management-doctors',
      columns: [...hospitalDoctorColumns, active],
      search: true,
      filter: { field: 'active', choices: hospitalActive }
    },
    details: [...hospitalDoctorColumns, description, active],
    actions: [
      formAction({
        id: 'create-hospital-doctor',
        en: 'Create doctor',
        zh: '新增医生',
        inputs: [
          {
            key: 'departmentId',
            label: t('Active department', '启用科室'),
            kind: 'relation',
            relation: {
              resourceId: 'hospital-management-departments',
              labelField: 'title',
              columns: hospitalDepartmentColumns,
              filters: { active: { kind: 'literal', value: true } }
            }
          },
          ...fields,
          hospitalActiveInput()
        ]
      }),
      formAction({
        id: 'update-hospital-doctor',
        en: 'Edit doctor',
        zh: '编辑医生',
        inputs: [
          ...fields.map((input) => ({
            ...input,
            fromSelection: input.key === 'professionalTitle' ? 'professional_title' : input.key
          })),
          hospitalActiveInput(true)
        ],
        parameters: { doctorId: selectedParameter() }
      })
    ]
  }
}
