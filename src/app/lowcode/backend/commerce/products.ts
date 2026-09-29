import type { ActionDef, BackendResourceDataSource } from '@open-pencil/scene-graph'

import type { commerceCopy } from './copy'
import type { CommerceLayout } from './layout'
import { COMMERCE_PALETTE as colors, commerceSurface } from './presentation'

export function createProductIllustration(layout: CommerceLayout, parent: string): void {
  layout.shape(
    'FRAME',
    'Product illustration',
    parent,
    16,
    16,
    136,
    148,
    commerceSurface(colors.tint)
  )
  layout.shape('FRAME', 'Package', parent, 42, 44, 84, 88, commerceSurface('#BBCBE4'))
  layout.shape('RECTANGLE', 'Package ribbon', parent, 78, 44, 14, 88, commerceSurface('#E1E9F5'))
}

export function createCommerceProducts(
  layout: CommerceLayout,
  copy: ReturnType<typeof commerceCopy>,
  parent: string,
  source: BackendResourceDataSource,
  select: ActionDef[],
  locked: string,
  condition?: string
): void {
  const { listing, text, button } = layout
  const product = listing(
    parent,
    copy.shop,
    290,
    source,
    180,
    condition ? { renderCondition: condition } : {}
  )
  createProductIllustration(layout, product)
  text(product, 'Product', 176, 16, 670, {
    bindings: { text: { kind: 'expr', expr: 'item.title' } },
    fontSize: 20
  })
  text(product, 'Price', 176, 56, 670, {
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.unitPrice + ': ')} + item.price + ${JSON.stringify(' · ' + copy.stock + ': ')} + item.stock + ${JSON.stringify(' · ' + copy.amountUnit)}`
      }
    },
    fontSize: 14
  })
  button(product, copy.choose, 176, 112, select, {
    renderCondition: `item.stock > 0 && item.active && !${locked}`
  })
  text(product, copy.soldOut, 396, 118, 444, { renderCondition: 'item.stock <= 0 || !item.active' })
}
