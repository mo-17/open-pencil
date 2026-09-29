import type { BusinessColumn, BusinessListing } from '@/app/lowcode/backend/business/types'

import type { BusinessScreen } from '../screen'
import { businessSurface, businessText } from './style'

export function businessColumnExpression(
  screen: BusinessScreen,
  column: BusinessColumn,
  record: string
): string {
  return `${JSON.stringify(screen.ctx.label(column.label) + ': ')} + ${record}.${column.field}`
}

/** Preserve every declared field while giving titles and secondary metadata distinct roles. */
export function businessRecordPresentation(screen: BusinessScreen, definition: BusinessListing) {
  const [first, ...rest] = definition.columns
  const title = !first.multiline ? first : undefined
  const fields = title ? rest : definition.columns
  const compact = fields.filter((column) => !column.multiline)
  const multiline = fields.filter((column) => column.multiline)
  const mode = screen.ctx.presentation.mode
  const columns = (mode === 'editorial' || mode === 'catalog') && compact.length <= 4 ? 2 : 1
  const metadataColumns = columns === 2 ? 1 : 2
  const contentHeight =
    (title ? 76 : 24) + Math.ceil(compact.length / metadataColumns) * 40 + multiline.length * 112
  return { title, compact, multiline, columns, metadataColumns, contentHeight }
}

export function renderBusinessRecord(
  screen: BusinessScreen,
  card: string,
  definition: BusinessListing,
  width: number
): void {
  const { ctx } = screen
  const profile = ctx.presentation
  const { title, compact, multiline, metadataColumns } = businessRecordPresentation(
    screen,
    definition
  )
  ctx.editor.updateNodeWithUndo(
    card,
    businessSurface(profile, { stroke: profile.colors.border, radius: 14 }),
    'Style business record'
  )
  ctx.layout.shape(
    'RECTANGLE',
    'Record accent',
    card,
    20,
    20,
    4,
    title ? 40 : 24,
    businessSurface(profile, { fill: profile.colors.primary, radius: 2 })
  )
  if (title)
    ctx.layout.text(
      card,
      '',
      { x: 36, y: 16, width: width - 60, height: 48 },
      {
        ...businessText(profile, { size: 19, weight: 600 }),
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: { text: { kind: 'expr', expr: businessColumnExpression(screen, title, 'item') } }
      }
    )
  const start = title ? 76 : 24
  const cellWidth = (width - 48) / metadataColumns
  compact.forEach((column, index) => {
    const badge = ['status', 'stage', 'priority', 'active'].includes(column.field)
    const rect = {
      x: 24 + (index % metadataColumns) * cellWidth,
      y: start + Math.floor(index / metadataColumns) * 40,
      width: cellWidth - 12,
      height: 30
    }
    if (badge)
      ctx.layout.shape(
        'RECTANGLE',
        'Record status',
        card,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        businessSurface(profile, { fill: profile.colors.tint, radius: 6 })
      )
    ctx.layout.text(
      card,
      '',
      { ...rect, x: rect.x + (badge ? 8 : 0), width: rect.width - (badge ? 16 : 0) },
      {
        ...businessText(profile, {
          color: badge ? profile.colors.primary : profile.colors.muted,
          size: 14,
          weight: badge ? 500 : 400
        }),
        interactiveProps: {
          layout: { overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }
        },
        bindings: { text: { kind: 'expr', expr: businessColumnExpression(screen, column, 'item') } }
      }
    )
  })
  multiline.forEach((column, index) =>
    ctx.layout.text(
      card,
      '',
      {
        x: 24,
        y: start + Math.ceil(compact.length / metadataColumns) * 40 + index * 112,
        width: width - 48,
        height: 96
      },
      {
        ...businessText(profile, { color: profile.colors.muted, size: 14 }),
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: { text: { kind: 'expr', expr: businessColumnExpression(screen, column, 'item') } }
      }
    )
  )
}
