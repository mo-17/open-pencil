import {
  businessText as t,
  type BusinessActionDefinition,
  type BusinessColumn,
  type BusinessInput,
  type BusinessTemplateDefinition
} from '../types'
import {
  accountSetupPage,
  inputParameter,
  profileInput,
  selectedParameter,
  textInput
} from './shared'

function bookingAction(
  id: string,
  en: string,
  zh: string,
  inputs: readonly BusinessInput[],
  parameters: BusinessActionDefinition['parameters'],
  description?: BusinessActionDefinition['description']
): BusinessActionDefinition {
  return {
    id,
    commandId: id,
    label: t(en, zh),
    description:
      description ??
      t(
        'Review the selected record. Availability, time and capacity are checked by the server.',
        '核对当前记录，服务器会检查可用性、时间和容量。'
      ),
    inputs,
    parameters: {
      ...parameters,
      ...Object.fromEntries(inputs.map((input) => [input.key, inputParameter(input.key)]))
    }
  }
}

export function bookingRegistrationDefinition(): BusinessTemplateDefinition {
  const serviceColumns: BusinessColumn[] = [
    { field: 'title', label: t('Service', '服务') },
    { field: 'active', label: t('Active', '有效') }
  ]
  const slotColumns: BusinessColumn[] = [
    { field: 'title', label: t('Time slot', '可约时段') },
    { field: 'starts_at', label: t('Start time', '开始时间') },
    { field: 'ends_at', label: t('End time', '结束时间') },
    { field: 'capacity', label: t('Capacity', '名额上限') },
    { field: 'reserved', label: t('Reserved', '已预约') },
    { field: 'active', label: t('Open', '开放中') }
  ]
  const quantity: BusinessInput = {
    key: 'quantity',
    label: t('Number of places', '预约人数'),
    kind: 'number',
    min: 1,
    max: 99,
    initial: 1
  }
  const capacity: BusinessInput = {
    key: 'capacity',
    label: t('Capacity', '名额上限'),
    kind: 'number',
    min: 1,
    max: 100000,
    initial: 10
  }
  const slot: BusinessInput = {
    key: 'slotId',
    label: t('Available time slot', '可预约时段'),
    kind: 'relation',
    relation: {
      resourceId: 'slots',
      labelField: 'title',
      columns: slotColumns,
      filters: { service_id: selectedParameter(), active: { kind: 'literal', value: true } }
    }
  }
  const reschedule: BusinessInput = {
    ...slot,
    key: 'targetSlotId',
    label: t('New time slot', '新的预约时段'),
    relation: {
      resourceId: 'slots',
      labelField: 'title',
      columns: slotColumns,
      filters: {
        service_id: selectedParameter('service_id'),
        active: { kind: 'literal', value: true }
      }
    }
  }
  const note = textInput('note', 'Booking note', '预约说明', 500)
  const bookingSelection = {
    bookingId: selectedParameter(),
    serviceId: selectedParameter('service_id')
  }
  const slotSelection = { slotId: selectedParameter(), serviceId: selectedParameter('service_id') }
  const bookedColumns: BusinessColumn[] = [
    { field: 'service_title', label: t('Service', '服务') },
    { field: 'starts_at', label: t('Start time', '开始时间') },
    { field: 'quantity', label: t('Places', '人数') },
    { field: 'status', label: t('Status', '状态') }
  ]
  return {
    id: 'booking-registration',
    title: t('Bookings and registration', '预约与报名'),
    description: t(
      'Timed services, capacity-checked reservations, rescheduling and cancellation.',
      '服务时段、容量校验、预约改期与取消。'
    ),
    entryPage: 'services',
    roles: ['booking-manager'],
    pages: [
      accountSetupPage(['booking-manager']),
      {
        id: 'services',
        path: '/services',
        title: t('Services and booking', '服务与预约'),
        public: true,
        description: t(
          'Browse services, sign in and register your profile, then select a service and an open time slot. Times use ISO 8601 with an explicit time zone. booking-manager creates services and slots.',
          '浏览服务后登录并登记资料，选择服务及开放时段预约。时间使用带时区的 ISO 8601；booking-manager 可创建服务和时段。'
        ),
        listing: { resourceId: 'services', columns: serviceColumns, search: true },
        details: [
          ...serviceColumns,
          { field: 'description', label: t('Description', '服务说明'), multiline: true }
        ],
        related: [
          {
            resourceId: 'slots',
            foreignKey: 'service_id',
            columns: slotColumns,
            title: t('Service time slots', '服务时段')
          }
        ],
        actions: [
          bookingAction(
            'reserve-booking',
            'Reserve places',
            '提交预约',
            [
              profileInput('my-profile'),
              slot,
              quantity,
              textInput('attendeeName', 'Attendee name', '预约人姓名'),
              textInput('contact', 'Contact details', '联系方式', 200),
              note
            ],
            { serviceId: selectedParameter() }
          ),
          bookingAction(
            'create-service',
            'Create service',
            '创建服务',
            [
              textInput('title', 'Service name', '服务名称', 200),
              textInput('description', 'Service description', '服务说明', 500)
            ],
            {},
            t(
              'Requires booking-manager. Create the service before adding its time slots.',
              '需要 booking-manager，先创建服务再添加时段。'
            )
          ),
          bookingAction(
            'create-slot',
            'Create time slot',
            '创建时段',
            [
              textInput('title', 'Slot name', '时段名称', 200),
              textInput('startsAt', 'Start time (ISO 8601)', '开始时间（ISO 8601）', 40),
              textInput('endsAt', 'End time (ISO 8601)', '结束时间（ISO 8601）', 40),
              capacity
            ],
            { serviceId: selectedParameter() },
            t(
              'Requires booking-manager. Select a service and use explicit zoned times such as 2030-01-01T09:00:00+08:00. End must follow start.',
              '需要 booking-manager。选择服务并填写带时区时间，例如 2030-01-01T09:00:00+08:00，结束时间须晚于开始时间。'
            )
          )
        ]
      },
      {
        id: 'bookings',
        path: '/bookings',
        title: t('My bookings', '我的预约'),
        description: t(
          'Review your reservations. You can cancel or move confirmed bookings within the same service; the server prevents overbooking. Managers can complete bookings.',
          '查看本人预约。已确认预约可取消或改到同一服务的其他时段，服务器防止超额预约；经理可完成预约。'
        ),
        listing: {
          resourceId: 'bookings',
          columns: bookedColumns,
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
          ...bookedColumns,
          { field: 'attendee_name', label: t('Attendee', '预约人') },
          { field: 'contact', label: t('Contact', '联系方式') }
        ],
        related: [
          {
            resourceId: 'booking-history',
            foreignKey: 'booking_id',
            title: t('Booking history', '预约历史'),
            columns: [
              { field: 'action', label: t('Action', '操作') },
              { field: 'note', label: t('Note', '说明') }
            ]
          }
        ],
        actions: [
          bookingAction('cancel-booking', 'Cancel booking', '取消预约', [note], bookingSelection),
          bookingAction(
            'reschedule-booking',
            'Reschedule booking',
            '更改预约时段',
            [reschedule, note],
            bookingSelection
          ),
          bookingAction(
            'complete-booking',
            'Complete booking',
            '完成预约',
            [note],
            bookingSelection
          )
        ].map((action) => ({ ...action, when: { field: 'status', values: ['confirmed'] } }))
      },
      {
        id: 'slots',
        path: '/slot-management',
        title: t('Manage time slots', '时段管理'),
        description: t(
          'Requires booking-manager. Capacity cannot fall below existing reservations. Close a slot only when the server permits it.',
          '需要 booking-manager。名额上限不能低于已有预约人数，关闭时段也需通过服务器校验。'
        ),
        listing: { resourceId: 'slots', columns: slotColumns, search: true },
        actions: [
          bookingAction(
            'adjust-slot-capacity',
            'Change capacity',
            '调整名额',
            [capacity],
            slotSelection
          ),
          bookingAction('close-slot', 'Close time slot', '关闭时段', [], slotSelection)
        ]
      }
    ]
  }
}
