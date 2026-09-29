import type { BusinessColumn } from '@/app/lowcode/backend/business/types'

import type { BusinessScreen } from '../screen'
import { foodColumnExpression } from './fields'
import { FOOD_ORDERING_COLORS as colors, foodSurface, foodText } from './style'

export function renderFoodDetails(
  screen: BusinessScreen,
  columns: readonly BusinessColumn[]
): void {
  const { ctx } = screen
  // Images are shown in cards; avoid making customers read a raw media URL.
  const details = columns.filter((column) => column.field !== 'image_url')
  const compact = details.filter((column) => !column.multiline)
  const multiline = details.filter((column) => column.multiline)
  const height = 80 + Math.ceil(compact.length / 2) * 40 + multiline.length * 92
  const y = screen.reserve(height)
  const panel = ctx.layout.shape(
    'FRAME',
    'Restaurant details',
    screen.page,
    272,
    y,
    880,
    height,
    foodSurface({ stroke: colors.border, radius: 18 })
  )
  ctx.layout.text(
    panel,
    ctx.label({ en: 'Selected details', zh: '已选内容' }),
    { x: 24, y: 18, width: 832, height: 30 },
    foodText(colors.text, 20, 600)
  )
  const hint = ctx.label({
    en: 'Choose a dish or order above to see its details here.',
    zh: '选择上方的菜品或订单，在这里查看详情。'
  })
  ctx.layout.text(
    panel,
    hint,
    { x: 24, y: 64, width: 832, height: 42 },
    { ...foodText(colors.muted, 14), renderCondition: `!(${screen.selection})` }
  )
  compact.forEach((column, index) =>
    ctx.layout.text(
      panel,
      '',
      {
        x: 24 + (index % 2) * 420,
        y: 64 + Math.floor(index / 2) * 40,
        width: 396,
        height: 32
      },
      {
        ...foodText(colors.text, 14),
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        renderCondition: screen.selection,
        bindings: {
          text: { kind: 'expr', expr: foodColumnExpression(screen, column, screen.selected) }
        }
      }
    )
  )
  multiline.forEach((column, index) =>
    ctx.layout.text(
      panel,
      '',
      {
        x: 24,
        y: 64 + Math.ceil(compact.length / 2) * 40 + index * 92,
        width: 832,
        height: 80
      },
      {
        ...foodText(colors.muted, 14),
        renderCondition: screen.selection,
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: {
          text: { kind: 'expr', expr: foodColumnExpression(screen, column, screen.selected) }
        }
      }
    )
  )
}
