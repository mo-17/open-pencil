export const COMMERCE_REFUND_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { amount, conflict, entry, insert, one, requiredText, rows, text, update, type Context, type Input, type Row } from './commerce-data.js'
import { groupOrders, releaseStock } from './commerce-stock.js'

export function refundGroupStatus(group: Row, orders: readonly Row[]): string {
  if (!orders.length) return conflict()
  if (orders.every((order) => order.status === 'refunded')) return 'refunded'
  return group.status === 'refund_required' ? 'refund_required' : 'partially_refunded'
}

async function refundableSettlement(client: DatabaseTransaction, order: Row): Promise<Row> {
  const settlement = await one(client, 'settlements', { order_id: order.id })
  if (settlement.status === 'recorded' || order.status === 'shipped' || order.status === 'delivered') return conflict()
  return settlement
}
export async function requestRefund(client: DatabaseTransaction, context: Context, input: Input): Promise<Row> {
  const { group, order } = context
  if (!group || !order || !['paid', 'partially_refunded'].includes(text(group.status)) || order.status !== 'paid') return conflict()
  await refundableSettlement(client, order)
  const existing = (await rows(client, 'refunds', { order_id: order.id }, true, 1))[0]
  if (existing && existing.status !== 'rejected') return conflict()
  const values = { reason: requiredText(input.reason), status: 'requested', decision_reference: null }
  const result = existing ? await update(client, 'refunds', existing.id, values) : await insert(client, 'refunds', {
    owner_id: order.owner_id, order_id: order.id, payment_group_id: group.id, store_id: order.store_id, amount: order.total, ...values
  })
  await update(client, 'orders', order.id, { status: 'refund_pending' })
  return result
}
export async function decideRefund(client: DatabaseTransaction, context: Context, input: Input, approve: boolean): Promise<Row> {
  const { group, order, refund } = context
  if (!group || !order || !refund) return conflict()
  const reference = requiredText(input.reference)
  if (refund.status !== 'requested' || order.status !== 'refund_pending' ||
    refund.order_id !== order.id || refund.payment_group_id !== group.id || amount(refund.amount) !== amount(order.total)) return conflict()
  const settlement = await refundableSettlement(client, order)
  if (!approve) {
    // A late successful payment has no reservation left; it must be refunded, never revived.
    if (order.stock_released !== false || group.status === 'refund_required') return conflict()
    await update(client, 'orders', order.id, { status: 'paid' })
    return update(client, 'refunds', refund.id, { status: 'rejected', decision_reference: reference })
  }
  if (!text(group.payment_reference).startsWith('development-simulator:')) return conflict()
  const refunded = amount(BigInt(amount(group.refunded_amount)) + BigInt(amount(refund.amount)))
  if (refunded > amount(group.total)) return conflict()
  await releaseStock(client, [order])
  await update(client, 'orders', order.id, { status: 'refunded' })
  await update(client, 'settlements', settlement.id, { status: 'reversed' })
  await entry(client, order, 'refund', -amount(order.total), reference)
  await entry(client, order, 'commission-reversal', -amount(order.commission), reference)
  const status = refundGroupStatus(group, await groupOrders(client, group))
  await update(client, 'paymentGroups', group.id, { refunded_amount: refunded, status })
  return update(client, 'refunds', refund.id, { status: 'approved', decision_reference: reference })
}
`
