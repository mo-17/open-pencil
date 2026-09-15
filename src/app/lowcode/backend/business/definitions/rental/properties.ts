import {
  businessText as t,
  type BusinessPageDefinition
} from '@/app/lowcode/backend/business/types'

import { formAction, profileInput, selectedParameter, textInput } from '../shared'
import {
  rentalCapacity,
  rentalHistoryColumns,
  rentalNote,
  rentalPropertyColumns,
  rentalPropertyDetails,
  rentalPropertyInputs,
  rentalSlotColumns,
  rentalSlotInput
} from './fields'

export function rentalPublicPage(): BusinessPageDefinition {
  return {
    id: 'rental-properties',
    path: '/rental-properties',
    title: t('Homes and viewings', '租房与看房'),
    public: true,
    description: t(
      'Browse published homes and their 360 panoramas. Sign in and register your profile before choosing a viewing time. The identity service must grant rental-tenant; profile registration does not grant roles. Times are suggestions; the server confirms publication, availability and capacity when you reserve.',
      '浏览已上架房源及360全景。登录并登记资料后选择看房时段；身份服务须授予 rental-tenant 角色，资料登记不会分配角色。时段仅供选择，提交时由服务器再次确认房源状态、时间和名额。'
    ),
    listing: { resourceId: 'rental-properties', columns: rentalPropertyColumns, search: true },
    details: rentalPropertyDetails,
    vrTourField: 'panorama_url',
    actions: [
      formAction({
        id: 'reserve-rental-viewing',
        en: 'Reserve viewing',
        zh: '预约看房',
        inputs: [
          profileInput('my-profile'),
          rentalSlotInput(),
          {
            key: 'quantity',
            label: t('Visitors', '看房人数'),
            kind: 'number',
            min: 1,
            max: 20,
            initial: 1
          },
          textInput('attendeeName', 'Visitor name', '看房人姓名'),
          textInput('contact', 'Contact details', '联系方式', 200),
          rentalNote()
        ],
        parameters: { propertyId: selectedParameter() }
      })
    ]
  }
}

export function rentalManagementPage(): BusinessPageDefinition {
  const selected = { propertyId: selectedParameter() }
  return {
    id: 'rental-management-properties',
    path: '/rental-management',
    title: t('Manage my properties', '管理我的房源'),
    description: t(
      'Landlords manage only their own properties; rental-admin can manage all properties. New properties are drafts. Publish only addresses and images you intend visitors to see. Publishing does not collect rent or create a lease.',
      '房东只能管理本人房源，rental-admin可管理全部房源。新建房源为草稿，请核对地址与图片后再上架。此流程不收取租金，也不生成租赁合同。'
    ),
    listing: {
      resourceId: 'rental-management-properties',
      columns: [...rentalPropertyColumns, { field: 'status', label: t('Status', '状态') }],
      search: true,
      filter: {
        field: 'status',
        choices: [
          { value: 'draft', label: t('Draft', '草稿') },
          { value: 'published', label: t('Published', '已上架') },
          { value: 'archived', label: t('Off market', '已下架') }
        ]
      }
    },
    details: rentalPropertyDetails,
    vrTourField: 'panorama_url',
    related: [
      {
        resourceId: 'rental-property-history',
        foreignKey: 'property_id',
        title: t('Property history', '房源操作记录'),
        columns: rentalHistoryColumns
      }
    ],
    actions: [
      formAction({
        id: 'create-rental-property',
        en: 'Create property draft',
        zh: '创建房源草稿',
        inputs: [profileInput('my-profile'), ...rentalPropertyInputs()]
      }),
      formAction({
        id: 'update-rental-property',
        en: 'Edit property',
        zh: '编辑房源',
        inputs: [...rentalPropertyInputs(true), rentalNote()],
        parameters: selected
      }),
      formAction({
        id: 'publish-rental-property',
        en: 'Publish property',
        zh: '上架房源',
        inputs: [rentalNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'archived'] }
      }),
      formAction({
        id: 'archive-rental-property',
        en: 'Take off market',
        zh: '下架房源',
        inputs: [rentalNote()],
        parameters: selected,
        when: { field: 'status', values: ['draft', 'published'] },
        description: t(
          'New reservations stop immediately. Existing reservations remain available for cancellation and follow-up.',
          '下架立即停止新增预约；已有预约保留，可继续取消或处理。'
        )
      }),
      formAction({
        id: 'create-rental-slot',
        en: 'Add viewing time',
        zh: '添加看房时段',
        inputs: [
          textInput('title', 'Time label', '时段名称', 200),
          textInput(
            'startsAt',
            'Start (ISO 8601 with time zone)',
            '开始时间（ISO 8601含时区）',
            40
          ),
          textInput('endsAt', 'End (ISO 8601 with time zone)', '结束时间（ISO 8601含时区）', 40),
          rentalCapacity()
        ],
        parameters: selected,
        when: { field: 'status', values: ['published'] }
      })
    ]
  }
}

export function rentalSlotsPage(): BusinessPageDefinition {
  const selected = { propertyId: selectedParameter('property_id'), slotId: selectedParameter() }
  return {
    id: 'rental-management-slots',
    path: '/rental-slot-management',
    title: t('Manage viewing times', '管理看房时段'),
    description: t(
      'Only the owning landlord or rental-admin can change a slot. Capacity cannot be reduced below reserved places. Closing a time stops new reservations without erasing existing appointments.',
      '仅所属房东或rental-admin可调整时段。人数上限不能低于已有预约人数；关闭时段会阻止新增预约，保留已有预约。'
    ),
    listing: { resourceId: 'rental-management-slots', columns: rentalSlotColumns, search: true },
    details: rentalSlotColumns,
    actions: [
      formAction({
        id: 'adjust-rental-slot-capacity',
        en: 'Adjust capacity',
        zh: '调整名额',
        inputs: [rentalCapacity()],
        parameters: selected
      }),
      formAction({
        id: 'close-rental-slot',
        en: 'Close viewing time',
        zh: '关闭时段',
        inputs: [],
        parameters: selected
      })
    ]
  }
}
