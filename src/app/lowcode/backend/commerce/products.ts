import type { ActionDef, BackendResourceDataSource } from '@open-pencil/scene-graph'

import type { commerceCopy } from './copy'
import type { CommerceLayout } from './layout'

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
  text(product, 'Product', 16, 12, 800, {
    bindings: { text: { kind: 'expr', expr: 'item.title' } },
    fontSize: 20
  })
  text(product, 'Price', 16, 50, 800, {
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.unitPrice + ': ')} + item.price + ${JSON.stringify(' · ' + copy.stock + ': ')} + item.stock + ${JSON.stringify(' · ' + copy.amountUnit)}`
      }
    },
    fontSize: 14
  })
  button(product, copy.choose, 16, 104, select, {
    renderCondition: `item.stock > 0 && item.active && !${locked}`
  })
  text(product, copy.soldOut, 228, 112, 540, { renderCondition: 'item.stock <= 0 || !item.active' })
}
