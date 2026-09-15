import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { selectedParameter, textInput } from '../shared'

export const rentalPropertyColumns: BusinessColumn[] = [
  { field: 'title', label: t('Property', '房源') },
  { field: 'city', label: t('City', '城市') },
  { field: 'district', label: t('District', '区域') },
  { field: 'rent_monthly_cents', label: t('Monthly rent (cents)', '月租（分）') },
  { field: 'room_layout', label: t('Room layout', '房型') }
]
export const rentalPropertyDetails: BusinessColumn[] = [
  ...rentalPropertyColumns,
  { field: 'address', label: t('Address', '地址') },
  { field: 'area_sqm_x100', label: t('Area (0.01 square metres)', '面积（0.01平方米）') },
  { field: 'description', label: t('Description', '房源介绍'), multiline: true },
  { field: 'status', label: t('Publication status', '发布状态') }
]
export const rentalSlotColumns: BusinessColumn[] = [
  { field: 'title', label: t('Viewing time', '看房时段') },
  { field: 'starts_at', label: t('Starts at', '开始时间') },
  { field: 'ends_at', label: t('Ends at', '结束时间') },
  { field: 'capacity', label: t('Capacity', '人数上限') },
  { field: 'reserved', label: t('Reserved', '已预约人数') },
  { field: 'active', label: t('Open', '开放中') }
]
export const rentalViewingColumns: BusinessColumn[] = [
  { field: 'property_title', label: t('Property', '房源') },
  { field: 'starts_at', label: t('Viewing starts', '看房时间') },
  { field: 'quantity', label: t('Visitors', '看房人数') },
  { field: 'status', label: t('Status', '预约状态') }
]
export const rentalHistoryColumns: BusinessColumn[] = [
  { field: 'action', label: t('Action', '操作') },
  { field: 'note', label: t('Explanation', '说明'), multiline: true },
  { field: 'created_at', label: t('Recorded at', '记录时间') }
]
export const rentalNote = () => textInput('note', 'Explanation', '操作说明', 500)
export const rentalCapacity = (): BusinessInput => ({
  key: 'capacity',
  label: t('Maximum visitors', '人数上限'),
  kind: 'number',
  min: 1,
  max: 100,
  initial: 1
})

export function rentalSlotInput(reschedule = false): BusinessInput {
  return {
    key: reschedule ? 'targetSlotId' : 'slotId',
    label: t('Open viewing time', '开放看房时段'),
    kind: 'relation',
    relation: {
      resourceId: 'rental-slots',
      labelField: 'title',
      columns: rentalSlotColumns,
      filters: {
        property_id: selectedParameter(reschedule ? 'property_id' : 'id'),
        active: { kind: 'literal', value: true }
      }
    }
  }
}

export function rentalPropertyInputs(edit = false): BusinessInput[] {
  const inputs: BusinessInput[] = [
    textInput('title', 'Property title', '房源标题', 200),
    textInput('city', 'City', '城市', 100),
    textInput('district', 'District', '区域', 100),
    textInput('address', 'Address to publish', '对外展示地址', 300),
    {
      key: 'rentMonthlyCents',
      label: t('Monthly rent in cents (300000 = 3000.00)', '月租（分，300000 = 3000元）'),
      kind: 'number',
      min: 1,
      max: 100000000,
      initial: 300000
    },
    textInput('roomLayout', 'Room layout', '房型', 100),
    {
      key: 'areaSqmX100',
      label: t('Area in 0.01 square metres (8000 = 80)', '面积（8000 = 80平方米）'),
      kind: 'number',
      min: 1,
      max: 10000000,
      initial: 8000
    },
    textInput('description', 'Property description', '房源介绍', 2000),
    {
      ...textInput('coverImageUrl', 'Cover image URL (optional)', '封面图片地址（选填）', 2048),
      required: false
    },
    {
      ...textInput(
        'panoramaUrl',
        '360 panorama image URL (optional)',
        '360全景图片地址（选填）',
        2048
      ),
      required: false
    }
  ]
  if (!edit) return inputs
  const fields: Readonly<Record<string, string>> = {
    rentMonthlyCents: 'rent_monthly_cents',
    roomLayout: 'room_layout',
    areaSqmX100: 'area_sqm_x100',
    coverImageUrl: 'cover_image_url',
    panoramaUrl: 'panorama_url'
  }
  return inputs.map((input) => ({ ...input, fromSelection: fields[input.key] ?? input.key }))
}
