export const COMMERCE_FULFILLMENT_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { COMMERCE } from './commerce-model.js'
import { amount, conflict, entry, insert, one, requiredText, rows, text, update, type Context, type Input, type Row } from './commerce-data.js'

export async function dispatchShipment(client: DatabaseTransaction, context: Context, input: Input): Promise<Row> {
  const { order, group } = context
  if (!order || !group || order.status !== 'paid' || order.stock_released !== false || !['paid', 'partially_refunded'].includes(text(group.status))) return conflict()
  const existing = await rows(client, 'shipments', { order_id: order.id }, true, 1)
  if (existing.length) return conflict()
  const shipment = await insert(client, 'shipments', { owner_id: order.owner_id, order_id: order.id,
    store_id: order.store_id, carrier: requiredText(input.carrier), tracking_number: requiredText(input.trackingNumber) })
  await update(client, 'orders', order.id, { status: 'shipped' })
  return shipment
}
export async function deliverShipment(client: DatabaseTransaction, context: Context): Promise<Row> {
  const { order, group } = context
  if (!order || !group || order.status !== 'shipped' || !['paid', 'partially_refunded'].includes(text(group.status))) return conflict()
  const shipment = await one(client, 'shipments', { order_id: order.id })
  if (shipment.status !== 'shipped') return conflict()
  const deliveredAt = new Date().toISOString()
  await update(client, 'shipments', shipment.id, { status: 'delivered', delivered_at: deliveredAt })
  const settlement = await one(client, 'settlements', { order_id: order.id })
  if (settlement.status !== 'pending') return conflict()
  await update(client, 'settlements', settlement.id, { available_at: new Date(Date.parse(deliveredAt) + COMMERCE.settlementDelaySeconds * 1000).toISOString() })
  return update(client, 'orders', order.id, { status: 'delivered', delivered_at: deliveredAt })
}
export async function recordSettlement(client: DatabaseTransaction, context: Context, input: Input): Promise<Row> {
  const { group, order, settlement } = context
  if (!group || !order || !settlement || order.status !== 'delivered' || settlement.status !== 'pending' ||
    !['paid', 'partially_refunded'].includes(text(group.status)) || settlement.available_at === null ||
    !Number.isFinite(Date.parse(text(settlement.available_at))) || Date.parse(text(settlement.available_at)) > Date.now()) return conflict()
  const refunds = await rows(client, 'refunds', { order_id: order.id }, true, 1)
  if (refunds.some((refund) => refund.status !== 'rejected')) return conflict()
  const reference = requiredText(input.reference)
  await entry(client, order, 'payout-record', -amount(order.merchant_amount), reference)
  return update(client, 'settlements', settlement.id, { status: 'recorded', reference, recorded_at: new Date().toISOString() })
}
export async function restockInventory(client: DatabaseTransaction, context: Context, input: Input): Promise<Row> {
  const product = context.product
  if (!product || product.store_id !== input.storeId) return conflict()
  return update(client, 'products', product.id, { stock: amount(BigInt(amount(product.stock)) + BigInt(amount(input.quantity))) })
}
`
