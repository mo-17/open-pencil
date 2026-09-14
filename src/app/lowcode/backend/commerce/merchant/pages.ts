import type { CommerceLayout } from '../layout'
import { createCommerceRecoverySection } from '../recovery/section'
import { setCommerceVariable as variable } from '../state'
import type { CommerceMerchantState } from './state'
import { createCommerceStorePages } from './stores'

export function createCommerceMerchantPages(
  layout: CommerceLayout,
  merchant: CommerceMerchantState,
  admin: string
): void {
  const { copy, paths, targets: t, busy, after, locked, storeId } = merchant
  const { page, text, button, navigate, listing, pagination } = layout
  button(admin, copy.merchantOrders, 456, 162, [navigate(paths.merchantOrders)])
  if (paths.openStore) button(admin, copy.openStore, 660, 162, [navigate(paths.openStore)])
  const orders = page(copy.merchantOrders, paths.merchantOrders, [busy, after], true, 1400)
  text(orders, copy.merchantOrders, 48, 28, 850, { fontSize: 30 })
  text(orders, copy.ordersHint, 48, 78, 880, { height: 58, fontSize: 14 })
  button(orders, copy.base.admin, 48, 146, [navigate(paths.admin)])
  button(orders, copy.base.shop, 252, 146, [navigate(paths.shop)])
  if (paths.openStore) button(orders, copy.openStore, 456, 146, [navigate(paths.openStore)])
  if (storeId)
    text(orders, copy.noStore, 48, 202, 870, {
      renderCondition: `!${storeId}`,
      height: 44
    })
  const item = listing(orders, copy.merchantOrders, 254, merchant.source, 260)
  text(item, 'Order product', 16, 12, 800, {
    fontSize: 20,
    bindings: {
      text: {
        kind: 'expr',
        expr: storeId ? 'item.store_title + " · " + item.product_title' : 'item.product_title'
      }
    }
  })
  text(item, 'Order summary', 16, 52, 800, {
    height: 54,
    fontSize: 14,
    bindings: {
      text: {
        kind: 'expr',
        expr: `${JSON.stringify(copy.base.quantityLabel + ': ')} + item.quantity + ${JSON.stringify(' · ' + copy.base.total + ': ')} + item.total + " · " + item.id`
      }
    }
  })
  const status = `item.status === "fulfilled" ? ${JSON.stringify(copy.completed)} : item.status === "cancelled" ? ${JSON.stringify(copy.base.cancelledStatus)} : ${JSON.stringify(copy.base.pendingStatus)}`
  text(item, 'Order status', 16, 116, 800, {
    fontSize: 14,
    bindings: { text: { kind: 'expr', expr: `(${status}) + " · " + item.created_at` } }
  })
  button(
    item,
    copy.chooseOrder,
    16,
    174,
    [
      variable(t.order, 'item.id'),
      variable(t.summary, 'item.product_title + " · " + item.id'),
      variable(t.error, '""')
    ],
    { renderCondition: `item.status === "pending" && !${locked}` }
  )
  pagination(orders, after, t.cursor, 560)
  text(orders, '', 48, 628, 880, {
    height: 58,
    bindings: { text: { kind: 'expr', expr: t.summary } }
  })
  button(orders, copy.complete, 48, 700, [merchant.submit], {
    renderCondition: `!!${t.order} && !${locked}${storeId ? ' && !!' + storeId : ''}`
  })
  text(orders, copy.base.submitting, 252, 706, 580, { renderCondition: busy.name })
  text(orders, copy.completionSaved, 48, 760, 850, {
    renderCondition: `${t.result}.status === "fulfilled"`
  })
  text(orders, '', 48, 810, 880, {
    height: 58,
    bindings: { text: { kind: 'docState', docStateName: t.error } }
  })
  createCommerceRecoverySection(layout, copy.base, orders, 910, {
    info: t.recovery,
    busy: busy.name,
    display: t.display,
    actions: merchant.recovery,
    acknowledgeLabel: copy.newCompletion
  })
  if (merchant.mode === 'multi-merchant') createCommerceStorePages(layout, merchant)
}
