import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, selectedParameter } from '../shared'
import { rentalHistoryColumns, rentalNote, rentalSlotInput, rentalViewingColumns } from './fields'

export function rentalViewingsPage(): BusinessPageDefinition {
  const parameters = {
    propertyId: selectedParameter('property_id'),
    viewingId: selectedParameter()
  }
  return {
    id: 'rental-viewings',
    path: '/rental-viewings',
    title: t('Viewing appointments', '看房预约'),
    description: t(
      'Tenants see only their own appointments; landlords see appointments for their own properties. Cancel or change a future confirmed viewing. Managers can cancel or record completion after it starts.',
      '租客仅查看本人预约，房东仅查看本人房源的预约。未来已确认预约可以取消或改期；所属房东或管理员可取消，开始后可登记完成。'
    ),
    listing: {
      resourceId: 'rental-viewings',
      columns: rentalViewingColumns,
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'confirmed', label: t('Confirmed', '已确认') },
          { value: 'cancelled', label: t('Cancelled', '已取消') },
          { value: 'completed', label: t('Completed', '已完成') }
        ]
      }
    },
    details: [
      ...rentalViewingColumns,
      { field: 'ends_at', label: t('Ends at', '结束时间') },
      { field: 'attendee_name', label: t('Visitor', '看房人') },
      { field: 'contact', label: t('Contact', '联系方式') },
      { field: 'note', label: t('Note', '说明'), multiline: true }
    ],
    related: [
      {
        resourceId: 'rental-viewing-history',
        foreignKey: 'viewing_id',
        title: t('Viewing history', '预约记录'),
        columns: rentalHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'cancel-rental-viewing',
        en: 'Cancel my viewing',
        zh: '取消本人预约',
        inputs: [rentalNote()],
        parameters
      }),
      formAction({
        id: 'reschedule-rental-viewing',
        en: 'Change my viewing time',
        zh: '更改本人看房时间',
        inputs: [rentalSlotInput(true), rentalNote()],
        parameters
      }),
      formAction({
        id: 'cancel-managed-rental-viewing',
        en: 'Cancel as property manager',
        zh: '房东/管理员取消预约',
        inputs: [rentalNote()],
        parameters
      }),
      formAction({
        id: 'complete-rental-viewing',
        en: 'Record completed viewing',
        zh: '登记看房完成',
        inputs: [rentalNote()],
        parameters
      })
    ].map((action) => ({ ...action, when: { field: 'status', values: ['confirmed'] } }))
  }
}
