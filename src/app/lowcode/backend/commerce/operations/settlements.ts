import { createOperation } from './actions'
import type { OperationsContext } from './context'
import { createOperationsScreen } from './screen'

export function createOperationsSettlements(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'settlements', 820, c.settlementHint)
  const rows = s.list('merchant-settlements', c.settlements, 224, 224)
  s.bound(rows.card, 'item.order_id + " · " + item.status', 16, 44)
  s.bound(
    rows.card,
    'item.gross_amount + " - " + item.commission + " = " + item.merchant_amount + " " + item.currency',
    68
  )
  s.bound(rows.card, '(item.available_at || "") + " · " + (item.reference || "")', 112, 60)
  l.button(s.page, c.merchantOrders, 48, 620, [l.navigate(ctx.paths.merchantOrders)])
  s.finish()
}

export function createOperationsOperator(ctx: OperationsContext): void {
  const { copy: c, layout: l } = ctx
  const s = createOperationsScreen(ctx, 'operator', 2860, c.operatorHint + ' ' + c.settlementHint)
  const refund = s.field('Refund'),
    refundStatus = s.field('RefundStatus'),
    reference = s.field('RefundReference')
  const settlement = s.field('Settlement'),
    settlementStatus = s.field('SettlementStatus'),
    settlementReference = s.field('SettlementReference')
  const selectedRefund = `${s.current} && !!${refund.name} && ${refundStatus.name} === "requested" && !!${reference.name}`
  const payload = [
    { key: 'refundId', valueExpr: refund.name },
    { key: 'reference', valueExpr: reference.name }
  ]
  const approve = createOperation(s, 'refund.approve', payload, selectedRefund, c.approve)
  const reject = createOperation(s, 'refund.reject', payload, selectedRefund, c.reject)
  const refundLocked = `(${approve.locked} || ${reject.locked})`
  const rows = s.list('operator-refunds', c.refunds, 224, 236)
  s.bound(rows.card, 'item.order_id + " · " + item.status + " · " + item.amount', 16, 50)
  s.bound(rows.card, 'item.reason + " · " + (item.decision_reference || "")', 74, 66)
  l.button(
    rows.card,
    c.select,
    16,
    162,
    s.select([refund, 'item.id'], [refundStatus, 'item.status'], [reference, '""']),
    { renderCondition: `!${refundLocked}` }
  )
  s.bound(
    s.page,
    `${s.current} ? ${refund.name} + " · " + ${refundStatus.name} : ${JSON.stringify(c.none)}`,
    596,
    46
  )
  const form = l.shape('FORM', c.approve, s.page, 48, 660, 890, 158, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && !!${refund.name} && ${refundStatus.name} === "requested" && !${refundLocked}`,
    events: { onSubmit: [approve.submit] }
  })
  s.input(form, c.reference, reference, 0, { required: true, maxLength: 200, pattern: '\\S' })
  l.button(form, c.approve, 0, 98, [])
  l.button(form, c.reject, 250, 98, [reject.submit])
  approve.feedback(840)
  reject.feedback(1190)
  const record = createOperation(
    s,
    'settlement.record',
    [
      { key: 'settlementId', valueExpr: settlement.name },
      { key: 'reference', valueExpr: settlementReference.name }
    ],
    `${s.current} && !!${settlement.name} && ${settlementStatus.name} === "pending" && !!${settlementReference.name}`,
    c.settle
  )
  const settlements = s.list('operator-settlements', c.settlements, 1590, 232)
  s.bound(settlements.card, 'item.order_id + " · " + item.status', 16, 44)
  s.bound(
    settlements.card,
    'item.gross_amount + " - " + item.commission + " = " + item.merchant_amount + " " + item.currency',
    68
  )
  s.bound(settlements.card, '(item.available_at || "") + " · " + (item.reference || "")', 110, 40)
  l.button(
    settlements.card,
    c.select,
    16,
    166,
    s.select(
      [settlement, 'item.id'],
      [settlementStatus, 'item.status'],
      [settlementReference, '""']
    ),
    { renderCondition: `!${record.locked}` }
  )
  s.bound(
    s.page,
    `${s.current} ? ${settlement.name} + " · " + ${settlementStatus.name} : ${JSON.stringify(c.none)}`,
    1964,
    46
  )
  const payment = l.shape('FORM', c.settle, s.page, 48, 2030, 890, 158, {
    layoutMode: 'NONE',
    renderCondition: `${s.current} && !!${settlement.name} && ${settlementStatus.name} === "pending" && !${record.locked}`,
    events: { onSubmit: [record.submit] }
  })
  s.input(payment, c.reference, settlementReference, 0, {
    required: true,
    maxLength: 200,
    pattern: '\\S'
  })
  l.button(payment, c.settle, 0, 98, [])
  record.feedback(2220)
  s.finish()
}
