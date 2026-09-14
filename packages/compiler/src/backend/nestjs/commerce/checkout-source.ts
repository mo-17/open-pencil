export const COMMERCE_CHECKOUT_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { COMMERCE } from './commerce-model.js'
import { amount, insert, requiredText, update, type Input, type Row } from './commerce-data.js'
import { checkoutSnapshot, type CheckoutLine } from './commerce-cart.js'

async function createStoreOrder(client: DatabaseTransaction, group: Row, store: Row, lines: CheckoutLine[], input: Input, subject: string): Promise<void> {
  const total = amount(lines.reduce((sum, line) => sum + BigInt(amount(line.product.price)) * BigInt(amount(line.item.quantity)), 0n))
  const commission = amount(BigInt(total) * BigInt(COMMERCE.commissionBasisPoints) / 10000n)
  const order = await insert(client, 'orders', {
    owner_id: subject, payment_group_id: group.id, store_id: store.id, store_title: store.title,
    total, commission, merchant_amount: total - commission, currency: COMMERCE.currency,
    recipient: requiredText(input.recipient), phone: requiredText(input.phone), address: requiredText(input.address)
  })
  for (const { item, product } of lines) {
    const quantity = amount(item.quantity)
    await update(client, 'products', product.id, { stock: amount(product.stock) - quantity })
    await insert(client, 'orderItems', { owner_id: subject, order_id: order.id, payment_group_id: group.id,
      store_id: store.id, sku_id: product.id, product_title: product.title, quantity,
      unit_price: amount(product.price), line_total: amount(BigInt(amount(product.price)) * BigInt(quantity)) })
    await update(client, 'cartItems', item.id, { active: false, quantity: 0, line_total: 0 })
  }
  await insert(client, 'settlements', { owner_id: subject, merchant_id: store.owner_id, order_id: order.id, store_id: store.id,
    payment_group_id: group.id, gross_amount: total, commission, merchant_amount: total - commission, currency: COMMERCE.currency })
}
export async function checkoutCart(client: DatabaseTransaction, cart: Row, input: Input, subject: string): Promise<Row> {
  const snapshot = await checkoutSnapshot(client, cart, amount(input.cartRevision))
  const group = await insert(client, 'paymentGroups', { owner_id: subject, total: snapshot.total, currency: COMMERCE.currency,
    cart_revision: cart.version, commission_basis_points: COMMERCE.commissionBasisPoints, order_count: snapshot.stores.length,
    expires_at: new Date(Date.now() + COMMERCE.reservationSeconds * 1000).toISOString() })
  for (const store of snapshot.stores)
    await createStoreOrder(client, group, store, snapshot.lines.filter((line) => line.product.store_id === store.id), input, subject)
  await update(client, 'carts', cart.id, { version: amount(BigInt(amount(cart.version)) + 1n), subtotal: 0, item_count: 0 })
  return group
}
`
