import { HOSPITAL_ROLES } from '@/app/lowcode/backend/business/model/hospital/fields'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage } from '../shared'
import { hospitalAppointmentManagementPage, hospitalAppointmentsPage } from './appointments'
import {
  hospitalDepartmentManagementPage,
  hospitalDepartmentsPage,
  hospitalDoctorManagementPage,
  hospitalDoctorsPage
} from './catalog'
import { hospitalPatientsPage } from './patients'
import { hospitalRegistrationPage, hospitalSlotManagementPage } from './slots'

export function hospitalRegistrationDefinition(): BusinessTemplateDefinition {
  return {
    id: 'hospital-registration',
    title: t('Hospital registration', '医院挂号'),
    description: t(
      'Single-hospital directories, patient profiles, capacity-checked registration and administrative arrival handling. Payment, identity verification, notifications and HIS integration are connected after export.',
      '单医院科室医生目录、就诊人资料、号源校验预约及到场行政处理。支付、实名核验、通知和 HIS 对接在导出后接入。'
    ),
    entryPage: 'hospital-slots',
    roles: HOSPITAL_ROLES,
    pages: [
      accountSetupPage(HOSPITAL_ROLES),
      hospitalDepartmentsPage(),
      hospitalDoctorsPage(),
      hospitalRegistrationPage(),
      hospitalPatientsPage(),
      hospitalAppointmentsPage(),
      hospitalDepartmentManagementPage(),
      hospitalDoctorManagementPage(),
      hospitalSlotManagementPage(),
      hospitalAppointmentManagementPage()
    ]
  }
}
