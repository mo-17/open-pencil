import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

import { textInput } from '../shared'

export const foodAvailability = [
  { value: true, label: t('Available', '可点餐') },
  { value: false, label: t('Unavailable / sold out', '下架／售罄') }
]
export const foodOrderStatuses = [
  { value: 'pending', label: t('Awaiting acceptance', '待接单') },
  { value: 'accepted', label: t('Accepted', '已接单') },
  { value: 'preparing', label: t('Preparing', '制作中') },
  { value: 'ready', label: t('Ready to serve / collect', '已出餐／待取餐') },
  { value: 'completed', label: t('Completed', '已完成') },
  { value: 'cancelled', label: t('Cancelled', '已取消') }
]
export const foodLineColumns: readonly BusinessColumn[] = [
  { field: 'product_title', label: t('Dish', '菜品') },
  { field: 'quantity', label: t('Quantity', '数量') },
  { field: 'unit_price', label: t('Unit price (minor units)', '单价（分）') },
  { field: 'line_total', label: t('Line total (minor units)', '小计（分）') }
]
export const foodOrderColumns: readonly BusinessColumn[] = [
  { field: 'id', label: t('Order', '订单号') },
  { field: 'status', label: t('Status', '状态') },
  { field: 'fulfillment', label: t('Dining method', '用餐方式') },
  { field: 'total', label: t('Total (minor units)', '合计（分）') }
]
export const foodOrderDetails: readonly BusinessColumn[] = [
  ...foodOrderColumns,
  { field: 'currency', label: t('Currency', '币种') },
  { field: 'table_number', label: t('Table number', '桌号') },
  { field: 'contact_name', label: t('Contact name', '联系人') },
  { field: 'phone', label: t('Phone', '电话') },
  { field: 'note', label: t('Order note', '订单备注'), multiline: true },
  { field: 'created_at', label: t('Ordered at', '下单时间') }
]
export const foodHistoryColumns: readonly BusinessColumn[] = [
  { field: 'action', label: t('Action', '操作') },
  { field: 'before_status', label: t('Previous status', '原状态') },
  { field: 'after_status', label: t('Resulting status', '新状态') },
  { field: 'note', label: t('Explanation', '说明'), multiline: true },
  { field: 'created_at', label: t('Recorded at', '记录时间') }
]
export function foodQuantity(fromSelection = false): BusinessInput {
  return {
    key: 'quantity',
    label: t('Quantity', '数量'),
    kind: 'number',
    min: 1,
    max: 99,
    initial: 1,
    ...(fromSelection ? { fromSelection: 'quantity' } : {})
  }
}
export function foodNote(): BusinessInput {
  return { ...textInput('note', 'Explanation / note', '说明／备注', 500), required: false }
}
export function foodMenuInputs(edit = false): BusinessInput[] {
  return [
    textInput('title', 'Dish name', '菜品名称', 200),
    textInput('category', 'Category', '分类', 100),
    { ...textInput('description', 'Description', '菜品说明', 2000), required: false },
    {
      key: 'imageUrl',
      label: t('Public image URL (optional)', '公开图片地址（可选）'),
      kind: 'text',
      maxLength: 2048,
      required: false
    },
    {
      key: 'price',
      label: t('Price (minor units)', '价格（分）'),
      kind: 'number',
      min: 0,
      max: 1_000_000,
      initial: 0
    },
    {
      key: 'available',
      label: t('Availability', '点餐状态'),
      kind: 'select',
      choices: foodAvailability
    }
  ].map((input) => ({
    ...input,
    ...(edit ? { fromSelection: input.key === 'imageUrl' ? 'image_url' : input.key } : {})
  })) as BusinessInput[]
}
