export const FOOD_ORDERS_SOURCE = String.raw`import type { DatabaseTransaction } from './database.service.js'
import type { CommandPlan } from './command-types.js'
import { foodAmount, foodConflict, foodInsert, foodText, foodUpdate, type FoodInput, type FoodRow } from './food-data.js'

const FOOD_TRANSITIONS: Readonly<Record<string, { from: readonly string[]; to: string }>> = {
  'order.cancel': { from: ['pending'], to: 'cancelled' },
  'order.accept': { from: ['pending'], to: 'accepted' },
  'order.prepare': { from: ['accepted'], to: 'preparing' },
  'order.ready': { from: ['preparing'], to: 'ready' },
  'order.complete': { from: ['ready'], to: 'completed' },
  'order.reject': { from: ['pending', 'accepted', 'preparing', 'ready'], to: 'cancelled' }
}
export async function transitionFoodOrder(client: DatabaseTransaction, order: FoodRow, plan: CommandPlan, input: FoodInput, subject: string): Promise<FoodRow> {
  const operation = plan.foodOrderingOperation
  const transition = operation ? FOOD_TRANSITIONS[operation] : undefined
  if (!transition || !transition.from.includes(foodText(order.status))) return foodConflict()
  const result = await foodUpdate(client, 'orders', order.id, { status: transition.to, version: foodAmount(BigInt(foodAmount(order.version)) + 1n) })
  await foodInsert(client, 'orderHistory', { owner_id: order.owner_id, order_id: order.id, actor_subject: subject,
    action: operation!, before_status: order.status, after_status: transition.to, note: foodText(input.note).trim() })
  return result
}
`
