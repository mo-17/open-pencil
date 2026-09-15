export const FOOD_CHECKOUT_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { FOOD } from './food-model.js'
import { foodAmount, foodConflict, foodInsert, foodOne, foodRequired, foodRows, foodText, foodUpdate, type FoodInput, type FoodRow } from './food-data.js'

export async function checkoutFoodCart(client: DatabaseTransaction, cart: FoodRow, input: FoodInput, subject: string, fulfillment: 'dine_in' | 'pickup'): Promise<FoodRow> {
  if (foodAmount(cart.version) !== foodAmount(input.cartRevision)) return foodConflict()
  const items = await foodRows(client, 'cartItems', { cart_id: cart.id, owner_id: subject, active: true }, 'update')
  if (!items.length || items.length > FOOD.maxItems) return foodConflict()
  const lines: { item: FoodRow; menu: FoodRow; quantity: number; price: number; total: number }[] = []
  // Every cart follows one menu ID order. Menu edits cannot change this snapshot before commit.
  for (const item of [...items].sort((a, b) => foodText(a.menu_item_id).localeCompare(foodText(b.menu_item_id), 'en'))) {
    const menu = await foodOne(client, 'menuItems', { id: item.menu_item_id }, 'share')
    const quantity = foodAmount(item.quantity), price = foodAmount(menu.price)
    if (menu.available !== true || !quantity || quantity > FOOD.maxQuantity || price !== foodAmount(item.unit_price)) return foodConflict()
    lines.push({ item, menu, quantity, price, total: foodAmount(BigInt(price) * BigInt(quantity)) })
  }
  const total = foodAmount(lines.reduce((sum, line) => sum + BigInt(line.total), 0n))
  const note = foodText(input.note).trim()
  const order = await foodInsert(client, 'orders', {
    owner_id: subject, status: 'pending', fulfillment, table_number: fulfillment === 'dine_in' ? foodRequired(input.tableNumber) : '',
    contact_name: foodRequired(input.contactName), phone: foodText(input.phone).trim(), note, currency: FOOD.currency, total, version: 0
  })
  for (const { item, menu, quantity, price, total: lineTotal } of lines) {
    await foodInsert(client, 'orderItems', { owner_id: subject, order_id: order.id, menu_item_id: menu.id,
      product_title: menu.title, quantity, unit_price: price, line_total: lineTotal })
    await foodUpdate(client, 'cartItems', item.id, { active: false, quantity: 0, line_total: 0 })
  }
  await foodInsert(client, 'orderHistory', { owner_id: subject, order_id: order.id, actor_subject: subject,
    action: fulfillment === 'dine_in' ? 'checkout.dine-in' : 'checkout.pickup', before_status: 'pending', after_status: 'pending', note })
  await foodUpdate(client, 'carts', cart.id, { version: foodAmount(BigInt(foodAmount(cart.version)) + 1n), subtotal: 0, item_count: 0 })
  return order
}
`
