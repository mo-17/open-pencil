import type { BusinessListing } from '@/app/lowcode/backend/business/types'

import type { BusinessScreen } from '../screen'
import { foodColumnExpression, foodFieldExpression } from './fields'
import { FOOD_ORDERING_COLORS as colors, foodSurface, foodText } from './style'

export function foodListPresentation(definition: BusinessListing) {
  const menu = definition.columns.some((column) => column.field === 'price')
  const multiline = definition.columns.filter((column) => column.multiline).length
  return {
    menu,
    columns: menu ? 2 : 1,
    cardHeight: menu
      ? 296
      : 124 + Math.ceil((definition.columns.length - multiline) / 2) * 32 + multiline * 92,
    listHeight: 328
  }
}

/** An editable, offline placeholder; a configured dish photo paints over it at runtime. */
export function renderFoodPlate(
  screen: BusinessScreen,
  parent: string,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const { layout } = screen.ctx
  layout.shape(
    'RECTANGLE',
    'Dish image background',
    parent,
    x,
    y,
    width,
    height,
    foodSurface({ fill: '#F1E7D8', radius: 14 })
  )
  const size = Math.min(height - 20, width - 24)
  const left = x + (width - size) / 2
  const top = y + (height - size) / 2
  layout.shape(
    'ELLIPSE',
    'Plate',
    parent,
    left,
    top,
    size,
    size,
    foodSurface({ fill: '#FFFDF8', stroke: '#DBCEBB', radius: 0 })
  )
  layout.shape(
    'ELLIPSE',
    'Plate center',
    parent,
    left + 12,
    top + 12,
    size - 24,
    size - 24,
    foodSurface({ fill: '#E7D1AE', radius: 0 })
  )
  for (const [dx, dy, fill] of [
    [0.28, 0.24, '#84996A'],
    [0.52, 0.36, '#B05B3B'],
    [0.3, 0.54, '#C98B45']
  ] as const)
    layout.shape(
      'ELLIPSE',
      'Dish illustration',
      parent,
      left + size * dx,
      top + size * dy,
      size * 0.3,
      size * 0.23,
      foodSurface({ fill, radius: 0 })
    )
}

export function renderFoodListCard(
  screen: BusinessScreen,
  card: string,
  definition: BusinessListing,
  width: number
): void {
  const { layout } = screen.ctx
  const presentation = foodListPresentation(definition)
  screen.ctx.editor.updateNodeWithUndo(
    card,
    foodSurface({ stroke: colors.border, radius: 18 }),
    'Style restaurant card'
  )
  if (presentation.menu) {
    const media = layout.shape('FRAME', 'Dish picture', card, 16, 16, width - 32, 128, {
      fills: [],
      cornerRadius: 14,
      clipsContent: true,
      responsiveOverrides: {
        compact: {
          layoutMode: 'FREE',
          layoutPositioning: 'AUTO',
          counterAxisSizing: 'FILL',
          primaryAxisSizing: 'FIXED',
          height: 128,
          minHeight: 128,
          minWidth: 0
        }
      }
    })
    screen.mobilePreserve.add(media)
    renderFoodPlate(screen, media, 0, 0, width - 32, 128)
    layout.shape('RECTANGLE', 'Dish photo', media, 0, 0, width - 32, 128, {
      cornerRadius: 14,
      renderCondition: '!!item.image_url',
      responsiveOverrides: { compact: { counterAxisSizing: 'FILL' } },
      interactiveProps: {
        image: {
          srcExpr: 'item.image_url',
          alt: screen.ctx.label({ en: 'Dish photo', zh: '菜品图片' }),
          objectFit: 'cover',
          loading: 'lazy'
        }
      }
    })
    layout.text(
      card,
      '',
      {
        x: 20,
        y: 152,
        width: definition.columns.some((column) => column.field === 'available')
          ? width - 204
          : width - 40,
        height: 22
      },
      {
        ...foodText(colors.muted, 12),
        interactiveProps: {
          layout: { overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }
        },
        bindings: { text: { kind: 'expr', expr: 'item.category' } }
      }
    )
    layout.text(
      card,
      '',
      { x: 20, y: 182, width: width - 40, height: 48 },
      {
        ...foodText(colors.text, 20, 600),
        interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
        bindings: { text: { kind: 'expr', expr: 'item.title' } }
      }
    )
    layout.text(
      card,
      '',
      { x: 20, y: 242, width: 174, height: 36 },
      {
        ...foodText(colors.primary, 24, 600),
        bindings: { text: { kind: 'expr', expr: foodFieldExpression(screen, 'price', 'item') } }
      }
    )
    if (definition.columns.some((column) => column.field === 'available'))
      layout.text(
        card,
        '',
        { x: width - 184, y: 152, width: 164, height: 22 },
        {
          ...foodText(colors.muted, 12),
          bindings: {
            text: { kind: 'expr', expr: foodFieldExpression(screen, 'available', 'item') }
          }
        }
      )
    return
  }
  const title = definition.columns.find((column) =>
    ['title', 'product_title', 'id'].includes(column.field)
  )
  const columns = definition.columns.filter((column) => column !== title && !column.multiline)
  if (title)
    layout.text(
      card,
      '',
      { x: 20, y: 16, width: width - 40, height: 32 },
      {
        ...foodText(colors.text, title.field === 'id' ? 15 : 20, 600),
        interactiveProps: {
          layout: { overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }
        },
        bindings: {
          text: {
            kind: 'expr',
            expr:
              title.field === 'id'
                ? foodColumnExpression(screen, title, 'item')
                : 'item.' + title.field
          }
        }
      }
    )
  columns.forEach((column, index) =>
    layout.text(
      card,
      '',
      {
        x: 20 + (index % 2) * (width / 2),
        y: (title ? 54 : 20) + Math.floor(index / 2) * 32,
        width: width / 2 - 40,
        height: 28
      },
      {
        ...foodText(colors.muted, 14),
        interactiveProps: {
          layout: { overflowX: 'auto', overflowY: 'hidden', whiteSpace: 'nowrap' }
        },
        bindings: { text: { kind: 'expr', expr: foodColumnExpression(screen, column, 'item') } }
      }
    )
  )
  definition.columns
    .filter((column) => column.multiline)
    .forEach((column, index) =>
      layout.text(
        card,
        '',
        {
          x: 20,
          y: (title ? 54 : 20) + Math.ceil(columns.length / 2) * 32 + index * 92,
          width: width - 40,
          height: 80
        },
        {
          ...foodText(colors.muted, 14),
          interactiveProps: { layout: { overflowY: 'auto', whiteSpace: 'pre-wrap' } },
          bindings: { text: { kind: 'expr', expr: foodColumnExpression(screen, column, 'item') } }
        }
      )
    )
}
