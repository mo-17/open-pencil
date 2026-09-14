export const COMMERCE_CART_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { COMMERCE } from './commerce-model.js'
import { amount, conflict, insert, one, rows, text, update, type Input, type Row } from './commerce-data.js'

async function summarize(client: DatabaseTransaction, cart: Row): Promise<Row> {
  const items = await rows(client, 'cartItems', { cart_id: cart.id, active: true })
  if (items.length > COMMERCE.maxItems) return conflict()
  const subtotal = amount(items.reduce((total, item) => total + BigInt(amount(item.line_total)), 0n))
  return update(client, 'carts', cart.id, { version: amount(BigInt(amount(cart.version)) + 1n), subtotal, item_count: items.length })
}
export async function setCartItem(client: DatabaseTransaction, cart: Row, input: Input, subject: string): Promise<Row> {
  const product = await one(client, 'products', { id: input.skuId })
  if (product.active !== true || amount(input.quantity) > amount(product.stock)) return conflict()
  const existing = (await rows(client, 'cartItems', { cart_id: cart.id, sku_id: product.id }, true, 1))[0]
  const values = { store_id: product.store_id, product_title: product.title, quantity: input.quantity,
    unit_price: amount(product.price), line_total: amount(BigInt(amount(product.price)) * BigInt(amount(input.quantity))), active: true }
  if (existing) await update(client, 'cartItems', existing.id, values)
  else await insert(client, 'cartItems', { owner_id: subject, cart_id: cart.id, sku_id: product.id, ...values })
  return summarize(client, cart)
}
export async function removeCartItem(client: DatabaseTransaction, cart: Row, input: Input): Promise<Row> {
  const item = await one(client, 'cartItems', { id: input.itemId, cart_id: cart.id })
  if (item.active !== true) return cart
  await update(client, 'cartItems', item.id, { active: false, quantity: 0, line_total: 0 })
  return summarize(client, cart)
}
export interface CheckoutLine { item: Row; product: Row }
export interface CheckoutSnapshot { lines: CheckoutLine[]; stores: Row[]; total: number }
export async function checkoutSnapshot(client: DatabaseTransaction, cart: Row, revision: number): Promise<CheckoutSnapshot> {
  if (amount(cart.version) !== revision) return conflict()
  const items = await rows(client, 'cartItems', { cart_id: cart.id, active: true }, true)
  if (!items.length || items.length > COMMERCE.maxItems) return conflict()
  const storeIds = [...new Set(items.map((item) => text(item.store_id)))].sort()
  if (storeIds.length > COMMERCE.maxStores || ((COMMERCE.mode as string) === 'single-merchant' && storeIds.length !== 1)) return conflict()
  const stores: Row[] = []
  for (const id of storeIds) stores.push(await one(client, 'stores', { id }, 'share'))
  const lines: CheckoutLine[] = []
  for (const item of [...items].sort((left, right) => text(left.sku_id).localeCompare(text(right.sku_id), 'en'))) {
    const product = await one(client, 'products', { id: item.sku_id })
    const quantity = amount(item.quantity)
    if (!quantity || quantity > 99 || product.active !== true || product.store_id !== item.store_id ||
      amount(product.stock) < quantity || amount(product.price) !== amount(item.unit_price)) return conflict()
    lines.push({ item, product })
  }
  const total = amount(lines.reduce((sum, line) => sum + BigInt(amount(line.product.price)) * BigInt(amount(line.item.quantity)), 0n))
  return { lines, stores, total }
}
`
