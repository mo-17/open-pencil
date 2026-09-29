import { foodOrderStatuses } from '@/app/lowcode/backend/business/definitions/food-ordering/fields'
import type { BusinessColumn } from '@/app/lowcode/backend/business/types'

import type { BusinessScreen } from '../screen'

const amountFields = new Set(['price', 'unit_price', 'line_total', 'subtotal', 'total'])

/** Keep integer minor units on the wire; format only the displayed amount. */
export function foodAmountExpression(value: string): string {
  return `"¥" + ((${value} - ${value} % 100) / 100) + "." + (${value} % 100 < 10 ? "0" : "") + (${value} % 100)`
}

export function foodFieldLabel(screen: BusinessScreen, column: BusinessColumn): string {
  return screen.ctx.label(column.label).replace(' (minor units)', '').replace('（分）', '')
}

export function foodFieldExpression(screen: BusinessScreen, field: string, record: string): string {
  const value = `${record}.${field}`
  const label = (en: string, zh: string) => JSON.stringify(screen.ctx.label({ en, zh }))
  if (amountFields.has(field)) return foodAmountExpression(value)
  if (['status', 'before_status', 'after_status'].includes(field))
    return (
      foodOrderStatuses
        .map(
          (status) =>
            `${value} === ${JSON.stringify(status.value)} ? ${JSON.stringify(screen.ctx.label(status.label))} : `
        )
        .join('') + value
    )
  if (field === 'fulfillment')
    return `${value} === "dine_in" ? ${label('Dine-in', '堂食')} : ${value} === "pickup" ? ${label('Pickup', '到店自取')} : ${value}`
  if (field === 'available')
    return `${value} ? ${label('Available', '可点餐')} : ${label('Unavailable / sold out', '下架／售罄')}`
  if (field === 'active')
    return screen.definition.id.startsWith('food-')
      ? `${value} ? ${label('In cart', '已加入')} : ${label('Removed', '已移除')}`
      : `${value} ? ${label('Active', '有效')} : ${label('Inactive', '停用')}`
  return `(${value} === "" ? "—" : ${value})`
}

export function foodColumnExpression(
  screen: BusinessScreen,
  column: BusinessColumn,
  record: string
): string {
  return `${JSON.stringify(foodFieldLabel(screen, column) + ': ')} + (${foodFieldExpression(screen, column.field, record)})`
}
