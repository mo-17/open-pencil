import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const hospitalActive = [
  { value: true, label: t('Active / open', '启用／开放') },
  { value: false, label: t('Inactive / closed', '停用／关闭') }
]
export const hospitalStatuses = [
  { value: 'confirmed', label: t('Confirmed', '已预约') },
  { value: 'cancelled', label: t('Cancelled', '已取消') },
  { value: 'checked_in', label: t('Checked in', '已签到') },
  { value: 'completed', label: t('Completed', '已完成') }
]
export const hospitalDepartmentColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Department', '科室') },
  { field: 'location', label: t('Location', '地点') }
]
export const hospitalDoctorColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Doctor', '医生') },
  { field: 'department_title', label: t('Department', '科室') },
  { field: 'professional_title', label: t('Professional title', '职称') }
]
export const hospitalSlotColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Session', '排班名称') },
  { field: 'doctor_title', label: t('Doctor', '医生') },
  { field: 'department_title', label: t('Department', '科室') },
  { field: 'starts_at', label: t('Starts at', '开始时间') },
  { field: 'capacity', label: t('Capacity', '号源上限') },
  { field: 'reserved', label: t('Reserved', '已预约数') }
]
export const hospitalSlotDetails: readonly BusinessColumn[] = [
  ...hospitalSlotColumns,
  { field: 'ends_at', label: t('Ends at', '结束时间') },
  { field: 'location', label: t('Location', '地点') },
  { field: 'fee_cents', label: t('Reference fee (CNY cents)', '参考费用（分）') },
  { field: 'active', label: t('Open', '开放') }
]
export const hospitalPatientColumns: readonly BusinessColumn[] = [
  { field: 'title', label: t('Patient name', '就诊人姓名') },
  { field: 'contact', label: t('Contact', '联系方式') },
  { field: 'relationship', label: t('Relationship', '关系') },
  { field: 'active', label: t('Active', '启用') }
]
export const hospitalAppointmentColumns: readonly BusinessColumn[] = [
  { field: 'patient_name', label: t('Patient', '就诊人') },
  { field: 'department_title', label: t('Department', '科室') },
  { field: 'doctor_title', label: t('Doctor', '医生') },
  { field: 'starts_at', label: t('Starts at', '开始时间') },
  { field: 'status', label: t('Status', '状态') }
]
export const hospitalAppointmentDetails: readonly BusinessColumn[] = [
  ...hospitalAppointmentColumns,
  { field: 'id', label: t('Appointment ID', '预约编号') },
  { field: 'ends_at', label: t('Ends at', '结束时间') },
  { field: 'location', label: t('Location', '地点') },
  { field: 'patient_contact', label: t('Contact', '联系方式') },
  { field: 'patient_relationship', label: t('Relationship', '关系') },
  { field: 'fee_cents', label: t('Reference fee (CNY cents)', '参考费用（分）') }
]
export function hospitalActiveInput(edit = false): BusinessInput {
  return {
    key: 'active',
    kind: 'select',
    label: t('Active / open', '启用／开放'),
    choices: hospitalActive,
    ...(edit ? { fromSelection: 'active' } : {})
  }
}
export function hospitalCapacity(edit = false): BusinessInput {
  return {
    key: 'capacity',
    kind: 'number',
    label: t('Capacity', '号源上限'),
    min: 1,
    max: 10_000,
    initial: 10,
    ...(edit ? { fromSelection: 'capacity' } : {})
  }
}
export function hospitalNote(): BusinessInput {
  return textInput('note', 'Administrative explanation', '行政处理说明', 500)
}
export function hospitalHistory(managed: boolean) {
  return {
    resourceId: managed
      ? 'hospital-management-appointment-history'
      : 'hospital-appointment-history',
    foreignKey: 'appointment_id',
    title: t('Appointment history', '预约操作记录'),
    columns: [
      { field: 'action', label: t('Action', '操作') },
      { field: 'note', label: t('Administrative explanation', '行政处理说明') },
      { field: 'created_at', label: t('Recorded at', '记录时间') }
    ]
  }
}
