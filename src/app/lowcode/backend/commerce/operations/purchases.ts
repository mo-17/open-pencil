import type { StateDef } from '@open-pencil/scene-graph'

import { setCommerceState as set } from '../state'
import { createOperation } from './actions'
import type { OperationsContext } from './context'
import { createOperationsScreen, selectedFilter, type OperationsScreen } from './screen'

function renderSelectedOrderSummary(
  screen: OperationsScreen,
  id: StateDef,
  status: StateDef,
  y: number,
  height: number
): void {
  screen.bound(
    screen.page,
    `${screen.current} ? ${id.name} + " · " + ${status.name} : ${JSON.stringify(screen.ctx.copy.none)}`,
    y,
    height
  )
}

export function createOperationsPurchases(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'purchases', 2100, c.paymentHint)
  const id = s.field('Purchase'),
    status = s.field('Status'),
    outcome = s.field('Outcome', 'string', 'succeeded')
  const pending = `${s.current} && !!${id.name} && ${status.name} === "pending"`
  const payment = createOperation(
    s,
    'payment.simulate',
    [
      { key: 'purchaseId', valueExpr: id.name },
      { key: 'outcome', valueExpr: outcome.name }
    ],
    pending,
    c.simulate
  )
  const cancel = createOperation(
    s,
    'purchase.cancel',
    [{ key: 'purchaseId', valueExpr: id.name }],
    pending,
    c.cancel
  )
  const locked = `(${payment.locked} || ${cancel.locked})`
  const rows = s.list('purchases', c.purchases, 224, 180)
  s.bound(rows.card, 'item.id + " · " + item.status', 16, 42)
  s.bound(rows.card, 'item.total + " " + item.currency + " · " + item.order_count', 62)
  const children = s.list('orders', c.purchaseChildren, 1600, 150, [
    { key: 'payment_group_id', valueExpr: selectedFilter(s, id) }
  ])
  s.bound(children.card, 'item.store_title + " · " + item.status + " · " + item.total', 18, 52)
  l.button(children.card, c.orders, 16, 88, [l.navigate(ctx.paths.orders)])
  l.button(
    rows.card,
    c.select,
    16,
    116,
    [...s.select([id, 'item.id'], [status, 'item.status']), set(children.after, '""')],
    { renderCondition: `!${locked}` }
  )
  renderSelectedOrderSummary(s, id, status, 596, 44)
  for (const [index, [value, label]] of (
    [
      ['succeeded', c.pay],
      ['failed', c.failPayment],
      ['unknown', c.unknownPayment]
    ] as const
  ).entries())
    l.button(s.page, label, 48 + 296 * index, 658, [set(outcome, JSON.stringify(value))], {
      width: 282,
      renderCondition: `${pending} && !${locked}`
    })
  s.bound(s.page, `${JSON.stringify(c.paymentChoice + ': ')} + ${outcome.name}`, 718)
  l.button(s.page, c.simulate, 48, 764, [payment.submit], {
    renderCondition: `${pending} && !${locked}`,
    width: 280
  })
  payment.feedback(826)
  l.button(s.page, c.cancel, 48, 1182, [cancel.submit], {
    renderCondition: `${pending} && !${locked}`,
    width: 290
  })
  cancel.feedback(1240)
  s.finish()
}

export function createOperationsOrders(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'orders', 2840, c.deliveryHint)
  const id = s.field('Order'),
    status = s.field('Status'),
    reason = s.field('Reason')
  const selected = `${s.current} && !!${id.name}`
  const refund = createOperation(
    s,
    'refund.request',
    [
      { key: 'orderId', valueExpr: id.name },
      { key: 'reason', valueExpr: reason.name }
    ],
    `${selected} && ${status.name} === "paid" && !!${reason.name}`,
    c.refund
  )
  const deliver = createOperation(
    s,
    'shipment.deliver',
    [{ key: 'orderId', valueExpr: id.name }],
    `${selected} && ${status.name} === "shipped"`,
    c.deliver
  )
  const locked = `(${refund.locked} || ${deliver.locked})`
  const rows = s.list('orders', c.orders, 224, 190)
  s.bound(rows.card, 'item.store_title + " · " + item.status + " · " + item.total', 16, 44)
  s.bound(rows.card, 'item.id', 66, 42)
  const filter = [{ key: 'order_id', valueExpr: selectedFilter(s, id) }]
  const items = s.list('order-items', c.items, 610, 124, filter)
  s.bound(
    items.card,
    'item.product_title + " · " + item.quantity + " × " + item.unit_price + " = " + item.line_total',
    18,
    74
  )
  const shipments = s.list('shipments', c.shipments, 994, 124, filter)
  s.bound(
    shipments.card,
    'item.carrier + " · " + item.tracking_number + " · " + item.status',
    18,
    74
  )
  const refunds = s.list('refunds', c.refunds, 1378, 124, filter)
  s.bound(refunds.card, 'item.status + " · " + item.amount + " · " + item.reason', 18, 74)
  l.button(
    rows.card,
    c.select,
    16,
    124,
    [
      ...s.select([id, 'item.id'], [status, 'item.status']),
      ...[items, shipments, refunds].map((list) => set(list.after, '""'))
    ],
    { renderCondition: `!${locked}` }
  )
  renderSelectedOrderSummary(s, id, status, 1746, 42)
  const form = l.shape('FORM', c.refund, s.page, 48, 1808, 890, 150, {
    layoutMode: 'NONE',
    renderCondition: `${selected} && ${status.name} === "paid" && !${locked}`,
    events: { onSubmit: [refund.submit] }
  })
  s.input(form, c.reason, reason, 0, { required: true, maxLength: 500, pattern: '\\S' })
  l.button(form, c.refund, 0, 98, [])
  refund.feedback(1980)
  l.button(s.page, c.deliver, 48, 2340, [deliver.submit], {
    renderCondition: `${selected} && ${status.name} === "shipped" && !${locked}`
  })
  deliver.feedback(2404)
  s.finish()
}
