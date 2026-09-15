import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import {
  hospitalAppointmentColumns,
  hospitalAppointmentDetails,
  hospitalHistory,
  hospitalNote,
  hospitalStatuses
} from './fields'

const parameters = {
  patientId: selectedParameter('patient_id'),
  appointmentId: selectedParameter()
}

export function hospitalAppointmentsPage(): BusinessPageDefinition {
  return {
    id: 'hospital-appointments',
    path: '/hospital/appointments',
    title: t('My appointments', '我的挂号'),
    description: t(
      'Review only your own registrations and recorded fees. Before a confirmed session starts, you may cancel it. Restore reuses the same patient, session and appointment record after fresh server checks. To change sessions, cancel if permitted and reserve a different session. These records do not prove payment.',
      '查看本人挂号及参考费用。已预约且尚未开始的排班可取消；恢复会复用同一就诊人、同一排班和原预约记录，并重新校验。更换时段时，按规则取消后另约其他排班。这些记录不代表已付款。'
    ),
    listing: {
      resourceId: 'hospital-appointments',
      columns: hospitalAppointmentColumns,
      search: true,
      filter: { field: 'status', choices: hospitalStatuses }
    },
    details: hospitalAppointmentDetails,
    related: [hospitalHistory(false)],
    actions: [
      formAction({
        id: 'cancel-hospital-appointment',
        en: 'Cancel my appointment',
        zh: '取消本人预约',
        inputs: [hospitalNote()],
        parameters,
        when: { field: 'status', values: ['confirmed'] },
        description: t(
          'Cancel before the session begins; the server checks ownership and releases one reserved place once. Enter only an administrative reason. No refund is issued.',
          '在排班开始前取消；服务器校验归属并仅释放一次号源。仅填写行政原因，不填写病情。本操作不退款。'
        )
      }),
      formAction({
        id: 'restore-hospital-appointment',
        en: 'Restore my appointment',
        zh: '恢复本人预约',
        inputs: [hospitalNote()],
        parameters,
        when: { field: 'status', values: ['cancelled'] },
        description: t(
          'Restore this original record only if the patient, department, doctor and session are active, the session is still in the future and a place remains. The server refreshes the patient and session snapshots, including the current reference fee.',
          '仅在就诊人、科室、医生和排班均启用、排班尚未开始且仍有号源时恢复原记录。服务器重新获取就诊人和排班快照，包括当前参考费用。'
        )
      })
    ]
  }
}
export function hospitalAppointmentManagementPage(): BusinessPageDefinition {
  return {
    id: 'hospital-management-appointments',
    path: '/hospital/admin/appointments',
    title: t('Registration desk', '挂号处理'),
    description: t(
      'Requires hospital-staff or hospital-admin. Refresh manually to see current registrations. Check in only during the session, then mark administrative handling complete. Closing a session does not automatically cancel its appointments. Do not enter symptoms, diagnoses or medical history in explanations.',
      '需要 hospital-staff 或 hospital-admin。手动刷新查看最新预约，只能在排班时段内签到，再登记行政处理完成。关闭排班不会自动取消预约。说明中不要填写症状、诊断或病历。'
    ),
    listing: {
      resourceId: 'hospital-management-appointments',
      columns: hospitalAppointmentColumns,
      search: true,
      filter: { field: 'status', choices: hospitalStatuses }
    },
    details: hospitalAppointmentDetails,
    related: [hospitalHistory(true)],
    actions: [
      formAction({
        id: 'cancel-managed-hospital-appointment',
        en: 'Cancel as hospital',
        zh: '院方取消预约',
        inputs: [hospitalNote()],
        parameters,
        when: { field: 'status', values: ['confirmed'] },
        description: t(
          'Cancel a confirmed appointment, including a session that has already started. Contact the patient separately; this operation does not send a message or refund a payment.',
          '取消仍处于已预约状态的记录，包括已经开始的排班，并另行联系就诊人；此操作不发通知、不退款。'
        )
      }),
      formAction({
        id: 'check-in-hospital-appointment',
        en: 'Check in appointment',
        zh: '登记签到',
        inputs: [hospitalNote()],
        parameters,
        when: { field: 'status', values: ['confirmed'] },
        description: t(
          'Record arrival during the session. The server rejects early, late or repeated check-in. This does not verify a government ID or start a clinical consultation.',
          '在排班时段内登记到场，服务器会拒绝提前、超时或重复签到。此操作不核验身份证，也不代表开始诊疗。'
        )
      }),
      formAction({
        id: 'complete-hospital-appointment',
        en: 'Complete registration handling',
        zh: '完成挂号处理',
        inputs: [hospitalNote()],
        parameters,
        when: { field: 'status', values: ['checked_in'] },
        description: t(
          'Mark a checked-in appointment administratively complete. This is not a clinical record, diagnosis, prescription or proof that treatment occurred.',
          '将已签到预约标记为行政处理完成，不生成临床记录、诊断或处方，也不证明已经完成诊疗。'
        )
      })
    ]
  }
}
