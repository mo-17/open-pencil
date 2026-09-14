export const COMMERCE_PAYMENT_SOURCE = String.raw`import { BadRequestException } from '@nestjs/common'
import type { DatabaseTransaction } from './database.service.js'
import { amount, conflict, entry, event, insert, rows, text, update, type Input, type Row } from './commerce-data.js'
import { groupOrders, releaseStock } from './commerce-stock.js'

export async function cancelPurchase(client: DatabaseTransaction, group: Row): Promise<Row> {
  if (group.status === 'cancelled') return group
  if (group.status !== 'pending') return conflict()
  const orders = await groupOrders(client, group)
  if (orders.some((order) => order.status !== 'awaiting_payment')) return conflict()
  await releaseStock(client, orders)
  for (const order of orders) {
    await update(client, 'orders', order.id, { status: 'cancelled' })
    const settlement = (await rows(client, 'settlements', { order_id: order.id }, true, 1))[0]
    if (!settlement || settlement.status !== 'pending') return conflict()
    await update(client, 'settlements', settlement.id, { status: 'reversed' })
  }
  return update(client, 'paymentGroups', group.id, { status: 'cancelled' })
}
async function lateSuccess(client: DatabaseTransaction, group: Row, orders: Row[]): Promise<Row> {
  await releaseStock(client, orders)
  for (const order of orders) {
    await update(client, 'orders', order.id, { status: 'refund_pending' })
    await entry(client, order, 'payment', amount(order.total))
    await entry(client, order, 'commission', amount(order.commission))
    const existing = await rows(client, 'refunds', { order_id: order.id }, true, 1)
    if (!existing.length) await insert(client, 'refunds', { owner_id: order.owner_id, order_id: order.id,
      payment_group_id: group.id, store_id: order.store_id, amount: order.total,
      reason: 'Development simulator payment arrived after reservation release or expiry.' })
  }
  return update(client, 'paymentGroups', group.id, { status: 'refund_required', payment_reference: 'development-simulator:' + text(group.id) })
}
export async function simulatePayment(client: DatabaseTransaction, group: Row, input: Input): Promise<Row> {
  const outcome = input.outcome
  if (!['succeeded', 'failed', 'unknown'].includes(text(outcome))) throw new BadRequestException('Invalid simulator outcome.')
  if (!await event(client, group, text(outcome))) return group
  if (outcome === 'unknown') return group
  if (outcome === 'failed') return group.status === 'pending' ? cancelPurchase(client, group) : group
  if (!['pending', 'cancelled'].includes(text(group.status))) return group
  const orders = await groupOrders(client, group)
  const expired = Date.parse(text(group.expires_at)) <= Date.now()
  if (expired || group.status === 'cancelled') return lateSuccess(client, group, orders)
  if (orders.some((order) => order.status !== 'awaiting_payment' || order.stock_released !== false)) return conflict()
  for (const order of orders) {
    await update(client, 'orders', order.id, { status: 'paid' })
    await entry(client, order, 'payment', amount(order.total))
    await entry(client, order, 'commission', amount(order.commission))
  }
  return update(client, 'paymentGroups', group.id, { status: 'paid', payment_reference: 'development-simulator:' + text(group.id) })
}
`
