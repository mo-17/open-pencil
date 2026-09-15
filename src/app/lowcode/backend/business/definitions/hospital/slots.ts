import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, inputParameter, selectedParameter, textInput } from '../shared'
import {
  hospitalActive,
  hospitalActiveInput,
  hospitalCapacity,
  hospitalDepartmentColumns,
  hospitalDoctorColumns,
  hospitalPatientColumns,
  hospitalSlotColumns,
  hospitalSlotDetails
} from './fields'

export function hospitalRegistrationPage(): BusinessPageDefinition {
  return {
    id: 'hospital-slots',
    path: '/hospital/registration',
    title: t('Hospital registration', '排班挂号'),
    public: true,
    description: t(
      'Browse open sessions, sign in and save a patient in My patients. Select a session, review its doctor, time, location and reference fee, then choose that patient to reserve one place. Refresh to check current metadata; the server confirms availability. No payment is collected.',
      '浏览开放排班，登录并在我的就诊人登记资料。选中排班，核对医生、时间、地点和参考费用后选择就诊人预约一个号源。刷新可获取最新记录，余量由服务器提交时确认。本流程不收款。'
    ),
    listing: { resourceId: 'hospital-slots', columns: hospitalSlotColumns, search: true },
    details: hospitalSlotDetails,
    actions: [
      formAction({
        id: 'reserve-hospital-appointment',
        en: 'Reserve appointment',
        zh: '提交挂号预约',
        inputs: [
          {
            key: 'patientId',
            label: t('My active patient', '本人管理的启用就诊人'),
            kind: 'relation',
            relation: {
              resourceId: 'hospital-patients',
              labelField: 'title',
              columns: hospitalPatientColumns,
              filters: { active: { kind: 'literal', value: true } }
            }
          }
        ],
        parameters: {
          slotId: selectedParameter(),
          departmentId: selectedParameter('department_id'),
          doctorId: selectedParameter('doctor_id')
        },
        when: { field: 'active', values: [true] },
        description: t(
          'Reserve one place for the selected patient. The server verifies ownership, active records, session time, duplicates and capacity, and copies the current fee. This is not real-name verification or proof of payment. A cancelled appointment for this same patient and session must be restored in My appointments.',
          '为所选就诊人预约一个号源。服务器校验归属、启用状态、排班时间、重复预约及余量，并记录当前费用；这不是实名核验或付款凭证。同一就诊人同一排班的已取消预约，请到我的挂号恢复原记录。'
        )
      })
    ]
  }
}
export function hospitalSlotManagementPage(): BusinessPageDefinition {
  return {
    id: 'hospital-management-slots',
    path: '/hospital/admin/slots',
    title: t('Manage hospital sessions', '医院排班管理'),
    description: t(
      'Requires hospital-admin. Create a session for an active doctor using explicit zoned ISO 8601 times. Doctor, times and fee are fixed after creation; later edits change capacity and availability only. Capacity cannot drop below reservations. Close a cancelled session, then handle its appointments individually.',
      '需要 hospital-admin。为启用医生创建排班，时间使用带时区的 ISO 8601。创建后医生、时间和费用固定，只能调整号源上限与开放状态；上限不能低于已预约数。停诊时先关闭排班，再逐条处理相关预约。'
    ),
    listing: {
      resourceId: 'hospital-management-slots',
      columns: hospitalSlotColumns,
      search: true,
      filter: { field: 'active', choices: hospitalActive }
    },
    details: hospitalSlotDetails,
    actions: [
      formAction({
        id: 'create-hospital-slot',
        en: 'Create hospital session',
        zh: '新增医院排班',
        inputs: [
          {
            key: 'departmentId',
            kind: 'relation',
            label: t('Active department', '启用科室'),
            relation: {
              resourceId: 'hospital-management-departments',
              labelField: 'title',
              columns: hospitalDepartmentColumns,
              filters: { active: { kind: 'literal', value: true } }
            }
          },
          {
            key: 'doctorId',
            kind: 'relation',
            label: t('Active doctor', '启用医生'),
            relation: {
              resourceId: 'hospital-management-doctors',
              labelField: 'title',
              columns: hospitalDoctorColumns,
              filters: {
                department_id: inputParameter('departmentId'),
                active: { kind: 'literal', value: true }
              }
            }
          },
          textInput('title', 'Session name', '排班名称'),
          textInput('location', 'Location', '地点', 200),
          textInput('startsAt', 'Start time (zoned ISO 8601)', '开始时间（带时区 ISO 8601）', 40),
          textInput('endsAt', 'End time (zoned ISO 8601)', '结束时间（带时区 ISO 8601）', 40),
          hospitalCapacity(),
          {
            key: 'feeCents',
            label: t('Reference fee (CNY cents)', '参考费用（分）'),
            kind: 'number',
            min: 0,
            max: 1_000_000,
            initial: 0
          }
        ],
        description: t(
          'For example, use 2030-01-01T09:00:00+08:00 and a later end time. The fee is an administrative reference in CNY cents; no payment service is called.',
          '例如使用 2030-01-01T09:00:00+08:00，并填写更晚的结束时间。费用按人民币分记录，仅作行政参考，不调用支付服务。'
        )
      }),
      formAction({
        id: 'update-hospital-slot',
        en: 'Edit session capacity',
        zh: '调整排班号源',
        inputs: [hospitalCapacity(true), hospitalActiveInput(true)],
        parameters: { slotId: selectedParameter() }
      })
    ]
  }
}
