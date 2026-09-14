import { setCommerceState as set } from '../state'
import { createOperation } from './actions'
import type { OperationsContext } from './context'
import { createOperationsScreen, selectedFilter } from './screen'

export function createOperationsFulfillment(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'merchantOrders', 2740, c.merchantHint)
  const id = s.field('Order'),
    status = s.field('Status'),
    address = s.field('Address')
  const carrier = s.field('Carrier'),
    tracking = s.field('Tracking')
  const valid = `${s.current} && !!${id.name} && ${status.name} === "paid" && !!${carrier.name} && !!${tracking.name}`
  const operation = createOperation(
    s,
    'shipment.dispatch',
    [
      { key: 'orderId', valueExpr: id.name },
      { key: 'carrier', valueExpr: carrier.name },
      { key: 'trackingNumber', valueExpr: tracking.name }
    ],
    valid,
    c.ship
  )
  const rows = s.list('merchant-orders', c.merchantOrders, 224, 180)
  s.bound(rows.card, 'item.store_title + " · " + item.status + " · " + item.total', 16, 48)
  s.bound(rows.card, 'item.id', 70, 36)
  const filter = [{ key: 'order_id', valueExpr: selectedFilter(s, id) }]
  const items = s.list('merchant-items', c.items, 708, 124, filter)
  s.bound(
    items.card,
    'item.product_title + " · " + item.quantity + " × " + item.unit_price + " = " + item.line_total',
    18,
    74
  )
  const shipments = s.list('merchant-shipments', c.shipments, 1092, 124, filter)
  s.bound(
    shipments.card,
    'item.carrier + " · " + item.tracking_number + " · " + item.status',
    18,
    74
  )
  const refunds = s.list('merchant-refunds', c.refunds, 1476, 124, filter)
  s.bound(refunds.card, 'item.status + " · " + item.amount + " · " + item.reason', 18, 74)
  l.button(
    rows.card,
    c.select,
    16,
    120,
    [
      ...s.select(
        [id, 'item.id'],
        [status, 'item.status'],
        [address, 'item.recipient + " · " + item.phone + " · " + item.address']
      ),
      ...[items, shipments, refunds].map((list) => set(list.after, '""'))
    ],
    { renderCondition: `!${operation.locked}` }
  )
  s.bound(
    s.page,
    `${s.current} ? ${id.name} + " · " + ${status.name} : ${JSON.stringify(c.none)}`,
    592,
    42
  )
  s.bound(s.page, `${s.current} ? ${address.name} : ""`, 642, 56)
  const form = l.shape('FORM', c.ship, s.page, 48, 1860, 890, 240, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && !!${id.name} && ${status.name} === "paid" && !${operation.locked}`,
    events: { onSubmit: [operation.submit] }
  })
  s.input(form, c.carrier, carrier, 0, { required: true, maxLength: 100, pattern: '\\S' })
  s.input(form, c.tracking, tracking, 86, { required: true, maxLength: 200, pattern: '\\S' })
  l.button(form, c.ship, 0, 180, [])
  operation.feedback(2140)
  l.button(s.page, c.settlements, 48, 2520, [l.navigate(ctx.paths.settlements)])
  s.finish()
}
