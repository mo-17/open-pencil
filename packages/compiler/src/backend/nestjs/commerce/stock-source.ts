export const COMMERCE_STOCK_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { COMMERCE } from './commerce-model.js'
import { amount, conflict, one, rows, text, update, type Row } from './commerce-data.js'

export async function groupOrders(client: DatabaseTransaction, group: Row): Promise<Row[]> {
  const orders = await rows(client, 'orders', { payment_group_id: group.id }, true, 11)
  if (!orders.length || orders.length > COMMERCE.maxStores || orders.length !== amount(group.order_count)) return conflict()
  return orders
}
/** Call with the payment group and all affected orders already locked, before changing their states. */
export async function releaseStock(client: DatabaseTransaction, orders: Row[]): Promise<void> {
  const selected = orders.filter((order) => order.stock_released === false)
  const quantities = new Map<string, number>()
  for (const order of selected) {
    const items = await rows(client, 'orderItems', { order_id: order.id })
    if (!items.length || items.length > COMMERCE.maxItems) return conflict()
    for (const item of items) {
      const id = text(item.sku_id)
      quantities.set(id, amount(BigInt(quantities.get(id) ?? 0) + BigInt(amount(item.quantity))))
    }
  }
  for (const id of [...quantities.keys()].sort()) {
    const product = await one(client, 'products', { id })
    await update(client, 'products', product.id, { stock: amount(BigInt(amount(product.stock)) + BigInt(quantities.get(id)!)) })
  }
  for (const order of selected) await update(client, 'orders', order.id, { stock_released: true })
}
`
