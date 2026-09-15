export const FOOD_CART_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import { FOOD } from './food-model.js'
import { foodAmount, foodConflict, foodInsert, foodOne, foodRows, foodUpdate, type FoodInput, type FoodRow } from './food-data.js'

async function summarizeFoodCart(client: DatabaseTransaction, cart: FoodRow): Promise<FoodRow> {
  const items = await foodRows(client, 'cartItems', { cart_id: cart.id, owner_id: cart.owner_id, active: true })
  if (items.length > FOOD.maxItems) return foodConflict()
  const subtotal = foodAmount(items.reduce((total, item) => total + BigInt(foodAmount(item.unit_price)) * BigInt(foodAmount(item.quantity)), 0n))
  return foodUpdate(client, 'carts', cart.id, { version: foodAmount(BigInt(foodAmount(cart.version)) + 1n), subtotal, item_count: items.length })
}
export async function setFoodCartItem(client: DatabaseTransaction, cart: FoodRow, input: FoodInput, subject: string): Promise<FoodRow> {
  const quantity = foodAmount(input.quantity)
  if (!quantity || quantity > FOOD.maxQuantity) return foodConflict()
  const menu = await foodOne(client, 'menuItems', { id: input.menuItemId }, 'share')
  if (menu.available !== true) return foodConflict()
  const existing = (await foodRows(client, 'cartItems', { cart_id: cart.id, menu_item_id: menu.id }, 'update', 1))[0]
  const price = foodAmount(menu.price)
  const values = { product_title: menu.title, quantity, unit_price: price, line_total: foodAmount(BigInt(price) * BigInt(quantity)), active: true }
  if (existing) await foodUpdate(client, 'cartItems', existing.id, values)
  else await foodInsert(client, 'cartItems', { owner_id: subject, cart_id: cart.id, menu_item_id: menu.id, ...values })
  return summarizeFoodCart(client, cart)
}
export async function removeFoodCartItem(client: DatabaseTransaction, cart: FoodRow, input: FoodInput): Promise<FoodRow> {
  const item = await foodOne(client, 'cartItems', { id: input.itemId, cart_id: cart.id, owner_id: cart.owner_id })
  if (item.active !== true) return cart
  await foodUpdate(client, 'cartItems', item.id, { active: false, quantity: 0, line_total: 0 })
  return summarizeFoodCart(client, cart)
}
`
