import type { BusinessColumn } from '@/app/lowcode/backend/business/types'

import { BUSINESS_CONTENT_WIDTH, BUSINESS_CONTENT_X } from '../layout'
import type { BusinessScreen } from '../screen'
import { businessColumnExpression } from './records'
import { businessSurface, businessText } from './style'

export function renderBusinessDetails(
  screen: BusinessScreen,
  columns: readonly BusinessColumn[]
): void {
  const { ctx } = screen
  const profile = ctx.presentation
  const compact = columns.filter((column) => !column.multiline)
  const multiline = columns.filter((column) => column.multiline)
  const compactHeight = Math.ceil(compact.length / 2) * 48
  const height = Math.max(132, 88 + compactHeight + multiline.length * 172)
  const y = screen.reserve(height)
  const panel = ctx.layout.shape(
    'FRAME',
    'Selected record details',
    screen.page,
    BUSINESS_CONTENT_X,
    y,
    BUSINESS_CONTENT_WIDTH,
    height,
    businessSurface(profile, { stroke: profile.colors.border, radius: 14 })
  )
  ctx.layout.text(
    panel,
    ctx.copy.details,
    { x: 24, y: 20, width: 832, height: 32 },
    businessText(profile, { size: 20, weight: 600 })
  )
  ctx.layout.text(
    panel,
    ctx.copy.none,
    { x: 24, y: 68, width: 832, height: 44 },
    {
      ...businessText(profile, { color: profile.colors.muted, size: 14 }),
      renderCondition: `!(${screen.selection})`
    }
  )
  compact.forEach((column, index) =>
    ctx.layout.text(
      panel,
      '',
      {
        x: 24 + (index % 2) * 420,
        y: 68 + Math.floor(index / 2) * 48,
        width: 396,
        height: 40
      },
      {
        ...businessText(profile, { size: 14 }),
        renderCondition: screen.selection,
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: {
          text: { kind: 'expr', expr: businessColumnExpression(screen, column, screen.selected) }
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
        y: 68 + compactHeight + index * 172,
        width: 832,
        height: 152
      },
      {
        ...businessText(profile, { size: 15 }),
        renderCondition: screen.selection,
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: {
          text: { kind: 'expr', expr: businessColumnExpression(screen, column, screen.selected) }
        }
      }
    )
  )
}
